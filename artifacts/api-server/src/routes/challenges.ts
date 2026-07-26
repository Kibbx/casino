import { Router } from "express";
import { requirePlayer } from "../middleware/auth.js";
import { db, playersTable, transactionsTable, challengeClaimsTable, challengeStateTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

const MAX_CHIPS_REWARD = 150_000;
const MAX_RP_REWARD    = 150;

// ── Derive the current rotation period key from the challenge ID ──────────────
// Matches the same logic in the frontend challengeService.ts so neither side
// can be spoofed — the server computes it independently from the challenge prefix.
function periodKeyFor(challengeId: string): string {
  const prefix = challengeId.split("_")[0] ?? "";
  const now = new Date();

  if (prefix === "d") {
    // Daily: YYYY-MM-DD
    return now.toISOString().slice(0, 10);
  }
  if (prefix === "w") {
    // ISO week: YYYY-Www (Monday-based)
    const jan4 = new Date(now.getFullYear(), 0, 4);
    const dow = jan4.getDay() === 0 ? 7 : jan4.getDay();
    const weekStart = new Date(jan4.getTime() - (dow - 1) * 86_400_000);
    const weekNum = Math.floor((now.getTime() - weekStart.getTime()) / (7 * 86_400_000)) + 1;
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  }
  if (prefix === "m") {
    // Monthly: YYYY-MM
    return now.toISOString().slice(0, 7);
  }
  // Special challenges ("s_*") and anything else: permanent (never re-awarded)
  return "permanent";
}

// GET /api/challenges/state — load persisted progress for this player
router.get("/state", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [row] = await db
    .select({ stateJson: challengeStateTable.stateJson })
    .from(challengeStateTable)
    .where(eq(challengeStateTable.playerId, playerId));
  return res.json({ state: row?.stateJson ?? null });
});

// PUT /api/challenges/state — persist progress for this player
router.put("/state", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { state } = req.body ?? {};
  if (!state || typeof state !== "string" || state.length > 32_768) {
    return res.status(400).json({ error: "Invalid state payload" });
  }
  // Basic sanity — must be valid JSON
  try { JSON.parse(state); } catch {
    return res.status(400).json({ error: "state must be valid JSON" });
  }
  await db
    .insert(challengeStateTable)
    .values({ playerId, stateJson: state })
    .onConflictDoUpdate({
      target: challengeStateTable.playerId,
      set: { stateJson: state, updatedAt: sql`NOW()` },
    });
  return res.json({ ok: true });
});

// POST /api/challenges/claim-reward
router.post("/claim-reward", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { amount, rewardPoints: rpRaw, challengeId, label } = req.body ?? {};

  // ── Validate inputs ──────────────────────────────────────────────────────────
  const chips = Math.round(Number(amount));
  const rp    = Math.round(Number(rpRaw ?? 0));

  if (!chips || chips <= 0 || chips > MAX_CHIPS_REWARD) {
    return res.status(400).json({ error: "Invalid reward amount" });
  }
  if (rp < 0 || rp > MAX_RP_REWARD) {
    return res.status(400).json({ error: "Invalid reward points amount" });
  }
  if (!challengeId || typeof challengeId !== "string" || challengeId.length > 80) {
    return res.status(400).json({ error: "challengeId required" });
  }

  const [player] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  const periodKey   = periodKeyFor(challengeId);
  const claimLabel  = String(label ?? challengeId).slice(0, 60);

  // ── Server-side duplicate claim check ────────────────────────────────────────
  const [existing] = await db
    .select({ id: challengeClaimsTable.id })
    .from(challengeClaimsTable)
    .where(
      and(
        eq(challengeClaimsTable.playerId,    playerId),
        eq(challengeClaimsTable.challengeId, challengeId),
        eq(challengeClaimsTable.periodKey,   periodKey),
      ),
    );

  if (existing) {
    return res.status(409).json({ error: "Reward already claimed for this period." });
  }

  // ── Award chips ──────────────────────────────────────────────────────────────
  await db
    .update(playersTable)
    .set({ chips: sql`${playersTable.chips} + ${chips}` })
    .where(eq(playersTable.id, playerId));

  // ── Award reward points (if any) ─────────────────────────────────────────────
  if (rp > 0) {
    await db.execute(
      sql`UPDATE players SET reward_points = reward_points + ${rp} WHERE id = ${playerId}`
    );
  }

  // ── Record transaction (bonus history) ──────────────────────────────────────
  const rpSuffix = rp > 0 ? ` + ${rp.toLocaleString()} RP` : "";
  await db.insert(transactionsTable).values({
    playerId,
    type:        "bonus",
    amount:      chips,
    description: `Challenge reward: ${claimLabel}${rpSuffix}`,
  });

  // ── Record claim (prevents re-claim this period) ─────────────────────────────
  await db.insert(challengeClaimsTable).values({
    playerId,
    challengeId,
    challengeName: claimLabel,
    rewardAmount:  chips,
    periodKey,
  });

  // ── Broadcast new chip balance via WebSocket ──────────────────────────────────
  const [updated] = await db
    .select({ chips: playersTable.chips })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));

  const newBalance = Number(updated?.chips ?? 0);
  broadcastPlayerBalance(playerId, newBalance);

  // ── Return new RP balance ─────────────────────────────────────────────────────
  const rpRow = rp > 0
    ? await db.execute(sql`SELECT reward_points FROM players WHERE id = ${playerId}`)
    : null;
  const newRewardPoints = rp > 0 ? Number((rpRow?.rows[0] as any)?.reward_points ?? 0) : undefined;

  return res.json({ ok: true, newBalance, newRewardPoints });
});

// GET /api/challenges/claim-history — player's reward history
router.get("/claim-history", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const rows = await db
    .select()
    .from(challengeClaimsTable)
    .where(eq(challengeClaimsTable.playerId, playerId))
    .orderBy(sql`claimed_at DESC`)
    .limit(100);

  return res.json({ claims: rows });
});

export default router;
