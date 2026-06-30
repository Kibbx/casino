import { Router } from "express";
import { db, playersTable, settingsTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  spinGrid, evaluateGrid, classifyOutcome, pickBonusMultiplier,
  simulate, SYMBOLS, CONFIG,
} from "../lib/slots-engine.js";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance, broadcastPlayerBalanceDelayed } from "../lib/table-ws.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { isPlayerGameBanned } from "./security.js";
import bcrypt from "bcryptjs";

const router = Router();


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

// ── Progressive jackpot helpers ───────────────────────────────────────────────

async function getJackpotValue(): Promise<number> {
  return parseInt(await getSetting("slotsJackpotValue", "500000"));
}

async function addToJackpot(amount: number): Promise<number> {
  const current = await getJackpotValue();
  const next = current + amount;
  await setSetting("slotsJackpotValue", String(next));
  return next;
}

async function resetJackpot(): Promise<number> {
  const seed = parseInt(await getSetting("slotsJackpotSeed", "500000"));
  await setSetting("slotsJackpotValue", String(seed));
  return seed;
}

// GET /slots/jackpot — public: live jackpot ticker
router.get("/jackpot", async (_req, res) => {
  const enabled = (await getSetting("slotsJackpotEnabled", "true")) === "true";
  const value = await getJackpotValue();
  const contrib = parseFloat(await getSetting("slotsJackpotContrib", "1"));
  const seed = parseInt(await getSetting("slotsJackpotSeed", "500000"));
  res.json({ enabled, value, contrib, seed });
});

// GET /slots/jackpot-settings — banker only
router.get("/jackpot-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("slotsJackpotEnabled", "true")) === "true";
  const value = await getJackpotValue();
  const contrib = parseFloat(await getSetting("slotsJackpotContrib", "1"));
  const seed = parseInt(await getSetting("slotsJackpotSeed", "500000"));
  res.json({ enabled, value, contrib, seed });
});

// POST /slots/jackpot-settings — banker only
router.post("/jackpot-settings", requireBanker, async (req, res) => {
  const { enabled, contrib, seed, resetNow } = req.body;
  if (enabled !== undefined) await setSetting("slotsJackpotEnabled", String(!!enabled));
  if (contrib !== undefined) {
    const pct = Math.max(0, parseFloat(contrib));
    await setSetting("slotsJackpotContrib", String(pct));
  }
  if (seed !== undefined) {
    const seedVal = Math.max(0, parseInt(seed));
    await setSetting("slotsJackpotSeed", String(seedVal));
  }
  if (resetNow) {
    await resetJackpot();
  }
  res.json({
    ok: true,
    value: await getJackpotValue(),
    enabled: (await getSetting("slotsJackpotEnabled", "true")) === "true",
    contrib: parseFloat(await getSetting("slotsJackpotContrib", "1")),
    seed: parseInt(await getSetting("slotsJackpotSeed", "500000")),
  });
});

// GET /slots/status — public
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("slotsEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("slotsMinBet", "50"));
  const maxBet = parseInt(await getSetting("slotsMaxBet", "5000"));
  const passwordHash = await getSetting("slotsPassword", "");
  res.json({
    enabled, minBet, maxBet,
    hasPassword: !!passwordHash,
    symbols: SYMBOLS.map(s => ({ id: s.id, display: s.display })),
    gridRows: CONFIG.NUM_ROWS,
    gridReels: CONFIG.NUM_REELS,
  });
});

// POST /slots/verify-password — check room password
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("slotsPassword", "");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("slotsPasswordToken", "");
  return res.json({ valid: true, token: token || null });
});

const DEFAULT_BET_STEPS = [20, 40, 100, 200, 400, 1000, 2000, 5000];
function parseBetSteps(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_BET_STEPS;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return DEFAULT_BET_STEPS;
    const nums = arr.map(Number).filter(n => n > 0 && Number.isInteger(n));
    return nums.length ? nums : DEFAULT_BET_STEPS;
  } catch { return DEFAULT_BET_STEPS; }
}
function validateBetSteps(steps: unknown): { ok: true; steps: number[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: "Steps must be an array" };
  if (steps.length < 1 || steps.length > 12) return { ok: false, error: "Steps must have 1–12 values" };
  const nums = steps.map(Number);
  if (nums.some(n => !Number.isInteger(n) || n <= 0)) return { ok: false, error: "All steps must be positive integers" };
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) return { ok: false, error: "Steps must be strictly ascending" };
  }
  return { ok: true, steps: nums };
}

// GET /slots/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("slotsEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("slotsMinBet", "50"));
  const maxBet = parseInt(await getSetting("slotsMaxBet", "5000"));
  const fortunaBetSteps = parseBetSteps(await getSetting("fortunaBetSteps"));
  const westernSlotsBetSteps = parseBetSteps(await getSetting("westernSlotsBetSteps"));
  res.json({ enabled, minBet, maxBet, fortunaBetSteps, westernSlotsBetSteps });
});

// POST /slots/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet, fortunaBetSteps, westernSlotsBetSteps } = req.body;
  await setSetting("slotsEnabled", String(!!enabled));
  await setSetting("slotsMinBet", String(minBet ?? 50));
  await setSetting("slotsMaxBet", String(maxBet ?? 5000));
  if (fortunaBetSteps !== undefined) {
    const v = validateBetSteps(fortunaBetSteps);
    if (!v.ok) return res.status(400).json({ error: v.error });
    await setSetting("fortunaBetSteps", JSON.stringify(v.steps));
  }
  if (westernSlotsBetSteps !== undefined) {
    const v = validateBetSteps(westernSlotsBetSteps);
    if (!v.ok) return res.status(400).json({ error: v.error });
    await setSetting("westernSlotsBetSteps", JSON.stringify(v.steps));
  }
  const fortunaOut = parseBetSteps(await getSetting("fortunaBetSteps"));
  const westernOut = parseBetSteps(await getSetting("westernSlotsBetSteps"));
  res.json({ enabled: !!enabled, minBet: minBet ?? 50, maxBet: maxBet ?? 5000, fortunaBetSteps: fortunaOut, westernSlotsBetSteps: westernOut });
});

// GET /slots/simulate?spins=10000&bet=100 — RTP simulation using live odds mode
router.get("/simulate", requireBanker, async (req, res) => {
  const spins    = Math.min(parseInt(String(req.query.spins ?? "10000")), 500_000);
  const bet      = Math.max(1, parseInt(String(req.query.bet ?? "100")));
  const oddsMode = await getSetting("slotsOddsMode", "standard");
  const result   = simulate(spins, bet, 1.0, oddsMode);
  res.json({ ...result, oddsMode });
});

// ── Payout helper ─────────────────────────────────────────────────────────────

async function applyPayout(
  playerId: number,
  rawPayout: number,
  outcome: string,
  reelLabel: string,
) {
  // Payout is already odds-adjusted at spin time — no rake, no post-processing
  const finalPayout = rawPayout;

  const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  await db.update(playersTable).set({ chips: fresh.chips + finalPayout }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId, amount: finalPayout, type: "win",
    description: `Slots win (${outcome}) — ${reelLabel}`,
  });

  return { finalPayout, rake: 0 };
}

// ── POST /slots/spin ──────────────────────────────────────────────────────────

router.post("/spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const banCheck = await isPlayerGameBanned(playerId, "slots");
  if (banCheck.banned) {
    return res.status(403).json({ error: `You are banned from Slots${banCheck.reason ? ": " + banCheck.reason : ""}` });
  }

  const { bet } = req.body;
  if (!bet || bet <= 0) return res.status(400).json({ error: "bet is required" });

  const enabled = (await getSetting("slotsEnabled", "false")) === "true";
  if (!enabled) return res.status(403).json({ error: "Slot machines are currently closed" });

  const minBet = parseInt(await getSetting("slotsMinBet", "50"));
  const maxBet = parseInt(await getSetting("slotsMaxBet", "5000"));
  if (bet < minBet || bet > maxBet) {
    return res.status(400).json({ error: `Bet must be between ${minBet} and ${maxBet} chips` });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  // Block regular spins while the player has pending bonus spins — prevents
  // stacking bonus triggers from parallel requests (bonus-in-bonus exploit)
  if ((player.bonusSpins ?? 0) > 0) {
    return res.status(400).json({ error: "You have pending free spins — complete your bonus round first" });
  }

  recordPlayerActivity(playerId, player.username, "slots", true);

  // Deduct bet
  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Slots bet" });
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  // Spin — odds mode controls symbol frequency
  const oddsMode = await getSetting("slotsOddsMode", "standard");
  const grid = spinGrid(false, oddsMode);
  const result = evaluateGrid(grid, bet, 1, true);
  const reelLabel = grid.map(col => col.join("-")).join(" | ");

  // ── Progressive jackpot ────────────────────────────────────────────────────
  const jackpotEnabled = (await getSetting("slotsJackpotEnabled", "true")) === "true";
  let jackpotWon = false;
  let jackpotAmount = 0;
  let jackpotNewValue = 0;

  if (jackpotEnabled) {
    // Contribution: a % of every bet feeds the pool
    const contrib = parseFloat(await getSetting("slotsJackpotContrib", "1"));
    const contribution = Math.floor(bet * contrib / 100);
    if (contribution > 0) jackpotNewValue = await addToJackpot(contribution);

    // Trigger: all 5 middle-row symbols must be literal sevens — no wilds substituting
    const middleRow = grid.map(col => col[1]);
    const isJackpotHit = middleRow.length === 5 && middleRow.every(sym => sym === "seven");
    if (isJackpotHit) {
      jackpotAmount = await getJackpotValue();
      await resetJackpot();
      jackpotWon = true;
      const [freshJP] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      await db.update(playersTable)
        .set({ chips: freshJP.chips + jackpotAmount })
        .where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({
        playerId, amount: jackpotAmount, type: "win",
        description: `🎰 PROGRESSIVE JACKPOT — ${jackpotAmount.toLocaleString()} chips`,
      });
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  let finalPayout = 0;
  let rake = 0;
  if (result.totalPayout > 0) {
    ({ finalPayout, rake } = await applyPayout(playerId, result.totalPayout, result.outcome, reelLabel));
  }

  // Store bonus spin credits if scatter-triggered — multiplier picked SERVER-SIDE
  if (result.bonusSpinsAwarded > 0) {
    const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    const serverBonusMult = pickBonusMultiplier(); // NOT from client
    await db.update(playersTable).set({
      bonusSpins: (fresh.bonusSpins ?? 0) + result.bonusSpinsAwarded,
      bonusBet: bet,
      bonusMult: serverBonusMult,
    }).where(eq(playersTable.id, playerId));
  }

  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 2500);

  return res.json({
    grid,                                   // string[][] — 5×3
    reels: grid.map(col => col[1]),         // backward compat: middle row
    wins: result.wins,
    basePayout: result.basePayout,
    spinMultiplier: result.spinMultiplier,
    bonusMultiplier: 1,
    rawPayout: result.totalPayout,
    rake,
    payout: finalPayout,
    outcome: result.outcome,
    scatterCount: result.scatterCount,
    bonusCount: result.bonusSpinsAwarded > 0 ? 1 : 0,  // backward compat flag
    bonusSpinsAwarded: result.bonusSpinsAwarded,
    // Return the server-assigned bonus multiplier so the client displays correctly
    serverBonusMult: result.bonusSpinsAwarded > 0 ? (updatedPlayer.bonusMult ?? 2) : undefined,
    playerChips: updatedPlayer.chips,
    multiplier: result.spinMultiplier,      // backward compat
    // Progressive jackpot
    jackpotWon,
    jackpotAmount,
    jackpotValue: jackpotNewValue || (await getJackpotValue()),
  });
});

// In-memory rate limiter: track last bonus-spin timestamp per player
const bonusSpinLastCall = new Map<number, number>();

// ── POST /slots/bonus-spin ────────────────────────────────────────────────────

router.post("/bonus-spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  // Rate limit: max one bonus spin per 300ms per player
  const now = Date.now();
  const lastCall = bonusSpinLastCall.get(playerId) ?? 0;
  if (now - lastCall < 300) {
    return res.status(429).json({ error: "Too many requests — slow down" });
  }
  bonusSpinLastCall.set(playerId, now);

  const enabled = (await getSetting("slotsEnabled", "false")) === "true";
  if (!enabled) return res.status(403).json({ error: "Slot machines are currently closed" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if ((player.bonusSpins ?? 0) <= 0) return res.status(400).json({ error: "No bonus spins remaining" });

  const bet = player.bonusBet ?? 0;
  const remaining = (player.bonusSpins ?? 0) - 1;

  // SECURITY: multiplier is ALWAYS taken from the DB record, never from the client.
  // The client-provided value is completely ignored.
  const bonusMultiplier = Math.min(
    Math.max(1, player.bonusMult ?? CONFIG.BONUS_MULT_MIN),
    CONFIG.BONUS_MULT_MAX,
  );

  // Consume one credit
  await db.update(playersTable).set({ bonusSpins: remaining }).where(eq(playersTable.id, playerId));
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  // Spin with boosted wilds, no extra spin multiplier (the bonus mult is the excitement driver)
  const oddsMode = await getSetting("slotsOddsMode", "standard");
  const grid = spinGrid(true, oddsMode);
  const result = evaluateGrid(grid, bet, bonusMultiplier, false);
  const reelLabel = grid.map(col => col.join("-")).join(" | ");

  // Bonus retrigger: if scatters land during free spins, award extra spins —
  // but cap the total remaining at 30 so it can never become unlimited.
  const MAX_BONUS_SPINS = 30;
  let extraSpinsAwarded = 0;
  if (result.bonusSpinsAwarded > 0) {
    const spaceLeft = Math.max(0, MAX_BONUS_SPINS - remaining);
    extraSpinsAwarded = Math.min(result.bonusSpinsAwarded, spaceLeft);
    if (extraSpinsAwarded > 0) {
      await db.update(playersTable)
        .set({ bonusSpins: remaining + extraSpinsAwarded })
        .where(eq(playersTable.id, playerId));
    }
  }
  const finalRemaining = remaining + extraSpinsAwarded;

  let finalPayout = 0;
  let rake = 0;
  if (result.totalPayout > 0) {
    ({ finalPayout, rake } = await applyPayout(playerId, result.totalPayout, result.outcome, reelLabel));
  }

  const [updatedPlayer] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalanceDelayed(playerId, Number(updatedPlayer.chips), 2500);

  return res.json({
    grid,
    reels: grid.map(col => col[1]),
    wins: result.wins,
    basePayout: result.basePayout,
    spinMultiplier: 1,
    bonusMultiplier,
    rawPayout: result.totalPayout,
    rake,
    payout: finalPayout,
    outcome: result.outcome,
    scatterCount: result.scatterCount,
    bonusSpinsAwarded: extraSpinsAwarded,
    bonusSpinsRemaining: finalRemaining,
    playerChips: updatedPlayer.chips,
    multiplier: bonusMultiplier,
  });
});

export default router;
