import { Router } from "express";
import { requirePlayer } from "../middleware/auth.js";
import { getRakebackStatus, claimRakeback } from "../lib/rakeback.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

router.get("/status", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const status = await getRakebackStatus(playerId);
  return res.json(status);
});

router.post("/claim", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const result = await claimRakeback(playerId);
  if (result.error && result.claimed === 0) {
    return res.status(400).json({ error: result.error });
  }
  await broadcastPlayerBalance(playerId, result.newBalance).catch(() => {});
  return res.json({ success: true, claimed: result.claimed, newBalance: result.newBalance });
});

export default router;
