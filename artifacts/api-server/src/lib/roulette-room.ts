/**
 * roulette-room.ts
 * Singleton multiplayer roulette room manager.
 *
 * Phase lifecycle:
 *   BETTING_OPEN → BETTING_CLOSED → SPINNING → RESULT → RESETTING → (BETTING_OPEN …)
 *
 * Chip flow:
 *   - Chips are deducted from the DB immediately when each bet is placed (server-authoritative).
 *   - If a player clears bets during BETTING_OPEN, chips are refunded to the DB.
 *   - On RESULT, winning payouts are credited to each player's DB balance.
 */

import { WebSocket } from "ws";
import { db, playersTable, transactionsTable, settingsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { spinWheel, evaluateAllBets } from "./roulette-engine.js";
import type { Bet, WheelType } from "./roulette-engine.js";
import { trackRakebackBet, trackRakebackWin } from "./rakeback.js";

// Per-round realRatio per player: populated at closeBetting, used at payout
const rouletteRealRatios = new Map<number, number>();

// ── Phase type ─────────────────────────────────────────────────────────────────

export type Phase =
  | "WAITING"
  | "BETTING_OPEN"
  | "BETTING_CLOSED"
  | "SPINNING"
  | "RESULT"
  | "RESETTING";

// ── Timing config (ms) ─────────────────────────────────────────────────────────

const BETTING_MS   = 30_000;
const CLOSED_MS    =  2_000;
const SPINNING_MS  = 13_500; // must be >= max wheel animation (12 000ms) + network buffer
const RESULT_MS    =  8_000;
const RESETTING_MS =  2_000;

// ── Internal types ─────────────────────────────────────────────────────────────

interface PlayerEntry {
  playerId: number;
  username: string;
  avatarUrl: string | null;
  bets: Bet[];
  totalReserved: number;
}

interface RouletteSub {
  ws: WebSocket;
  playerId: number | null;
  username: string | null;
  avatarUrl: string | null;
}

// ── Injected dependencies (avoids circular import with table-ws.ts / floor-events.ts) ──

type BroadcastBalanceFn = (playerId: number, chips: number) => void;
let _broadcastBalance: BroadcastBalanceFn = () => {};

export function injectBroadcastBalance(fn: BroadcastBalanceFn) {
  _broadcastBalance = fn;
}

type AddFloorEventFn = (event: {
  type: string; severity: string; playerId: number;
  username: string; message: string; location: string;
}) => void;
let _addFloorEvent: AddFloorEventFn = () => {};

export function injectAddFloorEvent(fn: AddFloorEventFn) {
  _addFloorEvent = fn;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

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

// ── Subscriber management ──────────────────────────────────────────────────────

const subscribers = new Set<RouletteSub>();

function sendTo(ws: WebSocket, msg: object) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  } catch {}
}

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const sub of subscribers) {
    if (sub.ws.readyState !== WebSocket.OPEN) continue;
    try { sub.ws.send(data); } catch {}
  }
}

function sendToPlayerWs(playerId: number, msg: object) {
  for (const sub of subscribers) {
    if (sub.playerId === playerId && sub.ws.readyState === WebSocket.OPEN) {
      try { sub.ws.send(JSON.stringify(msg)); } catch {}
    }
  }
}

export function removeRouletteSub(ws: WebSocket) {
  for (const sub of subscribers) {
    if (sub.ws === ws) { subscribers.delete(sub); break; }
  }
}

export function getRouletteSubscribers(): Array<{ playerId: number; username: string }> {
  const result: Array<{ playerId: number; username: string }> = [];
  for (const sub of subscribers) {
    if (sub.playerId && sub.username && sub.ws.readyState === WebSocket.OPEN) {
      result.push({ playerId: sub.playerId, username: sub.username });
    }
  }
  return result;
}

// ── Room state ─────────────────────────────────────────────────────────────────

let phase: Phase = "WAITING";
let timerEndMs = 0;
let roundId = "";
let wheelType: WheelType = "european";
let minBet = 50;
let maxBet = 5000;
let maxBetsPerSpin = 0;
let winningNumber: number | null = null;
let playerBets = new Map<number, PlayerEntry>();
let phaseTimer: NodeJS.Timeout | null = null;
let tickInterval: NodeJS.Timeout | null = null;

// ── Human-readable bet description ─────────────────────────────────────────────

function betLabel(bet: Bet): string {
  switch (bet.type) {
    case "straight": return `Straight on ${bet.numbers[0] === -1 ? "00" : bet.numbers[0]}`;
    case "split":    return `Split (${bet.numbers.map(n => n === -1 ? "00" : n).join("/")})`  ;
    case "street":   return `Street (${bet.numbers[0]}–${bet.numbers[2] ?? bet.numbers[0] + 2})`;
    case "corner":   return `Corner (${bet.numbers.map(n => n === -1 ? "00" : n).join(",")})`;
    case "sixline":  return `Six Line (${bet.numbers[0]}–${bet.numbers[5] ?? bet.numbers[0] + 5})`;
    case "dozen":    {
      const d = bet.numbers[0];
      return `Dozen ${d === 1 ? "1 (1–12)" : d === 2 ? "2 (13–24)" : "3 (25–36)"}`;
    }
    case "column":   return `Column ${bet.numbers[0]}`;
    case "red":      return "Red";
    case "black":    return "Black";
    case "odd":      return "Odd";
    case "even":     return "Even";
    case "low":      return "Low (1–18)";
    case "high":     return "High (19–36)";
    default:         return bet.type;
  }
}

// ── Bet spot key (for aggregating all players' bets per UI spot) ───────────────

export function betKey(bet: Bet): string {
  switch (bet.type) {
    case "straight": return `s-${bet.numbers[0]}`;
    case "split":    return `sp-${[...bet.numbers].sort((a,b)=>a-b).join(",")}`;
    case "street":   return `st-${bet.numbers[0]}`;
    case "corner":   return `co-${bet.numbers[0]}`;
    case "sixline":  return `sl-${bet.numbers[0]}`;
    case "dozen":    return `d-${bet.numbers[0]}`;
    case "column":   return `c-${bet.numbers[0]}`;
    default:         return bet.type;
  }
}

function computeTableBets(): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const entry of playerBets.values()) {
    for (const bet of entry.bets) {
      const k = betKey(bet);
      totals[k] = (totals[k] ?? 0) + bet.amount;
    }
  }
  return totals;
}

// betMarkers: betKey → players who have chips on that spot, with per-player amount
function computeBetMarkers(): Record<string, Array<{ username: string; avatarUrl: string | null; amount: number }>> {
  const markers: Record<string, Array<{ username: string; avatarUrl: string | null; amount: number }>> = {};
  for (const entry of playerBets.values()) {
    for (const bet of entry.bets) {
      const k = betKey(bet);
      if (!markers[k]) markers[k] = [];
      const existing = markers[k].find(m => m.username === entry.username);
      if (existing) {
        existing.amount += bet.amount;
      } else {
        markers[k].push({ username: entry.username, avatarUrl: entry.avatarUrl, amount: bet.amount });
      }
    }
  }
  return markers;
}

// ── State snapshot (personalised) ──────────────────────────────────────────────

function snapshot(playerId?: number | null): object {
  const myEntry = playerId != null ? playerBets.get(playerId) : undefined;
  return {
    type: "roulette_state",
    phase,
    timerEndMs,
    secondsLeft: Math.max(0, Math.ceil((timerEndMs - Date.now()) / 1000)),
    roundId,
    wheelType,
    minBet,
    maxBet,
    maxBetsPerSpin,
    winningNumber: (phase === "RESULT" || phase === "RESETTING") ? winningNumber : null,
    tableBets: computeTableBets(),
    betMarkers: computeBetMarkers(),
    playerCount: playerBets.size,
    myBets: myEntry?.bets ?? [],
    myTotal: myEntry?.totalReserved ?? 0,
  };
}

// ── Timer utilities ────────────────────────────────────────────────────────────

function clearTimers() {
  if (phaseTimer)   { clearTimeout(phaseTimer);   phaseTimer   = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (phase !== "BETTING_OPEN") { clearInterval(tickInterval!); return; }
    const secondsLeft = Math.max(0, Math.ceil((timerEndMs - Date.now()) / 1000));
    broadcast({ type: "roulette_timer", secondsLeft, timerEndMs });
  }, 1000);
}

// ── Phase machine ──────────────────────────────────────────────────────────────

async function startBetting() {
  clearTimers();
  playerBets = new Map();
  winningNumber = null;

  const enabled = (await getSetting("rouletteEnabled", "false")) === "true";
  if (!enabled) {
    phase = "WAITING";
    broadcast({ type: "roulette_phase", phase: "WAITING" });
    return;
  }

  wheelType = (await getSetting("rouletteType", "european")) as WheelType;
  minBet = parseInt(await getSetting("rouletteMinBet", "50"));
  maxBet = parseInt(await getSetting("rouletteMaxBet", "5000"));
  maxBetsPerSpin = parseInt(await getSetting("rouletteMaxBetsPerSpin", "0"));
  phase = "BETTING_OPEN";
  timerEndMs = Date.now() + BETTING_MS;
  roundId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  broadcast({ type: "roulette_phase", phase: "BETTING_OPEN", timerEndMs, secondsLeft: Math.ceil(BETTING_MS / 1000), roundId, wheelType, minBet, maxBet, maxBetsPerSpin });
  startTick();
  phaseTimer = setTimeout(closeBetting, BETTING_MS);
}

function closeBetting() {
  clearTimers();
  phase = "BETTING_CLOSED";
  broadcast({ type: "roulette_phase", phase: "BETTING_CLOSED" });

  // Write one transaction per individual bet, then one floor event for the whole spin
  if (playerBets.size > 0) {
    const txInserts = [...playerBets.values()].flatMap(e =>
      e.bets.map(bet => ({
        playerId: e.playerId,
        amount: bet.amount,
        type: "loss" as const,
        description: `Roulette — ${betLabel(bet)}`,
      }))
    );
    if (txInserts.length > 0) db.insert(transactionsTable).values(txInserts).catch(console.error);

    // Rakeback: track real-chip wager per player
    rouletteRealRatios.clear();
    for (const e of playerBets.values()) {
      trackRakebackBet(e.playerId, e.totalReserved)
        .then(ratio => { rouletteRealRatios.set(e.playerId, ratio); })
        .catch(console.error);
    }

    // Single floor feed event for the whole round
    const totalChips = txInserts.reduce((s, t) => s + t.amount, 0);
    const playerSummaries = [...playerBets.values()]
      .sort((a, b) => b.totalReserved - a.totalReserved)
      .map(e => `${e.username} ${e.totalReserved.toLocaleString()} (${e.bets.length} spot${e.bets.length === 1 ? "" : "s"})`)
      .join(" · ");
    _addFloorEvent({
      type: "bet_placed",
      severity: totalChips >= 50_000 ? "warn" : "info",
      playerId: 0,
      username: "Roulette",
      message: `Roulette spin — ${playerBets.size} player${playerBets.size === 1 ? "" : "s"}, ${totalChips.toLocaleString()} chips: ${playerSummaries}`,
      location: "roulette",
    });
  }

  phaseTimer = setTimeout(startSpin, CLOSED_MS);
}

async function startSpin() {
  clearTimers();
  const oddsMode = await getSetting("rouletteOddsMode", "standard");

  // Build the full pocket range once (used by both hot-spin and cold bias)
  const allPockets: number[] = Array.from({ length: 37 }, (_, i) => i); // 0–36
  if (wheelType === "american") allPockets.push(-1); // 00

  // ── Hot-spin bank (guaranteed player hit) ──────────────────────────────────
  // Owner can queue N guaranteed winning spins via the dashboard.
  // Each spin in the bank forces a pocket where ≥1 player wins, then decrements
  // the counter.  Takes priority over cold/cool bias.
  let hotForced: number | null = null;
  const hotSpinsRaw = await getSetting("rouletteHotSpins", "0");
  const hotSpinsBank = parseInt(hotSpinsRaw, 10) || 0;

  if (hotSpinsBank > 0 && playerBets.size > 0) {
    const allBets: Bet[] = [];
    for (const entry of playerBets.values()) allBets.push(...entry.bets);

    const winningPockets = allPockets.filter(pocket => {
      const results = evaluateAllBets(allBets, pocket);
      return results.reduce((sum, r) => sum + r.payout, 0) > 0;
    });

    if (winningPockets.length > 0) {
      hotForced = winningPockets[Math.floor(Math.random() * winningPockets.length)];
      // Decrement bank (non-blocking, fire-and-forget is fine)
      setSetting("rouletteHotSpins", String(Math.max(0, hotSpinsBank - 1)));
      console.log(`[Roulette] HOT SPIN fired (${hotSpinsBank - 1} remaining) → pocket ${hotForced}`);
    }
  }

  // ── Smart house bias (glacier/frozen/cold/cool) ─────────────────────────────
  // Looks at what players are actually betting on, then tilts the spin toward
  // pockets nobody has covered.  Intensity scales with how cold the mode is.
  // Skipped if a hot spin already fired above, or if no bets are on the table.
  const COLD_BIAS_CHANCE: Record<string, number> = {
    glacier: 0.35,
    frozen:  0.22,
    cold:    0.10,
    cool:    0.05,
  };
  let coldForced: number | null = null;
  const coldChance = COLD_BIAS_CHANCE[oddsMode] ?? 0;
  if (hotForced === null && coldChance > 0 && playerBets.size > 0) {
    if (Math.random() < coldChance) {
      // Collect every active bet from every player at the table
      const allBets: Bet[] = [];
      for (const entry of playerBets.values()) allBets.push(...entry.bets);

      // Keep only pockets where the house pays out nothing to anyone
      const losingPockets = allPockets.filter(pocket => {
        const results = evaluateAllBets(allBets, pocket);
        return results.reduce((sum, r) => sum + r.payout, 0) === 0;
      });

      if (losingPockets.length > 0) {
        coldForced = losingPockets[Math.floor(Math.random() * losingPockets.length)];
        console.log(`[Roulette] ${oddsMode} smart bias: forced pocket ${coldForced} (${losingPockets.length} house-safe of ${allPockets.length})`);
      }
      // If every pocket is covered, bias doesn't fire — falls through to normal spin
    }
  }

  const forcedPocket = hotForced ?? coldForced;
  winningNumber = forcedPocket !== null ? forcedPocket : spinWheel(wheelType, oddsMode);
  phase = "SPINNING";
  broadcast({
    type: "roulette_phase",
    phase: "SPINNING",
    winningNumber,
    wheelType,
    roundId,
  });
  phaseTimer = setTimeout(resolveRound, SPINNING_MS);
}

async function resolveRound() {
  clearTimers();
  phase = "RESULT";
  if (winningNumber === null) { startResetting(); return; }

  // Payout is full rawPayout — oddsMode bias (spinWheel) handles house advantage
  for (const [pid, entry] of playerBets.entries()) {
    const betResults = evaluateAllBets(entry.bets, winningNumber);
    const rawPayout = betResults.reduce((s, b) => s + b.payout, 0);
    let finalPayout = 0;

    if (rawPayout > 0) {
      finalPayout = rawPayout;

      const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, pid));
      if (fresh) {
        await db.update(playersTable)
          .set({ chips: fresh.chips + finalPayout })
          .where(eq(playersTable.id, pid));
        const winTxRows = betResults
          .filter(b => b.won)
          .map(b => ({
            playerId: pid,
            amount: b.payout,
            type: "win" as const,
            description: `Roulette win — ${betLabel(b)} (number ${winningNumber === -1 ? "00" : winningNumber})`,
          }));
        if (winTxRows.length > 0) {
          await db.insert(transactionsTable).values(winTxRows);
        }
        const rouletteRatio = rouletteRealRatios.get(pid) ?? 0;
        if (rouletteRatio > 0) {
          trackRakebackWin(pid, finalPayout, rouletteRatio).catch(console.error);
        }
      }
    }

    const [updated] = await db.select().from(playersTable).where(eq(playersTable.id, pid));
    if (updated) {
      _broadcastBalance(pid, Number(updated.chips));
      sendToPlayerWs(pid, {
        type: "roulette_payout",
        roundId,
        bets: betResults,
        totalBet: entry.totalReserved,
        totalPayout: finalPayout,
        netResult: finalPayout - entry.totalReserved,
        playerChips: Number(updated.chips),
      });
    }
  }

  broadcast({ type: "roulette_phase", phase: "RESULT", winningNumber, roundId });
  phaseTimer = setTimeout(startResetting, RESULT_MS);
}

function startResetting() {
  clearTimers();
  phase = "RESETTING";
  broadcast({ type: "roulette_phase", phase: "RESETTING" });
  phaseTimer = setTimeout(startBetting, RESETTING_MS);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getRoomPhase(): Phase { return phase; }

/** Subscribe a WebSocket connection to the roulette room. */
export function subscribeRoulette(ws: WebSocket, playerId: number | null, username: string | null, avatarUrl: string | null = null) {
  for (const sub of subscribers) {
    if (sub.ws === ws) { subscribers.delete(sub); break; }
  }
  subscribers.add({ ws, playerId, username, avatarUrl });
  sendTo(ws, snapshot(playerId));
}

/** Place a single bet for a player. Chips are deducted immediately. */
export async function roulettePlaceBet(
  ws: WebSocket,
  playerId: number,
  username: string,
  bet: Bet,
  avatarUrl: string | null = null,
): Promise<{ error?: string }> {
  if (phase !== "BETTING_OPEN") return { error: "Betting is not open" };

  const minBet = parseInt(await getSetting("rouletteMinBet", "50"));
  const maxBet = parseInt(await getSetting("rouletteMaxBet", "5000"));
  const maxBetsPerSpin = parseInt(await getSetting("rouletteMaxBetsPerSpin", "0"));

  if (!bet?.amount || bet.amount < minBet) return { error: `Minimum bet is ${minBet} chips` };
  if (bet.amount > maxBet) return { error: `Maximum bet per spot is ${maxBet} chips` };

  const entry = playerBets.get(playerId) ?? { playerId, username, avatarUrl, bets: [], totalReserved: 0 };
  if (avatarUrl) entry.avatarUrl = avatarUrl;

  const key = betKey(bet);
  const existingSpot = entry.bets.find(b => betKey(b) === key);

  // Per-spot cumulative cap
  if (existingSpot && existingSpot.amount + bet.amount > maxBet) {
    return { error: `Maximum bet per spot is ${maxBet} chips (you have ${existingSpot.amount.toLocaleString()} on this spot)` };
  }

  if (maxBetsPerSpin > 0) {
    const isExisting = entry.bets.some(b => betKey(b) === key);
    if (!isExisting && entry.bets.length >= maxBetsPerSpin) {
      return { error: `Maximum ${maxBetsPerSpin} bet spot${maxBetsPerSpin === 1 ? "" : "s"} per round` };
    }
  }

  // ── Race-condition fix ────────────────────────────────────────────────────────
  // Update in-memory state SYNCHRONOUSLY before any await so that concurrent
  // requests from the same player see the updated totals immediately.
  // Node.js is single-threaded — nothing else can run between these lines.
  if (existingSpot) {
    existingSpot.amount += bet.amount;
  } else {
    entry.bets.push({ type: bet.type, numbers: bet.numbers ?? [], amount: bet.amount, placedAt: Date.now() });
  }
  entry.totalReserved += bet.amount;
  playerBets.set(playerId, entry);

  // Atomic chip deduction: only succeeds if the player currently has enough chips.
  // Using chips = chips - amount WHERE chips >= amount prevents double-deduction
  // even if two requests reach this point concurrently.
  const [updated] = await db
    .update(playersTable)
    .set({ chips: sql`${playersTable.chips} - ${bet.amount}` })
    .where(and(eq(playersTable.id, playerId), gte(playersTable.chips, bet.amount)))
    .returning();

  if (!updated) {
    // Atomic deduction failed — roll back the in-memory reservation
    if (existingSpot) {
      existingSpot.amount -= bet.amount;
    } else {
      const idx = entry.bets.findIndex(b => betKey(b) === key);
      if (idx !== -1) entry.bets.splice(idx, 1);
    }
    entry.totalReserved -= bet.amount;
    if (entry.bets.length === 0) playerBets.delete(playerId);
    return { error: "Insufficient chips" };
  }

  // No transaction log here — a single grouped entry is written per player in closeBetting()
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  _broadcastBalance(playerId, updated.chips);
  sendTo(ws, {
    type: "roulette_bet_confirmed",
    myBets: entry.bets,
    myTotal: entry.totalReserved,
  });
  broadcast({ type: "roulette_table_activity", tableBets: computeTableBets(), betMarkers: computeBetMarkers(), playerCount: playerBets.size });

  return {};
}

/** Clear all bets for a player. Chips are refunded immediately. */
export async function rouletteClearBets(ws: WebSocket, playerId: number): Promise<{ error?: string }> {
  if (phase !== "BETTING_OPEN") return { error: "Bets cannot be cleared — round is in progress" };

  const entry = playerBets.get(playerId);
  if (!entry || entry.bets.length === 0) {
    sendTo(ws, { type: "roulette_bets_cleared", myBets: [], myTotal: 0 });
    return {};
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return { error: "Player not found" };

  const refund = entry.totalReserved;
  await db.update(playersTable)
    .set({ chips: player.chips + refund })
    .where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId, amount: refund, type: "win", description: "Roulette bets cleared (refund)",
  });

  playerBets.delete(playerId);
  _broadcastBalance(playerId, player.chips + refund);
  sendTo(ws, { type: "roulette_bets_cleared", myBets: [], myTotal: 0 });
  broadcast({ type: "roulette_table_activity", tableBets: computeTableBets(), betMarkers: computeBetMarkers(), playerCount: playerBets.size });

  return {};
}

/** Start or restart the room (called on server init and when settings change). */
export async function initRouletteRoom() {
  await startBetting();
}

/** Called when banker closes roulette — transitions to WAITING immediately. */
export async function pauseRouletteRoom() {
  clearTimers();
  phase = "WAITING";
  broadcast({ type: "roulette_phase", phase: "WAITING" });
}
