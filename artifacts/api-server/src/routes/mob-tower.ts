import { Router } from "express";
import { randomInt } from "crypto";
import { db, playersTable, settingsTable, transactionsTable, mobTowerGamesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requirePlayer, requireBanker } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";
import { isPlayerGameBanned } from "./security.js";
import { recordPlayerActivity } from "../lib/player-activity.js";
import { trackRakebackBet, trackRakebackWin } from "../lib/rakeback.js";

const router = Router();

const FLOORS = 8;
const TILES = 3;

const MULTS = [1.0, 1.46, 2.18, 3.27, 4.91, 7.37, 11.05, 16.57, 24.86];

function calcMultiplier(floorsCleared: number): number {
  return MULTS[floorsCleared] ?? MULTS[MULTS.length - 1];
}

function generateBustTiles(): number[] {
  return Array.from({ length: FLOORS }, () => randomInt(0, TILES));
}

async function getSetting(key: string, fallback = ""): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

async function setSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) await db.insert(settingsTable).values({ key, value });
  else await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
}

const realRatioCache = new Map<number, number>();

const DEFAULT_BET_STEPS = [100, 250, 500, 1000];

function parseBetSteps(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_BET_STEPS;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return DEFAULT_BET_STEPS;
    const nums = arr.map(Number).filter(n => n > 0 && Number.isInteger(n));
    return nums.length ? nums : DEFAULT_BET_STEPS;
  } catch { return DEFAULT_BET_STEPS; }
}

function validateBetSteps(steps: unknown): { ok: true; steps: number[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: "Steps must be an array" };
  if (steps.length < 1 || steps.length > 12) return { ok: false, error: "Steps must have 1–12 values" };
  const nums = steps.map(Number);
  if (nums.some(n => !Number.isInteger(n) || n <= 0)) return { ok: false, error: "All steps must be positive integers" };
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) return { ok: false, error: "Steps must be strictly ascending" };
  }
  return { ok: true, steps: nums };
}

router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("mobTowerEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("mobTowerMinBet", "100"));
  const maxBet = parseInt(await getSetting("mobTowerMaxBet", "50000"));
  const betSteps = parseBetSteps(await getSetting("mobTowerBetSteps"));
  res.json({ enabled, minBet, maxBet, betSteps });
});

router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("mobTowerEnabled", "false")) === "true";
  const minBet = parseInt(await getSetting("mobTowerMinBet", "100"));
  const maxBet = parseInt(await getSetting("mobTowerMaxBet", "50000"));
  const betSteps = parseBetSteps(await getSetting("mobTowerBetSteps"));
  res.json({ enabled, minBet, maxBet, betSteps });
});

router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet, betSteps } = req.body;
  await setSetting("mobTowerEnabled", String(!!enabled));
  await setSetting("mobTowerMinBet", String(parseInt(minBet) || 100));
  await setSetting("mobTowerMaxBet", String(parseInt(maxBet) || 50000));
  if (betSteps !== undefined) {
    const v = validateBetSteps(betSteps);
    if (!v.ok) return res.status(400).json({ error: v.error });
    await setSetting("mobTowerBetSteps", JSON.stringify(v.steps));
  }
  const stepsOut = parseBetSteps(await getSetting("mobTowerBetSteps"));
  const mn = parseInt(minBet) || 100;
  const mx = parseInt(maxBet) || 50000;
  res.json({ enabled: !!enabled, minBet: mn, maxBet: mx, betSteps: stepsOut });
});

router.get("/active", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [game] = await db.select().from(mobTowerGamesTable)
    .where(and(eq(mobTowerGamesTable.playerId, playerId), eq(mobTowerGamesTable.status, "playing")));
  if (!game) return res.json({ game: null });
  return res.json({
    game: {
      id: game.id,
      bet: game.bet,
      currentFloor: game.currentFloor,
      multiplier: calcMultiplier(game.currentFloor),
    }
  });
});

router.post("/start", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const banCheck = await isPlayerGameBanned(playerId, "mob-tower");
  if (banCheck.banned) return res.status(403).json({ error: `You are banned from Mob Tower${banCheck.reason ? ": " + banCheck.reason : ""}` });

  const enabled = (await getSetting("mobTowerEnabled", "false")) === "true";
  if (!enabled) return res.status(403).json({ error: "Mob Tower is currently closed" });

  const minBet = parseInt(await getSetting("mobTowerMinBet", "100"));
  const maxBet = parseInt(await getSetting("mobTowerMaxBet", "50000"));

  const { bet } = req.body;
  if (!bet || bet < minBet || bet > maxBet)
    return res.status(400).json({ error: `Bet must be between ${minBet.toLocaleString()} and ${maxBet.toLocaleString()} chips` });

  const [existing] = await db.select().from(mobTowerGamesTable)
    .where(and(eq(mobTowerGamesTable.playerId, playerId), eq(mobTowerGamesTable.status, "playing")));
  if (existing) {
    return res.status(409).json({
      error: "active_game",
      activeGame: { gameId: existing.id, bet: existing.bet, currentFloor: existing.currentFloor, multiplier: calcMultiplier(existing.currentFloor), minBet, maxBet },
    });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });
  if (player.chips < bet) return res.status(400).json({ error: "Insufficient chips" });

  recordPlayerActivity(playerId, player.username, "mob-tower", true);

  await db.update(playersTable).set({ chips: player.chips - bet }).where(eq(playersTable.id, playerId));
  await db.insert(transactionsTable).values({ playerId, amount: bet, type: "loss", description: "Mob Tower bet" });

  const realRatio = await trackRakebackBet(playerId, bet);
  realRatioCache.set(playerId, realRatio);

  const bustTiles = generateBustTiles();
  const [game] = await db.insert(mobTowerGamesTable).values({
    playerId, bet, floorSafes: JSON.stringify(bustTiles), currentFloor: 0, status: "playing", payout: 0,
  }).returning();

  broadcastPlayerBalance(playerId, player.chips - bet);

  return res.json({ gameId: game.id, bet, currentFloor: 0, multiplier: 1.0, minBet, maxBet });
});

router.post("/pick", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { tileIndex } = req.body;

  if (typeof tileIndex !== "number" || tileIndex < 0 || tileIndex >= TILES)
    return res.status(400).json({ error: "Invalid tile index" });

  const [game] = await db.select().from(mobTowerGamesTable)
    .where(and(eq(mobTowerGamesTable.playerId, playerId), eq(mobTowerGamesTable.status, "playing")));
  if (!game) return res.status(400).json({ error: "No active game" });

  const bustTiles: number[] = JSON.parse(game.floorSafes);
  const bustIndex = bustTiles[game.currentFloor];
  const isBust = tileIndex === bustIndex;

  if (isBust) {
    await db.update(mobTowerGamesTable).set({ status: "lost", payout: 0 }).where(eq(mobTowerGamesTable.id, game.id));
    realRatioCache.delete(playerId);
    return res.json({ result: "bust", tileIndex, bustIndex, floor: game.currentFloor, allBustTiles: bustTiles });
  }

  const newFloor = game.currentFloor + 1;
  const multiplier = calcMultiplier(newFloor);

  if (newFloor >= FLOORS) {
    const payout = Math.floor(game.bet * multiplier);
    await db.update(mobTowerGamesTable).set({ status: "cashed_out", currentFloor: newFloor, payout }).where(eq(mobTowerGamesTable.id, game.id));
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (player) {
      await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
      await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Mob Tower all floors cleared ×${multiplier}` });
      await trackRakebackWin(playerId, payout, realRatioCache.get(playerId) ?? 0);
      realRatioCache.delete(playerId);
      broadcastPlayerBalance(playerId, player.chips + payout);
    }
    return res.json({ result: "safe", complete: true, tileIndex, bustIndex, floor: game.currentFloor, newFloor, multiplier, payout, allBustTiles: bustTiles });
  }

  await db.update(mobTowerGamesTable).set({ currentFloor: newFloor }).where(eq(mobTowerGamesTable.id, game.id));
  return res.json({ result: "safe", complete: false, tileIndex, bustIndex, floor: game.currentFloor, newFloor, multiplier });
});

router.post("/cashout", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [game] = await db.select().from(mobTowerGamesTable)
    .where(and(eq(mobTowerGamesTable.playerId, playerId), eq(mobTowerGamesTable.status, "playing")));
  if (!game) return res.status(400).json({ error: "No active game" });
  if (game.currentFloor === 0) return res.status(400).json({ error: "Clear at least one floor before cashing out" });

  const multiplier = calcMultiplier(game.currentFloor);
  const payout = Math.floor(game.bet * multiplier);

  await db.update(mobTowerGamesTable).set({ status: "cashed_out", payout }).where(eq(mobTowerGamesTable.id, game.id));
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (player) {
    await db.update(playersTable).set({ chips: player.chips + payout }).where(eq(playersTable.id, playerId));
    await db.insert(transactionsTable).values({ playerId, amount: payout, type: "win", description: `Mob Tower cashout floor ${game.currentFloor} ×${multiplier}` });
    await trackRakebackWin(playerId, payout, realRatioCache.get(playerId) ?? 0);
    realRatioCache.delete(playerId);
    broadcastPlayerBalance(playerId, player.chips + payout);
  }
  const bustTiles: number[] = JSON.parse(game.floorSafes);
  return res.json({ status: "cashed_out", multiplier, payout, allBustTiles: bustTiles });
});

export default router;
