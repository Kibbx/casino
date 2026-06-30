import { Router } from "express";
import { db, playersTable, transactionsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireBankerOrOwner, requireOwner, requirePlayer, requireDealerOrAbove } from "../middleware/auth.js";
import { randomBytes, randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { checkVerifyPasswordLocked, recordVerifyPasswordFailure, clearVerifyPasswordFailures } from "../lib/sessions.js";
import fs from "fs";
import path from "path";

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

const CASE_IMAGES_DIR = path.join(UPLOADS_BASE, "case-images");
fs.mkdirSync(CASE_IMAGES_DIR, { recursive: true });

const router = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}
async function setSetting(key: string, value: string | null): Promise<void> {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length > 0) {
    if (value === null) { await db.delete(settingsTable).where(eq(settingsTable.key, key)); }
    else { await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key)); }
  } else if (value !== null) {
    await db.insert(settingsTable).values({ key, value });
  }
}

// ── Cases game settings (enabled/disabled global toggle) ──────────────────────
router.get("/cases/game-settings", async (_req, res) => {
  try {
    const enabledRaw = await getSetting("cases.enabled");
    const enabled = enabledRaw === null ? true : enabledRaw === "true";
    const countRows = await db.execute(sql`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE enabled) AS active FROM cases`);
    const row = (countRows.rows[0] as any) ?? {};
    const passwordHash = await getSetting("casesPassword");
    return res.json({ enabled, totalCases: parseInt(row.total) || 0, activeCases: parseInt(row.active) || 0, hasPassword: !!passwordHash });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// POST /cases/verify-password
router.post("/cases/verify-password", async (req, res) => {
  try {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
    if (checkVerifyPasswordLocked(ip)) return res.status(429).json({ error: "Too many failed attempts. Try again in 15 minutes." });
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });
    const hash = await getSetting("casesPassword");
    if (!hash) return res.json({ valid: true, token: null });
    const valid = await bcrypt.compare(password, hash);
    if (!valid) { recordVerifyPasswordFailure(ip); return res.status(403).json({ error: "Incorrect room password" }); }
    clearVerifyPasswordFailures(ip);
    const token = await getSetting("casesPasswordToken");
    return res.json({ valid: true, token: token || null });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.patch("/cases/game-settings", requireDealerOrAbove, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be boolean" });
    await setSetting("cases.enabled", String(enabled));
    return res.json({ enabled });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

function cryptoRandom(): number {
  const buf = randomBytes(4);
  return buf.readUInt32BE(0) / 0xffffffff;
}

const TIERS = ["common", "rare", "epic", "legendary", "jackpot"] as const;
type Tier = typeof TIERS[number];

const TIER_ORDER_DESC: Tier[] = ["jackpot", "legendary", "epic", "rare", "common"];

// ── Case image upload (disk-based, VPS-compatible) ────────────────────────────
router.post("/cases/upload-image", requireBankerOrOwner, (req, res) => {
  const contentType = req.headers["content-type"] ?? "";
  const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = allowedTypes[contentType];
  if (!ext) return (res as any).status(400).json({ error: "Only JPEG, PNG, GIF, WebP images allowed" });

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    if (buf.length > 15 * 1024 * 1024) return (res as any).status(400).json({ error: "Image must be under 15MB" });
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(CASE_IMAGES_DIR, filename);
    fs.writeFileSync(filepath, buf);
    res.json({ image_url: `/case-images/${filename}` });
  });
  req.on("error", () => (res as any).status(500).json({ error: "Upload failed" }));
});

// CS:GO-style default weights (total = 10000, jackpot ≈ 0.26%)
const CSGO_DEFAULTS = { common: 7992, rare: 1598, epic: 320, legendary: 64, jackpot: 26 };

// ── Migrations (called from runMigrations) ────────────────────────────────────
export const CASE_MIGRATIONS = [
  {
    name: "prize_items.tier column",
    sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'common'`,
  },
  {
    name: "cases table",
    sql: `CREATE TABLE IF NOT EXISTS cases (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📦',
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      tier_common INTEGER NOT NULL DEFAULT 7992,
      tier_rare INTEGER NOT NULL DEFAULT 1598,
      tier_epic INTEGER NOT NULL DEFAULT 320,
      tier_legendary INTEGER NOT NULL DEFAULT 64,
      tier_jackpot INTEGER NOT NULL DEFAULT 26,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  },
  {
    name: "case_items table",
    sql: `CREATE TABLE IF NOT EXISTS case_items (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL,
      prize_item_id INTEGER NOT NULL,
      UNIQUE(case_id, prize_item_id)
    )`,
  },
  {
    name: "prize_items.image_url column",
    sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS image_url TEXT`,
  },
  {
    name: "cases: update column defaults to CS:GO-style integer weights",
    sql: `
      ALTER TABLE cases
        ALTER COLUMN tier_common   SET DEFAULT 7992,
        ALTER COLUMN tier_rare     SET DEFAULT 1598,
        ALTER COLUMN tier_epic     SET DEFAULT 320,
        ALTER COLUMN tier_legendary SET DEFAULT 64,
        ALTER COLUMN tier_jackpot  SET DEFAULT 26
    `,
  },
  {
    // Migrate any cases still using the old percentage-based weights (total 99–101)
    // to the CS:GO-style integer weights so jackpot can be below 1%.
    name: "cases: migrate old percentage weights to CS:GO integer weights",
    sql: `
      UPDATE cases SET
        tier_common    = 7992,
        tier_rare      = 1598,
        tier_epic      = 320,
        tier_legendary = 64,
        tier_jackpot   = 26
      WHERE (tier_common + tier_rare + tier_epic + tier_legendary + tier_jackpot) BETWEEN 99 AND 101
    `,
  },
  {
    name: "case_open_log table",
    sql: `CREATE TABLE IF NOT EXISTS case_open_log (
      id SERIAL PRIMARY KEY,
      player_id INTEGER NOT NULL,
      case_id INTEGER NOT NULL,
      case_name TEXT NOT NULL,
      case_cost INTEGER NOT NULL DEFAULT 0,
      prize_id INTEGER,
      prize_name TEXT NOT NULL,
      prize_tier TEXT NOT NULL,
      prize_value INTEGER NOT NULL DEFAULT 0,
      roll_result NUMERIC NOT NULL DEFAULT 0,
      total_weight INTEGER NOT NULL DEFAULT 0,
      prize_weight INTEGER NOT NULL DEFAULT 0,
      prize_chance NUMERIC NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'item',
      profit_loss INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function rollTier(odds: Record<Tier, number>): { tier: Tier; roll: number; total: number } {
  const total = Object.values(odds).reduce((s, v) => s + v, 0);
  if (total <= 0) return { tier: "common", roll: 0, total: 0 };
  const roll = cryptoRandom() * total;
  let r = roll;
  for (const tier of TIER_ORDER_DESC) {
    r -= odds[tier];
    if (r <= 0) return { tier, roll, total };
  }
  return { tier: "common", roll, total };
}

// ── Player inventory (stacked case prizes) ───────────────────────────────────
router.get("/cases/my-inventory", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  try {
    const rows = await db.execute(sql`
      SELECT pi.id, pi.prize_item_id, pi.prize_name, pi.prize_emoji, pi.prize_type,
             pi.quantity, COALESCE(p.image_url, pi.image_url) AS image_url,
             pi.tier, pi.source, pi.first_won_at, pi.last_won_at,
             COALESCE(p.value, 0) AS prize_value
      FROM player_inventory pi
      LEFT JOIN prize_items p ON p.id = pi.prize_item_id
      WHERE pi.player_id = ${playerId}
      ORDER BY pi.last_won_at DESC
    `);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Trash an inventory item (remove, no chips returned) ───────────────────────
router.post("/cases/my-inventory/:inventoryId/trash", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const inventoryId = parseInt(req.params.inventoryId);
  if (isNaN(inventoryId)) return res.status(400).json({ error: "Invalid inventory ID" });
  try {
    const rows = await db.execute(sql`
      SELECT * FROM player_inventory WHERE id = ${inventoryId} AND player_id = ${playerId}
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Item not found in your inventory" });
    const inv = rows.rows[0] as any;
    if (inv.quantity <= 1) {
      await db.execute(sql`DELETE FROM player_inventory WHERE id = ${inventoryId}`);
    } else {
      await db.execute(sql`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ${inventoryId}`);
    }
    return res.json({ ok: true, remainingQuantity: Math.max(0, inv.quantity - 1) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Sell back an inventory item (50% of prize_items.value in chips) ───────────
router.post("/cases/my-inventory/:inventoryId/sell", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const inventoryId = parseInt(req.params.inventoryId);
  if (isNaN(inventoryId)) return res.status(400).json({ error: "Invalid inventory ID" });
  try {
    const rows = await db.execute(sql`
      SELECT pi.*, COALESCE(p.value, 0) AS prize_value
      FROM player_inventory pi
      LEFT JOIN prize_items p ON p.id = pi.prize_item_id
      WHERE pi.id = ${inventoryId} AND pi.player_id = ${playerId}
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Item not found in your inventory" });
    const inv = rows.rows[0] as any;
    const sellValue = Math.floor((inv.prize_value ?? 0) * 0.5);
    if (sellValue <= 0) return res.status(400).json({ error: "This item has no sell value" });

    if (inv.quantity <= 1) {
      await db.execute(sql`DELETE FROM player_inventory WHERE id = ${inventoryId}`);
    } else {
      await db.execute(sql`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ${inventoryId}`);
    }

    await db.execute(sql`UPDATE players SET chips = chips + ${sellValue} WHERE id = ${playerId}`);
    // Record as a case payout so it appears in cases profit stats
    await db.execute(sql`
      INSERT INTO transactions (player_id, type, amount, description)
      VALUES (${playerId}, 'win', ${sellValue}, ${'Case opening: ' + (inv.source || 'Case') + ' — ' + inv.prize_name + ' (sold at 50%)'})
    `);

    const updated = await db.execute(sql`SELECT chips FROM players WHERE id = ${playerId}`);
    const newBalance = (updated.rows[0] as any)?.chips ?? 0;

    return res.json({ ok: true, chipsAwarded: sellValue, newBalance, remainingQuantity: Math.max(0, inv.quantity - 1) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Player requests in-game delivery of an inventory item
router.post("/cases/my-inventory/:inventoryId/request", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const inventoryId = parseInt(req.params.inventoryId);
  if (isNaN(inventoryId)) return res.status(400).json({ error: "Invalid inventory ID" });
  try {
    // Fetch the inventory row
    const rows = await db.execute(sql`
      SELECT * FROM player_inventory WHERE id = ${inventoryId} AND player_id = ${playerId}
    `);
    if (!rows.rows.length) return res.status(404).json({ error: "Item not found in your inventory" });
    const inv = rows.rows[0] as any;
    if (inv.quantity < 1) return res.status(400).json({ error: "No stock to request" });

    // Decrement quantity or delete row if last one
    if (inv.quantity <= 1) {
      await db.execute(sql`DELETE FROM player_inventory WHERE id = ${inventoryId}`);
    } else {
      await db.execute(sql`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ${inventoryId}`);
    }

    // Get player name
    const playerRow = await db.execute(sql`SELECT username FROM players WHERE id = ${playerId}`);
    const username = (playerRow.rows[0] as any)?.username ?? "Unknown";

    // Create pending_rewards entry for staff to fulfill
    await db.execute(sql`
      INSERT INTO pending_rewards (player_id, player_name, game, prize_type, prize_name, prize_emoji, chips_amount, prize_item_id)
      VALUES (${playerId}, ${username}, 'case', 'item', ${inv.prize_name}, ${inv.prize_emoji || '🎁'}, 0, ${inv.prize_item_id})
    `);

    return res.json({ ok: true, remainingQuantity: Math.max(0, inv.quantity - 1) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Case CRUD (public GET) ────────────────────────────────────────────────────

router.get("/cases", async (_req, res) => {
  try {
    const rows = await db.execute(sql`SELECT * FROM cases ORDER BY id ASC`);
    const enabledRaw = await getSetting("cases.enabled");
    const gameEnabled = enabledRaw === null ? true : enabledRaw === "true";
    return res.json({ gameEnabled, cases: rows.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/cases/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const caseRows = await db.execute(sql`SELECT * FROM cases WHERE id = ${id}`);
    if (!caseRows.rows.length) return res.status(404).json({ error: "Case not found" });
    const theCase = caseRows.rows[0] as any;

    const itemRows = await db.execute(sql`
      SELECT pi.*, ci.case_id
      FROM case_items ci
      JOIN prize_items pi ON pi.id = ci.prize_item_id
      WHERE ci.case_id = ${id}
      ORDER BY pi.tier DESC, pi.name ASC
    `);

    return res.json({ ...theCase, items: itemRows.rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Open a case ───────────────────────────────────────────────────────────────

router.post("/cases/:id/open", requirePlayer, async (req, res) => {
  const caseId = parseInt(req.params.id);
  const playerId = (req as any).authenticatedPlayerId as number;

  try {
    // Check global cases enabled
    const globalEnabledRaw = await getSetting("cases.enabled");
    const globalEnabled = globalEnabledRaw === null ? true : globalEnabledRaw === "true";
    if (!globalEnabled) return res.status(400).json({ error: "Cases are currently closed" });

    // Load case
    const caseRows = await db.execute(sql`SELECT * FROM cases WHERE id = ${caseId}`);
    if (!caseRows.rows.length) return res.status(404).json({ error: "Case not found" });
    const theCase = caseRows.rows[0] as any;
    if (!theCase.enabled) return res.status(400).json({ error: "This case is currently unavailable" });

    // Load player + check balance
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const price = parseInt(theCase.price) || 0;
    const priceGems = parseInt(theCase.price_gems) || 0;

    if (priceGems > 0) {
      // Gem-priced case
      const gemsRow = await db.execute(sql`SELECT gems FROM players WHERE id = ${playerId}`);
      const playerGems = Number((gemsRow.rows[0] as any)?.gems ?? 0);
      if (playerGems < priceGems) {
        return res.status(400).json({ error: `Not enough gems (need ${priceGems.toLocaleString()} 💎)` });
      }
      await db.execute(sql`UPDATE players SET gems = gems - ${priceGems} WHERE id = ${playerId}`);
    } else if (price > 0) {
      // Chip-priced case
      if (Number(player.chips) < price) {
        return res.status(400).json({ error: `Not enough chips (need ${price.toLocaleString()})` });
      }
      await db.update(playersTable)
        .set({ chips: sql`${playersTable.chips} - ${price}` })
        .where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({
        playerId, amount: price, type: "loss", description: `Case opening: ${theCase.name}`,
      });
    }
    db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

    // ── Validate case has items configured ───────────────────────────────────
    const allCaseItems = await db.execute(sql`
      SELECT 1 FROM case_items WHERE case_id = ${caseId} LIMIT 1
    `);
    if (!allCaseItems.rows.length) {
      if (price > 0) {
        await db.update(playersTable)
          .set({ chips: sql`${playersTable.chips} + ${price}` })
          .where(eq(playersTable.id, playerId));
      }
      return res.status(400).json({ error: "This case has no items configured." });
    }

    // ── Build tier odds from THIS case only. No global stats, no history.
    //    Each open is a fresh independent roll using only this case's own weights.
    const tierOdds: Record<Tier, number> = {
      common:    theCase.tier_common    != null ? Math.max(0, parseInt(theCase.tier_common))    : CSGO_DEFAULTS.common,
      rare:      theCase.tier_rare      != null ? Math.max(0, parseInt(theCase.tier_rare))      : CSGO_DEFAULTS.rare,
      epic:      theCase.tier_epic      != null ? Math.max(0, parseInt(theCase.tier_epic))      : CSGO_DEFAULTS.epic,
      legendary: theCase.tier_legendary != null ? Math.max(0, parseInt(theCase.tier_legendary)) : CSGO_DEFAULTS.legendary,
      jackpot:   theCase.tier_jackpot   != null ? Math.max(0, parseInt(theCase.tier_jackpot))   : CSGO_DEFAULTS.jackpot,
    };

    const totalWeight = Object.values(tierOdds).reduce((s, v) => s + v, 0);
    if (totalWeight <= 0) {
      return res.status(400).json({ error: "Case has invalid tier weights (total weight is 0). Opening blocked." });
    }

    // ── Single secure random roll — no history, no correction ───────────────────
    const { tier: rolledTier, roll: rollResult } = rollTier(tierOdds);

    // ── Pick item from the rolled tier — no fallback, no stock gating ────────
    const tierItemRows = await db.execute(sql`
      SELECT pi.* FROM case_items ci
      JOIN prize_items pi ON pi.id = ci.prize_item_id
      WHERE ci.case_id = ${caseId}
        AND pi.tier = ${rolledTier}
    `);

    if (!tierItemRows.rows.length) {
      return res.status(400).json({ error: `No items configured for the ${rolledTier} tier in this case.` });
    }

    const tierItems = tierItemRows.rows as any[];
    const pickedItem = tierItems[Math.floor(cryptoRandom() * tierItems.length)];
    const finalTier = rolledTier;

    const prizeWeight = tierOdds[finalTier] ?? 0;
    const prizeChance = totalWeight > 0 ? prizeWeight / totalWeight : 0;

    // Decrement stock
    await db.execute(sql`
      UPDATE prize_items SET stock = GREATEST(0, stock - 1)
      WHERE id = ${pickedItem.id} AND stock IS NOT NULL
    `);

    // Award prize
    let outcome = "item";
    const prizeValue = Math.floor(Number(pickedItem.value) || 0);

    if (pickedItem.type === "chips") {
      await db.update(playersTable)
        .set({ chips: sql`${playersTable.chips} + ${prizeValue}` })
        .where(eq(playersTable.id, playerId));
      // chips prizes: record the win directly (chips awarded = payout)
      await db.insert(transactionsTable).values({
        playerId, amount: prizeValue, type: "win",
        description: `Case opening: ${theCase.name} — ${pickedItem.name}`,
      });
      outcome = "chips";
    } else if (pickedItem.type === "gems") {
      const gemAmt = Number(pickedItem.value) || 0;
      await db.execute(sql`UPDATE players SET gems = gems + ${gemAmt} WHERE id = ${playerId}`);
      outcome = "gems";
      // Record chip-equivalent payout value so house profit reflects gem prize cost
      if (prizeValue > 0) {
        await db.insert(transactionsTable).values({
          playerId, amount: prizeValue, type: "win",
          description: `Case opening: ${theCase.name} — ${pickedItem.name} (gems prize value)`,
        });
      }
    } else if (pickedItem.type === "bet") {
      const amt = Number(pickedItem.value) || 0;
      await db.execute(sql`
        INSERT INTO pending_rewards (player_id, player_name, game, prize_type, prize_name, prize_emoji, chips_amount, prize_item_id)
        VALUES (${playerId}, ${player.username}, 'case', 'bet', ${pickedItem.name}, ${pickedItem.emoji || '🪙'}, ${amt}, null)
      `);
      outcome = "bet";
      // Record chip-equivalent payout value so house profit reflects BET prize cost
      if (prizeValue > 0) {
        await db.insert(transactionsTable).values({
          playerId, amount: prizeValue, type: "win",
          description: `Case opening: ${theCase.name} — ${pickedItem.name} (BET prize value)`,
        });
      }
    } else {
      // Add/stack in player_inventory — player must manually request delivery.
      // NO win transaction here: item sits in inventory and hasn't cost the casino
      // anything yet. The cost is recorded when the item is sold or delivered.
      await db.execute(sql`
        INSERT INTO player_inventory (player_id, prize_item_id, prize_name, prize_emoji, prize_type, quantity, image_url, tier, source, first_won_at, last_won_at)
        VALUES (${playerId}, ${pickedItem.id}, ${pickedItem.name}, ${pickedItem.emoji || '🎁'}, 'item', 1, ${pickedItem.image_url || null}, ${finalTier}, ${theCase.name}, NOW(), NOW())
        ON CONFLICT (player_id, prize_item_id) DO UPDATE
          SET quantity = player_inventory.quantity + 1,
              last_won_at = NOW()
      `);
      outcome = "item";
    }

    const updatedPlayer = await db.select({ chips: playersTable.chips })
      .from(playersTable).where(eq(playersTable.id, playerId)).limit(1);
    const updatedGems = await db.execute(sql`SELECT gems FROM players WHERE id = ${playerId}`);
    const playerGems = Number((updatedGems.rows[0] as any)?.gems ?? 0);

    // ── Detailed open log — independent of prize selection, never affects future rolls
    const profitLoss = price - (outcome === "chips" ? prizeValue : 0);
    db.execute(sql`
      INSERT INTO case_open_log (player_id, case_id, case_name, case_cost, prize_id, prize_name, prize_tier,
        prize_value, roll_result, total_weight, prize_weight, prize_chance, outcome, profit_loss)
      VALUES (${playerId}, ${caseId}, ${theCase.name}, ${price}, ${pickedItem.id}, ${pickedItem.name},
        ${finalTier}, ${prizeValue}, ${rollResult}, ${totalWeight}, ${prizeWeight},
        ${prizeChance}, ${outcome}, ${profitLoss})
    `).catch(e => console.error("[case_open_log] write failed:", e.message));

    console.log(
      `[CASE_OPEN] case=${theCase.name}(${caseId}) player=${playerId} ` +
      `roll=${rollResult.toFixed(2)}/${totalWeight} tier=${finalTier}(${rolledTier}) ` +
      `item="${pickedItem.name}" chance=${(prizeChance * 100).toFixed(4)}% outcome=${outcome} cost=${price} value=${prizeValue}`
    );

    return res.json({
      outcome,
      tier: finalTier,
      playerChips: Number(updatedPlayer[0]?.chips ?? 0),
      playerGems,
      item: {
        id: pickedItem.id,
        name: pickedItem.name,
        emoji: pickedItem.emoji,
        type: pickedItem.type,
        value: pickedItem.value,
        tier: finalTier,
        image_url: pickedItem.image_url || null,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Admin CRUD ────────────────────────────────────────────────────────────────

router.post("/cases", requireBankerOrOwner, async (req, res) => {
  const { name, emoji = "📦", description = "", price = 0, price_gems = 0, image_url = null,
    tier_common = CSGO_DEFAULTS.common, tier_rare = CSGO_DEFAULTS.rare,
    tier_epic = CSGO_DEFAULTS.epic, tier_legendary = CSGO_DEFAULTS.legendary,
    tier_jackpot = CSGO_DEFAULTS.jackpot } = req.body ?? {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  try {
    const rows = await db.execute(sql`
      INSERT INTO cases (name, emoji, description, price, price_gems, image_url, tier_common, tier_rare, tier_epic, tier_legendary, tier_jackpot)
      VALUES (${name.trim()}, ${emoji}, ${description}, ${parseInt(price)||0}, ${parseInt(price_gems)||0}, ${image_url||null},
        ${Math.max(0,parseInt(tier_common)||CSGO_DEFAULTS.common)},
        ${Math.max(0,parseInt(tier_rare)||CSGO_DEFAULTS.rare)},
        ${Math.max(0,parseInt(tier_epic)||CSGO_DEFAULTS.epic)},
        ${Math.max(0,parseInt(tier_legendary)||CSGO_DEFAULTS.legendary)},
        ${Math.max(0,parseInt(tier_jackpot)||CSGO_DEFAULTS.jackpot)})
      RETURNING *
    `);
    return res.json(rows.rows[0]);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/cases/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body ?? {};
  try {
    const parts: any[] = [];
    if (body.name !== undefined)          parts.push(sql`name = ${body.name}`);
    if (body.emoji !== undefined)         parts.push(sql`emoji = ${body.emoji}`);
    if (body.description !== undefined)   parts.push(sql`description = ${body.description}`);
    if (body.price !== undefined)         parts.push(sql`price = ${parseInt(body.price)||0}`);
    if (body.price_gems !== undefined)    parts.push(sql`price_gems = ${parseInt(body.price_gems)||0}`);
    if (body.enabled !== undefined)       parts.push(sql`enabled = ${!!body.enabled}`);
    if (body.tier_common !== undefined)   parts.push(sql`tier_common = ${Math.max(0,parseInt(body.tier_common)||CSGO_DEFAULTS.common)}`);
    if (body.tier_rare !== undefined)     parts.push(sql`tier_rare = ${Math.max(0,parseInt(body.tier_rare)||CSGO_DEFAULTS.rare)}`);
    if (body.tier_epic !== undefined)     parts.push(sql`tier_epic = ${Math.max(0,parseInt(body.tier_epic)||CSGO_DEFAULTS.epic)}`);
    if (body.tier_legendary !== undefined) parts.push(sql`tier_legendary = ${Math.max(0,parseInt(body.tier_legendary)||CSGO_DEFAULTS.legendary)}`);
    if (body.tier_jackpot !== undefined)  parts.push(sql`tier_jackpot = ${Math.max(0,parseInt(body.tier_jackpot)||CSGO_DEFAULTS.jackpot)}`);
    if (body.image_url !== undefined)     parts.push(sql`image_url = ${body.image_url || null}`);
    if (!parts.length) return res.json({ ok: true });
    const setClauses = sql.join(parts, sql.raw(", "));
    const rows = await db.execute(sql`UPDATE cases SET ${setClauses} WHERE id = ${id} RETURNING *`);
    return res.json(rows.rows[0] ?? { error: "Not found" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/cases/:id", requireOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await db.execute(sql`DELETE FROM case_items WHERE case_id = ${id}`);
    await db.execute(sql`DELETE FROM cases WHERE id = ${id}`);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Case Item Assignment ───────────────────────────────────────────────────────

router.post("/cases/:id/items", requireBankerOrOwner, async (req, res) => {
  const caseId = parseInt(req.params.id);
  const { prize_item_id, tier = "common" } = req.body ?? {};
  if (!prize_item_id) return res.status(400).json({ error: "prize_item_id required" });
  try {
    // Set tier on prize_items row
    await db.execute(sql`UPDATE prize_items SET tier = ${tier} WHERE id = ${parseInt(prize_item_id)}`);
    await db.execute(sql`
      INSERT INTO case_items (case_id, prize_item_id) VALUES (${caseId}, ${parseInt(prize_item_id)})
      ON CONFLICT (case_id, prize_item_id) DO NOTHING
    `);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.delete("/cases/:id/items/:itemId", requireBankerOrOwner, async (req, res) => {
  const caseId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  try {
    await db.execute(sql`DELETE FROM case_items WHERE case_id = ${caseId} AND prize_item_id = ${itemId}`);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Update item tier
router.patch("/cases/:id/items/:itemId", requireBankerOrOwner, async (req, res) => {
  const itemId = parseInt(req.params.itemId);
  const { tier } = req.body ?? {};
  if (!tier || !TIERS.includes(tier as Tier)) return res.status(400).json({ error: "valid tier required" });
  try {
    await db.execute(sql`UPDATE prize_items SET tier = ${tier} WHERE id = ${itemId}`);
    return res.json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Case Stats ─────────────────────────────────────────────────────────────────

// ── All-cases aggregate stats ─────────────────────────────────────────────────
router.get("/cases/stats/all", requireBankerOrOwner, async (req, res) => {
  try {
    const casesRows = await db.execute(sql`SELECT id, name, price, enabled FROM cases ORDER BY id ASC`);
    const caseList = casesRows.rows as any[];

    // Single pass aggregate per case name from transactions
    const txRows = await db.execute(sql`
      SELECT
        description,
        type,
        COALESCE(SUM(amount), 0) AS total_amount,
        COUNT(*) AS cnt
      FROM transactions
      WHERE description LIKE 'Case opening:%'
      GROUP BY description, type
    `);

    // Build per-case map
    const statsMap: Record<string, { revenue: number; paid: number; opens: number }> = {};
    for (const row of txRows.rows as any[]) {
      const desc: string = row.description;
      // loss row: "Case opening: {name}"
      // win row:  "Case opening: {name} — {item}" (uses em-dash separator, not colon)
      // extract the case name — everything after "Case opening: " up to " — " or end of string
      const prefix = "Case opening: ";
      if (!desc.startsWith(prefix)) continue;
      const caseName = (desc.slice(prefix.length).split(" — ")[0] || "").trim();
      if (!statsMap[caseName]) statsMap[caseName] = { revenue: 0, paid: 0, opens: 0 };
      if (row.type === "loss") {
        statsMap[caseName].revenue += parseInt(row.total_amount) || 0;
        statsMap[caseName].opens += parseInt(row.cnt) || 0;
      } else if (row.type === "win") {
        statsMap[caseName].paid += parseInt(row.total_amount) || 0;
      }
    }

    const perCase = caseList.map(c => {
      const s = statsMap[c.name] ?? { revenue: 0, paid: 0, opens: 0 };
      return {
        id: c.id,
        name: c.name,
        price: c.price,
        enabled: c.enabled,
        opens: s.opens,
        revenue: s.revenue,
        paid: s.paid,
        profit: s.revenue - s.paid,
      };
    });

    const totals = perCase.reduce((acc, c) => ({
      opens: acc.opens + c.opens,
      revenue: acc.revenue + c.revenue,
      paid: acc.paid + c.paid,
      profit: acc.profit + c.profit,
    }), { opens: 0, revenue: 0, paid: 0, profit: 0 });

    return res.json({ cases: perCase, totals });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/cases/:id/stats", requireBankerOrOwner, async (req, res) => {
  const caseId = parseInt(req.params.id);
  try {
    const caseRows = await db.execute(sql`SELECT * FROM cases WHERE id = ${caseId}`);
    if (!caseRows.rows.length) return res.status(404).json({ error: "Not found" });
    const theCase = caseRows.rows[0] as any;

    const statsRows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE type='loss' AND description = ${'Case opening: ' + theCase.name}) AS total_opens,
        COALESCE(SUM(amount) FILTER (WHERE type='loss' AND description = ${'Case opening: ' + theCase.name}), 0) AS total_revenue,
        COALESCE(SUM(amount) FILTER (WHERE type='win' AND description LIKE ${'Case opening: ' + theCase.name + ' — %'}), 0) AS total_paid
      FROM transactions
    `);
    const row = (statsRows.rows[0] as any) ?? {};

    return res.json({
      totalOpens: parseInt(row.total_opens) || 0,
      totalRevenue: parseInt(row.total_revenue) || 0,
      totalPaid: parseInt(row.total_paid) || 0,
      houseProfit: (parseInt(row.total_revenue) || 0) - (parseInt(row.total_paid) || 0),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
