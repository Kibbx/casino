import { db, pokerTablesTable, playersTable, transactionsTable, settingsTable, tournamentEntriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { processAction, activeSeatCount, type Seat, type GameState, type PlayerAction } from "./poker-engine.js";
import { broadcastTableState, broadcastPlayerBalance, broadcastPlayerLeft } from "./table-ws.js";
import { notifyTableUpdate, serializeTable } from "./table-cache.js";
import { scheduleAutoStart, cancelAutoStart } from "./game-loop.js";
import { updateSeatedCount } from "./blind-escalation.js";
import { consolidateTournamentTables, updateLeaderboardSnapshot, pushTournamentUpdate } from "../routes/tournaments.js";

export const TURN_TIME_LIMIT_SEC = 30;
export const TIMEBANK_MAX_SEC = 90;
export const TIMEBANK_ACCRUAL_PER_10_HANDS = 5;
export const AFK_FOLD_THRESHOLD = 2;
export const TOURNAMENT_AFK_CONSEC_FOLDS = 5;
export const TOURNAMENT_AFK_TIMEOUT_MS = 30 * 60 * 1000;

// ── Poker session accumulator ─────────────────────────────────────────────────
// Accumulates per-hand wins and rake in memory, flushing ONE grouped
// transaction when the player leaves or busts, instead of inserting
// an individual entry every hand.

interface PokerSession {
  tableName: string;
  hands: number;
  totalWon: number;   // gross winnings (pot amounts)
  totalRake: number;  // rake taken from winnings
}

const pokerSessions = new Map<number, PokerSession>(); // key = playerId

export function accumulatePokerHand(
  playerId: number,
  tableName: string,
  wonAmount: number,
  rakeAmount: number,
): void {
  const s = pokerSessions.get(playerId);
  if (s) {
    s.hands += 1;
    s.totalWon += wonAmount;
    s.totalRake += rakeAmount;
  } else {
    pokerSessions.set(playerId, {
      tableName,
      hands: 1,
      totalWon: wonAmount,
      totalRake: rakeAmount,
    });
  }
}

export async function flushPokerSession(playerId: number): Promise<void> {
  const s = pokerSessions.get(playerId);
  pokerSessions.delete(playerId);
  if (!s || s.hands === 0) return;

  // Poker is player-vs-player — the house only earns rake.
  // Buy-in and cash-out entries already capture the player's real chip flow,
  // so we only log the rake here (no redundant win/loss session summary).
  const handWord = s.hands === 1 ? "hand" : "hands";
  if (s.totalRake > 0) {
    await db.insert(transactionsTable).values({
      playerId,
      amount: s.totalRake,
      type: "rake",
      description: `Poker rake at "${s.tableName}" — ${s.hands} ${handWord}`,
    });
  }
}

export type ActionResult =
  | { success: true; table: any }
  | { error: string; status: number };

export async function handlePokerAction(
  tableId: number,
  playerId: number,
  action: string,
  amount: number,
  afk: boolean,
): Promise<ActionResult> {
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return { error: "Table not found", status: 404 };
  if (table.status !== "playing") return { error: "Game is not in progress", status: 400 };

  const seats = table.seats as Seat[];
  const gameState = table.gameState as GameState;
  if (!gameState) return { error: "No active game", status: 400 };

  const seat = seats.find((s) => s.playerId === playerId);
  if (!seat) return { error: "Player not at this table", status: 400 };
  if (gameState.currentPlayerSeat !== seat.seatIndex) return { error: "Not your turn", status: 400 };
  if (gameState.winners?.length) return { error: "Hand is already over", status: 400 };

  // AFK fold tracking
  if (afk === true && action === "fold") {
    seat.afkFolds = (seat.afkFolds ?? 0) + 1;
    // Only start the removal clock after TOURNAMENT_AFK_CONSEC_FOLDS consecutive AFK folds
    if (!seat.afkSinceMs && seat.afkFolds >= TOURNAMENT_AFK_CONSEC_FOLDS) {
      seat.afkSinceMs = Date.now();
    }
  } else {
    seat.afkFolds = 0;
    seat.afkSinceMs = undefined;
  }

  // Timebank deduction
  const turnStartedAt = gameState.turnStartedAt ?? Date.now();
  const elapsedSec = (Date.now() - turnStartedAt) / 1000;
  if (elapsedSec > TURN_TIME_LIMIT_SEC) {
    const timebankUsed = Math.ceil(elapsedSec - TURN_TIME_LIMIT_SEC);
    const newBank = Math.max(0, (seat.timebankSeconds ?? 15) - timebankUsed);
    seat.timebankSeconds = newBank;
    await db.update(playersTable).set({ timebankSeconds: newBank }).where(eq(playersTable.id, playerId));
  }

  const { seats: newSeats, gameState: newState } = processAction(
    seats,
    gameState,
    seat.seatIndex,
    action as PlayerAction,
    amount ?? 0,
    table.rakePercent,
    table.rakeCap,
  );

  // AFK removal — regular tables: no auto-kick; only tournament long-AFK removal
  const afkTooLong = !!(table.tournamentId && seat.afkSinceMs && Date.now() - seat.afkSinceMs > TOURNAMENT_AFK_TIMEOUT_MS);
  if (afkTooLong) {
    const kickedSeat = newSeats.find((s) => s.playerId === playerId);
    if (kickedSeat) {
      const returnChips = kickedSeat.chips ?? 0;
      if (table.tournamentId) {
        const [entry] = await db.select().from(tournamentEntriesTable)
          .where(and(eq(tournamentEntriesTable.tournamentId, table.tournamentId), eq(tournamentEntriesTable.playerId, playerId)));
        if (entry) {
          await db.update(tournamentEntriesTable)
            .set({ tournamentChips: returnChips, status: returnChips === 0 ? "eliminated" : "active" })
            .where(eq(tournamentEntriesTable.id, entry.id));
        }
        console.log(`[Tournament] Removed AFK player ${playerId} from table ${table.id} after 10 min idle`);
      } else {
        const [playerRow] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
        if (playerRow) {
          await db.update(playersTable).set({ chips: playerRow.chips + returnChips }).where(eq(playersTable.id, playerId));
          await flushPokerSession(playerId);
          if (returnChips > 0) {
            await db.insert(transactionsTable).values({
              playerId, amount: returnChips, type: "cashout",
              description: `Poker cash-out (AFK) at "${table.name}"`,
            });
          }
          broadcastPlayerBalance(playerId, playerRow.chips + returnChips);
        }
      }
      kickedSeat.playerId = null;
      kickedSeat.playerName = null;
      kickedSeat.playerAvatarUrl = null;
      kickedSeat.chips = null;
      kickedSeat.status = "empty";
      kickedSeat.currentBet = 0;
      kickedSeat.afkFolds = 0;
      kickedSeat.afkSinceMs = undefined;
    }
  }

  // Hand end — NOTE: players with 0 chips are still present in newSeats here.
  // They are only removed from their seats INSIDE this block, AFTER chip distribution.
  // Nothing above this point should remove a player mid-hand.
  if (newState.winners?.length) {
    const tableType = table.tournamentId ? "tournament" : "cash";
    console.log(
      `[poker][${tableType}] Hand complete | table=${tableId} | winners: ${newState.winners.map((w) => `${w.playerName}+${w.amount}`).join(", ")}`,
    );
    newSeats.filter((s) => s.playerId).forEach((s) => {
      console.log(`  post-hand seat${s.seatIndex}(${s.playerName}): chips=${s.chips} status=${s.status}`);
    });

    const seatedPlayerIds = newSeats.filter((s) => s.playerId).map((s) => s.playerId as number);
    const playerRows = await Promise.all(
      seatedPlayerIds.map((pid) => db.select().from(playersTable).where(eq(playersTable.id, pid)).then((r) => r[0]))
    );
    await Promise.all(playerRows.map(async (p) => {
      if (!p) return;
      const newHandsPlayed = p.handsPlayed + 1;
      const accrued = Math.floor(newHandsPlayed / 10) > Math.floor(p.handsPlayed / 10) ? TIMEBANK_ACCRUAL_PER_10_HANDS : 0;
      const newTimebank = Math.min(TIMEBANK_MAX_SEC, p.timebankSeconds + accrued);
      await db.update(playersTable).set({ handsPlayed: newHandsPlayed, timebankSeconds: newTimebank }).where(eq(playersTable.id, p.id));
      const freshSeat = newSeats.find((s) => s.playerId === p.id);
      if (freshSeat) freshSeat.timebankSeconds = newTimebank;
    }));

    if (table.tournamentId) {
      for (const s of newSeats) {
        if (!s.playerId) continue;
        const [entry] = await db.select().from(tournamentEntriesTable)
          .where(and(eq(tournamentEntriesTable.tournamentId, table.tournamentId), eq(tournamentEntriesTable.playerId, s.playerId)));
        if (entry) {
          const chips = s.chips ?? 0;
          await db.update(tournamentEntriesTable)
            .set({ tournamentChips: chips, status: chips === 0 ? "eliminated" : "active" })
            .where(eq(tournamentEntriesTable.id, entry.id));
        }
      }
      for (const s of newSeats) {
        if (s.playerId && (s.chips ?? 0) === 0) {
          console.log(`[poker][tournament] Eliminating ${s.playerName} (seat${s.seatIndex}) — chips=0 after hand resolved`);
          s.playerId = null; s.playerName = null; s.playerAvatarUrl = null;
          s.chips = null; s.status = "empty"; s.currentBet = 0;
        }
      }
      const remaining = newSeats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
      const hadElimination = newSeats.some((s) => !s.playerId);
      if (remaining.length < 3) {
        setImmediate(() => consolidateTournamentTables(table.tournamentId!).catch(console.error));
      } else if (hadElimination) {
        setImmediate(() => updateLeaderboardSnapshot(table.tournamentId!).catch(console.error));
        setImmediate(() => pushTournamentUpdate(table.tournamentId!).catch(console.error));
      }
    } else {
      // Accumulate per-hand wins/rake into a session buffer (flushed on leave/bust)
      for (const w of newState.winners) {
        accumulatePokerHand(w.playerId, table.name, w.amount, w.rakeCollected ?? 0);
      }
      const totalRake = newState.winners.reduce((sum, w) => sum + (w.rakeCollected ?? 0), 0);
      if (totalRake > 0) {
        await Promise.all([
          (async () => {
            const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, "totalRakeCollected"));
            const current = parseInt(existing[0]?.value ?? "0");
            if (existing.length === 0) {
              await db.insert(settingsTable).values({ key: "totalRakeCollected", value: String(current + totalRake) });
            } else {
              await db.update(settingsTable).set({ value: String(current + totalRake) }).where(eq(settingsTable.key, "totalRakeCollected"));
            }
          })(),
          (async () => {
            const handsRow = await db.select().from(settingsTable).where(eq(settingsTable.key, "totalHandsPlayed"));
            const hands = parseInt(handsRow[0]?.value ?? "0");
            if (handsRow.length === 0) {
              await db.insert(settingsTable).values({ key: "totalHandsPlayed", value: "1" });
            } else {
              await db.update(settingsTable).set({ value: String(hands + 1) }).where(eq(settingsTable.key, "totalHandsPlayed"));
            }
          })(),
        ]);
      }

      // Remove busted players (0 chips) from their seats AFTER pot distribution.
      // Flush their poker session before clearing — their next buy-in starts fresh.
      for (const s of newSeats) {
        if (s.playerId && (s.chips ?? 0) === 0) {
          console.log(`[poker][cash] Busting ${s.playerName} (seat${s.seatIndex}) — chips=0 after hand resolved`);
          await flushPokerSession(s.playerId);
          s.playerId = null; s.playerName = null; s.playerAvatarUrl = null;
          s.chips = null; s.status = "empty"; s.currentBet = 0;
          s.afkFolds = 0; s.afkSinceMs = undefined;
        }
      }
    }
  }

  const activeAfterKick = newSeats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
  let newTableStatus: "finished" | "playing" | "waiting" = newState.winners?.length ? "finished" : "playing";
  let newGameState: typeof newState | null = newState;
  if (newState.winners?.length && activeAfterKick.length < 2) {
    // Not enough players to continue — but keep gameState so players can see
    // who won and why before the table goes idle.
    // scheduleAutoStart will replace it with a fresh hand when 2+ players rejoin.
    newTableStatus = "waiting";
  }

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ seats: newSeats, gameState: newGameState, status: newTableStatus })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));

  if (newTableStatus === "finished") {
    scheduleAutoStart(tableId);
  }

  return { success: true, table: serializeTable(updated) };
}

// ── Auto-stand-up on disconnect ───────────────────────────────────────────────
// Called when a player's WebSocket closes (after a grace period).
// Returns chips to the player's wallet and clears their seat.
// Tournament seats are intentionally left alone — tournament chips stay in-play.
export async function standUpPlayer(tableId: number, playerId: number): Promise<void> {
  try {
    const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
    if (!table) return;

    const seats = table.seats as Seat[];
    const seat = seats.find((s) => s.playerId === playerId);
    if (!seat) return; // player not seated — nothing to do

    if (table.tournamentId) return; // tournament seats persist through disconnects

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return;

    const returnChips = seat.chips ?? 0;
    const leftSeatIndex = seat.seatIndex;

    // Return chips to wallet
    await flushPokerSession(playerId);
    await db.update(playersTable)
      .set({ chips: player.chips + returnChips })
      .where(eq(playersTable.id, playerId));
    if (returnChips > 0) {
      await db.insert(transactionsTable).values({
        playerId,
        amount: returnChips,
        type: "cashout",
        description: `Poker cash-out at "${table.name}" (disconnected)`,
      });
    }
    broadcastPlayerBalance(playerId, player.chips + returnChips);

    let workingSeats = seats;
    let workingGameState: GameState | null = table.gameState as GameState | null;

    // Auto-fold if it's their turn so the game doesn't stall
    if (
      table.status === "playing" &&
      workingGameState &&
      !workingGameState.winners?.length &&
      workingGameState.currentPlayerSeat === leftSeatIndex
    ) {
      try {
        const { seats: foldedSeats, gameState: foldedState } = processAction(
          workingSeats.map((s) => ({ ...s })),
          workingGameState,
          leftSeatIndex,
          "fold",
          0,
          table.rakePercent ?? 0,
          table.rakeCap ?? 0,
        );
        workingSeats = foldedSeats;
        workingGameState = foldedState;
        if (foldedState.winners?.length) {
          for (const w of foldedState.winners) {
            accumulatePokerHand(w.playerId, table.name, w.amount, (w as any).rakeCollected ?? 0);
          }
          for (const s of workingSeats) {
            if (s.playerId && s.playerId !== playerId && (s.chips ?? 0) === 0) {
              s.playerId = null; s.playerName = null; s.playerAvatarUrl = null;
              s.chips = null; s.status = "empty"; s.currentBet = 0;
              s.afkFolds = 0; s.afkSinceMs = undefined;
            }
          }
        }
      } catch (err) {
        console.error(`[standUp] Auto-fold on disconnect failed:`, err);
      }
    }

    // Clear the seat
    const leavingSeat = workingSeats.find((s) => s.playerId === playerId);
    if (leavingSeat) {
      leavingSeat.playerId = null; leavingSeat.playerName = null;
      leavingSeat.playerAvatarUrl = null; leavingSeat.chips = null;
      leavingSeat.status = "empty"; leavingSeat.currentBet = 0;
      leavingSeat.afkFolds = 0; leavingSeat.afkSinceMs = undefined;
    }

    const handEnded = !!(workingGameState?.winners?.length);
    let newStatus: "waiting" | "playing" | "finished" = table.status as any;
    if (handEnded) {
      newStatus = activeSeatCount(workingSeats) >= 2 ? "finished" : "waiting";
    } else if (activeSeatCount(workingSeats) < 2) {
      newStatus = "waiting";
      workingGameState = null;
    }
    const savedGameState = newStatus === "waiting" ? null : workingGameState;

    const [updated] = await db
      .update(pokerTablesTable)
      .set({ seats: workingSeats, status: newStatus, gameState: savedGameState })
      .where(eq(pokerTablesTable.id, tableId))
      .returning();

    if (updated) {
      notifyTableUpdate(updated);
      broadcastTableState(tableId, serializeTable(updated));
      broadcastPlayerLeft(tableId, playerId, leftSeatIndex);
      if (newStatus === "finished") scheduleAutoStart(tableId);
      const remaining = (updated.seats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0);
      updateSeatedCount(tableId, remaining.length);
      if (remaining.length < 2) cancelAutoStart(tableId);
      console.log(`[standUp] Player ${playerId} removed from table ${tableId} after disconnect`);
    }
  } catch (err) {
    console.error(`[standUp] Error removing player ${playerId} from table ${tableId}:`, err);
  }
}
