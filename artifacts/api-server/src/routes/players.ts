import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import express, { Router } from "express";
import { db, playersTable, transactionsTable, blackjackGamesTable, bankerAccountsTable, referralPromotersTable, loansTable, settingsTable, challengeClaimsTable } from "@workspace/db";
import { eq, inArray, sql as sqlFn, desc } from "drizzle-orm";

import { createPlayerSession, invalidatePlayerSessions, updatePlayerSessionStaffRole } from "../lib/sessions.js";
import { requirePlayer, requireBanker, requireAuth, requireOwner, requireBankerOrOwner, requireCageClerkOrAbove, requireSecurityOrAbove } from "../middleware/auth.js";
import { sessionHasRole } from "../lib/sessions.js";
import { recordPlayerActivity, getActivePlayers } from "../lib/player-activity.js";
import { emitLoginEvent } from "../lib/floor-events.js";
import { updateCreditScore, getLoanSettings } from "../lib/credit.js";
import { AVATAR_UPLOADS_DIR } from "../app.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

async function getSettingBool(key: string, fallback = true): Promise<boolean> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  if (!row) return fallback;
  return row.value === "true";
}

function parseStaffRoles(player: typeof playersTable.$inferSelect): string[] {
  if (player.staffRolesJson) {
    try { return JSON.parse(player.staffRolesJson); } catch { /* fall through */ }
  }
  return [player.staffRole, player.staffRole2].filter(Boolean) as string[];
}

function safePlayer(p: typeof playersTable.$inferSelect) {
  const { pin: _pin, ...rest } = p;
  return {
    ...rest,
    stateId: rest.stateId ?? null,
    phoneNumber: rest.phoneNumber ?? null,
    createdAt: rest.createdAt.toISOString(),
  };
}

// List all players — security and above (pit boss, security guard, dealer, banker, owner)
router.get("/", requireSecurityOrAbove, async (_req, res) => {
  const players = await db.select().from(playersTable).orderBy(playersTable.username);
  if (players.length === 0) return res.json([]);

  // Compute lifetime deposits per player
  const playerIds = players.map((p) => p.id);
  const allTxs = await db
    .select({ playerId: transactionsTable.playerId, amount: transactionsTable.amount, type: transactionsTable.type })
    .from(transactionsTable)
    .where(inArray(transactionsTable.playerId, playerIds) as any);

  const depositMap = new Map<number, number>();
  for (const d of allTxs) {
    if (d.playerId === null || d.type !== "deposit") continue;
    depositMap.set(d.playerId, (depositMap.get(d.playerId) ?? 0) + (d.amount ?? 0));
  }

  return res.json(players.map((p) => ({
    ...safePlayer(p),
    lifetimeDeposits: depositMap.get(p.id) ?? 0,
  })));
});

// Player self-registration
router.post("/register", async (req, res) => {
  const { username, stateId, phoneNumber, pin, referralCode: incomingReferralCode } = req.body;

  if (!username || !stateId || !phoneNumber || !pin) {
    return res.status(400).json({ error: "Name, State ID, phone number, and PIN are all required." });
  }

  // Referral kill switch — checked before any referral processing
  if (incomingReferralCode) {
    const referralEnabled = await getSettingBool("referralCodesEnabled", true);
    if (!referralEnabled) {
      return res.status(403).json({ error: "Referral codes are temporarily disabled." });
    }
  }
  if (pin.length < 4) {
    return res.status(400).json({ error: "PIN must be at least 4 digits." });
  }

  const existingName = await db.select().from(playersTable).where(eq(playersTable.username, username));
  if (existingName.length > 0) {
    return res.status(400).json({ error: "That name is already registered. Try a different name." });
  }

  const existingId = await db.select().from(playersTable).where(eq(playersTable.stateId, stateId));
  if (existingId.length > 0) {
    return res.status(400).json({ error: "That State ID is already registered." });
  }

  // Resolve referral code — check promoters first, then player codes
  let referredBy: string | null = null;
  let referredByCode: string | null = null;
  let referralBonusChips = 0;
  if (incomingReferralCode && typeof incomingReferralCode === "string") {
    const code = incomingReferralCode.trim().toUpperCase();
    if (code) {
      // 1. Check active promoter codes
      const [promoter] = await db
        .select({ code: referralPromotersTable.code, isActive: referralPromotersTable.isActive, bonusChips: referralPromotersTable.bonusChips })
        .from(referralPromotersTable)
        .where(eq(referralPromotersTable.code, code));
      if (promoter?.code && promoter.isActive) {
        referredByCode = promoter.code;
        referralBonusChips = promoter.bonusChips ?? 0;
      } else if (code !== stateId.toUpperCase()) {
        // 2. Fall back to player referral code (state ID based), skip self-referral
        const [referrer] = await db
          .select({ referralCode: playersTable.referralCode })
          .from(playersTable)
          .where(eq(playersTable.referralCode, incomingReferralCode.trim()));
        if (referrer?.referralCode) {
          referredBy = referrer.referralCode;
        }
      }
    }
  }

  // Each player's own referral code = their State ID (unique by nature of the stateId unique constraint)
  const [player] = await db
    .insert(playersTable)
    .values({ username, stateId, phoneNumber, pin, chips: referralBonusChips, referralCode: stateId, referredBy, referredByCode })
    .returning();

  // Log the bonus chip transaction if applicable
  if (referralBonusChips > 0) {
    try {
      await db.insert(transactionsTable).values({
        playerId: player.id,
        amount: referralBonusChips,
        type: "bonus",
        description: `Referral bonus (code: ${referredByCode})`,
      });
    } catch { /* non-fatal */ }
  }

  const sessionToken = createPlayerSession(player.id, player.username, parseStaffRoles(player));
  return res.status(201).json({ ...safePlayer(player), sessionToken });
});

// Player login — uses State ID + PIN
router.post("/login", async (req, res) => {
  const { stateId, pin } = req.body;
  if (!stateId || !pin) {
    return res.status(401).json({ error: "State ID and PIN are required." });
  }

  const [player] = await db
    .select()
    .from(playersTable)
    .where(eq(playersTable.stateId, stateId));

  if (!player || player.pin !== pin) {
    return res.status(401).json({ error: "Invalid State ID or PIN." });
  }

  const sessionToken = createPlayerSession(player.id, player.username, parseStaffRoles(player));
  if (!player.excludeFromLoginLogs) {
    emitLoginEvent(player.id, player.username);
  }
  return res.json({ ...safePlayer(player), sessionToken });
});

// ── Online presence ──────────────────────────────────────────────────────────

// Session check: returns current player info if token is valid
router.get("/me", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found." });
  return res.json(safePlayer(player));
});

// Heartbeat: records the player as active in the given game (defaults to "lobby")
router.post("/ping", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const game = typeof req.body?.game === "string" && req.body.game.trim() ? req.body.game.trim() : "lobby";
  const [player] = await db.select({ username: playersTable.username }).from(playersTable).where(eq(playersTable.id, playerId));
  if (player) recordPlayerActivity(playerId, player.username, game);
  const players = getActivePlayers().map((p) => ({
    playerId: p.playerId,
    username: p.username,
    status: p.game === "lobby" ? "idle" : "playing",
    game: p.game === "lobby" ? null : p.game,
  }));
  return res.json({ players });
});

// Public: any logged-in player can see who is online
router.get("/online", requirePlayer, async (_req, res) => {
  const players = getActivePlayers().map((p) => ({
    playerId: p.playerId,
    username: p.username,
    status: p.game === "lobby" ? "idle" : "playing",
    game: p.game === "lobby" ? null : p.game,
  }));
  return res.json({ players });
});

// ── Player search — for transfer autocomplete (returns only name + stateId) ──
router.get("/search", requirePlayer, async (req, res) => {
  const q = (req.query.q as string ?? "").trim().toLowerCase();
  const selfId = (req as any).authenticatedPlayerId as number;
  if (!q || q.length < 2) return res.json([]);
  try {
    const all = await db.select({
      id: playersTable.id,
      username: playersTable.username,
      stateId: playersTable.stateId,
      chips: playersTable.chips,
      avatarUrl: playersTable.avatarUrl,
      wins: playersTable.wins,
      totalWon: playersTable.totalWon,
      handsPlayed: playersTable.handsPlayed,
      createdAt: playersTable.createdAt,
      isBot: playersTable.isBot,
    }).from(playersTable);

    const activePlayers = getActivePlayers();
    const activeMap = new Map(activePlayers.map(a => [a.playerId, a.game]));

    const results = all
      .filter(p =>
        p.id !== selfId &&
        !p.isBot &&
        ((p.username ?? "").toLowerCase().includes(q) || (p.stateId ?? "").toLowerCase().includes(q))
      )
      .slice(0, 8)
      .map(p => ({
        id: p.id,
        username: p.username ?? "Unknown Player",
        stateId: p.stateId ?? null,
        chips: Number(p.chips ?? 0),
        avatarUrl: p.avatarUrl ?? null,
        wins: Number(p.wins ?? 0),
        totalWon: Number(p.totalWon ?? 0),
        handsPlayed: Number(p.handsPlayed ?? 0),
        createdAt: p.createdAt?.toISOString() ?? new Date().toISOString(),
        isOnline: activeMap.has(p.id),
        currentGame: activeMap.get(p.id) ?? null,
      }));
    return res.json(results);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// Public player profile — any authenticated player can view
router.get("/:playerId/public-profile", requirePlayer, async (req, res) => {
  try {
    const id = parseInt(req.params.playerId as string);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid player ID" });

    const [player] = await db
      .select({
        id: playersTable.id,
        username: playersTable.username,
        stateId: playersTable.stateId,
        chips: playersTable.chips,
        avatarUrl: playersTable.avatarUrl,
        wins: playersTable.wins,
        totalWon: playersTable.totalWon,
        handsPlayed: playersTable.handsPlayed,
        createdAt: playersTable.createdAt,
        isBot: playersTable.isBot,
        referralCode: playersTable.referralCode,
        creditScore: playersTable.creditScore,
      })
      .from(playersTable)
      .where(eq(playersTable.id, id));

    if (!player || player.isBot) return res.status(404).json({ error: "Player not found" });

    // Challenge stats — gracefully degrade if the table hasn't been migrated yet
    let totalChallengesCompleted = 0;
    let totalChipsFromChallenges = 0;
    try {
      const claimRows = await db
        .select({ rewardAmount: challengeClaimsTable.rewardAmount })
        .from(challengeClaimsTable)
        .where(eq(challengeClaimsTable.playerId, id));
      totalChallengesCompleted = claimRows.length;
      totalChipsFromChallenges = claimRows.reduce((s, r) => s + (r.rewardAmount ?? 0), 0);
    } catch {
      // challenge_claims table may not exist yet — return zero stats
    }

    // Transaction-derived stats for the profile page stat cards
    const WAGER_T = new Set(["loss", "fortuna-bet", "fortuna-bonus-buy", "rome-slots-bet", "western-slots-bet", "highlow_bet", "baccarat", "sport_bet"]);
    const WIN_T   = new Set(["win", "tournament_win", "fortuna-win", "rome-slots-win", "western-slots-win", "rakeback"]);
    function isPokerRow(t: { type: string; description: string }) {
      const d = t.description.toLowerCase();
      return t.type === "buyin" || t.type === "poker_win" || t.type === "cashout" ||
        d.startsWith("poker") || d.startsWith("won pot") || d.startsWith("rake collected at") ||
        d.startsWith("buy-in to table") || d.startsWith("left table");
    }
    const allTxs = await db
      .select({ type: transactionsTable.type, amount: transactionsTable.amount, description: transactionsTable.description })
      .from(transactionsTable)
      .where(eq(transactionsTable.playerId, id));
    const wagerTxs  = allTxs.filter(t => WAGER_T.has(t.type) && !isPokerRow(t));
    const winTxArr  = allTxs.filter(t => WIN_T.has(t.type)   && !isPokerRow(t));
    const statWagered  = wagerTxs.reduce((s, t) => s + t.amount, 0);
    const statWon      = winTxArr.reduce((s, t) => s + t.amount, 0);
    const statBiggest  = winTxArr.reduce((max, t) => t.amount > max ? t.amount : max, 0);
    const statNet      = statWon - statWagered;
    const statRtp      = statWagered > 0 ? statWon / statWagered * 100 : 0;
    const statBetCount = wagerTxs.length;
    const statWinCount = winTxArr.length;
    const byType: Record<string, { spent: number; received: number; count: number }> = {};
    for (const t of allTxs) {
      if (!byType[t.type]) byType[t.type] = { spent: 0, received: 0, count: 0 };
      byType[t.type].count++;
      if (WIN_T.has(t.type)) byType[t.type].received += t.amount;
      else byType[t.type].spent += t.amount;
    }
    const activityBreakdown = Object.entries(byType)
      .map(([type, s]) => ({ type, ...s }))
      .sort((a, b) => (b.spent + b.received) - (a.spent + a.received));

    const activePlayers = getActivePlayers();
    const activeMap = new Map(activePlayers.map(a => [a.playerId, a.game]));

    return res.json({
      id: player.id,
      username: player.username ?? "Unknown Player",
      stateId: player.stateId ?? null,
      chips: Number(player.chips ?? 0),
      avatarUrl: player.avatarUrl ?? null,
      wins: Number(player.wins ?? 0),
      totalWon: Number(player.totalWon ?? 0),
      handsPlayed: Number(player.handsPlayed ?? 0),
      createdAt: player.createdAt?.toISOString() ?? new Date().toISOString(),
      isOnline: activeMap.has(player.id),
      currentGame: activeMap.get(player.id) ?? null,
      referralCode: player.referralCode ?? null,
      creditScore: typeof player.creditScore === "number" ? player.creditScore : null,
      challengeStats: {
        completed: totalChallengesCompleted,
        chipsEarned: totalChipsFromChallenges,
      },
      statWagered,
      statWon,
      statBiggestWin: statBiggest,
      statNetResult: statNet,
      statRtp,
      statBetCount,
      statWinCount,
      activityBreakdown,
    });
  } catch (e: any) {
    console.error("[public-profile] error:", e?.message ?? e);
    return res.status(500).json({ error: "Failed to load profile" });
  }
});

// ── Player-to-player chip transfer ───────────────────────────────────────────
router.post("/transfer", requirePlayer, async (req, res) => {
  const senderId = (req as any).authenticatedPlayerId as number;
  const { toUsername, amount } = req.body ?? {};

  // Global kill switch check
  const transferEnabled = await getSettingBool("playerTransfersEnabled", true);
  if (!transferEnabled) {
    return res.status(403).json({ error: "Player transfers are temporarily disabled." });
  }

  const amt = parseInt(amount);
  if (!toUsername || typeof toUsername !== "string") return res.status(400).json({ error: "toUsername required" });
  if (!amt || amt < 1) return res.status(400).json({ error: "Amount must be at least 1 chip" });
  if (amt > 10_000_000) return res.status(400).json({ error: "Max transfer is 10,000,000 chips" });

  try {
    const [sender] = await db.select().from(playersTable).where(eq(playersTable.id, senderId));
    if (!sender) return res.status(404).json({ error: "Sender not found" });

    const target = toUsername.trim().toLowerCase();
    const allRecipients = await db.select().from(playersTable);
    const recipient = allRecipients.find(p => p.username.toLowerCase() === target);
    if (!recipient) return res.status(404).json({ error: `Player "${toUsername}" not found` });
    if (recipient.id === senderId) return res.status(400).json({ error: "Cannot transfer chips to yourself" });

    if (Number(sender.chips) < amt) {
      return res.status(400).json({ error: `Insufficient chips — you have ${Number(sender.chips).toLocaleString()} chips` });
    }

    await db.update(playersTable)
      .set({ chips: sqlFn`${playersTable.chips} - ${amt}` })
      .where(eq(playersTable.id, senderId));
    await db.update(playersTable)
      .set({ chips: sqlFn`${playersTable.chips} + ${amt}` })
      .where(eq(playersTable.id, recipient.id));

    await db.insert(transactionsTable).values({
      playerId: senderId, amount: amt, type: "transfer_sent",
      description: `Chip transfer to ${recipient.username}`,
    });
    await db.insert(transactionsTable).values({
      playerId: recipient.id, amount: amt, type: "transfer_received",
      description: `Chip transfer from ${sender.username}`,
    });

    const [[updatedSender], [updatedRecipient]] = await Promise.all([
      db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, senderId)),
      db.select({ chips: playersTable.chips }).from(playersTable).where(eq(playersTable.id, recipient.id)),
    ]);
    const newBalance = Number(updatedSender?.chips ?? 0);
    // Push live balance updates via WebSocket so both players see it instantly
    broadcastPlayerBalance(senderId, newBalance);
    broadcastPlayerBalance(recipient.id, Number(updatedRecipient?.chips ?? 0));
    return res.json({ success: true, newBalance });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// Change own PIN — player self-service
router.post("/change-pin", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { currentPin, newPin } = req.body;
  if (!currentPin || !newPin) return res.status(400).json({ error: "Current PIN and new PIN are required." });
  if (String(newPin).length < 4) return res.status(400).json({ error: "New PIN must be at least 4 characters." });
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, playerId));
  if (!player) return res.status(404).json({ error: "Player not found." });
  if (player.pin !== String(currentPin)) return res.status(401).json({ error: "Current PIN is incorrect." });
  await db.update(playersTable).set({ pin: String(newPin) }).where(eq(playersTable.id, playerId));
  return res.json({ success: true });
});

// ── Public leaderboard — must be before /:playerId wildcard ──────────────────
router.get("/leaderboard", async (_req, res) => {
  const players = await db
    .select({
      id: playersTable.id,
      username: playersTable.username,
      chips: playersTable.chips,
      handsPlayed: playersTable.handsPlayed,
      wins: playersTable.wins,
      totalWon: playersTable.totalWon,
      avatarUrl: playersTable.avatarUrl,
      staffRole: playersTable.staffRole,
    })
    .from(playersTable)
    .where(sqlFn`${playersTable.isBot} = false`);

  function getTier(chips: number): string {
    if (chips >= 1_000_000) return "Diamond";
    if (chips >= 500_000)   return "Platinum";
    if (chips >= 200_000)   return "Gold";
    if (chips >= 50_000)    return "Silver";
    return "Bronze";
  }

  const result = players.map(p => {
    const wins = (p.wins as number) ?? 0;
    const games = p.handsPlayed ?? 0;
    const winRate = games > 0 ? Math.round((wins / games) * 100) : 0;
    const totalWon = (p.totalWon as number) ?? 0;
    return {
      id: p.id,
      username: p.username,
      games,
      wins,
      winRate,
      totalWon,
      chips: p.chips,
      tier: getTier(p.chips),
      avatarUrl: p.avatarUrl ?? null,
      staffRole: p.staffRole ?? null,
    };
  });

  return res.json(result);
});

// Get single player by ID — own session or banker
router.get("/:playerId", requireAuth, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const isBanker = (req as any).isBanker;
  const requesterId = (req as any).authenticatedPlayerId as number | undefined;

  if (!isBanker && requesterId !== id) {
    return res.status(403).json({ error: "You can only view your own profile" });
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, id));
  if (!player) return res.status(404).json({ error: "Player not found" });
  return res.json(safePlayer(player));
});

// Delete player — banker only
router.delete("/:playerId", requireBanker, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, id));
  if (!player) return res.status(404).json({ error: "Player not found" });

  invalidatePlayerSessions(id);
  await db.delete(blackjackGamesTable).where(eq(blackjackGamesTable.playerId, id));
  await db.delete(transactionsTable).where(eq(transactionsTable.playerId, id));
  await db.delete(playersTable).where(eq(playersTable.id, id));
  return res.json({ success: true, message: "Player deleted" });
});

// Adjust chips — banker, cage clerk, junior banker
// action: "deposit" | "withdrawal" | "gift"
//   deposit    → adds chips, logged as type "deposit"    (counts toward cash on hand)
//   withdrawal → removes chips, logged as type "withdrawal" (counts toward cash on hand)
//   gift       → adds chips, logged as type "bonus"      (never counts toward cash on hand)
router.post("/:playerId/chips", requireCageClerkOrAbove, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const { amount, reason, action } = req.body;
  const session = (req as any).bankerSession;

  if (typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  const validActions = ["deposit", "withdrawal", "gift"];
  const txAction: "deposit" | "withdrawal" | "gift" = validActions.includes(action) ? action : "deposit";

  // ── Always re-read ALL roles from DB so stale sessions can never bypass limits ──
  let allRoles: string[] = [session.role, session.role2].filter(Boolean) as string[];
  try {
    const [ba] = await db
      .select({ role: bankerAccountsTable.role, role2: bankerAccountsTable.role2 })
      .from(bankerAccountsTable)
      .where(eq(bankerAccountsTable.id, session.accountId));
    if (ba) {
      allRoles = [ba.role, ba.role2].filter(Boolean) as string[];
    } else {
      const [pl] = await db
        .select({ staffRole: playersTable.staffRole, staffRole2: playersTable.staffRole2 })
        .from(playersTable)
        .where(eq(playersTable.id, session.accountId));
      if (pl) allRoles = [pl.staffRole, pl.staffRole2].filter(Boolean) as string[];
    }
  } catch {
    // Non-fatal: fall back to session roles
  }

  const hasRole = (...roles: string[]) => allRoles.some((r) => roles.includes(r));
  const isOwnerOrBanker = hasRole("owner", "banker");

  // ── Role-based limits ─────────────────────────────────────────────────────
  console.log(`[chips] accountId=${session.accountId} dbRoles="${allRoles.join(",")}" action=${txAction} amount=${amount}`);

  if (!isOwnerOrBanker) {
    if (hasRole("cage_clerk")) {
      if (txAction === "withdrawal") {
        return res.status(403).json({ error: "Cage Clerk cannot process withdrawals." });
      }
      if (amount > 100_000) {
        return res.status(403).json({ error: "Cage Clerk limit: max 100,000 chips per transaction." });
      }
    }

    if (hasRole("junior_banker")) {
      if (amount > 250_000) {
        return res.status(403).json({ error: "Junior Banker limit: max 250,000 chips per transaction." });
      }
    }
  }

  // ── Loan enforcement: block withdrawals if setting enabled and player has escalated loans ──
  if (txAction === "withdrawal") {
    try {
      const loanSettings = await getLoanSettings();
      if (loanSettings.blockWithdrawals === "true") {
        const playerLoans = await db.select().from(loansTable).where(eq(loansTable.playerId, id));
        const hasEscalated = playerLoans.some(l =>
          l.status !== "paid" && l.status !== "defaulted" &&
          (l.stage === "delinquent" || l.stage === "collections")
        );
        if (hasEscalated) {
          return res.status(403).json({ error: "Withdrawals blocked — player has loans in delinquent or collections status." });
        }
      }
    } catch { /* non-fatal */ }
  }

  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, id));
  if (!player) return res.status(404).json({ error: "Player not found" });

  // Withdrawals reduce chips; deposits and gifts increase chips
  const delta = txAction === "withdrawal" ? -amount : amount;
  const newChips = player.chips + delta;
  if (newChips < 0) {
    return res.status(400).json({ error: "Insufficient chips" });
  }

  const realDelta = txAction === "deposit" ? amount : (txAction === "withdrawal" ? -amount : 0);
  const newRealBalance = Math.max(0, player.realBalance + realDelta);

  const [updated] = await db
    .update(playersTable)
    .set({ chips: newChips, ...(realDelta !== 0 ? { realBalance: newRealBalance } : {}) })
    .where(eq(playersTable.id, id))
    .returning();

  // Log with staff accountability
  try {
    const txType = txAction === "gift" ? "bonus" : txAction === "withdrawal" ? "withdrawal" : "deposit";
    const defaultDesc =
      txAction === "deposit"    ? `Deposited by ${session.username}` :
      txAction === "withdrawal" ? `Withdrawn by ${session.username}` :
                                  `Gift from ${session.username}`;
    await db.insert(transactionsTable).values({
      playerId: id,
      amount,
      type: txType,
      description: reason || defaultDesc,
      staffId: session.accountId,
      staffUsername: session.username,
    });
  } catch (logErr: any) {
    console.error("[chips] transaction log failed:", logErr?.message ?? logErr);
  }

  // Recalculate credit score on deposits (non-blocking)
  if (txAction === "deposit") {
    updateCreditScore(id).catch(() => {});
  }

  return res.json(safePlayer(updated));
});

// ── Babalari currency (rate setting only — deposits logged via banker panel) ───

// Staff: set the babalari → chips exchange rate
router.post("/babalari/set-rate", requireBankerOrOwner, async (req, res) => {
  const { rate } = req.body;
  if (!rate || !Number.isInteger(rate) || rate < 1)
    return res.status(400).json({ error: "Rate must be a positive integer" });
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.key, "babalariRate"));
  if (existing) {
    await db.update(settingsTable).set({ value: String(rate) }).where(eq(settingsTable.key, "babalariRate"));
  } else {
    await db.insert(settingsTable).values({ key: "babalariRate", value: String(rate) });
  }
  return res.json({ rate });
});

// Transaction history — own session, player-staff, or banker
router.get("/:playerId/transactions", requireAuth, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const isBanker = (req as any).isBanker;
  const requesterId = (req as any).authenticatedPlayerId as number | undefined;

  if (!isBanker && requesterId !== id) {
    // Allow player-staff accounts (players with a staffRole) to view any player's transactions
    if (requesterId) {
      const [requestingPlayer] = await db
        .select({ staffRole: playersTable.staffRole })
        .from(playersTable)
        .where(eq(playersTable.id, requesterId));
      if (!requestingPlayer?.staffRole) {
        return res.status(403).json({ error: "You can only view your own transactions" });
      }
    } else {
      return res.status(403).json({ error: "You can only view your own transactions" });
    }
  }

  const txs = await db
    .select()
    .from(transactionsTable)
    .where(sqlFn`${transactionsTable.playerId} = ${id} AND NOT (type = 'bonus' AND description ILIKE 'Referral bonus%')`)
    .orderBy(desc(transactionsTable.createdAt));

  return res.json(txs.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })));
});

// Update avatar URL — own session only
router.patch("/:playerId/avatar", requireAuth, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const requesterId = (req as any).authenticatedPlayerId as number | undefined;
  const isBanker = (req as any).isBanker;

  if (!isBanker && requesterId !== id) {
    return res.status(403).json({ error: "You can only update your own avatar" });
  }

  const { avatarUrl } = req.body;
  if (typeof avatarUrl !== "string") {
    return res.status(400).json({ error: "avatarUrl is required" });
  }

  const [updated] = await db
    .update(playersTable)
    .set({ avatarUrl })
    .where(eq(playersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Player not found" });
  return res.json(safePlayer(updated));
});

// Remove avatar — resets to initials fallback
router.delete("/:playerId/avatar", requireAuth, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const requesterId = (req as any).authenticatedPlayerId as number | undefined;
  const isBanker    = (req as any).isBanker;
  if (!isBanker && requesterId !== id) {
    return res.status(403).json({ error: "You can only update your own avatar" });
  }
  const [updated] = await db
    .update(playersTable)
    .set({ avatarUrl: null })
    .where(eq(playersTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Player not found" });
  return res.json(safePlayer(updated));
});

// Direct avatar file upload — own session only
// Client POSTs the raw image binary with Content-Type: image/*
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

router.post(
  "/:playerId/avatar/upload",
  requireAuth,
  express.raw({ type: Object.keys(ALLOWED_IMAGE_TYPES), limit: "5mb" }),
  async (req, res) => {
    const id = parseInt(req.params.playerId as string);
    const requesterId = (req as any).authenticatedPlayerId as number | undefined;
    const isBanker = (req as any).isBanker;

    if (!isBanker && requesterId !== id) {
      return res.status(403).json({ error: "You can only update your own avatar" });
    }

    const contentType = req.headers["content-type"] ?? "";
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) {
      return res.status(400).json({ error: "Unsupported image type. Use JPEG, PNG, GIF, or WebP." });
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "No image data received." });
    }

    const filename = `${randomUUID()}.${ext}`;
    const filePath = path.join(AVATAR_UPLOADS_DIR, filename);
    await fs.writeFile(filePath, req.body);

    const avatarUrl = `/api/uploads/avatars/${filename}`;

    const [updated] = await db
      .update(playersTable)
      .set({ avatarUrl })
      .where(eq(playersTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Player not found" });
    return res.json(safePlayer(updated));
  },
);

const VALID_STAFF_ROLES = ["owner", "banker", "dealer", "sportbets", "security_guard", "pit_boss", "cage_clerk", "junior_banker"];

// Assign or remove staff role(s) from a player — owner or banker
router.patch("/:playerId/staff-role", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const session = (req as any).bankerSession;
  const callerIsOwner = sessionHasRole(session, "owner");

  // Bankers cannot assign owner or banker roles to players
  const OWNER_BANKER_ROLES = ["owner", "banker"];

  // New: accept staffRoles array for multi-role assignment
  if ("staffRoles" in req.body) {
    const incoming: string[] = Array.isArray(req.body.staffRoles) ? req.body.staffRoles : [];

    let valid: string[];
    if (callerIsOwner) {
      valid = incoming.filter((r) => VALID_STAFF_ROLES.includes(r));
    } else {
      // Fetch current roles so we can preserve any existing restricted roles
      const target = await db.select().from(playersTable).where(eq(playersTable.id, id)).limit(1);
      const currentRoles = target[0] ? [target[0].staffRole, target[0].staffRole2].filter(Boolean) as string[] : [];
      // Block if the banker is trying to ADD a restricted role that the player doesn't already have
      const addedRestricted = incoming.filter((r) => OWNER_BANKER_ROLES.includes(r) && !currentRoles.includes(r));
      if (addedRestricted.length > 0) {
        return res.status(403).json({ error: "Bankers cannot assign owner or banker roles." });
      }
      // Preserve existing restricted roles + apply non-restricted incoming roles
      const preserved = currentRoles.filter((r) => OWNER_BANKER_ROLES.includes(r));
      const nonRestricted = incoming.filter((r) => !OWNER_BANKER_ROLES.includes(r) && VALID_STAFF_ROLES.includes(r));
      valid = [...preserved, ...nonRestricted];
    }
    const staffRolesJson = valid.length > 0 ? JSON.stringify(valid) : null;
    const staffRole = valid[0] ?? null;
    const staffRole2 = valid[1] ?? null;

    const [updated] = await db
      .update(playersTable)
      .set({ staffRole, staffRole2, staffRolesJson })
      .where(eq(playersTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Player not found." });
    updatePlayerSessionStaffRole(id, valid);
    return res.json(safePlayer(updated));
  }

  // Legacy: individual staffRole / staffRole2 fields
  const { staffRole, staffRole2 } = req.body;
  if (!callerIsOwner) {
    if (staffRole && OWNER_BANKER_ROLES.includes(staffRole)) {
      return res.status(403).json({ error: "Bankers cannot assign owner or banker roles." });
    }
    if (staffRole2 && OWNER_BANKER_ROLES.includes(staffRole2)) {
      return res.status(403).json({ error: "Bankers cannot assign owner or banker roles." });
    }
  }
  const updates: Record<string, any> = {};
  if ("staffRole" in req.body) {
    updates.staffRole = staffRole && VALID_STAFF_ROLES.includes(staffRole) ? staffRole : null;
  }
  if ("staffRole2" in req.body) {
    updates.staffRole2 = staffRole2 && VALID_STAFF_ROLES.includes(staffRole2) ? staffRole2 : null;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update." });
  }

  const [updated] = await db
    .update(playersTable)
    .set(updates)
    .where(eq(playersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Player not found." });

  // Rebuild roles array and sync staffRolesJson
  const allRoles = [updated.staffRole, updated.staffRole2].filter(Boolean) as string[];
  await db.update(playersTable)
    .set({ staffRolesJson: allRoles.length > 0 ? JSON.stringify(allRoles) : null })
    .where(eq(playersTable.id, id));

  updatePlayerSessionStaffRole(id, allRoles);
  return res.json(safePlayer(updated));
});

// Rename player — banker or owner only
router.patch("/:playerId/username", requireBankerOrOwner, async (req, res) => {
  const id = parseInt(req.params.playerId as string);
  const { username } = req.body;
  if (!username || typeof username !== "string") return res.status(400).json({ error: "Username is required." });
  const trimmed = username.trim();
  if (!trimmed) return res.status(400).json({ error: "Username cannot be empty." });
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, id));
  if (!player) return res.status(404).json({ error: "Player not found." });
  const [existing] = await db.select().from(playersTable).where(eq(playersTable.username, trimmed));
  if (existing && existing.id !== id) return res.status(400).json({ error: "That name is already taken by another player." });
  await db.update(playersTable).set({ username: trimmed }).where(eq(playersTable.id, id));
  return res.json({ success: true, username: trimmed });
});

export default router;
