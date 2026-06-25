import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireOwner } from "../middleware/auth.js";
import { resolveBankerSession } from "../lib/sessions.js";

const router = Router();

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

type OddsMode = "glacier" | "frozen" | "cold" | "cool" | "standard" | "warm" | "hot";
// ── Preset definitions ────────────────────────────────────────────────────────

export interface RTPPreset {
  id: string;
  name: string;
  description: string;
  color: string;
  targetRtp: string;
  settings: {
    blackjackOddsMode: OddsMode;
    rouletteOddsMode: OddsMode;
    crashHouseEdgePct: number;
  };
  estimatedRtp: {
    blackjack: number;
    roulette: number;
    crash: number;
  };
}

// oddsMode controls WIN PROBABILITY for BJ/Roulette/Slots — payouts stay fixed.
//   cold     → strong house-favoring outcomes
//   cool     → mild house-favoring outcomes
//   standard → normal probability (no bias)
//   warm     → mild player-favoring outcomes
//   hot      → strong player-favoring outcomes
const PRESETS: RTPPreset[] = [
  {
    id: "cold",
    name: "❄️ Cold",
    description: "Strong house edge — significantly biased toward the house",
    color: "red",
    targetRtp: "81–88%",
    settings: {
      blackjackOddsMode: "cold",
      rouletteOddsMode: "cold",
      crashHouseEdgePct: 15,
    },
    estimatedRtp: { blackjack: 94, roulette: 90, crash: 85 },
  },
  {
    id: "cool",
    name: "🌬️ Cool",
    description: "Light house edge — mild bias toward the house",
    color: "orange",
    targetRtp: "84–91%",
    settings: {
      blackjackOddsMode: "cool",
      rouletteOddsMode: "cool",
      crashHouseEdgePct: 12,
    },
    estimatedRtp: { blackjack: 95.8, roulette: 92.4, crash: 88 },
  },
  {
    id: "standard",
    name: "⚖️ Standard",
    description: "Normal probability — everyday operation, no bias",
    color: "green",
    targetRtp: "87–95%",
    settings: {
      blackjackOddsMode: "standard",
      rouletteOddsMode: "standard",
      crashHouseEdgePct: 10,
    },
    estimatedRtp: { blackjack: 97.5, roulette: 94.7, crash: 90 },
  },
  {
    id: "warm",
    name: "🌤️ Warm",
    description: "Player-friendly — mild bias toward the player",
    color: "blue",
    targetRtp: "90–96%",
    settings: {
      blackjackOddsMode: "warm",
      rouletteOddsMode: "warm",
      crashHouseEdgePct: 7,
    },
    estimatedRtp: { blackjack: 98.5, roulette: 95.5, crash: 93 },
  },
  {
    id: "hot",
    name: "🔥 Hot",
    description: "Player-favoring — strong bias toward the player",
    color: "yellow",
    targetRtp: "92–97%",
    settings: {
      blackjackOddsMode: "hot",
      rouletteOddsMode: "hot",
      crashHouseEdgePct: 5,
    },
    estimatedRtp: { blackjack: 99.5, roulette: 96.3, crash: 95 },
  },
];

const ODDS_MODES: OddsMode[] = ["glacier", "frozen", "cold", "cool", "standard", "warm", "hot"];

// ── Helpers: load preset settings from DB (with fallback to hardcoded defaults) ─

// ── RTP ↔ OddsMode mapping helpers ───────────────────────────────────────────

const BJ_RTP_MAP:       Record<string, number> = { glacier: 80, frozen: 87, cold: 94,   cool: 95.8, standard: 97.5, warm: 98.5, hot: 99.5 };
const ROULETTE_RTP_MAP: Record<string, number> = { glacier: 83, frozen: 87, cold: 90,   cool: 92.4, standard: 94.7, warm: 95.5, hot: 96.3 };
function nearestMode(pct: number, map: Record<string, number>): string {
  return Object.keys(map).reduce((best, k) =>
    Math.abs(map[k] - pct) < Math.abs(map[best] - pct) ? k : best
  );
}

async function loadPresets(): Promise<RTPPreset[]> {
  const rows = await db.execute(
    sql`SELECT key, value FROM settings WHERE key LIKE 'preset.%'`
  );
  const overrides: Record<string, string> = {};
  for (const row of (rows as any).rows ?? rows) {
    overrides[row.key] = row.value;
  }

  return PRESETS.map((p) => {
    const g  = (field: string, fallback: string | null) =>
      overrides[`preset.${p.id}.${field}`] ?? fallback;

    const name        = g("name", null) ?? p.name;
    const description = g("description", null) ?? p.description;

    // Raw RTP % values (stored directly by the new save-preset endpoint).
    // Fall back to the hardcoded defaults for each preset if no override exists.
    const bjRtp       = parseFloat(g("blackjackRtpPct", null) ?? String(p.estimatedRtp.blackjack));
    const roulRtp     = parseFloat(g("rouletteRtpPct",  null) ?? String(p.estimatedRtp.roulette));
    const crashRtp    = parseFloat(g("crashRtpPct",     null) ?? String(p.estimatedRtp.crash));

    // Derive the nearest odds mode from the stored raw % (used by apply-preset)
    const blackjackOddsMode = nearestMode(bjRtp,     BJ_RTP_MAP)       as OddsMode;
    const rouletteOddsMode  = nearestMode(roulRtp,   ROULETTE_RTP_MAP) as OddsMode;
    const crashHouseEdgePct = parseFloat(Math.max(1, Math.min(30, 100 - crashRtp)).toFixed(2));

    return {
      ...p,
      name,
      description,
      settings: { blackjackOddsMode, rouletteOddsMode, crashHouseEdgePct },
      estimatedRtp: {
        blackjack: bjRtp,
        roulette:  roulRtp,
        crash:     crashRtp,
      },
    };
  });
}

// ── GET /owner/rtp-presets ─────────────────────────────────────────────────────

router.get("/rtp-presets", requireOwner, async (req, res) => {
  const activePreset = await getSetting("owner.activePreset", "standard");

  const [[blackjackOddsMode, rouletteOddsMode, crashEdge, hotSpinsRaw,
          rawBjTemp, rawRoulTemp, rawCrashTemp,
          baccaratOddsMode, rawBaccTemp], presets, historyRows] = await Promise.all([
    Promise.all([
      getSetting("blackjackOddsMode", "standard"),
      getSetting("rouletteOddsMode", "standard"),
      getSetting("crashHouseEdgePct", "10"),
      getSetting("rouletteHotSpins", "0"),
      getSetting("sliderBjTemp",     ""),
      getSetting("sliderRoulTemp",   ""),
      getSetting("sliderCrashTemp",  ""),
      getSetting("baccaratOddsMode", "standard"),
      getSetting("sliderBaccTemp",   ""),
    ]),
    loadPresets(),
    db.execute(sql`SELECT preset_id, preset_name, applied_by, applied_at FROM owner_preset_history ORDER BY applied_at DESC LIMIT 10`),
  ]);

  return res.json({
    presets,
    activePreset,
    liveSettings: {
      blackjackOddsMode,
      rouletteOddsMode,
      baccaratOddsMode,
      crashHouseEdgePct: parseFloat(crashEdge),
      rouletteHotSpins: parseInt(hotSpinsRaw, 10) || 0,
      // Raw slider positions (null if never saved)
      sliderBjTemp:     rawBjTemp     ? parseFloat(rawBjTemp)     : null,
      sliderRoulTemp:   rawRoulTemp   ? parseFloat(rawRoulTemp)   : null,
      sliderCrashTemp:  rawCrashTemp  ? parseFloat(rawCrashTemp)  : null,
      sliderBaccTemp:   rawBaccTemp   ? parseFloat(rawBaccTemp)   : null,
    },
    history: (historyRows as any).rows ?? historyRows,
  });
});

// ── POST /owner/apply-preset ───────────────────────────────────────────────────

router.post("/apply-preset", requireOwner, async (req, res) => {
  const { presetId } = req.body;

  if (!presetId || typeof presetId !== "string") {
    return res.status(400).json({ error: "presetId required" });
  }

  // Load live preset (may include DB overrides the owner has saved)
  const presets = await loadPresets();
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) {
    return res.status(400).json({ error: `Unknown preset: ${presetId}` });
  }

  const s = preset.settings;
  if (!ODDS_MODES.includes(s.blackjackOddsMode)) return res.status(400).json({ error: "Invalid blackjackOddsMode in preset" });
  if (!ODDS_MODES.includes(s.rouletteOddsMode)) return res.status(400).json({ error: "Invalid rouletteOddsMode in preset" });
  if (s.crashHouseEdgePct < 1 || s.crashHouseEdgePct > 30) return res.status(400).json({ error: "crashHouseEdgePct out of safe range (1–30)" });

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = resolveBankerSession(token);
  const appliedBy = session?.username ?? "unknown";

  await Promise.all([
    setSetting("blackjackOddsMode", s.blackjackOddsMode),
    setSetting("rouletteOddsMode", s.rouletteOddsMode),
    setSetting("crashHouseEdgePct", String(s.crashHouseEdgePct)),
    setSetting("owner.activePreset", preset.id),
  ]);

  await db.execute(
    sql`INSERT INTO owner_preset_history (preset_id, preset_name, applied_by, applied_at) VALUES (${preset.id}, ${preset.name}, ${appliedBy}, NOW())`
  );

  console.log(`[Owner] Preset "${preset.name}" applied by ${appliedBy}`);

  return res.json({
    success: true,
    preset,
    appliedBy,
    message: `"${preset.name}" preset applied. New games will use updated RTP settings.`,
  });
});

// ── POST /owner/save-preset ───────────────────────────────────────────────────
// Save editable settings for one of the 5 named presets to the DB.
// Body: { presetId, settings: { slotsOddsMode, blackjackOddsMode, rouletteOddsMode,
//                               crashHouseEdgePct }, name?, description? }

router.post("/save-preset", requireOwner, async (req, res) => {
  const { presetId, name, description,
          blackjackRtpPct, rouletteRtpPct, crashRtpPct,
          // legacy shape (settings object) — kept for backward compat
          settings } = req.body;

  const validIds = PRESETS.map((p) => p.id);
  if (!presetId || !validIds.includes(presetId)) {
    return res.status(400).json({ error: `presetId must be one of: ${validIds.join(", ")}` });
  }

  const resolvedBjRtp     = typeof blackjackRtpPct === "number" ? blackjackRtpPct : null;
  const resolvedRoulRtp   = typeof rouletteRtpPct  === "number" ? rouletteRtpPct  : null;
  const resolvedCrashRtp  = typeof crashRtpPct     === "number" ? crashRtpPct     : null;

  if (resolvedBjRtp === null || resolvedRoulRtp === null || resolvedCrashRtp === null) {
    return res.status(400).json({ error: "blackjackRtpPct, rouletteRtpPct, crashRtpPct are all required" });
  }

  const validatePct = (v: number, name: string, min: number, max: number) => {
    if (isNaN(v) || v < min || v > max)
      return `${name} must be between ${min} and ${max}`;
    return null;
  };
  const errs = [
    validatePct(resolvedBjRtp,     "blackjackRtpPct", 85, 100),
    validatePct(resolvedRoulRtp,   "rouletteRtpPct",  80, 100),
    validatePct(resolvedCrashRtp,  "crashRtpPct",     70, 99),
  ].filter(Boolean);
  if (errs.length > 0) return res.status(400).json({ error: errs[0] });

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = resolveBankerSession(token);
  const appliedBy = session?.username ?? "unknown";

  const saves: Promise<void>[] = [
    setSetting(`preset.${presetId}.blackjackRtpPct`, String(resolvedBjRtp)),
    setSetting(`preset.${presetId}.rouletteRtpPct`,  String(resolvedRoulRtp)),
    setSetting(`preset.${presetId}.crashRtpPct`,     String(resolvedCrashRtp)),
  ];
  if (name && typeof name === "string" && name.trim().length > 0)
    saves.push(setSetting(`preset.${presetId}.name`, name.trim()));
  if (description && typeof description === "string")
    saves.push(setSetting(`preset.${presetId}.description`, description.trim()));

  await Promise.all(saves);

  const derivedMode = (pct: number, map: Record<string, number>) => nearestMode(pct, map);
  console.log(
    `[Owner] Preset "${presetId}" saved by ${appliedBy}:` +
    ` bj=${resolvedBjRtp}%(${derivedMode(resolvedBjRtp, BJ_RTP_MAP)})` +
    ` roul=${resolvedRoulRtp}%(${derivedMode(resolvedRoulRtp, ROULETTE_RTP_MAP)})` +
    ` crash=${resolvedCrashRtp}%`
  );

  return res.json({
    success: true,
    appliedBy,
    message: `"${presetId}" preset saved.`,
  });
});

// ── POST /owner/manual-settings ──────────────────────────────────────────────

router.post("/manual-settings", requireOwner, async (req, res) => {
  const { blackjackOddsMode, rouletteOddsMode, baccaratOddsMode, crashHouseEdgePct,
          sliderBjTemp, sliderRoulTemp, sliderCrashTemp, sliderBaccTemp } = req.body;

  if (!ODDS_MODES.includes(blackjackOddsMode)) return res.status(400).json({ error: "Invalid blackjackOddsMode" });
  if (!ODDS_MODES.includes(rouletteOddsMode)) return res.status(400).json({ error: "Invalid rouletteOddsMode" });
  if (baccaratOddsMode && !ODDS_MODES.includes(baccaratOddsMode)) return res.status(400).json({ error: "Invalid baccaratOddsMode" });
  if (typeof crashHouseEdgePct !== "number" || crashHouseEdgePct < 1 || crashHouseEdgePct > 30) {
    return res.status(400).json({ error: "crashHouseEdgePct must be a number between 1–30" });
  }
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = resolveBankerSession(token);
  const appliedBy = session?.username ?? "unknown";

  const saves: Promise<void>[] = [
    setSetting("blackjackOddsMode", blackjackOddsMode),
    setSetting("rouletteOddsMode", rouletteOddsMode),
    setSetting("crashHouseEdgePct", String(crashHouseEdgePct)),
    setSetting("owner.activePreset", "custom"),
  ];
  if (baccaratOddsMode)                      saves.push(setSetting("baccaratOddsMode",   baccaratOddsMode));
  // Persist raw slider positions so the UI restores exactly where the user left them
  if (typeof sliderBjTemp === "number")      saves.push(setSetting("sliderBjTemp",      String(sliderBjTemp)));
  if (typeof sliderRoulTemp === "number")    saves.push(setSetting("sliderRoulTemp",    String(sliderRoulTemp)));
  if (typeof sliderCrashTemp === "number")   saves.push(setSetting("sliderCrashTemp",   String(sliderCrashTemp)));
  if (typeof sliderBaccTemp === "number")    saves.push(setSetting("sliderBaccTemp",    String(sliderBaccTemp)));
  await Promise.all(saves);

  await db.execute(
    sql`INSERT INTO owner_preset_history (preset_id, preset_name, applied_by, applied_at) VALUES ('custom', 'Custom', ${appliedBy}, NOW())`
  );

  console.log(`[Owner] Manual settings applied by ${appliedBy}: bj=${blackjackOddsMode} roulette=${rouletteOddsMode} baccarat=${baccaratOddsMode ?? "unchanged"} crash=${crashHouseEdgePct}%`);

  return res.json({
    success: true,
    appliedBy,
    message: "Custom settings saved. New games will use updated odds settings.",
  });
});

// ── POST /owner/roulette-hot-spins ────────────────────────────────────────────
// Queue guaranteed player-winning spins (add to bank) or clear the bank.
// Body: { count: number }   — positive = add, 0 = clear

router.post("/roulette-hot-spins", requireOwner, async (req, res) => {
  const { count } = req.body;

  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 50) {
    return res.status(400).json({ error: "count must be an integer 0–50 (0 = clear)" });
  }

  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const session = resolveBankerSession(token);
  const appliedBy = session?.username ?? "unknown";

  let newTotal: number;
  if (count === 0) {
    newTotal = 0;
    await setSetting("rouletteHotSpins", "0");
    console.log(`[Owner] Hot spin bank CLEARED by ${appliedBy}`);
  } else {
    const current = parseInt(await getSetting("rouletteHotSpins", "0"), 10) || 0;
    newTotal = Math.min(current + count, 99);
    await setSetting("rouletteHotSpins", String(newTotal));
    console.log(`[Owner] Hot spin bank: +${count} by ${appliedBy} → total ${newTotal}`);
  }

  return res.json({
    success: true,
    rouletteHotSpins: newTotal,
    message: count === 0
      ? "Hot spin bank cleared."
      : `Queued ${count} hot spin(s). Bank now at ${newTotal}.`,
  });
});

export default router;
