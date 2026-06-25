import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import type { Seat } from "./poker-engine.js";
import { validatePlayerToken } from "./sessions.js";
import { trackWsConnect, trackWsDisconnect } from "./req-stats.js";
import { handlePokerAction, standUpPlayer } from "./poker-action-handler.js";
import {
  db, playersTable, settingsTable, transactionsTable, blackjackGamesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { WheelType } from "./roulette-engine.js";
import {
  createDeck, dealInitialHand, dealerPlay, handValue, isBust,
  biasedDraw, determineWinner, calculatePayout, type Card,
} from "./blackjack-engine.js";
import {
  injectBroadcastBalance, injectAddFloorEvent, initRouletteRoom,
  subscribeRoulette, roulettePlaceBet, rouletteClearBets, removeRouletteSub,
} from "./roulette-room.js";
import {
  injectBJBroadcastBalance, initBJRooms,
  getBJRoom, bjUnsubscribeAll,
} from "./blackjack-room.js";
import {
  injectBacBroadcastBalance,
  bacSubscribe, bacUnsubscribe, bacPlaceBet, bacClearBet,
} from "./baccarat-room.js";
import { recordPlayerActivity } from "./player-activity.js";
import { addFloorEvent } from "./floor-events.js";
import { trackRakebackBet, trackRakebackWin } from "./rakeback.js";

// ── Per-player rakeback realRatio for active blackjack hands ───────────────
// gameId → realRatio (0–1)
const bjRakebackRatio = new Map<number, number>();

// ── Shared DB helpers ──────────────────────────────────────────────────────
async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) {
    await db.insert(settingsTable).values({ key, value });
  } else {
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  }
}

function applyHouseEdge(bet: number, rawPayout: number, houseEdgePct: number) {
  if (rawPayout <= bet || houseEdgePct <= 0) return { finalPayout: rawPayout, rake: 0 };
  const profit = rawPayout - bet;
  const rake = Math.floor(profit * houseEdgePct / 100);
  return { finalPayout: rawPayout - rake, rake };
}

async function recordRake(rake: number) {
  if (rake <= 0) return;
  const current = parseInt(await getSetting("totalRakeCollected", "0"));
  await setSetting("totalRakeCollected", String(current + rake));
}

function wsSend(ws: WebSocket, msg: object) {
  try {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  } catch {}
}

// ── Disconnect grace period ────────────────────────────────────────────────
// When a player's WS closes we wait 45 s before clearing their seat.
// If they reconnect in that window the timer is cancelled.
const DISCONNECT_GRACE_MS = 45_000;
const pendingDisconnects = new Map<number, ReturnType<typeof setTimeout>>(); // playerId → timer

function scheduleDisconnectStandup(playerId: number, tableId: number): void {
  cancelDisconnectStandup(playerId); // clear any previous timer for this player
  const timer = setTimeout(() => {
    pendingDisconnects.delete(playerId);
    standUpPlayer(tableId, playerId).catch(() => {});
  }, DISCONNECT_GRACE_MS);
  pendingDisconnects.set(playerId, timer);
}

function cancelDisconnectStandup(playerId: number): void {
  const timer = pendingDisconnects.get(playerId);
  if (timer !== undefined) {
    clearTimeout(timer);
    pendingDisconnects.delete(playerId);
  }
}

// ── Table subscribers ──────────────────────────────────────────────────────
interface TableClient {
  ws: WebSocket;
  playerId: number | null;
}

const tableSubscribers = new Map<number, Set<TableClient>>();

function filterTableForClient(table: any, playerId: number | null): any {
  if (!table?.gameState?.playerHands) return table;

  const gs = table.gameState;
  const isShowdown = gs.phase === "showdown" && gs.winners?.length;
  if (isShowdown) return table;

  const filtered: Record<number, string[]> = {};
  if (playerId !== null) {
    const seats = table.seats as Seat[];
    const myseat = seats.find((s) => s.playerId === playerId);
    if (myseat !== undefined) {
      const hand =
        gs.playerHands[myseat.seatIndex] ??
        gs.playerHands[String(myseat.seatIndex)];
      if (hand) filtered[myseat.seatIndex] = hand;
    }
  }

  return {
    ...table,
    gameState: { ...gs, playerHands: filtered },
  };
}

export function broadcastTableState(tableId: number, table: any): void {
  const clients = tableSubscribers.get(tableId);
  if (!clients || clients.size === 0) return;

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    const payload = filterTableForClient(table, client.playerId);
    try {
      client.ws.send(JSON.stringify({ type: "table_state_update", table: payload }));
    } catch {}
  }
}

export function broadcastPlayerJoined(tableId: number, playerId: number, playerName: string, seatIndex: number): void {
  const clients = tableSubscribers.get(tableId);
  if (!clients) return;
  const payload = JSON.stringify({ type: "player_joined", tableId, playerId, playerName, seatIndex });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    try { client.ws.send(payload); } catch {}
  }
}

export function broadcastPlayerLeft(tableId: number, playerId: number, seatIndex: number): void {
  const clients = tableSubscribers.get(tableId);
  if (!clients) return;
  const payload = JSON.stringify({ type: "player_left", tableId, playerId, seatIndex });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    try { client.ws.send(payload); } catch {}
  }
}

export function broadcastBlindEvent(tableId: number, event: string, data: object): void {
  const clients = tableSubscribers.get(tableId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type: event, ...data });
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    try { client.ws.send(payload); } catch {}
  }
}

function removeTableClient(ws: WebSocket, tableId: number): void {
  const clients = tableSubscribers.get(tableId);
  if (!clients) return;
  for (const client of clients) {
    if (client.ws === ws) {
      clients.delete(client);
      break;
    }
  }
  if (clients.size === 0) tableSubscribers.delete(tableId);
}

// ── Lobby subscribers (table list) ────────────────────────────────────────
const lobbySubscribers = new Set<WebSocket>();

// ── Security panel subscribers (real-time player location feed) ────────────
const securitySubscribers = new Set<WebSocket>();

export function broadcastSecurityUpdate(player: { playerId: number; username: string; game: string; status: string; lastSeenAt: number }): void {
  if (securitySubscribers.size === 0) return;
  const payload = JSON.stringify({ type: "security_player_update", player });
  for (const ws of securitySubscribers) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

export function broadcastToSecurityClients(msg: object): void {
  if (securitySubscribers.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const ws of securitySubscribers) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

function lobbyTableSummary(table: any) {
  const { gameState: _gs, ...rest } = table;
  return rest;
}

export function broadcastTablesUpdate(tables: any[]): void {
  if (lobbySubscribers.size === 0) return;
  const payload = JSON.stringify({ type: "tables_update", tables: tables.map(lobbyTableSummary) });
  for (const ws of lobbySubscribers) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

// ── Player wallet subscribers ──────────────────────────────────────────────
const playerSubscribers = new Map<number, Set<WebSocket>>();

export function broadcastPlayerBalance(playerId: number, chips: number, babalari?: number): void {
  const clients = playerSubscribers.get(playerId);
  if (!clients || clients.size === 0) return;

  const payload = JSON.stringify({ type: "chip_update", playerId, chips: Number(chips), ...(babalari !== undefined ? { babalari: Number(babalari) } : {}) });
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

export function broadcastToPlayer(playerId: number, msg: object): void {
  const clients = playerSubscribers.get(playerId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

export function broadcastPlayerBalanceDelayed(playerId: number, chips: number, delayMs: number): void {
  setTimeout(() => broadcastPlayerBalance(playerId, chips), delayMs);
}

function removePlayerClient(ws: WebSocket, playerId: number): void {
  const clients = playerSubscribers.get(playerId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) playerSubscribers.delete(playerId);
}

function cleanupDeadClient(ws: WebSocket, tableId: number | null, playerId: number | null, tournamentId: number | null) {
  trackWsDisconnect();
  lobbySubscribers.delete(ws);
  if (tableId !== null) removeTableClient(ws, tableId);
  if (playerId !== null) removePlayerClient(ws, playerId);
  if (tournamentId !== null) removeTournamentClient(ws, tournamentId);
}


// ── Blackjack WS handler ───────────────────────────────────────────────────
async function handleBjAction(ws: WebSocket, msg: any) {
  const { token, action, bet, gameId } = msg;
  const playerId = typeof token === "string" ? (validatePlayerToken(token)?.playerId ?? null) : null;
  if (!playerId) return wsSend(ws, { type: "bj_error", message: "Unauthorized" });

  if (action === "deal") {
    if (!bet) return wsSend(ws, { type: "bj_error", message: "bet is required" });

    const enabled = (await getSetting("blackjackEnabled", "true")) === "true";
    if (!enabled) return wsSend(ws, { type: "bj_error", message: "Blackjack table is currently closed" });

    const minBet = parseInt(await getSetting("blackjackMinBet", "100"));
    const maxBet = parseInt(await getSetting("blackjackMaxBet", "10000"));
    if (bet < minBet || bet > maxBet)
      return wsSend(ws, { type: "bj_error", message: `Bet must be between ${minBet} and ${maxBet} chips` });

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return wsSend(ws, { type: "bj_error", message: "Player not found" });
    if (player.chips < bet) return wsSend(ws, { type: "bj_error", message: "Insufficient chips" });

    await db.update(blackjackGamesTable).set({ status: "abandoned" })
      .where(and(eq(blackjackGamesTable.playerId, playerId), eq(blackjackGamesTable.status, "active")));

    await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Blackjack bet" });

    const bjRealRatio = await trackRakebackBet(playerId, bet);

    const deck = createDeck(6);
    const { playerCards, dealerCards } = dealInitialHand(deck);

    let status = "active";
    let payout: number | null = null;

    if (handValue(playerCards) === 21) {
      const fullDealerCards = dealerCards.map((c: Card) => ({ ...c, hidden: false }));
      const result = determineWinner(playerCards, fullDealerCards);
      const fp = calculatePayout(bet, result);
      status = result; payout = fp;
      if (fp > 0) {
        await db.update(playersTable).set({ chips: player.chips - bet + fp }).where(eq(playersTable.id, playerId));
        await db.insert(transactionsTable).values({ playerId, amount: fp, type: "win", description: `Blackjack payout (${result})` });
        await trackRakebackWin(playerId, fp, bjRealRatio);
      }
      const [game] = await db.insert(blackjackGamesTable).values({ playerId, status, playerCards: playerCards as any, dealerCards: fullDealerCards as any, bet, payout: fp }).returning();
      bjRakebackRatio.delete(game.id);
      const [up] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      broadcastPlayerBalance(playerId, Number(up.chips));
      return wsSend(ws, { type: "bj_result", action: "deal", game: { ...game, playerValue: handValue(playerCards), dealerValue: handValue(fullDealerCards) }, playerChips: Number(up.chips) });
    }

    const [game] = await db.insert(blackjackGamesTable).values({ playerId, status, playerCards: playerCards as any, dealerCards: dealerCards as any, bet }).returning();
    bjRakebackRatio.set(game.id, bjRealRatio);
    const [up] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(up.chips));
    return wsSend(ws, { type: "bj_result", action: "deal", game: { ...game, playerValue: handValue(playerCards), dealerValue: handValue([dealerCards[0]]) }, playerChips: Number(up.chips) });
  }

  // hit / stand / double — all need a gameId
  if (!gameId) return wsSend(ws, { type: "bj_error", message: "gameId is required" });
  const [game] = await db.select().from(blackjackGamesTable).where(eq(blackjackGamesTable.id, gameId));
  if (!game) return wsSend(ws, { type: "bj_error", message: "Game not found" });
  if (game.playerId !== playerId) return wsSend(ws, { type: "bj_error", message: "Not your game" });
  if (game.status !== "active") return wsSend(ws, { type: "bj_error", message: "Game is not active" });

  if (action === "hit") {
    const deck = createDeck(6);
    const wsHitOddsMode = await getSetting("blackjackOddsMode", "standard");
    const playerCards = [...(game.playerCards as Card[]), biasedDraw(deck, wsHitOddsMode, handValue(game.playerCards as Card[]), true)];
    let status: string = "active";
    if (isBust(playerCards)) status = "player_bust";
    const [updated] = await db.update(blackjackGamesTable)
      .set({ playerCards: playerCards as any, status, updatedAt: new Date() })
      .where(eq(blackjackGamesTable.id, gameId)).returning();
    const dealerCards = game.dealerCards as Card[];
    const visibleDealer = status === "player_bust" ? dealerCards.map((c: Card) => ({ ...c, hidden: false })) : dealerCards;
    if (status === "player_bust") await db.update(blackjackGamesTable).set({ dealerCards: visibleDealer as any }).where(eq(blackjackGamesTable.id, gameId));
    return wsSend(ws, { type: "bj_result", action: "hit", game: { ...updated, dealerCards: visibleDealer, playerValue: handValue(playerCards), dealerValue: handValue([visibleDealer[0]]) } });
  }

  if (action === "stand") {
    const playerCards = game.playerCards as Card[];
    const deck = createDeck(6);
    const wsStandOddsMode = await getSetting("blackjackOddsMode", "standard");
    const { dealerCards: finalDealerCards } = dealerPlay(game.dealerCards as Card[], deck, wsStandOddsMode);
    const result = determineWinner(playerCards, finalDealerCards);
    const payout = calculatePayout(game.bet, result);
    if (payout > 0) {
      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Blackjack payout (${result})` });
      const ratio = bjRakebackRatio.get(gameId) ?? 0;
      await trackRakebackWin(playerId, payout, ratio);
    }
    bjRakebackRatio.delete(gameId);
    const totalHands = parseInt(await getSetting("totalHandsPlayed", "0"));
    await setSetting("totalHandsPlayed", String(totalHands + 1));
    const [updated] = await db.update(blackjackGamesTable).set({ dealerCards: finalDealerCards as any, status: result, payout, updatedAt: new Date() }).where(eq(blackjackGamesTable.id, gameId)).returning();
    const [up] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(up.chips));
    return wsSend(ws, { type: "bj_result", action: "stand", game: { ...updated, dealerCards: finalDealerCards, playerValue: handValue(playerCards), dealerValue: handValue(finalDealerCards) }, playerChips: Number(up.chips) });
  }

  if (action === "double") {
    if ((game.playerCards as Card[]).length !== 2) return wsSend(ws, { type: "bj_error", message: "Can only double on first two cards" });
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (player.chips < game.bet) return wsSend(ws, { type: "bj_error", message: "Insufficient chips to double down" });

    await db.update(playersTable).set({ chips: player.chips - game.bet }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: game.bet, type: "loss", description: "Blackjack double down bet" });

    const doubleRatio = await trackRakebackBet(playerId, game.bet);
    const origRatio = bjRakebackRatio.get(gameId) ?? 0;
    const combinedRatio = (origRatio + doubleRatio) / 2;

    const deck = createDeck(6);
    const wsDoubleOddsMode = await getSetting("blackjackOddsMode", "standard");
    const playerCards = [...(game.playerCards as Card[]), biasedDraw(deck, wsDoubleOddsMode, handValue(game.playerCards as Card[]), true)];
    const totalBet = game.bet * 2;
    let status: string;
    let finalDealerCards = game.dealerCards as Card[];

    if (isBust(playerCards)) {
      status = "player_bust";
      finalDealerCards = finalDealerCards.map((c: Card) => ({ ...c, hidden: false }));
    } else {
      const { dealerCards } = dealerPlay(game.dealerCards as Card[], deck, wsDoubleOddsMode);
      finalDealerCards = dealerCards;
      status = determineWinner(playerCards, finalDealerCards);
    }

    const payout = calculatePayout(totalBet, status as any);
    if (payout > 0) {
      const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      await db.update(playersTable).set({ chips: fresh.chips + payout }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Blackjack payout (double, ${status})` });
      await trackRakebackWin(playerId, payout, combinedRatio);
    }
    bjRakebackRatio.delete(gameId);
    const totalHands = parseInt(await getSetting("totalHandsPlayed", "0"));
    await setSetting("totalHandsPlayed", String(totalHands + 1));
    const [updated] = await db.update(blackjackGamesTable).set({ playerCards: playerCards as any, dealerCards: finalDealerCards as any, status, bet: totalBet, payout, updatedAt: new Date() }).where(eq(blackjackGamesTable.id, gameId)).returning();
    const [up] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, Number(up.chips));
    return wsSend(ws, { type: "bj_result", action: "double", game: { ...updated, dealerCards: finalDealerCards, playerValue: handValue(playerCards), dealerValue: handValue(finalDealerCards) }, playerChips: Number(up.chips) });
  }

  wsSend(ws, { type: "bj_error", message: `Unknown blackjack action: ${action}` });
}

// ── Tournament subscribers ─────────────────────────────────────────────────
const tournamentSubscribers = new Map<number, Set<WebSocket>>();

export function broadcastTournamentUpdate(tournamentId: number, data: any): void {
  const clients = tournamentSubscribers.get(tournamentId);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify({ type: "tournament_update", tournamentId, tournament: data });
  for (const ws of clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.send(payload); } catch {}
  }
}

function removeTournamentClient(ws: WebSocket, tournamentId: number): void {
  const clients = tournamentSubscribers.get(tournamentId);
  if (!clients) return;
  clients.delete(ws);
  if (clients.size === 0) tournamentSubscribers.delete(tournamentId);
}

// ── Global broadcast (all connected clients) ───────────────────────────────
let _globalWss: WebSocketServer | null = null;

export function broadcastAll(msg: object): void {
  if (!_globalWss) return;
  const payload = JSON.stringify(msg);
  _globalWss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(payload); } catch {}
    }
  });
}

// ── WebSocket server setup ─────────────────────────────────────────────────
export function setupWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/api/ws", perMessageDeflate: true });
  _globalWss = wss;

  const HEARTBEAT_INTERVAL_MS = 30_000;
  setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as WebSocket & { _alive?: boolean };
      if (ext._alive === false) { ws.terminate(); return; }
      ext._alive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("connection", (ws: WebSocket) => {
    trackWsConnect();
    const ext = ws as WebSocket & { _alive?: boolean };
    ext._alive = true;

    let subscribedTableId: number | null = null;
    let subscribedPlayerId: number | null = null;
    let subscribedTournamentId: number | null = null;
    let subscribedBJTableId: number | null = null;
    let subscribedBacTableId: number | null = null;

    ws.on("pong", () => { ext._alive = true; });

    ws.on("message", (raw) => {
      ext._alive = true;
      try {
        const msg = JSON.parse(raw.toString());

        // ── Table channel ──────────────────────────────────────────────────
        if (msg.type === "subscribe" && typeof msg.tableId === "number") {
          if (subscribedTableId !== null) removeTableClient(ws, subscribedTableId);
          subscribedTableId = msg.tableId;
          const tid = msg.tableId as number;
          const clientPlayerId = typeof msg.playerId === "number" ? msg.playerId : null;
          // Cancel any pending disconnect stand-up for this player — they reconnected
          if (clientPlayerId !== null) cancelDisconnectStandup(clientPlayerId);
          if (!tableSubscribers.has(tid)) tableSubscribers.set(tid, new Set());
          tableSubscribers.get(tid)!.add({ ws, playerId: clientPlayerId });
          wsSend(ws, { type: "subscribed", tableId: tid });
          // Record presence for security panel — async lookup for username
          if (clientPlayerId) {
            db.select({ username: playersTable.username })
              .from(playersTable)
              .where(eq(playersTable.id, clientPlayerId))
              .then(([player]) => {
                if (player) recordPlayerActivity(clientPlayerId, player.username, "poker", false);
              })
              .catch(() => {});
          }

        // ── Player wallet channel ──────────────────────────────────────────
        } else if (msg.type === "subscribe_player" && typeof msg.playerId === "number" && typeof msg.token === "string") {
          const validated = validatePlayerToken(msg.token);
          if (!validated || validated.playerId !== msg.playerId) { wsSend(ws, { type: "error", message: "Unauthorized" }); return; }
          if (subscribedPlayerId !== null) removePlayerClient(ws, subscribedPlayerId);
          subscribedPlayerId = msg.playerId;
          const pid = msg.playerId as number;
          if (!playerSubscribers.has(pid)) playerSubscribers.set(pid, new Set());
          playerSubscribers.get(pid)!.add(ws);
          wsSend(ws, { type: "player_subscribed", playerId: pid });
          // Immediately send current chip balance so pages load the correct balance without waiting for a game event
          db.select().from(playersTable).where(eq(playersTable.id, pid))
            .then(([player]) => {
              if (player) wsSend(ws, { type: "chip_update", playerId: pid, chips: Number(player.chips) });
            })
            .catch(() => {});

        // ── Lobby channel ─────────────────────────────────────────────────
        } else if (msg.type === "subscribe_lobby") {
          lobbySubscribers.add(ws);
          wsSend(ws, { type: "lobby_subscribed" });

        // ── Tournament channel ─────────────────────────────────────────────
        } else if (msg.type === "subscribe_tournament" && typeof msg.tournamentId === "number") {
          if (subscribedTournamentId !== null) removeTournamentClient(ws, subscribedTournamentId);
          subscribedTournamentId = msg.tournamentId;
          const tsid = msg.tournamentId as number;
          if (!tournamentSubscribers.has(tsid)) tournamentSubscribers.set(tsid, new Set());
          tournamentSubscribers.get(tsid)!.add(ws);
          wsSend(ws, { type: "tournament_subscribed", tournamentId: tsid });

        // ── Poker action ───────────────────────────────────────────────────
        } else if (msg.type === "player_action") {
          const { tableId, playerId, token, action, amount, afk } = msg;
          const validated = typeof token === "string" ? validatePlayerToken(token) : null;
          const authedId = validated?.playerId ?? null;
          if (!authedId || authedId !== playerId) { wsSend(ws, { type: "action_ack", success: false, error: "Unauthorized" }); return; }
          if (validated?.username) {
            recordPlayerActivity(authedId, validated.username, "poker", true);
            broadcastSecurityUpdate({ playerId: authedId, username: validated.username, game: "poker", status: "playing", lastSeenAt: Date.now() });
          }
          handlePokerAction(tableId, authedId, action, amount ?? 0, afk === true)
            .then((result) => {
              if ("error" in result) {
                wsSend(ws, { type: "action_ack", success: false, error: result.error, tableId });
              } else {
                wsSend(ws, { type: "action_ack", success: true, tableId });
              }
            })
            .catch((err) => {
              wsSend(ws, { type: "action_ack", success: false, error: String(err), tableId });
            });

        // ── Roulette: multiplayer shared table ────────────────────────────
        } else if (msg.type === "subscribe_roulette") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          const pid = validated?.playerId ?? null;
          const uname: string | null = typeof msg.username === "string" ? msg.username : null;
          const avUrl: string | null = typeof msg.avatarUrl === "string" ? msg.avatarUrl : null;
          if (pid && uname) recordPlayerActivity(pid, uname, "roulette", false);
          removeRouletteSub(ws);
          subscribeRoulette(ws, pid, uname, avUrl);

        } else if (msg.type === "roulette_place_bet") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "roulette_error", message: "Unauthorized" }); return; }
          const avUrl2: string | null = typeof msg.avatarUrl === "string" ? msg.avatarUrl : null;
          roulettePlaceBet(ws, validated.playerId, msg.username ?? "Player", msg.bet, avUrl2)
            .then(r => { if (r.error) wsSend(ws, { type: "roulette_error", message: r.error }); })
            .catch(() => wsSend(ws, { type: "roulette_error", message: "Internal error" }));

        } else if (msg.type === "roulette_clear_bets") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "roulette_error", message: "Unauthorized" }); return; }
          rouletteClearBets(ws, validated.playerId)
            .then(r => { if (r.error) wsSend(ws, { type: "roulette_error", message: r.error }); })
            .catch(() => wsSend(ws, { type: "roulette_error", message: "Internal error" }));

        // ── Multiplayer Blackjack (multi-table) ───────────────────────────
        } else if (msg.type === "bj_subscribe") {
          // Unsubscribe from previous BJ table if any
          if (subscribedBJTableId !== null) {
            const prevRoom = getBJRoom(subscribedBJTableId);
            if (prevRoom) prevRoom.removeSub(ws);
            subscribedBJTableId = null;
          }
          const tableId = typeof msg.tableId === "number" ? msg.tableId : null;
          if (!tableId) { wsSend(ws, { type: "bj_error", message: "tableId is required" }); return; }
          const bjRoom = getBJRoom(tableId);
          if (!bjRoom) { wsSend(ws, { type: "bj_error", message: "Table not found" }); return; }
          if (!bjRoom.isOpen) { wsSend(ws, { type: "bj_error", message: "Table is closed" }); return; }
          const doSubscribe = () => {
            subscribedBJTableId = tableId;
            const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
            const pid = validated?.playerId ?? null;
            const bjUname: string | null = typeof msg.username === "string" ? msg.username : null;
            if (pid && bjUname) recordPlayerActivity(pid, bjUname, "blackjack", false);
            bjRoom.subscribe(ws, pid, bjUname, msg.avatarUrl ?? null);
          };
          if (bjRoom.passwordHash) {
            const suppliedPw = typeof msg.tablePassword === "string" ? msg.tablePassword : null;
            if (!suppliedPw) { wsSend(ws, { type: "bj_error", message: "This table requires a password" }); return; }
            bcrypt.compare(suppliedPw, bjRoom.passwordHash)
              .then(valid => {
                if (!valid) { wsSend(ws, { type: "bj_error", message: "Incorrect table password" }); return; }
                doSubscribe();
              })
              .catch(() => wsSend(ws, { type: "bj_error", message: "Internal error" }));
          } else {
            doSubscribe();
          }

        } else if (msg.type === "bj_sit") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bj_error", message: "Unauthorized" }); return; }
          const bjRoom = subscribedBJTableId !== null ? getBJRoom(subscribedBJTableId) : null;
          if (!bjRoom) { wsSend(ws, { type: "bj_error", message: "Not subscribed to a table" }); return; }
          bjRoom.sitDown(ws, validated.playerId, msg.seatIndex)
            .then(r => { if (r.error) wsSend(ws, { type: "bj_error", message: r.error }); })
            .catch(() => wsSend(ws, { type: "bj_error", message: "Internal error" }));

        } else if (msg.type === "bj_leave") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (validated && subscribedBJTableId !== null) {
            const bjRoom = getBJRoom(subscribedBJTableId);
            if (bjRoom) bjRoom.leaveSeat(validated.playerId);
          }

        } else if (msg.type === "bj_bet") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bj_error", message: "Unauthorized" }); return; }
          const bjRoom = subscribedBJTableId !== null ? getBJRoom(subscribedBJTableId) : null;
          if (!bjRoom) { wsSend(ws, { type: "bj_error", message: "Not subscribed to a table" }); return; }
          bjRoom.placeBet(ws, validated.playerId, msg.amount)
            .then(r => { if (r.error) wsSend(ws, { type: "bj_error", message: r.error }); })
            .catch(() => wsSend(ws, { type: "bj_error", message: "Internal error" }));

        } else if (msg.type === "bj_hit" || msg.type === "bj_stand" || msg.type === "bj_double" || msg.type === "bj_split") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bj_error", message: "Unauthorized" }); return; }
          const bjRoom = subscribedBJTableId !== null ? getBJRoom(subscribedBJTableId) : null;
          if (!bjRoom) { wsSend(ws, { type: "bj_error", message: "Not subscribed to a table" }); return; }
          const action = msg.type.replace("bj_", "");
          bjRoom.playerAction(validated.playerId, action)
            .then(r => { if (r.error) wsSend(ws, { type: "bj_error", message: r.error }); })
            .catch(() => wsSend(ws, { type: "bj_error", message: "Internal error" }));

        // ── Legacy singleplayer blackjack actions ──────────────────────────
        } else if (msg.type === "bj_action") {
          handleBjAction(ws, msg).catch(() => wsSend(ws, { type: "bj_error", message: "Blackjack error" }));

        // ── Baccarat channel ────────────────────────────────────────────────
        } else if (msg.type === "bac_subscribe" && typeof msg.tableId === "number") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bac_error", message: "Unauthorized" }); return; }
          bacUnsubscribe(ws);
          subscribedBacTableId = msg.tableId;
          bacSubscribe(ws, msg.tableId, validated.playerId, validated.username, null);

        } else if (msg.type === "bac_bet") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bac_error", message: "Unauthorized" }); return; }
          if (subscribedBacTableId === null) { wsSend(ws, { type: "bac_error", message: "Not subscribed" }); return; }
          bacPlaceBet(ws, subscribedBacTableId, validated.playerId, validated.username, msg.avatarUrl ?? null, msg.side, msg.amount)
            .catch(() => wsSend(ws, { type: "bac_error", message: "Internal error" }));

        } else if (msg.type === "bac_clear_bet") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (!validated) { wsSend(ws, { type: "bac_error", message: "Unauthorized" }); return; }
          if (subscribedBacTableId === null) { wsSend(ws, { type: "bac_error", message: "Not subscribed" }); return; }
          bacClearBet(ws, subscribedBacTableId, validated.playerId)
            .catch(() => wsSend(ws, { type: "bac_error", message: "Internal error" }));

        // ── Player page tracker ───────────────────────────────────────────
        } else if (msg.type === "player_page") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (validated) {
            const page = typeof msg.page === "string" && msg.page.trim() ? msg.page.trim() : "lobby";
            recordPlayerActivity(validated.playerId, validated.username, page, false);
            console.log(`[page-tracker] ${validated.username} → ${page}`);
            // Push real-time update to all security subscribers
            const now = Date.now();
            broadcastSecurityUpdate({
              playerId: validated.playerId,
              username: validated.username,
              game: page,
              status: "watching",
              lastSeenAt: now,
            });
          }

        // ── Security panel subscription ───────────────────────────────────
        } else if (msg.type === "subscribe_security") {
          const validated = typeof msg.token === "string" ? validatePlayerToken(msg.token) : null;
          if (validated) {
            securitySubscribers.add(ws);
            wsSend(ws, { type: "security_subscribed" });
          }

        } else if (msg.type === "ping") {
          wsSend(ws, { type: "pong" });
        }
      } catch {}
    });

    ws.on("close", () => {
      securitySubscribers.delete(ws);
      removeRouletteSub(ws); bjUnsubscribeAll(ws); bacUnsubscribe(ws);
      // Schedule auto-stand-up after grace period if player was seated at a cash table
      if (subscribedPlayerId !== null && subscribedTableId !== null) {
        scheduleDisconnectStandup(subscribedPlayerId, subscribedTableId);
      }
      cleanupDeadClient(ws, subscribedTableId, subscribedPlayerId, subscribedTournamentId);
    });
    ws.on("error", () => {
      securitySubscribers.delete(ws);
      removeRouletteSub(ws); bjUnsubscribeAll(ws); bacUnsubscribe(ws);
      if (subscribedPlayerId !== null && subscribedTableId !== null) {
        scheduleDisconnectStandup(subscribedPlayerId, subscribedTableId);
      }
      cleanupDeadClient(ws, subscribedTableId, subscribedPlayerId, subscribedTournamentId);
    });
  });

  // Start the shared multiplayer roulette room
  injectBroadcastBalance(broadcastPlayerBalance);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  injectAddFloorEvent((e) => addFloorEvent(e as any));
  initRouletteRoom().catch(console.error);

  // Inject balance broadcaster for blackjack rooms
  // (initBJRooms() is called in index.ts after runMigrations)
  injectBJBroadcastBalance(broadcastPlayerBalance);

  // Inject balance broadcaster for baccarat rooms
  // (initAllBaccaratRooms() is called in index.ts after runMigrations)
  injectBacBroadcastBalance(broadcastPlayerBalance);

  return wss;
}
