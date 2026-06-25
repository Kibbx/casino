export type Suit = "H" | "D" | "C" | "S";
export type Rank = "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "T" | "J" | "Q" | "K" | "A";
export type Card = string; // e.g. "AH", "2C", "KD"

export type SeatStatus = "empty" | "sitting" | "sitting_out" | "folded" | "allIn";
export type GamePhase = "preflop" | "flop" | "turn" | "river" | "showdown";
export type PlayerAction = "fold" | "check" | "call" | "raise";

export interface Seat {
  seatIndex: number;
  playerId: number | null;
  playerName: string | null;
  playerAvatarUrl?: string | null;
  chips: number | null;
  status: SeatStatus;
  currentBet: number;
  timebankSeconds?: number; // player's current timebank, persisted with seat
  afkFolds?: number;        // consecutive AFK auto-folds; reset on any real action
  afkSinceMs?: number;      // timestamp of first AFK fold; used for tournament long-AFK removal
}

export interface SidePot {
  amount: number;
  eligibleSeats: number[];
}

export interface WinnerInfo {
  seatIndex: number;
  playerId: number;
  playerName: string;
  amount: number;
  handDescription: string;
  rakeCollected: number;
}

export interface GameState {
  phase: GamePhase;
  pot: number;
  currentBet: number;
  currentPlayerSeat: number;
  communityCards: Card[];
  playerHands: Record<number, Card[]>; // seatIndex -> cards
  dealerSeat: number;
  smallBlindSeat: number;
  bigBlindSeat: number;
  sidePots: SidePot[];
  playerContributions: Record<number, number>; // seatIndex -> total chips put in this hand
  winners: WinnerInfo[] | null;
  showdownHands: Record<number, string> | null; // seatIndex -> hand description, populated at showdown
  deck: Card[];
  bettingComplete: boolean;
  actedSeats: number[]; // legacy — kept for backward compat, superseded by owesAction
  owesAction: number[]; // seat indices that still owe action in this betting round
  turnStartedAt: number | null; // ms timestamp when current player's turn began
}

const RANKS: Rank[] = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_NAMES: Record<string, string> = {
  "2": "Twos", "3": "Threes", "4": "Fours", "5": "Fives",
  "6": "Sixes", "7": "Sevens", "8": "Eights", "9": "Nines",
  "T": "Tens", "J": "Jacks", "Q": "Queens", "K": "Kings", "A": "Aces",
};
const RANK_HIGH: Record<string, string> = {
  "2": "Two", "3": "Three", "4": "Four", "5": "Five",
  "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine",
  "T": "Ten", "J": "Jack", "Q": "Queen", "K": "King", "A": "Ace",
};
const SUITS: Suit[] = ["H", "D", "C", "S"];

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return shuffle(deck);
}

/** Cryptographically secure Fisher-Yates shuffle.
 *  Uses crypto.getRandomValues() so the result cannot be predicted from
 *  Math.random() state (which is shared across the process). */
function cryptoRandInt(max: number): number {
  // Rejection-sample to avoid modulo bias
  const needed = Math.ceil(Math.log2(max + 1));
  const mask = (1 << needed) - 1;
  const buf = new Uint32Array(1);
  let val: number;
  do {
    crypto.getRandomValues(buf);
    val = buf[0] & mask;
  } while (val > max);
  return val;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  // Double-shuffle: two independent passes to guarantee thorough mixing
  for (let pass = 0; pass < 2; pass++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = cryptoRandInt(i);
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  return a;
}

function rankValue(rank: string): number {
  return RANKS.indexOf(rank as Rank);
}

function getCardRank(card: Card): string {
  return card.slice(0, -1);
}

function getCardSuit(card: Card): string {
  return card.slice(-1);
}

// Hand evaluation
type HandRank = [number, ...number[]]; // [handType, ...tiebreakers]

function evaluateHand(holeCards: Card[], communityCards: Card[]): [HandRank, string] {
  const all = [...holeCards, ...communityCards];
  if (all.length < 5) return [[0], "High Card"];

  const combos = getCombinations(all, 5);
  let best: HandRank = [0];
  let bestDesc = "High Card";

  for (const combo of combos) {
    const [rank, desc] = evaluate5(combo);
    if (compareHandRanks(rank, best) > 0) {
      best = rank;
      bestDesc = desc;
    }
  }

  return [best, bestDesc];
}

function getCombinations(arr: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function evaluate5(cards: Card[]): [HandRank, string] {
  const ranks = cards.map(getCardRank).sort((a, b) => rankValue(b) - rankValue(a));
  const suits = cards.map(getCardSuit);
  const rankVals = ranks.map(rankValue);

  const flush = suits.every((s) => s === suits[0]);
  const straight = checkStraight(rankVals);
  const counts = getCounts(ranks);
  const countValues = Object.values(counts).sort((a, b) => b - a);
  const ranksByCount = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || rankValue(b[0]) - rankValue(a[0]))
    .map(([r]) => r);

  const topRank = ranksByCount[0] ?? ranks[0];
  const secondRank = ranksByCount[1] ?? ranks[1];

  if (flush && straight !== null) {
    // Royal Flush = Ace-high (index 12) straight flush
    if (straight === 12) return [[8, straight], "Royal Flush"];
    return [[8, straight], `Straight Flush, ${RANK_HIGH[RANKS[straight]]}-high`];
  }
  if (countValues[0] === 4) return [[7, ...ranksByCount.map(rankValue)], `Four of a Kind, ${RANK_NAMES[topRank]}`];
  if (countValues[0] === 3 && countValues[1] === 2) return [[6, ...ranksByCount.map(rankValue)], `Full House, ${RANK_NAMES[topRank]} over ${RANK_NAMES[secondRank]}`];
  if (flush) return [[5, ...rankVals], `Flush, ${RANK_HIGH[ranks[0]]}-high`];
  if (straight !== null) return [[4, straight], `Straight, ${RANK_HIGH[RANKS[straight]]}-high`];
  if (countValues[0] === 3) return [[3, ...ranksByCount.map(rankValue)], `Three of a Kind, ${RANK_NAMES[topRank]}`];
  if (countValues[0] === 2 && countValues[1] === 2) return [[2, ...ranksByCount.map(rankValue)], `Two Pair, ${RANK_NAMES[topRank]} and ${RANK_NAMES[secondRank]}`];
  if (countValues[0] === 2) return [[1, ...ranksByCount.map(rankValue)], `One Pair, ${RANK_NAMES[topRank]}`];
  return [[0, ...rankVals], `High Card, ${RANK_HIGH[ranks[0]]}`];
}

function checkStraight(rankVals: number[]): number | null {
  const sorted = [...new Set(rankVals)].sort((a, b) => b - a);
  if (sorted.length < 5) return null;

  // Check for A-2-3-4-5
  if (sorted[0] === 12 && sorted.slice(-4).join(",") === "3,2,1,0") return 3;

  for (let i = 0; i <= sorted.length - 5; i++) {
    const slice = sorted.slice(i, i + 5);
    if (slice[0] - slice[4] === 4 && new Set(slice).size === 5) return slice[0];
  }
  return null;
}

function getCounts(ranks: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  return counts;
}

function compareHandRanks(a: HandRank, b: HandRank): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? -1;
    const bv = b[i] ?? -1;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Get next active seat
export function nextActiveSeat(seats: Seat[], from: number, skipAllIn = false): number {
  const active = seats.filter((s) => {
    if (!s.playerId) return false;
    if (s.status === "folded") return false;
    if (s.status === "sitting_out") return false;
    if (skipAllIn && s.status === "allIn") return false;
    return true;
  });

  if (active.length === 0) return from;

  const indices = active.map((s) => s.seatIndex);
  const next = indices.find((i) => i > from) ?? indices[0];
  return next;
}

export function activeSeatCount(seats: Seat[]): number {
  return seats.filter((s) => s.playerId && s.status !== "folded" && s.status !== "sitting_out").length;
}

export function nonFoldedSeats(seats: Seat[]): Seat[] {
  return seats.filter((s) => s.playerId && s.status !== "folded" && s.status !== "sitting_out");
}

export function initGame(seats: Seat[], smallBlind: number, bigBlind: number, currentDealerSeat: number): GameState {
  const deck = createDeck();
  const active = seats.filter((s) => s.playerId && s.status === "sitting");

  // Find dealer (rotate from current)
  const activeIndices = active.map((s) => s.seatIndex);
  const dealerIdx = activeIndices.find((i) => i > currentDealerSeat) ?? activeIndices[0];
  const sbIdx = nextActiveSeat(active, dealerIdx, false);
  const bbIdx = nextActiveSeat(active, sbIdx, false);
  // skipAllIn=true so the initial acting seat is never an all-in player
  const firstPlayerIdx = nextActiveSeat(active, bbIdx, true);

  // Deal 2 cards to each player
  const playerHands: Record<number, Card[]> = {};
  let deckIdx = 0;
  for (const seat of active) {
    playerHands[seat.seatIndex] = [deck[deckIdx++], deck[deckIdx++]];
    seat.currentBet = 0;
    seat.status = "sitting";
  }
  const remainingDeck = deck.slice(deckIdx);

  // Post blinds
  const sbSeat = active.find((s) => s.seatIndex === sbIdx)!;
  const bbSeat = active.find((s) => s.seatIndex === bbIdx)!;

  const sbAmount = Math.min(smallBlind, sbSeat.chips ?? 0);
  const bbAmount = Math.min(bigBlind, bbSeat.chips ?? 0);

  sbSeat.chips = (sbSeat.chips ?? 0) - sbAmount;
  sbSeat.currentBet = sbAmount;
  if (sbSeat.chips === 0) sbSeat.status = "allIn";

  bbSeat.chips = (bbSeat.chips ?? 0) - bbAmount;
  bbSeat.currentBet = bbAmount;
  if (bbSeat.chips === 0) bbSeat.status = "allIn";

  const playerContributions: Record<number, number> = {};
  for (const seat of active) playerContributions[seat.seatIndex] = 0;
  playerContributions[sbIdx] = (playerContributions[sbIdx] ?? 0) + sbAmount;
  playerContributions[bbIdx] = (playerContributions[bbIdx] ?? 0) + bbAmount;

  // Preflop: every non-allIn sitting player owes action (including BB for their option)
  const preflopOwes = active
    .filter((s) => s.status !== "allIn")
    .map((s) => s.seatIndex);

  return {
    phase: "preflop",
    pot: sbAmount + bbAmount,
    currentBet: bbAmount,
    currentPlayerSeat: firstPlayerIdx,
    communityCards: [],
    playerHands,
    dealerSeat: dealerIdx,
    smallBlindSeat: sbIdx,
    bigBlindSeat: bbIdx,
    sidePots: [],
    playerContributions,
    winners: null,
    showdownHands: null,
    deck: remainingDeck,
    bettingComplete: false,
    actedSeats: [],
    owesAction: preflopOwes,
    turnStartedAt: Date.now(),
  };
}

export function processAction(
  seats: Seat[],
  gameState: GameState,
  seatIndex: number,
  action: PlayerAction,
  raiseAmount: number = 0,
  rakePercent: number,
  rakeCap: number,
): { seats: Seat[]; gameState: GameState; playerChipChange: number; playerId: number } {
  const seat = seats.find((s) => s.seatIndex === seatIndex)!;
  const playerId = seat.playerId!;
  let playerChipChange = 0;

  // ── Safety guard: if owesAction is already empty this street, auto-advance ──
  // This handles the edge case where all players went all-in before this action
  // was received (e.g. both blinds went all-in and the action queue still fired).
  const currentOwes = gameState.owesAction ?? computeFallbackOwesAction(seats, gameState);
  if (currentOwes.length === 0 && nonFoldedSeats(seats).length > 1) {
    console.log(`[poker] Guard: owesAction already empty on action entry — auto-advancing ${gameState.phase}`);
    return advancePhase(
      seats.map((s) => ({ ...s })),
      { ...gameState, actedSeats: gameState.actedSeats ?? [], owesAction: [], sidePots: [...gameState.sidePots], playerContributions: { ...(gameState.playerContributions ?? {}) } },
      rakePercent, rakeCap, seat.playerId!, 0,
    );
  }
  if (currentOwes.length === 0 && nonFoldedSeats(seats).length <= 1) {
    return resolveHand(
      seats.map((s) => ({ ...s })),
      { ...gameState, actedSeats: gameState.actedSeats ?? [], owesAction: [], sidePots: [...gameState.sidePots], playerContributions: { ...(gameState.playerContributions ?? {}) } },
      rakePercent, rakeCap, seat.playerId!, 0,
    );
  }

  const newSeats = seats.map((s) => ({ ...s }));
  const newState = {
    ...gameState,
    sidePots: [...gameState.sidePots],
    actedSeats: [...(gameState.actedSeats ?? [])],
    owesAction: [...currentOwes],
    playerContributions: { ...(gameState.playerContributions ?? {}) },
  };
  const newSeat = newSeats.find((s) => s.seatIndex === seatIndex)!;

  switch (action) {
    case "fold":
      newSeat.status = "folded";
      newState.actedSeats = [...newState.actedSeats, seatIndex];
      // Remove acting player from owesAction; folded players can never owe action
      newState.owesAction = newState.owesAction.filter((s) => s !== seatIndex);
      break;

    case "check":
      newState.actedSeats = [...newState.actedSeats, seatIndex];
      newState.owesAction = newState.owesAction.filter((s) => s !== seatIndex);
      break;

    case "call": {
      const callAmount = Math.min(newState.currentBet - newSeat.currentBet, newSeat.chips ?? 0);
      newSeat.chips = (newSeat.chips ?? 0) - callAmount;
      newSeat.currentBet += callAmount;
      newState.pot += callAmount;
      newState.playerContributions[seatIndex] = (newState.playerContributions[seatIndex] ?? 0) + callAmount;
      playerChipChange = -callAmount;
      if (newSeat.chips === 0) newSeat.status = "allIn";
      newState.actedSeats = [...newState.actedSeats, seatIndex];
      // Player has matched the bet (or gone all-in) — no longer owes action
      newState.owesAction = newState.owesAction.filter((s) => s !== seatIndex);
      break;
    }

    case "raise": {
      const callNeeded = newState.currentBet - newSeat.currentBet;
      const totalRequired = callNeeded + raiseAmount;
      const actualAmount = Math.min(totalRequired, newSeat.chips ?? 0);
      newSeat.chips = (newSeat.chips ?? 0) - actualAmount;
      newSeat.currentBet += actualAmount;
      newState.pot += actualAmount;
      newState.playerContributions[seatIndex] = (newState.playerContributions[seatIndex] ?? 0) + actualAmount;
      newState.currentBet = newSeat.currentBet;
      playerChipChange = -actualAmount;
      if (newSeat.chips === 0) newSeat.status = "allIn";
      // Reset actedSeats (legacy) — raiser resets the round
      newState.actedSeats = [seatIndex];
      // Raise reopens action: every non-folded, non-allIn player except the raiser owes action again
      // (even if they already acted earlier in this round)
      newState.owesAction = newSeats
        .filter(
          (s) =>
            s.playerId &&
            s.status !== "folded" &&
            s.status !== "sitting_out" &&
            s.status !== "allIn" &&
            s.seatIndex !== seatIndex,
        )
        .map((s) => s.seatIndex);
      break;
    }
  }

  // After every action: debug log
  const owesLog = newState.owesAction.map((si) => {
    const s = newSeats.find((x) => x.seatIndex === si);
    return `seat${si}(${s?.playerName ?? "?"})`;
  });
  console.log(
    `[poker] ${newState.phase} | action=${action} by seat${seatIndex} | currentBet=${newState.currentBet}` +
    ` | pot=${newState.pot} | owesAction=[${owesLog.join(", ")}]`,
  );
  newSeats.filter((s) => s.playerId).forEach((s) => {
    console.log(
      `  seat${s.seatIndex}(${s.playerName}) chips=${s.chips} currentBet=${s.currentBet}` +
      ` status=${s.status} owes=${newState.owesAction.includes(s.seatIndex)}`,
    );
  });

  // Determine next player
  const allFolded = nonFoldedSeats(newSeats).length <= 1;

  if (allFolded) {
    console.log(`[poker] All folded — resolving hand`);
    return resolveHand(newSeats, newState, rakePercent, rakeCap, playerId, playerChipChange);
  }

  // Check if betting round is complete
  const roundComplete = checkBettingComplete(newSeats, newState);
  console.log(`[poker] roundComplete=${roundComplete}`);

  if (roundComplete) {
    console.log(`[poker] Advancing street: ${newState.phase} -> next`);
    return advancePhase(newSeats, newState, rakePercent, rakeCap, playerId, playerChipChange);
  }

  // Move to next player who still owes action
  const nextSeat = nextOwingPlayer(newSeats, newState, seatIndex);
  newState.currentPlayerSeat = nextSeat;
  newState.turnStartedAt = Date.now();
  console.log(`[poker] Next acting seat: ${nextSeat}`);

  return { seats: newSeats, gameState: newState, playerChipChange, playerId };
}

/**
 * Called immediately after initGame (or any hand-start) to handle the edge case
 * where all players went all-in while posting blinds so owesAction starts empty.
 * Returns a settled state (possibly with winners set) or the original state unchanged.
 */
export function autoAdvanceIfNeeded(
  seats: Seat[],
  gameState: GameState,
  rakePercent: number,
  rakeCap: number,
): { seats: Seat[]; gameState: GameState } {
  const owes = gameState.owesAction ?? [];
  const nonFolded = nonFoldedSeats(seats);

  if (owes.length > 0) return { seats, gameState }; // normal — someone still needs to act

  if (nonFolded.length <= 1) {
    // Only one player standing — resolve hand immediately
    console.log(`[poker] autoAdvance: single non-folded player — resolving hand`);
    const result = resolveHand(
      seats.map((s) => ({ ...s })),
      { ...gameState, sidePots: [...gameState.sidePots], playerContributions: { ...(gameState.playerContributions ?? {}) } },
      rakePercent, rakeCap, nonFolded[0]?.playerId ?? -1, 0,
    );
    return { seats: result.seats, gameState: result.gameState };
  }

  // Everyone is all-in — run out the board automatically
  console.log(`[poker] autoAdvance: owesAction empty after hand start — running board for ${gameState.phase}`);
  const result = advancePhase(
    seats.map((s) => ({ ...s })),
    { ...gameState, sidePots: [...gameState.sidePots], playerContributions: { ...(gameState.playerContributions ?? {}) } },
    rakePercent, rakeCap, -1, 0,
  );
  return { seats: result.seats, gameState: result.gameState };
}

/**
 * Fallback owesAction computation for legacy game states that predate the owesAction field.
 * Mirrors the old actedSeats logic so in-progress hands don't break on upgrade.
 */
function computeFallbackOwesAction(seats: Seat[], gameState: GameState): number[] {
  const actedSet = new Set(gameState.actedSeats ?? []);
  return seats
    .filter(
      (s) =>
        s.playerId &&
        s.status === "sitting" &&
        (!actedSet.has(s.seatIndex) || s.currentBet < gameState.currentBet),
    )
    .map((s) => s.seatIndex);
}

/**
 * Pick the next seat that OWES action, cycling forward from `from`.
 * Falls back to nextActiveSeat if owesAction is somehow empty (shouldn't happen after roundComplete check).
 */
function nextOwingPlayer(seats: Seat[], gameState: GameState, from: number): number {
  const owing = gameState.owesAction ?? [];
  if (owing.length === 0) return nextActiveSeat(seats, from, true);

  // Wrap-around search: first try indices > from, then wrap to start
  const after = owing.filter((si) => si > from);
  if (after.length > 0) return Math.min(...after);
  return Math.min(...owing);
}

function checkBettingComplete(seats: Seat[], gameState: GameState): boolean {
  // Primary check: use owesAction — round is over when nobody owes action
  if (gameState.owesAction != null) {
    return gameState.owesAction.length === 0;
  }

  // Fallback for legacy game states (should not normally be reached after engine upgrade)
  const sitting = seats.filter((s) => s.playerId && s.status === "sitting");
  if (sitting.length === 0) return true;
  const allMatched = sitting.every((s) => s.currentBet === gameState.currentBet || s.chips === 0);
  if (!allMatched) return false;
  const actedSet = new Set(gameState.actedSeats ?? []);
  return sitting.every((s) => actedSet.has(s.seatIndex));
}

function advancePhase(
  seats: Seat[],
  gameState: GameState,
  rakePercent: number,
  rakeCap: number,
  lastPlayerId: number,
  chipChange: number,
): { seats: Seat[]; gameState: GameState; playerChipChange: number; playerId: number } {
  // Reset bets and action tracking for new round
  const newSeats = seats.map((s) => ({ ...s, currentBet: 0 }));

  // All non-folded, non-allIn, non-sitting_out players owe action on the new street
  const newStreetOwes = seats
    .filter(
      (s) =>
        s.playerId &&
        s.status !== "folded" &&
        s.status !== "sitting_out" &&
        s.status !== "allIn",
    )
    .map((s) => s.seatIndex);

  const newState = { ...gameState, currentBet: 0, actedSeats: [] as number[], owesAction: newStreetOwes };

  const phases: GamePhase[] = ["preflop", "flop", "turn", "river", "showdown"];
  const currentIdx = phases.indexOf(newState.phase);
  const nextPhase = phases[currentIdx + 1] ?? "showdown";

  // Deal community cards
  let deck = [...newState.deck];
  const community = [...newState.communityCards];

  if (nextPhase === "flop") {
    deck = deck.slice(1); // burn
    community.push(deck.shift()!, deck.shift()!, deck.shift()!);
  } else if (nextPhase === "turn" || nextPhase === "river") {
    deck = deck.slice(1);
    community.push(deck.shift()!);
  }

  newState.communityCards = community;
  newState.deck = deck;
  newState.phase = nextPhase;

  if (nextPhase === "showdown") {
    return resolveHand(newSeats, newState, rakePercent, rakeCap, lastPlayerId, chipChange);
  }

  // If every non-folded, non-sitting-out player is all-in, nobody can act —
  // automatically run out the remaining board cards straight to showdown.
  const canStillAct = newSeats.filter(
    (s) => s.playerId && s.status !== "folded" && s.status !== "sitting_out" && s.status !== "allIn"
  );
  if (canStillAct.length === 0) {
    return advancePhase(newSeats, newState, rakePercent, rakeCap, lastPlayerId, chipChange);
  }

  // Find first active player after dealer who owes action
  const firstSeat = nextOwingPlayer(newSeats, newState, newState.dealerSeat);
  newState.currentPlayerSeat = firstSeat;
  newState.turnStartedAt = Date.now();

  console.log(
    `[poker] Street advanced to ${newState.phase} | owesAction=[${newState.owesAction.join(",")}] | firstSeat=${firstSeat}`,
  );

  return { seats: newSeats, gameState: newState, playerChipChange: chipChange, playerId: lastPlayerId };
}

// Build side pots from player contributions when all-in players are involved.
// Returns list of {amount, eligible} ordered from main pot → side pots.
function buildSidePots(seats: Seat[], contributions: Record<number, number>): { amount: number; eligible: Seat[] }[] {
  const nonFolded = seats.filter((s) => s.playerId && s.status !== "folded" && s.status !== "sitting_out");

  // No all-in players → single main pot
  if (!nonFolded.some((s) => s.status === "allIn")) {
    const total = Object.values(contributions).reduce((s, v) => s + v, 0);
    return [{ amount: total, eligible: nonFolded }];
  }

  // Mutable copy of contributions (tracks what's left to assign to pots)
  const remaining: Record<number, number> = {};
  for (const [k, v] of Object.entries(contributions)) remaining[Number(k)] = v;

  // Sorted cumulative caps from all-in players (ascending total contribution)
  const allinCaps = nonFolded
    .filter((s) => s.status === "allIn")
    .map((s) => contributions[s.seatIndex] ?? 0)
    .filter((v) => v > 0);
  const uniqueCaps = [...new Set(allinCaps)].sort((a, b) => a - b);

  const pots: { amount: number; eligible: Seat[] }[] = [];
  let prevCap = 0;

  for (const cap of uniqueCaps) {
    // Each player contributes the INCREMENT between this cap and previous cap
    const increment = cap - prevCap;
    let potAmount = 0;
    for (const si of Object.keys(remaining)) {
      const take = Math.min(remaining[Number(si)] ?? 0, increment);
      potAmount += take;
      remaining[Number(si)] -= take;
    }
    // Eligible: non-folded players whose TOTAL contribution is at least `cap`
    const eligible = nonFolded.filter((s) => (contributions[s.seatIndex] ?? 0) >= cap);
    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible });
    }
    prevCap = cap;
  }

  // Final pot: remaining contributions after all all-in caps processed.
  // Only players who still have remaining chips in this pot are eligible.
  const finalAmount = Object.values(remaining).reduce((s, v) => s + v, 0);
  if (finalAmount > 0) {
    const eligible = nonFolded.filter((s) => (remaining[s.seatIndex] ?? 0) > 0);
    pots.push({ amount: finalAmount, eligible });
  }

  return pots;
}

function resolveHand(
  seats: Seat[],
  gameState: GameState,
  rakePercent: number,
  rakeCap: number,
  lastPlayerId: number,
  chipChange: number,
): { seats: Seat[]; gameState: GameState; playerChipChange: number; playerId: number } {
  const newSeats = seats.map((s) => ({ ...s }));
  const newState = { ...gameState, phase: "showdown" as GamePhase };

  const eligible = nonFoldedSeats(newSeats);

  // Calculate rake on total pot (taken from first/main pot)
  const rawRake = Math.floor((newState.pot * rakePercent) / 100);
  const rake = Math.min(rawRake, rakeCap);

  let winners: WinnerInfo[];

  if (eligible.length === 1) {
    // Last player standing — no split possible
    const w = eligible[0];
    const seat = newSeats.find((s) => s.seatIndex === w.seatIndex)!;
    seat.chips = (seat.chips ?? 0) + (newState.pot - rake);
    winners = [{
      seatIndex: w.seatIndex,
      playerId: w.playerId!,
      playerName: w.playerName!,
      amount: newState.pot - rake,
      handDescription: "Last player standing",
      rakeCollected: rake,
    }];
  } else {
    // Evaluate all non-folded hands
    const showdownHands: Record<number, string> = {};
    const ranked: { seat: Seat; rank: HandRank; desc: string }[] = [];

    for (const seat of eligible) {
      const holeCards = newState.playerHands[seat.seatIndex] ?? [];
      const [rank, desc] = evaluateHand(holeCards, newState.communityCards);
      ranked.push({ seat, rank, desc });
      showdownHands[seat.seatIndex] = desc;
    }
    newState.showdownHands = showdownHands;

    // Build side pots based on player contributions.
    // If contributions aren't tracked (old game state), fall back to single pot.
    const contributions = newState.playerContributions ?? {};
    const totalContrib = Object.values(contributions).reduce((s, v) => s + v, 0);
    const pots = totalContrib > 0
      ? buildSidePots(newSeats, contributions)
      : [{ amount: newState.pot, eligible }];

    // Apply rake to the first (main) pot only
    let rakeRemaining = rake;

    // Accumulate winnings per seat across all pots
    const potWinnings: Record<number, number> = {};
    const potDescriptions: Record<number, string> = {};

    for (const pot of pots) {
      const potRake = Math.min(rakeRemaining, pot.amount);
      const prizePool = pot.amount - potRake;
      rakeRemaining -= potRake;

      // Find best rank among eligible seats for this pot
      const eligibleRanked = ranked.filter((r) =>
        pot.eligible.some((e) => e.seatIndex === r.seat.seatIndex)
      );
      let bestRank: HandRank = [0];
      for (const { rank } of eligibleRanked) {
        if (compareHandRanks(rank, bestRank) > 0) bestRank = rank;
      }
      const tiedSeats = eligibleRanked.filter(({ rank }) => compareHandRanks(rank, bestRank) === 0);

      const splitAmount = Math.floor(prizePool / tiedSeats.length);
      const remainder = prizePool - splitAmount * tiedSeats.length;

      tiedSeats.forEach(({ seat, desc }, i) => {
        const won = splitAmount + (i === 0 ? remainder : 0);
        potWinnings[seat.seatIndex] = (potWinnings[seat.seatIndex] ?? 0) + won;
        potDescriptions[seat.seatIndex] = desc;
        const winnerSeat = newSeats.find((s) => s.seatIndex === seat.seatIndex)!;
        winnerSeat.chips = (winnerSeat.chips ?? 0) + won;
      });
    }

    // Build winners list (seats that won anything)
    winners = Object.entries(potWinnings)
      .filter(([, amount]) => amount > 0)
      .map(([siStr], idx) => {
        const si = Number(siStr);
        const seat = eligible.find((s) => s.seatIndex === si)!;
        return {
          seatIndex: si,
          playerId: seat.playerId!,
          playerName: seat.playerName!,
          amount: potWinnings[si],
          handDescription: potDescriptions[si],
          rakeCollected: idx === 0 ? rake : 0,
        };
      });
  }

  newState.winners = winners;
  newState.phase = "showdown";

  return { seats: newSeats, gameState: newState, playerChipChange: chipChange, playerId: lastPlayerId };
}
