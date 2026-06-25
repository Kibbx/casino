import { Router } from "express";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, promoRegionsTable, promoAssetsTable, promoPlacementsTable, promoCodesTable, promoRedemptionsTable, playersTable, settingsTable } from "@workspace/db";
import { eq, and, lte, gte, desc } from "drizzle-orm";
import { requireOwner, requireBankerOrOwner, requirePlayer } from "../middleware/auth.js";

async function getSettingValue(key: string, fallback: string): Promise<string> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? fallback;
}

const router = Router();

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

const PROMO_UPLOADS_DIR = path.join(UPLOADS_BASE, "promo");
fs.mkdirSync(PROMO_UPLOADS_DIR, { recursive: true });

// ── Public: active promos for a page (frontend rendering) ──────────────────────
router.get("/active/:pageKey", async (req, res) => {
  const { pageKey } = req.params;
  const now = new Date();
  const regions = await db
    .select()
    .from(promoRegionsTable)
    .where(and(eq(promoRegionsTable.pageKey, pageKey), eq(promoRegionsTable.isActive, true)));

  const result: any[] = [];
  for (const region of regions) {
    const [placement] = await db
      .select()
      .from(promoPlacementsTable)
      .where(
        and(
          eq(promoPlacementsTable.regionId, region.id),
          eq(promoPlacementsTable.isActive, true),
          lte(promoPlacementsTable.startsAt, now),
          gte(promoPlacementsTable.endsAt, now),
        ),
      )
      .limit(1);

    if (!placement) continue;

    const [asset] = await db
      .select()
      .from(promoAssetsTable)
      .where(eq(promoAssetsTable.id, placement.assetId))
      .limit(1);

    if (!asset) continue;

    result.push({ region, placement, asset });
  }

  res.json(result);
});

// ── Regions (Owner only) ────────────────────────────────────────────────────────
router.get("/regions", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.select().from(promoRegionsTable).orderBy(promoRegionsTable.createdAt);
  res.json(rows);
});

router.post("/regions", requireOwner, async (req, res) => {
  const { name, pageKey, x, y, width, height, isActive, desktopVisible, mobileVisible } = req.body;
  if (!name || !pageKey) return res.status(400).json({ error: "name and pageKey are required" });
  const [row] = await db
    .insert(promoRegionsTable)
    .values({ name, pageKey, x: x ?? 0, y: y ?? 0, width: width ?? 300, height: height ?? 100, isActive: isActive ?? true, desktopVisible: desktopVisible ?? true, mobileVisible: mobileVisible ?? true })
    .returning();
  res.json(row);
});

router.put("/regions/:id", requireOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, pageKey, x, y, width, height, isActive, desktopVisible, mobileVisible } = req.body;
  const [row] = await db
    .update(promoRegionsTable)
    .set({ name, pageKey, x, y, width, height, isActive, desktopVisible, mobileVisible })
    .where(eq(promoRegionsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Region not found" });
  res.json(row);
});

router.delete("/regions/:id", requireOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(promoPlacementsTable).where(eq(promoPlacementsTable.regionId, id));
  await db.delete(promoRegionsTable).where(eq(promoRegionsTable.id, id));
  res.json({ ok: true });
});

// ── Assets (Banker/Owner) ───────────────────────────────────────────────────────
router.get("/assets", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.select().from(promoAssetsTable).orderBy(promoAssetsTable.createdAt);
  res.json(rows);
});

router.post("/assets/upload", requireBankerOrOwner, (req, res) => {
  const session = (req as any).bankerSession;
  const contentType = req.headers["content-type"] ?? "";
  const allowedTypes: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const ext = allowedTypes[contentType];
  if (!ext) return res.status(400).json({ error: "Only JPEG, PNG, GIF, WebP images allowed" });

  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", async () => {
    const buf = Buffer.concat(chunks);
    if (buf.length > 10 * 1024 * 1024) return res.status(400).json({ error: "Image must be under 10MB" });
    const filename = `${randomUUID()}.${ext}`;
    const filepath = path.join(PROMO_UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, buf);
    const imageUrl = `/api/uploads/promo/${filename}`;
    // Title and metadata come from headers since the body is binary
    const title = req.headers["x-promo-title"] ? decodeURIComponent(req.headers["x-promo-title"] as string) : "Untitled";
    const targetUrl = req.headers["x-promo-url"] ? decodeURIComponent(req.headers["x-promo-url"] as string) || null : null;
    const notes = req.headers["x-promo-notes"] ? decodeURIComponent(req.headers["x-promo-notes"] as string) || null : null;
    const [asset] = await db
      .insert(promoAssetsTable)
      .values({ title, imageUrl, targetUrl, uploadedBy: session.username, notes })
      .returning();
    res.json(asset);
  });
  req.on("error", () => res.status(500).json({ error: "Upload failed" }));
});

router.post("/assets", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const { title, imageUrl, targetUrl, notes } = req.body;
  if (!title || !imageUrl) return res.status(400).json({ error: "title and imageUrl are required" });
  const [row] = await db
    .insert(promoAssetsTable)
    .values({ title, imageUrl, targetUrl: targetUrl ?? null, uploadedBy: session.username, notes: notes ?? null })
    .returning();
  res.json(row);
});

router.put("/assets/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, targetUrl, notes } = req.body;
  const [row] = await db
    .update(promoAssetsTable)
    .set({ title, targetUrl, notes })
    .where(eq(promoAssetsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Asset not found" });
  res.json(row);
});

router.delete("/assets/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const [asset] = await db.select().from(promoAssetsTable).where(eq(promoAssetsTable.id, id));
  if (asset?.imageUrl?.startsWith("/api/uploads/promo/")) {
    const filename = asset.imageUrl.split("/").pop()!;
    const filepath = path.join(PROMO_UPLOADS_DIR, filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  }
  await db.delete(promoPlacementsTable).where(eq(promoPlacementsTable.assetId, id));
  await db.delete(promoAssetsTable).where(eq(promoAssetsTable.id, id));
  res.json({ ok: true });
});

// ── Placements (Banker/Owner) ───────────────────────────────────────────────────
router.get("/placements", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.select().from(promoPlacementsTable).orderBy(promoPlacementsTable.createdAt);
  res.json(rows);
});

router.post("/placements", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const { regionId, assetId, startsAt, endsAt, isActive } = req.body;
  if (!regionId || !assetId || !startsAt || !endsAt) return res.status(400).json({ error: "regionId, assetId, startsAt and endsAt are required" });
  const [row] = await db
    .insert(promoPlacementsTable)
    .values({ regionId, assetId, startsAt: new Date(startsAt), endsAt: new Date(endsAt), isActive: isActive ?? true, createdBy: session.username })
    .returning();
  res.json(row);
});

router.put("/placements/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const { regionId, assetId, startsAt, endsAt, isActive } = req.body;
  const [row] = await db
    .update(promoPlacementsTable)
    .set({ regionId, assetId, startsAt: startsAt ? new Date(startsAt) : undefined, endsAt: endsAt ? new Date(endsAt) : undefined, isActive })
    .where(eq(promoPlacementsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Placement not found" });
  res.json(row);
});

router.delete("/placements/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(promoPlacementsTable).where(eq(promoPlacementsTable.id, id));
  res.json({ ok: true });
});

// ── Promo Codes — Admin CRUD (Banker/Owner) ────────────────────────────────

router.get("/codes", requireBankerOrOwner, async (_req, res) => {
  const codes = await db.select().from(promoCodesTable).orderBy(desc(promoCodesTable.createdAt));
  res.json(codes);
});

router.post("/codes", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const { code, type, rewardType, rewardAmount, maxUses, active } = req.body;
  if (!code || !type || !rewardType || rewardAmount == null) {
    return res.status(400).json({ error: "code, type, rewardType, and rewardAmount are required" });
  }
  if (!["single_use", "multi_use"].includes(type)) return res.status(400).json({ error: "type must be single_use or multi_use" });
  if (!["chips"].includes(rewardType)) return res.status(400).json({ error: "rewardType must be chips" });
  const upperCode = String(code).toUpperCase().trim();
  if (!upperCode) return res.status(400).json({ error: "code cannot be empty" });
  try {
    const [row] = await db.insert(promoCodesTable).values({
      code: upperCode,
      type,
      rewardType,
      rewardAmount: parseInt(rewardAmount),
      maxUses: maxUses != null && maxUses !== "" ? parseInt(maxUses) : null,
      createdBy: session.username,
      active: active !== false,
    }).returning();
    res.json(row);
  } catch (e: any) {
    if (e?.code === "23505") return res.status(409).json({ error: "Code already exists" });
    throw e;
  }
});

router.put("/codes/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  const { active, maxUses, rewardAmount, code, type } = req.body;
  const updates: Partial<{ active: boolean; maxUses: number | null; rewardAmount: number; code: string; type: string }> = {};
  if (active !== undefined) updates.active = active;
  if (maxUses !== undefined) updates.maxUses = maxUses != null && maxUses !== "" ? parseInt(maxUses) : null;
  if (rewardAmount !== undefined) updates.rewardAmount = parseInt(rewardAmount);
  if (code !== undefined) {
    const upper = String(code).toUpperCase().trim();
    if (!upper) return res.status(400).json({ error: "Code cannot be empty" });
    updates.code = upper;
  }
  if (type !== undefined) {
    if (!["single_use", "multi_use"].includes(type)) return res.status(400).json({ error: "Invalid type" });
    updates.type = type;
  }
  try {
    const [row] = await db.update(promoCodesTable).set(updates).where(eq(promoCodesTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Code not found" });
    res.json(row);
  } catch (e: any) {
    if (e?.code === "23505") return res.status(409).json({ error: "That code already exists" });
    throw e;
  }
});

router.delete("/codes/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(promoRedemptionsTable).where(eq(promoRedemptionsTable.codeId, id));
  await db.delete(promoCodesTable).where(eq(promoCodesTable.id, id));
  res.json({ ok: true });
});

// ── Promo Redemptions — Admin list ─────────────────────────────────────────

router.get("/redemptions", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.execute(`
    SELECT r.id, r.player_id, r.code_id, r.redeemed_at,
           p.username AS player_name,
           c.code AS code_name
    FROM promo_redemptions r
    LEFT JOIN players p ON p.id = r.player_id
    LEFT JOIN promo_codes c ON c.id = r.code_id
    ORDER BY r.redeemed_at DESC
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ── Promo Redeem — Player endpoint ─────────────────────────────────────────

router.post("/redeem", requirePlayer, async (req, res) => {
  const playerId: number = (req as any).authenticatedPlayerId;

  // Global kill switch check
  const promoEnabled = await getSettingValue("promoCodesEnabled", "true");
  if (promoEnabled !== "true") {
    return res.status(403).json({ error: "Promo codes are temporarily disabled." });
  }

  const rawCode = typeof req.body.code === "string" ? req.body.code.toUpperCase().trim() : "";
  if (!rawCode) return res.status(400).json({ error: "Code is required" });

  // Find the code
  const [code] = await db.select().from(promoCodesTable).where(eq(promoCodesTable.code, rawCode));
  if (!code || !code.active) return res.status(404).json({ error: "Invalid or inactive promo code" });

  // Check max uses
  if (code.maxUses != null && code.totalUses >= code.maxUses) {
    return res.status(400).json({ error: "This promo code has reached its maximum uses" });
  }

  // Single-use: check if anyone has redeemed it
  if (code.type === "single_use") {
    const [existingAny] = await db.select().from(promoRedemptionsTable).where(eq(promoRedemptionsTable.codeId, code.id));
    if (existingAny) return res.status(400).json({ error: "This code has already been used" });
  }

  // Check if this player has already redeemed it
  const [existingForPlayer] = await db.select().from(promoRedemptionsTable)
    .where(and(eq(promoRedemptionsTable.codeId, code.id), eq(promoRedemptionsTable.playerId, playerId)));
  if (existingForPlayer) return res.status(400).json({ error: "You have already redeemed this code" });

  // Fetch player
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  // Apply reward
  let newChips = player.chips;
  if (code.rewardType === "chips") {
    newChips = player.chips + code.rewardAmount;
    await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
    // Record as a bonus transaction (not counted in house P&L)
    await db.execute(`
      INSERT INTO transactions (player_id, amount, type, description)
      VALUES (${playerId}, ${code.rewardAmount}, 'bonus', 'Promo code: ${rawCode}')
    `);
  }
  // freeplay reward: could be added to a separate balance field if one exists

  // Record redemption
  await db.insert(promoRedemptionsTable).values({ playerId, codeId: code.id });

  // Increment total_uses
  await db.update(promoCodesTable)
    .set({ totalUses: code.totalUses + 1 })
    .where(eq(promoCodesTable.id, code.id));

  res.json({ ok: true, rewardType: code.rewardType, rewardAmount: code.rewardAmount, chips: newChips });
});

export default router;
