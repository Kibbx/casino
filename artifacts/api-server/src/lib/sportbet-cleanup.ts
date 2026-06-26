import { db, sportBetSlipsTable, settingsTable } from "@workspace/db";
import { inArray, lt, and, isNotNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

// Statuses that are fully resolved — no pending actions remain
const FINAL_STATUSES = ["won", "lost", "voided", "cashed_out"] as const;

async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return rows[0]?.value ?? fallback;
}

export async function runSportbetCleanupJob(): Promise<void> {
  try {
    const enabled = await getSetting("sbAutoDeleteEnabled", "true");
    if (enabled === "false") return;

    const retentionMinutes = parseInt(await getSetting("sbAutoDeleteRetentionMinutes", "30"), 10) || 30;
    const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000);

    // Find fully settled slips whose settledAt is older than the retention window
    // Safety: ONLY final statuses — never touch pending slips
    const slips = await db
      .select()
      .from(sportBetSlipsTable)
      .where(
        and(
          inArray(sportBetSlipsTable.status, [...FINAL_STATUSES]),
          isNotNull(sportBetSlipsTable.settledAt),
          lt(sportBetSlipsTable.settledAt, cutoff)
        )
      );

    if (slips.length === 0) return;

    const now = new Date().toISOString();
    for (const slip of slips) {
      // Audit log: every deletion is recorded with full financial context
      console.log(
        `[sb-cleanup] AUTO-DELETE slip #${slip.id} | player=${slip.playerUsername}(${slip.playerId})` +
        ` | status=${slip.status} | wager=${slip.wagerAmount} | payout=${slip.actualPayout ?? 0}` +
        ` | settledAt=${slip.settledAt?.toISOString()} | deletedAt=${now}`
      );
    }

    const ids = slips.map(s => s.id);
    await db.delete(sportBetSlipsTable).where(
      inArray(sportBetSlipsTable.id, ids)
    );

    console.log(
      `[sb-cleanup] Deleted ${slips.length} settled slip(s) older than ${retentionMinutes}min ` +
      `(retention cutoff: ${cutoff.toISOString()})`
    );
  } catch (e: any) {
    console.error("[sb-cleanup] Error during cleanup job:", e?.message ?? e);
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startSportbetCleanupJob(): void {
  // Run once immediately on startup (catches any stale slips from before last restart)
  runSportbetCleanupJob();

  // Then every 5 minutes
  cleanupTimer = setInterval(runSportbetCleanupJob, 5 * 60 * 1000);
  console.log("[sb-cleanup] Auto-delete scheduler started (runs every 5 min)");
}

export function stopSportbetCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
