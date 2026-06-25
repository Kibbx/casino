import { db, pokerTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { initGame, autoAdvanceIfNeeded, type Seat, type GameState } from "./poker-engine.js";
import { broadcastTableState } from "./table-ws.js";
import { notifyTableUpdate, serializeTable } from "./table-cache.js";

const AUTO_START_DELAY_MS = 12_000;

const pendingStarts = new Map<number, ReturnType<typeof setTimeout>>();

export function scheduleAutoStart(tableId: number): void {
  if (pendingStarts.has(tableId)) return;

  const timer = setTimeout(async () => {
    pendingStarts.delete(tableId);
    try {
      const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
      if (!table) return;

      if (table.status !== "waiting" && table.status !== "finished") return;

      const seats = table.seats as Seat[];

      // Reset seat statuses — mirrors what the manual /start endpoint does.
      // "folded" players from the previous hand get re-enabled, and "sitting_out"
      // players (who joined mid-hand) are promoted to "sitting" so they're dealt in.
      for (const seat of seats) {
        if (seat.playerId) {
          seat.status = "sitting";
          seat.currentBet = 0;
        }
      }

      const activePlayers = seats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
      if (activePlayers.length < 2) return;

      const currentDealerSeat = (table.gameState as GameState)?.dealerSeat ?? -1;
      let gameState = initGame(seats, table.smallBlind, table.bigBlind, currentDealerSeat);

      // Handle edge case: all players went all-in from blind posting (owesAction already empty)
      const advanced = autoAdvanceIfNeeded(seats, gameState, table.rakePercent, table.rakeCap);
      if (advanced.gameState !== gameState) {
        gameState = advanced.gameState;
        Object.assign(seats, advanced.seats);
        console.log(`[GameLoop] All-in from blinds — board run out automatically on table ${tableId}`);
      }

      const newStatus = gameState.winners?.length ? "finished" : "playing";

      const [updated] = await db
        .update(pokerTablesTable)
        .set({ status: newStatus, gameState, seats })
        .where(eq(pokerTablesTable.id, tableId))
        .returning();

      if (updated) {
        notifyTableUpdate(updated);
        broadcastTableState(tableId, serializeTable(updated));
        console.log(`[GameLoop] Auto-started hand on table ${tableId} (${activePlayers.length} players)`);
      }
    } catch (err) {
      console.error(`[GameLoop] Auto-start error on table ${tableId}:`, err);
    }
  }, AUTO_START_DELAY_MS);

  pendingStarts.set(tableId, timer);
}

export function cancelAutoStart(tableId: number): void {
  const timer = pendingStarts.get(tableId);
  if (timer) {
    clearTimeout(timer);
    pendingStarts.delete(tableId);
  }
}
