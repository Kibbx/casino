import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLACKJACK_RULES,
  createDeck,
  drawCard,
  needsReshuffle,
  cardValue,
  handValue,
  isSoftHand,
  isBust,
  isBlackjack,
  shouldDealerHit,
  dealInitialHand,
  dealerPlay,
  determineWinner,
  calculatePayout,
  type Card,
  type Rank,
} from "./blackjack-engine.ts";

// Helper: build a card. Suit is irrelevant to value, default to spades.
const c = (rank: Rank): Card => ({ rank, suit: "♠" });

/**
 * Build a deck whose cards will be drawn (via drawCard → pop from end) in the
 * given left-to-right order. So we push them reversed.
 */
const stacked = (...ranks: Rank[]): Card[] => ranks.map(c).reverse();

// ── Card values ──────────────────────────────────────────────────────────────

test("cardValue: face cards are 10, ace is 11, pips are face", () => {
  assert.equal(cardValue("K"), 10);
  assert.equal(cardValue("Q"), 10);
  assert.equal(cardValue("J"), 10);
  assert.equal(cardValue("10"), 10);
  assert.equal(cardValue("A"), 11);
  assert.equal(cardValue("2"), 2);
  assert.equal(cardValue("9"), 9);
});

test("handValue: ace counts as 11 then drops to 1 to avoid busting", () => {
  assert.equal(handValue([c("A"), c("9")]), 20); // ace = 11
  assert.equal(handValue([c("A"), c("9"), c("5")]), 15); // ace drops to 1
  assert.equal(handValue([c("A"), c("A")]), 12); // one ace 11, one ace 1
  assert.equal(handValue([c("A"), c("A"), c("9")]), 21); // 11 + 1 + 9
  assert.equal(handValue([c("A"), c("A"), c("A"), c("8")]), 21); // 11+1+1+8
});

test("handValue: counts every card including a face-down one", () => {
  const hand: Card[] = [c("10"), { rank: "7", suit: "♥", hidden: true }];
  assert.equal(handValue(hand), 17);
});

test("isSoftHand: true only when an ace is still counted as 11", () => {
  assert.equal(isSoftHand([c("A"), c("6")]), true); // soft 17
  assert.equal(isSoftHand([c("A"), c("7")]), true); // soft 18
  assert.equal(isSoftHand([c("A"), c("6"), c("10")]), false); // hard 17 (ace=1)
  assert.equal(isSoftHand([c("10"), c("7")]), false); // no ace
  assert.equal(isSoftHand([c("A"), c("A"), c("9")]), true); // 11+1+9 = soft 21
});

test("isBust / isBlackjack", () => {
  assert.equal(isBust([c("10"), c("10"), c("5")]), true);
  assert.equal(isBust([c("10"), c("9")]), false);
  assert.equal(isBlackjack([c("A"), c("K")]), true);
  assert.equal(isBlackjack([c("A"), c("9"), c("A")]), false); // 21 but 3 cards
  assert.equal(isBlackjack([c("10"), c("9")]), false);
});

// ── Dealer drawing rule (S17) ─────────────────────────────────────────────────

test("BLACKJACK_RULES default to a fair S17 / 3:2 / 6-deck shoe", () => {
  assert.equal(BLACKJACK_RULES.numDecks, 6);
  assert.equal(BLACKJACK_RULES.dealerHitsSoft17, false);
  assert.equal(BLACKJACK_RULES.blackjackPayout, 1.5);
});

test("shouldDealerHit: hits below 17, stands on all 17 under S17", () => {
  assert.equal(shouldDealerHit([c("10"), c("6")]), true); // hard 16
  assert.equal(shouldDealerHit([c("10"), c("7")]), false); // hard 17
  assert.equal(shouldDealerHit([c("A"), c("6")]), false); // soft 17 → S17 stands
  assert.equal(shouldDealerHit([c("A"), c("7")]), false); // soft 18 stands
  assert.equal(shouldDealerHit([c("10"), c("8")]), false); // 18 stands
});

test("dealerPlay: draws to >= 17 and reveals the hole card", () => {
  const dealer: Card[] = [c("10"), { rank: "6", suit: "♥", hidden: true }]; // 16
  const deck = stacked("5"); // next draw is a 5 → 21, then stop
  const { dealerCards, remainingDeck } = dealerPlay(dealer, deck);
  assert.equal(handValue(dealerCards), 21);
  assert.equal(dealerCards.every((card) => !card.hidden), true); // hole revealed
  assert.equal(remainingDeck.length, 0);
});

test("dealerPlay: stands immediately on soft 17 (S17), drawing nothing", () => {
  const dealer: Card[] = [c("A"), { rank: "6", suit: "♥", hidden: true }]; // soft 17
  const deck = stacked("5", "5", "5");
  const { dealerCards, remainingDeck } = dealerPlay(dealer, deck);
  assert.equal(dealerCards.length, 2); // no extra cards drawn
  assert.equal(handValue(dealerCards), 17);
  assert.equal(remainingDeck.length, 3); // deck untouched
});

// ── Outcome resolution ────────────────────────────────────────────────────────

test("determineWinner: player natural blackjack beats a non-blackjack dealer", () => {
  assert.equal(determineWinner([c("A"), c("K")], [c("10"), c("9")]), "player_blackjack");
});

test("determineWinner: blackjack vs blackjack is a push", () => {
  assert.equal(determineWinner([c("A"), c("K")], [c("A"), c("Q")]), "push");
});

test("determineWinner: player 21 (3 cards) vs dealer blackjack pushes", () => {
  // Player has 21 but not a natural; dealer has a natural BJ → both 21 → push
  assert.equal(determineWinner([c("7"), c("7"), c("7")], [c("A"), c("K")]), "push");
});

test("determineWinner: dealer blackjack beats a player below 21", () => {
  assert.equal(determineWinner([c("10"), c("9")], [c("A"), c("K")]), "dealer_win");
});

test("determineWinner: player bust loses even if dealer would also bust", () => {
  assert.equal(determineWinner([c("10"), c("10"), c("5")], [c("10"), c("6")]), "player_bust");
});

test("determineWinner: dealer bust wins for a standing player", () => {
  assert.equal(determineWinner([c("10"), c("8")], [c("10"), c("6"), c("8")]), "dealer_bust");
});

test("determineWinner: higher total wins; equal totals push", () => {
  assert.equal(determineWinner([c("10"), c("9")], [c("10"), c("8")]), "player_win");
  assert.equal(determineWinner([c("10"), c("7")], [c("10"), c("9")]), "dealer_win");
  assert.equal(determineWinner([c("10"), c("8")], [c("10"), c("8")]), "push");
});

// ── Payouts ───────────────────────────────────────────────────────────────────

test("calculatePayout: blackjack pays 3:2 (bet + 1.5x)", () => {
  assert.equal(calculatePayout(100, "player_blackjack"), 250); // 100 + 150
  assert.equal(calculatePayout(50, "player_blackjack"), 125); // 50 + 75
  assert.equal(calculatePayout(25, "player_blackjack"), 62); // 25 + floor(37.5)
});

test("calculatePayout: regular win / dealer bust pays 1:1 (bet returned + bet)", () => {
  assert.equal(calculatePayout(100, "player_win"), 200);
  assert.equal(calculatePayout(100, "dealer_bust"), 200);
});

test("calculatePayout: push refunds the bet; losses return nothing", () => {
  assert.equal(calculatePayout(100, "push"), 100);
  assert.equal(calculatePayout(100, "player_bust"), 0);
  assert.equal(calculatePayout(100, "dealer_win"), 0);
});

test("calculatePayout: a doubled wager pays out on the doubled amount", () => {
  // Doubling = playing the hand with twice the bet; a win returns 2x the doubled bet.
  const doubledBet = 200; // original 100, doubled
  assert.equal(calculatePayout(doubledBet, "player_win"), 400);
  assert.equal(calculatePayout(doubledBet, "push"), 200);
  assert.equal(calculatePayout(doubledBet, "player_bust"), 0);
});

// ── Shoe / dealing ──────────────────────────────────────────────────────────────

test("createDeck: builds 52 cards per deck, fully composed", () => {
  const one = createDeck(1);
  assert.equal(one.length, 52);
  assert.equal(one.filter((card) => card.rank === "A").length, 4);
  assert.equal(one.filter((card) => card.rank === "K").length, 4);
  assert.equal(createDeck(6).length, 312);
});

test("needsReshuffle: true once the shoe drops below the reshuffle threshold", () => {
  assert.equal(needsReshuffle(new Array(BLACKJACK_RULES.reshuffleAt) as Card[]), false);
  assert.equal(needsReshuffle(new Array(BLACKJACK_RULES.reshuffleAt - 1) as Card[]), true);
});

test("drawCard: removes and returns the top card; throws on an empty shoe", () => {
  const deck = stacked("A", "K"); // A drawn first, then K
  const before = deck.length;
  const first = drawCard(deck);
  assert.equal(first.rank, "A");
  assert.equal(deck.length, before - 1);
  const second = drawCard(deck);
  assert.equal(second.rank, "K");
  assert.equal(deck.length, 0);
  assert.throws(() => drawCard(deck), /shoe is empty/);
});

test("dealInitialHand: deals 2 to player and 2 to dealer (one hidden), shrinking the shoe by 4", () => {
  const deck = createDeck(1);
  const before = deck.length;
  const { playerCards, dealerCards, remainingDeck } = dealInitialHand(deck);
  assert.equal(playerCards.length, 2);
  assert.equal(dealerCards.length, 2);
  assert.equal(dealerCards[0].hidden ?? false, false); // upcard shown
  assert.equal(dealerCards[1].hidden, true); // hole card hidden
  assert.equal(remainingDeck.length, before - 4);
});

test("multi-hand continuity: consecutive deals keep drawing off the same shrinking shoe", () => {
  let deck = createDeck(6);
  const start = deck.length;
  const seen = new Set<Card>();
  // Deal three sequential hands off one shoe; every card must be distinct and the
  // shoe must shrink by exactly 4 each round.
  for (let round = 1; round <= 3; round++) {
    const { playerCards, dealerCards, remainingDeck } = dealInitialHand(deck);
    for (const card of [...playerCards, ...dealerCards]) {
      assert.equal(seen.has(card), false); // no card dealt twice
      seen.add(card);
    }
    assert.equal(remainingDeck.length, start - round * 4);
    deck = remainingDeck;
  }
  assert.equal(seen.size, 12);
});
