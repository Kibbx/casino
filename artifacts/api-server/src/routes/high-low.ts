import { Router } from "express";
import { db, playersTable, settingsTable, transactionsTable } from "@workspace/db";
import { highlowGamesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";

const router = Router();

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows.length ? rows[0].value : fallback;
}
async function setSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (!existing.length)
    await db.insert(settingsTable).values({ key, value });
  else
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
}

// Rakeback real-ratio cache — persists between /start and /cashout
const highlowRealRatioCache = new Map<number, number>();

const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["C","D","H","S"];

function shuffledDeck(): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardRankValue(cardIdx: number): number {
  return (cardIdx % 13) + 2;
}

function cardLabel(cardIdx: number): string {
  return `${RANKS[cardIdx % 13]}${SUITS[Math.floor(cardIdx / 13)]}`;
}

const MULTIPLIER_STEPS = [1.0, 1.25, 1.55, 1.95, 2.50, 3.20, 4.10, 5.30, 6.80, 8.75, 11.25];

function getMultiplier(streak: number): number {
  if (streak < MULTIPLIER_STEPS.length) return MULTIPLIER_STEPS[streak];
  const last = MULTIPLIER_STEPS[MULTIPLIER_STEPS.length - 1];
  return parseFloat((last * Math.pow(1.30, streak - (MULTIPLIER_STEPS.length - 1))).toFixed(2));
}

router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("highlowEnabled", "true")) === "true";
  const minBet = parseInt(await getSetting("highlowMinBet", "100"));
  const maxBet = parseInt(await getSetting("highlowMaxBet", "50000"));
  const hasPassword = !!(await getSetting("highlowPassword", ""));
  res.json({ enabled, minBet, maxBet, hasPassword });
});

// POST /high-low/verify-password — public
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("highlowPassword", "");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("highlowPasswordToken", "");
  return res.json({ valid: true, token: token || null });
});

// GET /high-low/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("highlowEnabled", "true")) === "true";
  const minBet = parseInt(await getSetting("highlowMinBet", "100"));
  const maxBet = parseInt(await getSetting("highlowMaxBet", "50000"));
  res.json({ enabled, minBet, maxBet });
});

// POST /high-low/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  await setSetting("highlowEnabled", String(!!enabled));
  await setSetting("highlowMinBet", String(parseInt(minBet) || 100));
  await setSetting("highlowMaxBet", String(parseInt(maxBet) || 50000));
  res.json({ enabled: !!enabled, minBet: parseInt(minBet) || 100, maxBet: parseInt(maxBet) || 50000 });
});

router.get("/active", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [game] = await db
    .select()
    .from(highlowGamesTable)
    .where(and(eq(highlowGamesTable.playerId, playerId), eq(highlowGamesTable.status, "playing")));
  if (!game) return res.json({ game: null });
  const deck: number[] = JSON.parse(game.deckJson);
  const cardIdx = deck[game.currentPosition];
  return res.json({
    game: {
      id: game.id,
      bet: game.bet,
      currentCard: cardLabel(cardIdx),
      currentCardIdx: cardIdx,
      currentMultiplier: game.currentMultiplier,
      streak: game.streak,
    },
  });
});

router.post("/start", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { bet } = req.body;

  const enabled = (await getSetting("highlowEnabled", "true")) === "true";
  if (!enabled) return res.status(403).json({ error: "High-Low is currently closed." });

  const minBet = parseInt(await getSetting("highlowMinBet", "100"));
  const maxBet = parseInt(await getSetting("highlowMaxBet", "50000"));

  if (!bet || typeof bet !== "number") return res.status(400).json({ error: "bet is required" });
  if (bet < minBet) return res.status(400).json({ error: `Minimum bet is ${minBet.toLocaleString()} chips` });
  if (bet > maxBet) return res.status(400).json({ error: `Maximum bet is ${maxBet.toLocaleString()} chips` });

  const [existing] = await db
    .select()
    .from(highlowGamesTable)
    .where(and(eq(highlowGamesTable.playerId, playerId), eq(highlowGamesTable.status, "playing")));
  if (existing) {
    const deck: number[] = JSON.parse(existing.deckJson);
    const cardIdx = deck[existing.currentPosition];
    return res.status(409).json({
      error: "active_game",
      game: {
        id: existing.id,
        bet: existing.bet,
        currentCard: cardLabel(cardIdx),
        currentCardIdx: cardIdx,
        currentMultiplier: existing.currentMultiplier,
        streak: existing.streak,
      },
    });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  recordPlayerActivity(playerId, player.username, "high-low", true);

  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "High-Low bet" });

  // Rakeback: track the real-chip portion of this bet
  const hlRealRatio = await trackRakebackBet(playerId, bet);
  highlowRealRatioCache.set(playerId, hlRealRatio);

  const deck = shuffledDeck();
  const [game] = await db
    .insert(highlowGamesTable)
    .values({
      playerId,
      bet,
      deckJson: JSON.stringify(deck),
      currentPosition: 0,
      currentMultiplier: 1.0,
      streak: 0,
      status: "playing",
    })
    .returning();

  broadcastPlayerBalance(playerId, player.chips - bet);

  return res.json({
    gameId: game.id,
    bet: game.bet,
    currentCard: cardLabel(deck[0]),
    currentCardIdx: deck[0],
    currentMultiplier: 1.0,
    streak: 0,
  });
});

router.post("/guess", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { direction } = req.body;

  if (direction !== "higher" && direction !== "lower") {
    return res.status(400).json({ error: "direction must be 'higher' or 'lower'" });
  }

  const [game] = await db
    .select()
    .from(highlowGamesTable)
    .where(and(eq(highlowGamesTable.playerId, playerId), eq(highlowGamesTable.status, "playing")));
  if (!game) return res.status(400).json({ error: "No active game" });

  let deck: number[] = JSON.parse(game.deckJson);
  let nextPosition = game.currentPosition + 1;

  if (nextPosition >= deck.length) {
    deck = shuffledDeck();
    nextPosition = 0;
  }

  const currentCardIdx = JSON.parse(game.deckJson)[game.currentPosition];
  const nextCardIdx = deck[nextPosition];

  const currentRank = cardRankValue(currentCardIdx);
  const nextRank = cardRankValue(nextCardIdx);
  const isTie = nextRank === currentRank;
  // Ties count as a win for both higher and lower
  const isCorrect =
    isTie ||
    (direction === "higher" && nextRank > currentRank) ||
    (direction === "lower" && nextRank < currentRank);

  if (!isCorrect) {
    await db
      .update(highlowGamesTable)
      .set({ status: "lost", payout: 0, currentPosition: nextPosition, deckJson: JSON.stringify(deck) })
      .where(eq(highlowGamesTable.id, game.id));

    return res.json({
      result: "loss",
      nextCard: cardLabel(nextCardIdx),
      nextCardIdx,
      payout: 0,
      isTie,
    });
  }

  const newStreak = game.streak + 1;
  const newMultiplier = getMultiplier(newStreak);

  await db
    .update(highlowGamesTable)
    .set({
      currentPosition: nextPosition,
      deckJson: JSON.stringify(deck),
      streak: newStreak,
      currentMultiplier: newMultiplier,
    })
    .where(eq(highlowGamesTable.id, game.id));

  return res.json({
    result: "win",
    nextCard: cardLabel(nextCardIdx),
    nextCardIdx,
    newMultiplier,
    newStreak,
    isTie,
    potentialPayout: Math.floor(game.bet * newMultiplier),
  });
});

router.post("/cashout", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db
    .select()
    .from(highlowGamesTable)
    .where(and(eq(highlowGamesTable.playerId, playerId), eq(highlowGamesTable.status, "playing")));
  if (!game) return res.status(400).json({ error: "No active game to cash out" });
  if (game.streak === 0) return res.status(400).json({ error: "Make at least one correct guess before cashing out" });

  const payout = Math.floor(game.bet * game.currentMultiplier);

  await db
    .update(highlowGamesTable)
    .set({ status: "cashed_out", payout })
    .where(eq(highlowGamesTable.id, game.id));

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player) {
    await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId,
      amount: payout,
      type: "win",
      description: `High-Low cashout (${game.streak} streak, ×${game.currentMultiplier})`,
    });
    await trackRakebackWin(playerId, payout, highlowRealRatioCache.get(playerId) ?? 0);
    highlowRealRatioCache.delete(playerId);
    broadcastPlayerBalance(playerId, player.chips + payout);
  }

  return res.json({
    status: "cashed_out",
    multiplier: game.currentMultiplier,
    payout,
    streak: game.streak,
  });
});

export default router;
