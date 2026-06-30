import { Router } from "express";
import { db, horsesTable, horseRaceBetsTable, playersTable, transactionsTable, settingsTable, houseFinancesTable } from "@workspace/db";
import { eq, ilike, inArray, and, lte, isNull, isNotNull, sql } from "drizzle-orm";
import { requirePlayer, requireBanker, requireBankerOrOwner } from "../middleware/auth.js";
import { broadcastAll, broadcastPlayerBalance } from "../lib/table-ws.js";
import bcrypt from "bcryptjs";
import { checkVerifyPasswordLocked, recordVerifyPasswordFailure, clearVerifyPasswordFailures } from "../lib/sessions.js";
import { randomUUID } from "crypto";

const router = Router();

// ── Settings helpers ───────────────────────────────────────────────────────

async function getSetting(key: string, fallback = ""): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}
async function setSetting(key: string, value: string | null) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (value === null) {
    if (existing.length) await db.delete(settingsTable).where(eq(settingsTable.key, key));
    return;
  }
  if (existing.length === 0) await db.insert(settingsTable).values({ key, value });
  else await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
}

// Persist the race queue to the DB so it survives server restarts
async function persistQueue() {
  try {
    await setSetting("horse_race_queue", JSON.stringify(raceQueue));
  } catch (e) {
    console.error("[horse-racing] Failed to persist queue:", e);
  }
}

// GET /horse/banker-settings — banker only
router.get("/horse/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("horseEnabled", "true")) === "true";
  const minBet  = parseInt(await getSetting("horseMinBet", "10"));
  const maxBet  = parseInt(await getSetting("horseMaxBet", "50000"));
  const hasPassword = !!(await getSetting("horsePassword"));
  res.json({ enabled, minBet, maxBet, hasPassword });
});

// POST /horse/banker-settings — banker only
router.post("/horse/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  const newEnabled = enabled !== false;
  const newMinBet  = Math.max(1, parseInt(minBet) || 10);
  const newMaxBet  = Math.max(1, parseInt(maxBet) || 50000);
  await setSetting("horseEnabled", String(newEnabled));
  await setSetting("horseMinBet", String(newMinBet));
  await setSetting("horseMaxBet", String(newMaxBet));
  res.json({ enabled: newEnabled, minBet: newMinBet, maxBet: newMaxBet });
});

// POST /horse/verify-password — player room password check
router.post("/horse/verify-password", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
  if (checkVerifyPasswordLocked(ip)) return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("horsePassword");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) { recordVerifyPasswordFailure(ip); return res.status(403).json({ error: "Incorrect room password" }); }
  clearVerifyPasswordFailures(ip);
  const token = await getSetting("horsePasswordToken");
  return res.json({ valid: true, token: token || null });
});

// ── Types ─────────────────────────────────────────────────────────────────

interface RaceHorse {
  id: number;
  name: string;
  odds: number;
  weight: number;
  ownerId: number | null;
  ownerName: string | null;
  ownerCut: number;
  variantId: number;
  totalEarnings: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  baseSpriteKey: string | null;
  animFrames: string | null;
  animFps: number;
  effectType: string;
  glowColor: string | null;
  outlineColor: string | null;
  tackColor: string | null;
  rarity: string;
  speed: number;
  stamina: number;
  acceleration: number;
  luck: number;
}

interface BetRecord {
  playerId: number;
  horseId: number;
  amount: number;
}

interface QueuedRace {
  queueId: string;
  scheduledTime: number;    // epoch ms — when race auto-starts
  bettingOpensAt: number;   // epoch ms — when betting opens
  bettingClosesAt: number;  // epoch ms — when betting auto-closes and race auto-starts
  horses: RaceHorse[];
  advanceBets: BetRecord[]; // bets placed while race is still in queue
  priority: boolean;
  type: "manual" | "auto";
  createdAt: number;
}

interface RaceState {
  raceId: number;
  status: "idle" | "scheduled" | "betting" | "running" | "finished";
  horses: RaceHorse[];
  startTime: number | null;        // scheduled start time (epoch ms)
  startedAt: number | null;        // when race actually began running
  delayMs: number | null;          // how many ms past scheduled start time it actually started
  bettingOpensAt: number | null;   // when betting opened (for queue-driven races)
  bettingClosesAt: number | null;  // when betting auto-closes and race auto-starts
  winner: RaceHorse | null;
  bets: BetRecord[];
  queueId: string | null;          // which queue entry this race came from
}

// ── In-memory race state ───────────────────────────────────────────────────

const RACE_DURATION_MS     = 145_000; // safety-net timeout — tick engine finishes first
const TICK_RATE_MS         = 200;     // broadcast every 200 ms
const TOTAL_TICKS          = 675;     // 675 × 200 ms = 135 s max
const TICK_SCALE           = 0.38;
const ENERGY_FLOOR         = 12;
const PROMOTION_WINDOW_MS  = 3 * 60_000; // only promote queued races within 3 min of scheduled start

let raceAutoFinishTimer:  ReturnType<typeof setTimeout> | null = null;
let raceTickInterval:     ReturnType<typeof setInterval> | null = null;
let resultsResetTimer:    ReturnType<typeof setTimeout> | null = null;
const RESULTS_DISPLAY_MS = 30_000;

// Live positions (0–100) per horse id
const racePositions:    Record<number, number>  = {};
const raceUncapped:     Record<number, number>  = {};
const horseEnergy:      Record<number, number>  = {};

// ── Probabilistic race engine state ───────────────────────────────────────
/** Per-race variance set once at race start — "how the horse feels today" */
const perRaceVariance:  Record<number, number>  = {};

/** Active temporary events per horse: { boost: fraction, ticksLeft } */
const activeEvents:     Record<number, Array<{ boost: number; ticksLeft: number }>> = {};

/** Win-streak tracker — persists between races, causes increasing fatigue penalty */
const horseWinStreak:   Record<number, number>  = {};

/**
 * Normalized stats per horse, computed once per race.
 * Each stat is horse_stat / average_stat_across_race_field.
 * Then Math.pow(normalizedStat, 0.6) and clamped to [0.85, 1.15]
 * so stats contribute at most ±15% to performance.
 */
const normalizedStatEffect: Record<number, { speed: number; accel: number; stamina: number }> = {};

// ── Layer: Form State ──────────────────────────────────────────────────────
/** Current form multiplier: randomBetween(0.85, 1.15). Re-rolled periodically. */
const horseFormState:    Record<number, number> = {};
/** Ticks remaining before form is re-rolled. */
const horseFormDuration: Record<number, number> = {};

// ── Layer: Momentum ────────────────────────────────────────────────────────
/** Momentum per horse: clamp(-0.15, +0.15). Grows when gaining positions. */
const horseMomentum:     Record<number, number> = {};
/** Position from previous tick (for momentum delta). */
const horsePrevPos:      Record<number, number> = {};

// ── Layer: Leader Fatigue ──────────────────────────────────────────────────
/** How many consecutive ticks each horse has held 1st place. */
const horseTimeInLead:   Record<number, number> = {};
/** Active fatigue penalty for current leader (0 if not fatigued). */
const horseLeaderFatigue: Record<number, number> = {};

// ── Layer: Performance Drift ───────────────────────────────────────────────
/** Drift multiplier per horse: randomBetween(0.9, 1.1), refreshed every 50–100 ticks. */
const horseDrift:           Record<number, number> = {};
/** Tick at which each horse's drift next re-rolls. */
const horseDriftNextAt:     Record<number, number> = {};

// ── Soft probability boost ─────────────────────────────────────────────────
/**
 * Horse selected via capped weighted random before each race.
 * Receives a small 2–5% tick boost — does NOT guarantee a win.
 * null when no race is running.
 */
let softBoostTargetId: number | null = null;

let currentTick = 0;

function rng(min: number, max: number) {
  return min + Math.random() * (max - min);
}

/**
 * Pre-race soft boost selection.
 *
 * Scores each horse, normalizes into win chances, hard-caps at 30%, then
 * re-normalizes and picks one horse via weighted random to receive a small
 * 2–5% tick boost. Does NOT guarantee that horse wins — it only slightly
 * nudges outcomes toward a more statistically balanced spread.
 */
function selectSoftBoostTarget(horses: RaceHorse[]): number | null {
  if (horses.length === 0) return null;

  // 1. Raw score
  const scores = horses.map((h) => ({
    id: h.id,
    name: h.name,
    score: h.speed * 0.35 + h.stamina * 0.25 + h.acceleration * 0.20 + h.luck * 0.20,
  }));

  // 2. Normalize to win chances
  const totalScore = scores.reduce((s, x) => s + x.score, 0);
  const chances = scores.map((x) => ({ ...x, chance: totalScore > 0 ? x.score / totalScore : 1 / horses.length }));

  // 3. Hard-cap at 30%
  const capped = chances.map((x) => ({ ...x, chance: Math.min(x.chance, 0.30) }));

  // 4. Re-normalize after cap
  const cappedTotal = capped.reduce((s, x) => s + x.chance, 0);
  const normalized  = capped.map((x) => ({ ...x, chance: x.chance / cappedTotal }));

  // 5. Weighted random selection
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of normalized) {
    cumulative += entry.chance;
    if (roll < cumulative) {
      console.log(`[SoftBoost] Target selected: ${entry.name} (chance: ${(entry.chance * 100).toFixed(1)}%)`);
      return entry.id;
    }
  }
  const fallback = normalized[normalized.length - 1];
  return fallback?.id ?? null;
}

function clearRaceTimer() {
  if (raceAutoFinishTimer) { clearTimeout(raceAutoFinishTimer); raceAutoFinishTimer = null; }
}
function clearRaceInterval() {
  if (raceTickInterval) { clearInterval(raceTickInterval); raceTickInterval = null; }
}
function clearResultsTimer() {
  if (resultsResetTimer) { clearTimeout(resultsResetTimer); resultsResetTimer = null; }
}

/**
 * Rarity modifier — extremely tight (0.985–1.005).
 * Rarity is flavor, not performance. Stats + variance decide races.
 */
function rarityMovementModifier(rarity: string): number {
  switch (rarity) {
    case "legendary": return 0.985;
    case "epic":      return 0.990;
    case "rare":      return 0.995;
    case "uncommon":  return 1.000;
    default:          return 1.005; // common
  }
}

/**
 * Clamp x to [lo, hi].
 */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Compute normalized stat effects for the race field.
 * Each horse's stat is divided by the field average, then Math.pow(0.6)
 * and clamped to [0.92, 1.08] — so stats give at most ±8% advantage.
 * Race-day variance (±28%) is the dominant outcome factor; stats inform odds,
 * not guarantees.
 */
function computeNormalizedStats(horses: RaceHorse[]): void {
  if (horses.length === 0) return;

  const avgSpeed   = horses.reduce((s, h) => s + h.speed, 0) / horses.length;
  const avgAccel   = horses.reduce((s, h) => s + h.acceleration, 0) / horses.length;
  const avgStamina = horses.reduce((s, h) => s + h.stamina, 0) / horses.length;

  for (const h of horses) {
    const normSpeed   = avgSpeed   > 0 ? h.speed   / avgSpeed   : 1;
    const normAccel   = avgAccel   > 0 ? h.acceleration / avgAccel   : 1;
    const normStamina = avgStamina > 0 ? h.stamina / avgStamina : 1;

    normalizedStatEffect[h.id] = {
      speed:   clamp(Math.pow(normSpeed,   0.6), 0.92, 1.08),
      accel:   clamp(Math.pow(normAccel,   0.6), 0.92, 1.08),
      stamina: clamp(Math.pow(normStamina, 0.6), 0.92, 1.08),
    };
  }

  console.log("[Race] Normalized stat effects:", Object.fromEntries(
    horses.map((h) => [h.name, normalizedStatEffect[h.id]])
  ));
}

function tickRace() {
  if (raceState.status !== "running") { clearRaceInterval(); return; }
  currentTick++;
  const progressRatio = Math.min(1, currentTick / TOTAL_TICKS);

  // Race phase
  const phase = progressRatio < 0.20 ? "start" : progressRatio < 0.80 ? "mid" : "final";

  // Pack compression anchor — current average position across the field
  const avgPos = raceState.horses.reduce((sum, h) => sum + (racePositions[h.id] ?? 0), 0)
    / raceState.horses.length;

  // Determine current leader for leader-fatigue tracking
  const leaderId = raceState.horses.reduce((bestId, h) => {
    const p = racePositions[h.id] ?? 0;
    return p > (racePositions[bestId] ?? 0) ? h.id : bestId;
  }, raceState.horses[0]?.id ?? -1);

  for (const horse of raceState.horses) {
    const pos = racePositions[horse.id] ?? 0;
    if (pos >= 100) continue;

    const nse = normalizedStatEffect[horse.id] ?? { speed: 1, accel: 1, stamina: 1 };

    // ── 1. Stat contribution — normalized + clamped, ≤ ±15% additive ─────
    let statAdditive: number;
    if (phase === "start") {
      statAdditive = nse.accel - 1.0;
    } else if (phase === "mid") {
      statAdditive = nse.speed - 1.0;
    } else {
      const energyRatio = (horseEnergy[horse.id] ?? 100) / 100;
      statAdditive = (nse.stamina - 1.0) * energyRatio;
    }

    // ── 2. Energy drain (mid + final only) ───────────────────────────────
    if (phase !== "start") {
      const energy = horseEnergy[horse.id] ?? 100;
      const drain  = (horse.speed / 100) * (1 - (horse.stamina / 100) * 0.6) * 0.30;
      const regen  = currentTick % 35 === 0 ? (horse.stamina / 100) * 3 : 0;
      horseEnergy[horse.id] = Math.min(100, Math.max(ENERGY_FLOOR, energy - drain + regen));
    }

    // ── 3. Day variance (set once at start) ──────────────────────────────
    const dayVariance = perRaceVariance[horse.id] ?? 0;

    // ── NEW: Form state — re-rolls every 40–120 ticks ────────────────────
    let formDur = horseFormDuration[horse.id] ?? 1;
    formDur--;
    if (formDur <= 0) {
      horseFormState[horse.id]    = rng(0.72, 1.28);
      horseFormDuration[horse.id] = Math.round(rng(40, 120));
    } else {
      horseFormDuration[horse.id] = formDur;
    }
    const formState = horseFormState[horse.id] ?? 1.0;

    // ── Per-tick variance — zero-mean ±40%, luck widens range slightly ──────
    // Both underdogs and favorites get the same symmetric variance.
    // Upsets come from form state, momentum, drift, and events — not biased variance.
    const avgNormStat = (nse.speed + nse.accel + nse.stamina) / 3;
    const isUnderdog  = avgNormStat < 1.0; // kept for reference by other layers
    const luckBonus   = (horse.luck / 100) * rng(0, 0.06);
    const tickVariance = rng(-0.40, 0.40) + luckBonus; // zero-mean, large swings

    // ── NEW: Momentum — position gain/loss drives momentum ────────────────
    const prevPos = horsePrevPos[horse.id] ?? pos;
    const posDelta = pos - prevPos;
    let momentum = horseMomentum[horse.id] ?? 0;
    if (posDelta > 0) {
      momentum = clamp(momentum + 0.02, -0.15, 0.15);
    } else if (posDelta < 0) {
      momentum = clamp(momentum - 0.02, -0.15, 0.15);
    }
    horseMomentum[horse.id] = momentum;
    horsePrevPos[horse.id]  = pos;

    // ── 4. Event system — stacking, multiplicative ────────────────────────
    // Drain existing events, compute multiplicative product
    const events = activeEvents[horse.id] ?? [];
    // Collect multiplier from all active events this tick
    const eventMult = events.reduce((prod, e) => prod * (1 + e.boost), 1.0);
    // Decrement and remove expired events (NEW events stack, do NOT replace old ones)
    activeEvents[horse.id] = events
      .map((e) => ({ ...e, ticksLeft: e.ticksLeft - 1 }))
      .filter((e) => e.ticksLeft > 0);

    // Roll for a new event (can overlap existing events)
    const eventChance = 0.10 + (horse.luck * 0.0008);
    if (Math.random() < eventChance) {
      const roll = Math.random();
      if (roll < 0.30) {
        activeEvents[horse.id].push({ boost: 0.08, ticksLeft: 8 });
        console.log(`[Event] ${horse.name}: clean_stride`);
      } else if (roll < 0.58) {
        activeEvents[horse.id].push({ boost: -0.10, ticksLeft: 8 });
        console.log(`[Event] ${horse.name}: stumble`);
      } else if (roll < 0.74 && phase === "final") {
        activeEvents[horse.id].push({ boost: 0.15, ticksLeft: 15 });
        console.log(`[Event] ${horse.name}: second_wind`);
      } else {
        const surgeBoost = rng(0.05, 0.20);
        activeEvents[horse.id].push({ boost: surgeBoost, ticksLeft: 6 });
        console.log(`[Event] ${horse.name}: lucky_surge +${(surgeBoost * 100).toFixed(1)}%`);
      }
    }

    // ── 5. Pack compression — rubber-band (2–5%) ─────────────────────────
    let packAdjust = 0;
    const gap = pos - avgPos;
    if (gap > 5) {
      packAdjust = -rng(0.02, 0.05);
    } else if (gap < -5) {
      packAdjust = rng(0.02, 0.05);
    }

    // ── 6. Anti-streak penalty — 10% per consecutive win ─────────────────
    const streakPenalty = (horseWinStreak[horse.id] ?? 0) * 0.10;

    // ── NEW: Leader fatigue — penalty when holding 1st for too long ───────
    let leaderFatigue = 0;
    if (horse.id === leaderId) {
      horseTimeInLead[horse.id] = (horseTimeInLead[horse.id] ?? 0) + 1;
      // Fatigue kicks in after 60 consecutive ticks in the lead (~12 seconds)
      if ((horseTimeInLead[horse.id] ?? 0) > 60) {
        leaderFatigue = rng(0.05, 0.10);
      }
    } else {
      // Reset when no longer leading
      horseTimeInLead[horse.id] = 0;
    }
    horseLeaderFatigue[horse.id] = leaderFatigue;

    // ── NEW: Performance drift — long-wave fluctuation ────────────────────
    if (currentTick >= (horseDriftNextAt[horse.id] ?? 0)) {
      horseDrift[horse.id]       = rng(0.90, 1.10);
      horseDriftNextAt[horse.id] = currentTick + Math.round(rng(50, 100));
    }
    const drift = horseDrift[horse.id] ?? 1.0;

    // ── 7. Rarity — flavor only ───────────────────────────────────────────
    const rarityMod = rarityMovementModifier(horse.rarity);

    // ── NEW: Soft probability boost (2–5% nudge for pre-selected target) ──
    // Does NOT guarantee a win — just slightly increases this horse's tick speed.
    const softBoost = horse.id === softBoostTargetId ? rng(1.02, 1.05) : 1.0;

    // ── 8. Final performance (multiplicative layers on additive core) ─────
    //
    // Additive core: base 1.0 + stat (±15%) + day-offset + pack + streak
    // Then multiply: formState × (1+momentum) × (1+variance) × events × drift × leaderFatigue × softBoost
    //
    const additiveCore = 1.0
      + statAdditive    // ±15% (normalized, clamped)
      + dayVariance     // one-time ±5% offset
      + packAdjust      // ±2–5% rubber-band
      - streakPenalty;  // −5% per consecutive win

    const performance = additiveCore
      * formState              // 0.85–1.15 (re-rolls every 40–120 ticks)
      * (1 + momentum)         // −15% to +15% momentum
      * (1 + tickVariance)     // large tick noise (underdog-biased)
      * eventMult              // stacked event multipliers
      * drift                  // 0.90–1.10 long-wave fluctuation
      * (1 - leaderFatigue)    // 0–10% penalty for sustained lead
      * softBoost;             // 2–5% nudge toward probability-selected target

    const delta = Math.max(0, performance * TICK_SCALE * rarityMod);

    const uncapped = pos + delta;
    raceUncapped[horse.id]  = uncapped;
    racePositions[horse.id] = Math.min(100, uncapped);
  }

  // Broadcast live positions
  broadcastAll({
    type: "race_update",
    horses: raceState.horses.map((h) => ({ id: h.id, position: racePositions[h.id] ?? 0 })),
  });

  // Check finish
  const finished = raceState.horses.filter((h) => (racePositions[h.id] ?? 0) >= 100);
  if (finished.length > 0 && !raceState.winner) {
    const winner = finished.reduce((best, h) =>
      (raceUncapped[h.id] ?? 100) > (raceUncapped[best.id] ?? 100) ? h : best,
    );
    raceState = { ...raceState, winner };
    clearRaceInterval();
    void doFinishRace();
    return;
  }

  // Fallback: max ticks reached
  if (currentTick >= TOTAL_TICKS && !raceState.winner) {
    const leader = raceState.horses.reduce((best, h) =>
      (raceUncapped[h.id] ?? 0) > (raceUncapped[best.id] ?? 0) ? h : best,
    );
    raceState = { ...raceState, winner: leader };
    clearRaceInterval();
    void doFinishRace();
  }
}

let raceState: RaceState = {
  raceId: 0,
  status: "idle",
  horses: [],
  startTime: null,
  startedAt: null,
  delayMs: null,
  bettingOpensAt: null,
  bettingClosesAt: null,
  winner: null,
  bets: [],
  queueId: null,
};

// ── Race Queue ─────────────────────────────────────────────────────────────
let raceQueue: QueuedRace[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Owner cut based on rarity: rarer horses earn their owners a larger slice. */
function ownerCutFromRarity(rarity: string): number {
  switch (rarity) {
    case "legendary": return 0.08; // 8 %
    case "epic":      return 0.05; // 5 %
    case "rare":      return 0.03; // 3 %
    case "uncommon":  return 0.02; // 2 %
    default:          return 0.01; // common: 1 %
  }
}

function computeAvgStat(speed: number, stamina: number, acceleration: number, luck: number): number {
  return Math.round((speed + stamina + acceleration + luck) / 4);
}

function horseBetStats(horses: RaceHorse[], bets: BetRecord[]) {
  const totalPool = bets.reduce((s, b) => s + b.amount, 0);
  return horses.map((h) => {
    const horseBets = bets.filter((b) => b.horseId === h.id);
    const horsePool = horseBets.reduce((s, b) => s + b.amount, 0);
    // Payout pool depends on whether this horse is owned:
    //   owned   → 5% house + 10% owner = 85% to bettors
    //   unowned → 5% house only        = 95% to bettors
    const payoutFactor = h.ownerId != null ? 0.85 : 0.95;
    const payoutPool = totalPool * payoutFactor;
    // Live odds: estimated return per chip bet (e.g. 3.20 means 3.20× your bet returned)
    const liveOdds = horsePool > 0 ? Math.round((payoutPool / horsePool) * 100) / 100 : null;
    return { ...h, totalBets: horsePool, horsePool, totalPool, liveOdds };
  });
}

let resultsUntilMs: number | null = null; // set when entering "finished" state

function broadcastRaceState() {
  broadcastAll({
    type: "horse_race_update",
    race: {
      raceId:          raceState.raceId,
      status:          raceState.status,
      startTime:       raceState.startTime,
      startedAt:       raceState.startedAt,
      delayMs:         raceState.delayMs,
      isDelayed:       (raceState.delayMs ?? 0) > 30_000,
      bettingOpensAt:  raceState.bettingOpensAt,
      bettingClosesAt: raceState.bettingClosesAt,
      elapsedMs:       raceState.startedAt ? Math.max(0, Date.now() - raceState.startedAt) : null,
      winner:          raceState.status === "finished" ? raceState.winner : null,
      horses:          horseBetStats(raceState.horses, raceState.bets),
      positions:       { ...racePositions }, // live positions (0–100) per horse id
      resultsUntil:    raceState.status === "finished" ? resultsUntilMs : null,
      queueLength:     raceQueue.length,
    },
  });
}

/** Returns only horses that have a valid owner and can enter races. */
async function getEligibleRaceHorses() {
  return db.select().from(horsesTable).where(isNotNull(horsesTable.ownerId));
}

/**
 * Returns horse IDs already committed to existing queued races or the active race.
 * Used to prevent the same horse appearing in multiple concurrent race pools.
 */
function reservedHorseIds(): Set<number> {
  const ids = new Set<number>();
  for (const entry of raceQueue) for (const h of entry.horses) ids.add(h.id);
  if (raceState.status !== "idle") for (const h of raceState.horses) ids.add(h.id);
  return ids;
}

async function selectRaceHorses(excludeIds: Set<number> = new Set()): Promise<RaceHorse[]> {
  // Only owned horses are eligible — unowned / unsold horses cannot enter races.
  const eligible = await getEligibleRaceHorses();

  // Exclude horses already reserved for other concurrent races
  const pool = eligible.filter(h => !excludeIds.has(h.id));

  if (pool.length < 6) {
    const total = eligible.length;
    throw new Error(
      `Not enough available horses (need 6, ${pool.length} free out of ${total} owned — others are reserved for upcoming races)`
    );
  }

  // Shuffle eligible pool and pick 6
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 6);

  // Resolve owner names in one query
  const ownerIds = [...new Set(selected.filter((h) => h.ownerId != null).map((h) => h.ownerId!))];
  const ownerMap = new Map<number, string>();
  if (ownerIds.length > 0) {
    const owners = await db
      .select({ id: playersTable.id, username: playersTable.username })
      .from(playersTable)
      .where(inArray(playersTable.id, ownerIds));
    for (const o of owners) ownerMap.set(o.id, o.username);
  }

  return selected.map((h, idx) => ({
    id: h.id,
    name: h.name,
    odds: h.odds,
    weight: h.weight,
    ownerId: h.ownerId ?? null,
    ownerName: h.ownerId != null ? (ownerMap.get(h.ownerId) ?? null) : null,
    ownerCut: ownerCutFromRarity(h.rarity ?? "common"), // always rarity-based at race time
    variantId: h.variantId,
    totalEarnings: h.totalEarnings,
    visualBase: h.visualBase ?? "brown",
    visualPattern: h.visualPattern ?? "none",
    visualFlair: h.visualFlair ?? "none",
    baseSpriteKey: h.baseSpriteKey ?? null,
    animFrames: h.animFrames ?? null,
    animFps: h.animFps ?? 12,
    effectType: h.effectType ?? "none",
    glowColor: h.glowColor ?? null,
    outlineColor: h.outlineColor ?? null,
    tackColor: h.tackColor ?? null,
    laneNumber: idx + 1,
    rarity: h.rarity ?? "common",
    speed: h.speed ?? 50,
    stamina: h.stamina ?? 50,
    acceleration: h.acceleration ?? 50,
    luck: h.luck ?? 50,
  }));
}

async function creditOwner(winner: RaceHorse, amount: number, description: string) {
  if (!winner.ownerId || amount <= 0) return;
  const rows = await db.select().from(playersTable).where(eq(playersTable.id, winner.ownerId));
  if (!rows.length) return;
  const newChips = Number(rows[0].chips) + amount;
  await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, winner.ownerId));
  // Re-fetch current totalEarnings to avoid stale value from race snapshot
  const horseRows = await db.select({ totalEarnings: horsesTable.totalEarnings }).from(horsesTable).where(eq(horsesTable.id, winner.id));
  const currentEarnings = Number(horseRows[0]?.totalEarnings ?? 0);
  await db.update(horsesTable)
    .set({ totalEarnings: currentEarnings + amount })
    .where(eq(horsesTable.id, winner.id));
  await db.insert(transactionsTable).values({
    playerId: winner.ownerId, type: "win", amount, description,
  });
  broadcastPlayerBalance(winner.ownerId, newChips);
}

/** Log house rake to finance table for auditing. source "game_rake" is display-only
 *  (not counted in crateBalance since rake is already implicit in chip flow). */
async function logHouseRake(amount: number, reason: string) {
  if (amount <= 0) return;
  await db.insert(houseFinancesTable).values({
    source: "game_rake",
    type: "deposit",
    amount,
    reason,
    staffUsername: "system",
  });
}

async function payoutParimutuel(winner: RaceHorse) {
  const allBets = raceState.bets;
  const totalPool = allBets.reduce((s, b) => s + b.amount, 0);
  if (totalPool === 0) return;

  const winBets = allBets.filter((b) => b.horseId === winner.id);
  const totalWinningPool = winBets.reduce((s, b) => s + b.amount, 0);

  if (totalWinningPool === 0) {
    // ── CASE B: No bets on the winning horse ────────────────────────────
    // 50% to owner (if owned), 50% to house
    const ownerAmt = winner.ownerId ? Math.floor(totalPool * 0.50) : 0;
    const houseAmt = totalPool - ownerAmt;
    await creditOwner(winner, ownerAmt,
      `Horse owner bonus (no winning bets) — ${winner.name} race #${raceState.raceId} — 50% of ${totalPool.toLocaleString()} pool`);
    await logHouseRake(houseAmt,
      `Horse race #${raceState.raceId} — no winning bets, house receives ${winner.ownerId ? "50%" : "100%"} of ${totalPool.toLocaleString()} pool`);
    return;
  }

  // ── CASE A: Normal parimutuel payout ────────────────────────────────
  // 5% house | 10% owner (if owned) | 85% distributed to winning bettors
  const houseCut   = Math.floor(totalPool * 0.05);
  const ownerAmt   = winner.ownerId ? Math.floor(totalPool * 0.10) : 0;
  const payoutPool = totalPool - houseCut - ownerAmt;

  await logHouseRake(houseCut,
    `Horse race #${raceState.raceId} — 5% house rake on pool of ${totalPool.toLocaleString()} (winner: ${winner.name})`);
  await creditOwner(winner, ownerAmt,
    `Horse owner cut (10%) — ${winner.name} won race #${raceState.raceId} — pool ${totalPool.toLocaleString()}`);

  for (const bet of winBets) {
    const share  = bet.amount / totalWinningPool;
    const payout = Math.floor(payoutPool * share);
    if (payout <= 0) continue;
    const rows = await db.select().from(playersTable).where(eq(playersTable.id, bet.playerId));
    if (!rows.length) continue;
    const newChips = Number(rows[0].chips) + payout;
    await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, bet.playerId));
    await db.insert(transactionsTable).values({
      playerId: bet.playerId, type: "win", amount: payout,
      description: `Horse racing win — ${winner.name} (pool ${totalPool.toLocaleString()})`,
    });
    broadcastPlayerBalance(bet.playerId, newChips);
  }
}

async function recalcWeights() {
  const all = await db.select().from(horsesTable);
  if (all.length === 0) return;
  // Stats-based weight — no fixed odds. Live pool odds are computed at race time.
  const scores = all.map((h) =>
    ((h.speed ?? 50) * 0.35 + (h.stamina ?? 50) * 0.30 + (h.acceleration ?? 50) * 0.20 + (h.luck ?? 50) * 0.15) / 100,
  );
  const total = scores.reduce((s, w) => s + w, 0) || 1;
  for (let i = 0; i < all.length; i++) {
    await db.update(horsesTable)
      .set({ weight: scores[i] / total, ownerCut: ownerCutFromRarity(all[i].rarity ?? "common") })
      .where(eq(horsesTable.id, all[i].id));
  }
}

// ── Seed horses ───────────────────────────────────────────────────────────

async function seedHorsesIfNeeded() {
  // Seeding is disabled — all horses must be created via the admin Horse Creator.
  return;

  // Dead code below kept for reference only
  const rows = await db.select().from(horsesTable);
  const existing = new Set(rows.map((r) => r.id));

  const horseNames = [
    "Thunder Strike","Silver Arrow","Dark Phantom","Golden Rush","Iron Will",
    "Storm Chaser","Wild Ember","Night Raider","Flash Point","Blue Horizon",
    "Steel Bolt","Ruby Flame","Shadow Dancer","Crystal Wind","Iron Fist",
    "Blaze Runner","Crimson Wave","Lone Ranger","Desert Storm","Sky Rocket",
    "Black Knight","Rapid Fire","Stone Cold","Lucky Star","Fire Dancer",
    "Wild Spirit","Eagle Eye","Copper Tail","Steel Jaw","Ghost Rider",
    "Venom Strike","Steel Claw","Midnight Sun","Ice Breaker","Thunder Bay",
    "Rising Sun","Storm Front","Silver Fox","Dark Matter","Red Alert",
    "Blue Streak","Steel Trap","Iron Horse","Gold Rush","Wild Card",
    "Fast Lane","Dark Horse","Lucky Charm","Night Fury","Storm King",
    "Power Play","Quick Draw","Wind Chaser","Fire Storm","Steel Dragon",
    "Shadow Wolf","Blazing Star","Iron Duke","Crystal Bay","Thunder Road",
    "Silver Moon","Dark Angel","Golden Eagle","Red Baron","Black Pearl",
    "Wild Fire","Storm Rider","Steel Edge","Rapid Star","Blue Thunder",
    "Night Hawk","Iron Maiden","Crystal Ball","Thunder Bolt","Silver Sword",
    "Dark Fury","Golden Horn","Red Dragon","Black Thunder","Wild Ace",
    "Storm Wave","Steel Heart","Rapid Blade","Blue Angel","Night Storm",
    "Iron Claw","Crystal Lake","Thunder King","Silver Streak","Dark Blade",
    "Golden Storm","Red Fox","Black Hawk","Wild Storm","Storm Eagle",
    "Steel Fang","Rapid Wave","Blue Sky","Night Wind","Iron Storm",
  ];

  const toInsert = [];
  for (let id = 1; id <= 100; id++) {
    if (existing.has(id)) continue;
    const rawOdds = 1 + Math.floor(Math.random() * 12);
    toInsert.push({
      id,
      name: horseNames[id - 1] ?? `Horse #${id}`,
      odds: rawOdds,
      weight: 1.0,
      variantId: id,
      ownerCut: ownerCutFromRarity("common"),
    });
  }

  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 20) {
      await db.insert(horsesTable).values(toInsert.slice(i, i + 20)).onConflictDoNothing();
    }
    await recalcWeights();
  }
}

// Startup: remove any bare seeded horses (IDs 1-100, no sprite key)
// so only admin-created horses remain in the pool.
(async () => {
  try {
    // Delete seeded placeholder horses — they have id <= 100 and no sprite key
    const deleted = await db
      .delete(horsesTable)
      .where(and(lte(horsesTable.id, 100), isNull(horsesTable.baseSpriteKey)))
      .returning({ id: horsesTable.id });
    if (deleted.length > 0) {
      console.log(`[horse-racing] Removed ${deleted.length} seeded placeholder horse(s)`);
      await recalcWeights();
    }
    // Restore persisted queue from DB
    try {
      const saved = await getSetting("horse_race_queue", "[]");
      const parsed: QueuedRace[] = JSON.parse(saved);
      // Only keep entries whose betting window hasn't long expired (>5 min past bettingClosesAt)
      const now2 = Date.now();
      raceQueue = parsed.filter(r => r.bettingClosesAt > now2 - 5 * 60_000);
      if (raceQueue.length > 0) {
        console.log(`[horse-racing] Restored ${raceQueue.length} queued race(s) from DB`);
      }
    } catch (e) {
      console.warn("[horse-racing] Could not restore queue from DB:", e);
      raceQueue = [];
    }

    console.log("[horse-racing] Ready — waiting for staff to schedule a race");
  } catch (e) {
    console.error("[horse-racing] init error:", e);
  }
})();

// ── Public routes ─────────────────────────────────────────────────────────

// Public stables endpoint — returns all horses with owner names + race history
router.get("/horses", async (_req, res) => {
  try {
    const horses = await db.select().from(horsesTable).orderBy(horsesTable.id);

    // Resolve owner names in one query
    const ownerIds = [...new Set(horses.filter((h) => h.ownerId != null).map((h) => h.ownerId!))];
    let ownerMap = new Map<number, string>();
    if (ownerIds.length > 0) {
      const owners = await db
        .select({ id: playersTable.id, username: playersTable.username })
        .from(playersTable)
        .where(inArray(playersTable.id, ownerIds));
      for (const o of owners) ownerMap.set(o.id, o.username);
    }

    res.json(horses.map((h) => ({
      id: h.id,
      name: h.name,
      rarity: h.rarity,
      ownerId: h.ownerId,
      ownerName: h.ownerId != null ? (ownerMap.get(h.ownerId) ?? null) : null,
      stats: { speed: h.speed, stamina: h.stamina, acceleration: h.acceleration, luck: h.luck },
      history: { races: h.racesCount, wins: h.winsCount, losses: h.lossesCount, earnings: h.totalEarnings },
      price: h.isForSale ? (h.price ?? null) : null,
      isForSale: h.isForSale,
      // Cosmetics — needed by the frontend horse avatar renderer
      baseSpriteKey: h.baseSpriteKey ?? null,
      animFrames: h.animFrames ?? null,
      animFps: h.animFps ?? 12,
      visualBase: h.visualBase ?? "brown",
      visualPattern: h.visualPattern ?? "none",
      visualFlair: h.visualFlair ?? "none",
      effectType: h.effectType ?? "none",
      glowColor: h.glowColor ?? null,
      outlineColor: h.outlineColor ?? null,
      tackColor: h.tackColor ?? null,
    })));
  } catch {
    res.status(500).json({ error: "Failed to fetch horses" });
  }
});

router.get("/horse/status", async (_req, res) => {
  const enabled     = (await getSetting("horseEnabled", "true")) === "true";
  const minBet      = parseInt(await getSetting("horseMinBet", "10"));
  const maxBet      = parseInt(await getSetting("horseMaxBet", "50000"));
  const hasPassword = !!(await getSetting("horsePassword"));
  res.json({
    enabled,
    minBet,
    maxBet,
    hasPassword,
    raceId:          raceState.raceId,
    status:          raceState.status,
    startTime:       raceState.startTime,
    startedAt:       raceState.startedAt,
    bettingOpensAt:  raceState.bettingOpensAt,
    bettingClosesAt: raceState.bettingClosesAt,
    elapsedMs:       raceState.startedAt ? Math.max(0, Date.now() - raceState.startedAt) : null,
    winner:          raceState.status === "finished" ? raceState.winner : null,
    horses:          horseBetStats(raceState.horses, raceState.bets),
    positions:       { ...racePositions },
    queueLength:     raceQueue.length,
  });
});

// ── Player routes ─────────────────────────────────────────────────────────

router.post("/horse/bet", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const horseId = parseInt(req.body.horseId);
  const amount = parseInt(req.body.amount);

  const enabled = (await getSetting("horseEnabled", "true")) === "true";
  if (!enabled) return res.status(403).json({ error: "Horse racing is currently closed" });

  if (raceState.status !== "betting") {
    return res.status(400).json({ error: "Betting is not open right now" });
  }
  if (!raceState.horses.find((h) => h.id === horseId)) {
    return res.status(400).json({ error: "Horse not in current race" });
  }
  const minBet = parseInt(await getSetting("horseMinBet", "10"));
  const maxBet = parseInt(await getSetting("horseMaxBet", "50000"));
  if (!amount || amount < minBet) {
    return res.status(400).json({ error: `Minimum bet is ${minBet} chips` });
  }
  if (amount > maxBet) {
    return res.status(400).json({ error: `Maximum bet is ${maxBet} chips` });
  }

  const alreadyBet = raceState.bets.find(
    (b) => b.playerId === playerId && b.horseId === horseId,
  );
  if (alreadyBet) {
    return res.status(400).json({ error: "Already bet on that horse this race" });
  }

  const players = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!players.length) return res.status(404).json({ error: "Player not found" });
  if (Number(players[0].chips) < amount) {
    return res.status(400).json({ error: "Insufficient chips" });
  }

  const newChips = Number(players[0].chips) - amount;
  await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId,
    type: "loss",
    amount: amount,
    description: `Horse race #${raceState.raceId} bet on horse #${horseId}`,
  });

  raceState.bets.push({ playerId, horseId, amount });
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);
  broadcastPlayerBalance(playerId, newChips);
  broadcastRaceState();

  return res.json({ success: true, newChips });
});

// ── GET /horse/races/upcoming — public, no auth required ─────────────────
router.get("/horse/races/upcoming", async (_req, res) => {
  const now = Date.now();

  // Betting always opens at creation time — only bettingClosesAt matters
  function bettingStatus(bettingClosesAt: number) {
    if (now >= bettingClosesAt)          return "CLOSED";
    if (bettingClosesAt - now <= 30_000) return "CLOSING_SOON";
    return "OPEN";
  }

  // Helper: enrich horses with pool data for a bet list
  function enrichHorses(horses: RaceHorse[], bets: BetRecord[]) {
    const totalPool = bets.reduce((s, b) => s + b.amount, 0);
    return horses.map((h, idx) => {
      const horsePool = bets.filter(b => b.horseId === h.id).reduce((s, b) => s + b.amount, 0);
      const liveOdds = totalPool > 0 && horsePool > 0
        ? parseFloat((totalPool * 0.85 / horsePool).toFixed(2))
        : null;
      return {
        id: h.id, name: h.name, rarity: h.rarity ?? "common",
        visualBase: h.visualBase, visualPattern: h.visualPattern, visualFlair: h.visualFlair,
        baseSpriteKey: h.baseSpriteKey, animFrames: h.animFrames, animFps: h.animFps,
        effectType: h.effectType, glowColor: h.glowColor, outlineColor: h.outlineColor,
        tackColor: h.tackColor, ownerId: h.ownerId, ownerName: h.ownerName,
        speed: h.speed, stamina: h.stamina, acceleration: h.acceleration, luck: h.luck,
        variantId: h.variantId,
        horsePool, totalPool, liveOdds,
        laneIndex: idx,
      };
    });
  }

  const races = [];

  // Include the active race if betting is open or closing soon
  if (raceState.status === "betting" && raceState.bettingClosesAt) {
    const activeDelay    = raceState.delayMs ?? 0;
    races.push({
      queueId:        raceState.queueId ?? `active-${raceState.raceId}`,
      raceId:         raceState.raceId,
      isActive:       true,
      scheduledTime:  raceState.startTime,
      bettingOpensAt: raceState.bettingOpensAt,
      bettingClosesAt:raceState.bettingClosesAt,
      bettingStatus:  bettingStatus(raceState.bettingClosesAt),
      timeUntilStart: Math.max(0, Math.ceil(((raceState.startTime ?? now) - now) / 1000)),
      bettingClosesIn:Math.max(0, Math.ceil((raceState.bettingClosesAt - now) / 1000)),
      horses:         enrichHorses(raceState.horses, raceState.bets),
      totalPool:      raceState.bets.reduce((s, b) => s + b.amount, 0),
      priority:       false,
      delayMs:        activeDelay,
      isDelayed:      activeDelay > 30_000,
    });
  }

  // Include all queued races that haven't started yet (bettingClosesAt in the future)
  const sorted = [...raceQueue]
    .filter(r => r.bettingClosesAt > now)
    .sort((a, b) => a.scheduledTime - b.scheduledTime);

  for (const r of sorted) {
    // A queued race is "delayed" if its scheduled start is already in the past
    const queuedDelay = Math.max(0, now - r.scheduledTime);
    races.push({
      queueId:        r.queueId,
      raceId:         null,
      isActive:       false,
      scheduledTime:  r.scheduledTime,
      bettingOpensAt: r.bettingOpensAt,
      bettingClosesAt: r.bettingClosesAt,
      bettingStatus:  bettingStatus(r.bettingClosesAt),
      timeUntilStart: Math.max(0, Math.ceil((r.scheduledTime - now) / 1000)),
      bettingClosesIn: Math.max(0, Math.ceil((r.bettingClosesAt - now) / 1000)),
      horses:         enrichHorses(r.horses, r.advanceBets),
      totalPool:      r.advanceBets.reduce((s, b) => s + b.amount, 0),
      priority:       r.priority,
      delayMs:        queuedDelay,
      isDelayed:      queuedDelay > 30_000,
    });
  }

  return res.json({ races, serverTime: now });
});

// ── POST /horse/queue-bet — advance bet on a queued (not yet active) race ─
router.post("/horse/queue-bet", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { queueId, horseId: rawHorseId, amount: rawAmount } = req.body;
  const horseId = parseInt(rawHorseId);
  const amount  = parseInt(rawAmount);

  const enabled = (await getSetting("horseEnabled", "true")) === "true";
  if (!enabled) return res.status(403).json({ error: "Horse racing is currently closed" });

  const entry = raceQueue.find(r => r.queueId === queueId);
  if (!entry) return res.status(404).json({ error: "Race not found in queue" });

  const now = Date.now();
  if (now >= entry.bettingClosesAt) {
    return res.status(400).json({ error: "Betting for this race is closed" });
  }
  if (!entry.horses.find(h => h.id === horseId)) {
    return res.status(400).json({ error: "Horse not in this race" });
  }

  const minBet = parseInt(await getSetting("horseMinBet", "10"));
  const maxBet = parseInt(await getSetting("horseMaxBet", "50000"));
  if (!amount || amount < minBet) return res.status(400).json({ error: `Minimum bet is ${minBet} chips` });
  if (amount > maxBet)           return res.status(400).json({ error: `Maximum bet is ${maxBet} chips` });

  const alreadyBet = entry.advanceBets.find(b => b.playerId === playerId && b.horseId === horseId);
  if (alreadyBet) return res.status(400).json({ error: "Already bet on that horse in this race" });

  const players = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!players.length) return res.status(404).json({ error: "Player not found" });
  if (Number(players[0].chips) < amount) return res.status(400).json({ error: "Insufficient chips" });

  const newChips = Number(players[0].chips) - amount;
  await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId,
    type: "loss",
    amount,
    description: `Horse race advance bet on queue entry ${queueId} horse #${horseId}`,
  });

  entry.advanceBets.push({ playerId, horseId, amount });
  void persistQueue();
  broadcastPlayerBalance(playerId, newChips);

  return res.json({ success: true, newChips });
});

// ── Admin horse editor routes ─────────────────────────────────────────────

router.get("/admin/horses", requireBanker, async (_req, res) => {
  try {
    const horses = await db.select().from(horsesTable).orderBy(horsesTable.id);

    const ownerIds = horses.filter((h) => h.ownerId != null).map((h) => h.ownerId!);
    const ownerMap = new Map<number, string>();
    if (ownerIds.length > 0) {
      const owners = await db
        .select({ id: playersTable.id, username: playersTable.username })
        .from(playersTable)
        .where(inArray(playersTable.id, ownerIds));
      for (const o of owners) ownerMap.set(o.id, o.username);
    }

    res.json(horses.map((h) => ({
      ...h,
      ownerName: h.ownerId != null ? (ownerMap.get(h.ownerId) ?? null) : null,
    })));
  } catch {
    res.status(500).json({ error: "Failed to fetch horses" });
  }
});

router.post("/admin/horses/create", requireBankerOrOwner, async (req, res) => {
  const {
    name, visualBase, visualPattern, visualFlair,
    rarity, speed, stamina, acceleration, luck,
    baseSpriteKey, animFrames, animFps,
    effectType, glowColor, outlineColor, tackColor,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "Horse name is required" });

  const all = await db.select({ id: horsesTable.id }).from(horsesTable);
  const nextId = (Math.max(0, ...all.map((h) => h.id))) + 1;

  const cut = ownerCutFromRarity(rarity || "common");
  const storedFrames = animFrames ? (typeof animFrames === "string" ? animFrames : JSON.stringify(animFrames)) : null;
  const spd  = typeof speed === "number" ? Math.min(100, Math.max(1, speed)) : 50;
  const stm  = typeof stamina === "number" ? Math.min(100, Math.max(1, stamina)) : 50;
  const acc  = typeof acceleration === "number" ? Math.min(100, Math.max(1, acceleration)) : 50;
  const lck  = typeof luck === "number" ? Math.min(100, Math.max(1, luck)) : 50;

  await db.insert(horsesTable).values({
    id: nextId,
    name: name.trim(),
    odds: 1,
    weight: 0.1,
    ownerCut: cut,
    variantId: nextId,
    visualBase: visualBase || "brown",
    visualPattern: visualPattern || "none",
    visualFlair: visualFlair || "none",
    rarity: rarity || "common",
    speed: spd,
    stamina: stm,
    acceleration: acc,
    luck: lck,
    avgStat: computeAvgStat(spd, stm, acc, lck),
    baseSpriteKey: baseSpriteKey || null,
    animFrames: storedFrames,
    animFps: typeof animFps === "number" ? animFps : 12,
    effectType: effectType || "none",
    glowColor: glowColor || null,
    outlineColor: outlineColor || null,
    tackColor: tackColor || null,
  });

  await recalcWeights();

  const created = await db.select().from(horsesTable).where(eq(horsesTable.id, nextId));
  return res.json(created[0]);
});

router.post("/admin/horses/update-one", requireBankerOrOwner, async (req, res) => {
  const {
    id, name, visualBase, visualPattern, visualFlair,
    rarity, speed, stamina, acceleration, luck,
    baseSpriteKey, animFrames, animFps,
    effectType, glowColor, outlineColor, tackColor,
  } = req.body;

  if (!id) return res.status(400).json({ error: "id required" });
  if (!name?.trim()) return res.status(400).json({ error: "Horse name is required" });

  const cut = ownerCutFromRarity(rarity || "common");
  const storedFrames = animFrames ? (typeof animFrames === "string" ? animFrames : JSON.stringify(animFrames)) : null;
  const spd2 = typeof speed === "number" ? Math.min(100, Math.max(1, speed)) : 50;
  const stm2 = typeof stamina === "number" ? Math.min(100, Math.max(1, stamina)) : 50;
  const acc2 = typeof acceleration === "number" ? Math.min(100, Math.max(1, acceleration)) : 50;
  const lck2 = typeof luck === "number" ? Math.min(100, Math.max(1, luck)) : 50;

  await db.update(horsesTable).set({
    name: name.trim(),
    ownerCut: cut,
    visualBase: visualBase || "brown",
    visualPattern: visualPattern || "none",
    visualFlair: visualFlair || "none",
    rarity: rarity || "common",
    speed: spd2,
    stamina: stm2,
    acceleration: acc2,
    luck: lck2,
    avgStat: computeAvgStat(spd2, stm2, acc2, lck2),
    baseSpriteKey: baseSpriteKey || null,
    animFrames: storedFrames,
    animFps: typeof animFps === "number" ? animFps : 12,
    effectType: effectType || "none",
    glowColor: glowColor || null,
    outlineColor: outlineColor || null,
    tackColor: tackColor || null,
  }).where(eq(horsesTable.id, parseInt(id)));

  await recalcWeights();

  const updated = await db.select().from(horsesTable).where(eq(horsesTable.id, parseInt(id)));
  return res.json(updated[0]);
});

router.post("/admin/horses/delete", requireBankerOrOwner, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  await db.delete(horsesTable).where(eq(horsesTable.id, parseInt(id)));
  await recalcWeights();
  return res.json({ success: true });
});

router.post("/admin/horses/duplicate", requireBankerOrOwner, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const rows = await db.select().from(horsesTable).where(eq(horsesTable.id, parseInt(id)));
  if (!rows.length) return res.status(404).json({ error: "Horse not found" });

  const src = rows[0];
  const all = await db.select({ id: horsesTable.id }).from(horsesTable);
  const nextId = (Math.max(0, ...all.map((h) => h.id))) + 1;

  await db.insert(horsesTable).values({
    id: nextId,
    name: `${src.name} (Copy)`,
    odds: src.odds,
    weight: src.weight,
    ownerCut: src.ownerCut,
    variantId: nextId,
    visualBase: src.visualBase,
    visualPattern: src.visualPattern,
    visualFlair: src.visualFlair,
    rarity: src.rarity,
    speed: src.speed,
    stamina: src.stamina,
    acceleration: src.acceleration,
    luck: src.luck,
    avgStat: computeAvgStat(src.speed, src.stamina, src.acceleration, src.luck),
    baseSpriteKey: src.baseSpriteKey,
    effectType: src.effectType,
    glowColor: src.glowColor,
    outlineColor: src.outlineColor,
    tackColor: src.tackColor,
  });

  await recalcWeights();

  const created = await db.select().from(horsesTable).where(eq(horsesTable.id, nextId));
  return res.json(created[0]);
});

router.post("/admin/horses/update", requireBankerOrOwner, async (req, res) => {
  const updates: { id: number; name: string }[] = req.body;
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  for (const u of updates) {
    if (!u.id || !u.name?.trim()) {
      return res.status(400).json({ error: `Invalid horse #${u.id}` });
    }
  }
  for (const u of updates) {
    await db
      .update(horsesTable)
      .set({ name: u.name.trim() })
      .where(eq(horsesTable.id, u.id));
  }
  await recalcWeights();
  const all = await db.select().from(horsesTable).orderBy(horsesTable.id);
  return res.json(all);
});

router.post("/admin/horses/set-owner", requireBankerOrOwner, async (req, res) => {
  const { horseId, ownerId } = req.body;
  if (!horseId) return res.status(400).json({ error: "horseId required" });

  const newOwnerId = ownerId != null ? parseInt(ownerId) : null;

  if (newOwnerId != null) {
    const player = await db.select().from(playersTable).where(eq(playersTable.id, newOwnerId));
    if (!player.length) return res.status(404).json({ error: "Player not found" });
  }

  await db.update(horsesTable).set({ ownerId: newOwnerId }).where(eq(horsesTable.id, horseId));
  return res.json({ success: true });
});

router.post("/admin/horses/set-price", requireBankerOrOwner, async (req, res) => {
  const { id, price } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  const newPrice = (price != null && price !== "" && price !== false) ? Math.round(Number(price)) : null;
  const isForSale = newPrice != null && newPrice > 0;
  await db.update(horsesTable)
    .set({ price: isForSale ? newPrice : null, isForSale })
    .where(eq(horsesTable.id, parseInt(id)));
  return res.json({ success: true, price: isForSale ? newPrice : null, isForSale });
});

// ── Admin player search ───────────────────────────────────────────────────

router.get("/admin/players/search", requireBanker, async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) return res.json([]);
  try {
    const results = await db
      .select({ id: playersTable.id, name: playersTable.username, stateId: playersTable.stateId })
      .from(playersTable)
      .where(ilike(playersTable.username, `%${q}%`))
      .limit(10);
    return res.json(results);
  } catch {
    return res.status(500).json({ error: "Search failed" });
  }
});

// ── Admin race control routes (staff-controlled only) ─────────────────────

// ── Queue management endpoints ─────────────────────────────────────────────

/** GET /admin/race/queue — view the queue and active race summary */
router.get("/admin/race/queue", requireBanker, (_req, res) => {
  const sorted = [...raceQueue].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority ? -1 : 1;
    return a.bettingOpensAt - b.bettingOpensAt;
  });
  return res.json({
    activeRace: {
      raceId:          raceState.raceId,
      status:          raceState.status,
      bettingClosesAt: raceState.bettingClosesAt ?? null,
      horseCount:      raceState.horses.length,
    },
    queue: sorted.map(r => ({
      queueId:        r.queueId,
      scheduledTime:  r.scheduledTime,
      bettingOpensAt: r.bettingOpensAt,
      bettingClosesAt: r.bettingClosesAt,
      priority:       r.priority,
      type:           r.type,
      horseCount:     r.horses.length,
      createdAt:      r.createdAt,
    })),
  });
});

/** POST /admin/race/create-now — instant race: betting opens now, starts in 2 min */
router.post("/admin/race/create-now", requireBanker, async (req, res) => {
  const priority       = req.body.priority === true;
  const bettingOpensAt = Date.now();
  const scheduledTime  = Date.now() + 2 * 60_000;     // 2 minutes from now
  const bettingClosesAt = scheduledTime - 10_000;      // 10s before auto-start

  let horses: RaceHorse[];
  try {
    horses = await selectRaceHorses(reservedHorseIds());
  } catch (err: any) {
    return res.status(400).json({ error: err.message ?? "Not enough owned horses" });
  }

  const entry: QueuedRace = {
    queueId: randomUUID(),
    scheduledTime,
    bettingOpensAt,
    bettingClosesAt,
    horses,
    advanceBets: [],
    priority,
    type: "manual",
    createdAt: Date.now(),
  };
  if (priority) raceQueue.unshift(entry);
  else raceQueue.push(entry);
  void persistQueue();

  broadcastAll({
    type: "horse_announcement",
    message: priority
      ? "⚡ PRIORITY Race added — betting opens NOW, race starts in 2 minutes!"
      : "🐎 Race queued — betting opens NOW, race starts in 2 minutes!",
  });

  return res.json({ success: true, queueId: entry.queueId, scheduledTime, bettingOpensAt });
});

/** POST /admin/race/create-scheduled — staff picks a future time (epoch ms) */
router.post("/admin/race/create-scheduled", requireBanker, async (req, res) => {
  const scheduledTime = parseInt(req.body.scheduledTime);
  const priority      = req.body.priority === true;

  if (!scheduledTime || isNaN(scheduledTime)) {
    return res.status(400).json({ error: "scheduledTime (epoch ms) is required" });
  }
  if (scheduledTime <= Date.now() + 60_000) {
    return res.status(400).json({ error: "Scheduled time must be at least 1 minute in the future" });
  }

  // Betting opens immediately on creation; closes 10s before race starts
  const bettingOpensAt  = Date.now();
  const bettingClosesAt = scheduledTime - 10_000;

  if (bettingClosesAt <= Date.now()) {
    return res.status(400).json({ error: "Scheduled time is too close — allow at least 10 seconds of betting" });
  }
  // Prevent duplicates within 60 s of each other
  const duplicate = raceQueue.find(r => Math.abs(r.scheduledTime - scheduledTime) < 60_000);
  if (duplicate) {
    return res.status(400).json({ error: "A race is already scheduled within 60 seconds of that time" });
  }

  let horses: RaceHorse[];
  try {
    horses = await selectRaceHorses(reservedHorseIds());
  } catch (err: any) {
    return res.status(400).json({ error: err.message ?? "Not enough owned horses" });
  }

  const entry: QueuedRace = {
    queueId: randomUUID(),
    scheduledTime,
    bettingOpensAt,
    bettingClosesAt,
    horses,
    advanceBets: [],
    priority,
    type: "manual",
    createdAt: Date.now(),
  };
  if (priority) raceQueue.unshift(entry);
  else raceQueue.push(entry);
  void persistQueue();

  const minsUntilStart = Math.ceil((scheduledTime - Date.now()) / 60_000);
  broadcastAll({
    type: "horse_announcement",
    message: priority
      ? `⚡ PRIORITY Race scheduled in ${minsUntilStart} min — betting is OPEN NOW!`
      : `🐎 Race scheduled in ${minsUntilStart} min — betting is OPEN NOW!`,
  });

  return res.json({ success: true, queueId: entry.queueId, scheduledTime, bettingOpensAt });
});

/** DELETE /admin/race/queue/:queueId — cancel a queued (not yet active) race */
router.delete("/admin/race/queue/:queueId", requireBanker, async (req, res) => {
  const { queueId } = req.params;
  const idx = raceQueue.findIndex(r => r.queueId === queueId);
  if (idx === -1) return res.status(404).json({ error: "Race not found in queue" });
  raceQueue.splice(idx, 1);
  void persistQueue();
  return res.json({ success: true });
});

// 1. Schedule a race — generates 6 horses, sets startTime
router.post("/admin/race/schedule", requireBanker, async (req, res) => {
  if (raceState.status !== "idle" && raceState.status !== "finished") {
    return res.status(400).json({ error: "Reset the current race before scheduling a new one" });
  }

  const minutesFromNow = parseInt(req.body.minutesFromNow ?? req.body.minutes ?? 0);
  const rawStartTime = req.body.startTime ? parseInt(req.body.startTime) : null;
  const startTime = rawStartTime ?? (Date.now() + (minutesFromNow > 0 ? minutesFromNow * 60_000 : 0));

  let horses: RaceHorse[];
  try {
    horses = await selectRaceHorses();
  } catch (err: any) {
    return res.status(400).json({ error: err.message ?? "Not enough owned horses to start race" });
  }

  raceState = {
    raceId: raceState.raceId + 1,
    status: "scheduled",
    horses,
    startTime,
    startedAt: null,
    winner: null,
    bets: [],
  };

  broadcastRaceState();
  broadcastAll({
    type: "horse_announcement",
    message: minutesFromNow > 0
      ? `🐎 Horse Race scheduled in ${minutesFromNow} minute${minutesFromNow !== 1 ? "s" : ""}!`
      : "🐎 Horse Race scheduled — standby for betting!",
  });

  return res.json({ success: true, raceId: raceState.raceId, startTime });
});

// 2. Open betting
router.post("/admin/race/open-betting", requireBanker, async (_req, res) => {
  if (raceState.status !== "scheduled" && raceState.status !== "idle") {
    return res.status(400).json({ error: `Cannot open betting in status: ${raceState.status}` });
  }

  // If idle (no horses yet), generate them now
  let horses = raceState.horses;
  if (horses.length === 0) {
    try {
      horses = await selectRaceHorses();
    } catch (err: any) {
      return res.status(400).json({ error: err.message ?? "Not enough owned horses to start race" });
    }
    raceState = { ...raceState, raceId: raceState.raceId + 1 };
  }

  raceState = { ...raceState, status: "betting", horses };
  broadcastRaceState();
  broadcastAll({
    type: "horse_announcement",
    message: "💰 Horse Race betting is now OPEN! Place your bets!",
  });

  return res.json({ success: true });
});

// 3. Start race — launches tick engine, winner determined by simulation
router.post("/admin/race/start", requireBanker, async (_req, res) => {
  if (raceState.status !== "betting") {
    return res.status(400).json({ error: "Betting must be open before starting" });
  }
  if (raceState.horses.length < 2) {
    return res.status(400).json({ error: "Need at least 2 horses" });
  }
  await autoStartRace();
  return res.json({ success: true, raceId: raceState.raceId });
});

// ── Shared race-start logic ────────────────────────────────────────────────
/**
 * Launches the tick engine for the current race.
 * Called both by the manual /admin/race/start endpoint and the queue processor.
 */
async function autoStartRace(): Promise<void> {
  if (raceState.status !== "betting") return;
  if (raceState.horses.length < 2) return;

  const startedAt = Date.now();

  for (const horse of raceState.horses) {
    racePositions[horse.id]   = 0;
    raceUncapped[horse.id]    = 0;
    horseEnergy[horse.id]     = 100;
    activeEvents[horse.id]    = [];
    perRaceVariance[horse.id] = rng(-0.28, 0.28);
    delete normalizedStatEffect[horse.id];
    horseFormState[horse.id]    = rng(0.72, 1.28);
    horseFormDuration[horse.id] = Math.round(rng(40, 120));
    horseMomentum[horse.id] = 0;
    horsePrevPos[horse.id]  = 0;
    horseTimeInLead[horse.id]    = 0;
    horseLeaderFatigue[horse.id] = 0;
    horseDrift[horse.id]       = rng(0.80, 1.20);
    horseDriftNextAt[horse.id] = Math.round(rng(50, 100));
  }

  computeNormalizedStats(raceState.horses);
  softBoostTargetId = selectSoftBoostTarget(raceState.horses);
  currentTick = 0;

  const delayMs = raceState.startTime != null
    ? Math.max(0, startedAt - raceState.startTime)
    : 0;
  raceState = { ...raceState, status: "running", startedAt, delayMs, winner: null };
  broadcastRaceState();

  clearRaceTimer();
  raceAutoFinishTimer = setTimeout(() => { void doFinishRace(); }, RACE_DURATION_MS);
  clearRaceInterval();
  raceTickInterval = setInterval(tickRace, TICK_RATE_MS);

  broadcastAll({ type: "horse_announcement", message: "🚀 The race is underway!" });
}

// ── Queue Processor ────────────────────────────────────────────────────────
/**
 * Runs every 3 seconds.
 * 1. If a race is in "betting" and bettingClosesAt has passed → auto-start.
 * 2. If status is "idle" → promote the next eligible queued race to "betting".
 */
setInterval(async () => {
  try {
    const now = Date.now();

    // Auto-start when betting window expires
    if (raceState.status === "betting" && raceState.bettingClosesAt && now >= raceState.bettingClosesAt) {
      console.log(`[queue] Betting window closed for race #${raceState.raceId} — auto-starting`);
      await autoStartRace();
      return;
    }

    // Promote next queued race when no race is active AND it's within the promotion window
    if (raceState.status === "idle") {
      const sorted = [...raceQueue].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        return a.scheduledTime - b.scheduledTime;
      });
      // Only promote races that start within PROMOTION_WINDOW_MS (3 min) — keeps far-future
      // races in the queue as advance-betting entries without blocking the active race slot.
      const next = sorted.find(r => r.scheduledTime - now <= PROMOTION_WINDOW_MS);
      if (next) {
        raceQueue = raceQueue.filter(r => r.queueId !== next.queueId);
        void persistQueue();
        raceState = {
          raceId: raceState.raceId + 1,
          status: "betting",
          horses: next.horses,
          startTime: next.scheduledTime,
          startedAt: null,
          delayMs: null,
          bettingOpensAt: next.bettingOpensAt,
          bettingClosesAt: next.bettingClosesAt,
          winner: null,
          bets: next.advanceBets,   // carry over advance bets placed while queued
          queueId: next.queueId,
        };
        broadcastRaceState();
        broadcastAll({
          type: "horse_announcement",
          message: next.priority
            ? "⚡ PRIORITY Race — betting is NOW OPEN!"
            : "💰 Horse Race betting is now OPEN! Place your bets!",
        });
        console.log(`[queue] Promoted ${next.queueId} → race #${raceState.raceId}`);
      }
    }
  } catch (e) {
    console.error("[queue-processor] error:", e);
  }
}, 3_000);

// Shared finish logic (called by tick engine, safety timer, or manual endpoint)
async function doFinishRace(): Promise<void> {
  if (raceState.status !== "running") return;
  clearRaceTimer();
  clearRaceInterval();

  // If tick engine didn't find a winner (e.g. safety timer fired), pick the leader
  if (!raceState.winner) {
    const leader = raceState.horses.length > 0
      ? raceState.horses.reduce((best, h) =>
          (racePositions[h.id] ?? 0) >= (racePositions[best.id] ?? 0) ? h : best,
        )
      : raceState.horses[0];
    raceState = { ...raceState, winner: leader };
  }

  const winner = raceState.winner!;
  resultsUntilMs = Date.now() + RESULTS_DISPLAY_MS;
  raceState = { ...raceState, status: "finished" };
  broadcastRaceState();

  // ── Win-streak fatigue tracking ────────────────────────────────────────
  for (const horse of raceState.horses) {
    if (horse.id === winner.id) {
      horseWinStreak[horse.id] = (horseWinStreak[horse.id] ?? 0) + 1;
    } else {
      // Loss resets streak
      horseWinStreak[horse.id] = 0;
    }
  }
  console.log(`[Race] Winner: ${winner.name} — winStreak: ${horseWinStreak[winner.id] ?? 1}`);

  // Auto-reset to idle after the results display window
  clearResultsTimer();
  resultsResetTimer = setTimeout(() => {
    resultsResetTimer = null;
    resultsUntilMs = null;
    for (const k of Object.keys(racePositions)) delete racePositions[Number(k)];
    raceState = { raceId: raceState.raceId, status: "idle", horses: [], startTime: null, startedAt: null, delayMs: null, bettingOpensAt: null, bettingClosesAt: null, winner: null, bets: [], queueId: null };
    broadcastRaceState();
  }, RESULTS_DISPLAY_MS);

  if (raceState.bets.length > 0) {
    const totalPool = raceState.bets.reduce((s, b) => s + b.amount, 0);
    try {
      await db.insert(horseRaceBetsTable).values(
        raceState.bets.map((b) => ({
          raceId: raceState.raceId,
          playerId: b.playerId,
          horseId: b.horseId,
          amount: b.amount,
          paidOut: b.horseId === winner.id,
        })),
      );
    } catch {}
    await payoutParimutuel(winner);
    broadcastAll({
      type: "horse_announcement",
      message: `🏆 ${winner.name} wins! Pool: ${totalPool.toLocaleString()} chips — payouts sent.`,
    });
  } else {
    broadcastAll({
      type: "horse_announcement",
      message: `🏆 ${winner.name} wins the race!`,
    });
  }

  // Record race history for all horses that ran
  try {
    const raceHorseIds = raceState.horses.map((h) => h.id);
    if (raceHorseIds.length > 0) {
      // Increment races_count + losses_count for all
      await db.update(horsesTable)
        .set({ racesCount: sql`${horsesTable.racesCount} + 1`, lossesCount: sql`${horsesTable.lossesCount} + 1` })
        .where(inArray(horsesTable.id, raceHorseIds));
      // Correct winner: increment wins, decrement the losses we just added
      await db.update(horsesTable)
        .set({ winsCount: sql`${horsesTable.winsCount} + 1`, lossesCount: sql`${horsesTable.lossesCount} - 1` })
        .where(eq(horsesTable.id, winner.id));
    }
  } catch (e) {
    console.error("[horse-racing] history update failed:", e);
  }
}

// 4. Finish race — pay out bets + owner cuts, status = finished
router.post("/admin/race/finish", requireBanker, async (_req, res) => {
  if (raceState.status !== "running") {
    return res.status(400).json({ error: "Race must be running to finish it" });
  }

  await doFinishRace();
  return res.json({ success: true, winner: { id: raceState.winner?.id, name: raceState.winner?.name } });
});

// 5. Cancel — refund all bets, back to idle
router.post("/admin/race/cancel", requireBanker, async (_req, res) => {
  if (raceState.status === "idle") {
    return res.status(400).json({ error: "No active race to cancel" });
  }

  clearRaceTimer();
  clearRaceInterval();
  clearResultsTimer();
  resultsUntilMs = null;

  const byPlayer = new Map<number, number>();
  for (const b of raceState.bets) byPlayer.set(b.playerId, (byPlayer.get(b.playerId) ?? 0) + b.amount);
  for (const [pid, refund] of byPlayer) {
    const rows = await db.select().from(playersTable).where(eq(playersTable.id, pid));
    if (!rows.length) continue;
    const newChips = Number(rows[0].chips) + refund;
    await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, pid));
    await db.insert(transactionsTable).values({
      playerId: pid,
      type: "deposit",
      amount: refund,
      description: `Horse race #${raceState.raceId} cancelled — refund`,
    });
    broadcastPlayerBalance(pid, newChips);
  }

  raceState = { raceId: raceState.raceId, status: "idle", horses: [], startTime: null, startedAt: null, delayMs: null, bettingOpensAt: null, bettingClosesAt: null, winner: null, bets: [], queueId: null };
  broadcastRaceState();
  broadcastAll({ type: "horse_announcement", message: "❌ Horse race has been cancelled. All bets refunded." });

  return res.json({ success: true });
});

// 6. Reset — wipe state back to idle (no refunds, use cancel for refunds)
router.post("/admin/race/reset", requireBanker, async (_req, res) => {
  clearRaceTimer();
  clearRaceInterval();
  clearResultsTimer();
  resultsUntilMs = null;
  raceState = { raceId: raceState.raceId, status: "idle", horses: [], startTime: null, startedAt: null, delayMs: null, bettingOpensAt: null, bettingClosesAt: null, winner: null, bets: [], queueId: null };
  broadcastRaceState();
  return res.json({ success: true });
});

export default router;
