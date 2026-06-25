import { db, playersTable, rakebackTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export const RAKEBACK_RATE = 0.03;
export const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours between claims

export function computeClaimable(wagered: number, won: number): number {
  return Math.max(0, Math.floor((wagered - won) * RAKEBACK_RATE));
}

/**
 * Call when a player places a bet in an eligible game.
 * Tracks the full bet amount — all chips in this casino are real.
 * Returns 1.0 always (kept for compatibility with existing callers).
 */
export async function trackRakebackBet(playerId: number, bet: number): Promise<number> {
  if (bet <= 0) return 1;
  await upsertRakeback(playerId, bet, 0);
  return 1;
}

/**
 * Call when a player wins in an eligible game.
 * realRatio param is kept for compatibility but ignored (always treated as 1.0).
 */
export async function trackRakebackWin(playerId: number, win: number, _realRatio: number): Promise<void> {
  if (win <= 0) return;
  await upsertRakeback(playerId, 0, win);
}

async function upsertRakeback(playerId: number, addWagered: number, addWon: number): Promise<void> {
  const [existing] = await db
    .select()
    .from(rakebackTable)
    .where(eq(rakebackTable.playerId, playerId));

  if (!existing) {
    await db.insert(rakebackTable).values({
      playerId,
      wageredReal: addWagered,
      wonReal: addWon,
      periodStart: new Date(),
    });
    return;
  }

  await db
    .update(rakebackTable)
    .set({
      wageredReal: sql`${rakebackTable.wageredReal} + ${addWagered}`,
      wonReal: sql`${rakebackTable.wonReal} + ${addWon}`,
    })
    .where(eq(rakebackTable.playerId, playerId));
}

/**
 * Claim all available rakeback for a player.
 * Rakeback accumulates indefinitely — no expiry.
 * Claims are gated by a 24-hour cooldown between each claim.
 */
export async function claimRakeback(playerId: number): Promise<{ claimed: number; newBalance: number; error?: string; nextClaimAt?: string }> {
  const [rb] = await db
    .select()
    .from(rakebackTable)
    .where(eq(rakebackTable.playerId, playerId));

  if (!rb) return { claimed: 0, newBalance: 0, error: "No rakeback record found" };

  // Enforce cooldown
  if (rb.lastClaimed) {
    const msSinceClaim = Date.now() - rb.lastClaimed.getTime();
    if (msSinceClaim < CLAIM_COOLDOWN_MS) {
      const nextClaimAt = new Date(rb.lastClaimed.getTime() + CLAIM_COOLDOWN_MS).toISOString();
      const remainMs = CLAIM_COOLDOWN_MS - msSinceClaim;
      const remainHrs = Math.floor(remainMs / 3_600_000);
      const remainMins = Math.floor((remainMs % 3_600_000) / 60_000);
      return {
        claimed: 0,
        newBalance: 0,
        error: `You can claim again in ${remainHrs}h ${remainMins}m`,
        nextClaimAt,
      };
    }
  }

  const claimable = computeClaimable(rb.wageredReal, rb.wonReal);
  if (claimable <= 0) return { claimed: 0, newBalance: 0, error: "No rakeback to claim" };

  const netLoss = rb.wageredReal - rb.wonReal;
  await db
    .update(playersTable)
    .set({ chips: sql`${playersTable.chips} + ${claimable}` })
    .where(eq(playersTable.id, playerId));

  await db.insert(transactionsTable).values({
    playerId,
    amount: claimable,
    type: "rakeback",
    description: `Rakeback claimed — 3% of ${netLoss.toLocaleString()} net loss`,
  });

  const now = new Date();
  await db
    .update(rakebackTable)
    .set({ wageredReal: 0, wonReal: 0, periodStart: now, lastClaimed: now })
    .where(eq(rakebackTable.playerId, playerId));

  const [up] = await db
    .select({ chips: playersTable.chips })
    .from(playersTable)
    .where(eq(playersTable.id, playerId));

  return { claimed: claimable, newBalance: up?.chips ?? 0 };
}

export async function getRakebackStatus(playerId: number) {
  const [rb] = await db
    .select()
    .from(rakebackTable)
    .where(eq(rakebackTable.playerId, playerId));

  if (!rb) {
    return {
      claimable: 0,
      wageredReal: 0,
      wonReal: 0,
      lastClaimed: null,
      onCooldown: false,
      nextClaimAt: null,
    };
  }

  const claimable = computeClaimable(rb.wageredReal, rb.wonReal);

  let onCooldown = false;
  let nextClaimAt: string | null = null;
  if (rb.lastClaimed) {
    const msSinceClaim = Date.now() - rb.lastClaimed.getTime();
    if (msSinceClaim < CLAIM_COOLDOWN_MS) {
      onCooldown = true;
      nextClaimAt = new Date(rb.lastClaimed.getTime() + CLAIM_COOLDOWN_MS).toISOString();
    }
  }

  return {
    claimable,
    wageredReal: rb.wageredReal,
    wonReal: rb.wonReal,
    lastClaimed: rb.lastClaimed?.toISOString() ?? null,
    onCooldown,
    nextClaimAt,
  };
}
