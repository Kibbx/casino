import { Router } from "express";
import { db, loansTable, loanCommissionsTable, commissionPayoutsTable, playersTable, transactionsTable, creditTiersTable, loanTiersTable, settingsTable, bankerAccountsTable } from "@workspace/db";
import { eq, and, inArray, sql, asc, isNull } from "drizzle-orm";
import { requireLoanAccess } from "../middleware/auth.js";
import { todayEST } from "../utils/timezone.js";
import { updateCreditScore, creditTier, creditMaxLoan, creditInterestRate, creditBlocked, creditEligibility, getLoanSettings, saveLoanSettings, applyTrustedVolume } from "../lib/credit.js";
import { runEscalationJob } from "../lib/loan-jobs.js";

const router = Router();

function effectiveStatus(loan: { status: string; stage?: string | null; remainingBalance: number; dueDate: string | null }): string {
  if (loan.status === "paid" || loan.status === "defaulted") return loan.status;
  // Use DB stage if set (escalation job maintains this)
  if (loan.stage && loan.stage !== "active") return loan.stage;
  // Fallback: compute from dueDate
  if (loan.dueDate && todayEST() > loan.dueDate) return "overdue";
  return "active";
}

// GET /loans/active-summary — map of playerId -> { count, total } for active/overdue loans
router.get("/loans/active-summary", requireLoanAccess, async (_req, res) => {
  try {
    const all = await db.select().from(loansTable);
    const summary: Record<number, { count: number; total: number }> = {};
    const now = new Date();
    for (const loan of all) {
      const eff = effectiveStatus(loan);
      if (eff === "active" || eff === "overdue") {
        if (!summary[loan.playerId]) summary[loan.playerId] = { count: 0, total: 0 };
        summary[loan.playerId].count++;
        summary[loan.playerId].total += loan.remainingBalance;
      }
    }
    return res.json(summary);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/credit/:playerId — credit score + full eligibility for a player
router.get("/loans/credit/:playerId", requireLoanAccess, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId);
    if (isNaN(playerId)) return res.status(400).json({ error: "Invalid playerId" });
    const eligibility = await creditEligibility(playerId);
    // Also persist the updated score
    await updateCreditScore(playerId).catch(() => {});
    return res.json({
      creditScore: eligibility.score,
      tier: eligibility.tier,
      maxLoan: eligibility.maxLoan,
      interestRate: eligibility.interestRate,
      blocked: eligibility.blocked,
      reason: eligibility.reason,
      activeDays: eligibility.activeDays,
      totalWagered: eligibility.totalWagered,
      trustedVolume: eligibility.trustedVolume,
      loanTierName: eligibility.loanTierName,
      loanTierCap: eligibility.loanTierCap,
      loanNextTierName: eligibility.loanNextTierName,
      loanNextTierRequired: eligibility.loanNextTierRequired,
      loanProgressPct: eligibility.loanProgressPct,
      progressionBlocked: eligibility.progressionBlocked,
      progressionBlockReason: eligibility.progressionBlockReason,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/stats — aggregate loan stats for staff dashboard
router.get("/loans/stats", requireLoanAccess, async (_req, res) => {
  try {
    const all = await db.select().from(loansTable);
    let totalLoaned = 0;
    let totalRepaid = 0;
    let interestEarned = 0;
    let activeOutstanding = 0;
    let activeCount = 0;
    let defaultedLosses = 0;
    let defaultedCount = 0;

    for (const loan of all) {
      totalLoaned += loan.principalAmount;
      const history: { amount: number; date: string }[] = JSON.parse(loan.paymentHistory || "[]");
      const paid = history.reduce((s, p) => s + p.amount, 0);
      totalRepaid += paid;

      const eff = effectiveStatus(loan);
      if (eff === "paid") {
        const interest = loan.totalOwed - loan.principalAmount;
        interestEarned += Math.max(0, interest);
      }
      if (eff === "active" || eff === "overdue") {
        activeOutstanding += loan.remainingBalance;
        activeCount++;
      }
      if (loan.status === "defaulted") {
        defaultedLosses += loan.remainingBalance;
        defaultedCount++;
      }
    }

    // Credit score stats across all players who have loans
    const playerIds = [...new Set(all.map(l => l.playerId))];
    let avgCreditScore = 500;
    let riskyPlayerCount = 0;
    if (playerIds.length > 0) {
      const players = await db.select({ id: playersTable.id, creditScore: playersTable.creditScore }).from(playersTable);
      const loanPlayerScores = players.filter(p => playerIds.includes(p.id)).map(p => p.creditScore ?? 500);
      avgCreditScore = loanPlayerScores.length > 0 ? Math.round(loanPlayerScores.reduce((a, b) => a + b, 0) / loanPlayerScores.length) : 500;
      riskyPlayerCount = loanPlayerScores.filter(s => s < 400).length;
    }
    const riskyPercent = playerIds.length > 0 ? Math.round((riskyPlayerCount / playerIds.length) * 100) : 0;

    const totalLoanCount = all.length;
    const avgLoanSize = totalLoanCount > 0 ? Math.round(totalLoaned / totalLoanCount) : 0;
    const defaultRate = totalLoanCount > 0 ? Math.round((defaultedCount / totalLoanCount) * 1000) / 10 : 0;

    return res.json({
      totalLoaned, totalRepaid, interestEarned, activeOutstanding, activeCount, defaultedLosses, defaultedCount,
      avgCreditScore, riskyPercent, riskyPlayerCount, totalOutstandingRisk: activeOutstanding,
      avgLoanSize, defaultRate, totalLoanCount,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/monitor — live table of all open loans with player info and risk
router.get("/loans/monitor", requireLoanAccess, async (_req, res) => {
  try {
    const [allLoans, allPlayers, loanTiersList, settings] = await Promise.all([
      db.select().from(loansTable),
      db.select({ id: playersTable.id, username: playersTable.username, creditScore: playersTable.creditScore, trustedVolume: playersTable.trustedVolume }).from(playersTable),
      db.select().from(loanTiersTable).orderBy(asc(loanTiersTable.sortOrder)),
      db.select().from(settingsTable),
    ]);

    const settingsMap: Record<string, string> = {};
    for (const row of settings) {
      if (row.key.startsWith("loan.")) settingsMap[row.key.slice(5)] = row.value;
    }

    const playerMap: Record<number, { username: string; creditScore: number; trustedVolume: number }> = {};
    for (const p of allPlayers) playerMap[p.id] = { username: p.username, creditScore: p.creditScore ?? 500, trustedVolume: p.trustedVolume ?? 0 };

    const openStages = ["active", "overdue", "delinquent", "collections"];
    const openLoans = allLoans.filter(l => openStages.includes(effectiveStatus(l)));

    const { resolvePlayerLoanTier } = await import("../lib/credit.js");

    const rows = openLoans.map(loan => {
      const player = playerMap[loan.playerId] ?? { username: `#${loan.playerId}`, creditScore: 500, trustedVolume: 0 };
      const stage = effectiveStatus(loan);
      const { tier: lTier } = resolvePlayerLoanTier(player.trustedVolume, loanTiersList, settingsMap, [loan]);
      const cs = player.creditScore;
      const riskLevel = stage === "collections" || cs < 200 ? "Critical"
        : stage === "delinquent" || cs < 350 ? "High"
        : stage === "overdue" || cs < 500 ? "Medium" : "Low";
      return {
        loanId: loan.id,
        playerId: loan.playerId,
        playerName: player.username,
        bankerUsername: loan.bankerUsername,
        creditScore: cs,
        loanTierName: lTier?.name ?? "New",
        remainingBalance: loan.remainingBalance,
        principalAmount: loan.principalAmount,
        stage,
        riskLevel,
        dueDate: loan.dueDate,
        createdAt: loan.createdAt,
      };
    });

    rows.sort((a, b) => {
      const stageOrder: Record<string, number> = { collections: 0, delinquent: 1, overdue: 2, active: 3 };
      return (stageOrder[a.stage] ?? 4) - (stageOrder[b.stage] ?? 4);
    });

    return res.json(rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/player/:playerId — get all loans for a player
router.get("/loans/player/:playerId", requireLoanAccess, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId);
    if (isNaN(playerId)) return res.status(400).json({ error: "Invalid playerId" });

    const loans = await db.select().from(loansTable).where(eq(loansTable.playerId, playerId));
    const result = loans.map(l => ({ ...l, effectiveStatus: effectiveStatus(l) }));
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /loans/player/:playerId — create a loan
router.post("/loans/player/:playerId", requireLoanAccess, async (req, res) => {
  try {
    const playerId = parseInt(req.params.playerId);
    if (isNaN(playerId)) return res.status(400).json({ error: "Invalid playerId" });

    const { amount, interestRate, dueDate, notes, disbursementType } = req.body;
    const principal = parseInt(amount);
    const rate = parseFloat(interestRate ?? "0");
    const disburseAs: "chips" | "cash" = disbursementType === "cash" ? "cash" : "chips";
    if (!principal || principal <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (isNaN(rate) || rate < 0) return res.status(400).json({ error: "Invalid interest rate" });

    const players = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
    if (!players.length) return res.status(404).json({ error: "Player not found" });

    // Server-side cap enforcement — loan tiers and credit score both set ceilings
    const eligibility = await creditEligibility(playerId);
    if (principal > eligibility.maxLoan) {
      return res.status(400).json({
        error: `Amount exceeds this player's loan cap of ${eligibility.maxLoan.toLocaleString()} chips (${eligibility.loanTierName} tier, credit score ${eligibility.score})`,
      });
    }

    const totalOwed = Math.round(principal + (principal * rate / 100));

    const bankerUsername = (req as any).bankerSession?.username || "staff";

    const [loan] = await db.insert(loansTable).values({
      playerId,
      bankerUsername,
      principalAmount: principal,
      interestRate: rate,
      totalOwed,
      remainingBalance: totalOwed,
      dueDate: dueDate || null,
      status: "active",
      notes: notes || null,
      paymentHistory: "[]",
    }).returning();

    // Add chips only when disbursing as chips; cash means staff hands money IRL
    let newChips = Number(players[0].chips);
    if (disburseAs === "chips") {
      newChips += principal;
      await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, playerId));
    }

    await db.insert(transactionsTable).values({
      playerId,
      type: "loan_issued",
      amount: principal,
      description: `Casino loan issued — $${principal.toLocaleString()} disbursed as ${disburseAs} (${rate}% interest, total owed: $${totalOwed.toLocaleString()})`,
      staffUsername: bankerUsername,
    });

    // Cash disbursement: cash physically left the casino — record as a withdrawal so crate balance reflects it
    if (disburseAs === "cash") {
      await db.insert(transactionsTable).values({
        playerId,
        type: "withdrawal",
        amount: principal,
        description: `Loan #${loan.id} cash disbursement — $${principal.toLocaleString()} cash paid out to player`,
        staffUsername: bankerUsername,
      });
    }

    return res.json({ ...loan, effectiveStatus: "active", newChips, disbursementType: disburseAs });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /loans/:loanId/payment — record a loan payment
router.post("/loans/:loanId/payment", requireLoanAccess, async (req, res) => {
  try {
    const loanId = parseInt(req.params.loanId);
    if (isNaN(loanId)) return res.status(400).json({ error: "Invalid loanId" });

    const { amount, paymentType } = req.body;
    const payment = parseInt(amount);
    const payAs: "chips" | "cash" = paymentType === "cash" ? "cash" : "chips";
    if (!payment || payment <= 0) return res.status(400).json({ error: "Invalid payment amount" });

    const loans = await db.select().from(loansTable).where(eq(loansTable.id, loanId));
    if (!loans.length) return res.status(404).json({ error: "Loan not found" });
    const loan = loans[0];

    if (loan.status === "paid") return res.status(400).json({ error: "Loan is already fully paid" });

    const players = await db.select().from(playersTable).where(eq(playersTable.id, loan.playerId));
    if (!players.length) return res.status(404).json({ error: "Player not found" });

    // Chip payments require the player to have enough chips; cash payments are IRL
    if (payAs === "chips" && Number(players[0].chips) < payment) {
      return res.status(400).json({ error: "Player has insufficient chips" });
    }

    const history: { amount: number; date: string; type?: string }[] = JSON.parse(loan.paymentHistory || "[]");

    // Commission calculation: interest is paid first before principal
    const totalInterest = loan.totalOwed - loan.principalAmount;
    const prevPaid = history.reduce((s, p) => s + p.amount, 0);
    const interestAlreadyPaid = Math.min(prevPaid, totalInterest);
    const remainingInterest = Math.max(0, totalInterest - interestAlreadyPaid);
    const interestThisPayment = Math.min(payment, remainingInterest);
    const employeeCommission = Math.round(interestThisPayment / 2);
    const casinoCommission = interestThisPayment - employeeCommission;

    history.push({ amount: payment, date: new Date().toISOString(), type: payAs });

    const newBalance = Math.max(0, loan.remainingBalance - payment);
    const newStatus = newBalance === 0 ? "paid" : loan.status;

    await db.update(loansTable).set({
      remainingBalance: newBalance,
      status: newStatus,
      paymentHistory: JSON.stringify(history),
      updatedAt: new Date(),
    }).where(eq(loansTable.id, loanId));

    // Record commission split if any interest was collected
    if (interestThisPayment > 0) {
      await db.insert(loanCommissionsTable).values({
        loanId,
        bankerUsername: loan.bankerUsername,
        paymentAmount: payment,
        interestPortion: interestThisPayment,
        employeeCommission,
        casinoCommission,
      });
    }

    let newChips = Number(players[0].chips);
    if (payAs === "chips") {
      newChips -= payment;
      await db.update(playersTable).set({ chips: newChips }).where(eq(playersTable.id, loan.playerId));
    }

    const bankerUsername = (req as any).bankerSession?.username || "staff";
    await db.insert(transactionsTable).values({
      playerId: loan.playerId,
      type: "loan_repayment",
      amount: payment,
      description: `Loan #${loanId} repayment — $${payment.toLocaleString()} paid in ${payAs} (remaining: $${newBalance.toLocaleString()})`,
      staffUsername: bankerUsername,
    });

    // Cash repayment: cash physically returned to the casino — record as a deposit so crate balance reflects it
    if (payAs === "cash") {
      await db.insert(transactionsTable).values({
        playerId: loan.playerId,
        type: "deposit",
        amount: payment,
        description: `Loan #${loanId} cash repayment — $${payment.toLocaleString()} cash received from player`,
        staffUsername: bankerUsername,
      });
    }

    const newCreditScore = await updateCreditScore(loan.playerId).catch(() => null);

    // Update trusted volume with weighted progression increment
    let newTrustedVolume: number | null = null;
    try {
      newTrustedVolume = await applyTrustedVolume(loan.playerId, loan.principalAmount, payment);
    } catch (_e) {}

    return res.json({ success: true, newBalance, status: newStatus, newChips, creditScore: newCreditScore, trustedVolume: newTrustedVolume, paymentType: payAs });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /loans/:loanId/status — update status (defaulted, closed/paid, reopen)
router.patch("/loans/:loanId/status", requireLoanAccess, async (req, res) => {
  try {
    const loanId = parseInt(req.params.loanId);
    if (isNaN(loanId)) return res.status(400).json({ error: "Invalid loanId" });

    const { status } = req.body;
    if (!["active", "paid", "defaulted"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be active, paid, or defaulted." });
    }

    const loans = await db.select().from(loansTable).where(eq(loansTable.id, loanId));
    if (!loans.length) return res.status(404).json({ error: "Loan not found" });

    await db.update(loansTable).set({ status, updatedAt: new Date() }).where(eq(loansTable.id, loanId));

    const newCreditScore = await updateCreditScore(loans[0].playerId).catch(() => null);

    return res.json({ success: true, status, creditScore: newCreditScore });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── LOAN SETTINGS ─────────────────────────────────────────────────────────────

// GET /loans/settings — return all loan.* settings
router.get("/loans/settings", requireLoanAccess, async (_req, res) => {
  try {
    const settings = await getLoanSettings();
    return res.json(settings);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// PUT /loans/settings — update one or more loan.* settings
router.put("/loans/settings", requireLoanAccess, async (req, res) => {
  try {
    const updates = req.body as Record<string, string>;
    if (!updates || typeof updates !== "object") return res.status(400).json({ error: "Body must be an object" });
    await saveLoanSettings(updates);
    // Re-run escalation immediately so stage changes take effect
    runEscalationJob().catch(() => {});
    const settings = await getLoanSettings();
    return res.json(settings);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── CREDIT TIERS ──────────────────────────────────────────────────────────────

// GET /loans/credit-tiers
router.get("/loans/credit-tiers", requireLoanAccess, async (_req, res) => {
  try {
    const tiers = await db.select().from(creditTiersTable).orderBy(asc(creditTiersTable.minScore));
    return res.json(tiers);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /loans/credit-tiers — create a tier
router.post("/loans/credit-tiers", requireLoanAccess, async (req, res) => {
  try {
    const { name, minScore, interestModifier, loanMultiplier } = req.body;
    if (!name || minScore == null) return res.status(400).json({ error: "name and minScore are required" });
    const [tier] = await db.insert(creditTiersTable).values({
      name,
      minScore: parseInt(minScore),
      interestModifier: parseFloat(interestModifier ?? "0"),
      loanMultiplier: parseFloat(loanMultiplier ?? "1"),
    }).returning();
    return res.status(201).json(tier);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /loans/credit-tiers/:id — update a tier
router.patch("/loans/credit-tiers/:id", requireLoanAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, minScore, interestModifier, loanMultiplier } = req.body;
    const updates: any = {};
    if (name != null) updates.name = name;
    if (minScore != null) updates.minScore = parseInt(minScore);
    if (interestModifier != null) updates.interestModifier = parseFloat(interestModifier);
    if (loanMultiplier != null) updates.loanMultiplier = parseFloat(loanMultiplier);
    const [tier] = await db.update(creditTiersTable).set(updates).where(eq(creditTiersTable.id, id)).returning();
    if (!tier) return res.status(404).json({ error: "Tier not found" });
    return res.json(tier);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /loans/credit-tiers/:id
router.delete("/loans/credit-tiers/:id", requireLoanAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(creditTiersTable).where(eq(creditTiersTable.id, id));
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── LOAN TIERS (volume-based progression) ─────────────────────────────────────

// GET /loans/loan-tiers
router.get("/loans/loan-tiers", requireLoanAccess, async (_req, res) => {
  try {
    const tiers = await db.select().from(loanTiersTable).orderBy(asc(loanTiersTable.sortOrder));
    return res.json(tiers);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /loans/loan-tiers
router.post("/loans/loan-tiers", requireLoanAccess, async (req, res) => {
  try {
    const { name, requiredRepaid, cap, sortOrder } = req.body;
    if (!name || cap == null) return res.status(400).json({ error: "name and cap are required" });
    const [tier] = await db.insert(loanTiersTable).values({
      name,
      requiredRepaid: parseInt(requiredRepaid ?? "0"),
      cap: parseInt(cap),
      sortOrder: parseInt(sortOrder ?? "0"),
    }).returning();
    return res.status(201).json(tier);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /loans/loan-tiers/:id
router.patch("/loans/loan-tiers/:id", requireLoanAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, requiredRepaid, cap, sortOrder } = req.body;
    const updates: any = {};
    if (name != null) updates.name = name;
    if (requiredRepaid != null) updates.requiredRepaid = parseInt(requiredRepaid);
    if (cap != null) updates.cap = parseInt(cap);
    if (sortOrder != null) updates.sortOrder = parseInt(sortOrder);
    const [tier] = await db.update(loanTiersTable).set(updates).where(eq(loanTiersTable.id, id)).returning();
    if (!tier) return res.status(404).json({ error: "Tier not found" });
    return res.json(tier);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /loans/loan-tiers/:id
router.delete("/loans/loan-tiers/:id", requireLoanAccess, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(loanTiersTable).where(eq(loanTiersTable.id, id));
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/employee-stats — per-banker performance & commission breakdown (banker/owner view)
router.get("/loans/employee-stats", requireLoanAccess, async (_req, res) => {
  try {
    const [allLoans, allCommissions, recentPayouts] = await Promise.all([
      db.select().from(loansTable),
      db.select().from(loanCommissionsTable),
      db.select().from(commissionPayoutsTable),
    ]);

    type BankerEntry = {
      totalLoans: number; activeLoans: number; overdueLoans: number;
      paidLoans: number; defaultedLoans: number; totalPrincipal: number;
      totalCommission: number; unpaidCommission: number;
      totalCasinoRevenue: number; totalInterestCollected: number;
      lastPaidOut: string | null; lastPaidOutAmount: number;
    };
    const bankerMap: Record<string, BankerEntry> = {};

    const ensure = (u: string) => {
      if (!bankerMap[u]) bankerMap[u] = {
        totalLoans: 0, activeLoans: 0, overdueLoans: 0, paidLoans: 0,
        defaultedLoans: 0, totalPrincipal: 0, totalCommission: 0,
        unpaidCommission: 0, totalCasinoRevenue: 0, totalInterestCollected: 0,
        lastPaidOut: null, lastPaidOutAmount: 0,
      };
    };

    for (const loan of allLoans) {
      const u = loan.bankerUsername || "unknown";
      ensure(u);
      const e = bankerMap[u];
      e.totalLoans++;
      e.totalPrincipal += loan.principalAmount;
      const eff = effectiveStatus(loan);
      if (eff === "paid") e.paidLoans++;
      else if (eff === "defaulted") e.defaultedLoans++;
      else if (["overdue", "delinquent", "collections"].includes(eff)) e.overdueLoans++;
      else e.activeLoans++;
    }

    for (const c of allCommissions) {
      const u = c.bankerUsername || "unknown";
      ensure(u);
      bankerMap[u].totalCommission += c.employeeCommission;
      bankerMap[u].totalCasinoRevenue += c.casinoCommission;
      bankerMap[u].totalInterestCollected += c.interestPortion;
      if (!c.paidAt) bankerMap[u].unpaidCommission += c.employeeCommission;
    }

    // Attach most recent payout info per banker
    for (const p of recentPayouts) {
      const u = p.bankerUsername;
      ensure(u);
      if (!bankerMap[u].lastPaidOut || p.createdAt > new Date(bankerMap[u].lastPaidOut!)) {
        bankerMap[u].lastPaidOut = p.createdAt.toISOString();
        bankerMap[u].lastPaidOutAmount = p.amount;
      }
    }

    const result = Object.entries(bankerMap)
      .map(([username, stats]) => ({ username, ...stats }))
      .sort((a, b) => b.totalLoans - a.totalLoans);

    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/all-details — full loan list with player names (banker/owner view)
router.get("/loans/all-details", requireLoanAccess, async (req, res) => {
  try {
    const bankerFilter = (req.query.banker as string) || null;

    const [allLoans, allPlayers] = await Promise.all([
      db.select().from(loansTable),
      db.select({ id: playersTable.id, username: playersTable.username }).from(playersTable),
    ]);

    const playerMap: Record<number, string> = {};
    for (const p of allPlayers) playerMap[p.id] = p.username;

    let result = allLoans.map(loan => ({
      ...loan,
      playerName: playerMap[loan.playerId] ?? `#${loan.playerId}`,
      effectiveStatus: effectiveStatus(loan),
      interestTotal: loan.totalOwed - loan.principalAmount,
    }));

    if (bankerFilter) {
      result = result.filter(l => l.bankerUsername === bankerFilter);
    }

    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/commissions — commission ledger, optionally filtered by ?banker=username
router.get("/loans/commissions", requireLoanAccess, async (req, res) => {
  try {
    const bankerFilter = (req.query.banker as string) || null;
    let rows = await db.select().from(loanCommissionsTable);
    if (bankerFilter) rows = rows.filter(r => r.bankerUsername === bankerFilter);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /loans/commission-payouts — payout history, optionally filtered by ?banker=username
router.get("/loans/commission-payouts", requireLoanAccess, async (req, res) => {
  try {
    const bankerFilter = (req.query.banker as string) || null;
    let rows = await db.select().from(commissionPayoutsTable);
    if (bankerFilter) rows = rows.filter(r => r.bankerUsername === bankerFilter);
    rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return res.json(rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// POST /loans/commissions/pay-employee — mark commission rows as paid, optionally deliver chips
router.post("/loans/commissions/pay-employee", requireLoanAccess, async (req, res) => {
  try {
    const { bankerUsername, amount, note } = req.body as {
      bankerUsername: string; amount: number; note?: string;
    };
    const paidBy: string = (req as any).banker?.username ?? "system";

    if (!bankerUsername || typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "bankerUsername and positive amount required" });
    }

    // Fetch all unpaid commission rows for this banker, oldest first
    const unpaidRows = await db
      .select()
      .from(loanCommissionsTable)
      .where(
        and(
          eq(loanCommissionsTable.bankerUsername, bankerUsername),
          isNull(loanCommissionsTable.paidAt)
        )
      )
      .orderBy(asc(loanCommissionsTable.createdAt));

    const totalUnpaid = unpaidRows.reduce((s, r) => s + r.employeeCommission, 0);
    if (amount > totalUnpaid) {
      return res.status(400).json({ error: `Cannot pay more than unpaid balance (${totalUnpaid})` });
    }

    // Mark rows as paid oldest-first up to the requested amount
    let remaining = amount;
    const rowsToMark: number[] = [];
    for (const row of unpaidRows) {
      if (remaining <= 0) break;
      if (row.employeeCommission <= remaining) {
        rowsToMark.push(row.id);
        remaining -= row.employeeCommission;
      } else {
        // Partial row — for simplicity we mark it fully if within 5% tolerance, else stop
        if (remaining >= row.employeeCommission * 0.95) {
          rowsToMark.push(row.id);
          remaining = 0;
        }
        break;
      }
    }

    const now = new Date();
    if (rowsToMark.length > 0) {
      await db
        .update(loanCommissionsTable)
        .set({ paidAt: now, paidBy })
        .where(inArray(loanCommissionsTable.id, rowsToMark));
    }

    let chipsDelivered = false;
    let linkedPlayerId: number | null = null;

    // Try to find the employee's player account:
    // 1. By stateId (if set on their banker account)
    // 2. By exact username match (most common case — staff play under same name)
    let linkedPlayer: { id: number; chips: number } | null = null;

    const bankerAccount = await db
      .select()
      .from(bankerAccountsTable)
      .where(eq(bankerAccountsTable.username, bankerUsername))
      .then(r => r[0] ?? null);

    if (bankerAccount?.stateId) {
      linkedPlayer = await db
        .select({ id: playersTable.id, chips: playersTable.chips })
        .from(playersTable)
        .where(eq(playersTable.stateId, bankerAccount.stateId))
        .then(r => r[0] ?? null);
    }

    if (!linkedPlayer) {
      linkedPlayer = await db
        .select({ id: playersTable.id, chips: playersTable.chips })
        .from(playersTable)
        .where(sql`LOWER(username) = LOWER(${bankerUsername})`)
        .then(r => r[0] ?? null);
    }

    if (linkedPlayer) {
      linkedPlayerId = linkedPlayer.id;
      await db
        .update(playersTable)
        .set({ chips: linkedPlayer.chips + amount })
        .where(eq(playersTable.id, linkedPlayer.id));

      await db.insert(transactionsTable).values({
        playerId: linkedPlayer.id,
        amount,
        type: "bonus",
        description: `Commission payout from ${paidBy} — loan interest earnings`,
        staffId: null,
        staffUsername: paidBy,
      });

      chipsDelivered = true;
    }

    // Record the payout event
    await db.insert(commissionPayoutsTable).values({
      bankerUsername,
      amount,
      rowsMarked: rowsToMark.length,
      chipsDelivered,
      linkedPlayerId,
      paidBy,
      note: note ?? null,
    });

    return res.json({
      ok: true,
      rowsMarked: rowsToMark.length,
      amountPaid: amount,
      chipsDelivered,
      linkedPlayerId,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
