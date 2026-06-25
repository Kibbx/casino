/**
 * baccarat-room.ts
 * Multi-table Punto Banco baccarat room manager.
 *
 * Each baccarat table is an independent room with its own game loop.
 * Phase lifecycle: WAITING → BETTING → LOCKED → DEALING → RESULT → RESETTING → BETTING
 *
 * Chip flow:
 *   - Chips deducted immediately when bet placed.
 *   - Chips refunded if bet cleared during BETTING phase.
 *   - Payouts credited on RESULT.
 */

import { WebSocket } from "ws";
import { db, playersTable, transactionsTable, baccaratTablesTable, settingsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { createShoe, biasedDraw, calcPayouts, type BacCard, type BacOutcome, playerDraws, bankerDraws, handValue } from "./baccarat-engine.js";
import { recordPlayerActivity } from "./player-activity.js";

// ── Temperature → card-level bias (same technique as blackjack biasedDraw) ─────
// Payouts and commission are NEVER changed. The bias works by peeking ahead
// in the shoe when third cards are drawn, exactly as blackjack does.
//
// House modes (glacier/frozen/cold/cool):
//   Player's 3rd card → prefer a zero-value card (10/J/Q/K = 0 pts, no improvement)
//   Banker's 3rd card → prefer a high card (7/8/9, pushes banker toward a natural)
//
// Player modes (warm/hot): opposite

async function getBacMode(): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, "baccaratOddsMode"));
  return rows[0]?.value ?? "standard";
}

async function biasedDealHand(shoe: BacCard[]): Promise<import("./baccarat-engine.js").BacHandResult> {
  const mode = await getBacMode();

  // Initial 4 cards are always unbiased (P1 B1 P2 B2)
  const drawRaw = () => {
    if (shoe.length < 20) shoe.push(...createShoe(8));
    return shoe.pop()!;
  };

  const playerCards: BacCard[] = [drawRaw(), drawRaw()];
  const bankerCards: BacCard[] = [drawRaw(), drawRaw()];

  let playerTotal = handValue(playerCards);
  let bankerTotal = handValue(bankerCards);
  let playerThirdCard: BacCard | null = null;

  if (playerTotal >= 8 || bankerTotal >= 8) {
    // Natural — no third cards
  } else {
    if (playerDraws(playerTotal)) {
      playerThirdCard = biasedDraw(shoe, mode, true);
      playerCards.push(playerThirdCard);
      playerTotal = handValue(playerCards);
    }
    if (bankerDraws(bankerTotal, playerThirdCard)) {
      bankerCards.push(biasedDraw(shoe, mode, false));
      bankerTotal = handValue(bankerCards);
    }
  }

  let outcome: import("./baccarat-engine.js").BacOutcome;
  if (playerTotal > bankerTotal)      outcome = "player";
  else if (bankerTotal > playerTotal) outcome = "banker";
  else                                outcome = "tie";

  return { playerCards, bankerCards, playerTotal, bankerTotal, outcome };
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type BacPhase = "WAITING" | "BETTING" | "LOCKED" | "DEALING" | "RESULT" | "RESETTING";

export interface BacPlayerBet {
  playerId: number;
  username: string;
  avatarUrl: string | null;
  player: number;
  banker: number;
  tie: number;
  totalReserved: number;
}

interface BacSub {
  ws: WebSocket;
  playerId: number | null;
  username: string | null;
  avatarUrl: string | null;
}

export interface BacTableConfig {
  id: number;
  name: string;
  minBet: number;
  maxBet: number;
  bankerCommission: number;
  tiePayout: number;
  bettingTimerSecs: number;
  isOpen: boolean;
}

export type BacHistoryEntry = {
  outcome: BacOutcome;
  playerTotal: number;
  bankerTotal: number;
  roundId: number;
};

// ── Injected dependency ────────────────────────────────────────────────────────

type BroadcastBalanceFn = (playerId: number, chips: number) => void;
let _broadcastBalance: BroadcastBalanceFn = () => {};
export function injectBacBroadcastBalance(fn: BroadcastBalanceFn) {
  _broadcastBalance = fn;
}

// ── Room class ─────────────────────────────────────────────────────────────────

class BaccaratRoom {
  readonly tableId: number;
  config: BacTableConfig;

  phase: BacPhase = "WAITING";
  shoe: BacCard[] = createShoe(8);
  playerCards: BacCard[] = [];
  bankerCards: BacCard[] = [];
  playerTotal = 0;
  bankerTotal = 0;
  outcome: BacOutcome | null = null;

  roundId = 0;
  phaseEndsAt: number | null = null;
  phaseTimer: ReturnType<typeof setTimeout> | null = null;
  paused = false;

  bets = new Map<number, BacPlayerBet>();
  history: BacHistoryEntry[] = [];
  subscribers = new Set<BacSub>();

  constructor(config: BacTableConfig) {
    this.tableId = config.id;
    this.config = config;
  }

  // ── WS helpers ────────────────────────────────────────────────────────────

  wsSend(ws: WebSocket, msg: object) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    } catch {}
  }

  broadcast(msg: object) {
    const payload = JSON.stringify(msg);
    for (const sub of this.subscribers) {
      try {
        if (sub.ws.readyState === WebSocket.OPEN) sub.ws.send(payload);
      } catch {}
    }
  }

  // ── State snapshot ────────────────────────────────────────────────────────

  stateMsg(targetPlayerId?: number | null) {
    const betsArr: Array<BacPlayerBet & { isMine?: boolean }> = [];
    for (const b of this.bets.values()) {
      betsArr.push({ ...b, isMine: b.playerId === targetPlayerId });
    }
    const totals = { player: 0, banker: 0, tie: 0 };
    for (const b of this.bets.values()) {
      totals.player += b.player;
      totals.banker += b.banker;
      totals.tie += b.tie;
    }
    return {
      type: "bac_state",
      tableId: this.tableId,
      tableName: this.config.name,
      phase: this.phase,
      roundId: this.roundId,
      phaseEndsAt: this.phaseEndsAt,
      config: {
        minBet: this.config.minBet,
        maxBet: this.config.maxBet,
        bankerCommission: this.config.bankerCommission,
        tiePayout: this.config.tiePayout,
        bettingTimerSecs: this.config.bettingTimerSecs,
        isOpen: this.config.isOpen,
      },
      playerCards: this.playerCards,
      bankerCards: this.bankerCards,
      playerTotal: this.playerTotal,
      bankerTotal: this.bankerTotal,
      outcome: this.outcome,
      bets: betsArr,
      totals,
      history: this.history.slice(-30),
    };
  }

  broadcastState() {
    const payload = JSON.stringify(this.stateMsg());
    for (const sub of this.subscribers) {
      try {
        if (sub.ws.readyState === WebSocket.OPEN) sub.ws.send(payload);
      } catch {}
    }
  }

  sendSnapshot(ws: WebSocket, playerId: number | null) {
    this.wsSend(ws, this.stateMsg(playerId));
  }

  // ── Timer management ──────────────────────────────────────────────────────

  clearTimer() {
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
  }

  after(ms: number, fn: () => void) {
    this.clearTimer();
    this.phaseEndsAt = Date.now() + ms;
    this.phaseTimer = setTimeout(fn, ms);
  }

  // ── Game loop ─────────────────────────────────────────────────────────────

  startBetting() {
    if (!this.config.isOpen || this.paused) {
      this.phase = "WAITING";
      this.phaseEndsAt = null;
      this.broadcastState();
      return;
    }
    this.phase = "BETTING";
    this.roundId++;
    this.playerCards = [];
    this.bankerCards = [];
    this.playerTotal = 0;
    this.bankerTotal = 0;
    this.outcome = null;
    this.bets.clear();

    const ms = this.config.bettingTimerSecs * 1000;
    this.broadcastState();
    this.after(ms, () => this.lockBets());
  }

  lockBets() {
    this.phase = "LOCKED";
    this.broadcastState();
    this.after(800, () => this.deal());
  }

  deal() {
    this.phase = "DEALING";
    this.broadcastState();
    this.after(1200, async () => {
      const result = await biasedDealHand(this.shoe);
      this.playerCards = result.playerCards;
      this.bankerCards = result.bankerCards;
      this.playerTotal = result.playerTotal;
      this.bankerTotal = result.bankerTotal;
      this.outcome = result.outcome;

      this.phase = "RESULT";

      // Add to history
      this.history.push({
        outcome: result.outcome,
        playerTotal: result.playerTotal,
        bankerTotal: result.bankerTotal,
        roundId: this.roundId,
      });
      if (this.history.length > 100) this.history.shift();

      await this.resolvePayouts(result.outcome);
      this.broadcastState();

      this.after(4000, () => {
        this.phase = "RESETTING";
        this.broadcastState();
        this.after(1500, () => this.startBetting());
      });
    });
  }

  async resolvePayouts(outcome: BacOutcome) {
    for (const bet of this.bets.values()) {
      if (bet.totalReserved === 0) continue;

      const { playerReturn, bankerReturn, tieReturn, commission } = calcPayouts(
        { player: bet.player, banker: bet.banker, tie: bet.tie },
        outcome,
        this.config.bankerCommission,
        this.config.tiePayout,
      );

      const totalReturn = playerReturn + bankerReturn + tieReturn;
      if (totalReturn === 0) continue;

      // Credit player atomically
      const [updated] = await db
        .update(playersTable)
        .set({ chips: sql`${playersTable.chips} + ${totalReturn}` })
        .where(eq(playersTable.id, bet.playerId))
        .returning();

      if (!updated) continue;

      _broadcastBalance(bet.playerId, updated.chips);

      // Transaction log
      const desc = `Baccarat table "${this.config.name}" round #${this.roundId} — ${outcome.toUpperCase()} wins`;
      await db.insert(transactionsTable).values({
        playerId: bet.playerId,
        amount: totalReturn,
        type: "baccarat",
        description: desc,
      });

      if (commission > 0) {
        await db.insert(transactionsTable).values({
          playerId: bet.playerId,
          amount: commission,
          type: "rake",
          description: `Baccarat commission at table "${this.config.name}"`,
        });
      }
    }
  }

  // ── Player subscribe/unsubscribe ──────────────────────────────────────────

  subscribe(ws: WebSocket, playerId: number | null, username: string | null, avatarUrl: string | null) {
    const existing = [...this.subscribers].find(s => s.ws === ws);
    if (!existing) this.subscribers.add({ ws, playerId, username, avatarUrl });
    this.sendSnapshot(ws, playerId);
    if (playerId && username) recordPlayerActivity(playerId, username, "baccarat", false);
  }

  unsubscribe(ws: WebSocket) {
    for (const sub of this.subscribers) {
      if (sub.ws === ws) {
        this.subscribers.delete(sub);
        break;
      }
    }
  }

  // ── Bet placement ─────────────────────────────────────────────────────────

  async placeBet(
    ws: WebSocket,
    playerId: number,
    username: string,
    avatarUrl: string | null,
    side: "player" | "banker" | "tie",
    amount: number,
  ): Promise<{ error?: string }> {
    if (this.phase !== "BETTING") return { error: "Betting is not open" };
    if (!this.config.isOpen) return { error: "Table is closed" };
    if (amount < this.config.minBet) return { error: `Minimum bet is ${this.config.minBet} chips` };
    if (amount > this.config.maxBet) return { error: `Maximum bet is ${this.config.maxBet} chips` };

    // Get existing entry (or create)
    const existing = this.bets.get(playerId) ?? {
      playerId, username, avatarUrl, player: 0, banker: 0, tie: 0, totalReserved: 0,
    };
    if (avatarUrl) existing.avatarUrl = avatarUrl;

    // Enforce per-side max
    const currentSide = existing[side];
    if (currentSide + amount > this.config.maxBet) {
      return { error: `Max ${this.config.maxBet.toLocaleString()} chips per side (${currentSide.toLocaleString()} already placed)` };
    }

    // Synchronously update in-memory BEFORE any await (prevents race condition)
    existing[side] += amount;
    existing.totalReserved += amount;
    this.bets.set(playerId, existing);

    // Atomic chip deduction
    const [updated] = await db
      .update(playersTable)
      .set({ chips: sql`${playersTable.chips} - ${amount}` })
      .where(and(eq(playersTable.id, playerId), gte(playersTable.chips, amount)))
      .returning();

    if (!updated) {
      // Rollback in-memory
      existing[side] -= amount;
      existing.totalReserved -= amount;
      if (existing.totalReserved <= 0) this.bets.delete(playerId);
      return { error: "Insufficient chips" };
    }

    await db.insert(transactionsTable).values({
      playerId, amount, type: "loss", description: `Baccarat bet placed (${side}) at table "${this.config.name}"`,
    });
    db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

    _broadcastBalance(playerId, updated.chips);

    this.wsSend(ws, {
      type: "bac_bet_confirmed",
      tableId: this.tableId,
      myBet: { player: existing.player, banker: existing.banker, tie: existing.tie, total: existing.totalReserved },
    });
    this.broadcastState();
    return {};
  }

  async clearBet(ws: WebSocket, playerId: number): Promise<{ error?: string }> {
    if (this.phase !== "BETTING") return { error: "Cannot clear bets — betting phase has ended" };
    const entry = this.bets.get(playerId);
    if (!entry || entry.totalReserved === 0) {
      this.wsSend(ws, { type: "bac_bet_confirmed", tableId: this.tableId, myBet: { player: 0, banker: 0, tie: 0, total: 0 } });
      return {};
    }

    const refund = entry.totalReserved;
    // Synchronously remove in-memory first
    this.bets.delete(playerId);

    const [updated] = await db
      .update(playersTable)
      .set({ chips: sql`${playersTable.chips} + ${refund}` })
      .where(eq(playersTable.id, playerId))
      .returning();

    if (updated) {
      _broadcastBalance(playerId, updated.chips);
      await db.insert(transactionsTable).values({
        playerId, amount: refund, type: "cashout", description: `Baccarat bet cleared at table "${this.config.name}"`,
      });
    }

    this.wsSend(ws, { type: "bac_bet_confirmed", tableId: this.tableId, myBet: { player: 0, banker: 0, tie: 0, total: 0 } });
    this.broadcastState();
    return {};
  }

  // ── Staff controls ────────────────────────────────────────────────────────

  pause() {
    this.paused = true;
    if (this.phase === "WAITING" || this.phase === "BETTING") {
      this.clearTimer();
      this.phase = "WAITING";
      this.phaseEndsAt = null;
      this.broadcastState();
    }
  }

  resume() {
    this.paused = false;
    if (this.phase === "WAITING") {
      this.startBetting();
    }
  }

  updateConfig(patch: Partial<BacTableConfig>) {
    Object.assign(this.config, patch);
    this.broadcastState();
  }
}

// ── Room registry ──────────────────────────────────────────────────────────────

const rooms = new Map<number, BaccaratRoom>();

export function getBacRoom(tableId: number): BaccaratRoom | null {
  return rooms.get(tableId) ?? null;
}

export function getOrCreateBacRoom(config: BacTableConfig): BaccaratRoom {
  const existing = rooms.get(config.id);
  if (existing) {
    existing.config = config;
    return existing;
  }
  const room = new BaccaratRoom(config);
  rooms.set(config.id, room);
  return room;
}

export async function initAllBaccaratRooms() {
  const tables = await db.select().from(baccaratTablesTable);
  for (const t of tables) {
    const room = getOrCreateBacRoom({
      id: t.id,
      name: t.name,
      minBet: t.minBet,
      maxBet: t.maxBet,
      bankerCommission: t.bankerCommission,
      tiePayout: t.tiePayout,
      bettingTimerSecs: t.bettingTimerSecs,
      isOpen: t.isOpen,
    });
    if (t.isOpen) {
      room.startBetting();
    }
  }
}

// ── WS-facing exports ──────────────────────────────────────────────────────────

export function bacSubscribe(
  ws: WebSocket,
  tableId: number,
  playerId: number | null,
  username: string | null,
  avatarUrl: string | null,
) {
  const room = rooms.get(tableId);
  if (!room) {
    try { ws.send(JSON.stringify({ type: "bac_error", message: "Table not found" })); } catch {}
    return;
  }
  room.subscribe(ws, playerId, username, avatarUrl);
}

export function bacUnsubscribe(ws: WebSocket) {
  for (const room of rooms.values()) room.unsubscribe(ws);
}

export async function bacPlaceBet(
  ws: WebSocket,
  tableId: number,
  playerId: number,
  username: string,
  avatarUrl: string | null,
  side: "player" | "banker" | "tie",
  amount: number,
): Promise<{ error?: string }> {
  const room = rooms.get(tableId);
  if (!room) return { error: "Table not found" };
  return room.placeBet(ws, playerId, username, avatarUrl, side, amount);
}

export async function bacClearBet(
  ws: WebSocket,
  tableId: number,
  playerId: number,
): Promise<{ error?: string }> {
  const room = rooms.get(tableId);
  if (!room) return { error: "Table not found" };
  return room.clearBet(ws, playerId);
}
