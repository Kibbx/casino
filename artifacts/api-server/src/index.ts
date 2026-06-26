import http from "http";
import app from "./app";
import { seedBankerAdmin } from "./routes/banker.js";
import { setupWebSocketServer, broadcastBlindEvent } from "./lib/table-ws.js";
import { getRouletteSubscribers } from "./lib/roulette-room.js";
import { getBJSubscribers, initBJRooms } from "./lib/blackjack-room.js";
import { initAllBaccaratRooms } from "./lib/baccarat-room.js";
import { recordPlayerActivity } from "./lib/player-activity.js";
import { loadSessionsFromDb } from "./lib/sessions.js";
import { runMigrations } from "./lib/migrations.js";
import { startLoanJobs } from "./lib/loan-jobs.js";
import { startSportbetCleanupJob } from "./lib/sportbet-cleanup.js";
import { db, pokerTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { scheduleAutoStart } from "./lib/game-loop.js";
import type { Seat } from "./lib/poker-engine.js";
import { initEscalation, startEscalationLoop, setBlindBroadcastFn, updateSeatedCount } from "./lib/blind-escalation.js";

async function recoverTables(): Promise<void> {
  const tables = await db.select().from(pokerTablesTable);
  let recovered = 0;
  for (const table of tables) {
    const seats = (table.seats as Seat[]) ?? [];
    const activePlayers = seats.filter((s) => s.playerId && (s.chips ?? 0) > 0);

    // Init blind escalation for every table
    initEscalation(table);
    updateSeatedCount(table.id, activePlayers.length);

    if (table.status === "playing") {
      // Server restarted mid-hand — reset to a recoverable state
      const newStatus = activePlayers.length >= 2 ? "finished" : "waiting";
      await db
        .update(pokerTablesTable)
        .set({ status: newStatus, gameState: null })
        .where(eq(pokerTablesTable.id, table.id));
      if (activePlayers.length >= 2) scheduleAutoStart(table.id);
      console.log(`[Startup] Recovered stuck table ${table.id} ("playing" → "${newStatus}")`);
      recovered++;
    } else if ((table.status === "waiting" || table.status === "finished") && activePlayers.length >= 2) {
      // Auto-start timer was lost on restart — reschedule it
      scheduleAutoStart(table.id);
      console.log(`[Startup] Rescheduled auto-start for table ${table.id} (${activePlayers.length} players)`);
      recovered++;
    }
  }
  if (recovered === 0) console.log("[Startup] All tables OK — no recovery needed");
}

// Default to 8080 — the deployment runner invokes the binary directly
// without always injecting PORT, so we fall back to the standard API port.
const port = Number(process.env["PORT"] ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

const server = http.createServer(app);
setupWebSocketServer(server);

// Server-side heartbeat: record activity for all players connected via WebSocket.
// This is the authoritative source for roulette/blackjack presence — completely
// independent of the frontend HTTP ping, so lobby pings can never override it.
setInterval(() => {
  for (const { playerId, username } of getRouletteSubscribers()) {
    recordPlayerActivity(playerId, username, "roulette", false);
  }
  for (const { playerId, username } of getBJSubscribers()) {
    recordPlayerActivity(playerId, username, "blackjack", false);
  }
}, 10_000);

server.listen(port, async () => {
  console.log(`Server listening on port ${port}`);
  await runMigrations();
  await loadSessionsFromDb();
  await seedBankerAdmin();
  await recoverTables();
  await initBJRooms();
  await initAllBaccaratRooms();
  startLoanJobs();
  startSportbetCleanupJob();
  setBlindBroadcastFn(broadcastBlindEvent);
  startEscalationLoop();
});
