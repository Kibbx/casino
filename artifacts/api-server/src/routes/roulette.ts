import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { BET_PAYOUTS } from "../lib/roulette-engine.js";
import type { WheelType } from "../lib/roulette-engine.js";
import { requireBanker } from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import { initRouletteRoom, pauseRouletteRoom } from "../lib/roulette-room.js";

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

// GET /roulette/status — public
router.get("/status", async (_req, res) => {
  const enabled = (await getSetting("rouletteEnabled", "true")) === "true";
  const wheelType = (await getSetting("rouletteType", "european")) as WheelType;
  const minBet = parseInt(await getSetting("rouletteMinBet", "50"));
  const maxBet = parseInt(await getSetting("rouletteMaxBet", "5000"));
  const maxBetsPerSpin = parseInt(await getSetting("rouletteMaxBetsPerSpin", "0"));
  const passwordHash = await getSetting("roulettePassword", "");
  res.json({ enabled, wheelType, minBet, maxBet, maxBetsPerSpin, hasPassword: !!passwordHash, payouts: BET_PAYOUTS });
});

// POST /roulette/verify-password — check room password
router.post("/verify-password", async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: "Password required" });
  const hash = await getSetting("roulettePassword", "");
  if (!hash) return res.json({ valid: true, token: null });
  const valid = await bcrypt.compare(password, hash);
  if (!valid) return res.status(403).json({ error: "Incorrect room password" });
  const token = await getSetting("roulettePasswordToken", "");
  return res.json({ valid: true, token: token || null });
});

// GET /roulette/banker-settings — banker only
router.get("/banker-settings", requireBanker, async (_req, res) => {
  const enabled = (await getSetting("rouletteEnabled", "true")) === "true";
  const wheelType = await getSetting("rouletteType", "european");
  const minBet = parseInt(await getSetting("rouletteMinBet", "50"));
  const maxBet = parseInt(await getSetting("rouletteMaxBet", "5000"));
  const maxBetsPerSpin = parseInt(await getSetting("rouletteMaxBetsPerSpin", "0"));
  res.json({ enabled, wheelType, minBet, maxBet, maxBetsPerSpin });
});

// POST /roulette/banker-settings — banker only
router.post("/banker-settings", requireBanker, async (req, res) => {
  const { enabled, wheelType, minBet, maxBet, maxBetsPerSpin } = req.body;
  const isEnabled = !!enabled;
  await setSetting("rouletteEnabled", String(isEnabled));
  await setSetting("rouletteType", wheelType === "american" ? "american" : "european");
  await setSetting("rouletteMinBet", String(minBet ?? 50));
  await setSetting("rouletteMaxBet", String(maxBet ?? 5000));
  await setSetting("rouletteMaxBetsPerSpin", String(Math.max(0, parseInt(maxBetsPerSpin) || 0)));
  const savedMaxBetsPerSpin = Math.max(0, parseInt(maxBetsPerSpin) || 0);

  // Wake up or pause the room immediately so players see the change without waiting
  if (isEnabled) {
    initRouletteRoom().catch(console.error);
  } else {
    pauseRouletteRoom().catch(console.error);
  }

  res.json({ enabled: isEnabled, wheelType: wheelType ?? "european", minBet: minBet ?? 50, maxBet: maxBet ?? 5000, maxBetsPerSpin: savedMaxBetsPerSpin });
});

export default router;
