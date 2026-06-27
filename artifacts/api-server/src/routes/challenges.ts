import { Router } from "express";
import { requirePlayer } from "../middleware/auth.js";
import { db, playersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

const MAX_REWARD = 10_000;

router.post("/claim-reward", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { amount, challengeId, label } = req.body ?? {};

  const chips = Math.round(Number(amount));
  if (!chips || chips <= 0 || chips > MAX_REWARD) {
    return res.status(400).json({ error: "Invalid reward amount" });
  }
  if (!challengeId || typeof challengeId !== "string" || challengeId.length > 80) {
    return res.status(400).json({ error: "challengeId required" });
  }

  const [player] = await db
    .select({ id: playersTable.id })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found" });

  await db
    .update(playersTable)
    .set({ chips: sql`${playersTable.chips} + ${chips}` })
    .where(eq(playersTable.id, playerId));

  await db.insert(transactionsTable).values({
    playerId,
    type: "bonus",
    amount: chips,
    description: `Challenge reward: ${String(label ?? challengeId).slice(0, 60)}`,
  });

  const [updated] = await db
    .select({ chips: playersTable.chips })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));

  const newBalance = Number(updated?.chips ?? 0);
  await broadcastPlayerBalance(playerId, newBalance).catch(() => {});

  return res.json({ ok: true, newBalance });
});

export default router;
