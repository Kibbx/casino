export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Card = { rank: Rank; suit: Suit; hidden?: boolean };

const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

/**
 * Blackjack rule configuration — the ONLY levers that affect house edge / RTP.
 *
 * The shoe is ALWAYS dealt fairly: every card dealt is the next card off a
 * cryptographically shuffled multi-deck shoe. There is no per-hand rigging, no
 * peeking ahead in the shoe, and no result manipulation. To change the long-run
 * RTP, adjust these rules — nothing else.
 *
 * Current rule set:
 *   - 6-deck shoe, reshuffled when it runs low
 *   - Dealer STANDS on all 17, including soft 17 ("S17") — player-favorable
 *   - Blackjack pays 3:2 (1.5x)
 *   - Player may double on any first two cards; double after split allowed
 *   - Split once on a matching rank pair
 *   - No surrender; dealer checks the hole card for blackjack
 *
 * Expected long-run RTP under optimal (basic-strategy) play with this rule set
 * is ~99.5% (house edge ~0.5%). Run `pnpm --filter @workspace/api-server simulate:blackjack`
 * to measure it empirically.
 */
export const BLACKJACK_RULES = {
  /** Number of 52-card decks in the shoe. */
  numDecks: 6,
  /** true = dealer hits soft 17 (H17); false = dealer stands on all 17 (S17). */
  dealerHitsSoft17: false,
  /** Blackjack payout multiplier on the bet (1.5 = 3:2, 1.2 = 6:5). */
  blackjackPayout: 1.5,
  /** Build a fresh shoe once the live shoe drops below this many cards. */
  reshuffleAt: 52,
} as const;

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
export function needsReshuffle(deck: Card[]): boolean {
  return deck.length < BLACKJACK_RULES.reshuffleAt;
}

/**
 * Draw the next card off the top of the shoe. This is the ONLY way cards leave
 * the shoe during play — it is a plain, unbiased pop with no look-ahead.
 */
export function drawCard(deck: Card[]): Card {
  if (deck.length === 0) throw new Error("drawCard: shoe is empty");
  return deck.pop()!;
}

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
  // Any ace left after reduction is still being counted as 11 → soft.
  return aces > 0;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

/**
 * Whether the dealer must take another card, per the configured soft-17 rule.
 * Dealer always hits below 17. On exactly 17 the dealer hits only when the hand
 * is soft AND the house rule says hit soft 17.
 */
export function shouldDealerHit(cards: Card[]): boolean {
  const v = handValue(cards);
  if (v < 17) return true;
  if (v === 17 && BLACKJACK_RULES.dealerHitsSoft17 && isSoftHand(cards)) return true;
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
export function dealerPlay(dealerCards: Card[], deck: Card[]): { dealerCards: Card[]; remainingDeck: Card[] } {
  const remaining = [...deck];
  const cards = dealerCards.map((c) => ({ ...c, hidden: false }));
  while (shouldDealerHit(cards)) {
    cards.push({ ...drawCard(remaining), hidden: false });
  }
  return { dealerCards: cards, remainingDeck: remaining };
}

export type GameStatus = "active" | "player_bust" | "player_blackjack" | "dealer_bust" | "player_win" | "dealer_win" | "push";

export function determineWinner(playerCards: Card[], dealerCards: Card[]): GameStatus {
  const pv = handValue(playerCards);
  const dv = handValue(dealerCards);

  const playerBJ = isBlackjack(playerCards);
  const dealerBJ = isBlackjack(dealerCards);

  // Both blackjack → push (neither gets the BJ bonus)
  if (playerBJ && dealerBJ) return "push";
  // Player blackjack, dealer does not → player wins with bonus
  if (playerBJ) return "player_blackjack";
  // Dealer blackjack, player does not have blackjack → dealer wins
  // Exception: player 21 (non-BJ) vs dealer BJ → push (both scored 21)
  if (dealerBJ && pv < 21) return "dealer_win";

  if (pv > 21) return "player_bust";
  if (dv > 21) return "dealer_bust";
  if (pv > dv) return "player_win";
  if (dv > pv) return "dealer_win";
  return "push";
}

/**
 * Total chips returned to the player for a resolved hand (original bet + winnings).
 *   - player_blackjack → bet + 3:2 (or whatever BLACKJACK_RULES.blackjackPayout is)
 *   - player_win / dealer_bust → bet + 1:1
 *   - push → bet refunded
 *   - loss / bust → 0 (the already-deducted bet is kept by the house)
 */
export function calculatePayout(bet: number, status: GameStatus): number {
  switch (status) {
    case "player_blackjack": return bet + Math.floor(bet * BLACKJACK_RULES.blackjackPayout);
    case "player_win":
    case "dealer_bust": return bet * 2;
    case "push": return bet;
    default: return 0;
  }
}
