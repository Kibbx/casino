import { Router } from "express";
import { db, sportBetFinancesTable, sportBetEventsTable, sportBetEventOptionsTable, sportBetEventEntriesTable, playersTable, settingsTable, transactionsTable, sportBetSlipsTable } from "@workspace/db";
import { eq, desc, inArray, or, ilike, sql, gte, lte, and } from "drizzle-orm";
import { requireSportbetsOrAbove, requirePlayer, requireOwner } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

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

// GET /sportbets/settings — public
router.get("/settings", async (_req, res) => {
  const minBet = parseInt(await getSetting("sportbetsMinBet", "100"));
  const maxBet = parseInt(await getSetting("sportbetsMaxBet", "50000"));
  return res.json({ minBet, maxBet });
});

// POST /sportbets/settings — banker only
router.post("/settings", requireSportbetsOrAbove, async (req, res) => {
  const { minBet, maxBet } = req.body;
  const min = Math.max(1, parseInt(minBet) || 100);
  const max = Math.max(min, parseInt(maxBet) || 50000);
  await setSetting("sportbetsMinBet", String(min));
  await setSetting("sportbetsMaxBet", String(max));
  return res.json({ minBet: min, maxBet: max });
});

function computeBalance(rows: typeof sportBetFinancesTable.$inferSelect[], src: string) {
  return rows
    .filter((r) => r.source === src)
    .reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
}

function parseOdds(odds: string): number {
  const m = odds.match(/^(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : 1;
}

// ── Public player-facing endpoints ───────────────────────────────────────────

// List all open events (public, no auth)
router.get("/public/events", async (_req, res) => {
  const events = await db
    .select()
    .from(sportBetEventsTable)
    .where(eq(sportBetEventsTable.status, "open"))
    .orderBy(desc(sportBetEventsTable.createdAt));

  if (events.length === 0) return res.json([]);

  const eventIds = events.map((e) => e.id);
  const options = await db
    .select()
    .from(sportBetEventOptionsTable)
    .where(inArray(sportBetEventOptionsTable.eventId, eventIds));

  const entries = await db
    .select({ eventId: sportBetEventEntriesTable.eventId, optionId: sportBetEventEntriesTable.optionId, amount: sportBetEventEntriesTable.amount })
    .from(sportBetEventEntriesTable)
    .where(inArray(sportBetEventEntriesTable.eventId, eventIds));

  return res.json(events.map((ev) => {
    const evOptions = options.filter((o) => o.eventId === ev.id);
    const evEntries = entries.filter((e) => e.eventId === ev.id);
    const totalWagered = evEntries.reduce((s, e) => s + e.amount, 0);
    return {
      id: ev.id,
      title: ev.title,
      description: ev.description,
      league: ev.league,
      gameDate: ev.gameDate,
      status: ev.status,
      rakePercent: ev.rakePercent,
      totalWagered,
      options: evOptions.map((o) => ({
        id: o.id,
        label: o.label,
        odds: o.odds,
        totalWagered: evEntries.filter((e) => e.optionId === o.id).reduce((s, e) => s + e.amount, 0),
        betCount: evEntries.filter((e) => e.optionId === o.id).length,
      })),
    };
  }));
});

// Player places a bet (chips deducted immediately)
router.post("/public/bet", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { eventId, optionId, amount } = req.body;

  const evId = parseInt(eventId);
  const optId = parseInt(optionId);
  const amt = parseInt(amount);

  if (!evId || !optId || !amt || amt <= 0) {
    return res.status(400).json({ error: "eventId, optionId and a positive amount are required" });
  }

  const sbMinBet = parseInt(await getSetting("sportbetsMinBet", "100"));
  const sbMaxBet = parseInt(await getSetting("sportbetsMaxBet", "50000"));
  if (amt < sbMinBet) return res.status(400).json({ error: `Minimum bet is ${sbMinBet.toLocaleString()} chips` });
  if (amt > sbMaxBet) return res.status(400).json({ error: `Maximum bet is ${sbMaxBet.toLocaleString()} chips` });

  // Validate event is open
  const [event] = await db.select().from(sportBetEventsTable).where(eq(sportBetEventsTable.id, evId));
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (event.status !== "open") return res.status(400).json({ error: "This event is no longer accepting bets" });
  if (event.gameDate && new Date() >= new Date(event.gameDate)) {
    return res.status(400).json({ error: "Betting is locked — this event has already started" });
  }

  // Validate option belongs to event
  const [option] = await db.select().from(sportBetEventOptionsTable).where(eq(sportBetEventOptionsTable.id, optId));
  if (!option || option.eventId !== evId) return res.status(400).json({ error: "Invalid option" });

  // Fetch player chips
  const [player] = await db.select({ id: playersTable.id, username: playersTable.username, chips: playersTable.chips })
    .from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (Number(player.chips) < amt) return res.status(400).json({ error: "Insufficient chips" });

  // Deduct chips
  const newChips = Number(player.chips) - amt;
  await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
  broadcastPlayerBalance(playerId, newChips);

  // Record entry — enteredBy = "self" signals chips were deducted
  const [entry] = await db
    .insert(sportBetEventEntriesTable)
    .values({
      eventId: evId,
      optionId: optId,
      playerId,
      playerName: player.username,
      amount: amt,
      enteredBy: "self",
    } as any)
    .returning();

  // Record finance income (chips bet go to house crate)
  await db.insert(sportBetFinancesTable).values({
    source: "crate",
    type: "income",
    amount: amt,
    description: `Player bet: ${player.username} — ${event.title} (${option.label})`,
    staffUsername: "player-portal",
  });

  // Record in player transaction history so chip movements are visible
  await db.insert(transactionsTable).values({
    playerId,
    amount: amt,
    type: "loss",
    description: `Sports Bet: ${event.title} → ${option.label} (${option.odds})`,
  });

  return res.json({
    entryId: entry.id,
    eventTitle: event.title,
    optionLabel: option.label,
    odds: option.odds,
    amount: amt,
    chipsRemaining: newChips,
  });
});

// Player fetches their own bets
router.get("/public/my-bets", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const entries = await db
    .select()
    .from(sportBetEventEntriesTable)
    .where(eq(sportBetEventEntriesTable.playerId, playerId))
    .orderBy(desc(sportBetEventEntriesTable.createdAt));

  if (entries.length === 0) return res.json([]);

  const eventIds = [...new Set(entries.map((e) => e.eventId))];
  const optionIds = [...new Set(entries.map((e) => e.optionId))];

  const events = await db.select().from(sportBetEventsTable).where(inArray(sportBetEventsTable.id, eventIds));
  const options = await db.select().from(sportBetEventOptionsTable).where(inArray(sportBetEventOptionsTable.id, optionIds));

  const eventMap = Object.fromEntries(events.map((e) => [e.id, e]));
  const optionMap = Object.fromEntries(options.map((o) => [o.id, o]));

  return res.json(entries.map((e) => {
    const ev = eventMap[e.eventId];
    const opt = optionMap[e.optionId];
    const rakePercent = ev?.rakePercent ?? 0;
    const odds = parseFloat((opt?.odds ?? "1").match(/^(\d+\.?\d*)/)?.[1] ?? "1");
    const grossPayout = Math.floor(e.amount * odds);
    const rakeAmount = Math.floor(grossPayout * rakePercent / 100);
    const netPayout = grossPayout - rakeAmount;
    const isWinner = ev?.winnerId === e.optionId;
    const isPaid = !!(e as any).paidAt;
    const result: string = ev?.status === "settled"
      ? (isWinner ? (isPaid ? "paid" : "won") : "lost")
      : "pending";

    return {
      id: e.id,
      eventId: e.eventId,
      eventTitle: ev?.title ?? "Unknown event",
      league: ev?.league ?? "",
      optionLabel: opt?.label ?? "Unknown",
      odds: opt?.odds ?? "1",
      amount: e.amount,
      grossPayout,
      netPayout,
      rakePercent,
      result,
      selfPlaced: e.enteredBy === "self",
      paidAt: (e as any).paidAt ?? null,
      createdAt: (e as any).createdAt,
    };
  }));
});

// ── Staff Stats ───────────────────────────────────────────────────────────────

router.get("/stats", requireSportbetsOrAbove, async (_req, res) => {
  const events = await db.select().from(sportBetEventsTable);
  const entries = await db.select().from(sportBetEventEntriesTable);
  const finances = await db.select().from(sportBetFinancesTable);

  const totalEvents = events.length;
  const openEvents = events.filter((e) => e.status === "open").length;
  const closedEvents = events.filter((e) => e.status === "closed").length;
  const settledEvents = events.filter((e) => e.status === "settled").length;

  const totalBets = entries.length;
  const totalWagered = entries.reduce((s, e) => s + e.amount, 0);
  const selfPlacedBets = entries.filter((e) => e.enteredBy === "self").length;
  const selfPlacedWagered = entries.filter((e) => e.enteredBy === "self").reduce((s, e) => s + e.amount, 0);

  // Count pending (unpaid winners from settled events)
  const settledEventIds = events.filter((e) => e.status === "settled").map((e) => e.id);
  const winnerEntries = entries.filter((e) => {
    const ev = events.find((ev) => ev.id === e.eventId);
    return ev && e.optionId === ev.winnerId;
  });
  const pendingPayouts = winnerEntries.filter((e) => !(e as any).paidAt).length;
  const paidPayouts = winnerEntries.filter((e) => !!(e as any).paidAt).length;

  // Finance totals
  const rakeCollected = finances
    .filter((r) => r.source === "rake")
    .reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);
  const totalPaidOut = finances
    .filter((r) => r.source === "crate" && r.type === "expense")
    .reduce((s, r) => s + r.amount, 0);

  return res.json({
    totalEvents, openEvents, closedEvents, settledEvents,
    totalBets, totalWagered, selfPlacedBets, selfPlacedWagered,
    pendingPayouts, paidPayouts, rakeCollected, totalPaidOut,
  });
});

// ── Finances ────────────────────────────────────────────────────────────────

router.get("/finances", requireSportbetsOrAbove, async (req, res) => {
  const rows = await db
    .select()
    .from(sportBetFinancesTable)
    .orderBy(desc(sportBetFinancesTable.createdAt));

  const crateBalance = computeBalance(rows, "crate");
  const bankBalance = computeBalance(rows, "bank");
  const rakeCollected = rows
    .filter((r) => r.source === "rake")
    .reduce((s, r) => s + (r.type === "income" ? r.amount : -r.amount), 0);

  const allEntries = await db.select({ amount: sportBetEventEntriesTable.amount }).from(sportBetEventEntriesTable);
  const betsPlaced = allEntries.reduce((s, r) => s + r.amount, 0);

  return res.json({ transactions: rows, crateBalance, bankBalance, betsPlaced, rakeCollected });
});

router.post("/finances", requireSportbetsOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const { source, type, amount, description } = req.body;

  if (!["crate", "bank", "bets", "rake"].includes(source)) {
    return res.status(400).json({ error: "Invalid source" });
  }
  if (!["income", "expense"].includes(type)) {
    return res.status(400).json({ error: "type must be 'income' or 'expense'" });
  }
  const amt = parseInt(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number" });

  const [row] = await db
    .insert(sportBetFinancesTable)
    .values({ source, type, amount: amt, description: description?.trim() || "", staffUsername: session.username })
    .returning();

  return res.json(row);
});

router.delete("/finances/:id", requireSportbetsOrAbove, async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(sportBetFinancesTable).where(eq(sportBetFinancesTable.id, id));
  return res.json({ success: true });
});

// ── Player search (staff) ─────────────────────────────────────────────────────

router.get("/players/:playerId/bets", requireSportbetsOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const entries = await db
    .select()
    .from(sportBetEventEntriesTable)
    .where(eq(sportBetEventEntriesTable.playerId, playerId))
    .orderBy(desc(sportBetEventEntriesTable.createdAt));

  if (entries.length === 0) return res.json([]);

  const eventIds = [...new Set(entries.map((e) => e.eventId))];
  const optionIds = [...new Set(entries.map((e) => e.optionId))];

  const events = await db.select().from(sportBetEventsTable).where(inArray(sportBetEventsTable.id, eventIds));
  const options = await db.select().from(sportBetEventOptionsTable).where(inArray(sportBetEventOptionsTable.id, optionIds));

  const eventMap = Object.fromEntries(events.map((e) => [e.id, e]));
  const optionMap = Object.fromEntries(options.map((o) => [o.id, o]));

  return res.json(entries.map((e) => {
    const ev = eventMap[e.eventId];
    const opt = optionMap[e.optionId];
    const rakePercent = ev?.rakePercent ?? 0;
    const odds = parseFloat((opt?.odds ?? "1").match(/^(\d+\.?\d*)/)?.[1] ?? "1");
    const grossPayout = Math.floor(e.amount * odds);
    const rakeAmount = Math.floor(grossPayout * rakePercent / 100);
    const netPayout = grossPayout - rakeAmount;
    const isWinner = ev?.winnerId === e.optionId;
    const result: string = ev?.status === "settled"
      ? (isWinner ? "won" : "lost")
      : "pending";

    return {
      id: e.id,
      eventId: e.eventId,
      eventTitle: ev?.title ?? "Unknown event",
      league: ev?.league ?? "",
      optionLabel: opt?.label ?? "Unknown option",
      odds: opt?.odds ?? "1",
      amount: e.amount,
      grossPayout,
      netPayout,
      rakePercent,
      result,
      paidAt: (e as any).paidAt ?? null,
      createdAt: (e as any).createdAt,
    };
  }));
});

router.get("/players/search", requireSportbetsOrAbove, async (req, res) => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 1) return res.json([]);

  const results = await db
    .select({
      id: playersTable.id,
      username: playersTable.username,
      stateId: playersTable.stateId,
      phoneNumber: playersTable.phoneNumber,
      avatarUrl: playersTable.avatarUrl,
    })
    .from(playersTable)
    .where(
      or(
        ilike(playersTable.username, `%${q}%`),
        ilike(playersTable.stateId, `%${q}%`)
      )
    )
    .orderBy(playersTable.username)
    .limit(10);

  return res.json(results);
});

// ── Pending payouts ───────────────────────────────────────────────────────────

router.get("/pending-payouts", requireSportbetsOrAbove, async (_req, res) => {
  const settledEvents = await db
    .select()
    .from(sportBetEventsTable)
    .where(eq(sportBetEventsTable.status, "settled"));

  if (settledEvents.length === 0) return res.json([]);

  const eventIds = settledEvents.map((e) => e.id);
  const allOptions = await db
    .select()
    .from(sportBetEventOptionsTable)
    .where(inArray(sportBetEventOptionsTable.eventId, eventIds));

  const allEntries = await db
    .select()
    .from(sportBetEventEntriesTable)
    .where(inArray(sportBetEventEntriesTable.eventId, eventIds));

  const unpaidWinnerEntries = allEntries.filter((e) => {
    const ev = settledEvents.find((se) => se.id === e.eventId);
    return ev && e.optionId === ev.winnerId && !(e as any).paidAt;
  });

  if (unpaidWinnerEntries.length === 0) return res.json([]);

  const playerIds = [...new Set(unpaidWinnerEntries.map((e) => (e as any).playerId).filter(Boolean))];
  const players = playerIds.length > 0
    ? await db
        .select({ id: playersTable.id, username: playersTable.username, stateId: playersTable.stateId, phoneNumber: playersTable.phoneNumber })
        .from(playersTable)
        .where(inArray(playersTable.id, playerIds))
    : [];

  const payouts = unpaidWinnerEntries.map((entry) => {
    const ev = settledEvents.find((se) => se.id === entry.eventId)!;
    const opt = allOptions.find((o) => o.id === entry.optionId);
    const player = players.find((p) => p.id === (entry as any).playerId) ?? null;
    const odds = parseOdds(opt?.odds ?? "1");
    const rakePercent = (ev as any).rakePercent ?? 0;
    const grossPayout = Math.floor(entry.amount * odds);
    const rakeAmount = Math.floor(grossPayout * rakePercent / 100);
    const netPayout = grossPayout - rakeAmount;
    return {
      entryId: entry.id,
      eventId: ev.id,
      eventTitle: ev.title,
      playerName: entry.playerName,
      player,
      selfPlaced: entry.enteredBy === "self",
      betAmount: entry.amount,
      optionLabel: opt?.label ?? "?",
      odds: opt?.odds ?? "?",
      grossPayout,
      rakeAmount,
      rakePercent,
      payoutAmount: netPayout,
      enteredAt: entry.createdAt,
    };
  });

  return res.json(payouts);
});

// ── Events ───────────────────────────────────────────────────────────────────

router.get("/events", requireSportbetsOrAbove, async (_req, res) => {
  const events = await db.select().from(sportBetEventsTable).orderBy(desc(sportBetEventsTable.createdAt));
  if (events.length === 0) return res.json([]);

  const eventIds = events.map((e) => e.id);
  const options = await db.select().from(sportBetEventOptionsTable).where(inArray(sportBetEventOptionsTable.eventId, eventIds));
  const entries = await db
    .select()
    .from(sportBetEventEntriesTable)
    .where(inArray(sportBetEventEntriesTable.eventId, eventIds))
    .then((r) => r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));

  const entryPlayerIds = [...new Set(entries.map((e) => (e as any).playerId).filter(Boolean))];
  const players = entryPlayerIds.length > 0
    ? await db
        .select({ id: playersTable.id, username: playersTable.username, stateId: playersTable.stateId, phoneNumber: playersTable.phoneNumber })
        .from(playersTable)
        .where(inArray(playersTable.id, entryPlayerIds))
    : [];

  const result = events.map((ev) => {
    const evOptions = options.filter((o) => o.eventId === ev.id);
    const evEntries = entries.filter((e) => e.eventId === ev.id).map((entry) => {
      const player = players.find((p) => p.id === (entry as any).playerId) ?? null;
      return { ...entry, player };
    });
    return {
      ...ev,
      options: evOptions.map((o) => ({
        ...o,
        entryCount: evEntries.filter((e) => e.optionId === o.id).length,
        totalWagered: evEntries.filter((e) => e.optionId === o.id).reduce((s, e) => s + e.amount, 0),
      })),
      entries: evEntries,
      totalWagered: evEntries.reduce((s, e) => s + e.amount, 0),
    };
  });

  return res.json(result);
});

router.post("/events", requireSportbetsOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const { title, description, league, gameDate, options, rakePercent } = req.body;

  if (!title?.trim()) return res.status(400).json({ error: "Title is required" });
  if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: "At least 2 options required" });
  for (const o of options) {
    if (!o.label?.trim()) return res.status(400).json({ error: "All options need a label" });
    if (!o.odds?.trim()) return res.status(400).json({ error: "All options need odds" });
  }

  const rake = Math.max(0, Math.min(100, parseInt(rakePercent ?? "0") || 0));
  const gameDateVal = gameDate ? new Date(gameDate) : null;

  const [event] = await db
    .insert(sportBetEventsTable)
    .values({ title: title.trim(), description: description?.trim() || "", league: league?.trim() || "", gameDate: gameDateVal, rakePercent: rake, createdBy: session.username } as any)
    .returning();

  const insertedOptions = await db
    .insert(sportBetEventOptionsTable)
    .values(options.map((o: any) => ({ eventId: event.id, label: o.label.trim(), odds: o.odds.trim() })))
    .returning();

  return res.json({ ...event, options: insertedOptions, entries: [], totalWagered: 0 });
});

router.patch("/events/:id", requireSportbetsOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const id = parseInt(req.params.id as string);
  const { status, winnerId } = req.body;

  if (!["open", "closed", "settled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const updates: any = { status };
  if (status === "settled") {
    if (!winnerId) return res.status(400).json({ error: "winnerId required when settling" });
    updates.winnerId = parseInt(winnerId);
    updates.settledAt = new Date();
  }

  const [updated] = await db.update(sportBetEventsTable).set(updates).where(eq(sportBetEventsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Event not found" });

  // Auto-pay all winning entries immediately on settle
  if (status === "settled") {
    const winnerOptionId = parseInt(winnerId);
    const rakePercent = (updated as any)?.rakePercent ?? 0;

    // Fetch the winning option (for odds)
    const [winOpt] = await db.select().from(sportBetEventOptionsTable).where(eq(sportBetEventOptionsTable.id, winnerOptionId));
    const odds = parseOdds(winOpt?.odds ?? "1");

    // Fetch all unpaid entries on the winning option
    const winningEntries = await db.select().from(sportBetEventEntriesTable)
      .where(eq(sportBetEventEntriesTable.eventId, id));
    const unpaid = winningEntries.filter((e: any) => e.optionId === winnerOptionId && !e.paidAt);

    for (const entry of unpaid) {
      const grossPayout = Math.floor(entry.amount * odds);
      const rakeAmount = Math.floor(grossPayout * rakePercent / 100);
      const netPayout = grossPayout - rakeAmount;

      // Mark as paid
      await db.update(sportBetEventEntriesTable)
        .set({ paidAt: new Date() } as any)
        .where(eq(sportBetEventEntriesTable.id, entry.id));

      // Deposit chips if self-placed via player portal
      if (entry.enteredBy === "self" && (entry as any).playerId) {
        const playerId = (entry as any).playerId as number;
        const [playerRow] = await db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, playerId));
        if (playerRow) {
          const newChips = Number(playerRow.chips) + netPayout;
          await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
          broadcastPlayerBalance(playerId, newChips);
          // Record win in player transaction history
          await db.insert(transactionsTable).values({
            playerId,
            amount: netPayout,
            type: "win",
            description: `Sports Bet Win: ${updated.title} → ${winOpt?.label ?? "winner"} (${winOpt?.odds ?? "?"})`,
          });
        }
      }

      // Finance records
      await db.insert(sportBetFinancesTable).values({
        source: "crate",
        type: "expense",
        amount: netPayout,
        description: `Payout (auto): ${entry.playerName} — ${updated.title}`,
        staffUsername: session.username,
      });
      if (rakeAmount > 0) {
        await db.insert(sportBetFinancesTable).values({
          source: "rake",
          type: "income",
          amount: rakeAmount,
          description: `Rake ${rakePercent}% on payout: ${entry.playerName} — ${updated.title}`,
          staffUsername: session.username,
        });
      }
    }
  }

  return res.json(updated);
});

router.delete("/events/:id", requireSportbetsOrAbove, async (req, res) => {
  const id = parseInt(req.params.id as string);
  await db.delete(sportBetEventEntriesTable).where(eq(sportBetEventEntriesTable.eventId, id));
  await db.delete(sportBetEventOptionsTable).where(eq(sportBetEventOptionsTable.eventId, id));
  await db.delete(sportBetEventsTable).where(eq(sportBetEventsTable.id, id));
  return res.json({ success: true });
});

// ── Entries ───────────────────────────────────────────────────────────────────

router.post("/events/:id/entries", requireSportbetsOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const eventId = parseInt(req.params.id as string);
  const { optionId, playerName, playerId, amount } = req.body;

  const [event] = await db.select().from(sportBetEventsTable).where(eq(sportBetEventsTable.id, eventId));
  if (!event) return res.status(404).json({ error: "Event not found" });
  if (event.status !== "open") return res.status(400).json({ error: "Event is not open for bets" });

  if (!playerName?.trim()) return res.status(400).json({ error: "Player name is required" });
  const amt = parseInt(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be positive" });
  const optId = parseInt(optionId);
  if (!optId) return res.status(400).json({ error: "Option is required" });

  const pId = playerId ? parseInt(playerId) : null;

  const [entry] = await db
    .insert(sportBetEventEntriesTable)
    .values({ eventId, optionId: optId, playerId: pId, playerName: playerName.trim(), amount: amt, enteredBy: session.username } as any)
    .returning();

  await db.insert(sportBetFinancesTable).values({
    source: "crate",
    type: "income",
    amount: amt,
    description: `Bet: ${playerName.trim()} — ${event.title}`,
    staffUsername: session.username,
  });

  return res.json(entry);
});

// Pay out a winning entry — if chips were self-bet, add chips to player account
router.post("/event-entries/:id/pay", requireSportbetsOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const id = parseInt(req.params.id as string);

  const [entry] = await db.select().from(sportBetEventEntriesTable).where(eq(sportBetEventEntriesTable.id, id));
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  if ((entry as any).paidAt) return res.status(400).json({ error: "Already marked as paid" });

  const [opt] = await db.select().from(sportBetEventOptionsTable).where(eq(sportBetEventOptionsTable.id, entry.optionId));
  const [event] = await db.select().from(sportBetEventsTable).where(eq(sportBetEventsTable.id, entry.eventId));

  const odds = parseOdds(opt?.odds ?? "1");
  const rakePercent = (event as any)?.rakePercent ?? 0;
  const grossPayout = Math.floor(entry.amount * odds);
  const rakeAmount = Math.floor(grossPayout * rakePercent / 100);
  const netPayout = grossPayout - rakeAmount;

  const [updated] = await db
    .update(sportBetEventEntriesTable)
    .set({ paidAt: new Date() } as any)
    .where(eq(sportBetEventEntriesTable.id, id))
    .returning();

  // If the player bet via the player portal (chips were deducted), add chips back as winnings
  if (entry.enteredBy === "self" && (entry as any).playerId) {
    const playerId = (entry as any).playerId as number;
    const [playerRow] = await db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, playerId));
    if (playerRow) {
      const newChips = Number(playerRow.chips) + netPayout;
      await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
      broadcastPlayerBalance(playerId, newChips);
    }
  }

  await db.insert(sportBetFinancesTable).values({
    source: "crate",
    type: "expense",
    amount: netPayout,
    description: `Payout: ${entry.playerName} — ${event?.title ?? "event"}`,
    staffUsername: session.username,
  });

  if (rakeAmount > 0) {
    await db.insert(sportBetFinancesTable).values({
      source: "rake",
      type: "income",
      amount: rakeAmount,
      description: `Rake ${rakePercent}% on payout: ${entry.playerName} — ${event?.title ?? "event"}`,
      staffUsername: session.username,
    });
  }

  return res.json({ ...updated, grossPayout, rakeAmount, netPayout });
});

router.delete("/event-entries/:id", requireSportbetsOrAbove, async (req, res) => {
  const id = parseInt(req.params.id as string);

  // If the entry was self-placed (chips already deducted), refund chips before deleting
  const [entry] = await db.select().from(sportBetEventEntriesTable).where(eq(sportBetEventEntriesTable.id, id));
  if (entry && entry.enteredBy === "self" && (entry as any).playerId && !(entry as any).paidAt) {
    const playerId = (entry as any).playerId as number;
    const [playerRow] = await db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, playerId));
    if (playerRow) {
      const newChips = Number(playerRow.chips) + entry.amount;
      await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
      broadcastPlayerBalance(playerId, newChips);
    }
    // Also remove the finance entry for the bet
    await db.delete(sportBetFinancesTable).where(
      eq(sportBetFinancesTable.description, `Player bet: ${entry.playerName} — `)
    );
  }

  await db.delete(sportBetEventEntriesTable).where(eq(sportBetEventEntriesTable.id, id));
  return res.json({ success: true });
});

// ── Live Odds Bet — deducts chips, broadcasts balance update ──────────────────
router.post("/public/live-bet", requirePlayer, async (req, res) => {
  try {
    const playerId = (req as any).authenticatedPlayerId as number;
    const { wager, betType, picks } = req.body as {
      wager: number;
      betType?: string;
      picks?: { teamName?: string }[];
    };

    console.log(`[live-bet] player=${playerId} wager=${wager} betType=${betType}`);

    const w = Math.floor(Number(wager));
    if (!w || w <= 0) return res.status(400).json({ error: "Wager must be greater than 0" });

    const [player] = await db
      .select({ id: playersTable.id, username: playersTable.username, chips: playersTable.chips })
      .from(playersTable)
      .where(eq(playersTable.id, playerId));

    if (!player) return res.status(404).json({ error: "Player not found" });

    const currentChips = Number(player.chips);
    console.log(`[live-bet] player=${player.username} chips=${currentChips} wager=${w}`);

    if (currentChips < w) return res.status(400).json({ error: "Insufficient chips" });

    const newChips = currentChips - w;
    await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
    broadcastPlayerBalance(playerId, newChips);

    const pickList = Array.isArray(picks) ? picks as { teamName?: string; odds?: number; matchup?: string }[] : [];
    const pickDesc = pickList.length > 0 ? pickList.map(p => p.teamName ?? "?").join(", ") : "live odds bet";

    // Record transaction — non-fatal if it fails
    try {
      await db.insert(transactionsTable).values({
        playerId,
        amount: w,
        type: "loss",
        description: `Sports Bet (${betType ?? "live"}): ${pickDesc}`,
      });
    } catch (txErr) {
      console.error("[live-bet] transaction insert failed (non-fatal):", txErr);
    }

    // Calculate rake (10% of wager) and adjusted potential payout
    const rakeAmount = Math.floor(w * 0.1);

    // Save bet slip — non-fatal if it fails
    try {
      let decimalOdds = 1;
      for (const pick of pickList) {
        const odds = Number(pick.odds);
        if (odds && !isNaN(odds)) {
          decimalOdds *= odds >= 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
        }
      }
      const slipType = String(betType) === "parlay" ? "parlay" : "single";
      const grossPayout = Math.floor(w * decimalOdds);
      const potentialPayout = Math.max(0, grossPayout - rakeAmount);
      await db.insert(sportBetSlipsTable).values({
        playerId,
        playerUsername: player.username,
        type: slipType,
        wagerAmount: w,
        potentialPayout,
        status: "pending",
        selections: JSON.stringify(pickList),
      });
    } catch (slipErr) {
      console.error("[live-bet] bet slip insert failed (non-fatal):", slipErr);
    }

    // Record rake to sport_bet_finances — non-fatal
    try {
      await db.insert(sportBetFinancesTable).values({
        source: "rake",
        type: "income",
        amount: rakeAmount,
        description: `Live bet rake 10% — ${String(betType) === "parlay" ? "parlay" : "single"} (${pickDesc.substring(0, 80)})`,
        staffUsername: "system",
      } as any);
    } catch (rakeErr) {
      console.error("[live-bet] rake record failed (non-fatal):", rakeErr);
    }

    console.log(`[live-bet] success — player=${player.username} newChips=${newChips}`);
    return res.json({ success: true, newChips });
  } catch (err) {
    console.error("[live-bet] unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Admin bet slip routes ─────────────────────────────────────────────────────

// GET /sportbets/admin/slips — list all slips with optional filters
router.get("/admin/slips", requireSportbetsOrAbove, async (req, res) => {
  try {
    const { player, status, type, minWager, maxWager } = req.query;
    const conditions = and(
      player ? ilike(sportBetSlipsTable.playerUsername, `%${String(player)}%`) : undefined,
      status ? eq(sportBetSlipsTable.status, String(status)) : undefined,
      type   ? eq(sportBetSlipsTable.type,   String(type))   : undefined,
      minWager && !isNaN(parseInt(String(minWager))) ? gte(sportBetSlipsTable.wagerAmount, parseInt(String(minWager))) : undefined,
      maxWager && !isNaN(parseInt(String(maxWager))) ? lte(sportBetSlipsTable.wagerAmount, parseInt(String(maxWager))) : undefined,
    );
    const slips = await db.select().from(sportBetSlipsTable)
      .where(conditions)
      .orderBy(desc(sportBetSlipsTable.createdAt))
      .limit(300);
    return res.json(slips);
  } catch (err) {
    console.error("[slips] get error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /sportbets/admin/slips/:id — settle: won / lost / voided / cashed_out
router.patch("/admin/slips/:id", requireSportbetsOrAbove, async (req, res) => {
  try {
    const slipId = parseInt(req.params.id);
    const { status } = req.body as { status: string };
    const session = (req as any).bankerSession;

    if (!["won", "lost", "voided", "cashed_out"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const [slip] = await db.select().from(sportBetSlipsTable).where(eq(sportBetSlipsTable.id, slipId));
    if (!slip) return res.status(404).json({ error: "Slip not found" });
    if (slip.status !== "pending") return res.status(400).json({ error: "Slip already settled" });

    const update: Record<string, unknown> = {
      status,
      settledAt: new Date(),
      settledBy: session.username,
    };

    if (status === "won") {
      update.actualPayout = slip.potentialPayout;
      await db.update(playersTable)
        .set({ chips: sql`chips + ${slip.potentialPayout}` })
        .where(eq(playersTable.id, slip.playerId));
      const [p] = await db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, slip.playerId));
      if (p) broadcastPlayerBalance(slip.playerId, Number(p.chips));
      try {
        await db.insert(transactionsTable).values({
          playerId: slip.playerId, amount: slip.potentialPayout, type: "win",
          description: `Sports Bet Won (slip #${slip.id})`, staffUsername: session.username,
        });
      } catch {}
    } else if (status === "voided") {
      update.actualPayout = slip.wagerAmount;
      await db.update(playersTable)
        .set({ chips: sql`chips + ${slip.wagerAmount}` })
        .where(eq(playersTable.id, slip.playerId));
      const [p] = await db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, slip.playerId));
      if (p) broadcastPlayerBalance(slip.playerId, Number(p.chips));
      try {
        await db.insert(transactionsTable).values({
          playerId: slip.playerId, amount: slip.wagerAmount, type: "deposit",
          description: `Sports Bet Voided – refund (slip #${slip.id})`, staffUsername: session.username,
        });
      } catch {}
    }

    await db.update(sportBetSlipsTable).set(update).where(eq(sportBetSlipsTable.id, slipId));
    return res.json({ success: true });
  } catch (err) {
    console.error("[slips] patch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /sportbets/admin/slips/:id/note — add or update admin note
router.post("/admin/slips/:id/note", requireSportbetsOrAbove, async (req, res) => {
  try {
    const slipId = parseInt(req.params.id);
    const { note } = req.body as { note: string };
    await db.update(sportBetSlipsTable).set({ adminNote: note ?? null }).where(eq(sportBetSlipsTable.id, slipId));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /sportbets/admin/slips/:id — owner only
router.delete("/admin/slips/:id", requireOwner, async (req, res) => {
  try {
    const slipId = parseInt(req.params.id);
    await db.delete(sportBetSlipsTable).where(eq(sportBetSlipsTable.id, slipId));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
