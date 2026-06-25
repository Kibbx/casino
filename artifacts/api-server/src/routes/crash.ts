import { Router } from "express";
import { db, playersTable, settingsTable, transactionsTable, crashGamesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance, broadcastPlayerBalanceDelayed } from "../lib/table-ws.js";
import bcrypt from "bcryptjs";
import { isPlayerGameBanned } from "./security.js";
import { recordPlayerActivity } from "../lib/player-activity.js";

const router = Router();

// Quadratic exponent: m = exp(A*t + B*t²), t in seconds
// Starts slow, accelerates heavily as it rises
const CRASH_A = 0.04;
const CRASH_B = 0.001;
const MAX_MULTIPLIER = 200;

function getMultiplier(elapsedMs: number): number {
  const t = elapsedMs / 1000;
  return Math.exp(CRASH_A * t + CRASH_B * t * t);
}

function generateCrashPoint(survivalRate: number): number {
  // Clamp survival rate to [0.75, 0.99] for safety
  const sr = Math.max(0.75, Math.min(0.99, survivalRate));
  const r = Math.random();
  // P(crash_point > x) = sr/x; rounds where r >= sr crash instantly at 1.0x
  const raw = sr / r;
  return Math.max(1.0, Math.min(MAX_MULTIPLIER, parseFloat(raw.toFixed(2))));
}

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

// GET /crash/status — public
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("crashEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("crashMinBet", "50"));
  const maxBet = parseInt(await getSetting("crashMaxBet", "10000"));
  const hasPassword = !!(await getSetting("crashPassword", ""));
  res.json({ enabled, minBet, maxBet, hasPassword });
});

// POST /crash/verify-password
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("crashPassword", "");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("crashPasswordToken", "");
  return res.json({ valid: true, token: token || null });
});

// GET /crash/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("crashEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("crashMinBet", "50"));
  const maxBet = parseInt(await getSetting("crashMaxBet", "10000"));
  res.json({ enabled, minBet, maxBet });
});

// POST /crash/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  await setSetting("crashEnabled", String(!!enabled));
  await setSetting("crashMinBet", String(minBet ?? 50));
  await setSetting("crashMaxBet", String(maxBet ?? 10000));
  res.json({ enabled: !!enabled, minBet: minBet ?? 50, maxBet: maxBet ?? 10000 });
});

// POST /crash/set-password — banker only
router.post("/set-password", requireBanker, async (req, res) => {
  const { password } = req.body;
  if (!password) {
    await setSetting("crashPassword", "");
    await setSetting("crashPasswordToken", "");
    return res.json({ hasPassword: false });
  }
  const hash = await bcrypt.hash(password, 10);
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  await setSetting("crashPassword", hash);
  await setSetting("crashPasswordToken", token);
  return res.json({ hasPassword: true });
});

// POST /crash/play — player only, starts a round
router.post("/play", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const banCheck = await isPlayerGameBanned(playerId, "crash");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Crash${banCheck.reason ? ": " + banCheck.reason : ""}` });
  const { bet } = req.body;

  if (!bet || bet <= 0) return res.status(400).json({ error: "bet is required" });

  const enabled = (await getSetting("crashEnabled", "false")) === "true";
  if (!enabled) return res.status(403).json({ error: "Crash is currently closed" });

  const minBet = parseInt(await getSetting("crashMinBet", "50"));
  const maxBet = parseInt(await getSetting("crashMaxBet", "10000"));
  if (bet < minBet || bet > maxBet) {
    return res.status(400).json({ error: `Bet must be between ${minBet} and ${maxBet} chips` });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });
  recordPlayerActivity(playerId, player.username, "crash", true);

  // Deduct bet immediately
  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Crash bet" });
  db.execute(sql`UPDATE players SET hands_played = hands_played + 1 WHERE id = ${playerId}`).catch(console.error);

  // Generate crash point using house edge setting
  const houseEdgePct = parseFloat(await getSetting("crashHouseEdgePct", "10"));
  const survivalRate = 1 - Math.max(1, Math.min(25, houseEdgePct)) / 100;
  const crashPoint = generateCrashPoint(survivalRate);

  const [game] = await db.insert(crashGamesTable).values({
    playerId,
    bet,
    crashPoint,
    status: "playing",
    startedAt: new Date(),
  }).returning();

  return res.json({ gameId: game.id, minBet, maxBet, startedAtMs: game.startedAt.getTime(), serverNowMs: Date.now() });
});

// POST /crash/:gameId/cashout — player cashes out
router.post("/:gameId/cashout", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const gameId = parseInt(req.params.gameId);

  const [game] = await db.select().from(crashGamesTable).where(eq(crashGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });
  if (game.status !== "playing") {
    return res.json({ status: game.status, cashoutMultiplier: game.cashoutMultiplier, payout: game.payout, crashPoint: game.crashPoint });
  }

  const elapsed = Date.now() - new Date(game.startedAt).getTime();
  const currentMultiplier = getMultiplier(elapsed);

  if (currentMultiplier >= game.crashPoint) {
    // Already crashed
    await db.update(crashGamesTable).set({ status: "crashed", payout: 0 }).where(eq(crashGamesTable.id, gameId));
    return res.json({ status: "crashed", cashoutMultiplier: null, payout: 0, crashPoint: game.crashPoint });
  }

  // Successful cashout
  const multiplier = parseFloat(currentMultiplier.toFixed(2));
  const payout = Math.floor(game.bet * multiplier);

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player) {
    await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Crash cashout at ${multiplier}x` });
    broadcastPlayerBalanceDelayed(playerId, player.chips + payout, 1500);
  }

  await db.update(crashGamesTable).set({ status: "cashed_out", cashoutMultiplier: multiplier, payout }).where(eq(crashGamesTable.id, gameId));

  // Track rake
  const rake = game.bet - Math.floor(game.bet / multiplier);
  if (rake > 0) {
    const current = parseInt(await getSetting("totalRakeCollected", "0"));
    await setSetting("totalRakeCollected", String(current + rake));
  }

  return res.json({ status: "cashed_out", cashoutMultiplier: multiplier, payout, crashPoint: game.crashPoint });
});

// GET /crash/:gameId/result — reveal result (for when round expires)
router.get("/:gameId/result", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const gameId = parseInt(req.params.gameId);

  const [game] = await db.select().from(crashGamesTable).where(eq(crashGamesTable.id, gameId));
  if (!game) return res.status(404).json({ error: "Game not found" });
  if (game.playerId !== playerId) return res.status(403).json({ error: "Not your game" });

  // If still playing, check if time has expired
  if (game.status === "playing") {
    const elapsed = Date.now() - new Date(game.startedAt).getTime();
    const currentMultiplier = getMultiplier(elapsed);
    if (currentMultiplier >= game.crashPoint) {
      await db.update(crashGamesTable).set({ status: "crashed", payout: 0 }).where(eq(crashGamesTable.id, gameId));
      return res.json({ status: "crashed", cashoutMultiplier: null, payout: 0, crashPoint: game.crashPoint });
    }
  }

  return res.json({ status: game.status, cashoutMultiplier: game.cashoutMultiplier, payout: game.payout, crashPoint: game.crashPoint });
});

export default router;
