export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Card = { rank: Rank; suit: Suit; hidden?: boolean };

const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

/**
 * Which totals the player may double down on.
 *   "any"  — any first-two-card total (most player-favorable)
 *   "9-11" — only hard totals 9, 10, or 11
 *   "none" — doubling is not permitted
 */
export type DoubleRule = "any" | "9-11" | "none";

/**
 * All knobs that legitimately affect long-run RTP.
 *
 * The shoe is ALWAYS dealt fairly — every card is the next card off a
 * cryptographically shuffled multi-deck shoe. There is no per-hand rigging,
 * no peeking ahead in the shoe, and no result manipulation. To change the
 * long-run RTP, adjust these rule parameters — nothing else.
 *
 * Expected RTPs under optimal (basic-strategy) play:
 *   hot      (S17, 3:2, double any, split)        ≈ 99.4%
 *   warm     (H17, 3:2, double any, split)        ≈ 99.2%
 *   standard (H17, 6:5, double any, split)        ≈ 97.8%
 *   cool     (H17, 6:5, double 9-11, split)       ≈ 97.5%
 *   cold     (H17, 6:5, double 9-11, no split)    ≈ 97.0%
 *   frozen   (H17, 6:5, no double, no split)      ≈ 95.7%
 *   glacier  (H17, 6:5, no double, no split, 8dk) ≈ 95.5%
 */
export interface BlackjackRules {
  /** Number of 52-card decks in the shoe (more decks → slightly lower player RTP). */
  numDecks: number;
  /** true = dealer hits soft 17 (H17); false = dealer stands on all 17 (S17). */
  dealerHitsSoft17: boolean;
  /** Blackjack payout multiplier on the bet: 1.5 = 3:2 (player-favorable), 1.2 = 6:5. */
  blackjackPayout: number;
  /** Rebuild the shoe once it falls below this many cards. */
  reshuffleAt: number;
  /** Which totals the player is allowed to double down on. */
  canDouble: DoubleRule;
  /** Whether the player may split a matching-rank pair. */
  canSplit: boolean;
}

/** All named rule presets, keyed by the backend oddsMode string. */
export const RULE_SETS: Record<string, BlackjackRules> = {
  /** Best rules for the player: S17, BJ pays 3:2, double anything, split. */
  hot: {
    numDecks: 6, dealerHitsSoft17: false, blackjackPayout: 1.5,
    reshuffleAt: 52, canDouble: "any", canSplit: true,
  },
  /** H17, BJ pays 3:2, double anything, split. */
  warm: {
    numDecks: 6, dealerHitsSoft17: true, blackjackPayout: 1.5,
    reshuffleAt: 52, canDouble: "any", canSplit: true,
  },
  /** H17, BJ pays 6:5, double anything, split. */
  standard: {
    numDecks: 6, dealerHitsSoft17: true, blackjackPayout: 1.2,
    reshuffleAt: 52, canDouble: "any", canSplit: true,
  },
  /** H17, BJ pays 6:5, double on 9-11 only, split. */
  cool: {
    numDecks: 6, dealerHitsSoft17: true, blackjackPayout: 1.2,
    reshuffleAt: 52, canDouble: "9-11", canSplit: true,
  },
  /** H17, BJ pays 6:5, double on 9-11 only, no split. */
  cold: {
    numDecks: 6, dealerHitsSoft17: true, blackjackPayout: 1.2,
    reshuffleAt: 52, canDouble: "9-11", canSplit: false,
  },
  /** H17, BJ pays 6:5, no double, no split. */
  frozen: {
    numDecks: 6, dealerHitsSoft17: true, blackjackPayout: 1.2,
    reshuffleAt: 52, canDouble: "none", canSplit: false,
  },
  /** H17, BJ pays 6:5, no double, no split, 8-deck shoe. */
  glacier: {
    numDecks: 8, dealerHitsSoft17: true, blackjackPayout: 1.2,
    reshuffleAt: 52, canDouble: "none", canSplit: false,
  },
};

/** Look up the rule set for a given backend oddsMode string. Defaults to "standard". */
export function getRulesForMode(mode: string): BlackjackRules {
  return RULE_SETS[mode] ?? RULE_SETS.standard;
}

/**
 * Backward-compatible constant — the "hot" rule set (highest player RTP).
 * Used as the default for all functions that accept an optional rules parameter.
 */
export const BLACKJACK_RULES: BlackjackRules = RULE_SETS.hot;

// ── Card / shoe ────────────────────────────────────────────────────────────

export function createDeck(numDecks = BLACKJACK_RULES.numDecks): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ rank, suit });
      }
    }
  }
  return shuffle(deck);
}

function cryptoRandInt(max: number): number {
  const needed = Math.ceil(Math.log2(max + 1));
  const mask = (1 << needed) - 1;
  const buf = new Uint32Array(1);
  let val: number;
  do { crypto.getRandomValues(buf); val = buf[0] & mask; } while (val > max);
  return val;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let pass = 0; pass < 2; pass++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = cryptoRandInt(i);
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}

/** True when the shoe should be replaced with a fresh, freshly-shuffled one. */
export function needsReshuffle(deck: Card[], rules: BlackjackRules = BLACKJACK_RULES): boolean {
  return deck.length < rules.reshuffleAt;
}

/**
 * Draw the next card off the top of the shoe. This is the ONLY way cards leave
 * the shoe during play — a plain, unbiased pop with no look-ahead.
 */
export function drawCard(deck: Card[]): Card {
  if (deck.length === 0) throw new Error("drawCard: shoe is empty");
  return deck.pop()!;
}

// ── Hand evaluation ────────────────────────────────────────────────────────

export function cardValue(rank: Rank): number {
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return parseInt(rank);
}

/**
 * Best (highest non-busting) total for a hand. Aces count as 11 until that would
 * bust, then drop to 1. Pure function of the cards passed — counts every card,
 * including face-down ones. Hide cards at the display layer, not here.
 */
export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/** A hand is "soft" when it holds an ace still counted as 11 (e.g. A-6 = soft 17). */
export function isSoftHand(cards: Card[]): boolean {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return aces > 0;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

// ── Rule enforcement helpers ───────────────────────────────────────────────

/**
 * Returns true if the player may double down on these first-two cards
 * under the given rules. Called by the room before accepting a double action.
 */
export function isDoubleAllowed(cards: Card[], rule: DoubleRule): boolean {
  if (rule === "any") return true;
  if (rule === "none") return false;
  const total = handValue(cards);
  if (rule === "9-11") return total >= 9 && total <= 11;
  return false;
}

// ── Dealer logic ───────────────────────────────────────────────────────────

/**
 * Whether the dealer must take another card, per the configured soft-17 rule.
 * Dealer always hits below 17. On exactly 17 the dealer hits only when the
 * hand is soft AND the rule set says hit soft 17 (H17).
 */
export function shouldDealerHit(cards: Card[], rules: BlackjackRules = BLACKJACK_RULES): boolean {
  const v = handValue(cards);
  if (v < 17) return true;
  if (v === 17 && rules.dealerHitsSoft17 && isSoftHand(cards)) return true;
  return false;
}

export function dealInitialHand(deck: Card[]): { playerCards: Card[]; dealerCards: Card[]; remainingDeck: Card[] } {
  const remaining = [...deck];
  const playerCards: Card[] = [drawCard(remaining), drawCard(remaining)];
  const dealerCards: Card[] = [drawCard(remaining), { ...drawCard(remaining), hidden: true }];
  return { playerCards, dealerCards, remainingDeck: remaining };
}

/**
 * Play out the dealer's hand to completion using fair draws and the configured
 * soft-17 rule. Reveals the hole card first.
 */
export function dealerPlay(dealerCards: Card[], deck: Card[], rules: BlackjackRules = BLACKJACK_RULES): { dealerCards: Card[]; remainingDeck: Card[] } {
  const remaining = [...deck];
  const cards = dealerCards.map((c) => ({ ...c, hidden: false }));
  while (shouldDealerHit(cards, rules)) {
    cards.push({ ...drawCard(remaining), hidden: false });
  }
  return { dealerCards: cards, remainingDeck: remaining };
}

// ── Winner / payout ────────────────────────────────────────────────────────

export type GameStatus = "active" | "player_bust" | "player_blackjack" | "dealer_bust" | "player_win" | "dealer_win" | "push";

export function determineWinner(playerCards: Card[], dealerCards: Card[]): GameStatus {
  const pv = handValue(playerCards);
  const dv = handValue(dealerCards);

  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  if (playerBJ && dealerBJ) return "push";
  if (playerBJ) return "player_blackjack";
  if (dealerBJ && pv < 21) return "dealer_win";

  if (pv > 21) return "player_bust";
  if (dv > 21) return "dealer_bust";
  if (pv > dv) return "player_win";
  if (dv > pv) return "dealer_win";
  return "push";
}

/**
 * Total chips returned to the player for a resolved hand (original bet + winnings).
 *   - player_blackjack → bet + (bet × rules.blackjackPayout), e.g. 3:2 or 6:5
 *   - player_win / dealer_bust → bet × 2 (1:1)
 *   - push → bet refunded
 *   - loss / bust → 0 (the already-deducted bet is kept by the house)
 */
export function calculatePayout(bet: number, status: GameStatus, rules: BlackjackRules = BLACKJACK_RULES): number {
  switch (status) {
    case "player_blackjack": return bet + Math.floor(bet * rules.blackjackPayout);
    case "player_win":
    case "dealer_bust": return bet * 2;
    case "push": return bet;
    default: return 0;
  }
}
