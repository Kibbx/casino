/**
 * blackjack-room.ts
 * Multi-table multiplayer blackjack — class-based, server-authoritative.
 *
 * Phase lifecycle:
 *   WAITING → BETTING → DEALING → PLAYER_TURNS → DEALER_TURN → RESOLUTION → RESETTING → BETTING
 */

import { WebSocket } from "ws";
import { db, playersTable, transactionsTable, settingsTable, blackjackTablesTable, blackjackHandsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordPlayerActivity } from "./player-activity.js";
import {
  createDeck, handValue, isBust, isBlackjack,
  determineWinner, calculatePayout, biasedDraw,
  type Card,
} from "./blackjack-engine.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BJPhase =
  | "WAITING"
  | "BETTING"
  | "DEALING"
  | "PLAYER_TURNS"
  | "DEALER_TURN"
  | "RESOLUTION"
  | "RESETTING";

export type SeatStatus =
  | "empty"
  | "seated"
  | "bet_placed"
  | "active"
  | "standing"
  | "busted"
  | "blackjack"
  | "finished";

export interface BJSeat {
  seatIndex: number;
  playerId: number | null;
  username: string | null;
  avatarUrl: string | null;
  chips: number;
  status: SeatStatus;
  bet: number;
  cards: Card[];
  splitCards: Card[] | null;
  splitBet: number;
  activeHand: "main" | "split";
  result: string | null;
  splitResult: string | null;
  payout: number;
  splitPayout: number;
}

interface BJSub {
  ws: WebSocket;
  playerId: number | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface BJTableConfig {
  id: number;
  name: string;
  minBet: number;
  maxBet: number;
  numSeats: number;
  theme: string;
  isOpen: boolean;
  passwordHash: string | null;
  houseEdge: number;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const NUM_DECKS = 6;
const BETTING_MS = 10_000;
const DEALING_MS = 2_000;
const TURN_TIMEOUT_MS = 12_000;
const DEALER_REVEAL_MS = 1_000;   // pause after hole-card reveal before first draw
const DEALER_CARD_MS  = 1_200;    // pause between each dealer card draw
const DEALER_STAND_MS = 1_200;    // pause after dealer stands before resolution
const RESOLUTION_MS = 2_000;
const RESETTING_MS = 1_500;

// ── Injected dependency ────────────────────────────────────────────────────────

type BroadcastBalanceFn = (playerId: number, chips: number) => void;
let _broadcastBalance: BroadcastBalanceFn = () => {};
export function injectBJBroadcastBalance(fn: BroadcastBalanceFn) {
  _broadcastBalance = fn;
}

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

// ── BlackjackRoom class ────────────────────────────────────────────────────────

export class BlackjackRoom {
  readonly tableId: number;
  name: string;
  minBet: number;
  maxBet: number;
  readonly numSeats: number;
  theme: string;
  isOpen: boolean;
  passwordHash: string | null;
  houseEdge: number;

  private roundCounter = 0;
  private phase: BJPhase = "WAITING";
  private seats: BJSeat[];
  private dealerCards: Card[] = [];
  private deck: Card[];
  private currentTurnSeat: number | null = null;
  private phaseEndsAt: number | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private subs: Set<BJSub> = new Set();
  /** Players with a DB-backed action currently in flight — prevents double-fire on slow connections */
  private actingPlayers: Set<number> = new Set();
  /** Odds mode cached at the start of each round — used for biased dealing */
  private roundOddsMode = "standard";

  constructor(cfg: BJTableConfig) {
    this.tableId = cfg.id;
    this.name = cfg.name;
    this.minBet = cfg.minBet;
    this.maxBet = cfg.maxBet;
    this.numSeats = cfg.numSeats;
    this.theme = cfg.theme;
    this.isOpen = cfg.isOpen;
    this.passwordHash = cfg.passwordHash;
    this.houseEdge = cfg.houseEdge ?? 2.5;
    this.deck = createDeck(NUM_DECKS);
    this.seats = this.buildEmptySeats();
  }

  // ── Private: helpers ────────────────────────────────────────────────────────

  private buildEmptySeats(): BJSeat[] {
    return Array.from({ length: this.numSeats }, (_, i) => ({
      seatIndex: i,
      playerId: null,
      username: null,
      avatarUrl: null,
      chips: 0,
      status: "empty" as SeatStatus,
      bet: 0,
      cards: [],
      splitCards: null,
      splitBet: 0,
      activeHand: "main" as const,
      result: null,
      splitResult: null,
      payout: 0,
      splitPayout: 0,
    }));
  }

  private wsSend(ws: WebSocket, msg: object) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcast(msg: object) {
    const payload = JSON.stringify(msg);
    for (const sub of this.subs) {
      try {
        if (sub.ws.readyState === WebSocket.OPEN) sub.ws.send(payload);
      } catch {}
    }
  }

  private maskDealerCards(): Card[] {
    if (this.phase === "DEALING" || this.phase === "PLAYER_TURNS") {
      return this.dealerCards.map((c, i) => (i === 1 ? { ...c, hidden: true } : c));
    }
    return this.dealerCards;
  }

  private tableStateMsg() {
    return {
      type: "bj_table_state",
      tableId: this.tableId,
      roundId: this.roundCounter,
      phase: this.phase,
      seats: this.seats.map(s => ({ ...s })),
      dealerCards: this.maskDealerCards(),
      dealerValue: this.phase === "DEALER_TURN" || this.phase === "RESOLUTION"
        ? handValue(this.dealerCards)
        : this.dealerCards.length > 0 ? handValue([this.dealerCards[0]]) : 0,
      currentTurnSeat: this.currentTurnSeat,
      phaseEndsAt: this.phaseEndsAt,
    };
  }

  private broadcastState() {
    this.broadcast(this.tableStateMsg());
  }

  private clearTimers() {
    if (this.phaseTimer !== null) { clearTimeout(this.phaseTimer); this.phaseTimer = null; }
    if (this.turnTimer !== null)  { clearTimeout(this.turnTimer);  this.turnTimer  = null; }
  }

  private setPhase(newPhase: BJPhase, durationMs?: number) {
    this.clearTimers();
    this.phase = newPhase;
    this.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
  }

  private clearSeat(seat: BJSeat) {
    seat.playerId = null;
    seat.username = null;
    seat.avatarUrl = null;
    seat.chips = 0;
    seat.status = "empty";
    seat.bet = 0;
    seat.cards = [];
    seat.splitCards = null;
    seat.splitBet = 0;
    seat.result = null;
    seat.splitResult = null;
    seat.payout = 0;
    seat.splitPayout = 0;
    seat.activeHand = "main";
  }

  // ── Private: phase lifecycle ────────────────────────────────────────────────

  private startBetting() {
    this.clearTimers();
    this.actingPlayers.clear();
    for (const seat of this.seats) {
      if (seat.playerId !== null) {
        seat.status = "seated";
        seat.bet = 0;
        seat.cards = [];
        seat.splitCards = null;
        seat.splitBet = 0;
        seat.activeHand = "main";
        seat.result = null;
        seat.splitResult = null;
        seat.payout = 0;
        seat.splitPayout = 0;
      }
    }
    this.dealerCards = [];
    this.currentTurnSeat = null;
    if (this.deck.length < 52) this.deck = createDeck(NUM_DECKS);

    const anySeated = this.seats.some(s => s.playerId !== null);
    if (!anySeated) {
      this.setPhase("WAITING");
      this.broadcastState();
      return;
    }

    this.setPhase("BETTING", BETTING_MS);
    this.phaseTimer = setTimeout(() => this.startDealing(), BETTING_MS);
    this.broadcastState();
  }

  private async startDealing() {
    this.clearTimers();
    const bettors = this.seats.filter(s => s.bet > 0 && s.playerId !== null);
    if (bettors.length === 0) { this.startBetting(); return; }

    // Cache odds mode once per round so all card draws use the same setting
    this.roundOddsMode = await getSetting("blackjackOddsMode", "standard");

    this.setPhase("DEALING", DEALING_MS);

    if (this.deck.length < this.numSeats * 4 + 4) this.deck = createDeck(NUM_DECKS);

    for (const seat of bettors) {
      seat.cards = [this.deck.pop()!, this.deck.pop()!];
      seat.status = isBlackjack(seat.cards) ? "blackjack" : "active";
    }
    this.dealerCards = [this.deck.pop()!, { ...this.deck.pop()!, hidden: true }];

    this.broadcastState();
    this.phaseTimer = setTimeout(() => this.startPlayerTurns(), DEALING_MS);
  }

  private firstActiveSeat(after: number | null = null): number | null {
    const start = after === null ? 0 : after + 1;
    for (let i = start; i < this.numSeats; i++) {
      if (this.seats[i].status === "active") return i;
    }
    return null;
  }

  private startPlayerTurns() {
    this.clearTimers();
    this.setPhase("PLAYER_TURNS");
    this.currentTurnSeat = null;
    this.broadcastState();
    this.advanceTurn();
  }

  private advanceTurn() {
    this.clearTimers();
    const next = this.firstActiveSeat(this.currentTurnSeat);
    if (next === null) {
      this.startDealerTurn();
      return;
    }
    this.currentTurnSeat = next;
    this.broadcastState();
    this.turnTimer = setTimeout(() => {
      if (this.phase === "PLAYER_TURNS" && this.currentTurnSeat === next) {
        const seat = this.seats[next];
        if (seat && seat.status === "active") {
          if (seat.activeHand === "main" && seat.splitCards) {
            seat.activeHand = "split";
            this.broadcastState();
            this.turnTimer = setTimeout(() => {
              if (this.phase === "PLAYER_TURNS" && this.currentTurnSeat === next) {
                seat.status = "standing";
                this.broadcastState();
                this.advanceTurn();
              }
            }, TURN_TIMEOUT_MS);
          } else {
            seat.status = "standing";
            this.broadcastState();
            this.advanceTurn();
          }
        }
      }
    }, TURN_TIMEOUT_MS);
  }

  private startDealerTurn() {
    this.clearTimers();
    // Step 1: reveal hole card immediately
    this.dealerCards = this.dealerCards.map(c => ({ ...c, hidden: false }));
    this.currentTurnSeat = null;
    this.setPhase("DEALER_TURN");
    this.broadcastState();

    const activePlayers = this.seats.filter(s => s.status === "standing" || s.status === "blackjack");
    if (activePlayers.length === 0) {
      // No live players — skip drawing, go straight to resolution
      this.phaseTimer = setTimeout(() => this.resolveRound(), DEALER_REVEAL_MS);
      return;
    }

    // Step 2: start drawing one card at a time after a short pause
    this.phaseTimer = setTimeout(() => this.dealerDrawStep(), DEALER_REVEAL_MS);
  }

  private dealerDrawStep() {
    this.clearTimers();
    if (handValue(this.dealerCards) >= 17) {
      // Dealer stands — wait a moment so players can read the hand, then resolve
      this.phaseTimer = setTimeout(() => this.resolveRound(), DEALER_STAND_MS);
      return;
    }
    // Draw one card — biased in danger zone to protect dealer (house) or bust dealer (player modes)
    if (this.deck.length < 8) this.deck = createDeck(NUM_DECKS);
    const dv = handValue(this.dealerCards);
    this.dealerCards.push(biasedDraw(this.deck, this.roundOddsMode, dv, false));
    this.broadcastState();
    // Schedule next card
    this.phaseTimer = setTimeout(() => this.dealerDrawStep(), DEALER_CARD_MS);
  }

  private async resolveRound() {
    this.clearTimers();
    this.roundCounter++;
    const roundId = this.roundCounter;
    const oddsMode = this.roundOddsMode; // cached at deal time

    const fmtCards = (cards: Card[]): string =>
      cards.map(c => c.hidden ? "??" : `${c.rank}${c.suit}`).join(" ");

    const dv = handValue(this.dealerCards);
    const dealerBJ = this.dealerCards.length === 2 && dv === 21;
    console.log(`[BJ T${this.tableId} #${roundId}] ── RESOLUTION ── dealer=${dv}${dealerBJ ? "(BJ)" : ""} [${fmtCards(this.dealerCards)}] oddsMode=${oddsMode}`);

    for (const seat of this.seats) {
      if (seat.playerId === null || seat.bet === 0) continue;
      const activeStatuses: SeatStatus[] = ["standing", "busted", "blackjack", "active"];
      if (!activeStatuses.includes(seat.status)) continue;

      // Outcomes are always honest — bias was applied during card dealing, not here
      const mainResult = determineWinner(seat.cards, this.dealerCards);
      const mainFinal = calculatePayout(seat.bet, mainResult);
      seat.result = mainResult;
      seat.payout = mainFinal;

      let totalPayout = mainFinal;

      if (seat.splitCards && seat.splitBet > 0) {
        const splitResultRaw = determineWinner(seat.splitCards, this.dealerCards);
        const splitResult = splitResultRaw === "player_blackjack" ? "player_win" : splitResultRaw;
        const splitFinal = calculatePayout(seat.splitBet, splitResult);
        seat.splitResult = splitResult;
        seat.splitPayout = splitFinal;
        totalPayout += splitFinal;

        console.log(
          `[BJ T${this.tableId} #${roundId}] seat=${seat.seatIndex} ${seat.username}(${seat.playerId})` +
          ` | MAIN  bet=${seat.bet} hand=${handValue(seat.cards)} [${fmtCards(seat.cards)}] result=${mainResult} payout=${mainFinal}` +
          ` | SPLIT bet=${seat.splitBet} hand=${handValue(seat.splitCards!)} [${fmtCards(seat.splitCards!)}] result=${splitResult} payout=${splitFinal}` +
          ` | TOTAL_PAYOUT=${totalPayout}`
        );
      } else {
        console.log(
          `[BJ T${this.tableId} #${roundId}] seat=${seat.seatIndex} ${seat.username}(${seat.playerId})` +
          ` | MAIN  bet=${seat.bet} hand=${handValue(seat.cards)} [${fmtCards(seat.cards)}] result=${mainResult} payout=${mainFinal}` +
          ` | TOTAL_PAYOUT=${totalPayout}`
        );
      }

      if (totalPayout > 0) {
        const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, seat.playerId));
        if (fresh) {
          const chipsBefore = Number(fresh.chips);
          const chipsAfter = chipsBefore + totalPayout;
          await db.update(playersTable).set({ chips: chipsAfter }).where(eq(playersTable.id, seat.playerId));
          await db.insert(transactionsTable).values({
            playerId: seat.playerId,
            amount: totalPayout,
            type: "win",
            description: `Blackjack payout (${seat.result}${seat.splitResult ? `, split: ${seat.splitResult}` : ""})`,
          });
          seat.chips = chipsAfter;
          _broadcastBalance(seat.playerId, seat.chips);
          console.log(`[BJ T${this.tableId} #${roundId}] seat=${seat.seatIndex} ${seat.username} balance: ${chipsBefore} → ${chipsAfter} (credited +${totalPayout})`);
        }
      } else {
        console.log(`[BJ T${this.tableId} #${roundId}] seat=${seat.seatIndex} ${seat.username} no payout — loss/bust`);
      }

      // Save hand record for history lookup
      await db.insert(blackjackHandsTable).values({
        tableId: this.tableId,
        tableName: this.name,
        roundId,
        playerId: seat.playerId,
        playerName: seat.username ?? "Unknown",
        seatIndex: seat.seatIndex,
        playerCards: fmtCards(seat.cards),
        playerValue: handValue(seat.cards),
        splitCards: seat.splitCards ? fmtCards(seat.splitCards) : null,
        splitValue: seat.splitCards ? handValue(seat.splitCards) : null,
        dealerCards: fmtCards(this.dealerCards),
        dealerValue: dv,
        result: mainResult,
        splitResult: seat.splitResult ?? null,
        bet: seat.bet,
        splitBet: seat.splitBet ?? 0,
        payout: totalPayout,
        oddsMode,
      }).catch(() => {}); // non-critical — don't crash a round on a log write failure

      seat.status = "finished";
    }

    this.setPhase("RESOLUTION", RESOLUTION_MS);
    this.broadcastState();
    this.phaseTimer = setTimeout(() => this.startResetting(), RESOLUTION_MS);
  }

  private startResetting() {
    this.clearTimers();
    for (const seat of this.seats) {
      if (seat.playerId !== null && seat.chips <= 0) {
        this.clearSeat(seat);
      }
    }
    this.setPhase("RESETTING", RESETTING_MS);
    this.broadcastState();
    this.phaseTimer = setTimeout(() => this.startBetting(), RESETTING_MS);
  }

  private resetTurnTimer(seat: BJSeat) {
    if (this.turnTimer !== null) { clearTimeout(this.turnTimer); this.turnTimer = null; }
    const idx = seat.seatIndex;
    this.turnTimer = setTimeout(() => {
      if (this.phase !== "PLAYER_TURNS" || this.currentTurnSeat !== idx || seat.status !== "active") return;
      if (seat.activeHand === "main" && seat.splitCards) {
        seat.activeHand = "split";
        this.broadcastState();
        this.turnTimer = setTimeout(() => {
          if (this.phase === "PLAYER_TURNS" && this.currentTurnSeat === idx && seat.status === "active") {
            seat.status = "standing";
            this.broadcastState();
            this.advanceTurn();
          }
        }, TURN_TIMEOUT_MS);
      } else {
        seat.status = "standing";
        this.broadcastState();
        this.advanceTurn();
      }
    }, TURN_TIMEOUT_MS);
  }

  // ── Public: state info ─────────────────────────────────────────────────────

  getSeatedCount(): number {
    return this.seats.filter(s => s.playerId !== null).length;
  }

  getPhase(): BJPhase {
    return this.phase;
  }

  /** Returns the current seat state for a bot player (no WebSocket required). */
  getBotSeatInfo(playerId: number): { isSeated: boolean; hasBet: boolean; isMyTurn: boolean; handValue: number } {
    const seat = this.seats.find(s => s.playerId === playerId);
    if (!seat) return { isSeated: false, hasBet: false, isMyTurn: false, handValue: 0 };
    const activeCards = seat.activeHand === "split" ? (seat.splitCards ?? seat.cards) : seat.cards;
    return {
      isSeated: true,
      hasBet: seat.bet > 0,
      isMyTurn: this.phase === "PLAYER_TURNS" && this.currentTurnSeat === seat.seatIndex && seat.status === "active",
      handValue: activeCards.length > 0 ? handValue(activeCards) : 0,
    };
  }

  /** Returns the first empty seat index, or null if all seats are occupied. */
  getFirstEmptySeatIndex(): number | null {
    const seat = this.seats.find(s => s.playerId === null);
    return seat ? seat.seatIndex : null;
  }

  getSubscribers(): Array<{ playerId: number; username: string }> {
    const result: Array<{ playerId: number; username: string }> = [];
    for (const sub of this.subs) {
      if (sub.playerId && sub.username && sub.ws.readyState === WebSocket.OPEN) {
        result.push({ playerId: sub.playerId, username: sub.username });
      }
    }
    return result;
  }

  // ── Public: subscribe / unsubscribe ───────────────────────────────────────

  subscribe(ws: WebSocket, playerId: number | null, username: string | null, avatarUrl: string | null) {
    for (const sub of this.subs) {
      if (sub.ws === ws) { this.subs.delete(sub); break; }
    }
    this.subs.add({ ws, playerId, username, avatarUrl });
    if (playerId !== null && username) {
      recordPlayerActivity(playerId, username, "blackjack", false);
      const seat = this.seats.find(s => s.playerId === playerId);
      if (seat) {
        if (username) seat.username = username;
        if (avatarUrl) seat.avatarUrl = avatarUrl;
      }
    }
    this.wsSend(ws, this.tableStateMsg());
  }

  removeSub(ws: WebSocket) {
    for (const sub of this.subs) {
      if (sub.ws === ws) {
        if (sub.playerId !== null) this.leaveSeat(sub.playerId);
        this.subs.delete(sub);
        return;
      }
    }
  }

  // ── Public: sit down ──────────────────────────────────────────────────────

  async sitDown(ws: WebSocket, playerId: number, seatIndex: number): Promise<{ error?: string }> {
    if (!this.isOpen) return { error: "This table is closed" };
    if (seatIndex < 0 || seatIndex >= this.numSeats) return { error: "Invalid seat" };
    if (this.phase !== "WAITING" && this.phase !== "BETTING") return { error: "Cannot sit during an active round" };
    if (this.seats.some(s => s.playerId === playerId)) return { error: "Already seated" };

    const seat = this.seats[seatIndex];
    if (seat.playerId !== null) return { error: "Seat is taken" };

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return { error: "Player not found" };

    if (Number(player.chips) < this.minBet) return { error: "Not enough chips to join" };

    const sub = [...this.subs].find(s => s.ws === ws);
    seat.playerId = playerId;
    seat.username = sub?.username ?? player.username;
    seat.avatarUrl = sub?.avatarUrl ?? null;
    seat.chips = Number(player.chips);
    seat.status = "seated";
    seat.bet = 0;

    if (this.phase === "WAITING") {
      this.startBetting();
    } else {
      this.broadcastState();
    }
    return {};
  }

  // ── Public: leave seat ────────────────────────────────────────────────────

  leaveSeat(playerId: number): void {
    const seat = this.seats.find(s => s.playerId === playerId);
    if (!seat) return;

    if (this.phase === "PLAYER_TURNS" && this.currentTurnSeat === seat.seatIndex && seat.status === "active") {
      seat.status = "standing";
      this.clearSeat(seat);
      this.broadcastState();
      this.advanceTurn();
      return;
    }

    this.clearSeat(seat);

    const anySeated = this.seats.some(s => s.playerId !== null);
    if (!anySeated && (this.phase === "WAITING" || this.phase === "BETTING")) {
      this.clearTimers();
      this.setPhase("WAITING");
    }

    this.broadcastState();
  }

  // ── Public: place bet ─────────────────────────────────────────────────────

  async placeBet(ws: WebSocket, playerId: number, amount: number): Promise<{ error?: string }> {
    if (this.phase !== "BETTING") return { error: "Betting is not open" };

    const seat = this.seats.find(s => s.playerId === playerId);
    if (!seat) return { error: "You are not seated at this table" };
    if (seat.status !== "seated" && seat.status !== "bet_placed") return { error: "Cannot place bet now" };

    if (amount < this.minBet || amount > this.maxBet) {
      return { error: `Bet must be between ${this.minBet.toLocaleString()} and ${this.maxBet.toLocaleString()} chips` };
    }

    let [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return { error: "Player not found" };

    if (seat.bet > 0) {
      await db.update(playersTable).set({ chips: player.chips + seat.bet }).where(eq(playersTable.id, playerId));
      const [refetched] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      player = refetched;
    }

    if (Number(player.chips) < amount) return { error: "Insufficient chips" };

    await db.update(playersTable).set({ chips: player.chips - amount }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount, type: "loss", description: "Blackjack bet" });

    seat.bet = amount;
    seat.chips = Number(player.chips) - amount;
    seat.status = "bet_placed";
    _broadcastBalance(playerId, seat.chips);
    console.log(`[BJ T${this.tableId} BET] seat=${seat.seatIndex} ${seat.username}(${playerId}) bet=${amount} chips_after=${seat.chips}`);
    this.broadcastState();
    return {};
  }

  // ── Public: player action ─────────────────────────────────────────────────

  async playerAction(playerId: number, action: string): Promise<{ error?: string }> {
    if (this.phase !== "PLAYER_TURNS") return { error: "Not player turns phase" };

    const seat = this.seats.find(s => s.playerId === playerId);
    if (!seat) return { error: "You are not seated" };
    if (this.currentTurnSeat !== seat.seatIndex) return { error: "Not your turn" };
    if (seat.status !== "active") return { error: "Cannot act now" };
    if (this.actingPlayers.has(playerId)) return { error: "Action already in progress" };

    this.actingPlayers.add(playerId);
    this.clearTimers();
    try {

    if (action === "hit") {
      if (this.deck.length < 4) this.deck = createDeck(NUM_DECKS);
      const activeCards = seat.activeHand === "split" ? (seat.splitCards ?? []) : seat.cards;
      const newCard = biasedDraw(this.deck, this.roundOddsMode, handValue(activeCards), true);

      if (seat.activeHand === "split") {
        seat.splitCards = [...(seat.splitCards ?? []), newCard];
        if (isBust(seat.splitCards!)) {
          seat.status = "standing";
          this.broadcastState();
          this.advanceTurn();
          return {};
        }
      } else {
        seat.cards = [...seat.cards, newCard];
        if (isBust(seat.cards)) {
          if (seat.splitCards) {
            seat.activeHand = "split";
          } else {
            seat.status = "busted";
            this.broadcastState();
            this.advanceTurn();
            return {};
          }
        }
      }
      this.broadcastState();
      this.resetTurnTimer(seat);
      return {};
    }

    if (action === "stand") {
      if (seat.activeHand === "main" && seat.splitCards) {
        seat.activeHand = "split";
        this.broadcastState();
        this.resetTurnTimer(seat);
        return {};
      }
      seat.status = "standing";
      this.broadcastState();
      this.advanceTurn();
      return {};
    }

    if (action === "double") {
      if (this.deck.length < 4) this.deck = createDeck(NUM_DECKS);
      const activeCards = seat.activeHand === "split" ? seat.splitCards! : seat.cards;
      if (activeCards.length !== 2) return { error: "Can only double on first two cards" };
      const betAmt = seat.activeHand === "split" ? seat.splitBet : seat.bet;

      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      if (!player || Number(player.chips) < betAmt) return { error: "Insufficient chips to double" };

      await db.update(playersTable).set({ chips: player.chips - betAmt }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: betAmt, type: "loss", description: "Blackjack double" });
      seat.chips = Number(player.chips) - betAmt;
      _broadcastBalance(playerId, seat.chips);

      const newCard = biasedDraw(this.deck, this.roundOddsMode, handValue(activeCards), true);
      if (seat.activeHand === "split") {
        seat.splitCards = [...activeCards, newCard];
        seat.splitBet = betAmt * 2;
        seat.status = isBust(seat.splitCards) ? "busted" : "standing";
      } else {
        seat.cards = [...activeCards, newCard];
        seat.bet = betAmt * 2;
        const mainBust = isBust(seat.cards);
        if (seat.splitCards) {
          seat.activeHand = "split";
          if (!mainBust) {
            this.resetTurnTimer(seat);
            this.broadcastState();
            return {};
          }
          seat.status = "standing";
        } else {
          seat.status = mainBust ? "busted" : "standing";
        }
      }
      this.broadcastState();
      this.advanceTurn();
      return {};
    }

    if (action === "split") {
      if (this.deck.length < 4) this.deck = createDeck(NUM_DECKS);
      if (seat.cards.length !== 2) return { error: "Can only split first two cards" };
      if (seat.cards[0].rank !== seat.cards[1].rank) return { error: "Cards must be a matching pair to split" };
      if (seat.splitCards) return { error: "Already split" };

      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      if (!player || Number(player.chips) < seat.bet) return { error: "Insufficient chips to split" };

      await db.update(playersTable).set({ chips: player.chips - seat.bet }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: seat.bet, type: "loss", description: "Blackjack split" });
      seat.chips = Number(player.chips) - seat.bet;
      _broadcastBalance(playerId, seat.chips);

      const [cardA, cardB] = seat.cards;
      seat.cards = [cardA, this.deck.pop()!];
      seat.splitCards = [cardB, this.deck.pop()!];
      seat.splitBet = seat.bet;
      seat.activeHand = "main";
      this.broadcastState();
      this.resetTurnTimer(seat);
      return {};
    }

    return { error: "Unknown action" };
    } finally {
      this.actingPlayers.delete(playerId);
    }
  }

  // ── Public: init ──────────────────────────────────────────────────────────

  init() {
    this.seats = this.buildEmptySeats();
    this.setPhase("WAITING");
    this.broadcastState();
  }

  destroy() {
    this.clearTimers();
    for (const sub of this.subs) {
      try {
        if (sub.ws.readyState === WebSocket.OPEN) {
          sub.ws.send(JSON.stringify({ type: "bj_table_closed", tableId: this.tableId }));
        }
      } catch {}
    }
    this.subs.clear();
  }
}

// ── Room registry ──────────────────────────────────────────────────────────────

const rooms = new Map<number, BlackjackRoom>();

export function getBJRoom(tableId: number): BlackjackRoom | undefined {
  return rooms.get(tableId);
}

export function getAllBJRooms(): BlackjackRoom[] {
  return Array.from(rooms.values());
}

export function getBJSubscribers(): Array<{ playerId: number; username: string }> {
  const result: Array<{ playerId: number; username: string }> = [];
  for (const room of rooms.values()) {
    result.push(...room.getSubscribers());
  }
  return result;
}

export function bjUnsubscribeAll(ws: WebSocket) {
  for (const room of rooms.values()) {
    room.removeSub(ws);
  }
}

export async function createBJRoom(cfg: BJTableConfig): Promise<BlackjackRoom> {
  const room = new BlackjackRoom(cfg);
  room.init();
  rooms.set(cfg.id, room);
  return room;
}

export function deleteBJRoom(tableId: number) {
  const room = rooms.get(tableId);
  if (room) {
    room.destroy();
    rooms.delete(tableId);
  }
}

export async function initBJRooms(): Promise<void> {
  const tables = await db.select().from(blackjackTablesTable);
  for (const t of tables) {
    const room = new BlackjackRoom({
      id: t.id,
      name: t.name,
      minBet: t.minBet,
      maxBet: t.maxBet,
      numSeats: t.numSeats,
      theme: t.theme,
      isOpen: t.isOpen,
      passwordHash: t.passwordHash,
      houseEdge: t.houseEdge ?? 2.5,
    });
    room.init();
    rooms.set(t.id, room);
    console.log(`[BJ] Initialized room ${t.id}: "${t.name}" (seats=${t.numSeats} min=${t.minBet} max=${t.maxBet})`);
  }
  console.log(`[BJ] ${rooms.size} table(s) ready`);
}

// ── Legacy compat shims (used by table-ws.ts before refactor) ─────────────────
// These are kept so old code compiles — table-ws.ts will be updated to use
// the per-room API directly.

export function bjRemoveSub(ws: WebSocket) {
  bjUnsubscribeAll(ws);
}

export function bjSubscribe(ws: WebSocket, playerId: number | null, username: string | null, avatarUrl: string | null) {
  // no-op shim — real subscribe goes through getBJRoom(tableId).subscribe(...)
}

export async function bjSitDown(ws: WebSocket, playerId: number, seatIndex: number): Promise<{ error?: string }> {
  return { error: "No table selected" };
}

export function bjLeaveSeat(_playerId: number) {}

export async function bjPlaceBet(_ws: WebSocket, _playerId: number, _amount: number): Promise<{ error?: string }> {
  return { error: "No table selected" };
}

export async function bjPlayerAction(_playerId: number, _action: string): Promise<{ error?: string }> {
  return { error: "No table selected" };
}

export function initBJRoom() {
  // no-op shim — replaced by initBJRooms()
}
