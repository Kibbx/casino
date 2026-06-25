import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import playersRouter from "./players.js";
import tablesRouter from "./tables.js";
import bankerRouter from "./banker.js";
import blackjackRouter from "./blackjack.js";
import slotsRouter from "./slots.js";
import rouletteRouter from "./roulette.js";
import storageRouter from "./storage.js";
import tournamentsRouter from "./tournaments.js";
import sportbetsRouter from "./sportbets.js";
import sportsbookRouter from "./sportsbook.js";
import crashRouter from "./crash.js";
import baccaratRouter from "./baccarat.js";
import securityRouter from "./security.js";
import promoRouter from "./promo.js";
import referralsRouter from "./referrals.js";
import horseRacingRouter from "./horse-racing.js";
import loansRouter from "./loans.js";
import ownerRouter from "./owner.js";
import prizesRouter from "./prizes.js";
import casesRouter from "./cases.js";
import minesRouter from "./mines.js";
import kenoRouter from "./keno.js";
import romeSlotsRouter from "./rome-slots.js";
import westernSlotsRouter from "./western-slots.js";
import rakebackRouter from "./rakeback.js";
import highlowRouter from "./high-low.js";
import mobTowerRouter from "./mob-tower.js";
import bingoRouter from "./bingo.js";
import lotteryRouter from "./lottery.js";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireBankerOrOwner } from "../middleware/auth.js";

const SERVER_START = Date.now();

const router: IRouter = Router();

// ── Version check — clients poll this to detect server restarts/deploys ────────
router.get("/version", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ version: SERVER_START });
});

// ── Public settings (no auth) ─────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({
    tournamentsEnabled: (map["tournamentsEnabled"] ?? "false") === "true",
  });
});

// ── Public slot bet limits (games fetch this; no auth required) ────────────────
const DEFAULT_SLOT_STEPS = [20, 40, 100, 200, 400, 1000, 2000, 5000];
function parseSlotSteps(raw: string | undefined, def: number[]): number[] {
  if (!raw) return def;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || !arr.length) return def;
    const nums = arr.map(Number).filter(n => n > 0 && Number.isInteger(n));
    return nums.length ? nums : def;
  } catch { return def; }
}
router.get("/slot-bet-limits", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({
    fortuna:      parseSlotSteps(map["fortunaBetSteps"],      DEFAULT_SLOT_STEPS),
    westernSlots: parseSlotSteps(map["westernSlotsBetSteps"], DEFAULT_SLOT_STEPS),
  });
});

// ── Game password tokens (public — no auth, no passwords exposed) ─────────────
router.get("/game-password-tokens", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  // Use || null so empty strings (from legacy set-password routes) are also treated as absent
  return res.json({
    blackjack:   map["blackjackPasswordToken"]  || null,
    slots:       map["slotsPasswordToken"]      || null,
    roulette:    map["roulettePasswordToken"]   || null,
    baccarat:    map["baccaratPasswordToken"]   || null,
    horseRacing: map["horsePasswordToken"]      || null,
    mines:       map["minesPasswordToken"]      || null,
    keno:        map["kenoPasswordToken"]       || null,
    highlow:     map["highlowPasswordToken"]    || null,
  });
});

router.use(healthRouter);
router.use("/players", playersRouter);
router.use("/tables", tablesRouter);
router.use("/tournaments", tournamentsRouter);
router.use("/banker", bankerRouter);
router.use("/blackjack", blackjackRouter);
router.use("/slots", slotsRouter);
router.use("/roulette", rouletteRouter);
router.use("/storage", storageRouter);
router.use("/sportbets",  sportbetsRouter);
router.use("/sportsbook", sportsbookRouter);
router.use("/crash", crashRouter);
router.use("/baccarat", baccaratRouter);
router.use("/security", securityRouter);
router.use("/promo", promoRouter);
router.use("/admin/referrals", referralsRouter);
router.use(horseRacingRouter);
router.use(loansRouter);
router.use("/owner", ownerRouter);
router.use(prizesRouter);
router.use(casesRouter);
router.use("/mines", minesRouter);
router.use("/keno", kenoRouter);
router.use("/rome-slots", romeSlotsRouter);
router.use("/western-slots", westernSlotsRouter);
router.use("/rakeback", rakebackRouter);
router.use("/high-low", highlowRouter);
router.use("/mob-tower", mobTowerRouter);
router.use("/bingo", bingoRouter);
router.use("/lottery", lotteryRouter);

// ── Player self-service kill switches (Banker-accessible) ──────────────────────
router.get("/settings/player-controls", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return res.json({
    promoCodesEnabled:     (map["promoCodesEnabled"]     ?? "true") === "true",
    referralCodesEnabled:  (map["referralCodesEnabled"]  ?? "true") === "true",
    playerTransfersEnabled:(map["playerTransfersEnabled"] ?? "true") === "true",
  });
});

router.post("/settings/player-controls", requireBankerOrOwner, async (req, res) => {
  const { promoCodesEnabled, referralCodesEnabled, playerTransfersEnabled } = req.body ?? {};
  const updates: [string, boolean][] = [];
  if (typeof promoCodesEnabled     === "boolean") updates.push(["promoCodesEnabled",     promoCodesEnabled]);
  if (typeof referralCodesEnabled  === "boolean") updates.push(["referralCodesEnabled",  referralCodesEnabled]);
  if (typeof playerTransfersEnabled=== "boolean") updates.push(["playerTransfersEnabled",playerTransfersEnabled]);

  for (const [key, val] of updates) {
    const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
    if (existing.length > 0) {
      await db.update(settingsTable).set({ value: val ? "true" : "false" }).where(eq(settingsTable.key, key));
    } else {
      await db.insert(settingsTable).values({ key, value: val ? "true" : "false" });
    }
  }

  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return res.json({
    promoCodesEnabled:     (map["promoCodesEnabled"]     ?? "true") === "true",
    referralCodesEnabled:  (map["referralCodesEnabled"]  ?? "true") === "true",
    playerTransfersEnabled:(map["playerTransfersEnabled"] ?? "true") === "true",
  });
});

export default router;
