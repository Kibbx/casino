import { Router } from "express";
import { db, playersTable, transactionsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requirePlayer } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { isPlayerGameBanned } from "./security.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";

const router = Router();

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

const BET_MIN = 20;

const SYMBOLS = [
  { id: "Bag",      weight: 32 },
  { id: "Spades",   weight: 34 },
  { id: "Hearts",   weight: 30 },
  { id: "Crosses",  weight: 26 },
  { id: "Diamonds", weight: 22 },
  { id: "Flask",    weight: 18 },
  { id: "Hat",      weight: 14 },
  { id: "Gun",      weight: 10 },
  { id: "Wild",     weight: 4  },
  { id: "Scatter",  weight: 5  },
] as const;

// Free spin pool — slightly more Wilds & premium symbols than normal,
// but balanced so bonus rounds don't blow out the RTP.
const FREE_SYMBOLS = [
  { id: "Bag",      weight: 24 },
  { id: "Spades",   weight: 26 },
  { id: "Hearts",   weight: 22 },
  { id: "Crosses",  weight: 20 },
  { id: "Diamonds", weight: 17 },
  { id: "Flask",    weight: 14 },
  { id: "Hat",      weight: 11 },
  { id: "Gun",      weight: 8  },
  { id: "Wild",     weight: 7  },
  { id: "Scatter",  weight: 3  },
] as const;

// All wins during free spins are multiplied by this
const FREE_SPIN_MULTIPLIER = 2;

// Symbol order (low → high): Bag, Crosses, Diamonds, Hearts, Spades, Flask, Hat, Gun, Wild
// lineWin = paytableValue × (totalBet / 20)
const PAYTABLE: Record<string, Record<number, number>> = {
  Bag:     { 3: 5,   4: 20,  5: 60   },
  Crosses: { 3: 5,   4: 25,  5: 80   },
  Diamonds:{ 3: 10,  4: 30,  5: 100  },
  Hearts:  { 3: 10,  4: 35,  5: 120  },
  Spades:  { 3: 10,  4: 40,  5: 150  },
  Flask:   { 3: 15,  4: 60,  5: 200  },
  Hat:     { 3: 20,  4: 80,  5: 300  },
  Gun:     { 3: 30,  4: 125, 5: 750  },
  Wild:    { 3: 100, 4: 500, 5: 2000 },
};

// Scatter pays TOTAL BET × multiplier (not betPerLine).
// scatterWin = SCATTER_PAY[sc] × scale, scale = totalBet/20
// So SCATTER_PAY[3]=40 → 40 × (totalBet/20) = 2 × totalBet ✓
const SCATTER_PAY: Record<number, number> = { 3: 40, 4: 200, 5: 1000 };
const FREE_SPINS_MAP: Record<number, number> = { 3: 10, 4: 12, 5: 15 };

const PAYLINES: number[][] = [
  [1,1,1,1,1], // 1  middle straight
  [0,0,0,0,0], // 2  top straight
  [2,2,2,2,2], // 3  bottom straight
  [0,1,2,1,0], // 4  V
  [2,1,0,1,2], // 5  inverted V
  [0,0,1,2,2], // 6  slope down
  [2,2,1,0,0], // 7  slope up
  [1,0,0,0,1], // 8  middle-top-middle
  [1,2,2,2,1], // 9  middle-bottom-middle
  [0,1,1,1,0], // 10 top-middle-top
  [2,1,1,1,2], // 11 bottom-middle-bottom
  [1,0,1,2,1], // 12 zigzag down
  [1,2,1,0,1], // 13 zigzag up
  [0,1,0,1,0], // 14 top wave
  [2,1,2,1,2], // 15 bottom wave
  [0,1,2,2,1], // 16 drop then rise
  [2,1,0,0,1], // 17 rise then drop
  [1,1,0,1,1], // 18 middle with top bump
  [1,1,2,1,1], // 19 middle with bottom dip
  [1,0,1,1,2], // 20 connected custom
];

function validatePaylines(paylines: number[][]): void {
  if (paylines.length !== 20) throw new Error(`Western Slots must have exactly 20 paylines. Found ${paylines.length}`);
  const seen = new Set<string>();
  paylines.forEach((line, idx) => {
    const n = idx + 1;
    if (line.length !== 5) throw new Error(`Payline ${n} must have 5 entries`);
    line.forEach(r => { if (![0,1,2].includes(r)) throw new Error(`Payline ${n} has invalid row ${r}`); });
    for (let i = 1; i < line.length; i++) {
      if (Math.abs(line[i] - line[i-1]) > 1) throw new Error(`Payline ${n} has disconnected jump: ${line.join(",")}`);
    }
    const key = line.join(",");
    if (seen.has(key)) throw new Error(`Duplicate payline: ${key}`);
    seen.add(key);
  });
  console.log("[Western] Paylines valid:", paylines.length, "unique connected lines");
}
validatePaylines(PAYLINES);

function buildPool(): string[] {
  const pool: string[] = [];
  for (const s of SYMBOLS) for (let i = 0; i < s.weight; i++) pool.push(s.id);
  return pool;
}
const POOL = buildPool();

function buildFreePool(): string[] {
  const pool: string[] = [];
  for (const s of FREE_SYMBOLS) for (let i = 0; i < s.weight; i++) pool.push(s.id);
  return pool;
}
const FREE_POOL = buildFreePool();

// Returns cols[col][row] — column-major, matching the client's result format
export function spinCols(free = false): string[][] {
  const pool = free ? FREE_POOL : POOL;
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => pool[Math.floor(Math.random() * pool.length)])
  );
}

function buildDevThreeScatterCols(): string[][] {
  const cols = spinCols(false);
  cols[0][0] = "Scatter";
  cols[1][1] = "Scatter";
  cols[2][2] = "Scatter";
  return cols;
}

interface WinPosition {
  reel: number;
  row: number;
  symbol: string;
}

interface LineWin {
  lineIndex: number;
  lineNumber: number;
  payline: number[];
  symbol: string;
  matchCount: number;
  usedWild: boolean;
  paytableValue: number;
  betPerLine: number;
  payout: number;
  positions: WinPosition[];
  // Legacy aliases kept for any old client code
  count: number;
  win: number;
}

export function evalCols(cols: string[][], totalBet: number): { lineWins: LineWin[]; scatterWin: number; scatters: number; freeSpinsAwarded: number; totalWin: number } {
  const scale = totalBet / BET_MIN;
  const betPerLine = totalBet / 20;
  const lineWins: LineWin[] = [];

  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li];
    const first = cols[0][line[0]];
    if (first === "Scatter") continue;

    let sym: string | null = first === "Wild" ? null : first;
    let usedWild = first === "Wild";
    let count = 1;

    for (let c = 1; c < 5; c++) {
      const s = cols[c][line[c]];
      if (s === "Wild") { usedWild = true; count++; continue; }
      if (sym === null) {
        if (s === "Scatter") break; // stop streak; count stays (Wilds already counted)
        sym = s; count++; continue;
      }
      if (s === sym) { count++; continue; }
      break;
    }

    if (count < 3) continue;
    const key = sym ?? "Wild";
    const paytableValue = PAYTABLE[key]?.[count] ?? 0;
    const payout = Math.round(paytableValue * scale);
    if (payout <= 0) continue;

    const positions: WinPosition[] = Array.from({ length: count }, (_, c) => ({
      reel: c,
      row: line[c],
      symbol: cols[c][line[c]],
    }));

    lineWins.push({
      lineIndex: li,
      lineNumber: li + 1,
      payline: [...line],
      symbol: key,
      matchCount: count,
      usedWild,
      paytableValue,
      betPerLine,
      payout,
      positions,
      // Legacy
      count,
      win: payout,
    });
  }

  // Deduplicate: two paylines that resolve to the exact same winning cells
  // (same reel+row for every matched position) are one win, not two.
  const seenPositions = new Set<string>();
  const uniqueLineWins = lineWins.filter(lw => {
    const key = lw.positions.map(p => `${p.reel}:${p.row}`).join("|");
    if (seenPositions.has(key)) return false;
    seenPositions.add(key);
    return true;
  });

  const scatters = cols.flat().filter(s => s === "Scatter").length;
  const scatterWin = Math.round((SCATTER_PAY[Math.min(scatters, 5)] ?? 0) * scale);
  const freeSpinsAwarded = scatters >= 3 ? (FREE_SPINS_MAP[Math.min(scatters, 5)] ?? 0) : 0;
  const totalWin = uniqueLineWins.reduce((s, w) => s + w.payout, 0) + scatterWin;

  if (process.env.NODE_ENV !== "production") {
    console.log("[Western] FINAL GRID", cols);
    console.log("[Western] LINE WINS", JSON.stringify(uniqueLineWins, null, 2));
    console.log("[Western] TOTAL WIN", totalWin, "scatter", scatterWin);
  }

  return { lineWins: uniqueLineWins, scatterWin, scatters, freeSpinsAwarded, totalWin };
}

// Free spins persisted in players table (bonusSpins/bonusBet/bonusGame)
const GAME_KEY = "western-slots";

// ── POST /western-slots/spin ──────────────────────────────────────────────────
router.post("/spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const slotsEnabled = (await getSetting("slotsEnabled", "true")) === "true";
  if (!slotsEnabled) {
    console.log(`[western-slots] /spin blocked — slotsEnabled=false (player=${playerId})`);
    return res.status(403).json({ error: "Slots are currently closed" });
  }
  const totalBet = parseInt(req.body.bet);

  if (!totalBet || totalBet < BET_MIN || isNaN(totalBet)) {
    return res.status(400).json({ error: `Invalid bet (min ${BET_MIN})` });
  }

  const banCheck = await isPlayerGameBanned(playerId, "western-slots");
  if (banCheck.banned) return res.status(403).json({ error: `Banned from Deadwood Dollars${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const current = rows[0];
  if (!current || current.chips < totalBet) {
    return res.status(400).json({ error: "Insufficient chips" });
  }

  const forceDevThreeScatters =
    process.env.NODE_ENV !== "production" &&
    req.body?.forceDevThreeScatters === true &&
    ((req as any).playerSession?.staffRoles ?? []).some((role: string) => role.toLowerCase() === "owner");
  const cols = forceDevThreeScatters ? buildDevThreeScatterCols() : spinCols();
  const { lineWins, scatterWin, scatters, freeSpinsAwarded, totalWin } = evalCols(cols, totalBet);
  const net = totalWin - totalBet;

  const realRatio = await trackRakebackBet(playerId, totalBet);

  await db.update(playersTable)
    .set({
      chips: sql`chips + ${net}`,
      ...(freeSpinsAwarded > 0 ? { bonusSpins: freeSpinsAwarded, bonusBet: totalBet, bonusMult: 2, bonusGame: GAME_KEY } : {}),
    })
    .where(eq(playersTable.id, playerId));

  await db.insert(transactionsTable).values({
    playerId,
    type: "western-slots-bet",
    amount: -totalBet,
    description: `Deadwood Dollars spin, bet=${totalBet}`,
  });

  if (totalWin > 0) {
    await db.insert(transactionsTable).values({
      playerId,
      type: "western-slots-win",
      amount: totalWin,
      description: `Deadwood Dollars win=${totalWin} (${lineWins.length} lines + scatter ${scatterWin})`,
    });
    await trackRakebackWin(playerId, totalWin, realRatio);
  }

  await recordPlayerActivity(playerId, current.username, "western-slots", true);
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  const updated = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const newBalance = updated[0]?.chips ?? 0;
  await broadcastPlayerBalance(playerId, newBalance);

  return res.json({ cols, lineWins, scatterWin, scatters, totalWin, freeSpinsAwarded, newBalance });
});

// ── POST /western-slots/free-spin ─────────────────────────────────────────────
router.post("/free-spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const slotsEnabled = (await getSetting("slotsEnabled", "true")) === "true";
  if (!slotsEnabled) {
    console.log(`[western-slots] /free-spin blocked — slotsEnabled=false (player=${playerId})`);
    return res.status(403).json({ error: "Slots are currently closed" });
  }

  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const player = rows[0];
  if (!player || (player.bonusSpins ?? 0) <= 0 || player.bonusGame !== GAME_KEY) {
    return res.status(400).json({ error: "No free spins remaining" });
  }

  const bonusBet = player.bonusBet ?? 0;
  const remaining = (player.bonusSpins ?? 1) - 1;

  const cols = spinCols(true); // boosted free-spin pool (RNG-only, even in dev)
  const { lineWins, scatterWin, scatters, totalWin: rawWin } = evalCols(cols, bonusBet);
  const totalWin = rawWin * FREE_SPIN_MULTIPLIER;
  // Scatter combinations during the bonus round retrigger the same number
  // of spins as their initial bonus awards: 3→10, 4→12, 5→15. This is
  // added after the current spin is consumed.
  const retriggeredFreeSpins = scatters >= 3
    ? (FREE_SPINS_MAP[Math.min(scatters, 5)] ?? 0)
    : 0;
  const updatedRemaining = remaining + retriggeredFreeSpins;

  await db.update(playersTable)
    .set({
      chips: totalWin > 0 ? sql`chips + ${totalWin}` : sql`chips`,
      bonusSpins: updatedRemaining,
      ...(updatedRemaining <= 0 ? { bonusGame: null } : {}),
    })
    .where(eq(playersTable.id, playerId));

  if (totalWin > 0) {
    await db.insert(transactionsTable).values({
      playerId,
      type: "western-slots-win",
      amount: totalWin,
      description: `Deadwood Dollars free spin win=${totalWin} (bet=${bonusBet}, ${FREE_SPIN_MULTIPLIER}× multiplier)`,
    });
    await trackRakebackWin(playerId, totalWin, 1);
  }

  const updated = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const newBalance = updated[0]?.chips ?? 0;
  if (totalWin > 0) await broadcastPlayerBalance(playerId, newBalance);
  await recordPlayerActivity(playerId, updated[0]?.username ?? `player_${playerId}`, "western-slots", true);

  return res.json({
    cols,
    lineWins,
    scatterWin,
    scatters,
    totalWin,
    bonusBet,
    freeSpinsRemaining: updatedRemaining,
    freeSpinsAwarded: retriggeredFreeSpins,
    newBalance,
    multiplier: FREE_SPIN_MULTIPLIER,
  });
});

// ── GET /western-slots/free-spins-status ─────────────────────────────────────
router.get("/free-spins-status", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const p = rows[0];
  const active = p?.bonusGame === GAME_KEY;
  return res.json({ remaining: active ? (p?.bonusSpins ?? 0) : 0, bet: active ? (p?.bonusBet ?? 0) : 0 });
});

export default router;
