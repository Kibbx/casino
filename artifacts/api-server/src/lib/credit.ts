import { db, playersTable, loansTable, settingsTable, creditTiersTable, loanTiersTable } from "@workspace/db";
import { eq, sql, asc } from "drizzle-orm";
import { todayEST } from "../utils/timezone.js";

function effectiveLoanStage(loan: { status: string; stage: string; dueDate: string | null }): string {
  if (loan.status === "paid" || loan.status === "defaulted") return loan.status;
  return loan.stage || loan.status;
}

// Load all loan.* settings from DB as a flat object
export async function getLoanSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.startsWith("loan.")) out[row.key.slice(5)] = row.value;
  }
  return out;
}

export async function saveLoanSettings(updates: Record<string, string>): Promise<void> {
  for (const [k, v] of Object.entries(updates)) {
    const key = `loan.${k}`;
    await db
      .insert(settingsTable)
      .values({ key, value: v })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: v } });
  }
}

// Get the best credit tier for a given score
export async function getCreditTierForScore(score: number): Promise<{ name: string; interestModifier: number; loanMultiplier: number } | null> {
  const tiers = await db.select().from(creditTiersTable);
  if (!tiers.length) return null;
  tiers.sort((a, b) => b.minScore - a.minScore);
  return tiers.find(t => score >= t.minScore) ?? null;
}

export async function calculateCreditScore(playerId: number): Promise<{ score: number; activeDays: number; totalWagered: number; lifetimeDeposits: number }> {
  // Total wagered — kept for eligibility gate only, NOT used in score formula
  const wageredRes = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE player_id = ${playerId} AND type = 'loss'
  `);
  const totalWagered = Number((wageredRes.rows[0] as any)?.total ?? 0);

  // Lifetime deposits — small positive signal (shows they put money in)
  const depositRes = await db.execute(sql`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM transactions
    WHERE player_id = ${playerId} AND type = 'deposit'
  `);
  const lifetimeDeposits = Number((depositRes.rows[0] as any)?.total ?? 0);

  // Active days — only days with a loan repayment count
  const activeDaysRes = await db.execute(sql`
    SELECT COUNT(DISTINCT DATE(created_at::timestamptz AT TIME ZONE 'America/New_York')) AS days
    FROM transactions
    WHERE player_id = ${playerId} AND type IN ('loan_repayment', 'loan_payment', 'repayment')
  `);
  const activeDays = Number((activeDaysRes.rows[0] as any)?.days ?? 0);

  // Trusted volume (total loan repayments made) — primary positive signal
  const [playerRow, settings] = await Promise.all([
    db.select({ trustedVolume: playersTable.trustedVolume }).from(playersTable).where(eq(playersTable.id, playerId)),
    getLoanSettings(),
  ]);
  const trustedVolume = playerRow[0]?.trustedVolume ?? 0;

  // Configurable formula weights (all adjustable from banker dashboard)
  const scoreBase                = parseFloat(settings.scoreBase                ?? "300");
  const scoreDepositWeight       = parseFloat(settings.scoreDepositWeight       ?? "0.15");
  const scoreTrustedVolumeWeight = parseFloat(settings.scoreTrustedVolumeWeight ?? "0.5");
  const scoreLoansRepaidBonus    = parseFloat(settings.scoreLoansRepaidBonus    ?? "50");
  const scoreActiveDaysBonus     = parseFloat(settings.scoreActiveDaysBonus     ?? "3");
  const scoreDefaultPenalty      = parseFloat(settings.scoreDefaultPenalty      ?? "150");
  const scoreOverduePenalty      = parseFloat(settings.scoreOverduePenalty      ?? "75");

  // Loan history
  const loans = await db.select().from(loansTable).where(eq(loansTable.playerId, playerId));

  let loansRepaid = 0;
  let defaults = 0;
  let overdueLoans = 0;

  for (const loan of loans) {
    const stage = effectiveLoanStage(loan);
    if (loan.status === "paid") loansRepaid++;
    if (loan.status === "defaulted") defaults++;
    if (stage === "overdue" || stage === "delinquent" || stage === "collections") overdueLoans++;
  }

  const score =
    scoreBase +
    (Math.sqrt(lifetimeDeposits) * scoreDepositWeight) +
    (Math.sqrt(trustedVolume)    * scoreTrustedVolumeWeight) +
    (loansRepaid  * scoreLoansRepaidBonus) +
    (activeDays   * scoreActiveDaysBonus) -
    (defaults     * scoreDefaultPenalty) -
    (overdueLoans * scoreOverduePenalty);

  return { score: Math.max(0, Math.min(1000, Math.round(score))), activeDays, totalWagered, lifetimeDeposits };
}

export async function updateCreditScore(playerId: number): Promise<number> {
  const { score } = await calculateCreditScore(playerId);
  await db.update(playersTable).set({ creditScore: score }).where(eq(playersTable.id, playerId));
  return score;
}

// Derive tier label from tier table (or fallback)
export function creditTierLabel(score: number): string {
  if (score >= 900) return "Elite";
  if (score >= 800) return "VIP";
  if (score >= 600) return "Trusted";
  if (score >= 400) return "Reliable";
  if (score >= 100) return "Standard";
  return "Shit Credit";
}

// ── Loan Tiers (volume-based progression) ────────────────────────────────────

export async function getLoanTiers(): Promise<{ id: number; name: string; requiredRepaid: number; cap: number; sortOrder: number }[]> {
  const rows = await db.select().from(loanTiersTable).orderBy(asc(loanTiersTable.sortOrder));
  return rows;
}

export function resolvePlayerLoanTier(
  trustedVolume: number,
  tiers: { id: number; name: string; requiredRepaid: number; cap: number; sortOrder: number }[],
  settings: Record<string, string>,
  loans: { status: string; stage: string; dueDate: string | null }[],
): {
  tier: { id: number; name: string; requiredRepaid: number; cap: number; sortOrder: number } | null;
  nextTier: { id: number; name: string; requiredRepaid: number; cap: number; sortOrder: number } | null;
  progressPct: number;
  progressionBlocked: boolean;
  progressionBlockReason: string | null;
} {
  const sorted = [...tiers].sort((a, b) => a.sortOrder - b.sortOrder);
  if (!sorted.length) return { tier: null, nextTier: null, progressPct: 0, progressionBlocked: false, progressionBlockReason: null };

  // Check progression block conditions
  const blockOnDefaults = settings.progressionBlockDefaults !== "false";
  const blockOverdueThreshold = parseInt(settings.progressionBlockOverdue ?? "2");
  const defaults = loans.filter(l => l.status === "defaulted").length;
  const overdueLoans = loans.filter(l => {
    const st = effectiveLoanStage(l);
    return st === "overdue" || st === "delinquent" || st === "collections";
  }).length;

  let progressionBlocked = false;
  let progressionBlockReason: string | null = null;
  if (blockOnDefaults && defaults > 0) {
    progressionBlocked = true;
    progressionBlockReason = `Progression blocked — ${defaults} default(s) on record`;
  } else if (overdueLoans > blockOverdueThreshold) {
    progressionBlocked = true;
    progressionBlockReason = `Progression blocked — ${overdueLoans} overdue loan(s) (threshold: ${blockOverdueThreshold})`;
  }

  // Find current tier (highest tier whose requiredRepaid <= trustedVolume)
  let currentTier = sorted[0];
  for (const t of sorted) {
    if (trustedVolume >= t.requiredRepaid) currentTier = t;
    else break;
  }

  // If progression is blocked, use the tier they currently sit at but don't let them advance
  const currentIdx = sorted.indexOf(currentTier);
  const nextTier = currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;

  let progressPct = 0;
  if (nextTier) {
    const range = nextTier.requiredRepaid - currentTier.requiredRepaid;
    const progress = trustedVolume - currentTier.requiredRepaid;
    progressPct = range > 0 ? Math.min(100, Math.round((progress / range) * 100)) : 100;
  } else {
    progressPct = 100;
  }

  return { tier: currentTier, nextTier, progressPct, progressionBlocked, progressionBlockReason };
}

// Calculate the weighted progression increment for a payment
export function progressionWeight(loanAmount: number, paymentAmount: number, settings: Record<string, string>): number {
  const minQ = parseFloat(settings.minQualifyingLoan ?? "50000");
  const multiLarge = parseFloat(settings.progressionMultiLarge ?? "1.5");
  const multiMid = parseFloat(settings.progressionMultiMid ?? "1.2");
  const multiSmall = parseFloat(settings.progressionMultiSmall ?? "0.2");

  let multiplier: number;
  if (loanAmount >= 500000) multiplier = multiLarge;
  else if (loanAmount >= 250000) multiplier = multiMid;
  else if (loanAmount < minQ) multiplier = multiSmall;
  else multiplier = 1.0;

  return Math.round(paymentAmount * multiplier);
}

// Apply trusted volume increment when a payment is made on a qualifying loan
export async function applyTrustedVolume(playerId: number, loanAmount: number, paymentAmount: number): Promise<number> {
  const settings = await getLoanSettings();
  const minQ = parseFloat(settings.minQualifyingLoan ?? "50000");

  // Loans below minQualifyingLoan get a reduced multiplier (not fully excluded — per spec they use multiSmall)
  const increment = progressionWeight(loanAmount, paymentAmount, settings);

  const [updated] = await db
    .update(playersTable)
    .set({ trustedVolume: sql`trusted_volume + ${increment}` })
    .where(eq(playersTable.id, playerId))
    .returning({ trustedVolume: playersTable.trustedVolume });

  return updated?.trustedVolume ?? 0;
}

// Compute max loan: tier cap is the hard ceiling; credit score only affects interest rate
export async function creditMaxLoanAsync(score: number, trustedVolume?: number): Promise<number> {
  const settings = await getLoanSettings();
  const loanTiers = await getLoanTiers();
  const tv = trustedVolume ?? 0;
  const { tier: lTier } = resolvePlayerLoanTier(tv, loanTiers, settings, []);
  return lTier?.cap ?? Math.round(score * parseFloat(settings.loanMultiplier ?? "500"));
}

// Compute interest rate using settings + tier modifier
export async function creditInterestRateAsync(score: number): Promise<number> {
  const settings = await getLoanSettings();
  const base = parseFloat(settings.baseInterestRate ?? "25");
  const tier = await getCreditTierForScore(score);
  const modifier = tier?.interestModifier ?? 0;
  const rate = base - (score / 1000) * (base * 0.6) + modifier;
  return Math.max(0, Math.round(rate * 10) / 10);
}

// Check if player is blocked from loans based on settings
export async function creditEligibility(playerId: number): Promise<{
  blocked: boolean;
  reason: string | null;
  score: number;
  activeDays: number;
  totalWagered: number;
  maxLoan: number;
  interestRate: number;
  tier: string;
  trustedVolume: number;
  loanTierName: string;
  loanTierCap: number;
  loanNextTierName: string | null;
  loanNextTierRequired: number | null;
  loanProgressPct: number;
  progressionBlocked: boolean;
  progressionBlockReason: string | null;
}> {
  const settings = await getLoanSettings();
  const minScore = parseFloat(settings.minCreditScore ?? "100");
  const minActiveDays = parseFloat(settings.minActiveDays ?? "0");
  const minWagered = parseFloat(settings.minTotalWagered ?? "0");

  const [{ score, activeDays, totalWagered }, playerRows, loanRows, loanTiersList] = await Promise.all([
    calculateCreditScore(playerId),
    db.select({ trustedVolume: playersTable.trustedVolume }).from(playersTable).where(eq(playersTable.id, playerId)),
    db.select().from(loansTable).where(eq(loansTable.playerId, playerId)),
    getLoanTiers(),
  ]);

  const trustedVolume = playerRows[0]?.trustedVolume ?? 0;
  const { tier: lTier, nextTier: lNext, progressPct, progressionBlocked, progressionBlockReason } =
    resolvePlayerLoanTier(trustedVolume, loanTiersList, settings, loanRows);

  const loanTierCap = lTier?.cap ?? Infinity;
  const interestRate = await creditInterestRateAsync(score);
  const creditTierLabel_ = creditTierLabel(score);

  // Tier cap is the hard ceiling — credit score only affects interest rate and eligibility block
  const maxLoan = loanTierCap === Infinity
    ? Math.round(score * parseFloat(settings.loanMultiplier ?? "500"))
    : loanTierCap;

  let blocked = false;
  let reason: string | null = null;

  if (score < minScore) {
    blocked = true;
    reason = `Credit score too low (${score} < ${minScore} required)`;
  } else if (activeDays < minActiveDays) {
    blocked = true;
    reason = `Not enough active days (${activeDays} < ${minActiveDays} required)`;
  } else if (totalWagered < minWagered) {
    blocked = true;
    reason = `Not enough total wagered (${totalWagered.toLocaleString()} < ${minWagered.toLocaleString()} required)`;
  }

  return {
    blocked, reason, score, activeDays, totalWagered, maxLoan, interestRate, tier: creditTierLabel_,
    trustedVolume,
    loanTierName: lTier?.name ?? "New",
    loanTierCap: lTier?.cap ?? 75000,
    loanNextTierName: lNext?.name ?? null,
    loanNextTierRequired: lNext?.requiredRepaid ?? null,
    loanProgressPct: progressPct,
    progressionBlocked,
    progressionBlockReason,
  };
}

// Legacy sync helpers (kept for backward compatibility, use async versions where possible)
export function creditTier(score: number): { label: string; color: string } {
  if (score >= 900) return { label: "Elite",    color: "green" };
  if (score >= 800) return { label: "VIP",      color: "emerald" };
  if (score >= 600) return { label: "Trusted",  color: "blue" };
  if (score >= 400) return { label: "Reliable", color: "yellow" };
  if (score >= 250) return { label: "Standard", color: "orange" };
  return                    { label: "Shit Credit", color: "red" };
}

export function creditMaxLoan(score: number): number {
  return score * 500;
}

export function creditInterestRate(score: number): number {
  return Math.max(0, Math.round((25 - (score / 1000) * 15) * 10) / 10);
}

export function creditBlocked(score: number): boolean {
  return score < 250;
}
