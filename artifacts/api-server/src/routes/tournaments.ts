import { Router } from "express";
import { db, tournamentsTable, tournamentEntriesTable, pokerTablesTable, playersTable, transactionsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireBanker, requirePlayer } from "../middleware/auth.js";
import { type Seat } from "../lib/poker-engine.js";
import { broadcastTableState, broadcastPlayerBalance, broadcastTournamentUpdate } from "../lib/table-ws.js";
import { notifyTableUpdate, notifyTableDeleted, serializeTable } from "../lib/table-cache.js";
import { scheduleAutoStart, cancelAutoStart } from "../lib/game-loop.js";
import { spinGrid as romeSpinGrid, evaluateGrid as romeEvaluateGrid, countScatters as romeCountScatters, PAYLINES as ROME_PAYLINES, SCATTER_PAY as ROME_SCATTER_PAY } from "./rome-slots.js";
import { spinCols as westernSpinCols, evalCols as westernEvalCols } from "./western-slots.js";

const router = Router();

export async function pushTournamentUpdate(tournamentId: number) {
  try {
    const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
    if (!tournament) return;
    const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, tournamentId));
    const tables = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.tournamentId, tournamentId));
    broadcastTournamentUpdate(tournamentId, { ...tournament, entries, tables: tables.map(serializeTable) });
  } catch {}
}

// Players per table target — 8 max, but distribute evenly
const MAX_PER_TABLE = 8;
// Consolidate when a table drops below this many active players (and other tables exist)
const CONSOLIDATE_THRESHOLD = 3;

// ── List all tournaments ───────────────────────────────────────────────────────
router.get("/", async (_req, res) => {
  const tournaments = await db.select().from(tournamentsTable).orderBy(tournamentsTable.id);
  const entries = await db.select().from(tournamentEntriesTable);

  const enriched = await Promise.all(tournaments.map(async (t) => {
    const tEntries = entries.filter((e) => e.tournamentId === t.id);
    // For running tournaments, include active table list
    let tables: any[] = [];
    if (t.status === "running") {
      tables = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.tournamentId, t.id));
    }
    return {
      ...t,
      registeredCount: tEntries.filter((e) => e.status === "registered" || e.status === "active").length,
      entries: tEntries,
      tables: tables.map(serializeTable),
    };
  }));

  res.json(enriched);
});

// ── Get one tournament ─────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });

  const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  const tables = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.tournamentId, id));

  return res.json({ ...tournament, entries, tables: tables.map(serializeTable) });
});

// ── Create tournament (banker) ─────────────────────────────────────────────────
router.post("/", requireBanker, async (req, res) => {
  const { name, description, type, buyIn, startingChips, maxPlayers, smallBlind, bigBlind, minBet, maxBet, basePrizePool, buyInPrizePercent, rebuysEnabled, maxRebuys, durationMinutes, slotGame } = req.body;

  const tournType = type === "slots" ? "slots" : "poker";

  if (!name || !buyIn || !startingChips) {
    return res.status(400).json({ error: "Missing required fields: name, buyIn, startingChips" });
  }
  if (tournType === "poker" && (!smallBlind || !bigBlind)) {
    return res.status(400).json({ error: "Poker tournaments require smallBlind and bigBlind" });
  }
  if (tournType === "slots" && !minBet) {
    return res.status(400).json({ error: "Slots tournaments require minBet" });
  }
  if (tournType === "slots" && !durationMinutes) {
    return res.status(400).json({ error: "Slots tournaments require a duration" });
  }

  const base = parseInt(basePrizePool ?? 0);
  const pct = Math.min(100, Math.max(0, parseInt(buyInPrizePercent ?? 100)));

  // For slots: start immediately with endTime
  const isSlots = tournType === "slots";
  const durMins = isSlots ? Math.max(1, parseInt(durationMinutes)) : null;
  const endTime = isSlots && durMins ? new Date(Date.now() + durMins * 60_000) : null;

  const [tournament] = await db
    .insert(tournamentsTable)
    .values({
      name,
      description: description ?? null,
      type: tournType,
      buyIn: parseInt(buyIn),
      startingChips: parseInt(startingChips),
      maxPlayers: parseInt(maxPlayers ?? 200),
      smallBlind: tournType === "poker" ? parseInt(smallBlind) : 0,
      bigBlind: tournType === "poker" ? parseInt(bigBlind) : 0,
      minBet: isSlots ? parseInt(minBet) : null,
      maxBet: isSlots && maxBet ? parseInt(maxBet) : null,
      slotGame: isSlots ? (slotGame === "western" ? "western" : "fortuna") : "fortuna",
      status: isSlots ? "running" : "registering", // slots go live immediately
      prizePool: base,
      basePrizePool: base,
      buyInPrizePercent: pct,
      rebuysEnabled: tournType === "poker" ? !!rebuysEnabled : false,
      maxRebuys: tournType === "poker" ? parseInt(maxRebuys ?? 1) : 0,
      durationMinutes: durMins,
      endTime,
    })
    .returning();

  console.log(`[Tournament ${tournament.id}] Created${isSlots ? ` — slots, ends ${endTime?.toISOString()}` : " — poker, registering"}`);
  setImmediate(() => pushTournamentUpdate(tournament.id).catch(console.error));
  return res.status(201).json(tournament);
});

// ── Update tournament (banker) ─────────────────────────────────────────────────
router.patch("/:id", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const { name, description, buyIn, startingChips, maxPlayers, smallBlind, bigBlind, basePrizePool, buyInPrizePercent, addToPrizePool } = req.body;

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });

  const updates: Partial<typeof tournament> = {};

  // ── Fields allowed at any status ──────────────────────────────────────────
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  // Add a sponsor amount directly to the live prize pool (any status)
  if (addToPrizePool !== undefined && addToPrizePool !== "") {
    const add = parseInt(addToPrizePool);
    if (!isNaN(add) && add > 0) {
      updates.prizePool = tournament.prizePool + add;
      updates.basePrizePool = tournament.basePrizePool + add;
    }
  }

  // ── Fields only editable before tournament starts ──────────────────────────
  if (tournament.status === "registering") {
    if (buyIn !== undefined) updates.buyIn = parseInt(buyIn);
    if (startingChips !== undefined) updates.startingChips = parseInt(startingChips);
    if (maxPlayers !== undefined) updates.maxPlayers = parseInt(maxPlayers);
    if (tournament.type === "poker") {
      if (smallBlind !== undefined) updates.smallBlind = parseInt(smallBlind);
      if (bigBlind !== undefined) updates.bigBlind = parseInt(bigBlind);
    } else {
      const { minBet: newMinBet, maxBet: newMaxBet } = req.body;
      if (newMinBet !== undefined) updates.minBet = parseInt(newMinBet);
      if (newMaxBet !== undefined) updates.maxBet = newMaxBet ? parseInt(newMaxBet) : null;
    }
    if (basePrizePool !== undefined && addToPrizePool === undefined) {
      updates.basePrizePool = parseInt(basePrizePool);
      const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
      const pct = buyInPrizePercent !== undefined ? Math.min(100, Math.max(0, parseInt(buyInPrizePercent))) : tournament.buyInPrizePercent;
      const buyInContributions = entries.filter(e => e.status === "registered").length * Math.floor(tournament.buyIn * pct / 100);
      updates.prizePool = updates.basePrizePool + buyInContributions;
    }
    if (buyInPrizePercent !== undefined) updates.buyInPrizePercent = Math.min(100, Math.max(0, parseInt(buyInPrizePercent)));
  }

  const [updated] = await db.update(tournamentsTable).set(updates).where(eq(tournamentsTable.id, id)).returning();
  return res.json(updated);
});

// ── Delete tournament (banker) ─────────────────────────────────────────────────
router.delete("/:id", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status === "running") return res.status(400).json({ error: "Cannot delete a running tournament" });

  // Refund buy-ins to registered players
  const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  for (const entry of entries) {
    if (entry.status === "registered") {
      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, entry.playerId));
      if (player) {
        const buyIn = tournament.buyIn;
        await db.update(playersTable).set({ chips: player.chips + buyIn }).where(eq(playersTable.id, player.id));
        await db.insert(transactionsTable).values({
          playerId: player.id,
          amount: buyIn,
          type: "win",
          description: tournament.type === "slots"
            ? `Slots tournament "${tournament.name}" cancelled — buy-in refunded`
            : `Tournament "${tournament.name}" cancelled — buy-in refunded`,
        });
        broadcastPlayerBalance(player.id, player.chips + buyIn);
      }
    }
  }

  await db.delete(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  await db.delete(tournamentsTable).where(eq(tournamentsTable.id, id));
  return res.json({ success: true });
});

// ── Register for tournament (player) ──────────────────────────────────────────
router.post("/:id/register", requirePlayer, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });

  const isSlots = tournament.type === "slots";

  // Slots: rolling-entry — join while registering (legacy) OR while running + time remaining
  if (isSlots) {
    if (tournament.status === "finished") return res.status(400).json({ error: "This tournament has ended" });
    if (tournament.status === "running" && tournament.endTime && new Date() >= new Date(tournament.endTime)) {
      return res.status(400).json({ error: "Tournament has already ended — no more entries" });
    }
    if (tournament.status !== "registering" && tournament.status !== "running") {
      return res.status(400).json({ error: "Tournament is not accepting entries" });
    }
  } else {
    if (tournament.status !== "registering") return res.status(400).json({ error: "Tournament is not open for registration" });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const [existing] = await db
    .select()
    .from(tournamentEntriesTable)
    .where(and(eq(tournamentEntriesTable.tournamentId, id), eq(tournamentEntriesTable.playerId, playerId)));
  if (existing) return res.status(400).json({ error: "Already entered this tournament" });

  const allEntries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  if (allEntries.length >= tournament.maxPlayers) return res.status(400).json({ error: "Tournament is full" });

  if (player.chips < tournament.buyIn) return res.status(400).json({ error: "Insufficient chips for buy-in" });

  await db.update(playersTable).set({ chips: player.chips - tournament.buyIn }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId,
    amount: tournament.buyIn,
    type: "loss",
    description: tournament.type === "slots"
      ? `Slots tournament buy-in — "${tournament.name}"`
      : `Registered for tournament "${tournament.name}"`,
  });
  broadcastPlayerBalance(playerId, player.chips - tournament.buyIn);

  const [entry] = await db
    .insert(tournamentEntriesTable)
    .values({
      tournamentId: id,
      playerId,
      playerName: player.username,
      tournamentChips: tournament.startingChips,
      // Slots running (rolling-entry): immediately active so they can spin
      // Slots registering (legacy/manual start): wait like poker until banker starts
      // Poker: always wait
      status: isSlots && tournament.status === "running" ? "active" : "registered",
      score: 0,
      biggestSpin: 0,
    })
    .returning();

  // Only the buy-in prize percent goes to prize pool; rest is house cut
  const prizeContribution = Math.floor(tournament.buyIn * tournament.buyInPrizePercent / 100);
  await db
    .update(tournamentsTable)
    .set({ prizePool: tournament.prizePool + prizeContribution })
    .where(eq(tournamentsTable.id, id));

  setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  return res.status(201).json(entry);
});

// ── Unregister from tournament (player, registering only) ─────────────────────
router.delete("/:id/register", requirePlayer, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status !== "registering") return res.status(400).json({ error: "Can only withdraw before the tournament starts" });

  const [entry] = await db
    .select()
    .from(tournamentEntriesTable)
    .where(and(eq(tournamentEntriesTable.tournamentId, id), eq(tournamentEntriesTable.playerId, playerId)));
  if (!entry) return res.status(400).json({ error: "Not registered for this tournament" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player) {
    await db.update(playersTable).set({ chips: player.chips + tournament.buyIn }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId,
      amount: tournament.buyIn,
      type: "win",
      description: tournament.type === "slots"
        ? `Withdrew from slots tournament "${tournament.name}" — buy-in refunded`
        : `Withdrew from tournament "${tournament.name}" — buy-in refunded`,
    });
    broadcastPlayerBalance(playerId, player.chips + tournament.buyIn);
  }

  await db.delete(tournamentEntriesTable).where(eq(tournamentEntriesTable.id, entry.id));
  const prizeContribution = Math.floor(tournament.buyIn * tournament.buyInPrizePercent / 100);
  await db.update(tournamentsTable)
    .set({ prizePool: Math.max(tournament.basePrizePool, tournament.prizePool - prizeContribution) })
    .where(eq(tournamentsTable.id, id));

  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  return res.json({ success: true });
});

// ── Rebuy into tournament (player, running, eliminated only) ───────────────────
router.post("/:id/rebuy", requirePlayer, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const playerId = (req as any).authenticatedPlayerId as number;

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status !== "running") return res.status(400).json({ error: "Tournament is not running" });
  if (!tournament.rebuysEnabled) return res.status(400).json({ error: "Rebuys are not enabled for this tournament" });

  const [entry] = await db
    .select()
    .from(tournamentEntriesTable)
    .where(and(eq(tournamentEntriesTable.tournamentId, id), eq(tournamentEntriesTable.playerId, playerId)));
  if (!entry) return res.status(400).json({ error: "Not registered in this tournament" });
  if (entry.status !== "eliminated") return res.status(400).json({ error: "You can only rebuy after being eliminated" });
  if (entry.rebuysUsed >= tournament.maxRebuys) {
    return res.status(400).json({ error: `Rebuy limit reached (${tournament.maxRebuys} max)` });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < tournament.buyIn) return res.status(400).json({ error: "Insufficient chips for rebuy" });

  // ── Find a seat BEFORE touching any money or entry status ──────────────────
  // This prevents the player ending up "active" with no table when placement fails.
  const tables = await db
    .select()
    .from(pokerTablesTable)
    .where(eq(pokerTablesTable.tournamentId, id));

  if (tables.length === 0) {
    return res.status(400).json({ error: "No active tables in this tournament" });
  }

  // Try to find an existing empty slot first.
  let targetTable: typeof tables[0] | null = null;
  let targetSeats: Seat[] | null = null;
  let targetSeat: Seat | null = null;

  for (const t of tables) {
    const seats = t.seats as Seat[];
    const empty = seats.find((s) => !s.playerId);
    if (empty) {
      targetTable = t;
      targetSeats = seats;
      targetSeat = empty;
      break;
    }
  }

  // No empty slot found — all tables are currently full; player must wait
  if (!targetTable) {
    return res.status(400).json({ error: "All tables are full right now — please wait a moment and try again" });
  }

  // ── Now safe to commit money and entry changes ──────────────────────────────
  // Deduct buy-in from real wallet
  await db.update(playersTable).set({ chips: player.chips - tournament.buyIn }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({
    playerId,
    amount: tournament.buyIn,
    type: "loss",
    description: tournament.type === "slots"
      ? `Slots tournament rebuy — "${tournament.name}"`
      : `Rebuy into tournament "${tournament.name}"`,
  });
  broadcastPlayerBalance(playerId, player.chips - tournament.buyIn);

  // Add prize pool contribution from rebuy
  const prizeContribution = Math.floor(tournament.buyIn * tournament.buyInPrizePercent / 100);
  await db.update(tournamentsTable)
    .set({ prizePool: tournament.prizePool + prizeContribution })
    .where(eq(tournamentsTable.id, id));

  // Restore starting chips and mark active
  const [updatedEntry] = await db
    .update(tournamentEntriesTable)
    .set({
      tournamentChips: tournament.startingChips,
      status: "active",
      rebuysUsed: entry.rebuysUsed + 1,
    })
    .where(eq(tournamentEntriesTable.id, entry.id))
    .returning();

  // Place player in the chosen seat
  targetSeat!.playerId = playerId;
  targetSeat!.playerName = player.username;
  targetSeat!.playerAvatarUrl = null;
  targetSeat!.chips = tournament.startingChips;
  // Sit out during an active hand so the engine doesn't stall waiting for them
  targetSeat!.status = targetTable!.status === "playing" ? "sitting_out" : "sitting";
  targetSeat!.currentBet = 0;
  targetSeat!.timebankSeconds = 15;
  targetSeat!.afkFolds = 0;

  const [updatedTable] = await db
    .update(pokerTablesTable)
    .set({ seats: targetSeats! })
    .where(eq(pokerTablesTable.id, targetTable!.id))
    .returning();

  await db.update(tournamentEntriesTable)
    .set({ tableId: targetTable!.id })
    .where(eq(tournamentEntriesTable.id, entry.id));

  broadcastTableState(targetTable!.id, serializeTable(updatedTable));
  notifyTableUpdate(updatedTable);

  console.log(`[Tournament ${id}] Player ${player.username} rebought (${entry.rebuysUsed + 1}/${tournament.maxRebuys} rebuys used) → table ${targetTable!.id} seat ${targetSeat!.seatIndex}`);
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
  return res.json({ entry: updatedEntry, rebuysRemaining: tournament.maxRebuys - (entry.rebuysUsed + 1) });
});

// ── Start tournament (banker) — creates multiple tables ────────────────────────
router.post("/:id/start", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status !== "registering") return res.status(400).json({ error: "Tournament already started or finished" });

  // For slots, also accept already-active entries (may have been set active during rolling registration bug)
  const entries = await db
    .select()
    .from(tournamentEntriesTable)
    .where(
      and(
        eq(tournamentEntriesTable.tournamentId, id),
        tournament.type === "slots"
          ? sql`status IN ('registered', 'active')`
          : eq(tournamentEntriesTable.status, "registered")
      )
    );

  if (entries.length < 2) return res.status(400).json({ error: "Need at least 2 registered players to start" });

  // ── Slots tournament: no poker tables — just activate entries ─────────────
  if (tournament.type === "slots") {
    await Promise.all(
      entries.map((entry) =>
        db.update(tournamentEntriesTable)
          .set({ status: "active", tournamentChips: tournament.startingChips, score: 0, biggestSpin: 0 })
          .where(eq(tournamentEntriesTable.id, entry.id))
      )
    );
    // Compute endTime for legacy tournaments that were created without one
    const durMins = tournament.durationMinutes ?? 60;
    const endTime = tournament.endTime ? tournament.endTime : new Date(Date.now() + durMins * 60_000);
    const [updated] = await db.update(tournamentsTable)
      .set({ status: "running", endTime, durationMinutes: tournament.durationMinutes ?? 60 })
      .where(eq(tournamentsTable.id, id))
      .returning();
    console.log(`[Tournament ${id}] Slots tournament started with ${entries.length} players — ends ${endTime.toISOString()}`);
    setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
    setImmediate(() => pushTournamentUpdate(id).catch(console.error));
    return res.json({ tournament: updated });
  }

  // Shuffle entries for fair seat assignments
  const shuffled = [...entries].sort(() => Math.random() - 0.5);

  // Calculate number of tables — aim for MAX_PER_TABLE per table
  const numTables = Math.ceil(shuffled.length / MAX_PER_TABLE);

  // Distribute players as evenly as possible
  const tableGroups: typeof entries[] = Array.from({ length: numTables }, () => []);
  shuffled.forEach((entry, i) => tableGroups[i % numTables].push(entry));

  // Fetch all player records for avatar URLs
  const playerRecords = await Promise.all(
    shuffled.map((e) => db.select().from(playersTable).where(eq(playersTable.id, e.playerId)).then((r) => r[0]))
  );
  const playerMap = Object.fromEntries(
    (playerRecords.filter(Boolean) as NonNullable<(typeof playerRecords)[0]>[]).map((p) => [p.id, p])
  );

  const createdTables: any[] = [];

  for (let t = 0; t < numTables; t++) {
    const group = tableGroups[t];
    const tableNum = t + 1;

    // Build 8-seat array, fill with group players
    const seats: Seat[] = Array.from({ length: 8 }, (_, i) => ({
      seatIndex: i,
      playerId: null,
      playerName: null,
      chips: null,
      status: "empty" as const,
      currentBet: 0,
    }));

    for (let i = 0; i < group.length; i++) {
      const entry = group[i];
      const player = playerMap[entry.playerId];
      seats[i] = {
        seatIndex: i,
        playerId: entry.playerId,
        playerName: entry.playerName,
        playerAvatarUrl: player?.avatarUrl ?? null,
        chips: tournament.startingChips,
        status: "sitting",
        currentBet: 0,
        timebankSeconds: player?.timebankSeconds ?? 15,
      };
    }

    const [table] = await db
      .insert(pokerTablesTable)
      .values({
        name: `${tournament.name} — Table ${tableNum}`,
        smallBlind: tournament.smallBlind,
        bigBlind: tournament.bigBlind,
        minBuyIn: tournament.startingChips,
        maxBuyIn: tournament.startingChips,
        rakePercent: 0,
        rakeCap: 0,
        seats,
        status: "waiting",
        tournamentId: id,
        readyPlayerIds: [],
      })
      .returning();

    createdTables.push(table);

    // Update all entries for this group
    await Promise.all(
      group.map((entry) =>
        db
          .update(tournamentEntriesTable)
          .set({ status: "active", tournamentChips: tournament.startingChips, tableId: table.id })
          .where(eq(tournamentEntriesTable.id, entry.id))
      )
    );

    notifyTableUpdate(table);
    broadcastTableState(table.id, serializeTable(table));
  }

  // Update tournament status
  const [updated] = await db
    .update(tournamentsTable)
    .set({ status: "running" })
    .where(eq(tournamentsTable.id, id))
    .returning();

  console.log(`[Tournament ${id}] Started with ${shuffled.length} players across ${numTables} tables`);
  setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  return res.json({ tournament: updated, tables: createdTables.map(serializeTable) });
});

// ── Helper: credit prize pool to tournament winner ────────────────────────────
async function payoutWinner(tournamentId: number, winnerId: number, winnerName: string, prizePool: number): Promise<void> {
  if (prizePool <= 0) return;
  const [winner] = await db.select().from(playersTable).where(eq(playersTable.id, winnerId));
  if (!winner) {
    console.warn(`[Tournament ${tournamentId}] Winner ${winnerId} (${winnerName}) not found — prize pool NOT paid out`);
    return;
  }
  const newChips = winner.chips + prizePool;
  await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, winnerId));
  await db.insert(transactionsTable).values({
    playerId: winnerId,
    amount: prizePool,
    type: "tournament_win",
    description: `Tournament prize — ${prizePool.toLocaleString()} chips (tournament #${tournamentId})`,
  });
  await db.update(tournamentsTable)
    .set({ prizeAwarded: true, prizeAwardedAt: new Date() })
    .where(eq(tournamentsTable.id, tournamentId));
  broadcastPlayerBalance(winnerId, newChips);
  console.log(`[Tournament ${tournamentId}] Prize of ${prizePool} chips awarded to ${winnerName} (id ${winnerId})`);
}

// ── Helper: finish a slots tournament by time expiry ─────────────────────────
async function finishSlotsTournament(id: number) {
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament || tournament.status !== "running" || tournament.type !== "slots") return;

  const allEntries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  const participants = allEntries.filter((e) => e.status !== "registered");

  // Mark all still-active players as eliminated (time up = no more chips to spend)
  for (const e of participants) {
    if (e.status === "active") {
      await db.update(tournamentEntriesTable).set({ status: "eliminated" }).where(eq(tournamentEntriesTable.id, e.id));
    }
  }

  const sorted = [...participants].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const winner = sorted[0] ?? null;
  if (winner) {
    await db.update(tournamentEntriesTable).set({ status: "winner" }).where(eq(tournamentEntriesTable.id, winner.id));
  }
  const [finished] = await db.update(tournamentsTable)
    .set({ status: "finished", winnerId: winner?.playerId ?? null, winnerName: winner?.playerName ?? null })
    .where(eq(tournamentsTable.id, id))
    .returning();
  if (winner?.playerId && finished && finished.prizePool > 0) {
    await payoutWinner(id, winner.playerId, winner.playerName ?? winner.playerId.toString(), finished.prizePool).catch(console.error);
  }
  await updateLeaderboardSnapshot(id).catch(console.error);
  await pushTournamentUpdate(id).catch(console.error);
  console.log(`[Tournament ${id}] Slots tournament ended by timer — winner: ${winner?.playerName ?? "no entries"}`);
}

// Server-side interval: auto-finish expired slots tournaments every 30s
setInterval(async () => {
  try {
    const expired = await db.execute(sql`
      SELECT id FROM tournaments
      WHERE type = 'slots' AND status = 'running' AND end_time IS NOT NULL AND end_time <= NOW()
    `);
    for (const row of expired.rows as any[]) {
      await finishSlotsTournament(Number(row.id));
    }
  } catch {}
}, 30_000);

// ── Spin for slots tournament (player) ────────────────────────────────────────
router.post("/:id/spin", requirePlayer, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const playerId = (req as any).authenticatedPlayerId as number;
  const { betAmount } = req.body;

  if (!betAmount || betAmount <= 0) return res.status(400).json({ error: "betAmount is required" });

  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.type !== "slots") return res.status(400).json({ error: "Not a slots tournament" });
  if (tournament.status !== "running") return res.status(400).json({ error: "Tournament has ended" });

  // Time lock — if endTime has passed, refuse the spin and trigger auto-finish
  if (tournament.endTime && new Date() >= new Date(tournament.endTime)) {
    setImmediate(() => finishSlotsTournament(id).catch(console.error));
    return res.status(400).json({ error: "Time is up — tournament has ended" });
  }

  const minBet = tournament.minBet ?? 1;
  const maxBet = tournament.maxBet ?? tournament.startingChips;

  if (betAmount < minBet) return res.status(400).json({ error: `Minimum bet is ${minBet}` });
  if (betAmount > maxBet) return res.status(400).json({ error: `Maximum bet is ${maxBet}` });

  const [entry] = await db
    .select()
    .from(tournamentEntriesTable)
    .where(and(eq(tournamentEntriesTable.tournamentId, id), eq(tournamentEntriesTable.playerId, playerId)));
  if (!entry) return res.status(404).json({ error: "Not registered in this tournament" });
  if (entry.status !== "active") return res.status(400).json({ error: "You are not active in this tournament" });
  if (entry.tournamentChips < betAmount) return res.status(400).json({ error: "Insufficient tournament chips" });

  // ── Run the spin (engine chosen by slotGame) ────────────────────────────────
  let payout = 0;
  let grid: any;
  let wins: any[] = [];
  let outcome = "";
  let scatterCount = 0;

  if (tournament.slotGame === "western") {
    const cols = westernSpinCols(false);
    const res = westernEvalCols(cols, betAmount);
    payout = res.totalWin;
    grid = cols;
    wins = res.lineWins;
    scatterCount = res.scatters;
    outcome = payout > betAmount ? "win" : payout > 0 ? "partial" : "lose";
  } else {
    // Default: Fortuna (Rome Slots engine) — grid[row][reel] = 3×5, transposed to reels-first for frontend
    const romeGrid = romeSpinGrid(false);
    const betPerLine = Math.max(1, Math.floor(betAmount / ROME_PAYLINES.length));
    const lineWins = romeEvaluateGrid(romeGrid, betPerLine);
    scatterCount = romeCountScatters(romeGrid);
    const scatterWin = scatterCount >= 3 ? betAmount * (ROME_SCATTER_PAY[Math.min(scatterCount, 5)] ?? 0) : 0;
    payout = lineWins.reduce((s: number, w: any) => s + w.win, 0) + scatterWin;
    // Transpose to reels-first so the frontend displayGrid[reel][row] format is correct
    grid = Array.from({ length: 5 }, (_, reel) =>
      Array.from({ length: 3 }, (_, row) => romeGrid[row][reel])
    );
    // Attach winning cell coords [reelIdx, rowIdx] for frontend highlight
    wins = lineWins.map((w: any) => ({
      ...w,
      winningCells: ROME_PAYLINES[w.lineIndex].slice(0, w.count).map((rowIdx: number, reelIdx: number) => [reelIdx, rowIdx]),
    }));
    outcome = payout > betAmount ? "win" : payout > 0 ? "partial" : "lose";
  }

  const newTChips = entry.tournamentChips - betAmount; // chips only go DOWN
  const newScore = (entry.score ?? 0) + payout;        // score only goes UP
  const newBiggest = Math.max(entry.biggestSpin ?? 0, payout);

  let newStatus = entry.status;
  if (newTChips <= 0) {
    newStatus = "eliminated"; // out of chips = done spinning
  }

  const [updatedEntry] = await db
    .update(tournamentEntriesTable)
    .set({
      tournamentChips: newTChips,
      score: newScore,
      biggestSpin: newBiggest,
      status: newStatus,
    })
    .where(eq(tournamentEntriesTable.id, entry.id))
    .returning();

  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);
  // Update leaderboard snapshot after every spin (score-based)
  setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));

  // NOTE: Slots tournaments only end when the timer expires (checked every 30s by the interval).
  // Running out of chips just locks a player out of spinning — the tournament continues until endTime.

  return res.json({
    grid,
    wins,
    payout,
    outcome,
    scatterCount,
    tournamentChips: updatedEntry.tournamentChips,
    score: updatedEntry.score,
    biggestSpin: updatedEntry.biggestSpin,
    status: updatedEntry.status,
    slotGame: tournament.slotGame,
  });
});

// ── Consolidate tables (banker or auto-triggered) ─────────────────────────────
router.post("/:id/consolidate", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const result = await consolidateTournamentTables(id);
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  return res.json(result);
});

// ── Force-finish tournament (banker) ──────────────────────────────────────────
router.post("/:id/finish", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status === "finished") return res.status(400).json({ error: "Tournament already finished" });

  // For slots: find winner by highest score
  if (tournament.type === "slots") {
    const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
    const sorted = entries.filter((e) => e.status !== "registered").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = sorted[0] ?? null;
    if (winner) {
      await db.update(tournamentEntriesTable).set({ status: "winner" }).where(eq(tournamentEntriesTable.id, winner.id));
    }
    const [updated] = await db.update(tournamentsTable)
      .set({ status: "finished", winnerId: winner?.playerId ?? null, winnerName: winner?.playerName ?? null })
      .where(eq(tournamentsTable.id, id))
      .returning();
    if (winner?.playerId && updated.prizePool > 0) {
      await payoutWinner(id, winner.playerId, winner.playerName ?? winner.playerId.toString(), updated.prizePool);
    }
    setImmediate(() => updateLeaderboardSnapshot(id).catch(console.error));
    setImmediate(() => pushTournamentUpdate(id).catch(console.error));
    return res.json({ ...updated, prizeAwarded: updated.prizeAwarded, paidTo: winner?.playerName ?? null });
  }

  // For poker: find the last remaining player (winner by elimination)
  const allEntries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
  const winnerEntry = allEntries.find((e) => e.status === "active") ?? allEntries.find((e) => e.status !== "eliminated" && e.status !== "registered") ?? null;
  if (winnerEntry) {
    await db.update(tournamentEntriesTable).set({ status: "winner" }).where(eq(tournamentEntriesTable.id, winnerEntry.id));
  }
  const [updated] = await db
    .update(tournamentsTable)
    .set({ status: "finished", winnerId: winnerEntry?.playerId ?? null, winnerName: winnerEntry?.playerName ?? null })
    .where(eq(tournamentsTable.id, id))
    .returning();
  if (winnerEntry?.playerId && updated.prizePool > 0) {
    await payoutWinner(id, winnerEntry.playerId, winnerEntry.playerName ?? winnerEntry.playerId.toString(), updated.prizePool);
  }
  setImmediate(() => pushTournamentUpdate(id).catch(console.error));
  return res.json({ ...updated, prizeAwarded: updated.prizeAwarded, paidTo: winnerEntry?.playerName ?? null });
});

// ── Manual payout for already-finished tournaments (missed payout) ─────────────
router.post("/:id/payout-winner", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });
  if (tournament.status !== "finished") return res.status(400).json({ error: "Tournament is not finished" });
  if (tournament.prizeAwarded) return res.status(400).json({ error: "Prize already awarded" });
  if (tournament.prizePool <= 0) return res.status(400).json({ error: "Prize pool is 0" });

  // Allow banker to manually supply a winner if none is recorded
  let winnerId = tournament.winnerId;
  let winnerName = tournament.winnerName;
  const { manualWinnerId, manualWinnerName } = req.body ?? {};

  if (!winnerId && manualWinnerId) {
    // Validate that the player is actually in this tournament
    const entries = await db.select().from(tournamentEntriesTable).where(eq(tournamentEntriesTable.tournamentId, id));
    const entry = entries.find((e) => e.playerId === parseInt(manualWinnerId));
    if (!entry) return res.status(400).json({ error: "Player not found in this tournament" });
    winnerId = entry.playerId;
    winnerName = entry.playerName;
    // Update the tournament record with the manual winner
    await db.update(tournamentsTable)
      .set({ winnerId, winnerName })
      .where(eq(tournamentsTable.id, id));
    // Mark their entry as winner
    await db.update(tournamentEntriesTable)
      .set({ status: "winner" })
      .where(and(eq(tournamentEntriesTable.tournamentId, id), eq(tournamentEntriesTable.playerId, winnerId)));
  }

  if (!winnerId) return res.status(400).json({ error: "No winner recorded — select a player to pay out" });

  await payoutWinner(id, winnerId, winnerName ?? winnerId.toString(), tournament.prizePool);
  const [updated] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  return res.json({ success: true, paidTo: winnerName, amount: tournament.prizePool, tournament: updated });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported consolidation function — called from tables.ts after eliminations
// ─────────────────────────────────────────────────────────────────────────────
export async function consolidateTournamentTables(tournamentId: number): Promise<{ merged: number; finished: boolean }> {
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  if (!tournament || tournament.status !== "running") return { merged: 0, finished: false };

  const allTables = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.tournamentId, tournamentId));
  if (allTables.length <= 1) {
    // Only one table left — check if tournament should end (≤1 player)
    if (allTables.length === 1) {
      const seats = allTables[0].seats as Seat[];
      const remaining = seats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
      if (remaining.length <= 1) {
        await finishTournament(tournamentId, remaining[0] ?? null);
        return { merged: 0, finished: true };
      }
    }
    return { merged: 0, finished: false };
  }

  // Identify tables with too few active players
  const tableInfo = allTables.map((t) => {
    const seats = t.seats as Seat[];
    const active = seats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
    const empty = seats.filter((s) => !s.playerId);
    return { table: t, seats, active, empty };
  });

  let merged = 0;

  // Find short tables (below threshold)
  for (const source of tableInfo) {
    if (source.active.length >= CONSOLIDATE_THRESHOLD) continue; // table is fine
    if (source.active.length === 0) {
      // Empty table — just delete it
      cancelAutoStart(source.table.id);
      await db.delete(pokerTablesTable).where(eq(pokerTablesTable.id, source.table.id));
      notifyTableDeleted(source.table.id);
      console.log(`[Tournament ${tournamentId}] Deleted empty table ${source.table.id}`);
      merged++;
      continue;
    }

    // Find best target: most players but still has room for source.active.length seats
    const candidates = tableInfo
      .filter((t) => t.table.id !== source.table.id && t.active.length > 0 && t.empty.length >= source.active.length)
      .sort((a, b) => b.active.length - a.active.length);

    if (candidates.length === 0) continue; // nowhere to send them

    const target = candidates[0];

    console.log(`[Tournament ${tournamentId}] Merging table ${source.table.id} (${source.active.length} players) → table ${target.table.id}`);

    // Move each active player from source to target
    const targetSeats = [...target.seats] as Seat[];
    for (const activeSeat of source.active) {
      const emptySeat = targetSeats.find((s) => !s.playerId);
      if (!emptySeat) break;

      // Move player into target seat
      emptySeat.playerId = activeSeat.playerId;
      emptySeat.playerName = activeSeat.playerName;
      emptySeat.playerAvatarUrl = activeSeat.playerAvatarUrl ?? null;
      emptySeat.chips = activeSeat.chips;
      emptySeat.status = "sitting";
      emptySeat.currentBet = 0;
      emptySeat.timebankSeconds = activeSeat.timebankSeconds ?? 15;
      emptySeat.afkFolds = 0;

      // Update tournament entry with new tableId
      if (activeSeat.playerId) {
        await db
          .update(tournamentEntriesTable)
          .set({ tableId: target.table.id })
          .where(
            and(
              eq(tournamentEntriesTable.tournamentId, tournamentId),
              eq(tournamentEntriesTable.playerId, activeSeat.playerId)
            )
          );
      }
    }

    // Save updated target table
    const [updatedTarget] = await db
      .update(pokerTablesTable)
      .set({ seats: targetSeats })
      .where(eq(pokerTablesTable.id, target.table.id))
      .returning();

    broadcastTableState(target.table.id, serializeTable(updatedTarget));
    notifyTableUpdate(updatedTarget);

    // If target was waiting, trigger auto-start
    const targetActive = targetSeats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
    if (targetActive.length >= 2 && (updatedTarget.status === "waiting" || updatedTarget.status === "finished")) {
      scheduleAutoStart(target.table.id);
    }

    // Cancel auto-start on source and delete it
    cancelAutoStart(source.table.id);
    await db.delete(pokerTablesTable).where(eq(pokerTablesTable.id, source.table.id));
    notifyTableDeleted(source.table.id);
    console.log(`[Tournament ${tournamentId}] Deleted source table ${source.table.id}`);
    merged++;
  }

  // After consolidation, check if only 1 player total remains
  const remainingTables = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.tournamentId, tournamentId));
  const allActive = remainingTables.flatMap((t) => (t.seats as Seat[]).filter((s) => s.playerId && (s.chips ?? 0) > 0));

  if (allActive.length <= 1) {
    await finishTournament(tournamentId, allActive[0] ?? null);
    setImmediate(() => pushTournamentUpdate(tournamentId).catch(console.error));
    return { merged, finished: true };
  }

  // Always update snapshot and push state after consolidation (covers eliminations even without merges)
  setImmediate(() => updateLeaderboardSnapshot(tournamentId).catch(console.error));
  setImmediate(() => pushTournamentUpdate(tournamentId).catch(console.error));

  return { merged, finished: false };
}

async function finishTournament(tournamentId: number, winner: Seat | null) {
  const updates: Record<string, any> = { status: "finished" };
  if (winner?.playerId) {
    updates.winnerId = winner.playerId;
    updates.winnerName = winner.playerName;
    await db
      .update(tournamentEntriesTable)
      .set({ status: "winner" })
      .where(
        and(
          eq(tournamentEntriesTable.tournamentId, tournamentId),
          eq(tournamentEntriesTable.playerId, winner.playerId)
        )
      );
  }
  const [finished] = await db.update(tournamentsTable).set(updates).where(eq(tournamentsTable.id, tournamentId)).returning();
  if (winner?.playerId && finished && finished.prizePool > 0) {
    await payoutWinner(tournamentId, winner.playerId, winner.playerName ?? winner.playerId.toString(), finished.prizePool).catch(console.error);
  }
  await updateLeaderboardSnapshot(tournamentId);
  console.log(`[Tournament ${tournamentId}] Finished — winner: ${winner?.playerName ?? "none"}`);
}

// ── Leaderboard snapshot helper — call this at bust / consolidation only ───────
export async function updateLeaderboardSnapshot(tournamentId: number) {
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId));
  const entries = await db
    .select()
    .from(tournamentEntriesTable)
    .where(eq(tournamentEntriesTable.tournamentId, tournamentId));

  const isSlots = tournament?.type === "slots";

  const snapshot = entries
    .filter((e) => e.status !== "registered")
    .sort((a, b) => {
      if (a.status === "winner") return -1;
      if (b.status === "winner") return 1;
      if (isSlots) {
        // Slots: score DESC; eliminated go last (can still lead if score is high)
        if (a.status === "eliminated" && b.status !== "eliminated" && (b.score ?? 0) > (a.score ?? 0)) return 1;
        if (b.status === "eliminated" && a.status !== "eliminated" && (a.score ?? 0) > (b.score ?? 0)) return -1;
        return (b.score ?? 0) - (a.score ?? 0);
      }
      // Poker: chips DESC, eliminated last
      if (a.status === "eliminated" && b.status !== "eliminated") return 1;
      if (b.status === "eliminated" && a.status !== "eliminated") return -1;
      return b.tournamentChips - a.tournamentChips;
    })
    .map((e, idx) => ({
      rank: idx + 1,
      playerId: e.playerId,
      playerName: e.playerName,
      tournamentChips: e.tournamentChips,
      score: e.score ?? 0,
      biggestSpin: e.biggestSpin ?? 0,
      status: e.status,
      tableId: e.tableId,
    }));

  await db
    .update(tournamentsTable)
    .set({ leaderboardSnapshot: snapshot, leaderboardUpdatedAt: new Date() })
    .where(eq(tournamentsTable.id, tournamentId));

  console.log(`[Tournament ${tournamentId}] Leaderboard snapshot updated (${snapshot.length} players)`);
}

// ── GET /api/tournaments/:id/leaderboard — serve the cached snapshot ──────────
router.get("/:id/leaderboard", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [tournament] = await db.select().from(tournamentsTable).where(eq(tournamentsTable.id, id));
  if (!tournament) return res.status(404).json({ error: "Tournament not found" });

  return res.json({
    tournamentId: id,
    tournamentName: tournament.name,
    status: tournament.status,
    prizePool: tournament.prizePool,
    updatedAt: tournament.leaderboardUpdatedAt,
    entries: tournament.leaderboardSnapshot ?? [],
  });
});

export default router;
