import { Router } from "express";
import { db, pokerTablesTable, playersTable, transactionsTable, tournamentEntriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireBanker, requireBankerOrOwner, requireDealerOrAbove, requirePlayer, requireSecurityOrAbove } from "../middleware/auth.js";
import { isPlayerGameBanned } from "./security.js";
import { validatePlayerToken } from "../lib/sessions.js";
import { broadcastTableState, broadcastPlayerBalance, broadcastTablesUpdate, broadcastPlayerJoined, broadcastPlayerLeft } from "../lib/table-ws.js";
import { initGame, autoAdvanceIfNeeded, activeSeatCount, processAction, type Seat, type GameState } from "../lib/poker-engine.js";
import { notifyTableUpdate, notifyTableDeleted, serializeTable } from "../lib/table-cache.js";
import { scheduleAutoStart, cancelAutoStart } from "../lib/game-loop.js";
import { handlePokerAction, flushPokerSession, accumulatePokerHand } from "../lib/poker-action-handler.js";
import { updateSeatedCount, updateEscalationConfig, initEscalation, getEscalationState } from "../lib/blind-escalation.js";

const router = Router();

async function broadcastAllTables() {
  const tables = await db.select().from(pokerTablesTable);
  broadcastTablesUpdate(tables.map(serializeTable));
}

router.get("/", async (_req, res) => {
  const tables = await db.select().from(pokerTablesTable).orderBy(pokerTablesTable.id);
  res.json(tables.map(serializeTable));
});

router.post("/", requireDealerOrAbove, async (req, res) => {
  const { name, smallBlind, bigBlind, minBuyIn, maxBuyIn, rakePercent, rakeCap, password, theme } = req.body;
  if (!name || !smallBlind || !bigBlind || !minBuyIn || !maxBuyIn) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const validThemes = ["velvet", "gold", "diamond"];
  const tableTheme = validThemes.includes(theme) ? theme : "velvet";

  const seats: Seat[] = Array.from({ length: 8 }, (_, i) => ({
    seatIndex: i,
    playerId: null,
    playerName: null,
    chips: null,
    status: "empty",
    currentBet: 0,
  }));

  const [table] = await db
    .insert(pokerTablesTable)
    .values({
      name,
      smallBlind,
      bigBlind,
      minBuyIn,
      maxBuyIn,
      rakePercent: rakePercent ?? 5,
      rakeCap: rakeCap ?? 500,
      seats,
      status: "waiting",
      password: password ? String(password) : null,
      theme: tableTheme,
    })
    .returning();

  notifyTableUpdate(table);
  void broadcastAllTables();
  initEscalation(table);
  return res.status(201).json(serializeTable(table));
});

router.get("/:tableId", async (req, res) => {
  const id = parseInt(req.params.tableId as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });

  // Identify the requesting player via optional Bearer token
  let requestingPlayerId: number | null = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    requestingPlayerId = validatePlayerToken(auth.slice(7))?.playerId ?? null;
  }

  const serialized = serializeTable(table) as any;

  if (serialized.gameState?.playerHands) {
    const gs = serialized.gameState;
    const isShowdown = gs.phase === "showdown" && gs.winners?.length;
    if (!isShowdown) {
      // Only send the requesting player's own hand — strip everyone else's
      const filtered: Record<number, string[]> = {};
      if (requestingPlayerId !== null) {
        const seats = table.seats as Seat[];
        const myseat = seats.find((s) => s.playerId === requestingPlayerId);
        if (myseat !== undefined) {
          // JSONB keys come back as strings; try both string and number forms
          const hand = gs.playerHands[myseat.seatIndex] ?? gs.playerHands[String(myseat.seatIndex)];
          if (hand) filtered[myseat.seatIndex] = hand;
        }
      }
      serialized.gameState = { ...gs, playerHands: filtered };
    }
  }

  return res.json(serialized);
});

router.delete("/:tableId", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.tableId as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const seats = table.seats as Seat[];

  // For non-tournament tables, return chips to players and record cashout transactions
  if (!table.tournamentId) {
    for (const seat of seats) {
      if (seat.playerId && seat.chips && seat.chips > 0) {
        const [player] = await db.select().from(playersTable).where(eq(playersTable.id, seat.playerId));
        if (player) {
          const returnChips = Number(seat.chips);
          await db
            .update(playersTable)
            .set({ chips: Number(player.chips) + returnChips })
            .where(eq(playersTable.id, seat.playerId));
          // Record the return so it appears in conservation accounting
          await db.insert(transactionsTable).values({
            playerId: seat.playerId,
            amount: returnChips,
            type: "cashout",
            description: `Table "${table.name}" closed — chips returned`,
          });
        }
      }
    }
  }

  await db.delete(pokerTablesTable).where(eq(pokerTablesTable.id, id));
  notifyTableDeleted(id);
  void broadcastAllTables();
  return res.json({ success: true, message: "Table deleted" });
});

router.post("/:tableId/join", requirePlayer, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const playerId = (req as any).authenticatedPlayerId as number;
  const banCheck = await isPlayerGameBanned(playerId, "poker");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Poker${banCheck.reason ? ": " + banCheck.reason : ""}` });
  const { buyIn, seatIndex: rawSeatIndex, password } = req.body;
  const seatIndex = rawSeatIndex !== undefined && rawSeatIndex !== null ? Number(rawSeatIndex) : undefined;

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  // Tournament tables auto-seat players on start — block manual join
  if (table.tournamentId) {
    return res.status(400).json({ error: "Tournament tables seat players automatically when the tournament starts" });
  }

  // Check if table is closed by staff
  if (table.status === "closed") {
    return res.status(403).json({ error: "This table is currently closed" });
  }

  // Check if table is locked
  if (table.locked) {
    return res.status(403).json({ error: "This table is locked and not accepting new players" });
  }

  // Check password if the table has one
  if (table.password) {
    if (!password) {
      return res.status(401).json({ error: "This table requires a password" });
    }
    if (String(password) !== table.password) {
      return res.status(401).json({ error: "Incorrect table password" });
    }
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  if (buyIn < table.minBuyIn || buyIn > table.maxBuyIn) {
    return res.status(400).json({ error: `Buy-in must be between ${table.minBuyIn} and ${table.maxBuyIn}` });
  }
  if (player.chips < buyIn) {
    return res.status(400).json({ error: "Insufficient chips" });
  }

  const seats = table.seats as Seat[];

  // Check already seated
  if (seats.some((s) => s.playerId === playerId)) {
    return res.status(400).json({ error: "Already seated at this table" });
  }

  let seat: Seat | undefined;
  if (seatIndex !== undefined && !isNaN(seatIndex)) {
    seat = seats.find((s) => Number(s.seatIndex) === seatIndex);
    if (!seat) return res.status(400).json({ error: "Invalid seat index" });
    if (seat.status !== "empty") return res.status(400).json({ error: "That seat is already taken" });
  } else {
    seat = seats.find((s) => s.status === "empty");
  }

  if (!seat) {
    return res.status(400).json({ error: "Table is full" });
  }
  seat.playerId = playerId;
  seat.playerName = player.username;
  seat.playerAvatarUrl = player.avatarUrl ?? null;
  seat.chips = buyIn;
  // If a hand is already in progress, mark as sitting_out so the engine ignores
  // them until the next hand — they'll be promoted to "sitting" by scheduleAutoStart.
  seat.status = table.status === "playing" ? "sitting_out" : "sitting";
  seat.currentBet = 0;
  seat.timebankSeconds = player.timebankSeconds ?? 15;

  // Deduct chips from player account
  await db.update(playersTable).set({ chips: player.chips - buyIn }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId,
    amount: buyIn,
    type: "buyin",
    description: `Poker buy-in at "${table.name}"`,
  });
  broadcastPlayerBalance(playerId, player.chips - buyIn);

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ seats })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  broadcastPlayerJoined(tableId, playerId, player.username, seat.seatIndex);
  void broadcastAllTables();

  // Auto-start: schedule a new hand if 2+ players are now seated
  const seatedNow = (updated.seats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0);
  updateSeatedCount(tableId, seatedNow.length);

  // If the table is stuck in "playing" state with fewer than 2 active (non-sitting-out)
  // players, it means the previous hand became orphaned (e.g. all players disconnected
  // without calling /leave).  Reset to "waiting" so the new player doesn't see the stale
  // hand and so a fresh hand can start.
  if (updated.status === "playing") {
    const activePlayers = (updated.seats as Seat[]).filter(
      (s) => s.playerId && (s.chips ?? 0) > 0 && s.status !== "sitting_out"
    );
    if (activePlayers.length < 2) {
      // Promote all sitting_out seated players back to "sitting" so auto-start works
      const resetSeats = (updated.seats as Seat[]).map((s) =>
        s.playerId && s.status === "sitting_out" ? { ...s, status: "sitting" as const } : s
      );
      const [reset] = await db
        .update(pokerTablesTable)
        .set({ status: "waiting", gameState: null, seats: resetSeats })
        .where(eq(pokerTablesTable.id, tableId))
        .returning();
      notifyTableUpdate(reset);
      broadcastTableState(tableId, serializeTable(reset));
      void broadcastAllTables();
      const resetSeated = resetSeats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
      if (resetSeated.length >= 2) scheduleAutoStart(tableId);
      return res.json(serializeTable(reset));
    }
  }

  if (seatedNow.length >= 2 && (updated.status === "waiting" || updated.status === "finished")) {
    scheduleAutoStart(tableId);
  }
  return res.json(serializeTable(updated));
});

router.post("/:tableId/leave", requirePlayer, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const seats = table.seats as Seat[];
  const seat = seats.find((s) => s.playerId === playerId);
  if (!seat) return res.status(400).json({ error: "Player not at this table" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const returnChips = seat.chips ?? 0;

  if (table.tournamentId) {
    // Tournament table: update tournament entry chips, do NOT touch player wallet
    const [entry] = await db
      .select()
      .from(tournamentEntriesTable)
      .where(and(eq(tournamentEntriesTable.tournamentId, table.tournamentId), eq(tournamentEntriesTable.playerId, playerId)));
    if (entry) {
      const newStatus = returnChips === 0 ? "eliminated" : "active";
      await db
        .update(tournamentEntriesTable)
        .set({ tournamentChips: returnChips, status: newStatus })
        .where(eq(tournamentEntriesTable.id, entry.id));
    }
  } else {
    // Regular table: flush poker session then return chips to player wallet
    await flushPokerSession(playerId);
    await db.update(playersTable).set({ chips: player.chips + returnChips }).where(eq(playersTable.id, playerId));
    if (returnChips > 0) {
      await db.insert(transactionsTable).values({
        playerId,
        amount: returnChips,
        type: "cashout",
        description: `Poker cash-out at "${table.name}"`,
      });
    }
    broadcastPlayerBalance(playerId, player.chips + returnChips);
  }

  // If a hand is in progress and it's this player's turn, auto-fold before leaving
  // so the game doesn't stall waiting for an action that will never come.
  let workingSeats = seats;
  let workingGameState: GameState | null = table.gameState as GameState | null;
  const leftSeatIndex = seat.seatIndex;

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

      // If the fold ended the hand, accumulate winnings into winner sessions (cash tables)
      if (foldedState.winners?.length && !table.tournamentId) {
        for (const w of foldedState.winners) {
          accumulatePokerHand(w.playerId, table.name, w.amount, (w as any).rakeCollected ?? 0);
        }
        // Bust any 0-chip players (excluding the one who is leaving — handled below)
        for (const s of workingSeats) {
          if (s.playerId && s.playerId !== playerId && (s.chips ?? 0) === 0) {
            s.playerId = null; s.playerName = null; s.playerAvatarUrl = null;
            s.chips = null; s.status = "empty"; s.currentBet = 0;
            s.afkFolds = 0; s.afkSinceMs = undefined;
          }
        }
      }
    } catch (err) {
      console.error("[leave] Auto-fold on leave failed:", err);
    }
  }

  // Clear the leaving player's seat
  const leavingSeat = workingSeats.find((s) => s.playerId === playerId);
  if (leavingSeat) {
    leavingSeat.playerId = null;
    leavingSeat.playerName = null;
    leavingSeat.playerAvatarUrl = null;
    leavingSeat.chips = null;
    leavingSeat.status = "empty";
    leavingSeat.currentBet = 0;
  }

  const handEnded = !!(workingGameState?.winners?.length);
  let newStatus: "waiting" | "playing" | "finished" = table.status as any;
  if (handEnded) {
    newStatus = activeSeatCount(workingSeats) >= 2 ? "finished" : "waiting";
  } else if (activeSeatCount(workingSeats) < 2) {
    newStatus = "waiting";
    workingGameState = null;
  }

  // Always clear game state when table returns to waiting — prevents stale showdown
  // data being visible to players who join an idle table.
  const savedGameState = newStatus === "waiting" ? null : workingGameState;

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ seats: workingSeats, status: newStatus, gameState: savedGameState })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  broadcastPlayerLeft(tableId, playerId, leftSeatIndex);
  void broadcastAllTables();

  // Schedule next auto-start if the hand just finished
  if (newStatus === "finished") {
    scheduleAutoStart(tableId);
  }

  // Cancel auto-start if too few players remain
  const remainingActive = (updated.seats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0);
  updateSeatedCount(tableId, remainingActive.length);
  if (remainingActive.length < 2) {
    cancelAutoStart(tableId);
  }
  return res.json(serializeTable(updated));
});

// ── Security force-kick: remove any stuck player from a seat ───────────────────
// POST /tables/:tableId/seats/:seatIndex/kick
// Security, pit boss, dealer, banker, or owner. Returns chips to wallet.
router.post("/:tableId/seats/:seatIndex/kick", requireSecurityOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const seatIndex = parseInt(req.params.seatIndex as string);

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const seats = table.seats as Seat[];
  const seat = seats.find((s) => s.seatIndex === seatIndex);
  if (!seat || !seat.playerId) return res.status(400).json({ error: "No player in that seat" });

  const playerId = seat.playerId;
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player record not found" });

  const returnChips = seat.chips ?? 0;
  const leftSeatIndex = seat.seatIndex;

  if (!table.tournamentId) {
    await flushPokerSession(playerId);
    await db.update(playersTable)
      .set({ chips: player.chips + returnChips })
      .where(eq(playersTable.id, playerId));
    if (returnChips > 0) {
      await db.insert(transactionsTable).values({
        playerId, amount: returnChips, type: "cashout",
        description: `Poker cash-out at "${table.name}" (force-kicked by staff)`,
      });
    }
    broadcastPlayerBalance(playerId, player.chips + returnChips);
  }

  let workingSeats = seats;
  let workingGameState: GameState | null = table.gameState as GameState | null;

  if (
    table.status === "playing" &&
    workingGameState &&
    !workingGameState.winners?.length &&
    workingGameState.currentPlayerSeat === leftSeatIndex
  ) {
    try {
      const { seats: foldedSeats, gameState: foldedState } = processAction(
        workingSeats.map((s) => ({ ...s })),
        workingGameState, leftSeatIndex, "fold", 0,
        table.rakePercent ?? 0, table.rakeCap ?? 0,
      );
      workingSeats = foldedSeats;
      workingGameState = foldedState;
      if (foldedState.winners?.length && !table.tournamentId) {
        for (const w of foldedState.winners) {
          accumulatePokerHand(w.playerId, table.name, w.amount, (w as any).rakeCollected ?? 0);
        }
      }
    } catch (err) {
      console.error("[kick] Auto-fold failed:", err);
    }
  }

  const kickedSeat = workingSeats.find((s) => s.seatIndex === leftSeatIndex);
  if (kickedSeat) {
    kickedSeat.playerId = null; kickedSeat.playerName = null;
    kickedSeat.playerAvatarUrl = null; kickedSeat.chips = null;
    kickedSeat.status = "empty"; kickedSeat.currentBet = 0;
    kickedSeat.afkFolds = 0; kickedSeat.afkSinceMs = undefined;
  }

  const handEnded = !!(workingGameState?.winners?.length);
  let newStatus: "waiting" | "playing" | "finished" = table.status as any;
  if (handEnded) {
    newStatus = activeSeatCount(workingSeats) >= 2 ? "finished" : "waiting";
  } else if (activeSeatCount(workingSeats) < 2) {
    newStatus = "waiting"; workingGameState = null;
  }
  const savedGameState = newStatus === "waiting" ? null : workingGameState;

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ seats: workingSeats, status: newStatus, gameState: savedGameState })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  broadcastPlayerLeft(tableId, playerId, leftSeatIndex);
  void broadcastAllTables();
  if (newStatus === "finished") scheduleAutoStart(tableId);
  const remaining = (updated.seats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0);
  updateSeatedCount(tableId, remaining.length);
  if (remaining.length < 2) cancelAutoStart(tableId);

  console.log(`[kick] Staff removed player ${playerId} from table ${tableId} seat ${seatIndex}`);
  return res.json({ ok: true, table: serializeTable(updated) });
});

// ── Tournament table switch (player-initiated free move) ───────────────────────
// POST /tables/:tableId/tournament-move
// Moves the authenticated player from their current tournament table to :tableId.
// Only allowed between hands (current table must not be actively playing a hand).
router.post("/:tableId/tournament-move", requirePlayer, async (req, res) => {
  const targetTableId = parseInt(req.params.tableId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [targetTable] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, targetTableId));
  if (!targetTable) return res.status(404).json({ error: "Table not found" });
  if (!targetTable.tournamentId) return res.status(400).json({ error: "Target table is not a tournament table" });
  if (targetTable.locked) return res.status(403).json({ error: "That table is locked" });

  // Find the player's tournament entry
  const [entry] = await db
    .select()
    .from(tournamentEntriesTable)
    .where(and(eq(tournamentEntriesTable.tournamentId, targetTable.tournamentId), eq(tournamentEntriesTable.playerId, playerId)));

  if (!entry) return res.status(400).json({ error: "You are not in this tournament" });
  if (entry.status !== "active") return res.status(400).json({ error: "Only active players can switch tables" });
  if (entry.tableId === targetTableId) return res.status(400).json({ error: "You are already at that table" });

  // Validate player has a seat on their current table
  if (!entry.tableId) return res.status(400).json({ error: "You do not have a current table assignment" });
  const [currentTable] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, entry.tableId));
  if (!currentTable) return res.status(404).json({ error: "Your current table no longer exists" });

  // Only allow move between hands
  if (currentTable.status === "playing") {
    return res.status(400).json({ error: "Cannot switch tables while a hand is in progress — wait for the hand to finish" });
  }

  const currentSeats = currentTable.seats as Seat[];
  const playerSeat = currentSeats.find((s) => s.playerId === playerId);
  if (!playerSeat) return res.status(400).json({ error: "You are not seated at your current table" });

  const chipsToMove = playerSeat.chips ?? entry.tournamentChips ?? 0;

  // Find a free seat on the target table
  const targetSeats = targetTable.seats as Seat[];
  const emptyTargetSeat = targetSeats.find((s) => s.status === "empty");
  if (!emptyTargetSeat) return res.status(400).json({ error: "Target table is full" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  // Remove from current table
  const leavingSeatIndex = playerSeat.seatIndex;
  playerSeat.playerId = null;
  playerSeat.playerName = null;
  playerSeat.playerAvatarUrl = null;
  playerSeat.chips = null;
  playerSeat.status = "empty";
  playerSeat.currentBet = 0;

  const currentActiveSeat = activeSeatCount(currentSeats);

  // If nobody remains on the source table, delete it; otherwise update it
  cancelAutoStart(entry.tableId);
  if (currentActiveSeat === 0) {
    await db.delete(pokerTablesTable).where(eq(pokerTablesTable.id, entry.tableId));
    notifyTableDeleted(entry.tableId);
    broadcastPlayerLeft(entry.tableId, playerId, leavingSeatIndex);
    console.log(`[TournamentMove] Deleted now-empty table ${entry.tableId}`);
  } else {
    const [updatedCurrent] = await db
      .update(pokerTablesTable)
      .set({
        seats: currentSeats,
        status: currentActiveSeat < 2 ? "waiting" : currentTable.status,
        gameState: currentActiveSeat < 2 ? null : currentTable.gameState,
      })
      .where(eq(pokerTablesTable.id, entry.tableId))
      .returning();

    notifyTableUpdate(updatedCurrent);
    broadcastTableState(entry.tableId, serializeTable(updatedCurrent));
    broadcastPlayerLeft(entry.tableId, playerId, leavingSeatIndex);
  }

  // Seat on target table — sit out if a hand is already in progress there
  emptyTargetSeat.playerId = playerId;
  emptyTargetSeat.playerName = player.username;
  emptyTargetSeat.playerAvatarUrl = player.avatarUrl ?? null;
  emptyTargetSeat.chips = chipsToMove;
  emptyTargetSeat.status = targetTable.status === "playing" ? "sitting_out" : "sitting";
  emptyTargetSeat.currentBet = 0;
  emptyTargetSeat.timebankSeconds = player.timebankSeconds ?? 15;

  const [updatedTarget] = await db
    .update(pokerTablesTable)
    .set({ seats: targetSeats })
    .where(eq(pokerTablesTable.id, targetTableId))
    .returning();

  // Update tournament entry
  await db
    .update(tournamentEntriesTable)
    .set({ tableId: targetTableId, tournamentChips: chipsToMove })
    .where(eq(tournamentEntriesTable.id, entry.id));

  notifyTableUpdate(updatedTarget);
  broadcastTableState(targetTableId, serializeTable(updatedTarget));
  broadcastPlayerJoined(targetTableId, playerId, player.username, emptyTargetSeat.seatIndex);

  // Trigger auto-start on the target if it was idle and now has enough players
  const targetActiveSeat = (targetSeats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0).length;
  if (targetActiveSeat >= 2 && (targetTable.status === "waiting" || targetTable.status === "finished")) {
    scheduleAutoStart(targetTableId);
  }

  void broadcastAllTables();
  return res.json({ success: true, tableId: targetTableId });
});

// ── Lock / unlock a table (banker only) ────────────────────────────────────────
router.patch("/:tableId/lock", requireDealerOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const newLocked = !table.locked;
  const [updated] = await db
    .update(pokerTablesTable)
    .set({ locked: newLocked })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  void broadcastAllTables();
  return res.json(serializeTable(updated));
});

router.patch("/:tableId/rake", requireBankerOrOwner, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const { rakePercent, rakeCap } = req.body;

  const pct = parseFloat(rakePercent);
  const cap = parseInt(rakeCap);
  if (isNaN(pct) || pct < 0) return res.status(400).json({ error: "Invalid rakePercent" });
  if (isNaN(cap) || cap < 0) return res.status(400).json({ error: "Invalid rakeCap" });

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ rakePercent: pct, rakeCap: cap })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  void broadcastAllTables();
  return res.json(serializeTable(updated));
});

router.patch("/:tableId/password", requireDealerOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const { password } = req.body;
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const newPassword = (typeof password === "string" && password.trim()) ? password.trim() : null;
  const [updated] = await db
    .update(pokerTablesTable)
    .set({ password: newPassword })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  void broadcastAllTables();
  return res.json(serializeTable(updated));
});

router.post("/:tableId/start", requirePlayer, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const seats = table.seats as Seat[];

  // Count all seated players (status will be reset below — don't filter by "sitting" here)
  const seatedPlayers = seats.filter((s) => s.playerId);

  if (seatedPlayers.length < 2) {
    return res.status(400).json({ error: "Need at least 2 players to start" });
  }

  // Reset seat statuses — clears "folded" / "allIn" from the previous hand
  for (const seat of seats) {
    if (seat.playerId) {
      seat.status = "sitting";
      seat.currentBet = 0;
    }
  }

  cancelAutoStart(tableId); // clear any pending auto-start since we're starting now
  const currentDealerSeat = (table.gameState as GameState)?.dealerSeat ?? -1;
  let gameState = initGame(seats, table.smallBlind, table.bigBlind, currentDealerSeat);

  // Handle edge case: all players went all-in from blind posting (owesAction already empty)
  const advanced = autoAdvanceIfNeeded(seats, gameState, table.rakePercent, table.rakeCap);
  if (advanced.gameState !== gameState) {
    gameState = advanced.gameState;
    Object.assign(seats, advanced.seats);
    console.log(`[Tables] All-in from blinds — board run out automatically on table ${tableId}`);
  }

  const newStatus = gameState.winners?.length ? "finished" : "playing";

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ status: newStatus, gameState, seats })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  notifyTableUpdate(updated);
  broadcastTableState(tableId, serializeTable(updated));
  return res.json(serializeTable(updated));
});

const TURN_TIME_LIMIT_SEC = 30;
const TIMEBANK_MAX_SEC = 90;
const TIMEBANK_ACCRUAL_PER_10_HANDS = 5;

const AFK_FOLD_THRESHOLD = 2;          // regular tables: consecutive folds before kick
const TOURNAMENT_AFK_TIMEOUT_MS = 10 * 60 * 1000; // tournaments: 10 min idle → remove
const READY_THRESHOLD_PCT = 0.75;      // 75% of table must ready-up

// ── Ready-up (tournament tables only) ─────────────────────────────────────────
router.post("/:tableId/ready", requirePlayer, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });
  if (!table.tournamentId) return res.status(400).json({ error: "Ready-up is only for tournament tables" });
  if (table.status !== "waiting") return res.json({ alreadyStarted: true });

  const seats = table.seats as Seat[];
  const seat = seats.find((s) => s.playerId === playerId);
  if (!seat) return res.status(400).json({ error: "Player not at this table" });

  const readyIds = (table.readyPlayerIds as number[]) ?? [];
  const alreadyReady = readyIds.includes(playerId);
  const newReadyIds = alreadyReady ? readyIds.filter((id) => id !== playerId) : [...readyIds, playerId];

  const [updated] = await db
    .update(pokerTablesTable)
    .set({ readyPlayerIds: newReadyIds })
    .where(eq(pokerTablesTable.id, tableId))
    .returning();

  broadcastTableState(tableId, serializeTable(updated));
  notifyTableUpdate(updated);

  const seatedPlayers = seats.filter((s) => s.playerId);
  const validReadyCount = newReadyIds.filter((id) => seatedPlayers.some((s) => s.playerId === id)).length;
  const threshold = Math.ceil(seatedPlayers.length * READY_THRESHOLD_PCT);

  if (validReadyCount >= threshold && seatedPlayers.length >= 2) {
    console.log(`[Table ${tableId}] ${validReadyCount}/${seatedPlayers.length} ready — scheduling auto-start`);
    scheduleAutoStart(tableId);
  }

  return res.json({ ready: !alreadyReady, readyCount: validReadyCount, threshold, total: seatedPlayers.length });
});

router.post("/:tableId/action", requirePlayer, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const playerId = (req as any).authenticatedPlayerId as number;
  const { action, amount, afk } = req.body;

  const result = await handlePokerAction(tableId, playerId, action, amount ?? 0, afk === true);
  if ("error" in result) return res.status(result.status).json({ error: result.error });
  return res.json(result.table);
});

// ── Blind Escalation Config ─────────────────────────────────────────────────────

router.get("/:tableId/blind-config", requireDealerOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });
  return res.json({
    tableId,
    escalationEnabled: table.escalationEnabled,
    resetDelay: table.resetDelay,
    blindLevels: table.blindLevels ?? [],
    currentState: getEscalationState(tableId),
  });
});

router.post("/:tableId/blind-config", requireDealerOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.tableId as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found" });

  const { escalationEnabled, resetDelay, blindLevels } = req.body;
  const patch: Partial<typeof table> = {};
  if (escalationEnabled != null) patch.escalationEnabled = Boolean(escalationEnabled);
  if (resetDelay != null) patch.resetDelay = parseInt(String(resetDelay));
  if (Array.isArray(blindLevels)) patch.blindLevels = blindLevels;

  const [updated] = await db.update(pokerTablesTable).set(patch).where(eq(pokerTablesTable.id, tableId)).returning();

  // Sync the live escalation engine
  updateEscalationConfig(tableId, {
    enabled: updated.escalationEnabled,
    resetDelay: updated.resetDelay,
    blindLevels: updated.blindLevels as any[],
  });

  return res.json({
    tableId,
    escalationEnabled: updated.escalationEnabled,
    resetDelay: updated.resetDelay,
    blindLevels: updated.blindLevels,
    currentState: getEscalationState(tableId),
  });
});

export default router;
