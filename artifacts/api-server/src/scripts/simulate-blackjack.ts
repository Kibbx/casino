/**
 * Dev-only Blackjack RTP simulation.
 *
 * Plays a large number of hands using textbook basic strategy against the fair
 * engine and reports win/loss/push/blackjack rates, RTP, and house edge. This is
 * how we verify the rule set yields the expected ~99.5% RTP WITHOUT any per-hand
 * rigging — the only levers are in BLACKJACK_RULES.
 *
 * Run:  pnpm --filter @workspace/api-server simulate:blackjack [hands]
 *
 * This script is never imported by the server and never auto-runs in production;
 * it only executes when invoked directly from the command line.
 */
import {
  BLACKJACK_RULES,
  createDeck,
  drawCard,
  needsReshuffle,
  cardValue,
  handValue,
  isSoftHand,
  isBlackjack,
  dealerPlay,
  type Card,
} from "../lib/blackjack-engine.ts";

type Move = "H" | "S" | "D" | "P";

const upValue = (card: Card): number => cardValue(card.rank); // ace = 11

const isPair = (cards: Card[]): boolean =>
  cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);

/**
 * Textbook basic strategy for a 4–8 deck shoe, dealer stands on soft 17, double
 * allowed on any two cards, double-after-split allowed. Returns the ideal move;
 * callers downgrade D→H when doubling is not permitted.
 */
function basicStrategy(cards: Card[], dealerUp: Card, canDouble: boolean, canSplit: boolean): Move {
  const d = upValue(dealerUp); // 2..11 (11 = ace)
  const total = handValue(cards);

  // Pairs
  if (canSplit && isPair(cards)) {
    const pv = cardValue(cards[0].rank);
    if (pv === 11) return "P"; // A,A
    if (pv === 10) return "S"; // 10,10 never split
    if (pv === 9) return d === 7 || d === 10 || d === 11 ? "S" : "P"; // 9,9
    if (pv === 8) return "P"; // 8,8
    if (pv === 7) return d <= 7 ? "P" : "H";
    if (pv === 6) return d <= 6 ? "P" : "H";
    if (pv === 5) return d <= 9 ? (canDouble ? "D" : "H") : "H"; // treat as hard 10
    if (pv === 4) return d === 5 || d === 6 ? "P" : "H";
    if (pv === 3 || pv === 2) return d <= 7 ? "P" : "H";
  }

  // Soft totals (an ace counted as 11)
  if (isSoftHand(cards)) {
    if (total >= 20) return "S"; // soft 20/21
    if (total === 19) return "S"; // A,8
    if (total === 18) {
      if (d >= 3 && d <= 6 && canDouble) return "D";
      if (d === 2 || d === 7 || d === 8) return "S";
      return "H"; // 9,10,A
    }
    if (total === 17) return d >= 3 && d <= 6 && canDouble ? "D" : "H";
    if (total === 16 || total === 15) return d >= 4 && d <= 6 && canDouble ? "D" : "H";
    if (total === 14 || total === 13) return d >= 5 && d <= 6 && canDouble ? "D" : "H";
    return "H";
  }

  // Hard totals
  if (total >= 17) return "S";
  if (total >= 13 && total <= 16) return d <= 6 ? "S" : "H";
  if (total === 12) return d >= 4 && d <= 6 ? "S" : "H";
  if (total === 11) return canDouble ? "D" : "H";
  if (total === 10) return d <= 9 && canDouble ? "D" : "H";
  if (total === 9) return d >= 3 && d <= 6 && canDouble ? "D" : "H";
  return "H"; // 8 or less
}

type FinalHand = { cards: Card[]; bet: number };

/**
 * Play out one player position (recursively for splits). Returns every resulting
 * hand with the wager committed to it (doubles carry 2x). Aces split take one
 * card each and stop. Re-splitting is allowed up to a small cap.
 */
function playPlayer(cards: Card[], dealerUp: Card, deck: Card[], bet: number, splitsLeft: number): FinalHand[] {
  const move = basicStrategy(cards, dealerUp, cards.length === 2, isPair(cards) && splitsLeft > 0);

  if (move === "P") {
    const isAces = cards[0].rank === "A";
    const h1: Card[] = [cards[0], drawCard(deck)];
    const h2: Card[] = [cards[1], drawCard(deck)];
    if (isAces) {
      // Split aces: exactly one card each, no further play.
      return [{ cards: h1, bet }, { cards: h2, bet }];
    }
    return [
      ...playPlayer(h1, dealerUp, deck, bet, splitsLeft - 1),
      ...playPlayer(h2, dealerUp, deck, bet, splitsLeft - 1),
    ];
  }

  if (move === "D" && cards.length === 2) {
    const doubled = [...cards, drawCard(deck)];
    return [{ cards: doubled, bet: bet * 2 }];
  }

  // Hit/stand loop (D downgrades to H when we can no longer double).
  const hand = [...cards];
  while (true) {
    const m = basicStrategy(hand, dealerUp, false, false);
    if (m === "H" || m === "D") {
      hand.push(drawCard(deck));
      if (handValue(hand) > 21) break;
    } else {
      break;
    }
  }
  return [{ cards: hand, bet }];
}

function main() {
  const rounds = Math.max(1, parseInt(process.argv[2] ?? "100000", 10) || 100000);
  const baseBet = 100;

  let deck: Card[] = createDeck();

  let totalWagered = 0;
  let totalReturned = 0;
  let handsResolved = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let blackjacks = 0;
  let doubles = 0;
  let splitRounds = 0;

  const t0 = Date.now();

  for (let round = 0; round < rounds; round++) {
    if (needsReshuffle(deck)) deck = createDeck();

    // Initial deal (player two, dealer two with a hole card).
    const player: Card[] = [drawCard(deck), drawCard(deck)];
    const dealer: Card[] = [drawCard(deck), { ...drawCard(deck), hidden: true }];
    const dealerUp = dealer[0];

    const playerBJ = isBlackjack(player);
    const dealerBJ = isBlackjack(dealer);

    // Naturals settle immediately, before any drawing.
    if (playerBJ || dealerBJ) {
      totalWagered += baseBet;
      handsResolved++;
      if (playerBJ && dealerBJ) {
        totalReturned += baseBet; // push
        pushes++;
      } else if (playerBJ) {
        totalReturned += baseBet + Math.floor(baseBet * BLACKJACK_RULES.blackjackPayout); // 3:2
        wins++;
        blackjacks++;
      } else {
        losses++; // dealer natural, nothing returned
      }
      continue;
    }

    // Player plays out (with splits/doubles), then the dealer plays once.
    const finalHands = playPlayer(player, dealerUp, deck, baseBet, 3);
    if (finalHands.length > 1) splitRounds++;
    for (const h of finalHands) if (h.bet > baseBet) doubles++;

    const { dealerCards } = dealerPlay(dealer, deck);
    const dv = handValue(dealerCards);

    for (const hand of finalHands) {
      const pv = handValue(hand.cards);
      totalWagered += hand.bet;
      handsResolved++;
      if (pv > 21) {
        losses++; // player bust
      } else if (dv > 21 || pv > dv) {
        totalReturned += hand.bet * 2; // win 1:1 (post-split 21 is NOT a 3:2 blackjack)
        wins++;
      } else if (pv < dv) {
        losses++;
      } else {
        totalReturned += hand.bet; // push
        pushes++;
      }
    }
  }

  const ms = Date.now() - t0;
  const rtp = (totalReturned / totalWagered) * 100;
  const houseEdge = 100 - rtp;
  const pct = (n: number) => ((n / handsResolved) * 100).toFixed(2) + "%";

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Blackjack fair-engine simulation (basic strategy)");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Rules            : ${BLACKJACK_RULES.numDecks} decks, ` +
    `${BLACKJACK_RULES.dealerHitsSoft17 ? "H17" : "S17"}, ` +
    `BJ pays ${BLACKJACK_RULES.blackjackPayout}:1, reshuffle < ${BLACKJACK_RULES.reshuffleAt}`);
  console.log(`  Rounds dealt     : ${rounds.toLocaleString()}`);
  console.log(`  Hands resolved   : ${handsResolved.toLocaleString()} (incl. splits)`);
  console.log(`  Split rounds     : ${splitRounds.toLocaleString()}`);
  console.log(`  Double hands     : ${doubles.toLocaleString()}`);
  console.log("  ─────────────────────────────────────────────────────");
  console.log(`  Wins             : ${wins.toLocaleString()} (${pct(wins)})`);
  console.log(`  Losses           : ${losses.toLocaleString()} (${pct(losses)})`);
  console.log(`  Pushes           : ${pushes.toLocaleString()} (${pct(pushes)})`);
  console.log(`  Blackjacks       : ${blackjacks.toLocaleString()} (${pct(blackjacks)})`);
  console.log("  ─────────────────────────────────────────────────────");
  console.log(`  Total wagered    : ${totalWagered.toLocaleString()}`);
  console.log(`  Total returned   : ${totalReturned.toLocaleString()}`);
  console.log(`  RTP              : ${rtp.toFixed(3)}%`);
  console.log(`  House edge       : ${houseEdge.toFixed(3)}%`);
  console.log(`  Elapsed          : ${ms.toLocaleString()} ms`);
  console.log("══════════════════════════════════════════════════════════");
  console.log("");

  if (rtp < 97 || rtp > 101) {
    console.error(`⚠️  RTP ${rtp.toFixed(3)}% is outside the expected fair band (~98–100%).`);
    process.exit(1);
  }
  console.log("✅ RTP is within the expected fair band for basic strategy.");
}

main();
