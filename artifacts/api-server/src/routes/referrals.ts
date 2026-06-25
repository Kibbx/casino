import { Router } from "express";
import { db, referralPromotersTable, playersTable } from "@workspace/db";
import { eq, sql as sqlFn } from "drizzle-orm";
import { requireBanker } from "../middleware/auth.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute per-player stats in one aggregated SQL query.
 *  Returns: deposited, withdrawn, wagered (loss-type txs = bets placed),
 *           game_wins (win-type txs), rake, current chips, hands_played */
async function getPlayerStats(playerIds: number[]) {
  if (playerIds.length === 0) return new Map<number, PlayerStats>();

  const idList = playerIds.join(",");

  // Transaction aggregates
  const txAgg = await db.execute(sqlFn`
    SELECT
      t.player_id                                              AS player_id,
      COALESCE(SUM(CASE WHEN t.type = 'deposit'    AND t.description NOT ILIKE 'Chip transfer%' THEN t.amount ELSE 0 END), 0) AS deposited,
      COALESCE(SUM(CASE WHEN t.type = 'withdrawal' AND t.description NOT ILIKE 'Chip transfer%' THEN t.amount ELSE 0 END), 0) AS withdrawn,
      COALESCE(SUM(CASE WHEN t.type = 'loss'       THEN t.amount ELSE 0 END), 0) AS wagered,
      COALESCE(SUM(CASE WHEN t.type = 'win'        THEN t.amount ELSE 0 END), 0) AS game_wins,
      COALESCE(SUM(CASE WHEN t.type = 'rake'       THEN t.amount ELSE 0 END), 0) AS rake_paid
    FROM transactions t
    WHERE t.player_id IN (${sqlFn.raw(idList)})
    GROUP BY t.player_id
  `);

  // Player table stats (chips, hands played)
  const playerRows = await db.execute(sqlFn`
    SELECT id, chips, hands_played FROM players WHERE id IN (${sqlFn.raw(idList)})
  `);

  const map = new Map<number, PlayerStats>();

  for (const row of playerRows.rows as any[]) {
    const pid = Number(row.id);
    map.set(pid, {
      deposited: 0, withdrawn: 0, wagered: 0, gameWins: 0, rakePaid: 0,
      chips: Number(row.chips ?? 0),
      handsPlayed: Number(row.hands_played ?? 0),
    });
  }

  for (const row of txAgg.rows as any[]) {
    const pid = Number(row.player_id);
    const existing = map.get(pid) ?? { chips: 0, handsPlayed: 0, deposited: 0, withdrawn: 0, wagered: 0, gameWins: 0, rakePaid: 0 };
    existing.deposited  = Number(row.deposited ?? 0);
    existing.withdrawn  = Number(row.withdrawn ?? 0);
    existing.wagered    = Number(row.wagered ?? 0);
    existing.gameWins   = Number(row.game_wins ?? 0);
    existing.rakePaid   = Number(row.rake_paid ?? 0);
    map.set(pid, existing);
  }

  return map;
}

type PlayerStats = {
  deposited: number;
  withdrawn: number;
  wagered: number;
  gameWins: number;
  rakePaid: number;
  chips: number;
  handsPlayed: number;
};

function calcCommission(stats: PlayerStats, commissionPercent: number) {
  const houseProfitFromPlayer = stats.deposited - stats.withdrawn;
  // Must have wagered at least 10k chips AND house must have profited
  if (stats.wagered >= 10_000 && houseProfitFromPlayer > 0) {
    return Math.floor(houseProfitFromPlayer * (commissionPercent / 100));
  }
  return 0;
}

// ── List all promoters with aggregated stats ──────────────────────────────────
router.get("/promoters", requireBanker, async (_req, res) => {
  const promoters = await db.select().from(referralPromotersTable).orderBy(referralPromotersTable.createdAt);
  if (promoters.length === 0) return res.json([]);

  // Get all players grouped by referredByCode in one query
  const referredRows = await db.execute(sqlFn`
    SELECT id, referred_by_code FROM players WHERE referred_by_code IS NOT NULL
  `);

  const playerIdsByCode = new Map<string, number[]>();
  for (const row of referredRows.rows as any[]) {
    const code = String(row.referred_by_code);
    const arr = playerIdsByCode.get(code) ?? [];
    arr.push(Number(row.id));
    playerIdsByCode.set(code, arr);
  }

  const allPlayerIds = (referredRows.rows as any[]).map((r) => Number(r.id));
  const statsMap = await getPlayerStats(allPlayerIds);

  const result = promoters.map((p) => {
    const playerIds = playerIdsByCode.get(p.code) ?? [];
    let totalDeposited = 0, totalWithdrawn = 0, totalWagered = 0, totalCommission = 0;
    for (const pid of playerIds) {
      const s = statsMap.get(pid);
      if (!s) continue;
      totalDeposited  += s.deposited;
      totalWithdrawn  += s.withdrawn;
      totalWagered    += s.wagered;
      totalCommission += calcCommission(s, p.commissionPercent);
    }
    const netProfit = totalDeposited - totalWithdrawn;
    return {
      ...p,
      createdAt: p.createdAt.toISOString(),
      totalReferredUsers: playerIds.length,
      totalDeposited,
      totalWithdrawn,
      totalWagered,
      netProfit,
      commissionOwed: totalCommission,
    };
  });

  return res.json(result);
});

// ── Create promoter ───────────────────────────────────────────────────────────
router.post("/promoters", requireBanker, async (req, res) => {
  const { code, ownerUserId, commissionPercent, bonusChips, isActive } = req.body;
  if (!code || typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "Referral code is required." });
  }
  if (!ownerUserId || typeof ownerUserId !== "string" || !ownerUserId.trim()) {
    return res.status(400).json({ error: "Owner username is required." });
  }
  const pct = Math.round(typeof commissionPercent === "number" ? commissionPercent : parseInt(commissionPercent ?? "0", 10));
  if (isNaN(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({ error: "Commission must be 0–100." });
  }

  const existing = await db
    .select({ id: referralPromotersTable.id })
    .from(referralPromotersTable)
    .where(eq(referralPromotersTable.code, code.trim().toUpperCase()));
  if (existing.length > 0) {
    return res.status(400).json({ error: "That referral code already exists." });
  }

  const bonus = Math.max(0, Math.round(typeof bonusChips === "number" ? bonusChips : parseInt(bonusChips ?? "0", 10)) || 0);

  const [promoter] = await db
    .insert(referralPromotersTable)
    .values({
      code: code.trim().toUpperCase(),
      ownerUserId: ownerUserId.trim(),
      commissionPercent: pct,
      bonusChips: bonus,
      isActive: isActive !== false,
    })
    .returning();

  return res.status(201).json({ ...promoter, createdAt: promoter.createdAt.toISOString() });
});

// ── Update promoter ───────────────────────────────────────────────────────────
router.put("/promoters/:id", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const { code, ownerUserId, commissionPercent, bonusChips, isActive } = req.body;
  const updates: Partial<typeof referralPromotersTable.$inferInsert> = {};
  if (code !== undefined) updates.code = String(code).trim().toUpperCase();
  if (ownerUserId !== undefined) updates.ownerUserId = String(ownerUserId).trim();
  if (commissionPercent !== undefined) {
    const pct = Math.round(typeof commissionPercent === "number" ? commissionPercent : parseInt(commissionPercent, 10));
    if (!isNaN(pct) && pct >= 0 && pct <= 100) updates.commissionPercent = pct;
  }
  if (bonusChips !== undefined) {
    updates.bonusChips = Math.max(0, Math.round(typeof bonusChips === "number" ? bonusChips : parseInt(bonusChips, 10)) || 0);
  }
  if (isActive !== undefined) updates.isActive = Boolean(isActive);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update." });
  }

  const [updated] = await db
    .update(referralPromotersTable)
    .set(updates)
    .where(eq(referralPromotersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Promoter not found." });
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

// ── Delete promoter ───────────────────────────────────────────────────────────
router.delete("/promoters/:id", requireBanker, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [deleted] = await db
    .delete(referralPromotersTable)
    .where(eq(referralPromotersTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ error: "Promoter not found." });
  return res.json({ ok: true });
});

// ── Promoter detail — all referred users with full stats ──────────────────────
router.get("/promoters/:code", requireBanker, async (req, res) => {
  const code = req.params.code as string;

  const [promoter] = await db
    .select()
    .from(referralPromotersTable)
    .where(eq(referralPromotersTable.code, code.toUpperCase()));

  if (!promoter) return res.status(404).json({ error: "Promoter not found." });

  const playerRows = await db.execute(sqlFn`
    SELECT id, username, chips, hands_played, created_at
    FROM players
    WHERE referred_by_code = ${code.toUpperCase()}
  `);

  if ((playerRows.rows as any[]).length === 0) {
    return res.json({ promoter: { ...promoter, createdAt: promoter.createdAt.toISOString() }, users: [] });
  }

  const playerIds = (playerRows.rows as any[]).map((r) => Number(r.id));
  const statsMap = await getPlayerStats(playerIds);

  const users = (playerRows.rows as any[]).map((p) => {
    const s = statsMap.get(Number(p.id)) ?? { deposited: 0, withdrawn: 0, wagered: 0, gameWins: 0, rakePaid: 0, chips: 0, handsPlayed: 0 };
    const houseProfitFromPlayer = s.deposited - s.withdrawn;
    const commission = calcCommission(s, promoter.commissionPercent);
    return {
      id: Number(p.id),
      username: String(p.username),
      chips: Number(p.chips ?? 0),
      handsPlayed: Number(p.hands_played ?? 0),
      joinedAt: new Date(p.created_at).toISOString(),
      totalDeposited: s.deposited,
      totalWithdrawn: s.withdrawn,
      totalWagered: s.wagered,
      gameWins: s.gameWins,
      rakePaid: s.rakePaid,
      profitLoss: houseProfitFromPlayer,
      commissionOwed: commission,
      commissionQualified: s.wagered >= 10_000 && houseProfitFromPlayer > 0,
    };
  });

  const totals = {
    totalDeposited: users.reduce((a, u) => a + u.totalDeposited, 0),
    totalWithdrawn: users.reduce((a, u) => a + u.totalWithdrawn, 0),
    totalWagered: users.reduce((a, u) => a + u.totalWagered, 0),
    netProfit: users.reduce((a, u) => a + u.profitLoss, 0),
    commissionOwed: users.reduce((a, u) => a + u.commissionOwed, 0),
  };

  return res.json({ promoter: { ...promoter, createdAt: promoter.createdAt.toISOString() }, users, totals });
});

export default router;
