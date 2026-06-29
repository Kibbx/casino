/**
 * Dev-only Blackjack RTP simulation.
 *
 * Plays rounds using textbook basic strategy against the fair engine and reports
 * win/loss/push/blackjack rates, RTP, and house edge for each configured mode.
 * This verifies that each named rule set yields the expected long-run RTP WITHOUT
 * any per-hand rigging — the only levers are in RULE_SETS.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server simulate:blackjack              # all modes, 100k rounds each
 *   pnpm --filter @workspace/api-server simulate:blackjack 50000        # all modes, 50k rounds each
 *   pnpm --filter @workspace/api-server simulate:blackjack 100000 hot   # one mode only
 *
 * This script is never imported by the server and never auto-runs in production.
 */
import {
  RULE_SETS, getRulesForMode, createDeck, drawCard, needsReshuffle,
  cardValue, handValue, isSoftHand, isBlackjack, dealerPlay,
  type BlackjackRules, type Card,
} from "../lib/blackjack-engine.ts";

type Move = "H" | "S" | "D" | "P";

const upValue = (card: Card): number => cardValue(card.rank);

const isPair = (cards: Card[]): boolean =>
  cards.length === 2 && cardValue(cards[0].rank) === cardValue(cards[1].rank);

function canDoubleCards(cards: Card[], rules: BlackjackRules): boolean {
  if (cards.length !== 2) return false;
  if (rules.canDouble === "none") return false;
  if (rules.canDouble === "any") return true;
  const total = handValue(cards);
  return total >= 9 && total <= 11;
}

/**
 * Textbook basic strategy (adapted per rule set double/split constraints).
 * Returns the ideal move; callers downgrade D→H when doubling is not permitted.
 */
function basicStrategy(cards: Card[], dealerUp: Card, canDouble: boolean, canSplit: boolean): Move {
  const d = upValue(dealerUp);
  const total = handValue(cards);

  if (canSplit && isPair(cards)) {
    const pv = cardValue(cards[0].rank);
    if (pv === 11) return "P";
    if (pv === 10) return "S";
    if (pv === 9) return d === 7 || d === 10 || d === 11 ? "S" : "P";
    if (pv === 8) return "P";
    if (pv === 7) return d <= 7 ? "P" : "H";
    if (pv === 6) return d <= 6 ? "P" : "H";
    if (pv === 5) return d <= 9 && canDouble ? "D" : "H";
    if (pv === 4) return d === 5 || d === 6 ? "P" : "H";
    if (pv === 3 || pv === 2) return d <= 7 ? "P" : "H";
  }

  if (isSoftHand(cards)) {
    if (total >= 20) return "S";
    if (total === 19) return "S";
    if (total === 18) {
      if (d >= 3 && d <= 6 && canDouble) return "D";
      if (d === 2 || d === 7 || d === 8) return "S";
      return "H";
    }
    if (total === 17) return d >= 3 && d <= 6 && canDouble ? "D" : "H";
    if (total === 16 || total === 15) return d >= 4 && d <= 6 && canDouble ? "D" : "H";
    if (total === 14 || total === 13) return d >= 5 && d <= 6 && canDouble ? "D" : "H";
    return "H";
  }

  if (total >= 17) return "S";
  if (total >= 13 && total <= 16) return d <= 6 ? "S" : "H";
  if (total === 12) return d >= 4 && d <= 6 ? "S" : "H";
  if (total === 11) return canDouble ? "D" : "H";
  if (total === 10) return d <= 9 && canDouble ? "D" : "H";
  if (total === 9) return d >= 3 && d <= 6 && canDouble ? "D" : "H";
  return "H";
}

type FinalHand = { cards: Card[]; bet: number };

/**
 * Play out one player position (recursively for splits). Returns every resulting
 * hand with the wager committed to it. Respects the mode's double/split rules.
 */
function playPlayer(
  cards: Card[], dealerUp: Card, deck: Card[], bet: number,
  splitsLeft: number, rules: BlackjackRules,
): FinalHand[] {
  const canDbl = canDoubleCards(cards, rules);
  const canSpl = rules.canSplit && isPair(cards) && splitsLeft > 0;
  const move = basicStrategy(cards, dealerUp, canDbl, canSpl);

  if (move === "P") {
    const isAces = cards[0].rank === "A";
    const h1: Card[] = [cards[0], drawCard(deck)];
    const h2: Card[] = [cards[1], drawCard(deck)];
    if (isAces) return [{ cards: h1, bet }, { cards: h2, bet }];
    return [
      ...playPlayer(h1, dealerUp, deck, bet, splitsLeft - 1, rules),
      ...playPlayer(h2, dealerUp, deck, bet, splitsLeft - 1, rules),
    ];
  }

  if (move === "D" && cards.length === 2) {
    return [{ cards: [...cards, drawCard(deck)], bet: bet * 2 }];
  }

  const hand = [...cards];
  while (true) {
    const m = basicStrategy(hand, dealerUp, false, false);
    if (m === "H" || m === "D") {
      hand.push(drawCard(deck));
      if (handValue(hand) > 21) break;
    } else break;
  }
  return [{ cards: hand, bet }];
}

interface SimResult {
  rounds: number; handsResolved: number; splitRounds: number; doubles: number;
  wins: number; losses: number; pushes: number; blackjacks: number;
  totalWagered: number; totalReturned: number; elapsed: number;
}

function runMode(rules: BlackjackRules, rounds: number, baseBet: number): SimResult {
  let deck: Card[] = createDeck(rules.numDecks);
  let totalWagered = 0, totalReturned = 0, handsResolved = 0;
  let wins = 0, losses = 0, pushes = 0, blackjacks = 0, doubles = 0, splitRounds = 0;
  const t0 = Date.now();

  for (let round = 0; round < rounds; round++) {
    if (needsReshuffle(deck, rules)) deck = createDeck(rules.numDecks);

    const player: Card[] = [drawCard(deck), drawCard(deck)];
    const dealer: Card[] = [drawCard(deck), { ...drawCard(deck), hidden: true }];
    const dealerUp = dealer[0];
    const playerBJ = isBlackjack(player);
    const dealerBJ = isBlackjack(dealer);

    if (playerBJ || dealerBJ) {
      totalWagered += baseBet;
      handsResolved++;
      if (playerBJ && dealerBJ) { totalReturned += baseBet; pushes++; }
      else if (playerBJ) {
        totalReturned += baseBet + Math.floor(baseBet * rules.blackjackPayout);
        wins++; blackjacks++;
      } else { losses++; }
      continue;
    }

    const finalHands = playPlayer(player, dealerUp, deck, baseBet, 3, rules);
    if (finalHands.length > 1) splitRounds++;
    for (const h of finalHands) if (h.bet > baseBet) doubles++;

    const { dealerCards } = dealerPlay(dealer, deck, rules);
    const dv = handValue(dealerCards);

    for (const hand of finalHands) {
      const pv = handValue(hand.cards);
      totalWagered += hand.bet;
      handsResolved++;
      if (pv > 21) { losses++; }
      else if (dv > 21 || pv > dv) { totalReturned += hand.bet * 2; wins++; }
      else if (pv < dv) { losses++; }
      else { totalReturned += hand.bet; pushes++; }
    }
  }

  return {
    rounds, handsResolved, splitRounds, doubles, wins, losses, pushes, blackjacks,
    totalWagered, totalReturned, elapsed: Date.now() - t0,
  };
}

function printResult(modeName: string, rules: BlackjackRules, r: SimResult) {
  const rtp = (r.totalReturned / r.totalWagered) * 100;
  const edge = 100 - rtp;
  const pct = (n: number) => ((n / r.handsResolved) * 100).toFixed(2) + "%";
  const dblLabel = rules.canDouble === "any" ? "any 2 cards" : rules.canDouble === "9-11" ? "totals 9-11" : "none";
  console.log("──────────────────────────────────────────────────────────");
  console.log(`  Mode: ${modeName.toUpperCase().padEnd(10)}  RTP ${rtp.toFixed(3)}%   House edge ${edge.toFixed(3)}%`);
  console.log(`  Rules : ${rules.numDecks}dk · ${rules.dealerHitsSoft17 ? "H17" : "S17"} · BJ pays ${rules.blackjackPayout === 1.5 ? "3:2" : "6:5"} · double ${dblLabel} · split ${rules.canSplit ? "yes" : "no"}`);
  console.log(`  Rounds ${r.rounds.toLocaleString()} | Hands ${r.handsResolved.toLocaleString()} | ${r.elapsed.toLocaleString()} ms`);
  console.log(`  Wins ${pct(r.wins)} | Losses ${pct(r.losses)} | Pushes ${pct(r.pushes)} | BJ ${pct(r.blackjacks)}`);
}

function main() {
  const args = process.argv.slice(2);
  const rounds = Math.max(1, parseInt(args[0] ?? "100000", 10) || 100000);
  const baseBet = 100;
  const modeArg = args[1];

  const allModes = ["glacier", "frozen", "cold", "cool", "standard", "warm", "hot"] as const;
  const modesToRun: string[] = modeArg ? [modeArg] : [...allModes];

  console.log("");
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Blackjack multi-mode RTP simulation (basic strategy)");
  console.log(`  ${rounds.toLocaleString()} rounds per mode · ${modesToRun.length} mode(s)`);
  console.log("══════════════════════════════════════════════════════════");
  console.log("");

  const summary: { mode: string; rtp: number }[] = [];
  let anyFailed = false;

  for (const modeName of modesToRun) {
    const rules = getRulesForMode(modeName);
    const result = runMode(rules, rounds, baseBet);
    const rtp = (result.totalReturned / result.totalWagered) * 100;
    printResult(modeName, rules, result);
    summary.push({ mode: modeName, rtp });
    if (rtp < 93 || rtp > 101) {
      console.error(`  ⚠️  RTP ${rtp.toFixed(3)}% is outside the expected fair band (93–101%).`);
      anyFailed = true;
    } else {
      console.log(`  ✅ Fair`);
    }
    console.log("");
  }

  if (modesToRun.length > 1) {
    console.log("══════════════════════════════════════════════════════════");
    console.log("  SUMMARY — RTP by admin-configured mode");
    console.log("══════════════════════════════════════════════════════════");
    for (const { mode, rtp } of summary) {
      const bar = "█".repeat(Math.round((rtp - 90) / 2));
      console.log(`  ${mode.padEnd(10)} ${rtp.toFixed(2).padStart(6)}%  ${bar}`);
    }
    console.log("");
  }

  if (anyFailed) process.exit(1);
}

main();
