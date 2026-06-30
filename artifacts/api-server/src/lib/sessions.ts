import crypto from "crypto";
import { db, playerSessionsTable, bankerSessionsTable, playersTable, bankerAccountsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Player sessions ────────────────────────────────────────────────────────────

const PLAYER_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface PlayerSession {
  playerId: number;
  username: string;
  staffRole: string | null;
  staffRole2: string | null;
  staffRoles: string[]; // full list (always includes staffRole and staffRole2 when present)
  createdAt: number;
}

const playerSessions = new Map<string, PlayerSession>();

export function createPlayerSession(
  playerId: number,
  username: string,
  staffRolesOrPrimary?: string | string[] | null,
  staffRole2Legacy?: string | null,
): string {
  const token = crypto.randomBytes(32).toString("hex");
  const staffRoles: string[] = Array.isArray(staffRolesOrPrimary)
    ? staffRolesOrPrimary
    : [staffRolesOrPrimary, staffRole2Legacy].filter(Boolean) as string[];
  const session: PlayerSession = {
    playerId,
    username,
    staffRole: staffRoles[0] ?? null,
    staffRole2: staffRoles[1] ?? null,
    staffRoles,
    createdAt: Date.now(),
  };
  playerSessions.set(token, session);
  db.insert(playerSessionsTable)
    .values({ token, playerId, username, staffRole: session.staffRole, staffRole2: session.staffRole2 })
    .onConflictDoUpdate({ target: playerSessionsTable.token, set: { playerId, username, staffRole: session.staffRole, staffRole2: session.staffRole2 } })
    .catch((e) => console.error("[sessions] failed to persist player session:", e));
  return token;
}

export function validatePlayerToken(token: string): PlayerSession | null {
  const session = playerSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > PLAYER_SESSION_TTL_MS) {
    playerSessions.delete(token);
    db.delete(playerSessionsTable).where(eq(playerSessionsTable.token, token)).catch(() => {});
    return null;
  }
  return session;
}

export function invalidatePlayerSessions(playerId: number): void {
  const tokensToDelete: string[] = [];
  for (const [token, session] of playerSessions) {
    if (session.playerId === playerId) {
      playerSessions.delete(token);
      tokensToDelete.push(token);
    }
  }
  for (const token of tokensToDelete) {
    db.delete(playerSessionsTable).where(eq(playerSessionsTable.token, token))
      .catch((e) => console.error("[sessions] failed to delete player session:", e));
  }
}

export function updatePlayerSessionStaffRole(
  playerId: number,
  staffRolesOrPrimary: string | string[] | null,
  staffRole2Legacy?: string | null,
): void {
  const staffRoles: string[] = Array.isArray(staffRolesOrPrimary)
    ? staffRolesOrPrimary
    : [staffRolesOrPrimary, staffRole2Legacy].filter(Boolean) as string[];
  const staffRole = staffRoles[0] ?? null;
  const staffRole2 = staffRoles[1] ?? null;
  for (const [token, session] of playerSessions) {
    if (session.playerId === playerId) {
      session.staffRole = staffRole;
      session.staffRole2 = staffRole2;
      session.staffRoles = staffRoles;
      db.update(playerSessionsTable)
        .set({ staffRole, staffRole2 })
        .where(eq(playerSessionsTable.token, token))
        .catch((e) => console.error("[sessions] failed to update player session role:", e));
    }
  }
}

// ── Banker sessions — per-account with expiry ──────────────────────────────────

const BANKER_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface BankerSession {
  accountId: number;
  username: string;
  isAdmin: boolean;
  role: string;
  role2: string | null;
  roles: string[]; // full unlimited roles list
  expiresAt: number;
}

const bankerSessions = new Map<string, BankerSession>();

export function createBankerSession(
  accountId: number,
  username: string,
  isAdmin: boolean,
  role: string,
  role2?: string | null,
  roles?: string[],
): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + BANKER_SESSION_TTL_MS;
  const fullRoles = roles && roles.length > 0 ? roles : [role, role2].filter(Boolean) as string[];
  const session: BankerSession = { accountId, username, isAdmin, role, role2: role2 ?? null, roles: fullRoles, expiresAt };
  bankerSessions.set(token, session);
  db.insert(bankerSessionsTable)
    .values({ token, accountId, username, isAdmin, role, role2: session.role2, expiresAt })
    .onConflictDoUpdate({ target: bankerSessionsTable.token, set: { accountId, username, isAdmin, role, role2: session.role2, expiresAt } })
    .catch((e) => console.error("[sessions] failed to persist banker session:", e));
  return token;
}

export function validateBankerToken(token: string): BankerSession | null {
  const session = bankerSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    bankerSessions.delete(token);
    db.delete(bankerSessionsTable).where(eq(bankerSessionsTable.token, token))
      .catch(() => {});
    return null;
  }
  return session;
}

export function sessionHasRole(session: BankerSession, ...roles: string[]): boolean {
  if (session.roles && session.roles.length > 0) {
    return session.roles.some((r) => roles.includes(r));
  }
  return roles.includes(session.role) || (!!session.role2 && roles.includes(session.role2));
}

export function revokeBankerSession(token: string): void {
  bankerSessions.delete(token);
  db.delete(bankerSessionsTable).where(eq(bankerSessionsTable.token, token))
    .catch((e) => console.error("[sessions] failed to revoke banker session:", e));
}

export function revokeAllBankerSessionsForAccount(accountId: number): void {
  const tokensToDelete: string[] = [];
  for (const [token, session] of bankerSessions) {
    if (session.accountId === accountId) {
      bankerSessions.delete(token);
      tokensToDelete.push(token);
    }
  }
  for (const token of tokensToDelete) {
    db.delete(bankerSessionsTable).where(eq(bankerSessionsTable.token, token))
      .catch((e) => console.error("[sessions] failed to revoke banker session:", e));
  }
}

// Legacy shim so old registerBankerToken calls still compile
export function registerBankerToken(_token: string): void {}

// ── Shared helper — resolve a banker-capable session from any token ─────────────

export function resolveBankerSession(token: string): BankerSession | null {
  const bs = validateBankerToken(token);
  if (bs) return bs;

  const ps = validatePlayerToken(token);
  if (ps && (ps.staffRole || ps.staffRoles.length > 0)) {
    const roles = ps.staffRoles.length > 0 ? ps.staffRoles : [ps.staffRole, ps.staffRole2].filter(Boolean) as string[];
    return {
      accountId: ps.playerId,
      username: ps.username,
      isAdmin: roles.includes("owner"),
      role: roles[0] ?? ps.staffRole ?? "",
      role2: roles[1] ?? ps.staffRole2 ?? null,
      roles,
      expiresAt: Infinity,
    };
  }

  return null;
}

// ── Startup: load persisted sessions from DB into memory ──────────────────────

export async function loadSessionsFromDb(): Promise<void> {
  try {
    // Auto-create tables if they don't exist yet (handles fresh VPS deploys)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS player_sessions (
        token TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        staff_role TEXT,
        staff_role2 TEXT
      );
      CREATE TABLE IF NOT EXISTS banker_sessions (
        token TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        role TEXT NOT NULL,
        role2 TEXT,
        expires_at BIGINT NOT NULL
      );
    `);
  } catch (e) {
    console.error("[sessions] Failed to auto-create session tables:", e);
  }

  try {
    const playerRows = await db.select().from(playerSessionsTable);

    // For each unique player, fetch their FULL staffRolesJson so multi-role staff
    // don't lose their 3rd+ roles after a server restart.
    const uniquePlayerIds = [...new Set(playerRows.map(r => r.playerId))];
    const playerRoleMap = new Map<number, string[]>();
    if (uniquePlayerIds.length > 0) {
      const playerData = await db
        .select({ id: playersTable.id, staffRole: playersTable.staffRole, staffRole2: playersTable.staffRole2, staffRolesJson: playersTable.staffRolesJson })
        .from(playersTable)
        .where(inArray(playersTable.id, uniquePlayerIds));
      for (const pl of playerData) {
        let roles: string[] = [];
        if (pl.staffRolesJson) {
          try { roles = JSON.parse(pl.staffRolesJson); } catch {}
        }
        if (roles.length === 0) {
          roles = [pl.staffRole, pl.staffRole2].filter(Boolean) as string[];
        }
        playerRoleMap.set(pl.id, roles);
      }
    }

    for (const row of playerRows) {
      const fullRoles = playerRoleMap.get(row.playerId) ?? [row.staffRole, row.staffRole2].filter(Boolean) as string[];
      playerSessions.set(row.token, {
        playerId: row.playerId,
        username: row.username,
        staffRole: fullRoles[0] ?? row.staffRole ?? null,
        staffRole2: fullRoles[1] ?? row.staffRole2 ?? null,
        staffRoles: fullRoles,
        createdAt: Date.now(), // treat restored sessions as fresh — they'll expire 12h after next restart
      });
    }
    console.log(`[sessions] Loaded ${playerRows.length} player session(s) from DB`);

    const now = Date.now();
    const bankerRows = await db.select().from(bankerSessionsTable);
    const expiredTokens: string[] = [];

    // Fetch full rolesJson from banker_accounts for all active sessions
    const uniqueAccountIds = [...new Set(bankerRows.map(r => r.accountId))];
    const bankerRoleMap = new Map<number, string[]>();
    if (uniqueAccountIds.length > 0) {
      const accountData = await db
        .select({ id: bankerAccountsTable.id, role: bankerAccountsTable.role, role2: bankerAccountsTable.role2, rolesJson: bankerAccountsTable.rolesJson })
        .from(bankerAccountsTable)
        .where(inArray(bankerAccountsTable.id, uniqueAccountIds));
      for (const acc of accountData) {
        let roles: string[] = [];
        if (acc.rolesJson) {
          try { roles = JSON.parse(acc.rolesJson); } catch {}
        }
        if (roles.length === 0) {
          roles = [acc.role, acc.role2].filter(Boolean) as string[];
        }
        bankerRoleMap.set(acc.id, roles);
      }
    }

    for (const row of bankerRows) {
      if (row.expiresAt <= now) {
        expiredTokens.push(row.token);
        continue;
      }
      const fullRoles = bankerRoleMap.get(row.accountId) ?? [row.role, row.role2].filter(Boolean) as string[];
      bankerSessions.set(row.token, {
        accountId: row.accountId,
        username: row.username,
        isAdmin: row.isAdmin,
        role: fullRoles[0] ?? row.role,
        role2: fullRoles[1] ?? row.role2 ?? null,
        roles: fullRoles,
        expiresAt: row.expiresAt,
      });
    }
    if (expiredTokens.length > 0) {
      for (const token of expiredTokens) {
        await db.delete(bankerSessionsTable).where(eq(bankerSessionsTable.token, token));
      }
    }
    console.log(`[sessions] Loaded ${bankerSessions.size} banker session(s) from DB (${expiredTokens.length} expired cleaned up)`);
  } catch (e) {
    console.error("[sessions] Failed to load sessions from DB:", e);
  }
}

// ── IP-based lockout ───────────────────────────────────────────────────────────

const IP_MAX_FAILS = 10;
const IP_LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

interface IpRecord { failures: number; lockedUntil: number; }
const ipFailures = new Map<string, IpRecord>();

export function checkIpLocked(ip: string): boolean {
  const rec = ipFailures.get(ip);
  if (!rec) return false;
  if (rec.lockedUntil > Date.now()) return true;
  ipFailures.delete(ip);
  return false;
}

export function recordIpFailure(ip: string): void {
  const rec = ipFailures.get(ip) ?? { failures: 0, lockedUntil: 0 };
  rec.failures += 1;
  if (rec.failures >= IP_MAX_FAILS) rec.lockedUntil = Date.now() + IP_LOCKOUT_MS;
  ipFailures.set(ip, rec);
}

export function clearIpFailures(ip: string): void {
  ipFailures.delete(ip);
}

// ── Game-room verify-password rate limiter ────────────────────────────────────
// Separate from the main login lockout — shorter lockout, fewer allowed attempts.

const VP_MAX_FAILS = 5;
const VP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const vpFailures = new Map<string, IpRecord>();

export function checkVerifyPasswordLocked(ip: string): boolean {
  const rec = vpFailures.get(ip);
  if (!rec) return false;
  if (rec.lockedUntil > Date.now()) return true;
  vpFailures.delete(ip);
  return false;
}

export function recordVerifyPasswordFailure(ip: string): void {
  const rec = vpFailures.get(ip) ?? { failures: 0, lockedUntil: 0 };
  rec.failures += 1;
  if (rec.failures >= VP_MAX_FAILS) rec.lockedUntil = Date.now() + VP_LOCKOUT_MS;
  vpFailures.set(ip, rec);
}

export function clearVerifyPasswordFailures(ip: string): void {
  vpFailures.delete(ip);
}
