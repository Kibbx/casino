export type WheelType = "european" | "american";

export const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
export const BLACK_NUMBERS = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

export function getNumberColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === -1) return "green"; // -1 = 00
  if (RED_NUMBERS.has(n)) return "red";
  return "black";
}

// Cryptographically strong integer in [0, max)
function cryptoRandInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

// Track last few results globally to prevent immediate repeats
const recentResults: number[] = [];
const HISTORY_SIZE = 3;

/**
 * Spin the wheel with optional odds bias.
 * standard → pure random
 * warm     → if spin lands on green, 33% chance to re-spin (mild player bias)
 * hot      → if spin lands on green, 65% chance to re-spin (strong player bias)
 *
 * Note: cold/cool bias is handled upstream in roulette-room.ts with bet-aware logic
 * (forces a pocket that nobody is betting on rather than always forcing green).
 */
export function spinWheel(wheelType: WheelType, oddsMode: string = "standard"): number {
  const total = wheelType === "american" ? 38 : 37;

  let result: number;
  let attempts = 0;
  do {
    const idx = cryptoRandInt(total);
    result = idx === 37 ? -1 : idx;
    attempts++;
  } while (recentResults.includes(result) && attempts < 10);

  // Player-biased modes: if natural spin hits green, chance to re-spin (player-favoring)
  const hotChance = oddsMode === "hot" ? 0.65 : oddsMode === "warm" ? 0.33 : 0;
  if (hotChance > 0 && (result === 0 || result === -1) && Math.random() < hotChance) {
    let reroll: number;
    let ra = 0;
    do {
      const idx = cryptoRandInt(total);
      reroll = idx === 37 ? -1 : idx;
      ra++;
    } while ((reroll === 0 || reroll === -1) && ra < 5);
    result = reroll;
  }

  // House-biased cold modes (glacier/frozen) are handled in roulette-room.ts via
  // smart-bias (tilts toward pockets players aren't covering) — no dumb re-spin here.

  recentResults.push(result);
  if (recentResults.length > HISTORY_SIZE) recentResults.shift();

  return result;
}

export type BetType =
  | "straight"   // 1 number, 35:1
  | "split"      // 2 numbers, 17:1
  | "street"     // 3 numbers (a row), 11:1
  | "corner"     // 4 numbers, 8:1
  | "sixline"    // 6 numbers (2 rows), 5:1
  | "dozen"      // 12 numbers (1-12, 13-24, 25-36), 2:1
  | "column"     // 12 numbers (col 1/2/3), 2:1
  | "red"        // 1:1
  | "black"      // 1:1
  | "odd"        // 1:1
  | "even"       // 1:1
  | "low"        // 1-18, 1:1
  | "high";      // 19-36, 1:1

export const BET_PAYOUTS: Record<BetType, number> = {
  straight: 35,
  split:    17,
  street:   11,
  corner:    8,
  sixline:   5,
  dozen:     2,
  column:    2,
  red:       1,
  black:     1,
  odd:       1,
  even:      1,
  low:       1,
  high:      1,
};

export interface Bet {
  type: BetType;
  numbers: number[]; // winning numbers for this bet (empty = determined by type)
  amount: number;
  placedAt?: number; // epoch ms when this bet was placed
}

export interface BetResult extends Bet {
  won: boolean;
  payout: number; // chips returned (0 if lost, amount + winnings if won)
}

export function evaluateBet(bet: Bet, winning: number): BetResult {
  let won = false;
  const isZero = winning === 0 || winning === -1;

  switch (bet.type) {
    case "straight":
      won = bet.numbers.includes(winning);
      break;
    case "split":
    case "street":
    case "corner":
    case "sixline":
      won = bet.numbers.includes(winning);
      break;
    case "dozen":
      if (!isZero) {
        if (bet.numbers[0] === 1) won = winning >= 1 && winning <= 12;
        else if (bet.numbers[0] === 2) won = winning >= 13 && winning <= 24;
        else won = winning >= 25 && winning <= 36;
      }
      break;
    case "column":
      if (!isZero) {
        if (bet.numbers[0] === 1) won = winning % 3 === 1;
        else if (bet.numbers[0] === 2) won = winning % 3 === 2;
        else won = winning % 3 === 0;
      }
      break;
    case "red":
      won = !isZero && RED_NUMBERS.has(winning);
      break;
    case "black":
      won = !isZero && BLACK_NUMBERS.has(winning);
      break;
    case "odd":
      won = !isZero && winning % 2 !== 0;
      break;
    case "even":
      won = !isZero && winning % 2 === 0;
      break;
    case "low":
      won = !isZero && winning >= 1 && winning <= 18;
      break;
    case "high":
      won = !isZero && winning >= 19 && winning <= 36;
      break;
  }

  const payout = won ? bet.amount + bet.amount * BET_PAYOUTS[bet.type] : 0;
  return { ...bet, won, payout };
}

export function evaluateAllBets(bets: Bet[], winning: number): BetResult[] {
  return bets.map((b) => evaluateBet(b, winning));
}
