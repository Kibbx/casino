import { Router } from "express";
import { db, playersTable, transactionsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { isPlayerGameBanned } from "./security.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) await db.insert(settingsTable).values({ key, value });
  else await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
}

const router = Router();


// ── Symbols with reel weights ─────────────────────────────────────────────────
const SYMBOLS = [
  { id: "BronzeCoin", weight: 22 },
  { id: "CooperCoin", weight: 22 },
  { id: "SilverCoin", weight: 24 },
  { id: "GoldCoin",   weight: 18 },
  { id: "Amphora",    weight: 14 },
  { id: "Wreath",     weight: 10 },
  { id: "Gladius",    weight: 7  },
  { id: "Helmet",     weight: 4  },
  { id: "Wild",       weight: 4  },
  { id: "Scatter",    weight: 4  },
] as const;

// ── Paytable: multiplier × betPerLine ────────────────────────────────────────
// Calibrated for ~89% total RTP (base ~67% + ~22% from bonuses).
// With 20 paylines, common symbols typically hit 2–4 lines per spin,
// so a 2,000-bet spin often returns 1,600–2,200 chips on low-symbol wins.
const PAYTABLE: Record<string, Record<number, number>> = {
  BronzeCoin: { 3: 7,   4: 24,   5: 61   },
  CooperCoin: { 3: 7,   4: 28,   5: 75   },
  SilverCoin: { 3: 11,  4: 39,   5: 105  },
  GoldCoin:   { 3: 11,  4: 46,   5: 133  },
  Amphora:    { 3: 18,  4: 61,   5: 189  },
  Wreath:     { 3: 23,  4: 84,   5: 263  },
  Gladius:    { 3: 28,  4: 107,  5: 394  },
  Helmet:     { 3: 51,  4: 182,  5: 726  },
  Wild:       { 3: 79,  4: 336,  5: 1260 },
};

// Scatter: pays total-bet × multiplier for 3/4/5 anywhere on grid
export const SCATTER_PAY: Record<number, number> = { 3: 3, 4: 11, 5: 44 };

// Free spins awarded on scatter trigger (3/4/5 scatters)
const FREE_SPINS_MAP: Record<number, number> = { 3: 8, 4: 12, 5: 18 };

// Free spins are persisted in the players table:
//   bonusSpins  — how many remain
//   bonusBet    — stake locked at trigger time
//   bonusGame   — 'rome-slots' (prevents western bleed-over)
const GAME_KEY = "rome-slots";

// ── 20 Paylines (row index per reel, rows 0=top 1=mid 2=bot) ─────────────────
export const PAYLINES: number[][] = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,0,1,2,2], [2,2,1,0,0],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,1,1,1,2], [2,1,1,1,0],
  [0,1,2,2,2], [2,1,0,0,0],
  [0,0,1,0,0], [2,2,1,2,2],
  [1,1,0,1,1], [1,1,2,1,1],
  [0,1,0,1,0],
];

type Grid = string[][];

function buildPool(): string[] {
  const pool: string[] = [];
  for (const s of SYMBOLS) for (let i = 0; i < s.weight; i++) pool.push(s.id);
  return pool;
}

const POOL = buildPool();

// Free spin pool — slightly more Wilds & premium symbols than normal,
// but balanced so bonus rounds don't blow out the RTP.
const FREE_SYMBOLS = [
  { id: "BronzeCoin", weight: 16 },
  { id: "CooperCoin", weight: 16 },
  { id: "SilverCoin", weight: 18 },
  { id: "GoldCoin",   weight: 14 },
  { id: "Amphora",    weight: 12 },
  { id: "Wreath",     weight: 9  },
  { id: "Gladius",    weight: 7  },
  { id: "Helmet",     weight: 5  },
  { id: "Wild",       weight: 7  },
  { id: "Scatter",    weight: 3  },
] as const;

// All wins during free spins are multiplied by this
const FREE_SPIN_MULTIPLIER = 2;

function buildFreePool(): string[] {
  const pool: string[] = [];
  for (const s of FREE_SYMBOLS) for (let i = 0; i < s.weight; i++) pool.push(s.id);
  return pool;
}
const FREE_POOL = buildFreePool();

export function spinGrid(free = false): Grid {
  const pool = free ? FREE_POOL : POOL;
  const grid: Grid = [];
  for (let row = 0; row < 3; row++) {
    grid.push([]);
    for (let reel = 0; reel < 5; reel++) {
      grid[row].push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  return grid;
}

interface LineWin {
  lineIndex: number;
  symbol: string;
  count: number;
  win: number;
}

export function evaluateGrid(grid: Grid, betPerLine: number): LineWin[] {
  const wins: LineWin[] = [];
  for (let li = 0; li < PAYLINES.length; li++) {
    const line = PAYLINES[li];
    const lineSyms = line.map((row, reel) => grid[row][reel]);
    const firstReal = lineSyms.find(s => s !== "Wild" && s !== "Scatter");
    // All-Wild line: treat as Wild symbol. Scatter-only or empty: skip.
    const symToUse = firstReal ?? (lineSyms[0] === "Wild" ? "Wild" : null);
    if (!symToUse) continue;
    let count = 0;
    for (const sym of lineSyms) {
      if (sym === symToUse || sym === "Wild") count++;
      else break;
    }
    if (count >= 3) {
      const payout = PAYTABLE[symToUse]?.[count] ?? 0;
      if (payout > 0) wins.push({ lineIndex: li, symbol: symToUse, count, win: payout * betPerLine });
    }
  }
  return wins;
}

export function countScatters(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell === "Scatter") n++;
  return n;
}

// ── POST /rome-slots/spin ─────────────────────────────────────────────────────
router.post("/spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const slotsEnabled = (await getSetting("slotsEnabled", "false")) === "true";
  if (!slotsEnabled) {
    console.log(`[rome-slots] /spin blocked — slotsEnabled=false (player=${playerId})`);
    return res.status(403).json({ error: "Slots are currently closed" });
  }
  const totalBet = parseInt(req.body.bet);
  const minBet = parseInt(await getSetting("slotsMinBet", "50"));
  const maxBet = parseInt(await getSetting("slotsMaxBet", "5000"));

  if (!totalBet || totalBet < minBet || totalBet > maxBet) {
    return res.status(400).json({ error: `Invalid bet amount (min ${minBet}, max ${maxBet})` });
  }

  const banCheck = await isPlayerGameBanned(playerId, "rome-slots");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Fortuna${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const current = rows[0];
  if (!current || current.chips < totalBet) {
    return res.status(400).json({ error: "Insufficient chips" });
  }

  const betPerLine = Math.floor(totalBet / PAYLINES.length);
  const grid = spinGrid();
  const lineWins = evaluateGrid(grid, betPerLine);
  const scatters = countScatters(grid);

  let scatterWin = 0;
  let freeSpinsAwarded = 0;
  if (scatters >= 3) {
    const mult = SCATTER_PAY[Math.min(scatters, 5)] ?? 0;
    scatterWin = totalBet * mult;
    freeSpinsAwarded = FREE_SPINS_MAP[Math.min(scatters, 5)] ?? 0;
  }

  const totalWin = lineWins.reduce((s, w) => s + w.win, 0) + scatterWin;
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
    type: "fortuna-bet",
    amount: -totalBet,
    description: `Fortuna spin, bet=${totalBet}`,
  });

  if (totalWin > 0) {
    await db.insert(transactionsTable).values({
      playerId,
      type: "fortuna-win",
      amount: totalWin,
      description: `Fortuna win ${totalWin} (${lineWins.length} lines + scatter ${scatterWin})`,
    });
    await trackRakebackWin(playerId, totalWin, realRatio);
  }

  await recordPlayerActivity(playerId, current.username, "rome-slots", true);
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  const updated = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const newBalance = updated[0]?.chips ?? 0;
  await broadcastPlayerBalance(playerId, newBalance);

  return res.json({ grid, lineWins, scatterWin, scatters, totalWin, newBalance, freeSpinsAwarded });
});

// ── POST /rome-slots/free-spin ────────────────────────────────────────────────
router.post("/free-spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const slotsEnabled = (await getSetting("slotsEnabled", "false")) === "true";
  if (!slotsEnabled) {
    console.log(`[rome-slots] /free-spin blocked — slotsEnabled=false (player=${playerId})`);
    return res.status(403).json({ error: "Slots are currently closed" });
  }

  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const player = rows[0];
  if (!player || (player.bonusSpins ?? 0) <= 0 || player.bonusGame !== GAME_KEY) {
    return res.status(400).json({ error: "No free spins remaining" });
  }

  const bonusBet = player.bonusBet ?? 0;
  const remaining = (player.bonusSpins ?? 1) - 1;

  const betPerLine = Math.floor(bonusBet / PAYLINES.length);
  const grid = spinGrid(true); // boosted odds pool
  const lineWins = evaluateGrid(grid, betPerLine);
  const scatters = countScatters(grid);

  // During free spins, additional scatters retrigger more free spins (but no scatter cash pay)
  let retriggered = 0;
  if (scatters >= 3) {
    retriggered = FREE_SPINS_MAP[Math.min(scatters, 5)] ?? 0;
  }
  const finalRemaining = remaining + retriggered;

  // Apply free spin multiplier — makes bonus round feel dramatically better
  const rawWin = lineWins.reduce((s, w) => s + w.win, 0);
  const totalWin = rawWin * FREE_SPIN_MULTIPLIER;

  await db.update(playersTable)
    .set({
      chips: totalWin > 0 ? sql`chips + ${totalWin}` : sql`chips`,
      bonusSpins: finalRemaining,
      ...(finalRemaining <= 0 ? { bonusGame: null } : {}),
    })
    .where(eq(playersTable.id, playerId));

  if (totalWin > 0) {
    await db.insert(transactionsTable).values({
      playerId,
      type: "fortuna-win",
      amount: totalWin,
      description: `Fortuna free spin win ${totalWin} (bet=${bonusBet})`,
    });
    await trackRakebackWin(playerId, totalWin, 1);
  }

  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  const updated = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const newBalance = updated[0]?.chips ?? 0;
  await broadcastPlayerBalance(playerId, newBalance);
  await recordPlayerActivity(playerId, updated[0]?.username ?? `player_${playerId}`, "rome-slots", true);

  return res.json({
    grid, lineWins, scatters, totalWin, newBalance,
    freeSpinsRemaining: finalRemaining,
    retriggered,
    multiplier: FREE_SPIN_MULTIPLIER,
  });
});

// ── GET /rome-slots/free-spins-status ────────────────────────────────────────
router.get("/free-spins-status", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const rows = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  const p = rows[0];
  const active = p?.bonusGame === GAME_KEY;
  res.json({ remaining: active ? (p?.bonusSpins ?? 0) : 0, bet: active ? (p?.bonusBet ?? 0) : 0 });
});


// ── GET /rome-slots/config ────────────────────────────────────────────────────
router.get("/config", (_req, res) => {
  res.json({
    paylines: PAYLINES.length,
    symbols: SYMBOLS.map(s => s.id),
    paytable: PAYTABLE,
    scatterPay: SCATTER_PAY,
  });
});

export default router;
