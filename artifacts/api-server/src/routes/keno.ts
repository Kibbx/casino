import { Router } from "express";
import { randomInt } from "crypto";
import { db, playersTable, settingsTable, transactionsTable, kenoGamesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { isPlayerGameBanned } from "./security.js";
import { recordPlayerActivity } from "../lib/player-activity.js";

const router = Router();

// ── Multiplier table (server-authoritative) ───────────────────────────────────
// PAYTABLE[pickCount][hits] = multiplier
// Partial hits pay average/modest amounts; high hit counts pay very well.
const PAYTABLE: Record<number, Record<number, number>> = {
  1:  { 1: 3 },
  2:  { 2: 13 },
  3:  { 2: 2,  3: 35 },
  4:  { 3: 3,  4: 60 },
  5:  { 4: 8,  5: 120 },
  6:  { 5: 10, 6: 300 },
  7:  { 5: 4,  6: 60,  7: 1000 },
  8:  { 6: 10, 7: 130, 8: 3500 },
  9:  { 7: 40, 8: 500, 9: 1000 },
  10: { 5: 2,  6: 8,  7: 30,  8: 200, 9: 1000, 10: 5000 },
};

const MAX_PAYOUT = 10_000_000;

// ── Settings helpers ──────────────────────────────────────────────────────────

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

// ── RNG — draw 20 unique numbers from 1–80 ───────────────────────────────────

function drawKeno(): number[] {
  const pool: number[] = [];
  for (let i = 1; i <= 80; i++) pool.push(i);
  // Fisher-Yates using crypto.randomInt
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 20).sort((a, b) => a - b);
}

// ── Rate limiting — 1 play per 500ms per player ───────────────────────────────
const lastPlayMs = new Map<number, number>();

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /keno/status — public (lobby)
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("kenoEnabled", "false")) === "true";
  const minBet   = parseInt(await getSetting("kenoMinBet", "100"));
  const maxBet   = parseInt(await getSetting("kenoMaxBet", "50000"));
  const pwHash   = await getSetting("kenoPassword");
  res.json({ enabled, minBet, maxBet, hasPassword: !!pwHash });
});

// POST /keno/verify-password — public room code check
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("kenoPassword");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("kenoPasswordToken");
  return res.json({ valid: true, token: token || null });
});

// GET /keno/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("kenoEnabled", "false")) === "true";
  const minBet  = parseInt(await getSetting("kenoMinBet", "100"));
  const maxBet  = parseInt(await getSetting("kenoMaxBet", "50000"));
  res.json({ enabled, minBet, maxBet });
});

// POST /keno/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  await setSetting("kenoEnabled", String(!!enabled));
  await setSetting("kenoMinBet",  String(parseInt(minBet)  || 100));
  await setSetting("kenoMaxBet",  String(parseInt(maxBet)  || 50000));
  res.json({ enabled: !!enabled, minBet: parseInt(minBet) || 100, maxBet: parseInt(maxBet) || 50000 });
});

// POST /keno/play — play a round
router.post("/play", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  // Rate limit
  const now = Date.now();
  const last = lastPlayMs.get(playerId) ?? 0;
  if (now - last < 500) return res.status(429).json({ error: "Too fast — slow down" });
  lastPlayMs.set(playerId, now);

  const banCheck = await isPlayerGameBanned(playerId, "keno");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Keno${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const enabled = (await getSetting("kenoEnabled", "false")) === "true";
  if (!enabled) return res.status(403).json({ error: "Keno is currently closed" });

  const minBet = parseInt(await getSetting("kenoMinBet", "100"));
  const maxBet = parseInt(await getSetting("kenoMaxBet", "50000"));

  const { bet, picks, risk } = req.body;

  // Validate bet
  if (!bet || !Number.isInteger(bet) || bet <= 0)
    return res.status(400).json({ error: "Invalid bet" });
  if (bet < minBet || bet > maxBet)
    return res.status(400).json({ error: `Bet must be between ${minBet.toLocaleString()} and ${maxBet.toLocaleString()} chips` });

  // Validate picks
  if (!Array.isArray(picks) || picks.length < 1 || picks.length > 10)
    return res.status(400).json({ error: "Pick between 1 and 10 numbers" });
  const pickSet = new Set<number>();
  for (const p of picks) {
    if (!Number.isInteger(p) || p < 1 || p > 80)
      return res.status(400).json({ error: "Picks must be integers between 1 and 80" });
    pickSet.add(p);
  }
  if (pickSet.size !== picks.length)
    return res.status(400).json({ error: "Duplicate picks not allowed" });

  // Load player
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  recordPlayerActivity(playerId, player.username, "keno", true);

  // Deduct bet immediately
  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Keno bet" });

  // Draw numbers (server-side, crypto RNG)
  const drawn = drawKeno();

  // Count hits
  const hits = picks.filter((p: number) => drawn.includes(p)).length;

  // Look up multiplier by pick count and hits
  const multiplier = PAYTABLE[picks.length]?.[hits] ?? 0;
  const rawPayout = multiplier > 0 ? Math.floor(bet * multiplier) : 0;
  const payout = Math.min(rawPayout, MAX_PAYOUT);

  // Credit payout if won
  if (payout > 0) {
    await db.update(playersTable).set({ chips: player.chips - bet + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Keno win (${hits}/${picks.length} hits, ${multiplier}x)` });
  }

  // Record game for house tracking
  await db.insert(kenoGamesTable).values({
    playerId,
    bet,
    risk: "standard",
    picks: JSON.stringify([...pickSet].sort((a, b) => a - b)),
    drawn: JSON.stringify(drawn),
    hits,
    multiplier,
    payout,
  });

  // Update house finances
  const rake = bet - payout;
  if (rake !== 0) {
    await db.execute(
      sql`INSERT INTO house_finances (type, amount, description, created_at)
          VALUES ('keno', ${rake}, 'Keno round', NOW())`
    ).catch(() => {});
  }

  broadcastPlayerBalance(playerId, player.chips - bet + payout);

  return res.json({
    drawn,
    hits,
    multiplier,
    payout,
    newChips: player.chips - bet + payout,
    minBet,
    maxBet,
  });
});

export default router;
