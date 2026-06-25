import { Request, Response, NextFunction } from "express";
import { validatePlayerToken, resolveBankerSession, sessionHasRole } from "../lib/sessions.js";

export function requirePlayer(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Player authentication required" }); return; }
  const token = auth.slice(7);
  const ps = validatePlayerToken(token);
  if (!ps) { res.status(401).json({ error: "Invalid or expired session — please log in again" }); return; }
  (req as any).authenticatedPlayerId = ps.playerId;
  (req as any).isBanker = false;
  next();
}

export function requireBanker(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!session.isAdmin) { res.status(403).json({ error: "Admin access required" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner")) { res.status(403).json({ error: "Owner access required" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireBankerOrOwner(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker")) { res.status(403).json({ error: "Banker or owner access required" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireDealerOrAbove(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "dealer")) { res.status(403).json({ error: "Dealer or above access required" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireSportbetsOrAbove(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "sportbets")) { res.status(403).json({ error: "Sport bets staff access required" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireAnyStaff(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireSecurityOrAbove(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "dealer", "security_guard", "pit_boss")) {
    res.status(403).json({ error: "Security or above required" }); return;
  }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requirePitBossOrAbove(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "pit_boss")) {
    res.status(403).json({ error: "Pit boss or above required" }); return;
  }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

// Loans: owner, banker, and junior_banker only — cage_clerk excluded
export function requireLoanAccess(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "junior_banker")) {
    res.status(403).json({ error: "Loan access requires banker or junior banker role" }); return;
  }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireCageClerkOrAbove(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Staff authentication required" }); return; }
  const token = auth.slice(7);
  const session = resolveBankerSession(token);
  if (!session) { res.status(401).json({ error: "Invalid or expired staff session" }); return; }
  if (!sessionHasRole(session, "owner", "banker", "cage_clerk", "junior_banker")) {
    res.status(403).json({ error: "Cage clerk or above required" }); return;
  }
  (req as any).isBanker = true;
  (req as any).bankerSession = session;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Authentication required" }); return; }
  const token = auth.slice(7);
  const ps = validatePlayerToken(token);
  if (ps !== null) {
    (req as any).authenticatedPlayerId = ps.playerId;
    (req as any).isBanker = false;
    next();
    return;
  }
  const session = resolveBankerSession(token);
  if (session) {
    (req as any).isBanker = true;
    (req as any).bankerSession = session;
    next();
    return;
  }
  res.status(401).json({ error: "Invalid or expired session — please log in again" });
}
