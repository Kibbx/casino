// ── Slot Engine v2 — Modern 5×3, 243-ways, high-volatility ──────────────────
// All balance parameters live in CONFIG. No magic numbers outside of it.

export type SymbolId =
  | "cherry" | "lemon" | "star" | "bell"  // low → mid
  | "bar"    | "diamond" | "seven"         // high → premium
  | "wild"   | "scatter"                   // specials
  | "blank";                               // dead cell — no match, no pay

// ── CONFIG ────────────────────────────────────────────────────────────────────
export const CONFIG = {
  // Grid geometry
  NUM_REELS: 5,
  NUM_ROWS: 3,

  // Minimum consecutive reels from left for a win
  MIN_MATCH: 3,

  // Symbol weights — higher = more common.
  // Tune these to adjust volatility. Wild/scatter have bonus overrides below.
  SYMBOL_WEIGHTS: {
    cherry:  22,
    lemon:   22,
    star:    16,
    bell:    12,
    bar:      9,
    diamond:  6,
    seven:    3,
    wild:     4,
    scatter:  2,   // ~1 in 200-300 spins bonus trigger rate
    blank:    0,   // dead cell — only appears in cold/glacier modes to suppress wins
  } as Record<SymbolId, number>,

  // During bonus rounds: wild weight is boosted (kept modest to avoid runaway pays)
  BONUS_WILD_WEIGHT: 6,

  // Per-way payout multipliers [3-of-a-kind, 4-of-a-kind, 5-of-a-kind] × bet.
  // Calibrated via simulation to target ~93-94% RTP on a 243-ways 5×3 grid.
  // Per-way pays are intentionally low because 5-reel wins happen 5-9% of spins.
  SYMBOL_PAYS: {
    cherry:  [0.023, 0.095, 0.38],
    lemon:   [0.023, 0.095, 0.38],
    star:    [0.046, 0.23,  0.95],
    bell:    [0.095, 0.57,  2.28],
    bar:     [0.19,  0.76,  3.80],
    diamond: [0.456, 1.90,  9.50],
    seven:   [1.52,  7.60, 22.80],
    wild:    [0,     0,     0   ],  // wild wins credited via substituted symbol
    scatter: [0,     0,     0   ],  // scatter triggers bonus only
    blank:   [0,     0,     0   ],  // dead cell — never matches, never pays
  } as Record<SymbolId, [number, number, number]>,

  // Bonus trigger: scatter count → free spins awarded
  SCATTER_BONUS_MAP: { 3: 8, 4: 12, 5: 18 } as Record<number, number>,

  // Bonus round multiplier range (picked once at round start, applied to every bonus spin)
  BONUS_MULT_MIN: 2,
  BONUS_MULT_MAX: 4,   // reduced from 5

  // Random spin multiplier — only ONE applies per spin, never stacks.
  // Average ≈ 1.10× to keep total RTP in 93–95% band.
  SPIN_MULTIPLIERS: [
    { mult: 50,  weight: 0.01 },  // ultra rare
    { mult: 20,  weight: 0.09 },  // big jackpot
    { mult: 10,  weight: 0.4  },  // big win
    { mult: 5,   weight: 1.5  },  // solid hit
    { mult: 3,   weight: 3    },  // nice boost
    { mult: 2,   weight: 10   },  // small boost
    { mult: 1,   weight: 85   },  // no extra multiplier (base payout only)
  ] as { mult: number; weight: number }[],

  // Hard cap: no single spin can pay more than this × bet
  MAX_WIN_MULTIPLIER: 500,
} as const;

// ── Odds-mode symbol weight tables ───────────────────────────────────────────
// Controls how often high-value symbols appear — changes win FREQUENCY, not payout amounts.
// cold     → high-value symbols (seven/diamond/bar) are much rarer  → players win less often
// cool     → mild house-favoring   (midpoint between cold and standard)
// standard → balanced weights (base ~95% RTP)
// warm     → mild player-favoring  (midpoint between standard and hot)
// hot      → high-value symbols are much more common → players win more often
// blank weight = dead reel cells that break winning sequences.
// Higher blank weight → wins occur less often (lower RTP for the house).
// Standard/warm/hot have 0 blank — full 243-ways action.
export const SYMBOL_WEIGHTS_BY_MODE: Record<string, Record<SymbolId, number>> = {
  glacier: {
    cherry:  50, lemon:  50, star:  30, bell: 18,
    bar:      1, diamond:  1, seven:  1, wild:  1, scatter: 1,
    blank:  100,  // ~40% of cells are dead → wins extremely rare
  },
  frozen: {
    cherry:  42, lemon:  42, star:  26, bell: 16,
    bar:      2, diamond:  1, seven:  1, wild:  1, scatter: 1,
    blank:   70,  // ~28% dead cells
  },
  cold: {
    cherry:  32, lemon:  32, star:  22, bell: 14,
    bar:      4, diamond:  2, seven:  1, wild:  2, scatter: 1,
    blank:   40,  // ~18% dead cells
  },
  cool: {
    cherry:  27, lemon:  27, star:  19, bell: 13,
    bar:      7, diamond:  4, seven:  2, wild:  3, scatter: 1,
    blank:   15,  // ~9% dead cells — mild suppression
  },
  standard: { ...CONFIG.SYMBOL_WEIGHTS, blank: 0 },
  warm: {
    cherry:  17, lemon:  17, star:  14, bell: 11,
    bar:     12, diamond:  8, seven:  5, wild:  6, scatter: 2,
    blank:    0,
  },
  hot: {
    cherry:  12, lemon:  12, star:  12, bell: 10,
    bar:     14, diamond: 10, seven:  7, wild:  7, scatter: 3,
    blank:    0,
  },
};

// ── Cryptographically secure random ──────────────────────────────────────────
// Returns a float in [0, 1) using crypto.getRandomValues() so the PRNG state
// shared with Math.random() (used elsewhere in the process) cannot be used to
// predict slot outcomes.
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Divide by 2^32 to get a uniform float in [0, 1)
  return buf[0] / 0x1_0000_0000;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type Weights = Record<string, number>;

function pickFromWeights(weights: Weights): string {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = cryptoRandom() * total;
  for (const [id, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return id;
  }
  return Object.keys(weights).at(-1)!;
}

function pickMultiplier(): number {
  const total = CONFIG.SPIN_MULTIPLIERS.reduce((a, m) => a + m.weight, 0);
  let r = cryptoRandom() * total;
  for (const { mult, weight } of CONFIG.SPIN_MULTIPLIERS) {
    r -= weight;
    if (r <= 0) return mult;
  }
  return 1;
}

// ── Grid spin ─────────────────────────────────────────────────────────────────

/** Returns a 5×3 grid: grid[reelIndex][rowIndex] = symbolId */
export function spinGrid(bonusMode = false, oddsMode = "standard"): SymbolId[][] {
  const baseWeights = SYMBOL_WEIGHTS_BY_MODE[oddsMode] ?? CONFIG.SYMBOL_WEIGHTS;
  const weights: Weights = { ...baseWeights };
  if (bonusMode) weights["wild"] = CONFIG.BONUS_WILD_WEIGHT;

  return Array.from({ length: CONFIG.NUM_REELS }, () =>
    Array.from({ length: CONFIG.NUM_ROWS }, () =>
      pickFromWeights(weights) as SymbolId
    )
  );
}

// ── Win evaluation ────────────────────────────────────────────────────────────

export interface WinLine {
  symbol: SymbolId;
  reelCount: number;  // 3, 4, or 5
  ways: number;       // product of matching cells per reel
  rawPayout: number;  // chips before bonus/spin multiplier
  winningCells: [number, number][];  // [reelIdx, rowIdx] pairs
}

export interface EvalResult {
  wins: WinLine[];
  basePayout: number;      // sum of all win rawPayouts
  spinMultiplier: number;  // random bonus multiplier applied to basePayout
  bonusMultiplier: number; // multiplier from bonus round (1 during normal spin)
  totalPayout: number;     // floor(basePayout × spinMultiplier × bonusMultiplier)
  scatterCount: number;
  bonusSpinsAwarded: number;
  outcome: string;
}

export function evaluateGrid(
  grid: SymbolId[][],
  bet: number,
  bonusMultiplier = 1,
  applySpinMult = true,
  payScale = 1.0,   // RTP control: scales every pay multiplier (1.0 = base ~95% RTP)
): EvalResult {
  const wins: WinLine[] = [];

  const regularSymbols = (Object.keys(CONFIG.SYMBOL_PAYS) as SymbolId[]).filter(
    id => id !== "wild" && id !== "scatter" && id !== "blank",
  );

  for (const sym of regularSymbols) {
    const countsPerReel: number[] = [];
    const cellsPerReel: [number, number][][] = [];

    for (let r = 0; r < CONFIG.NUM_REELS; r++) {
      const matchingCells: [number, number][] = [];
      for (let row = 0; row < CONFIG.NUM_ROWS; row++) {
        if (grid[r][row] === sym || grid[r][row] === "wild") {
          matchingCells.push([r, row]);
        }
      }
      if (matchingCells.length === 0) break;
      countsPerReel.push(matchingCells.length);
      cellsPerReel.push(matchingCells);
    }

    const reelCount = countsPerReel.length;
    if (reelCount < CONFIG.MIN_MATCH) continue;

    const ways = countsPerReel.reduce((a, b) => a * b, 1);
    const payIdx = Math.min(reelCount - CONFIG.MIN_MATCH, 2);
    const payPerWay = CONFIG.SYMBOL_PAYS[sym][payIdx] ?? 0;
    // payScale adjusts the pay table directly — tight preset = lower wins, loose = higher
    const rawPayout = Math.floor(ways * payPerWay * bet * payScale);
    if (rawPayout <= 0) continue;

    const winningCells = cellsPerReel.flatMap(cells => cells);
    wins.push({ symbol: sym, reelCount, ways, rawPayout, winningCells });
  }

  // Scatter count — scatter symbols can land anywhere on the grid
  const allCells = grid.flat();
  const scatterCount = allCells.filter(c => c === "scatter").length;
  const bonusSpinsAwarded = CONFIG.SCATTER_BONUS_MAP[scatterCount] ?? 0;

  const basePayout = wins.reduce((s, w) => s + w.rawPayout, 0);
  const spinMultiplier = applySpinMult ? pickMultiplier() : 1;
  const uncapped = Math.floor(basePayout * spinMultiplier * bonusMultiplier);
  // Hard cap: a single spin can never pay more than MAX_WIN_MULTIPLIER × bet
  const totalPayout = Math.min(uncapped, Math.floor(bet * CONFIG.MAX_WIN_MULTIPLIER));
  const outcome = classifyOutcome(totalPayout, bet);

  return {
    wins,
    basePayout,
    spinMultiplier,
    bonusMultiplier,
    totalPayout,
    scatterCount,
    bonusSpinsAwarded,
    outcome,
  };
}

// ── Outcome classification ────────────────────────────────────────────────────

export function classifyOutcome(payout: number, bet: number): string {
  if (payout === 0) return "lose";
  const ratio = payout / bet;
  if (ratio >= 50) return "jackpot";
  if (ratio >= 15) return "big_win";
  if (ratio >= 3)  return "win";
  return "small_win";
}

// ── Bonus multiplier picker ───────────────────────────────────────────────────

export function pickBonusMultiplier(): number {
  return CONFIG.BONUS_MULT_MIN +
    Math.floor(cryptoRandom() * (CONFIG.BONUS_MULT_MAX - CONFIG.BONUS_MULT_MIN + 1));
}

// ── Simulation (for RTP tuning — no DB access) ────────────────────────────────

export interface SimResult {
  spins: number;
  bet: number;
  totalWagered: number;
  totalPaidOut: number;
  rtp: string;               // "91.23%"
  hitFrequency: string;      // "32.14%"
  bonusTriggerRate: string;  // "1.82%"
  averageWin: number;
  biggestWin: number;
  winDistribution: Record<string, number>;
}

export function simulate(spinCount: number, bet: number, payScale = 1.0, oddsMode = "standard"): SimResult {
  let totalWagered = 0;
  let totalPaidOut = 0;
  let hitCount = 0;
  let bonusCount = 0;
  let biggestWin = 0;
  const dist: Record<string, number> = {
    lose: 0, small_win: 0, win: 0, big_win: 0, jackpot: 0,
  };

  for (let i = 0; i < spinCount; i++) {
    totalWagered += bet;
    const grid = spinGrid(false, oddsMode);
    const result = evaluateGrid(grid, bet, 1, true, payScale);
    let spinPay = result.totalPayout;

    if (result.bonusSpinsAwarded > 0) {
      bonusCount++;
      const bMult = pickBonusMultiplier();
      for (let b = 0; b < result.bonusSpinsAwarded; b++) {
        const bg = spinGrid(true, oddsMode);
        const br = evaluateGrid(bg, bet, bMult, false, payScale);
        spinPay += br.totalPayout;
      }
    }

    totalPaidOut += spinPay;
    if (spinPay > 0) hitCount++;
    if (spinPay > biggestWin) biggestWin = spinPay;
    dist[result.outcome] = (dist[result.outcome] ?? 0) + 1;
  }

  return {
    spins: spinCount,
    bet,
    totalWagered,
    totalPaidOut,
    rtp:              `${((totalPaidOut / totalWagered) * 100).toFixed(2)}%`,
    hitFrequency:     `${((hitCount / spinCount) * 100).toFixed(2)}%`,
    bonusTriggerRate: `${((bonusCount / spinCount) * 100).toFixed(2)}%`,
    averageWin:       hitCount > 0 ? Math.round(totalPaidOut / hitCount) : 0,
    biggestWin,
    winDistribution:  dist,
  };
}

// ── Legacy SYMBOLS export (used by /status endpoint) ─────────────────────────

export const SYMBOLS = (Object.keys(CONFIG.SYMBOL_WEIGHTS) as SymbolId[]).map(id => ({
  id,
  display: {
    cherry: "🍒", lemon: "🍋", star: "⭐", bell: "🔔",
    bar: "BAR", diamond: "💎", seven: "7", wild: "🃏", scatter: "✦", blank: "🖕",
  }[id] ?? id,
  weight: CONFIG.SYMBOL_WEIGHTS[id],
}));
