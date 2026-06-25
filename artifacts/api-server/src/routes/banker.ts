import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { db, settingsTable, playersTable, transactionsTable, bankerAccountsTable, tournamentsTable, tournamentEntriesTable, pokerTablesTable, houseFinancesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { todayEST } from "../utils/timezone.js";
import {
  createBankerSession,
  sessionHasRole,
  revokeAllBankerSessionsForAccount,
  checkIpLocked,
  recordIpFailure,
  clearIpFailures,
} from "../lib/sessions.js";
import { requireBanker, requireAdmin, requireOwner, requireDealerOrAbove, requireBankerOrOwner } from "../middleware/auth.js";
import { getApiStats } from "../lib/req-stats.js";
import { broadcastTablesUpdate } from "../lib/table-ws.js";
import { serializeTable, notifyTableUpdate } from "../lib/table-cache.js";

const router = Router();

const VALID_ROLES = ["owner", "banker", "dealer", "sportbets", "security_guard", "pit_boss", "cage_clerk", "junior_banker"] as const;
type StaffRole = typeof VALID_ROLES[number];

// ── Seed initial admin on startup ──────────────────────────────────────────────
export async function seedBankerAdmin() {
  const username = process.env.BANKER_ADMIN_USERNAME || "admin";

  const existing = await db.select().from(bankerAccountsTable).where(eq(bankerAccountsTable.username, username));

  if (existing.length === 0) {
    // Only set password on first creation
    const password = process.env.BANKER_ADMIN_PASSWORD;
    if (!password) {
      console.error("[Staff] BANKER_ADMIN_PASSWORD secret is not set — cannot create owner account.");
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await db.insert(bankerAccountsTable).values({
      username,
      passwordHash: hash,
      isAdmin: true,
      isActive: true,
      role: "owner",
    });
    console.log(`[Staff] Owner account created — username: "${username}"`);
  } else {
    // Never touch the password — only ensure role/active status is correct
    await db.update(bankerAccountsTable)
      .set({ isAdmin: true, isActive: true, failedAttempts: 0, lockedUntil: null, role: "owner" })
      .where(eq(bankerAccountsTable.username, username));
    console.log(`[Staff] Owner account verified — username: "${username}"`);
  }
}

// ── Login ──────────────────────────────────────────────────────────────────────

const ACCOUNT_MAX_FAILS = 5;
const ACCOUNT_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

router.post("/login", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

  if (checkIpLocked(ip)) {
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });
  }

  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Invalid credentials." });
  }

  const [account] = await db
    .select()
    .from(bankerAccountsTable)
    .where(eq(bankerAccountsTable.username, username));

  const GENERIC_ERROR = "Invalid credentials.";

  if (!account || !account.isActive) {
    recordIpFailure(ip);
    await new Promise((r) => setTimeout(r, 500));
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  if (account.lockedUntil && new Date(account.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(account.lockedUntil).getTime() - Date.now()) / 60000);
    return res.status(429).json({ error: `Account temporarily locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.` });
  }

  const valid = await bcrypt.compare(password, account.passwordHash);

  if (!valid) {
    const newFails = account.failedAttempts + 1;
    const lockedUntil = newFails >= ACCOUNT_MAX_FAILS ? new Date(Date.now() + ACCOUNT_LOCKOUT_MS) : null;
    await db.update(bankerAccountsTable)
      .set({ failedAttempts: newFails, lockedUntil })
      .where(eq(bankerAccountsTable.id, account.id));
    recordIpFailure(ip);
    return res.status(401).json({ error: GENERIC_ERROR });
  }

  await db.update(bankerAccountsTable)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(bankerAccountsTable.id, account.id));
  clearIpFailures(ip);

  const role = (account.role as StaffRole) || "banker";
  const role2 = account.role2 ?? null;
  let roles: string[] = [];
  if (account.rolesJson) {
    try { roles = JSON.parse(account.rolesJson); } catch {}
  }
  if (roles.length === 0) roles = [role, role2].filter(Boolean) as string[];
  const token = createBankerSession(account.id, account.username, account.isAdmin, role, role2, roles);
  return res.json({ success: true, token, username: account.username, isAdmin: account.isAdmin, role, role2, roles, stateId: account.stateId ?? null });
});

// ── Current banker's own profile ──────────────────────────────────────────────

router.get("/me", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const [account] = await db.select({
    id: bankerAccountsTable.id,
    username: bankerAccountsTable.username,
    role: bankerAccountsTable.role,
    role2: bankerAccountsTable.role2,
    rolesJson: bankerAccountsTable.rolesJson,
    stateId: bankerAccountsTable.stateId,
    isAdmin: bankerAccountsTable.isAdmin,
  }).from(bankerAccountsTable).where(eq(bankerAccountsTable.id, session.accountId));
  if (!account) return res.status(404).json({ error: "Account not found." });
  return res.json(account);
});

// ── Staff account management (owner only) ──────────────────────────────────────

router.get("/accounts", requireBankerOrOwner, async (_req, res) => {
  const accounts = await db.select({
    id: bankerAccountsTable.id,
    username: bankerAccountsTable.username,
    isActive: bankerAccountsTable.isActive,
    isAdmin: bankerAccountsTable.isAdmin,
    role: bankerAccountsTable.role,
    role2: bankerAccountsTable.role2,
    rolesJson: bankerAccountsTable.rolesJson,
    stateId: bankerAccountsTable.stateId,
    createdAt: bankerAccountsTable.createdAt,
    lastLoginAt: bankerAccountsTable.lastLoginAt,
    failedAttempts: bankerAccountsTable.failedAttempts,
    lockedUntil: bankerAccountsTable.lockedUntil,
  }).from(bankerAccountsTable);
  res.json(accounts);
});

router.post("/accounts", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const callerIsOwner = sessionHasRole(session, "owner");
  const { username, password, role, role2, roles: rolesBody, stateId: stateIdBody } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password are required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}.` });
  // Bankers can only create sub-roles — not owner or banker
  if (!callerIsOwner && (role === "owner" || role === "banker")) {
    return res.status(403).json({ error: "Bankers cannot create owner or banker accounts." });
  }

  const existing = await db.select().from(bankerAccountsTable).where(eq(bankerAccountsTable.username, username));
  if (existing.length > 0) return res.status(400).json({ error: "Username already exists." });

  const assignedRole: StaffRole = (role as StaffRole) || "dealer";
  const assignedRole2: string | null = (role2 && VALID_ROLES.includes(role2) && role2 !== assignedRole) ? role2 : null;

  // Build full roles array — prefer explicit roles array, fall back to role/role2
  const incomingRoles: string[] = Array.isArray(rolesBody) ? rolesBody.filter((r: string) => VALID_ROLES.includes(r)) : [];
  const allAssignedRoles = incomingRoles.length > 0 ? incomingRoles : [assignedRole, assignedRole2].filter(Boolean) as string[];
  const rolesJson = JSON.stringify(allAssignedRoles);

  const hash = await bcrypt.hash(password, 12);
  const [created] = await db.insert(bankerAccountsTable).values({
    username,
    passwordHash: hash,
    isAdmin: allAssignedRoles.includes("owner"),
    isActive: true,
    role: allAssignedRoles[0] as StaffRole ?? assignedRole,
    role2: allAssignedRoles[1] ?? assignedRole2,
    rolesJson,
    stateId: stateIdBody ?? null,
  }).returning({
    id: bankerAccountsTable.id,
    username: bankerAccountsTable.username,
    isAdmin: bankerAccountsTable.isAdmin,
    isActive: bankerAccountsTable.isActive,
    role: bankerAccountsTable.role,
    role2: bankerAccountsTable.role2,
    rolesJson: bankerAccountsTable.rolesJson,
    stateId: bankerAccountsTable.stateId,
    createdAt: bankerAccountsTable.createdAt,
  });

  return res.json(created);
});

router.patch("/accounts/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const session = (req as any).bankerSession;
  const callerIsOwner = sessionHasRole(session, "owner");
  const { isActive, role, role2, roles: rolesBody, password, stateId: stateIdBody } = req.body;

  if (session.accountId === id && isActive === false) {
    return res.status(400).json({ error: "You cannot deactivate your own account." });
  }
  if (session.accountId === id && role && role !== "owner") {
    return res.status(400).json({ error: "You cannot change your own role." });
  }

  // Bankers cannot edit owner or banker accounts (only owners can)
  // Exception: any banker may update their own stateId
  const isSelfStateIdOnly = session.accountId === id
    && "stateId" in req.body
    && !isActive && !role && !role2 && !rolesBody && !password;
  if (!callerIsOwner && !isSelfStateIdOnly) {
    const [target] = await db.select({ role: bankerAccountsTable.role }).from(bankerAccountsTable).where(eq(bankerAccountsTable.id, id));
    if (target && (target.role === "owner" || target.role === "banker")) {
      return res.status(403).json({ error: "Bankers cannot edit owner or banker accounts." });
    }
    // Bankers cannot promote someone to owner or banker
    if (role === "owner" || role === "banker") {
      return res.status(403).json({ error: "Bankers cannot assign owner or banker roles." });
    }
  }

  const updates: Record<string, any> = {};
  if (typeof isActive === "boolean") updates.isActive = isActive;
  if ("stateId" in req.body) updates.stateId = stateIdBody ?? null;

  // Full roles array takes priority over individual role/role2
  if (Array.isArray(rolesBody)) {
    const validRoles = rolesBody.filter((r: string) => VALID_ROLES.includes(r));
    if (validRoles.length > 0) {
      updates.role = validRoles[0];
      updates.role2 = validRoles[1] ?? null;
      updates.rolesJson = JSON.stringify(validRoles);
      updates.isAdmin = validRoles.includes("owner");
    }
  } else {
    if (role) {
      if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}.` });
      updates.role = role;
      updates.isAdmin = role === "owner";
    }
    if ("role2" in req.body) {
      if (role2 === null || role2 === "" || role2 === "none") {
        updates.role2 = null;
      } else if (VALID_ROLES.includes(role2)) {
        updates.role2 = role2;
      }
    }
    // Sync rolesJson from role/role2 if those changed
    if (role || "role2" in req.body) {
      const newRole = updates.role ?? role;
      const newRole2 = "role2" in updates ? updates.role2 : role2;
      const syncedRoles = [newRole, newRole2].filter(Boolean) as string[];
      if (syncedRoles.length > 0) updates.rolesJson = JSON.stringify(syncedRoles);
    }
  }

  if (password) {
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    updates.passwordHash = await bcrypt.hash(password, 12);
    updates.failedAttempts = 0;
    updates.lockedUntil = null;
  }

  try {
    if (isActive === false || role || Array.isArray(rolesBody)) revokeAllBankerSessionsForAccount(id);

    await db.update(bankerAccountsTable).set(updates).where(eq(bankerAccountsTable.id, id));
    const [updated] = await db.select({
      id: bankerAccountsTable.id,
      username: bankerAccountsTable.username,
      isActive: bankerAccountsTable.isActive,
      isAdmin: bankerAccountsTable.isAdmin,
      role: bankerAccountsTable.role,
      role2: bankerAccountsTable.role2,
      rolesJson: bankerAccountsTable.rolesJson,
      stateId: bankerAccountsTable.stateId,
    }).from(bankerAccountsTable).where(eq(bankerAccountsTable.id, id));

    return res.json(updated);
  } catch (err: any) {
    console.error("Account update error:", err?.message ?? err);
    return res.status(500).json({ error: "Database error updating account." });
  }
});

router.delete("/accounts/:id", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const session = (req as any).bankerSession;
  const callerIsOwner = sessionHasRole(session, "owner");
  if (session.accountId === id) return res.status(400).json({ error: "You cannot delete your own account." });
  // Bankers cannot delete owner or banker accounts
  if (!callerIsOwner) {
    const [target] = await db.select({ role: bankerAccountsTable.role }).from(bankerAccountsTable).where(eq(bankerAccountsTable.id, id));
    if (target && (target.role === "owner" || target.role === "banker")) {
      return res.status(403).json({ error: "Bankers cannot delete owner or banker accounts." });
    }
  }
  revokeAllBankerSessionsForAccount(id);
  await db.delete(bankerAccountsTable).where(eq(bankerAccountsTable.id, id));
  return res.json({ success: true });
});

// ── Player password reset (owner only) ────────────────────────────────────────

router.post("/players/:id/reset-password", requireOwner, async (req, res) => {
  const playerId = parseInt(req.params.id as string);
  const { newPin } = req.body;

  if (!newPin || String(newPin).length < 4) {
    return res.status(400).json({ error: "New PIN must be at least 4 characters." });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found." });

  await db.update(playersTable).set({ pin: String(newPin) }).where(eq(playersTable.id, playerId));

  return res.json({ success: true, message: `PIN reset for player "${player.username}".` });
});

// ── House chip deposit (owner/banker) ─────────────────────────────────────────

router.post("/house-deposit", requireBanker, async (req, res) => {
  const session = (req as any).bankerSession;
  if (!["owner", "banker"].includes(session.role)) {
    return res.status(403).json({ error: "Banker or owner access required." });
  }

  const { amount, reason } = req.body;
  const amt = parseInt(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number." });

  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;

  const current = parseInt(map["houseChips"] ?? "0");
  const newBalance = current + amt;

  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, "houseChips"));
  if (existing.length === 0) {
    await db.insert(settingsTable).values({ key: "houseChips", value: String(newBalance) });
  } else {
    await db.update(settingsTable).set({ value: String(newBalance) }).where(eq(settingsTable.key, "houseChips"));
  }

  const houseDepositTotal = parseInt(map["houseTotalDeposited"] ?? "0") + amt;
  const existingHouseDep = await db.select().from(settingsTable).where(eq(settingsTable.key, "houseTotalDeposited"));
  if (existingHouseDep.length === 0) {
    await db.insert(settingsTable).values({ key: "houseTotalDeposited", value: String(houseDepositTotal) });
  } else {
    await db.update(settingsTable).set({ value: String(houseDepositTotal) }).where(eq(settingsTable.key, "houseTotalDeposited"));
  }

  return res.json({
    success: true,
    houseChips: newBalance,
    deposited: amt,
    reason: reason || "House deposit",
    by: session.username,
  });
});

router.get("/house-chips", requireBanker, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({
    houseChips: parseInt(map["houseChips"] ?? "0"),
    houseTotalDeposited: parseInt(map["houseTotalDeposited"] ?? "0"),
  });
});

// ── House finances: crate + bank tracking ─────────────────────────────────────

async function computeFinances() {
  // Chip revenue: only REAL cash deposits/withdrawals (bankers exchanging physical cash for chips).
  // Excluded intentionally:
  //   - BET deposits ("BET deposit%"): token-to-chip conversions, not real cash
  //   - Babalari accepted ("Babalari accepted%"): foreign-currency conversions, not real cash
  //   - Chip transfers ("Chip transfer%"): peer-to-peer, no cash changes hands
  //   - transfer_sent / transfer_received: new-style chip transfers
  const cashAgg = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'deposit'    THEN amount ELSE 0 END), 0)::int AS deposits,
      COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0)::int AS withdrawals
    FROM transactions
    WHERE type NOT IN ('transfer_sent', 'transfer_received')
      AND description NOT ILIKE 'Chip transfer%'
      AND description NOT ILIKE 'BET deposit%'
      AND description NOT ILIKE 'Babalari accepted%'
  `);
  const cashRow = (cashAgg.rows as any[])[0] ?? {};
  const netChipRevenue = Number(cashRow.deposits ?? 0) - Number(cashRow.withdrawals ?? 0);

  // Manual adjustments from house_finances table (all records)
  const all = await db.select().from(houseFinancesTable);
  let manualCrate = 0;
  let bankBalance = 0;
  for (const tx of all) {
    const delta = tx.type === "deposit" ? tx.amount : -tx.amount;
    if (tx.source === "crate") manualCrate += delta;
    else if (tx.source === "bank") bankBalance += delta;
  }

  // Crate = chip revenue from player transactions + manual crate adjustments
  const crateBalance = netChipRevenue + manualCrate;

  // Manual log entries (all — frontend paginates)
  const manualTxs = await db
    .select()
    .from(houseFinancesTable)
    .orderBy(desc(houseFinancesTable.createdAt));

  // Player chip deposits/withdrawals/gifts — real cash & gift movements (no BET/Babalari conversions, no transfers)
  const chipTxRows = await db.execute(sql`
    SELECT t.id, t.type, t.amount, t.description, t.created_at, t.staff_username, p.username AS player_name
    FROM transactions t
    LEFT JOIN players p ON p.id = t.player_id
    WHERE t.type IN ('deposit', 'withdrawal', 'bonus')
      AND t.type NOT IN ('transfer_sent', 'transfer_received')
      AND t.description NOT ILIKE 'Chip transfer%'
      AND t.description NOT ILIKE 'BET deposit%'
      AND t.description NOT ILIKE 'Babalari accepted%'
      AND t.description NOT ILIKE 'Referral bonus%'
    ORDER BY t.created_at DESC
  `);
  const chipTxs = (chipTxRows.rows as any[]).map((r) => ({
    id: `chip-${r.id}`,
    source: "crate",
    type: r.type === "deposit" ? "deposit" : r.type === "withdrawal" ? "withdraw" : "bonus",
    amount: Number(r.amount),
    reason: `${r.player_name ?? "Player"} — ${r.description || (r.type === "deposit" ? "chip buy-in" : r.type === "withdrawal" ? "chip cashout" : "gift")}`,
    staffUsername: r.staff_username || null,
    createdAt: r.created_at,
    isChipTx: true,
  }));

  // Merge and sort both lists by date — no artificial cap, frontend paginates
  const allTxs = [...manualTxs.map(t => ({ ...t, isChipTx: false })), ...chipTxs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { crateBalance, bankBalance, netChipRevenue, manualCrate, transactions: allTxs };
}

router.get("/house-finances", requireBanker, async (_req, res) => {
  const data = await computeFinances();
  res.json(data);
});

router.post("/house-finances", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;

  const { source, type, amount, reason } = req.body;
  if (!["crate", "bank"].includes(source)) return res.status(400).json({ error: "Source must be 'crate' or 'bank'." });
  if (!["deposit", "withdraw"].includes(type)) return res.status(400).json({ error: "Type must be 'deposit' or 'withdraw'." });
  const amt = parseInt(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Amount must be a positive number." });

  // For withdrawals, check against real combined balance
  if (type === "withdraw") {
    const current = await computeFinances();
    const available = source === "crate" ? current.crateBalance : current.bankBalance;
    if (amt > available) {
      return res.status(400).json({ error: `Insufficient ${source === "crate" ? "crate" : "bank"} balance ($${available.toLocaleString()} available).` });
    }
  }

  await db.insert(houseFinancesTable).values({
    source,
    type,
    amount: amt,
    reason: reason || (type === "deposit" ? "Deposit" : "Withdrawal"),
    staffUsername: session.username,
  });

  const data = await computeFinances();
  return res.json({ success: true, ...data });
});

// ── Table management (dealer or above) ────────────────────────────────────────

router.post("/tables/:id/toggle", requireDealerOrAbove, async (req, res) => {
  const tableId = parseInt(req.params.id as string);
  const [table] = await db.select().from(pokerTablesTable).where(eq(pokerTablesTable.id, tableId));
  if (!table) return res.status(404).json({ error: "Table not found." });

  const newStatus = table.status === "closed" ? "waiting" : "closed";
  const [updated] = await db.update(pokerTablesTable).set({ status: newStatus }).where(eq(pokerTablesTable.id, tableId)).returning();

  // Update cache and push real-time update to all lobby subscribers
  notifyTableUpdate(updated);
  const allTables = await db.select().from(pokerTablesTable);
  broadcastTablesUpdate(allTables.map(serializeTable));

  return res.json({ success: true, status: newStatus });
});

// ── Settings ───────────────────────────────────────────────────────────────────

async function upsertSetting(key: string, value: string) {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length === 0) await db.insert(settingsTable).values({ key, value });
  else await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
}

router.get("/rake-settings", requireBanker, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({
    pokerRakePercent: parseFloat(map["pokerRakePercent"] ?? "5"),
    pokerRakeCap: parseInt(map["pokerRakeCap"] ?? "500"),
    totalRakeCollected: parseInt(map["totalRakeCollected"] ?? "0"),
    tournamentsEnabled: (map["tournamentsEnabled"] ?? "false") === "true",
    // Game-specific odds controlled by Owner oddsMode preset — not editable here
    oddsMode: map["oddsMode"] ?? "standard",
  });
});

router.post("/rake-settings", requireBanker, async (req, res) => {
  const { pokerRakePercent, pokerRakeCap, tournamentsEnabled } = req.body;
  await upsertSetting("pokerRakePercent", String(pokerRakePercent ?? 5));
  await upsertSetting("pokerRakeCap", String(pokerRakeCap ?? 500));
  if (tournamentsEnabled !== undefined) await upsertSetting("tournamentsEnabled", String(!!tournamentsEnabled));
  res.json({ success: true });
});

router.get("/blackjack-settings", requireBanker, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({ enabled: map["blackjackEnabled"] !== "false", minBet: parseInt(map["blackjackMinBet"] ?? "100"), maxBet: parseInt(map["blackjackMaxBet"] ?? "10000") });
});

router.post("/blackjack-settings", requireBanker, async (req, res) => {
  const { enabled, minBet, maxBet } = req.body;
  if (typeof enabled === "boolean") await upsertSetting("blackjackEnabled", String(enabled));
  if (minBet !== undefined) await upsertSetting("blackjackMinBet", String(minBet));
  if (maxBet !== undefined) await upsertSetting("blackjackMaxBet", String(maxBet));
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({ enabled: map["blackjackEnabled"] !== "false", minBet: parseInt(map["blackjackMinBet"] ?? "100"), maxBet: parseInt(map["blackjackMaxBet"] ?? "10000") });
});

router.get("/stats", requireBanker, async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const players = await db.select().from(playersTable);
  const totalChips = players.reduce((sum, p) => sum + p.chips, 0);

  const txAgg = await db.select({ type: transactionsTable.type, total: sql<number>`COALESCE(SUM(${transactionsTable.amount}), 0)::int` })
    .from(transactionsTable)
    .where(sql`${transactionsTable.type} NOT IN ('transfer_sent', 'transfer_received') AND ${transactionsTable.description} NOT ILIKE 'Chip transfer%'`)
    .groupBy(transactionsTable.type);
  const byType: Record<string, number> = {};
  for (const row of txAgg) byType[row.type] = row.total;

  const gameRows = await db.execute(sql`
    SELECT
      CASE
        -- IMPORTANT: slots_tournament must come BEFORE slots to avoid 'Slots%' swallowing it
        WHEN description ILIKE 'Slots tournament%' OR description ILIKE 'Withdrew from slots tournament%' THEN 'slots_tournament'
        WHEN description ILIKE 'Blackjack%' THEN 'blackjack'
        WHEN description ILIKE 'Baccarat%' THEN 'baccarat'
        WHEN description ILIKE 'Roulette%' THEN 'roulette'
        WHEN description ILIKE 'Slots%' THEN 'slots'
        WHEN description ILIKE 'Fortuna%' THEN 'slots'
        WHEN description ILIKE 'Deadwood%' THEN 'slots'
        WHEN description ILIKE 'Crash%' THEN 'crash'
        WHEN description ILIKE 'Buy-in%' OR description ILIKE 'Won pot%' OR description ILIKE 'Rake collected%' OR description ILIKE 'Poker rake%' OR description ILIKE 'Left table%' OR description ILIKE 'AFK kicked%' OR description ILIKE 'Poker session%' THEN 'poker'
        WHEN description ILIKE 'Horse race%' OR description ILIKE 'Horse racing%' OR description ILIKE 'Horse owner%' THEN 'horse'
        WHEN description ILIKE 'Mines%' THEN 'mines'
        WHEN description ILIKE 'Keno%' THEN 'keno'
        WHEN description ILIKE 'High-Low%' THEN 'highlow'
        WHEN description ILIKE 'Mob Tower%' THEN 'mobtower'
        WHEN description ILIKE 'Case opening%' THEN 'cases'
        ELSE 'other'
      END AS game,
      type,
      COALESCE(SUM(amount), 0)::int AS total,
      COUNT(*)::int AS rounds
    FROM transactions
    GROUP BY game, type
  `);

  function buildGameStats(game: string): { bets: number; payouts: number; profit: number; rounds: number; rake: number } {
    let bets = 0, payouts = 0, rounds = 0, rake = 0;
    for (const row of gameRows.rows as any[]) {
      if (row.game !== game) continue;
      if (row.type === "loss") { bets += Number(row.total); rounds += Number(row.rounds); }
      if (row.type === "win") { payouts += Number(row.total); }
      if (row.type === "rake") { rake += Number(row.total); }
      if (row.type === "buyin") { rounds += Number(row.rounds); }
      // Fortuna (rome-slots) and Deadwood Dollars (western-slots) use their own types.
      // Bet amounts are stored negative; negate to get positive wager total.
      if (row.type === "fortuna-bet" || row.type === "western-slots-bet") {
        bets   -= Number(row.total);
        rounds += Number(row.rounds);
      }
      if (row.type === "fortuna-win" || row.type === "western-slots-win") {
        payouts += Number(row.total);
      }
    }
    return { bets, payouts, profit: bets - payouts + rake, rounds, rake };
  }

  const slotsTourneyTxStats = buildGameStats("slots_tournament");

  const tournaments = await db.select().from(tournamentsTable).where(
    sql`${tournamentsTable.status} IN ('running', 'finished')`
  );
  let tournamentHouseRake = 0;
  let slotsTournamentCount = 0;
  let slotsTournamentPrizeDistributed = 0;
  let slotsTournamentPlayers = 0;
  for (const t of tournaments) {
    const entries = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tournamentEntriesTable)
      .where(
        sql`${tournamentEntriesTable.tournamentId} = ${t.id} AND ${tournamentEntriesTable.status} != 'registered'`
      );
    const entryCount = Number(entries[0]?.count ?? 0);
    const housePercent = 100 - t.buyInPrizePercent;
    const houseRake = Math.floor(entryCount * t.buyIn * housePercent / 100);

    if ((t.type ?? "poker") === "slots") {
      slotsTournamentCount++;
      slotsTournamentPlayers += entryCount;
      if (t.status === "finished") {
        slotsTournamentPrizeDistributed += t.prizePool;
      }
    } else {
      tournamentHouseRake += houseRake;
    }
  }

  // Horse racing stats from horseRaceBetsTable
  const horseStats = buildGameStats("horse");
  const totalRacesResult = await db.execute(sql`
    SELECT COUNT(DISTINCT race_id)::int AS total_races, COUNT(*)::int AS total_bets, COALESCE(SUM(amount), 0)::int AS total_wagered
    FROM horse_race_bets
  `);
  const horseRow = (totalRacesResult.rows as any[])[0] ?? {};
  const horseTotalRaces = Number(horseRow.total_races ?? 0);
  const horseTotalBets = Number(horseRow.total_bets ?? 0);
  const horseTotalWagered = Number(horseRow.total_wagered ?? 0);

  const pokerStats = buildGameStats("poker");

  // Lottery stats from dedicated tables
  const lotteryAgg = await db.execute(sql`
    SELECT COALESCE(SUM(total_chips_collected),0) AS total_collected,
      COALESCE(SUM(total_tickets_purchased),0) AS total_tickets,
      COUNT(*) FILTER (WHERE status='complete') AS total_draws
    FROM lottery_draws
  `);
  const lotteryPayAgg = await db.execute(sql`
    SELECT COALESCE(SUM(payout_amount),0) AS total_paid,
      COUNT(*) FILTER (WHERE tier='jackpot') AS jackpot_wins,
      COUNT(*) FILTER (WHERE tier='consolation') AS consolation_wins,
      COALESCE(MAX(payout_amount),0) AS biggest_payout
    FROM lottery_payouts
  `);
  const lRow = (lotteryAgg.rows as any[])[0] ?? {};
  const lpRow = (lotteryPayAgg.rows as any[])[0] ?? {};
  const lotteryCollected = Number(lRow.total_collected ?? 0);
  const lotteryPaidOut = Number(lpRow.total_paid ?? 0);

  // Bingo stats from dedicated tables
  const bingoAgg = await db.execute(sql`
    SELECT COALESCE(SUM(total_collected),0) AS total_collected,
      COALESCE(SUM(prize_pool),0) AS prize_pool,
      COALESCE(SUM(house_profit),0) AS house_profit,
      COALESCE(SUM(total_cards_sold),0) AS total_cards,
      COUNT(*) FILTER (WHERE status='completed') AS total_rounds
    FROM bingo_rounds
  `);
  const bRow = (bingoAgg.rows as any[])[0] ?? {};

  const activeTablesResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(pokerTablesTable)
    .where(sql`${pokerTablesTable.status} IN ('waiting', 'playing')`);
  const activeTablesCount = Number(activeTablesResult[0]?.count ?? 0);

  // Poker is player-vs-player — house only earns rake.
  // Buy-ins ("loss") and pot wins ("win") must be excluded from house bets/payouts
  // the same way slots-tournament transactions are excluded.
  // Fortuna/western-slots use their own signed types (bet=negative, win=positive).
  const fortunaBets  = -(byType["fortuna-bet"]       ?? 0);
  const westernBets  = -(byType["western-slots-bet"]  ?? 0);
  const fortunaWins  =  (byType["fortuna-win"]        ?? 0);
  const westernWins  =  (byType["western-slots-win"]  ?? 0);
  const houseLoss = (byType["loss"] ?? 0) - slotsTourneyTxStats.bets  - pokerStats.bets  + fortunaBets + westernBets;
  const houseWin  = (byType["win"]  ?? 0) - slotsTourneyTxStats.payouts - pokerStats.payouts + fortunaWins + westernWins;

  res.json({
    totalRakeCollected: parseInt(map["totalRakeCollected"] ?? "0"),
    totalHandsPlayed: parseInt(map["totalHandsPlayed"] ?? "0"),
    totalPlayersRegistered: players.length,
    totalChipsInCirculation: totalChips,
    houseChips: parseInt(map["houseChips"] ?? "0"),
    houseTotalDeposited: parseInt(map["houseTotalDeposited"] ?? "0"),
    activeTables: activeTablesCount,
    totalDeposited: byType["deposit"] ?? 0,
    totalWithdrawn: byType["withdrawal"] ?? 0,
    netChipIssuance: (byType["deposit"] ?? 0) - (byType["withdrawal"] ?? 0),
    totalBetsPlaced: houseLoss,
    totalPaidOut: houseWin,
    netGameProfit: houseLoss - houseWin,
    blackjack: buildGameStats("blackjack"),
    baccarat: buildGameStats("baccarat"),
    roulette: buildGameStats("roulette"),
    slots: buildGameStats("slots"),
    crash: buildGameStats("crash"),
    poker: { bets: 0, payouts: 0, profit: 0, rounds: 0, rake: pokerStats.rake, rtp: null, tournamentHouseRake },
    horse: {
      ...horseStats,
      totalRaces: horseTotalRaces,
      totalBets: horseTotalBets,
      totalWagered: horseTotalWagered,
    },
    mines:    buildGameStats("mines"),
    keno:     buildGameStats("keno"),
    highlow:  buildGameStats("highlow"),
    mobtower: buildGameStats("mobtower"),
    cases:    buildGameStats("cases"),
    lottery: {
      bets: lotteryCollected,
      payouts: lotteryPaidOut,
      profit: lotteryCollected - lotteryPaidOut,
      rounds: Number(lRow.total_draws ?? 0),
      rake: 0,
      ticketsSold: Number(lRow.total_tickets ?? 0),
      jackpotWins: Number(lpRow.jackpot_wins ?? 0),
      consolationWins: Number(lpRow.consolation_wins ?? 0),
    },
    bingo: {
      bets: Number(bRow.total_collected ?? 0),
      payouts: Number(bRow.prize_pool ?? 0),
      profit: Number(bRow.house_profit ?? 0),
      rounds: Number(bRow.total_rounds ?? 0),
      rake: 0,
      cardsSold: Number(bRow.total_cards ?? 0),
    },
    totalRakebackPaid: byType["rakeback"] ?? 0,
    slotsTournaments: {
      count: slotsTournamentCount,
      players: slotsTournamentPlayers,
      buyInsCollected: slotsTourneyTxStats.bets,
      refunded: slotsTourneyTxStats.payouts,
      houseRake: Math.max(0, slotsTourneyTxStats.profit - slotsTournamentPrizeDistributed),
      prizeDistributed: slotsTournamentPrizeDistributed,
    },
  });
});

// ── Chip Conservation Audit ───────────────────────────────────────────────────
router.get("/stats/audit", requireBanker, async (_req, res) => {
  try {
    const result = await db.execute(sql`
      WITH
        by_type AS (
          SELECT type, COALESCE(SUM(amount), 0)::bigint AS total, COUNT(*)::int AS count
          FROM transactions GROUP BY type
        ),
        chips_in AS (
          SELECT COALESCE(SUM(total), 0)::bigint AS v
          FROM by_type
          WHERE type IN ('deposit','win','bonus','loan_issued','rake','baccarat')
        ),
        chips_out AS (
          SELECT COALESCE(SUM(total), 0)::bigint AS v
          FROM by_type
          WHERE type IN ('withdrawal','loss','loan_repayment')
        ),
        player_total AS (SELECT COALESCE(SUM(chips), 0)::bigint AS v FROM players),
        house_chips  AS (SELECT COALESCE(value::bigint, 0) AS v FROM settings WHERE key='houseChips'),
        net_loans    AS (
          SELECT
            COALESCE(SUM(CASE WHEN type='loan_issued'     THEN amount ELSE 0 END),0)::bigint AS issued,
            COALESCE(SUM(CASE WHEN type='loan_repayment'  THEN amount ELSE 0 END),0)::bigint AS repaid
          FROM transactions
        ),
        tournament_flows AS (
          SELECT
            COALESCE(SUM(CASE WHEN type='loss' THEN amount ELSE 0 END),0)::bigint AS buyins,
            COALESCE(SUM(CASE WHEN type='win'  THEN amount ELSE 0 END),0)::bigint AS payouts
          FROM transactions
          WHERE description ILIKE 'Slots tournament%' OR description ILIKE 'Withdrew from slots tournament%'
        ),
        table_closed AS (
          SELECT COALESCE(SUM(amount),0)::bigint AS v
          FROM transactions
          WHERE type='cashout' AND description ILIKE '%closed — chips returned%'
        ),
        types_list AS (SELECT json_agg(json_build_object('type',type,'count',count,'total',total)) AS v FROM by_type)
      SELECT
        ci.v                           AS total_chips_ever_in,
        co.v                           AS total_chips_ever_out,
        ci.v - co.v                    AS expected_in_circulation,
        pt.v                           AS actual_player_chips,
        hc.v                           AS house_chips_setting,
        pt.v - (ci.v - co.v)           AS conservation_gap,
        nl.issued                      AS loans_issued,
        nl.repaid                      AS loans_repaid,
        nl.issued - nl.repaid          AS outstanding_loans,
        tf.buyins                      AS tourney_buyins,
        tf.payouts                     AS tourney_payouts,
        tc.v                           AS table_close_returns,
        tl.v                           AS by_type
      FROM chips_in ci, chips_out co, player_total pt, house_chips hc,
           net_loans nl, tournament_flows tf, table_closed tc, types_list tl
    `);
    const row = result.rows[0] as any;
    return res.json({
      totalChipsEverIn:       Number(row.total_chips_ever_in),
      totalChipsEverOut:      Number(row.total_chips_ever_out),
      expectedInCirculation:  Number(row.expected_in_circulation),
      actualPlayerChips:      Number(row.actual_player_chips),
      houseChipsSetting:      Number(row.house_chips_setting),
      conservationGap:        Number(row.conservation_gap),
      outstandingLoans:       Number(row.outstanding_loans),
      loansIssued:            Number(row.loans_issued),
      loansRepaid:            Number(row.loans_repaid),
      tourneyBuyins:          Number(row.tourney_buyins),
      tourneyPayouts:         Number(row.tourney_payouts),
      tableCloseReturns:      Number(row.table_close_returns),
      byType:                 row.by_type ?? [],
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Time-range stats ──────────────────────────────────────────────────────────
router.get("/stats/range", requireBanker, async (req, res) => {
  const { start, end } = req.query as { start?: string; end?: string };
  const todayStr = todayEST();
  const startDate = (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) ? start : todayStr;
  const endDate   = (end   && /^\d{4}-\d{2}-\d{2}$/.test(end))   ? end   : startDate;

  // Convert EST day boundaries to UTC for the WHERE clause via PostgreSQL timezone handling
  const startTs = `${startDate} 00:00:00`;
  const endTs   = `${endDate} 23:59:59.999`;

  const rows = await db.execute(sql`
    SELECT
      TO_CHAR(created_at::timestamptz AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS date,
      type,
      CASE
        WHEN description ILIKE 'Blackjack%' THEN 'blackjack'
        WHEN description ILIKE 'Baccarat%' THEN 'baccarat'
        WHEN description ILIKE 'Roulette%' THEN 'roulette'
        WHEN description ILIKE 'Slots tournament%' OR description ILIKE 'Withdrew from slots tournament%' THEN 'slots_tournament'
        WHEN description ILIKE 'Slots%' THEN 'slots'
        WHEN description ILIKE 'Fortuna%' THEN 'slots'
        WHEN description ILIKE 'Deadwood%' THEN 'slots'
        WHEN description ILIKE 'Crash%' THEN 'crash'
        WHEN description ILIKE 'Buy-in%' OR description ILIKE 'Won pot%' OR description ILIKE 'Rake collected%' OR description ILIKE 'Poker rake%' OR description ILIKE 'Left table%' OR description ILIKE 'AFK kicked%' OR description ILIKE 'Poker session%' THEN 'poker'
        WHEN description ILIKE 'Horse race%' OR description ILIKE 'Horse racing%' OR description ILIKE 'Horse owner%' THEN 'horse'
        WHEN description ILIKE 'Mines%' THEN 'mines'
        WHEN description ILIKE 'Keno%' THEN 'keno'
        WHEN description ILIKE 'High-Low%' THEN 'highlow'
        WHEN description ILIKE 'Mob Tower%' THEN 'mobtower'
        WHEN description ILIKE 'Case opening%' THEN 'cases'
        ELSE 'other'
      END AS game,
      COALESCE(SUM(amount), 0)::bigint AS total,
      COUNT(*)::int AS rounds
    FROM transactions
    WHERE type NOT IN ('transfer_sent', 'transfer_received')
      AND description NOT ILIKE 'Chip transfer%'
      AND created_at::timestamptz >= (${startTs}::timestamp AT TIME ZONE 'America/New_York')
      AND created_at::timestamptz <= (${endTs}::timestamp AT TIME ZONE 'America/New_York')
    GROUP BY date, type, game
    ORDER BY date ASC
  `);

  const allRows = rows.rows as { date: string; type: string; game: string; total: number; rounds: number }[];

  // ── Summary aggregation ────────────────────────────────────────────────────
  let deposits = 0, withdrawals = 0, gameProfit = 0, rake = 0, rakebackPaid = 0;
  const HOUSE_GAMES = new Set(["blackjack", "roulette", "slots", "crash", "horse", "baccarat", "mines", "keno", "highlow", "mobtower", "cases"]);

  for (const r of allRows) {
    const amt = Number(r.total);
    if (r.type === "deposit")    { deposits     += amt; continue; }
    if (r.type === "withdrawal") { withdrawals  += amt; continue; }
    if (r.type === "rake")       { rake         += amt; continue; }
    if (r.type === "rakeback")   { rakebackPaid += amt; continue; }
    if (HOUSE_GAMES.has(r.game)) {
      if (r.type === "loss") gameProfit += amt;
      if (r.type === "win")  gameProfit -= amt;
      // Fortuna/western-slots: bet amounts are negative, win amounts are positive
      if (r.type === "fortuna-bet"      || r.type === "western-slots-bet")  gameProfit -= amt;
      if (r.type === "fortuna-win"      || r.type === "western-slots-win")  gameProfit -= amt;
    }
  }
  const netProfit = (deposits - withdrawals) + gameProfit + rake;

  // ── Per-game breakdown ─────────────────────────────────────────────────────
  function buildGame(game: string) {
    let bets = 0, payouts = 0, rounds = 0, rakeAmt = 0;
    for (const r of allRows) {
      if (r.game !== game) continue;
      if (r.type === "loss")  { bets    += Number(r.total); rounds += Number(r.rounds); }
      if (r.type === "win")   { payouts += Number(r.total); }
      if (r.type === "rake")  { rakeAmt += Number(r.total); }
      if (r.type === "buyin") { rounds  += Number(r.rounds); }
      // Fortuna/western-slots: bet amounts are negative, win amounts are positive
      if (r.type === "fortuna-bet" || r.type === "western-slots-bet") {
        bets   -= Number(r.total);
        rounds += Number(r.rounds);
      }
      if (r.type === "fortuna-win" || r.type === "western-slots-win") {
        payouts += Number(r.total);
      }
    }
    const profit = bets - payouts + rakeAmt;
    const rtp    = bets > 0 ? Math.round((payouts / bets) * 1000) / 10 : null;
    return { bets, payouts, profit, rounds, rake: rakeAmt, rtp };
  }

  // ── Daily breakdown ────────────────────────────────────────────────────────
  const dateMap = new Map<string, { deposits: number; withdrawals: number; gameProfit: number; rake: number }>();

  // Iterate EST date strings from startDate to endDate (noon UTC is always the same date in EST)
  const cur = new Date(`${startDate}T12:00:00Z`);
  const last = new Date(`${endDate}T12:00:00Z`);
  while (cur <= last) {
    const d = cur.toISOString().split("T")[0];
    dateMap.set(d, { deposits: 0, withdrawals: 0, gameProfit: 0, rake: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  for (const r of allRows) {
    const day = dateMap.get(r.date) ?? { deposits: 0, withdrawals: 0, gameProfit: 0, rake: 0 };
    const amt = Number(r.total);
    if (r.type === "deposit")         day.deposits    += amt;
    else if (r.type === "withdrawal") day.withdrawals += amt;
    else if (r.type === "rake")       day.rake        += amt;
    else if (HOUSE_GAMES.has(r.game)) {
      if (r.type === "loss") day.gameProfit += amt;
      if (r.type === "win")  day.gameProfit -= amt;
      // Fortuna/western-slots: bet amounts are negative, win amounts are positive
      if (r.type === "fortuna-bet"  || r.type === "western-slots-bet")  day.gameProfit -= amt;
      if (r.type === "fortuna-win"  || r.type === "western-slots-win")  day.gameProfit -= amt;
    }
    dateMap.set(r.date, day);
  }

  const daily = Array.from(dateMap.entries()).map(([date, d]) => ({
    date,
    deposits:     d.deposits,
    withdrawals:  d.withdrawals,
    gameProfit:   d.gameProfit,
    rake:         d.rake,
    net:          (d.deposits - d.withdrawals) + d.gameProfit + d.rake,
  })).sort((a, b) => a.date.localeCompare(b.date));

  res.json({
    range: { start: startDate, end: endDate },
    summary: { deposits, withdrawals, gameProfit, rake, netProfit, rakebackPaid },
    games: {
      blackjack:  buildGame("blackjack"),
      baccarat:   buildGame("baccarat"),
      roulette:   buildGame("roulette"),
      slots:      buildGame("slots"),
      crash:      buildGame("crash"),
      horse:      buildGame("horse"),
      mines:      buildGame("mines"),
      keno:       buildGame("keno"),
      highlow:    buildGame("highlow"),
      mobtower:   buildGame("mobtower"),
      cases:      buildGame("cases"),
      poker:      (() => { const p = buildGame("poker"); return { bets: 0, payouts: 0, profit: 0, rounds: 0, rake: p.rake, rtp: null }; })(),
    },
    rakebackPaid,
    daily,
  });
});

router.get("/api-calls", requireBanker, (_req, res) => {
  res.json(getApiStats());
});

router.post("/stats/reset", requireBanker, async (_req, res) => {
  await db.delete(transactionsTable);
  for (const key of ["totalRakeCollected", "totalHandsPlayed"]) {
    const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
    if (existing.length > 0) await db.update(settingsTable).set({ value: "0" }).where(eq(settingsTable.key, key));
  }
  res.json({ message: "Stats reset successfully." });
});

// ── Game passwords (owner/banker/dealer) ──────────────────────────────────────

const GAME_PASSWORD_KEYS = ["blackjackPassword", "slotsPassword", "roulettePassword"] as const;

async function getSetting(key: string, fallback?: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? fallback ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  const existing = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (existing.length > 0) {
    if (value === null) {
      await db.delete(settingsTable).where(eq(settingsTable.key, key));
    } else {
      await db.update(settingsTable).set({ value }).where(eq(settingsTable.key, key));
    }
  } else if (value !== null) {
    await db.insert(settingsTable).values({ key, value });
  }
}

router.get("/game-passwords", requireDealerOrAbove, async (_req, res) => {
  const blackjack   = await getSetting("blackjackPassword");
  const slots       = await getSetting("slotsPassword");
  const roulette    = await getSetting("roulettePassword");
  const horseRacing = await getSetting("horsePassword");
  const cases       = await getSetting("casesPassword");
  const baccarat    = await getSetting("baccaratPassword");
  const mines       = await getSetting("minesPassword");
  const keno        = await getSetting("kenoPassword");
  const highlow     = await getSetting("highlowPassword");
  res.json({
    blackjack:    { hasPassword: !!blackjack },
    slots:        { hasPassword: !!slots },
    roulette:     { hasPassword: !!roulette },
    baccarat:     { hasPassword: !!baccarat },
    horseRacing:  { hasPassword: !!horseRacing },
    cases:        { hasPassword: !!cases },
    mines:        { hasPassword: !!mines },
    keno:         { hasPassword: !!keno },
    highlow:      { hasPassword: !!highlow },
  });
});

router.patch("/game-passwords/:game", requireDealerOrAbove, async (req, res) => {
  const game = req.params.game as string;
  const { password } = req.body;

  const keyMap: Record<string, string> = {
    blackjack:   "blackjackPassword",
    slots:       "slotsPassword",
    roulette:    "roulettePassword",
    baccarat:    "baccaratPassword",
    horseRacing: "horsePassword",
    cases:       "casesPassword",
    mines:       "minesPassword",
    keno:        "kenoPassword",
    highlow:     "highlowPassword",
  };
  const tokenKeyMap: Record<string, string> = {
    blackjack:   "blackjackPasswordToken",
    slots:       "slotsPasswordToken",
    roulette:    "roulettePasswordToken",
    baccarat:    "baccaratPasswordToken",
    horseRacing: "horsePasswordToken",
    cases:       "casesPasswordToken",
    mines:       "minesPasswordToken",
    keno:        "kenoPasswordToken",
    highlow:     "highlowPasswordToken",
  };
  const key = keyMap[game];
  const tokenKey = tokenKeyMap[game];
  if (!key) return res.status(400).json({ error: "Unknown game. Use: blackjack, slots, roulette, baccarat, horseRacing, cases, mines, keno, or highlow." });

  if (password === null || password === "") {
    await setSetting(key, null);
    await setSetting(tokenKey, null);
    return res.json({ success: true, hasPassword: false, token: null });
  }
  if (typeof password !== "string" || password.length < 1) {
    return res.status(400).json({ error: "Password must be a non-empty string." });
  }
  const hashed = await bcrypt.hash(password, 10);
  const token = randomUUID();
  await setSetting(key, hashed);
  await setSetting(tokenKey, token);
  return res.json({ success: true, hasPassword: true, token });
});

// ── BET Currency Settings ─────────────────────────────────────────────────────
// betChipsRate  — chips awarded per 1 BET deposited by a player (default 250)
// betSellPrice  — real-money price the house sells 1 BET for (default 5.00, in $)

router.get("/bet-settings", requireBanker, async (_req, res) => {
  try {
    const [rateRaw, sellRaw] = await Promise.all([
      getSetting("betChipsRate", "250"),
      getSetting("betSellPrice", "5.00"),
    ]);
    return res.json({ ratePerBet: parseInt(rateRaw) || 250, sellPrice: parseFloat(sellRaw) || 5.00 });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/bet-settings", requireOwner, async (req, res) => {
  const { ratePerBet, sellPrice } = req.body ?? {};
  try {
    if (ratePerBet !== undefined) {
      const rate = parseInt(ratePerBet);
      if (!rate || rate < 1) return res.status(400).json({ error: "ratePerBet must be a positive integer" });
      await setSetting("betChipsRate", String(rate));
    }
    if (sellPrice !== undefined) {
      const price = parseFloat(sellPrice);
      if (!price || price <= 0) return res.status(400).json({ error: "sellPrice must be a positive number" });
      await setSetting("betSellPrice", String(price));
    }
    const [rateRaw, sellRaw] = await Promise.all([getSetting("betChipsRate", "250"), getSetting("betSellPrice", "5.00")]);
    return res.json({ ok: true, ratePerBet: parseInt(rateRaw) || 250, sellPrice: parseFloat(sellRaw) || 5.00 });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Legacy alias kept for backwards compat
router.get("/bet-rate", requireBanker, async (_req, res) => {
  try {
    const rate = await getSetting("betChipsRate", "250");
    return res.json({ ratePerBet: parseInt(rate) || 250 });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/bet-rate", requireOwner, async (req, res) => {
  const { ratePerBet } = req.body ?? {};
  const rate = parseInt(ratePerBet);
  if (!rate || rate < 1) return res.status(400).json({ error: "ratePerBet must be a positive integer" });
  try {
    await setSetting("betChipsRate", String(rate));
    return res.json({ ok: true, ratePerBet: rate });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/bet-deposits", requireBanker, async (req, res) => {
  const { playerId, betAmount, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";

  if (!playerId || !betAmount) return res.status(400).json({ error: "playerId and betAmount required" });
  const bet = parseFloat(betAmount);
  if (isNaN(bet) || bet <= 0) return res.status(400).json({ error: "betAmount must be positive" });

  try {
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, Number(playerId)));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const rateRaw = await getSetting("betChipsRate", "250");
    const rate = parseInt(rateRaw) || 250;
    const chips = Math.round(bet * rate);

    // Credit chips and real balance (BET deposits are real money)
    await db.update(playersTable)
      .set({
        chips: sql`${playersTable.chips} + ${chips}`,
        realBalance: sql`${playersTable.realBalance} + ${chips}`,
      })
      .where(eq(playersTable.id, player.id));

    // Record transaction
    await db.insert(transactionsTable).values({
      playerId: player.id,
      amount: chips,
      type: "deposit",
      description: `BET deposit: ${bet} BET → ${chips.toLocaleString()} chips (by ${loggedBy})`,
    } as any);

    // Record in bet_deposits
    await db.execute(sql`
      INSERT INTO bet_deposits (player_id, player_name, bet_amount, chips_amount, rate_per_bet, logged_by, notes)
      VALUES (${player.id}, ${player.username}, ${bet}, ${chips}, ${rate}, ${loggedBy}, ${notes ?? null})
    `);

    // House inventory: player depositing BET means house RECEIVES BET (in)
    await db.execute(sql`
      INSERT INTO house_bet_ledger (direction, amount, category, player_name, logged_by, notes)
      VALUES ('in', ${bet}, 'player_deposit', ${player.username}, ${loggedBy}, ${notes ?? null})
    `);

    return res.json({ ok: true, player: player.username, betAmount: bet, chipsAmount: chips, ratePerBet: rate });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/bet-deposits", requireBanker, async (req, res) => {
  const playerId = req.query.playerId ? parseInt(req.query.playerId as string) : null;
  const limit = Math.min(200, parseInt(req.query.limit as string || "100") || 100);
  try {
    const rows = playerId
      ? await db.execute(sql`SELECT * FROM bet_deposits WHERE player_id = ${playerId} ORDER BY logged_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM bet_deposits ORDER BY logged_at DESC LIMIT ${limit}`);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/bet-deposits/stats", requireBanker, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total_transactions,
        COALESCE(SUM(bet_amount), 0) AS total_bet,
        COALESCE(SUM(chips_amount), 0) AS total_chips,
        COUNT(DISTINCT player_id) AS unique_players
      FROM bet_deposits
    `);
    return res.json(rows.rows[0] ?? {});
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// HOUSE BET INVENTORY
// ═══════════════════════════════════════════════════════════════

// Current house BET balance + summary
router.get("/house-bet/balance", requireBanker, async (_req, res) => {
  try {
    const [ledger, prizes] = await Promise.all([
      db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END), 0) AS total_in,
          COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out,
          COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE -amount END), 0) AS balance,
          COUNT(*) AS tx_count,
          MAX(logged_at) AS last_updated
        FROM house_bet_ledger
      `),
      // BET prizes that are stocked = committed from house supply
      db.execute(sql`
        SELECT COALESCE(SUM(value * stock), 0) AS reserved
        FROM prize_items
        WHERE type = 'bet'
          AND stock IS NOT NULL
          AND stock > 0
          AND value IS NOT NULL
      `),
    ]);
    const row = ledger.rows[0] ?? { total_in: 0, total_out: 0, balance: 0, tx_count: 0, last_updated: null };
    const reserved = Number((prizes.rows[0] as any)?.reserved ?? 0);
    const balance = Number((row as any).balance ?? 0);
    return res.json({
      ...row,
      reserved_for_prizes: reserved,
      available_balance: balance - reserved,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Full ledger history
router.get("/house-bet/ledger", requireBanker, async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit as string || "100") || 100);
  const direction = req.query.direction as string | undefined;
  try {
    const rows = direction
      ? await db.execute(sql`SELECT * FROM house_bet_ledger WHERE direction=${direction} ORDER BY logged_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM house_bet_ledger ORDER BY logged_at DESC LIMIT ${limit}`);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Debit house BET (prizes, rewards, player cashout, etc.)
router.post("/house-bet/debit", requireBanker, async (req, res) => {
  const { amount, category, playerName, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "amount must be positive" });
  const cat = (category as string) || "prize";
  try {
    const result = await db.execute(sql`
      INSERT INTO house_bet_ledger (direction, amount, category, player_name, logged_by, notes)
      VALUES ('out', ${amt}, ${cat}, ${playerName ?? null}, ${loggedBy}, ${notes ?? null})
      RETURNING *
    `);
    return res.json({ ok: true, entry: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Credit house BET (restock, manual correction)
router.post("/house-bet/credit", requireOwner, async (req, res) => {
  const { amount, category, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "amount must be positive" });
  const cat = (category as string) || "restock";
  try {
    const result = await db.execute(sql`
      INSERT INTO house_bet_ledger (direction, amount, category, player_name, logged_by, notes)
      VALUES ('in', ${amt}, ${cat}, NULL, ${loggedBy}, ${notes ?? null})
      RETURNING *
    `);
    return res.json({ ok: true, entry: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// GET /banker/staff-stats — per-employee activity summary
router.get("/staff-stats", requireBankerOrOwner, async (req, res) => {
  const period    = (req.query.period as string) || "30d";
  const qStart    = req.query.start as string | undefined;
  const qEnd      = req.query.end   as string | undefined;

  let since: string | null  = null;
  let until: string | null  = null;

  // Helper: current date string in Eastern time (YYYY-MM-DD), matching main stats tab behavior
  const estToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  // Flag: when true, since/until are EST date strings that need AT TIME ZONE in the query
  let useEstTz = false;

  if (qStart && qEnd) {
    // Custom range: datetime-local values from the picker (treated as UTC by new Date())
    since = new Date(qStart).toISOString();
    const endDate = new Date(qEnd);
    endDate.setSeconds(59, 999);
    until = endDate.toISOString();
  } else {
    if (period === "today") {
      // Use EST midnight so "today" matches what the user sees in the main stats tab
      since = `${estToday} 00:00:00`;
      useEstTz = true;
    } else if (period === "7d") {
      since = new Date(Date.now() - 7 * 86400000).toISOString();
    } else if (period === "30d") {
      since = new Date(Date.now() - 30 * 86400000).toISOString();
    }
  }

  try {
    // Build WHERE clause — "today" uses PostgreSQL AT TIME ZONE to respect EST/EDT correctly
    const whereClause = since && until
      ? (useEstTz
          ? sql`WHERE staff_username IS NOT NULL AND staff_username != '' AND created_at >= (${since}::timestamp AT TIME ZONE 'America/New_York') AND created_at <= ${until}`
          : sql`WHERE staff_username IS NOT NULL AND staff_username != '' AND created_at >= ${since} AND created_at <= ${until}`)
      : since
      ? (useEstTz
          ? sql`WHERE staff_username IS NOT NULL AND staff_username != '' AND created_at >= (${since}::timestamp AT TIME ZONE 'America/New_York')`
          : sql`WHERE staff_username IS NOT NULL AND staff_username != '' AND created_at >= ${since}`)
      : sql`WHERE staff_username IS NOT NULL AND staff_username != ''`;

    const txRows = await db.execute(sql`
      SELECT
        staff_username,
        COUNT(*) FILTER (WHERE type = 'deposit')                                    AS deposit_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0)                   AS deposit_total,
        COUNT(*) FILTER (WHERE type = 'withdrawal')                                 AS withdrawal_count,
        COALESCE(SUM(amount) FILTER (WHERE type = 'withdrawal'), 0)                AS withdrawal_total,
        COUNT(*) FILTER (WHERE type IN ('bonus', 'credit'))                         AS bonus_count,
        COALESCE(SUM(amount) FILTER (WHERE type IN ('bonus', 'credit')), 0)        AS bonus_total,
        COUNT(*) FILTER (WHERE type IN ('loan_issued', 'loan_repayment'))           AS loan_count,
        MAX(created_at)                                                              AS last_activity
      FROM transactions
      ${whereClause}
      GROUP BY staff_username
    `);

    // Bans / notes / warnings are not time-filtered (all-time enforcement record)
    const banRows = await db.execute(sql`
      SELECT staff_username, COUNT(*) AS cnt FROM player_game_bans
      WHERE staff_username IS NOT NULL GROUP BY staff_username
    `);
    const noteRows = await db.execute(sql`
      SELECT staff_username, COUNT(*) AS cnt FROM player_notes
      WHERE staff_username IS NOT NULL GROUP BY staff_username
    `);
    const warnRows = await db.execute(sql`
      SELECT staff_username, COUNT(*) AS cnt FROM player_warnings
      WHERE staff_username IS NOT NULL GROUP BY staff_username
    `);

    const banMap: Record<string, number>  = {};
    const noteMap: Record<string, number> = {};
    const warnMap: Record<string, number> = {};
    for (const r of banRows.rows  as any[]) banMap[r.staff_username]  = parseInt(r.cnt);
    for (const r of noteRows.rows as any[]) noteMap[r.staff_username] = parseInt(r.cnt);
    for (const r of warnRows.rows as any[]) warnMap[r.staff_username] = parseInt(r.cnt);

    const stats = (txRows.rows as any[]).map(r => ({
      username:        r.staff_username,
      depositCount:    parseInt(r.deposit_count)    || 0,
      depositTotal:    parseInt(r.deposit_total)    || 0,
      withdrawalCount: parseInt(r.withdrawal_count) || 0,
      withdrawalTotal: parseInt(r.withdrawal_total) || 0,
      bonusCount:      parseInt(r.bonus_count)      || 0,
      bonusTotal:      parseInt(r.bonus_total)      || 0,
      loanCount:       parseInt(r.loan_count)        || 0,
      bansIssued:      banMap[r.staff_username]      || 0,
      notesAdded:      noteMap[r.staff_username]     || 0,
      warningsIssued:  warnMap[r.staff_username]     || 0,
      lastActivity:    r.last_activity ?? null,
    }));

    // Sort: most recently active first
    stats.sort((a, b) => {
      if (!a.lastActivity) return 1;
      if (!b.lastActivity) return -1;
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    return res.json({ stats, period });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── Slot bet limits ───────────────────────────────────────────────────────────
const DEFAULT_FORTUNA_STEPS      = [20, 40, 100, 200, 400, 1000, 2000, 5000];
const DEFAULT_WESTERN_STEPS      = [20, 40, 100, 200, 400, 1000, 2000, 5000];

function parseSteps(raw: string | null, defaults: number[]): number[] {
  if (!raw) return defaults;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return defaults;
    return arr.map(Number).filter(n => n > 0 && Number.isInteger(n));
  } catch { return defaults; }
}

function validateSteps(arr: unknown): { ok: true; steps: number[] } | { ok: false; error: string } {
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 12)
    return { ok: false, error: "Bet steps must be an array of 1–12 values" };
  const nums = arr.map(Number);
  if (nums.some(n => !Number.isInteger(n) || n < 1))
    return { ok: false, error: "All bet steps must be positive integers" };
  for (let i = 1; i < nums.length; i++)
    if (nums[i] <= nums[i - 1]) return { ok: false, error: "Bet steps must be strictly ascending" };
  return { ok: true, steps: nums };
}

router.get("/slot-bet-limits", requireBanker, async (_req, res) => {
  try {
    const [rawF, rawW] = await Promise.all([
      getSetting("fortunaBetSteps"),
      getSetting("westernSlotsBetSteps"),
    ]);
    return res.json({
      fortuna:      parseSteps(rawF, DEFAULT_FORTUNA_STEPS),
      westernSlots: parseSteps(rawW, DEFAULT_WESTERN_STEPS),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/slot-bet-limits", requireOwner, async (req, res) => {
  try {
    const { fortuna, westernSlots } = req.body ?? {};
    if (fortuna !== undefined) {
      const v = validateSteps(fortuna);
      if (!v.ok) return res.status(400).json({ error: v.error });
      await setSetting("fortunaBetSteps", JSON.stringify(v.steps));
    }
    if (westernSlots !== undefined) {
      const v = validateSteps(westernSlots);
      if (!v.ok) return res.status(400).json({ error: v.error });
      await setSetting("westernSlotsBetSteps", JSON.stringify(v.steps));
    }
    const [rawF, rawW] = await Promise.all([
      getSetting("fortunaBetSteps"),
      getSetting("westernSlotsBetSteps"),
    ]);
    return res.json({
      ok: true,
      fortuna:      parseSteps(rawF, DEFAULT_FORTUNA_STEPS),
      westernSlots: parseSteps(rawW, DEFAULT_WESTERN_STEPS),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// BABALARI DEPOSITS + STATS
// ═══════════════════════════════════════════════════════════════

// Staff accepts Babalari from a player → credits chips → logs to ledger
router.post("/babalari-deposits", requireBanker, async (req, res) => {
  const { playerId, babalariAmount, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";

  if (!playerId || !babalariAmount) return res.status(400).json({ error: "playerId and babalariAmount required" });
  const amt = parseFloat(babalariAmount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "babalariAmount must be positive" });

  try {
    const [player] = await db.select().from(playersTable).where(eq(playersTable.id, Number(playerId)));
    if (!player) return res.status(404).json({ error: "Player not found" });

    const rateRaw = await getSetting("babalariRate", "1000");
    const rate = parseInt(rateRaw ?? "1000") || 1000;
    const chips = Math.round(amt * rate);

    await db.update(playersTable)
      .set({ chips: sql`${playersTable.chips} + ${chips}` })
      .where(eq(playersTable.id, player.id));

    await db.insert(transactionsTable).values({
      playerId: player.id,
      amount: chips,
      type: "deposit",
      description: `Babalari accepted: ${amt} Babalari → ${chips.toLocaleString()} chips (by ${loggedBy})`,
    } as any);

    await db.execute(sql`
      INSERT INTO babalari_ledger (player_id, player_name, amount, direction, chips_amount, rate, reason, category, logged_by)
      VALUES (${player.id}, ${player.username}, ${amt}, 'in', ${chips}, ${rate}, ${notes ?? null}, 'player_deposit', ${loggedBy})
    `);

    return res.json({ ok: true, player: player.username, babalariAmount: amt, chipsAmount: chips, ratePerBabalari: rate });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/babalari-stats", requireBanker, async (_req, res) => {
  try {
    const [ledgerSummary, settings] = await Promise.all([
      // Only count actual player deposits (not manual house credits/restocks)
      db.execute(sql`
        SELECT
          COALESCE(SUM(amount), 0)        AS total_accepted,
          COALESCE(SUM(chips_amount), 0)  AS total_chips_issued,
          COUNT(*)                         AS total_transactions,
          COUNT(DISTINCT player_id)        AS unique_players
        FROM babalari_ledger
        WHERE direction = 'in'
          AND (category = 'player_deposit' OR (category IS NULL AND player_id IS NOT NULL))
      `),
      db.execute(sql`SELECT key, value FROM settings WHERE key IN ('babalariRate', 'babalariSellPrice')`),
    ]);
    const ls = ledgerSummary.rows[0] ?? {};
    const map: Record<string, string> = {};
    for (const r of settings.rows as any[]) map[r.key] = r.value;
    return res.json({
      total_accepted:     Number(ls.total_accepted ?? 0),
      total_chips_issued: Number(ls.total_chips_issued ?? 0),
      total_transactions: Number(ls.total_transactions ?? 0),
      unique_players:     Number(ls.unique_players ?? 0),
      rate:       parseInt(map.babalariRate ?? "1000"),
      sell_price: parseFloat(map.babalariSellPrice ?? "0.10"),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/babalari-settings", requireBanker, async (_req, res) => {
  try {
    const rows = await db.execute(sql`SELECT key, value FROM settings WHERE key IN ('babalariRate', 'babalariSellPrice')`);
    const map: Record<string, string> = {};
    for (const r of rows.rows as any[]) map[r.key] = r.value;
    return res.json({ ratePerBabalari: parseInt(map.babalariRate ?? "1000"), sellPrice: parseFloat(map.babalariSellPrice ?? "0.10") });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.put("/babalari-settings", requireOwner, async (req, res) => {
  const { ratePerBabalari, sellPrice } = req.body ?? {};
  try {
    if (ratePerBabalari !== undefined) {
      const rate = parseInt(ratePerBabalari);
      if (!rate || rate < 1) return res.status(400).json({ error: "ratePerBabalari must be a positive integer" });
      await db.execute(sql`INSERT INTO settings (key, value) VALUES ('babalariRate', ${String(rate)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    }
    if (sellPrice !== undefined) {
      const price = parseFloat(sellPrice);
      if (!price || price <= 0) return res.status(400).json({ error: "sellPrice must be a positive number" });
      await db.execute(sql`INSERT INTO settings (key, value) VALUES ('babalariSellPrice', ${String(price)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    }
    const rows = await db.execute(sql`SELECT key, value FROM settings WHERE key IN ('babalariRate', 'babalariSellPrice')`);
    const map: Record<string, string> = {};
    for (const r of rows.rows as any[]) map[r.key] = r.value;
    return res.json({ ok: true, ratePerBabalari: parseInt(map.babalariRate ?? "1000"), sellPrice: parseFloat(map.babalariSellPrice ?? "0.10") });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.get("/babalari-ledger", requireBanker, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string ?? "100"), 200);
    const playerId = req.query.playerId ? parseInt(req.query.playerId as string) : null;
    const rows = playerId
      ? await db.execute(sql`SELECT * FROM babalari_ledger WHERE player_id = ${playerId} ORDER BY logged_at DESC LIMIT ${limit}`)
      : await db.execute(sql`SELECT * FROM babalari_ledger ORDER BY logged_at DESC LIMIT ${limit}`);
    return res.json(rows.rows);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ── House Babalari inventory (balance, debit, credit) ────────────────────────

router.get("/babalari/balance", requireBanker, async (_req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END), 0) AS total_out,
        COALESCE(SUM(CASE WHEN direction='in'  THEN amount ELSE -amount END), 0) AS balance,
        COUNT(*) AS tx_count,
        MAX(logged_at) AS last_updated
      FROM babalari_ledger
    `);
    const row = result.rows[0] ?? {};
    return res.json({
      total_in:     Number(row.total_in ?? 0),
      total_out:    Number(row.total_out ?? 0),
      balance:      Number(row.balance ?? 0),
      tx_count:     Number(row.tx_count ?? 0),
      last_updated: row.last_updated ?? null,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/babalari/debit", requireBanker, async (req, res) => {
  const { amount, category, playerName, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "amount must be positive" });
  const cat = (category as string) || "payout";
  try {
    const result = await db.execute(sql`
      INSERT INTO babalari_ledger (player_name, amount, direction, category, reason, logged_by)
      VALUES (${playerName ?? null}, ${amt}, 'out', ${cat}, ${notes ?? null}, ${loggedBy})
      RETURNING *
    `);
    return res.json({ ok: true, entry: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

router.post("/babalari/credit", requireOwner, async (req, res) => {
  const { amount, notes } = req.body ?? {};
  const session = (req as any).bankerSession;
  const loggedBy: string = session?.username ?? "staff";
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "amount must be positive" });
  try {
    const result = await db.execute(sql`
      INSERT INTO babalari_ledger (amount, direction, category, reason, logged_by)
      VALUES (${amt}, 'in', 'restock', ${notes ?? null}, ${loggedBy})
      RETURNING *
    `);
    return res.json({ ok: true, entry: result.rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
