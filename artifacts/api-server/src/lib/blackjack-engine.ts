export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Card = { rank: Rank; suit: Suit; hidden?: boolean };

const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

export function createDeck(numDecks = 6): Card[] {
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

export function cardValue(rank: Rank): number {
  if (["J", "Q", "K"].includes(rank)) return 10;
  if (rank === "A") return 11;
  return parseInt(rank);
}

export function handValue(cards: Card[]): number {
  const visible = cards.filter((c) => !c.hidden);
  let total = 0;
  let aces = 0;
  for (const card of visible) {
    total += cardValue(card.rank);
    if (card.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

export function dealInitialHand(deck: Card[]): { playerCards: Card[]; dealerCards: Card[]; remainingDeck: Card[] } {
  const remaining = [...deck];
  const playerCards: Card[] = [remaining.pop()!, remaining.pop()!];
  const dealerCards: Card[] = [remaining.pop()!, { ...remaining.pop()!, hidden: true }];
  return { playerCards, dealerCards, remainingDeck: remaining };
}

export function dealerPlay(dealerCards: Card[], deck: Card[], oddsMode = "standard"): { dealerCards: Card[]; remainingDeck: Card[] } {
  const remaining = [...deck];
  const cards = dealerCards.map((c) => ({ ...c, hidden: false }));
  while (handValue(cards) < 17) {
    cards.push({ ...biasedDraw(remaining, oddsMode, handValue(cards), false), hidden: false });
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
 * Odds bias — applied at the DEALING level, not the result level.
 *
 * House-favoring modes (cool/cold/frozen/glacier):
 *   When a player is in the "danger zone" (hand value 12–16) and hits,
 *   we look ahead in the shoe for a 10-value card to deal them (likely bust).
 *   When the dealer is in the danger zone, we look for a non-10 card (keep dealer alive).
 *
 * Player-favoring modes (warm/hot):
 *   Opposite — protect players in danger zone, try to bust the dealer.
 *
 * "standard" → pure random draw, no peeking.
 *
 * The window controls how far ahead in the shoe we peek.
 * A larger window = more aggressive bias.
 */

const TEN_VALUE = new Set<Rank>(["10", "J", "Q", "K"]);
const NON_TEN   = new Set<Rank>(["A", "2", "3", "4", "5", "6", "7", "8", "9"]);

const HOUSE_WINDOW: Partial<Record<string, number>> = {
  glacier: 14,
  frozen:  10,
  cold:     7,
  cool:     4,
};
const PLAYER_WINDOW: Partial<Record<string, number>> = {
  hot:  14,
  warm:  7,
};

function findInWindow(deck: Card[], wanted: Set<Rank>, windowSize: number): Card | null {
  const start = Math.max(0, deck.length - windowSize);
  for (let i = deck.length - 1; i >= start; i--) {
    if (wanted.has(deck[i].rank)) {
      const [card] = deck.splice(i, 1);
      return card;
    }
  }
  return null;
}

/**
 * Draw the next card from the shoe, optionally biased by odds mode.
 * @param deck      Live shoe array (mutated in-place)
 * @param oddsMode  Current odds preset
 * @param handValue The value of the hand BEFORE this card is drawn
 * @param isPlayer  true = player drawing, false = dealer drawing
 */
export function biasedDraw(deck: Card[], oddsMode: string, handValue: number, isPlayer: boolean): Card {
  if (deck.length === 0) throw new Error("biasedDraw: deck empty");

  // Bias only applies in the danger zone where the next card decides bust/survive
  const inDangerZone = handValue >= 12 && handValue <= 16;
  if (!inDangerZone || oddsMode === "standard") return deck.pop()!;

  const houseWin = HOUSE_WINDOW[oddsMode];
  if (houseWin !== undefined) {
    // House mode: bust players, protect dealer
    const wanted = isPlayer ? TEN_VALUE : NON_TEN;
    return findInWindow(deck, wanted, houseWin) ?? deck.pop()!;
  }

  const playerWin = PLAYER_WINDOW[oddsMode];
  if (playerWin !== undefined) {
    // Player mode: protect players, bust dealer
    const wanted = isPlayer ? NON_TEN : TEN_VALUE;
    return findInWindow(deck, wanted, playerWin) ?? deck.pop()!;
  }

  return deck.pop()!;
}

/**
 * @deprecated Result-level bias. Kept only for the legacy single-player /api/blackjack/play
 * endpoint. Multi-player tables use biasedDraw() at deal-time instead.
 */
export function applyOddsBias(result: GameStatus, oddsMode: string, r = Math.random()): GameStatus {
  if (oddsMode === "glacier") {
    if ((result === "player_win" || result === "dealer_bust") && r < 0.32) return "push";
    if (result === "push" && r < 0.40) return "dealer_win";
  } else if (oddsMode === "frozen") {
    if ((result === "player_win" || result === "dealer_bust") && r < 0.22) return "push";
    if (result === "push" && r < 0.28) return "dealer_win";
  } else if (oddsMode === "cold") {
    if ((result === "player_win" || result === "dealer_bust") && r < 0.14) return "push";
    if (result === "push" && r < 0.18) return "dealer_win";
  } else if (oddsMode === "cool") {
    if ((result === "player_win" || result === "dealer_bust") && r < 0.07) return "push";
    if (result === "push" && r < 0.09) return "dealer_win";
  } else if (oddsMode === "warm") {
    if (result === "dealer_win" && r < 0.06) return "push";
    if (result === "push" && r < 0.04) return "player_win";
  } else if (oddsMode === "hot") {
    if (result === "dealer_win" && r < 0.13) return "push";
    if (result === "push" && r < 0.09) return "player_win";
  }
  return result;
}

export function calculatePayout(bet: number, status: GameStatus): number {
  switch (status) {
    case "player_blackjack": return Math.floor(bet * 2.5);
    case "player_win":
    case "dealer_bust": return bet * 2;
    case "push": return bet;
    default: return 0;
  }
}
