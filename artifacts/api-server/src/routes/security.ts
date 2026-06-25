import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { Router } from "express";
import express from "express";
import { db, playersTable, transactionsTable, playerNotesTable, playerWarningsTable, playerGameBansTable, playerTagsTable, promoRedemptionsTable, promoCodesTable, settingsTable } from "@workspace/db";
import { eq, desc, and, or, inArray, sql as sqlExpr } from "drizzle-orm";
import { requireSecurityOrAbove, requirePitBossOrAbove, requirePlayer } from "../middleware/auth.js";
import { getActivePlayers, clearPlayerActivity, registerActivityHook } from "../lib/player-activity.js";
import { sessionHasRole } from "../lib/sessions.js";
import { broadcastToPlayer } from "../lib/table-ws.js";
import {
  getFloorEvents,
  onFlaggedPlayerActivity,
  emitKickEvent,
  emitWarnEvent,
  emitBanEvent,
  emitFlagEvent,
  clearPresenceDebounce,
  setLoginLogsExclusion,
} from "../lib/floor-events.js";
import { SECURITY_PHOTOS_DIR } from "../app.js";

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};


function parseSecurityPhotos(raw: string | null): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

const router = Router();

// ── Floor monitor: register activity hook once at startup ─────────────────────

// Cache of flagged player info: playerId → { flagSeverity }
const flaggedCache = new Map<number, { flagSeverity: string | null }>();
let flaggedCacheLoadedAt = 0;
const FLAGGED_CACHE_TTL = 60_000;

async function refreshFlaggedCache() {
  const now = Date.now();
  if (now - flaggedCacheLoadedAt < FLAGGED_CACHE_TTL) return;
  flaggedCacheLoadedAt = now;
  try {
    const rows = await db
      .select({ id: playersTable.id, flagSeverity: playersTable.flagSeverity })
      .from(playersTable)
      .where(eq(playersTable.flagged, true));
    flaggedCache.clear();
    for (const row of rows) {
      flaggedCache.set(row.id, { flagSeverity: row.flagSeverity });
    }
  } catch {}
}

registerActivityHook((playerId, username, game, _isFirstSeen) => {
  const info = flaggedCache.get(playerId);
  if (!info) return;
  onFlaggedPlayerActivity(playerId, username, game, info.flagSeverity);
});

// Refresh the cache periodically
setInterval(refreshFlaggedCache, FLAGGED_CACHE_TTL);
// Initial load (async, non-blocking)
refreshFlaggedCache().catch(() => {});

// ── Boot: seed login-log exclusion set from DB ─────────────────────────────
(async () => {
  try {
    const excluded = await db
      .select({ id: playersTable.id })
      .from(playersTable)
      .where(eq(playersTable.excludeFromLoginLogs, true));
    for (const row of excluded) setLoginLogsExclusion(row.id, true);
  } catch {}
})();

// ── Online players ─────────────────────────────────────────────────────────────

router.get("/online", requireSecurityOrAbove, async (_req, res) => {
  const active = getActivePlayers();
  if (!active.length) return res.json({ players: [] });
  const ids = active.map(p => p.playerId);
  const allTags = await db.select().from(playerTagsTable).where(inArray(playerTagsTable.playerId, ids));
  const tagsByPlayer = new Map<number, typeof allTags>();
  for (const tag of allTags) {
    if (!tagsByPlayer.has(tag.playerId)) tagsByPlayer.set(tag.playerId, []);
    tagsByPlayer.get(tag.playerId)!.push(tag);
  }
  const players = active.map(p => ({ ...p, tags: tagsByPlayer.get(p.playerId) ?? [] }));
  res.json({ players });
});

// ── Floor events feed ─────────────────────────────────────────────────────────

router.get("/floor-events", requireSecurityOrAbove, (_req, res) => {
  res.json({ events: getFloorEvents(50) });
});

// ── Kick player to lobby ─────────────────────────────────────────────────────

router.post("/kick/:playerId", requireSecurityOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { reason } = req.body;
  const staffLabel = `${session.username}`;

  // Get current location for the event
  const active = getActivePlayers();
  const ap = active.find((p) => p.playerId === playerId);

  broadcastToPlayer(playerId, {
    type: "force_kick",
    reason: reason?.trim() || "Removed from game by staff",
    kickedBy: staffLabel,
  });

  clearPlayerActivity(playerId);
  emitKickEvent(playerId, ap?.username ?? String(playerId), staffLabel, ap?.game);

  console.log(`[kick] playerId=${playerId} kicked to lobby by ${staffLabel}`);
  return res.json({ success: true });
});

// ── Dismiss ghost player from activity tracker ────────────────────────────────

router.delete("/dismiss/:playerId", requireSecurityOrAbove, (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });
  clearPlayerActivity(playerId);
  console.log(`[dismiss] playerId=${playerId} removed from activity map`);
  return res.json({ success: true });
});

// ── Security profile ──────────────────────────────────────────────────────────

router.get("/profile/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });
  try {
    const [player] = await db
      .select({
        id: playersTable.id,
        username: playersTable.username,
        chips: playersTable.chips,
        avatarUrl: playersTable.avatarUrl,
        flagged: playersTable.flagged,
        flagReason: playersTable.flagReason,
        flagSeverity: playersTable.flagSeverity,
        flaggedBy: playersTable.flaggedBy,
        flaggedAt: playersTable.flaggedAt,
        securityPhotos: playersTable.securityPhotos,
        securityNotes: playersTable.securityNotes,
        createdAt: playersTable.createdAt,
        excludeFromLoginLogs: playersTable.excludeFromLoginLogs,
      })
      .from(playersTable)
      .where(eq(playersTable.id, playerId));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const notes = await db
      .select()
      .from(playerNotesTable)
      .where(eq(playerNotesTable.playerId, playerId))
      .orderBy(desc(playerNotesTable.createdAt));

    const warnings = await db
      .select()
      .from(playerWarningsTable)
      .where(eq(playerWarningsTable.playerId, playerId))
      .orderBy(desc(playerWarningsTable.createdAt));

    const now = new Date();
    const bans = await db
      .select()
      .from(playerGameBansTable)
      .where(
        and(
          eq(playerGameBansTable.playerId, playerId),
          eq(playerGameBansTable.lifted, false)
        )
      )
      .orderBy(desc(playerGameBansTable.createdAt));

    const activeBans = bans.filter((b) => !b.expiresAt || b.expiresAt > now);

    const recentTxs = await db
      .select()
      .from(transactionsTable)
      .where(eq(transactionsTable.playerId, playerId))
      .orderBy(desc(transactionsTable.createdAt))
      .limit(20);

    const tags = await db.select().from(playerTagsTable).where(eq(playerTagsTable.playerId, playerId)).orderBy(playerTagsTable.createdAt);

    return res.json({ player, notes, warnings, activeBans, recentTxs, tags });
  } catch (err: any) {
    console.error("Security profile error:", err?.message ?? err);
    return res.status(500).json({ error: "Database error loading player profile. Run the VPS column migration." });
  }
});

// ── Player tags ───────────────────────────────────────────────────────────────

const ALLOWED_TAG_COLORS = ["#6b7280","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#dc2626","#7c3aed"];

router.get("/player-tags", requireSecurityOrAbove, async (_req, res) => {
  const tags = await db.select().from(playerTagsTable).orderBy(playerTagsTable.playerId, playerTagsTable.createdAt);
  res.json({ tags });
});

router.post("/player-tags", requireSecurityOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const { playerId, label, color, flagged } = req.body;
  if (!playerId || !label?.trim()) return res.status(400).json({ error: "playerId and label required" });
  const safeColor = ALLOWED_TAG_COLORS.includes(color) ? color : "#6b7280";
  const [tag] = await db.insert(playerTagsTable).values({
    playerId: parseInt(playerId),
    label: label.trim().slice(0, 30),
    color: safeColor,
    flagged: flagged === true,
    createdBy: session.username,
  }).returning();
  return res.json({ tag });
});

router.patch("/player-tags/:tagId", requireSecurityOrAbove, async (req, res) => {
  const tagId = parseInt(req.params.tagId as string);
  if (isNaN(tagId)) return res.status(400).json({ error: "Invalid tag ID" });
  const { label, color, flagged } = req.body;
  const updates: Record<string, any> = {};
  if (label?.trim()) updates.label = label.trim().slice(0, 30);
  if (color && ALLOWED_TAG_COLORS.includes(color)) updates.color = color;
  if (typeof flagged === "boolean") updates.flagged = flagged;
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Nothing to update" });
  const [tag] = await db.update(playerTagsTable).set(updates).where(eq(playerTagsTable.id, tagId)).returning();
  if (!tag) return res.status(404).json({ error: "Tag not found" });
  return res.json({ tag });
});

router.delete("/player-tags/:tagId", requireSecurityOrAbove, async (req, res) => {
  const tagId = parseInt(req.params.tagId as string);
  if (isNaN(tagId)) return res.status(400).json({ error: "Invalid tag ID" });
  await db.delete(playerTagsTable).where(eq(playerTagsTable.id, tagId));
  return res.json({ ok: true });
});

// ── Toggle login-log exclusion ────────────────────────────────────────────────

router.patch("/toggle-login-logs/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const [player] = await db.select({ id: playersTable.id, excludeFromLoginLogs: playersTable.excludeFromLoginLogs })
    .from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const newVal = !player.excludeFromLoginLogs;
  await db.update(playersTable).set({ excludeFromLoginLogs: newVal }).where(eq(playersTable.id, playerId));
  setLoginLogsExclusion(playerId, newVal);

  return res.json({ excludeFromLoginLogs: newVal });
});

// ── Flag / unflag a player ────────────────────────────────────────────────────

const VALID_SEVERITIES = ["LOW", "MED", "HIGH"];

router.post("/flag/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  const { reason, unflag, severity } = req.body;
  const session = (req as any).bankerSession;

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  if (unflag) {
    await db.update(playersTable).set({
      flagged: false,
      flagReason: null,
      flagSeverity: null,
      flaggedBy: null,
      flaggedAt: null,
    }).where(eq(playersTable.id, playerId));
    // Remove from flagged cache + reset presence debounce
    flaggedCache.delete(playerId);
    clearPresenceDebounce(playerId);
    return res.json({ success: true, flagged: false });
  }

  if (!reason?.trim()) return res.status(400).json({ error: "Reason required to flag a player." });
  const sev = VALID_SEVERITIES.includes(severity) ? severity : "MED";

  await db.update(playersTable).set({
    flagged: true,
    flagReason: reason.trim(),
    flagSeverity: sev,
    flaggedBy: session.username,
    flaggedAt: new Date(),
  }).where(eq(playersTable.id, playerId));

  // Update cache
  flaggedCache.set(playerId, { flagSeverity: sev });

  emitFlagEvent(playerId, player.username, session.username, reason.trim(), sev);

  return res.json({ success: true, flagged: true, reason: reason.trim(), severity: sev, by: session.username });
});

// ── Notes ─────────────────────────────────────────────────────────────────────

router.get("/notes/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  const notes = await db
    .select()
    .from(playerNotesTable)
    .where(eq(playerNotesTable.playerId, playerId))
    .orderBy(desc(playerNotesTable.createdAt));
  return res.json({ notes });
});

router.post("/note/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  const { content } = req.body;
  const session = (req as any).bankerSession;

  if (!content?.trim()) return res.status(400).json({ error: "Note content required." });

  const [player] = await db.select({ id: playersTable.id }).from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const [note] = await db.insert(playerNotesTable).values({
    playerId,
    staffId: session.accountId,
    staffUsername: session.username,
    content: content.trim(),
  }).returning();

  return res.json({ success: true, note });
});

router.delete("/note/:noteId", requireSecurityOrAbove, async (req, res) => {
  const noteId = parseInt(req.params.noteId as string);
  const session = (req as any).bankerSession;

  const [note] = await db.select().from(playerNotesTable).where(eq(playerNotesTable.id, noteId));
  if (!note) return res.status(404).json({ error: "Note not found" });

  const canDelete = note.staffId === session.accountId || sessionHasRole(session, "owner", "banker", "pit_boss");
  if (!canDelete) return res.status(403).json({ error: "You can only delete your own notes." });

  await db.delete(playerNotesTable).where(eq(playerNotesTable.id, noteId));
  return res.json({ success: true });
});

// ── Warnings (pit_boss and above only) ───────────────────────────────────────

router.post("/warn/:playerId", requirePitBossOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  const { reason } = req.body;
  const session = (req as any).bankerSession;

  if (!reason?.trim()) return res.status(400).json({ error: "Reason required to issue a warning." });

  const [player] = await db.select({ id: playersTable.id, username: playersTable.username }).from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const [warning] = await db.insert(playerWarningsTable).values({
    playerId,
    staffId: session.accountId,
    staffUsername: session.username,
    reason: reason.trim(),
  }).returning();

  emitWarnEvent(playerId, player.username, session.username, reason.trim());

  return res.json({ success: true, warning });
});

router.delete("/warn/:warningId", requirePitBossOrAbove, async (req, res) => {
  const warningId = parseInt(req.params.warningId as string);
  if (isNaN(warningId)) return res.status(400).json({ error: "Invalid warning ID" });
  const [warning] = await db.select().from(playerWarningsTable).where(eq(playerWarningsTable.id, warningId));
  if (!warning) return res.status(404).json({ error: "Warning not found" });
  await db.delete(playerWarningsTable).where(eq(playerWarningsTable.id, warningId));
  return res.json({ success: true });
});

// ── Game bans (pit_boss and above only) ──────────────────────────────────────

const VALID_GAMES = ["blackjack", "slots", "roulette", "crash", "poker", "horse-racing", "all"];

router.post("/game-ban/:playerId", requirePitBossOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  const { game, reason, durationHours } = req.body;
  const session = (req as any).bankerSession;

  if (!VALID_GAMES.includes(game)) {
    return res.status(400).json({ error: `Invalid game. Must be one of: ${VALID_GAMES.join(", ")}` });
  }
  if (!reason?.trim()) return res.status(400).json({ error: "Reason required for game ban." });

  const [player] = await db.select({ id: playersTable.id, username: playersTable.username }).from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const hours = durationHours ? parseInt(durationHours) : null;
  const expiresAt = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;

  const [ban] = await db.insert(playerGameBansTable).values({
    playerId,
    game,
    staffId: session.accountId,
    staffUsername: session.username,
    reason: reason.trim(),
    expiresAt,
  }).returning();

  emitBanEvent(playerId, player.username, session.username, game, reason.trim());

  return res.json({ success: true, ban });
});

router.delete("/game-ban/:banId", requirePitBossOrAbove, async (req, res) => {
  const banId = parseInt(req.params.banId as string);
  const session = (req as any).bankerSession;

  const [ban] = await db.select().from(playerGameBansTable).where(eq(playerGameBansTable.id, banId));
  if (!ban) return res.status(404).json({ error: "Ban not found" });

  await db.update(playerGameBansTable).set({
    lifted: true,
    liftedBy: session.username,
  }).where(eq(playerGameBansTable.id, banId));

  return res.json({ success: true });
});

// ── Flagged players list ──────────────────────────────────────────────────────

router.get("/flagged", requireSecurityOrAbove, async (_req, res) => {
  const flagged = await db
    .select({
      id: playersTable.id,
      username: playersTable.username,
      chips: playersTable.chips,
      avatarUrl: playersTable.avatarUrl,
      flagReason: playersTable.flagReason,
      flagSeverity: playersTable.flagSeverity,
      flaggedBy: playersTable.flaggedBy,
      flaggedAt: playersTable.flaggedAt,
      securityPhotos: playersTable.securityPhotos,
    })
    .from(playersTable)
    .where(eq(playersTable.flagged, true))
    .orderBy(desc(playersTable.flaggedAt));
  return res.json({ players: flagged });
});

// ── Player's own active bans ──────────────────────────────────────────────────

router.get("/my-bans", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const now = new Date();
  const bans = await db
    .select()
    .from(playerGameBansTable)
    .where(
      and(
        eq(playerGameBansTable.playerId, playerId),
        eq(playerGameBansTable.lifted, false),
      )
    );
  const activeBans = bans.filter((b) => !b.expiresAt || b.expiresAt > now);
  return res.json({ bans: activeBans });
});

// ── Security photo upload ─────────────────────────────────────────────────────
// POST /security/photo/:playerId — raw binary body, Content-Type: image/*
// Same pattern as /api/players/:id/avatar/upload (proven to work through Vite proxy)
router.post(
  "/photo/:playerId",
  requireSecurityOrAbove,
  express.raw({ type: Object.keys(ALLOWED_IMAGE_TYPES), limit: "8mb" }),
  async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId as string);
      if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

      const contentType = (req.headers["content-type"] ?? "").split(";")[0].trim();
      const ext = ALLOWED_IMAGE_TYPES[contentType];
      if (!ext) return res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, GIF, or WebP." });

      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: "No image data received." });

      const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
      if (!player) return res.status(404).json({ error: "Player not found" });

      const filename = `${randomUUID()}.${ext}`;
      const filePath = path.join(SECURITY_PHOTOS_DIR, filename);
      await fs.writeFile(filePath, body);

      const photoUrl = `/api/uploads/security-photos/${filename}`;
      const photos = parseSecurityPhotos(player.securityPhotos);
      photos.push(photoUrl);

      const [updated] = await db
        .update(playersTable)
        .set({ securityPhotos: JSON.stringify(photos) })
        .where(eq(playersTable.id, playerId))
        .returning();

      return res.json({ photos: parseSecurityPhotos(updated.securityPhotos) });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Upload failed" });
    }
  }
);

// ── Add security photo by URL ─────────────────────────────────────────────────
// POST /security/photo/:playerId/url — body: { photoUrl }
router.post("/photo/:playerId/url", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { photoUrl } = req.body as { photoUrl?: string };
  if (!photoUrl?.trim()) return res.status(400).json({ error: "photoUrl is required" });

  try { new URL(photoUrl); } catch { return res.status(400).json({ error: "Invalid URL" }); }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const photos = parseSecurityPhotos(player.securityPhotos);
  if (photos.includes(photoUrl)) return res.status(400).json({ error: "Photo URL already added" });
  photos.push(photoUrl);

  const [updated] = await db
    .update(playersTable)
    .set({ securityPhotos: JSON.stringify(photos) })
    .where(eq(playersTable.id, playerId))
    .returning();

  return res.json({ photos: parseSecurityPhotos(updated.securityPhotos) });
});

// ── Delete a security photo ───────────────────────────────────────────────────
// DELETE /security/photo/:playerId — body: { photoUrl }
router.delete("/photo/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { photoUrl } = req.body as { photoUrl?: string };
  if (!photoUrl) return res.status(400).json({ error: "photoUrl is required" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const photos = parseSecurityPhotos(player.securityPhotos).filter((p) => p !== photoUrl);

  const [updated] = await db
    .update(playersTable)
    .set({ securityPhotos: JSON.stringify(photos) })
    .where(eq(playersTable.id, playerId))
    .returning();

  // Delete from disk
  try {
    const filename = path.basename(photoUrl);
    await fs.unlink(path.join(SECURITY_PHOTOS_DIR, filename));
  } catch { /* ignore if already gone */ }

  return res.json({ photos: parseSecurityPhotos(updated.securityPhotos) });
});

// ── Set primary security photo ────────────────────────────────────────────────
// PATCH /security/photo/:playerId/primary — body: { photoUrl }
router.patch("/photo/:playerId/primary", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { photoUrl } = req.body as { photoUrl?: string };
  if (!photoUrl) return res.status(400).json({ error: "photoUrl is required" });

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const photos = parseSecurityPhotos(player.securityPhotos);
  const without = photos.filter((p) => p !== photoUrl);
  const reordered = [photoUrl, ...without];

  const [updated] = await db
    .update(playersTable)
    .set({ securityPhotos: JSON.stringify(reordered) })
    .where(eq(playersTable.id, playerId))
    .returning();

  return res.json({ photos: parseSecurityPhotos(updated.securityPhotos) });
});

// ── Security notes ─────────────────────────────────────────────────────────────
// PATCH /security/notes/:playerId — body: { notes }
router.patch("/notes/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { notes } = req.body as { notes?: string };
  if (typeof notes !== "string") return res.status(400).json({ error: "notes must be a string" });

  const [updated] = await db
    .update(playersTable)
    .set({ securityNotes: notes.trim() || null })
    .where(eq(playersTable.id, playerId))
    .returning();

  if (!updated) return res.status(404).json({ error: "Player not found" });
  return res.json({ securityNotes: updated.securityNotes });
});

// ── Patch flag (edit severity/reason in place without resetting flaggedAt/flaggedBy) ──
// PATCH /security/flag/:playerId — body: { severity, reason }
router.patch("/flag/:playerId", requireSecurityOrAbove, async (req, res) => {
  const playerId = parseInt(req.params.playerId as string);
  if (isNaN(playerId)) return res.status(400).json({ error: "Invalid player ID" });

  const { severity, reason } = req.body as { severity?: string; reason?: string };

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (!player.flagged) return res.status(400).json({ error: "Player is not flagged" });

  const validSeverities = ["LOW", "MED", "HIGH"];
  const sev = severity && validSeverities.includes(severity.toUpperCase())
    ? severity.toUpperCase()
    : player.flagSeverity;

  const updates: Record<string, unknown> = { flagSeverity: sev };
  if (typeof reason === "string" && reason.trim()) updates.flagReason = reason.trim();

  const [updated] = await db
    .update(playersTable)
    .set(updates)
    .where(eq(playersTable.id, playerId))
    .returning();

  emitFlagEvent(playerId, player.name, sev as "LOW" | "MED" | "HIGH");
  return res.json({ player: updated });
});

// ── isPlayerGameBanned ────────────────────────────────────────────────────────
export async function isPlayerGameBanned(playerId: number, game: string): Promise<{ banned: boolean; reason?: string }> {
  const now = new Date();
  const bans = await db
    .select()
    .from(playerGameBansTable)
    .where(
      and(
        eq(playerGameBansTable.playerId, playerId),
        eq(playerGameBansTable.lifted, false),
        or(
          eq(playerGameBansTable.game, game),
          eq(playerGameBansTable.game, "all")
        )
      )
    );

  const activeBan = bans.find((b) => !b.expiresAt || b.expiresAt > now);
  if (activeBan) return { banned: true, reason: activeBan.reason };
  return { banned: false };
}

// ── Recently Created Accounts ────────────────────────────────────────────────
router.get("/recent-accounts", requireSecurityOrAbove, async (_req, res) => {
  try {
    const result = await db.execute(sqlExpr`
      SELECT
        p.id,
        p.username,
        p.state_id            AS "stateId",
        p.phone_number        AS "phoneNumber",
        p.chips,
        p.created_at          AS "createdAt",
        p.referred_by         AS "referredBy",
        p.referred_by_code    AS "referredByCode",
        p.flag_severity       AS "flagSeverity",
        p.flag_reason         AS "flagReason",
        (SELECT amount FROM transactions
           WHERE player_id = p.id AND type = 'deposit'
           ORDER BY created_at ASC LIMIT 1)                              AS "firstDeposit",
        COALESCE((SELECT SUM(amount) FROM transactions
           WHERE player_id = p.id AND type = 'deposit'), 0)              AS "totalDeposits",
        COALESCE((SELECT SUM(amount) FROM transactions
           WHERE player_id = p.id AND type = 'withdrawal'), 0)           AS "totalWithdrawals",
        COALESCE((SELECT SUM(ABS(amount)) FROM transactions
           WHERE player_id = p.id AND type IN ('bet','loss','wager')), 0) AS "totalWagered",
        (SELECT c.code FROM promo_redemptions r
           JOIN promo_codes c ON c.id = r.code_id
           WHERE r.player_id = p.id
           ORDER BY r.redeemed_at ASC LIMIT 1)                           AS "promoCodeUsed",
        COALESCE((SELECT SUM(amount) FROM transactions
           WHERE player_id = p.id AND type = 'bonus'), 0)                AS "totalBonusChips"
      FROM players p
      ORDER BY p.created_at DESC NULLS LAST
    `);
    return res.json(result.rows ?? result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
