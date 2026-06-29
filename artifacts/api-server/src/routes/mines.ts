import { Router } from "express";
import { randomInt } from "crypto";
import { db, playersTable, settingsTable, transactionsTable, minesGamesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { isPlayerGameBanned } from "./security.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) {
    await db.insert(settingsTable).values({ key, value });
  } else {
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  }
}

// House edge factor — multiplier is (1/fair_odds) * factor, so factor < 1.0 means house takes a cut.
// At 24 mines, without a house edge the 1-safe-tile strategy has positive EV (25× payout on 4% chance).
// Low risk  (1–5  mines): 3% house edge → factor 0.97
// Medium    (6–15 mines): 5% house edge → factor 0.95
// High risk (16–24mines): 7% house edge → factor 0.93
// e.g. 24 mines, 1 reveal: fair = 25×, payout = 25 × 0.93 = 23.25× → EV = 0.93 (house wins 7%)
function minesPayoutFactor(mines: number): number {
  if (mines <= 5)  return 0.97;
  if (mines <= 15) return 0.95;
  return 0.93;
}

// After n safe reveals with m mines in a 25-tile grid:
//   odds = product_{i=0}^{n-1} (25 - m - i) / (25 - i)
//   multiplier = (1 / odds) * minesPayoutFactor(m)
function calcMultiplier(mines: number, revealed: number): number {
  if (revealed === 0) return 1.0;
  let odds = 1.0;
  for (let i = 0; i < revealed; i++) {
    odds *= (25 - mines - i) / (25 - i);
  }
  return Math.max(1.0, parseFloat(((1 / odds) * minesPayoutFactor(mines)).toFixed(4)));
}

// Generate n unique random positions in [0, 24] using crypto.randomInt for
// true uniform randomness — Math.random() (xorshift128+) can exhibit subtle
// patterns that a player could exploit, especially with only 1 safe tile.
function generateMinePositions(count: number): number[] {
  const positions = Array.from({ length: 25 }, (_, i) => i);
  for (let i = positions.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1); // cryptographically secure, uniform in [0, i]
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions.slice(0, count).sort((a, b) => a - b);
}

// Rate limiting — 1 click per 250ms per player
const lastClickMs = new Map<number, number>();

// Rakeback real-ratio cache — persists between /start and /cashout
const minesRealRatioCache = new Map<number, number>();

function isRateLimited(playerId: number): boolean {
  const now = Date.now();
  const last = lastClickMs.get(playerId) ?? 0;
  if (now - last < 250) return true;
  lastClickMs.set(playerId, now);
  return false;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /mines/status — public
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("minesEnabled", "true")) === "true";
  const minBet = parseInt(await getSetting("minesMinBet", "50"));
  const maxBet = parseInt(await getSetting("minesMaxBet", "10000"));
  const pwHash = await getSetting("minesPassword");
  res.json({ enabled, minBet, maxBet, hasPassword: !!pwHash });
});

// POST /mines/verify-password — public room code check
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("minesPassword");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room code" });
  const token = await getSetting("minesPasswordToken");
  return res.json({ valid: true, token: token || null });
});

// GET /mines/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("minesEnabled", "true")) === "true";
  const minBet = parseInt(await getSetting("minesMinBet", "50"));
  const maxBet = parseInt(await getSetting("minesMaxBet", "10000"));
  res.json({ enabled, minBet, maxBet });
});

// POST /mines/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  await setSetting("minesEnabled", String(!!enabled));
  await setSetting("minesMinBet", String(parseInt(minBet) || 50));
  await setSetting("minesMaxBet", String(parseInt(maxBet) || 10000));
  res.json({ enabled: !!enabled, minBet: parseInt(minBet) || 50, maxBet: parseInt(maxBet) || 10000 });
});

// GET /mines/active — get active game for this player (for page restore)
router.get("/active", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [game] = await db
    .select()
    .from(minesGamesTable)
    .where(and(eq(minesGamesTable.playerId, playerId), eq(minesGamesTable.status, "playing")));
  if (!game) return res.json({ game: null });

  const revealed: number[] = JSON.parse(game.revealedTiles);
  // Never expose mine positions
  return res.json({
    game: {
      id: game.id,
      bet: game.bet,
      mines: game.mines,
      revealedTiles: revealed,
      currentMultiplier: game.currentMultiplier,
      status: game.status,
    },
  });
});

// POST /mines/start — begin a new game
router.post("/start", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const banCheck = await isPlayerGameBanned(playerId, "mines");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Mines${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const enabled = (await getSetting("minesEnabled", "true")) === "true";
  if (!enabled) return res.status(403).json({ error: "Mines is currently closed" });

  const minBet = parseInt(await getSetting("minesMinBet", "50"));
  const maxBet = parseInt(await getSetting("minesMaxBet", "10000"));

  const { bet, mines } = req.body;

  if (!bet || bet <= 0) return res.status(400).json({ error: "bet is required" });
  if (bet < minBet || bet > maxBet) return res.status(400).json({ error: `Bet must be between ${minBet.toLocaleString()} and ${maxBet.toLocaleString()} chips` });
  if (!mines || mines < 1 || mines > 24) return res.status(400).json({ error: "Mines must be between 1 and 24" });
  if (mines >= 25) return res.status(400).json({ error: "Too many mines" });

  // If an active game already exists, return it instead of silently eating the bet.
  // This handles the case where the player closes their tablet mid-game and then
  // tries to start a new one — their existing game is restored, not cancelled.
  const [existing] = await db
    .select()
    .from(minesGamesTable)
    .where(and(eq(minesGamesTable.playerId, playerId), eq(minesGamesTable.status, "playing")));
  if (existing) {
    const revealed: number[] = JSON.parse(existing.revealedTiles);
    return res.status(409).json({
      error: "active_game",
      activeGame: {
        gameId: existing.id,
        bet: existing.bet,
        mines: existing.mines,
        revealedTiles: revealed,
        currentMultiplier: existing.currentMultiplier,
        minBet,
        maxBet,
      },
    });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  recordPlayerActivity(playerId, player.username, "mines", true);

  // Deduct bet immediately
  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Mines bet" });

  // Rakeback: track the real-chip portion of this bet
  const minesRealRatio = await trackRakebackBet(playerId, bet);
  minesRealRatioCache.set(playerId, minesRealRatio);

  const minePositions = generateMinePositions(mines);

  const [game] = await db.insert(minesGamesTable).values({
    playerId,
    bet,
    mines,
    minePositions: JSON.stringify(minePositions),
    revealedTiles: "[]",
    status: "playing",
    currentMultiplier: 1.0,
  }).returning();

  broadcastPlayerBalance(playerId, player.chips - bet);

  return res.json({
    gameId: game.id,
    bet: game.bet,
    mines: game.mines,
    currentMultiplier: 1.0,
    revealedTiles: [],
    minBet,
    maxBet,
  });
});

// POST /mines/reveal — reveal a tile
router.post("/reveal", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  if (isRateLimited(playerId)) {
    return res.status(429).json({ error: "Too fast — slow down" });
  }

  const { tileIndex } = req.body;
  if (typeof tileIndex !== "number" || tileIndex < 0 || tileIndex > 24) {
    return res.status(400).json({ error: "Invalid tile index" });
  }

  const [game] = await db
    .select()
    .from(minesGamesTable)
    .where(and(eq(minesGamesTable.playerId, playerId), eq(minesGamesTable.status, "playing")));

  if (!game) return res.status(400).json({ error: "No active game — start a new game first" });

  const minePositions: number[] = JSON.parse(game.minePositions);
  const revealedTiles: number[] = JSON.parse(game.revealedTiles);

  if (revealedTiles.includes(tileIndex)) {
    return res.status(400).json({ error: "Tile already revealed" });
  }

  const isMine = minePositions.includes(tileIndex);

  if (isMine) {
    // Game over — reveal all mines
    await db.update(minesGamesTable)
      .set({ status: "lost", payout: 0, revealedTiles: JSON.stringify([...revealedTiles, tileIndex]) })
      .where(eq(minesGamesTable.id, game.id));

    // Anti-cheat: log suspicious fast wins (lost right away if they'd revealed many)
    if (revealedTiles.length >= 8) {
      console.log(`[mines] anti-cheat: player ${playerId} lost on tile ${tileIndex} after ${revealedTiles.length} safe picks (bet ${game.bet})`);
    }

    return res.json({
      result: "mine",
      tileIndex,
      minePositions, // revealed on loss — safe to expose now
      revealedTiles: [...revealedTiles, tileIndex],
      payout: 0,
    });
  }

  // Safe tile
  const newRevealed = [...revealedTiles, tileIndex];
  const newMultiplier = calcMultiplier(game.mines, newRevealed.length);

  // Check if all safe tiles are revealed (auto-win)
  const safeTiles = 25 - game.mines;
  const isComplete = newRevealed.length >= safeTiles;

  if (isComplete) {
    // Auto cashout — all safe tiles found
    const payout = Math.floor(game.bet * newMultiplier);
    await db.update(minesGamesTable)
      .set({ status: "cashed_out", revealedTiles: JSON.stringify(newRevealed), currentMultiplier: newMultiplier, payout })
      .where(eq(minesGamesTable.id, game.id));

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (player) {
      await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Mines win (${game.mines} mines, ${newRevealed.length} safe) ×${newMultiplier}` });
      await trackRakebackWin(playerId, payout, minesRealRatioCache.get(playerId) ?? 0);
      minesRealRatioCache.delete(playerId);
      broadcastPlayerBalance(playerId, player.chips + payout);
    }

    return res.json({
      result: "safe",
      complete: true,
      tileIndex,
      revealedTiles: newRevealed,
      currentMultiplier: newMultiplier,
      payout,
      minePositions,
    });
  }

  await db.update(minesGamesTable)
    .set({ revealedTiles: JSON.stringify(newRevealed), currentMultiplier: newMultiplier })
    .where(eq(minesGamesTable.id, game.id));

  // Anti-cheat logging — flag improbably high win streaks
  if (newRevealed.length >= 15) {
    console.log(`[mines] anti-cheat: player ${playerId} has ${newRevealed.length} safe picks (${game.mines} mines, bet ${game.bet}, mult ${newMultiplier})`);
  }

  return res.json({
    result: "safe",
    complete: false,
    tileIndex,
    revealedTiles: newRevealed,
    currentMultiplier: newMultiplier,
  });
});

// POST /mines/cashout — cash out active game
router.post("/cashout", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const [game] = await db
    .select()
    .from(minesGamesTable)
    .where(and(eq(minesGamesTable.playerId, playerId), eq(minesGamesTable.status, "playing")));

  if (!game) return res.status(400).json({ error: "No active game to cash out" });

  const revealedTiles: number[] = JSON.parse(game.revealedTiles);
  if (revealedTiles.length === 0) {
    return res.status(400).json({ error: "You must reveal at least one tile before cashing out" });
  }

  const multiplier = game.currentMultiplier;
  const payout = Math.floor(game.bet * multiplier);

  await db.update(minesGamesTable)
    .set({ status: "cashed_out", payout, currentMultiplier: multiplier })
    .where(eq(minesGamesTable.id, game.id));

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player) {
    await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Mines cashout (${game.mines} mines, ${revealedTiles.length} safe) ×${multiplier}` });
    await trackRakebackWin(playerId, payout, minesRealRatioCache.get(playerId) ?? 0);
    minesRealRatioCache.delete(playerId);
    broadcastPlayerBalance(playerId, player.chips + payout);
  }

  const minePositions: number[] = JSON.parse(game.minePositions);

  // Track rake
  const rake = game.bet - Math.floor(game.bet / multiplier);
  if (rake > 0) {
    const current = parseInt(await getSetting("totalRakeCollected", "0"));
    await setSetting("totalRakeCollected", String(current + Math.max(0, rake)));
  }

  return res.json({
    status: "cashed_out",
    multiplier,
    payout,
    minePositions, // safe to reveal now — game is over
    revealedTiles,
  });
});

export default router;
