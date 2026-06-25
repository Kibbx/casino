import { Router } from "express";
import { db, settingsTable, playersTable, transactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireBanker, requireBankerOrOwner, requireOwner, requirePlayer } from "../middleware/auth.js";
import { sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const router = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

const PRIZE_IMAGES_DIR = path.join(UPLOADS_BASE, "prize-images");
fs.mkdirSync(PRIZE_IMAGES_DIR, { recursive: true });

// ── Prize item image upload ────────────────────────────────────────────────────
router.post("/prizes/items/upload-image", requireBankerOrOwner, (req, res) => {
  const contentType = req.headers["content-type"] ?? "";
  const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = allowedTypes[contentType];
  if (!ext) return (res as any).status(400).json({ error: "Only JPEG, PNG, GIF, WebP allowed" });
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    if (buf.length > 15 * 1024 * 1024) return (res as any).status(400).json({ error: "Image must be under 15MB" });
    const filename = `${randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(PRIZE_IMAGES_DIR, filename), buf);
    res.json({ image_url: `/prize-images/${filename}` });
  });
  req.on("error", () => (res as any).status(500).json({ error: "Upload failed" }));
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) {
    await db.insert(settingsTable).values({ key, value });
  } else {
    await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
  }
}

// Default wheel color per item type
function defaultTypeColor(type: string): string {
  const map: Record<string, string> = {
    chips: "#16a34a",
    bet: "#0891b2",
    vehicle: "#dc2626",
    cash: "#d97706",
    item: "#7c3aed",
  };
  return map[type] ?? "#6b7280";
}

function cryptoRandom(): number {
  const buf = randomBytes(4);
  return buf.readUInt32BE(0) / 0x100000000;
}

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(cryptoRandom() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Wheel Segments ────────────────────────────────────────────────────────────
// Build segments from prize items. Each item's wheel_weight is its relative
// chance of being picked. Slots let an item appear multiple times visually.

function buildSegmentsFromItems(prizeItems: any[]): any[] {
  if (!prizeItems.length) return [];
  const allSlots: any[] = [];
  prizeItems.forEach((item: any) => {
    const slots = Math.max(1, parseInt(item.wheel_slots) || 1);
    for (let s = 0; s < slots; s++) {
      allSlots.push({
        id: `${item.id}-${s}`,
        label: item.name,
        emoji: item.emoji ?? "🎁",
        type: item.type,
        weight: Math.max(1, parseInt(item.wheel_weight) || 1),
        color: item.wheel_color ?? defaultTypeColor(item.type),
        amount: item.value != null ? Number(item.value) : undefined,
        prizeItemId: item.id,
        stock: item.stock,
      });
    }
  });
  return fisherYatesShuffle(allSlots);
}

// Weighted random pick — each segment's weight is its exact relative chance.
function pickByWeight(segments: Array<{ weight: number }>) {
  const total = segments.reduce((s, x) => s + x.weight, 0);
  let r = cryptoRandom() * total;
  for (const seg of segments) {
    r -= seg.weight;
    if (r <= 0) return seg;
  }
  return segments[segments.length - 1];
}

// ── Prize Items CRUD ──────────────────────────────────────────────────────────

router.get("/prizes/items", async (_req, res) => {
  try {
    const rows = await db.execute(sql`SELECT * FROM prize_items ORDER BY id ASC`);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/prizes/items", requireBankerOrOwner, async (req, res) => {
  const { name, description = "", emoji = "🎁", category = "misc", type = "item", value, stock, image_url = null } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const val = value != null && value !== "" ? parseFloat(value) : null;
  const stk = stock != null && stock !== "" ? parseInt(stock) : null;
  try {
    const rows = await db.execute(
      sql`INSERT INTO prize_items (name, description, emoji, category, type, value, stock, image_url)
          VALUES (${name.trim()}, ${description}, ${emoji}, ${category}, ${type}, ${val}, ${stk}, ${image_url || null}) RETURNING *`
    );
    return res.json(rows.rows[0]);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/prizes/items/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body ?? {};
  try {
    const existingRows = await db.execute(sql`SELECT * FROM prize_items WHERE id = ${id}`);
    if (!existingRows.rows.length) return res.status(404).json({ error: "Not found" });
    const existing = existingRows.rows[0] as any;

    const parts: any[] = [];
    if (body.name !== undefined)         parts.push(sql`name = ${body.name ?? null}`);
    if (body.description !== undefined)  parts.push(sql`description = ${body.description ?? null}`);
    if (body.emoji !== undefined)        parts.push(sql`emoji = ${body.emoji ?? null}`);
    if (body.category !== undefined)     parts.push(sql`category = ${body.category ?? null}`);
    if (body.type !== undefined)         parts.push(sql`type = ${body.type ?? null}`);
    if (body.value !== undefined)        parts.push(sql`value = ${body.value !== "" && body.value !== null ? parseFloat(body.value) : null}`);
    if (body.stock !== undefined)        parts.push(sql`stock = ${body.stock !== "" && body.stock !== null ? parseInt(body.stock) : null}`);
    if (body.wheel_weight !== undefined) parts.push(sql`wheel_weight = ${body.wheel_weight !== "" && body.wheel_weight !== null ? parseInt(body.wheel_weight) : null}`);
    if (body.wheel_color !== undefined)  parts.push(sql`wheel_color = ${body.wheel_color || null}`);
    if (body.wheel_slots !== undefined)  parts.push(sql`wheel_slots = ${body.wheel_slots !== "" && body.wheel_slots !== null ? Math.max(1, parseInt(body.wheel_slots)) : 1}`);
    if (body.image_url !== undefined)    parts.push(sql`image_url = ${body.image_url || null}`);

    if (parts.length === 0) return res.json(existing);

    const setClauses = sql.join(parts, sql.raw(", "));
    const rows = await db.execute(sql`UPDATE prize_items SET ${setClauses} WHERE id = ${id} RETURNING *`);
    if (!rows.rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows.rows[0]);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/prizes/items/:id", requireOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.execute(sql`DELETE FROM prize_items WHERE id = ${id}`);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Wheel Config ──────────────────────────────────────────────────────────────

router.get("/prizes/wheel-config", async (_req, res) => {
  try {
    const [enabled, cost] = await Promise.all([
      getSetting("wheelEnabled", "true"),
      getSetting("wheelCost", "0"),
    ]);
    const itemRows = await db.execute(sql`SELECT * FROM prize_items WHERE wheel_weight IS NOT NULL AND wheel_weight > 0 ORDER BY id ASC`);
    const prizeItems = itemRows.rows as any[];
    const segments = buildSegmentsFromItems(prizeItems);
    return res.json({
      enabled: enabled === "true",
      cost:    parseInt(cost) || 0,
      segments,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/prizes/wheel-config", requireBankerOrOwner, async (req, res) => {
  const { enabled, cost } = req.body ?? {};
  try {
    const ops: Promise<any>[] = [];
    if (enabled !== undefined) ops.push(setSetting("wheelEnabled", String(!!enabled)));
    if (cost !== undefined)    ops.push(setSetting("wheelCost", String(parseInt(cost) || 0)));
    await Promise.all(ops);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Wheel Spin ────────────────────────────────────────────────────────────────

// Pick a prize by direct weighted random from wheel_weight. Simple and exact.
async function resolveSingleSpin(
  playerId:    number,
  playerName:  string,
  segments:    any[],
  cost:        number,
): Promise<any> {

  // Deduct spin cost
  if (cost > 0) {
    await db.update(playersTable)
      .set({ chips: sql`${playersTable.chips} - ${cost}` })
      .where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId, amount: cost, type: "loss", description: "Prize wheel spin",
    });
  }

  // Pick segment by weight
  const seg = pickByWeight(segments);
  if (!seg) {
    if (cost > 0) {
      await db.update(playersTable)
        .set({ chips: sql`${playersTable.chips} + ${cost}` })
        .where(eq(playersTable.id, playerId));
    }
    return { outcome: "error", error: "No prizes configured on this wheel" };
  }

  const winner = {
    label:       seg.label,
    emoji:       seg.emoji ?? "🎁",
    type:        seg.type,
    amount:      seg.amount,
    prizeItemId: seg.prizeItemId,
  };
  const winnerPrizeItemId: number = seg.prizeItemId;
  const itemId: number = seg.prizeItemId;

  // Award prize
  if (winner.type === "chips") {
    const amt = winner.amount ?? 0;
    await db.update(playersTable)
      .set({ chips: sql`${playersTable.chips} + ${amt}` })
      .where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({
      playerId, amount: amt, type: "win", description: `Prize wheel: ${winner.label}`,
    });
    await db.execute(sql`UPDATE prize_items SET stock = GREATEST(0, stock - 1) WHERE id = ${itemId} AND stock IS NOT NULL`);
    return { outcome: "chips", segment: winner, segmentIndex: 0, chipsWon: amt, winnerPrizeItemId };

  } else if (winner.type === "bet") {
    const amt = winner.amount ?? 0;
    await db.execute(sql`UPDATE prize_items SET stock = GREATEST(0, stock - 1) WHERE id = ${itemId} AND stock IS NOT NULL`);
    await db.execute(sql`
      INSERT INTO pending_rewards (player_id, player_name, game, prize_type, prize_name, prize_emoji, chips_amount, prize_item_id)
      VALUES (${playerId}, ${playerName}, 'wheel', 'bet', ${winner.label}, ${winner.emoji || '🪙'}, ${amt}, null)
    `);
    return { outcome: "bet", segment: winner, segmentIndex: 0, winnerPrizeItemId };

  } else {
    await db.execute(sql`UPDATE prize_items SET stock = GREATEST(0, stock - 1) WHERE id = ${itemId} AND stock IS NOT NULL`);
    await db.execute(sql`
      INSERT INTO pending_rewards (player_id, player_name, game, prize_type, prize_name, prize_emoji, chips_amount, prize_item_id)
      VALUES (${playerId}, ${playerName}, 'wheel', 'item', ${winner.label}, ${winner.emoji || '🎁'}, 0, ${itemId ?? null})
    `);
    return { outcome: "item", segment: winner, segmentIndex: 0, winnerPrizeItemId };
  }
}

router.post("/prizes/wheel/spin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  try {
    const count = Math.min(10, Math.max(1, parseInt(req.body?.count) || 1));

    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const [enabledRaw, costRaw] = await Promise.all([
      getSetting("wheelEnabled", "true"),
      getSetting("wheelCost", "0"),
    ]);

    if (enabledRaw !== "true") return res.status(400).json({ error: "Prize wheel is currently closed" });

    const cost = parseInt(costRaw) || 0;
    const totalCost = cost * count;
    if (totalCost > 0 && Number(player.chips) < totalCost) {
      return res.status(400).json({ error: `Not enough chips (need ${totalCost.toLocaleString()} for ×${count} spin)` });
    }

    const itemRows = await db.execute(sql`SELECT * FROM prize_items WHERE wheel_weight IS NOT NULL AND wheel_weight > 0 ORDER BY id ASC`);
    const prizeItems = itemRows.rows as any[];
    if (!prizeItems.length) return res.status(400).json({ error: "Wheel has no prizes configured" });

    const segments = buildSegmentsFromItems(prizeItems);
    if (!segments.length) return res.status(400).json({ error: "Wheel has no segments configured" });

    if (count === 1) {
      const spinResult = await resolveSingleSpin(playerId, player.username, segments, cost);
      return res.json(spinResult);
    }

    // Bulk spin — sequential so stock deductions are accurate
    const results: any[] = [];
    for (let i = 0; i < count; i++) {
      results.push(await resolveSingleSpin(playerId, player.username, segments, cost));
    }

    const totalChipsWon = results.reduce((s, r) => s + (r.chipsWon ?? 0), 0);
    const lastResult = results[results.length - 1];

    return res.json({
      bulk: true,
      count,
      results,
      totalChipsWon,
      wins: results.length,
      lastSegmentIndex: lastResult.segmentIndex,
      lastOutcome: lastResult.outcome,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Wheel Stats ────────────────────────────────────────────────────────────────

router.get("/prizes/wheel/stats", requireBankerOrOwner, async (_req, res) => {
  try {
    const [costRaw, jackpotValueRaw, jackpotEnabledRaw] = await Promise.all([
      getSetting("wheelCost", "0"),
      getSetting("wheelJackpotValue", "750000"),
      getSetting("wheelJackpotEnabled", "false"),
    ]);

    const spinCost = parseInt(costRaw) || 0;
    const jackpotValue = parseInt(jackpotValueRaw) || 750000;
    const jackpotEnabled = jackpotEnabledRaw === "true";

    // Core stats from transactions
    const statsRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE type = 'loss' AND description = 'Prize wheel spin') AS total_spins,
        COALESCE(SUM(amount) FILTER (WHERE type = 'loss' AND description = 'Prize wheel spin'), 0) AS total_wagered,
        COALESCE(SUM(amount) FILTER (WHERE type = 'win' AND description LIKE 'Prize wheel:%'), 0) AS total_paid
      FROM transactions
    `);
    const row = (statsRows.rows as any[])[0] ?? {};
    const totalSpins   = parseInt(row.total_spins)  || 0;
    const totalWagered = parseInt(row.total_wagered) || 0;
    const totalPaid    = parseInt(row.total_paid)    || 0;
    const houseProfit  = totalWagered - totalPaid;
    const actualRtp    = totalWagered > 0 ? (totalPaid / totalWagered) * 100 : 0;
    const avgProfitPerSpin = totalSpins > 0 ? houseProfit / totalSpins : 0;

    // Prize table — actual probabilities from weights
    const itemRows = await db.execute(sql`SELECT * FROM prize_items WHERE wheel_weight IS NOT NULL AND wheel_weight > 0 ORDER BY id ASC`);
    const prizeItems = itemRows.rows as any[];
    const totalWeight = prizeItems.reduce((s: number, it: any) => s + (parseInt(it.wheel_weight) || 0), 0);
    const prizeTable = prizeItems.map((it: any) => {
      const w = parseInt(it.wheel_weight) || 0;
      const prob = totalWeight > 0 ? w / totalWeight : 0;
      const value = Number(it.value ?? 0);
      return {
        id:            it.id,
        name:          it.name,
        emoji:         it.emoji,
        value,
        probability:   parseFloat((prob * 100).toFixed(3)),
        weight:        w,
        totalWeight,
        evContribution: prob * value,
        stock:         it.stock,
      };
    });

    return res.json({
      totalSpins,
      totalWagered,
      totalPaid,
      houseProfit,
      actualRtp,
      avgProfitPerSpin,
      spinCost,
      jackpotValue,
      jackpotEnabled,
      prizeTable,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Wheel Auto-Balance stub (removed — weights are set directly) ───────────────
router.post("/prizes/wheel/auto-balance", requireBankerOrOwner, async (_req, res) => {
  return res.status(410).json({ error: "Auto-balance has been removed. Set weights directly on each prize." });
});

// ── Claw Config ───────────────────────────────────────────────────────────────

const DEFAULT_CLAW_PRIZES = [
  { id: 1, label: "Teddy Bear",   emoji: "🐻", type: "item",  weight: 30, prizeItemId: null },
  { id: 2, label: "Gift Box",     emoji: "🎁", type: "item",  weight: 25, prizeItemId: null },
  { id: 3, label: "Gold Watch",   emoji: "⌚", type: "item",  weight: 15, prizeItemId: null },
  { id: 4, label: "Diamond Ring", emoji: "💍", type: "item",  weight: 5,  prizeItemId: null },
  { id: 5, label: "500 Chips",    emoji: "💰", type: "chips", weight: 20, amount: 500 },
  { id: 6, label: "2K Chips",     emoji: "💰", type: "chips", weight: 5,  amount: 2000 },
];

router.get("/prizes/claw-config", async (_req, res) => {
  try {
    const [enabled, cost, missChance, prizesRaw] = await Promise.all([
      getSetting("clawEnabled", "true"),
      getSetting("clawCost", "100"),
      getSetting("clawMissChance", "35"),
      getSetting("clawPrizes", JSON.stringify(DEFAULT_CLAW_PRIZES)),
    ]);
    return res.json({
      enabled: enabled === "true",
      cost: parseInt(cost) || 100,
      missChance: parseInt(missChance) || 35,
      prizes: JSON.parse(prizesRaw),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/prizes/claw-config", requireBankerOrOwner, async (req, res) => {
  const { enabled, cost, missChance, prizes } = req.body ?? {};
  try {
    const ops: Promise<any>[] = [];
    if (enabled !== undefined) ops.push(setSetting("clawEnabled", String(!!enabled)));
    if (cost !== undefined) ops.push(setSetting("clawCost", String(parseInt(cost) || 100)));
    if (missChance !== undefined) ops.push(setSetting("clawMissChance", String(Math.max(0, Math.min(100, parseInt(missChance) || 35)))));
    if (prizes !== undefined) ops.push(setSetting("clawPrizes", JSON.stringify(prizes)));
    await Promise.all(ops);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Claw Play ─────────────────────────────────────────────────────────────────

router.post("/prizes/claw/play", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  try {
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const [enabledRaw, costRaw, missChanceRaw, prizesRaw] = await Promise.all([
      getSetting("clawEnabled", "true"),
      getSetting("clawCost", "100"),
      getSetting("clawMissChance", "35"),
      getSetting("clawPrizes", JSON.stringify(DEFAULT_CLAW_PRIZES)),
    ]);

    if (enabledRaw !== "true") return res.status(400).json({ error: "Claw machine is currently out of order" });

    const cost = parseInt(costRaw) || 100;
    if (Number(player.chips) < cost) {
      return res.status(400).json({ error: `Not enough chips (need ${cost})` });
    }

    const missChance = parseInt(missChanceRaw) || 35;
    const prizes: any[] = JSON.parse(prizesRaw);

    await db.update(playersTable).set({ chips: sql`${playersTable.chips} - ${cost}` }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: cost, type: "loss", description: "Claw machine play" });

    if (Math.random() * 100 < missChance || !prizes.length) {
      return res.json({ outcome: "miss" });
    }

    const winner = pickByWeight(prizes) as any;

    if (winner.type === "chips") {
      await db.update(playersTable).set({ chips: sql`${playersTable.chips} + ${winner.amount}` }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: winner.amount, type: "win", description: `Claw machine: ${winner.label}` });
      return res.json({ outcome: "chips", prize: winner, chipsWon: winner.amount });
    } else {
      await db.execute(sql`
        INSERT INTO pending_rewards (player_id, player_name, game, prize_type, prize_name, prize_emoji, chips_amount, prize_item_id)
        VALUES (${playerId}, ${player.username}, 'claw', 'item', ${winner.label}, ${winner.emoji || '🎁'}, 0, ${winner.prizeItemId ?? null})
      `);
      return res.json({ outcome: "item", prize: winner });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Pending rewards — player view ─────────────────────────────────────────────
router.get("/prizes/my-rewards", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  try {
    const rows = await db.execute(sql`
      SELECT id, game, prize_type, prize_name, prize_emoji, chips_amount, won_at, delivered_at, delivered_by, notes
      FROM pending_rewards
      WHERE player_id = ${playerId}
      ORDER BY won_at DESC
    `);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Pending rewards — staff view ───────────────────────────────────────────────
router.get("/prizes/pending", requireBankerOrOwner, async (req, res) => {
  const showAll = req.query.all === "true";
  try {
    const rows = await db.execute(sql`
      SELECT
        pr.*,
        p.state_id,
        p.chips AS player_chips,
        pi.type AS item_type,
        pi.value AS item_value,
        pi.image_url AS item_image_url
      FROM pending_rewards pr
      LEFT JOIN players p ON p.id = pr.player_id
      LEFT JOIN prize_items pi ON pi.id = pr.prize_item_id
      ${showAll ? sql`` : sql`WHERE pr.delivered_at IS NULL`}
      ORDER BY pr.won_at DESC
    `);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── BET Reimbursement queue — rewards where staff paid from own BET wallet ─────
router.get("/prizes/bet-reimbursements", requireBankerOrOwner, async (req, res) => {
  const showAll = req.query.all === "true";
  try {
    const rows = await db.execute(sql`
      SELECT
        pr.*,
        p.state_id
      FROM pending_rewards pr
      LEFT JOIN players p ON p.id = pr.player_id
      WHERE pr.bet_paid_by IS NOT NULL
      ${showAll ? sql`` : sql`AND (pr.bet_reimbursed IS NULL OR pr.bet_reimbursed = FALSE)`}
      ORDER BY pr.won_at DESC
    `);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Mark a BET prize as reimbursed ────────────────────────────────────────────
router.post("/prizes/pending/:id/reimburse", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { reimbursedBy } = req.body ?? {};
  try {
    const existing = await db.execute(sql`SELECT id FROM pending_rewards WHERE id = ${id}`);
    if (!existing.rows.length) return res.status(404).json({ error: "Reward not found" });
    await db.execute(sql`
      UPDATE pending_rewards SET
        bet_reimbursed = TRUE,
        bet_reimbursed_by = ${reimbursedBy ?? "staff"},
        bet_reimbursed_at = NOW()
      WHERE id = ${id}
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/prizes/pending/:id/deliver", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  const { deliveredBy, notes, betPaidBy, betPaidAmount } = req.body ?? {};
  try {
    const existing = await db.execute(sql`
      SELECT id, delivered_at, game, prize_type, prize_name, prize_item_id, player_id
      FROM pending_rewards WHERE id = ${id}
    `);
    if (!existing.rows.length) return res.status(404).json({ error: "Reward not found" });
    const reward = existing.rows[0] as any;
    if (reward.delivered_at) return res.status(400).json({ error: "Already delivered" });

    await db.execute(sql`
      UPDATE pending_rewards SET
        delivered_at = NOW(),
        delivered_by = ${deliveredBy ?? null},
        notes = ${notes ?? null},
        bet_paid_by = ${betPaidBy ?? null},
        bet_paid_amount = ${betPaidAmount ? Number(betPaidAmount) : null}
      WHERE id = ${id}
    `);

    // Record the actual cost to the house when a case item or BET prize is delivered.
    // Items stay in inventory with no cost until this moment.
    if (reward.game === 'case' && reward.prize_item_id) {
      const prizeRow = await db.execute(sql`SELECT value FROM prize_items WHERE id = ${reward.prize_item_id}`);
      const prizeValue = Math.floor(Number((prizeRow.rows[0] as any)?.value ?? 0));
      if (prizeValue > 0) {
        await db.execute(sql`
          INSERT INTO transactions (player_id, type, amount, description)
          VALUES (${reward.player_id}, 'win', ${prizeValue}, ${'Case opening: ' + reward.prize_name + ' (delivered)'})
        `);
      }
    }

    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/prizes/pending/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    await db.execute(sql`DELETE FROM pending_rewards WHERE id = ${id}`);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
