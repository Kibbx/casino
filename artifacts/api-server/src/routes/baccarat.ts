import { Router } from "express";
import { db, baccaratTablesTable, playersTable, transactionsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireBanker, requireDealerOrAbove, requirePlayer } from "../middleware/auth.js";
import { getOrCreateBacRoom, getBacRoom } from "../lib/baccarat-room.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { isPlayerGameBanned } from "./security.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";
import bcrypt from "bcryptjs";

const router = Router();

// ── POST /baccarat/verify-password — global check (uses banker-set password in settings) ──
router.post("/verify-password", async (req, res) => {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "baccaratPassword"));
  const hashedPwd = row?.value;
  if (!hashedPwd) return res.json({ token: "open" }); // no password configured
  const valid = await bcrypt.compare(req.body.password ?? "", hashedPwd);
  if (!valid) return res.status(403).json({ error: "Incorrect password" });
  return res.json({ token: "open" });
});

// ── GET /baccarat/tables ───────────────────────────────────────────────────────
router.get("/tables", async (_req, res) => {
  const tables = await db.select().from(baccaratTablesTable).orderBy(baccaratTablesTable.id);
  // Password is stored globally in settings (not per-table), so read it once
  const [pwRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "baccaratPassword"));
  const hasPassword = !!(pwRow?.value);
  res.json(tables.map(t => {
    const room = getBacRoom(t.id);
    return {
      id: t.id,
      name: t.name,
      minBet: t.minBet,
      maxBet: t.maxBet,
      bankerCommission: t.bankerCommission,
      tiePayout: t.tiePayout,
      bettingTimerSecs: t.bettingTimerSecs,
      isOpen: t.isOpen,
      hasPassword,
      phase: room?.phase ?? "WAITING",
      playerCount: room?.subscribers.size ?? 0,
    };
  }));
});

// ── POST /baccarat/tables — create (banker+) ───────────────────────────────────
router.post("/tables", requireBanker, async (req, res) => {
  const { name, minBet = 100, maxBet = 10000, bankerCommission = 5, tiePayout = 8, bettingTimerSecs = 30 } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const [table] = await db.insert(baccaratTablesTable).values({
    name, minBet, maxBet, bankerCommission, tiePayout, bettingTimerSecs, isOpen: true,
  }).returning();

  const room = getOrCreateBacRoom({
    id: table.id, name: table.name, minBet: table.minBet, maxBet: table.maxBet,
    bankerCommission: table.bankerCommission, tiePayout: table.tiePayout,
    bettingTimerSecs: table.bettingTimerSecs, isOpen: table.isOpen,
  });
  room.startBetting();

  return res.json(table);
});

// ── GET /baccarat/tables/:id ───────────────────────────────────────────────────
router.get("/tables/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [table] = await db.select().from(baccaratTablesTable).where(eq(baccaratTablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });
  const room = getBacRoom(id);
  res.json({
    ...table,
    hasPassword: !!table.passwordHash,
    passwordHash: undefined,
    phase: room?.phase ?? "WAITING",
    playerCount: room?.subscribers.size ?? 0,
  });
});

// ── POST /baccarat/tables/:id/verify-password ──────────────────────────────────
router.post("/tables/:id/verify-password", async (req, res) => {
  const id = parseInt(req.params.id);
  const [table] = await db.select().from(baccaratTablesTable).where(eq(baccaratTablesTable.id, id));
  if (!table) return res.status(404).json({ error: "Table not found" });
  if (!table.passwordHash) return res.json({ valid: true });
  const valid = await bcrypt.compare(req.body.password ?? "", table.passwordHash);
  if (!valid) return res.status(403).json({ error: "Incorrect password" });
  return res.json({ valid: true });
});

// ── POST /baccarat/tables/:id/set-limits (dealer+) ────────────────────────────
router.post("/tables/:id/set-limits", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  const { minBet, maxBet } = req.body;
  if (!minBet || !maxBet) return res.status(400).json({ error: "minBet and maxBet required" });
  if (maxBet < minBet) return res.status(400).json({ error: "maxBet must be >= minBet" });

  const [updated] = await db.update(baccaratTablesTable)
    .set({ minBet, maxBet, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Table not found" });

  getBacRoom(id)?.updateConfig({ minBet, maxBet });
  return res.json(updated);
});

// ── POST /baccarat/tables/:id/set-commission (banker+) ────────────────────────
router.post("/tables/:id/set-commission", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id);
  const commission = parseInt(req.body.bankerCommission ?? req.body.commission);
  if (isNaN(commission) || commission < 0 || commission > 10) {
    return res.status(400).json({ error: "Commission must be 0–10%" });
  }
  const [updated] = await db.update(baccaratTablesTable)
    .set({ bankerCommission: commission, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Table not found" });

  getBacRoom(id)?.updateConfig({ bankerCommission: commission });
  return res.json(updated);
});

// ── POST /baccarat/tables/:id/set-tie-payout (banker+) ────────────────────────
router.post("/tables/:id/set-tie-payout", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id);
  const tiePayout = parseInt(req.body.tiePayout);
  if (isNaN(tiePayout) || tiePayout < 1 || tiePayout > 20) {
    return res.status(400).json({ error: "Tie payout must be 1–20" });
  }
  const [updated] = await db.update(baccaratTablesTable)
    .set({ tiePayout, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Table not found" });

  getBacRoom(id)?.updateConfig({ tiePayout });
  return res.json(updated);
});

// ── POST /baccarat/tables/:id/set-timer (dealer+) ─────────────────────────────
router.post("/tables/:id/set-timer", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  const secs = parseInt(req.body.bettingTimerSecs);
  if (isNaN(secs) || secs < 5 || secs > 300) {
    return res.status(400).json({ error: "Timer must be 5–300 seconds" });
  }
  const [updated] = await db.update(baccaratTablesTable)
    .set({ bettingTimerSecs: secs, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Table not found" });

  getBacRoom(id)?.updateConfig({ bettingTimerSecs: secs });
  return res.json(updated);
});

// ── POST /baccarat/tables/:id/set-password (dealer+) ──────────────────────────
router.post("/tables/:id/set-password", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body;
  const hash = password ? await bcrypt.hash(password, 10) : null;
  const [updated] = await db.update(baccaratTablesTable)
    .set({ passwordHash: hash, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Table not found" });
  return res.json({ success: true, hasPassword: !!hash });
});

// ── POST /baccarat/tables/:id/toggle (dealer+) ────────────────────────────────
router.post("/tables/:id/toggle", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(baccaratTablesTable).where(eq(baccaratTablesTable.id, id));
  if (!existing) return res.status(404).json({ error: "Table not found" });

  const isOpen = !existing.isOpen;
  const [updated] = await db.update(baccaratTablesTable)
    .set({ isOpen, updatedAt: new Date() })
    .where(eq(baccaratTablesTable.id, id))
    .returning();

  const room = getBacRoom(id);
  if (room) {
    room.updateConfig({ isOpen });
    if (isOpen) room.resume();
    else room.pause();
  }
  return res.json(updated);
});

// ── POST /baccarat/tables/:id/pause (dealer+) ─────────────────────────────────
router.post("/tables/:id/pause", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  getBacRoom(id)?.pause();
  return res.json({ success: true });
});

// ── POST /baccarat/tables/:id/resume (dealer+) ────────────────────────────────
router.post("/tables/:id/resume", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  getBacRoom(id)?.resume();
  return res.json({ success: true });
});

// ── POST /baccarat/tables/:id/start-round (dealer+) ───────────────────────────
router.post("/tables/:id/start-round", requireDealerOrAbove, async (req, res) => {
  const id = parseInt(req.params.id);
  const room = getBacRoom(id);
  if (!room) return res.status(404).json({ error: "Table not found" });
  if (room.phase !== "WAITING") return res.status(400).json({ error: "Round already in progress" });
  room.paused = false;
  room.startBetting();
  return res.json({ success: true });
});

// ── DELETE /baccarat/tables/:id (banker+) ─────────────────────────────────────
router.delete("/tables/:id", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id);
  const room = getBacRoom(id);
  if (room) room.pause();
  await db.delete(baccaratTablesTable).where(eq(baccaratTablesTable.id, id));
  return res.json({ success: true });
});

// ── Single-player baccarat engine ─────────────────────────────────────────────

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function drawCard() {
  return { suit: SUITS[Math.floor(Math.random() * 4)], rank: RANKS[Math.floor(Math.random() * 13)] };
}
function cardValue(c: { rank: string }) {
  if (["10", "J", "Q", "K"].includes(c.rank)) return 0;
  if (c.rank === "A") return 1;
  return parseInt(c.rank);
}
function handTotal(cards: { rank: string }[]) {
  return cards.reduce((sum, c) => sum + cardValue(c), 0) % 10;
}

function playHand() {
  const pCards = [drawCard(), drawCard()];
  const bCards = [drawCard(), drawCard()];
  let pTotal = handTotal(pCards);
  let bTotal = handTotal(bCards);

  if (pTotal < 8 && bTotal < 8) {
    let pThird: { suit: string; rank: string } | null = null;
    if (pTotal <= 5) {
      pThird = drawCard();
      pCards.push(pThird);
      pTotal = handTotal(pCards);
    }
    const ptv = pThird ? cardValue(pThird) : null;
    const bankerDraws = ptv === null
      ? bTotal <= 5
      : bTotal <= 2 ? true
      : bTotal === 3 ? ptv !== 8
      : bTotal === 4 ? ptv >= 2 && ptv <= 7
      : bTotal === 5 ? ptv >= 4 && ptv <= 7
      : bTotal === 6 ? ptv === 6 || ptv === 7
      : false;
    if (bankerDraws) { bCards.push(drawCard()); bTotal = handTotal(bCards); }
  }

  const outcome: "player" | "banker" | "tie" =
    pTotal > bTotal ? "player" : bTotal > pTotal ? "banker" : "tie";
  return { playerCards: pCards, bankerCards: bCards, playerTotal: pTotal, bankerTotal: bTotal, outcome };
}

// ── POST /baccarat/play-single ─────────────────────────────────────────────────

router.post("/play-single", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const banCheck = await isPlayerGameBanned(playerId, "baccarat");
  if (banCheck.banned) return res.status(403).json({ error: `Baccarat banned${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const { side, amount } = req.body;
  if (!["player", "banker", "tie"].includes(side)) return res.status(400).json({ error: "Invalid side" });
  const bet = Math.floor(Number(amount));
  if (!bet || bet <= 0) return res.status(400).json({ error: "Invalid amount" });

  const tables = await db.select().from(baccaratTablesTable).where(eq(baccaratTablesTable.isOpen, true)).limit(1);
  const tbl = tables[0];
  const minBet = tbl?.minBet ?? 100;
  const maxBet = tbl?.maxBet ?? 100000;
  const bankerComm = tbl?.bankerCommission ?? 5;
  const tiePayout = tbl?.tiePayout ?? 8;

  if (bet < minBet) return res.status(400).json({ error: `Min bet: ${minBet}` });
  if (bet > maxBet) return res.status(400).json({ error: `Max bet: ${maxBet}` });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: `Baccarat single: bet ${side}` });
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(() => {});
  recordPlayerActivity(playerId, player.username, "baccarat", true);
  trackRakebackBet(playerId, bet).catch(() => {});

  const { playerCards, bankerCards, playerTotal, bankerTotal, outcome } = playHand();

  let payout = 0;
  if (side === outcome) {
    if (side === "player") payout = bet * 2;
    else if (side === "banker") payout = bet + Math.floor(bet * (1 - bankerComm / 100));
    else payout = bet * (tiePayout + 1);
  } else if (outcome === "tie" && side !== "tie") {
    payout = bet; // push on tie
  }

  if (payout > 0) trackRakebackWin(playerId, payout, 1).catch(() => {});

  if (payout > 0) {
    const [fresh] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    await db.update(playersTable).set({ chips: fresh.chips + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId, amount: payout, type: "win",
      description: `Baccarat single: ${outcome === "tie" && side !== "tie" ? "push" : "win"} (${outcome})`,
    });
  }

  const [updated] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  broadcastPlayerBalance(playerId, updated.chips);

  return res.json({
    playerCards, bankerCards, playerTotal, bankerTotal,
    outcome, side, bet, payout, netProfit: payout - bet,
    chips: updated.chips,
    config: { minBet, maxBet, bankerCommission: bankerComm, tiePayout },
  });
});

export default router;
