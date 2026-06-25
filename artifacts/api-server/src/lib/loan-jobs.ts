import { db, loansTable, playersTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { todayEST } from "../utils/timezone.js";
import { getLoanSettings, updateCreditScore, calculateCreditScore } from "./credit.js";

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA + "T00:00:00Z").getTime();
  const b = new Date(dateB + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86400000);
}

export async function runEscalationJob(): Promise<void> {
  try {
    const settings = await getLoanSettings();
    const overdueDays = parseInt(settings.overdueDays ?? "3");
    const delinquentDays = parseInt(settings.delinquentDays ?? "7");
    const collectionsDays = parseInt(settings.collectionsDays ?? "14");
    const autoFlag = settings.autoFlagEscalated !== "false";

    const today = todayEST();
    const loans = await db.select().from(loansTable);
    const affectedPlayers = new Set<number>();

    for (const loan of loans) {
      if (loan.status === "paid" || loan.status === "defaulted") continue;
      if (!loan.dueDate || today <= loan.dueDate) {
        // Still on time — reset to active if somehow stuck
        if (loan.stage !== "active") {
          await db.update(loansTable).set({ stage: "active", updatedAt: new Date() }).where(eq(loansTable.id, loan.id));
        }
        continue;
      }

      const overdueDaysElapsed = daysBetween(loan.dueDate, today);
      let newStage = "overdue";
      if (overdueDaysElapsed >= collectionsDays) newStage = "collections";
      else if (overdueDaysElapsed >= delinquentDays) newStage = "delinquent";
      else if (overdueDaysElapsed >= overdueDays) newStage = "overdue";

      if (newStage !== loan.stage) {
        await db.update(loansTable).set({ stage: newStage, updatedAt: new Date() }).where(eq(loansTable.id, loan.id));
        affectedPlayers.add(loan.playerId);

        // Auto-flag player if in delinquent or collections and setting enabled
        if (autoFlag && (newStage === "delinquent" || newStage === "collections")) {
          const player = await db.select().from(playersTable).where(eq(playersTable.id, loan.playerId)).then(r => r[0]);
          if (player && !player.flagged) {
            await db.update(playersTable).set({
              flagged: true,
              flagReason: `Loan in ${newStage} stage — ${overdueDaysElapsed} days past due`,
              flagSeverity: newStage === "collections" ? "high" : "medium",
              flaggedBy: "system",
              flaggedAt: new Date(),
            }).where(eq(playersTable.id, loan.playerId));
          }
        }
      }
    }

    // Recalculate credit scores for affected players
    for (const playerId of affectedPlayers) {
      await updateCreditScore(playerId).catch(() => {});
    }

    if (affectedPlayers.size > 0) {
      console.log(`[loan-escalation] Updated ${affectedPlayers.size} player(s)`);
    }
  } catch (e: any) {
    console.error("[loan-escalation] Error:", e?.message ?? e);
  }
}

export async function runDailyInterestJob(): Promise<void> {
  try {
    const settings = await getLoanSettings();
    if (settings.interestMode !== "daily" || settings.dailyInterestEnabled === "false") return;

    const dailyRate = parseFloat(settings.dailyInterestRate ?? "2") / 100;
    const maxCap = parseFloat(settings.maxInterestCap ?? "200") / 100;

    const loans = await db.select().from(loansTable);
    let count = 0;

    for (const loan of loans) {
      if (loan.status === "paid" || loan.status === "defaulted") continue;

      const maxInterest = Math.round(loan.principalAmount * maxCap);
      if (loan.interestAccrued >= maxInterest) continue;

      const interest = Math.round(loan.remainingBalance * dailyRate);
      if (interest <= 0) continue;

      const newAccrued = Math.min(loan.interestAccrued + interest, maxInterest);
      const actualInterest = newAccrued - loan.interestAccrued;
      const newBalance = loan.remainingBalance + actualInterest;
      const newTotal = loan.totalOwed + actualInterest;

      await db.update(loansTable).set({
        remainingBalance: newBalance,
        totalOwed: newTotal,
        interestAccrued: newAccrued,
        updatedAt: new Date(),
      }).where(eq(loansTable.id, loan.id));

      count++;
    }

    if (count > 0) {
      console.log(`[daily-interest] Applied interest to ${count} loan(s)`);
    }
  } catch (e: any) {
    console.error("[daily-interest] Error:", e?.message ?? e);
  }
}

// Start the background scheduler
let escalationTimer: ReturnType<typeof setInterval> | null = null;
let interestTimer: ReturnType<typeof setInterval> | null = null;

// One-time backfill: recalculate all player credit scores with the current formula
// so the stored badge value always matches what the loan eligibility check computes.
export async function backfillCreditScores(): Promise<void> {
  try {
    const players = await db.select({ id: playersTable.id }).from(playersTable);
    let updated = 0;
    for (const p of players) {
      await updateCreditScore(p.id).catch(() => {});
      updated++;
    }
    console.log(`[credit-backfill] Recalculated scores for ${updated} player(s)`);
  } catch (e: any) {
    console.error("[credit-backfill] Error:", e?.message ?? e);
  }
}

export function startLoanJobs(): void {
  // Backfill credit scores once on startup (non-blocking)
  backfillCreditScores();

  // Run escalation immediately, then every hour
  runEscalationJob();
  escalationTimer = setInterval(runEscalationJob, 60 * 60 * 1000);

  // Run daily interest at midnight EST (approximate: check every hour, only apply once per day)
  let lastInterestDay: string | null = null;
  const checkDailyInterest = async () => {
    const today = todayEST();
    if (lastInterestDay !== today) {
      lastInterestDay = today;
      await runDailyInterestJob();
    }
  };
  checkDailyInterest();
  interestTimer = setInterval(checkDailyInterest, 60 * 60 * 1000);

  console.log("[loan-jobs] Escalation & interest schedulers started");
}
