import { Router } from "express";
import { randomInt } from "crypto";
import { db, playersTable, transactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requirePlayer, requireBankerOrOwner, requireDealerOrAbove } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

// ─── Card generation ──────────────────────────────────────────────────────────

function pickNUnique(min: number, max: number, count: number): number[] {
  const pool: number[] = [];
  for (let i = min; i <= max; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

function generateCard(): number[][] {
  const B = pickNUnique(1, 15, 5);
  const I = pickNUnique(16, 30, 5);
  const N4 = pickNUnique(31, 45, 4);
  const G = pickNUnique(46, 60, 5);
  const O = pickNUnique(61, 75, 5);
  return [
    [B[0], I[0], N4[0], G[0], O[0]],
    [B[1], I[1], N4[1], G[1], O[1]],
    [B[2], I[2], 0,     G[2], O[2]],
    [B[3], I[3], N4[2], G[3], O[3]],
    [B[4], I[4], N4[3], G[4], O[4]],
  ];
}

async function generateUniqueCard(roundId: number): Promise<number[][]> {
  const existing = await db.execute(sql`SELECT card_numbers FROM bingo_cards WHERE round_id = ${roundId}`);
  const seen = new Set((existing.rows as any[]).map((r) => r.card_numbers as string));
  for (let attempt = 0; attempt < 50; attempt++) {
    const grid = generateCard();
    const fp = JSON.stringify(grid);
    if (!seen.has(fp)) return grid;
  }
  return generateCard();
}

// ─── Pattern validation ───────────────────────────────────────────────────────

function checkPattern(grid: number[][], markedNumbers: number[], pattern: string): boolean {
  const marked = new Set(markedNumbers);
  const isMarked = (n: number) => n === 0 || marked.has(n);
  if (pattern === "single_line") {
    for (let r = 0; r < 5; r++) {
      if (grid[r].every((n) => isMarked(n))) return true;
    }
    for (let c = 0; c < 5; c++) {
      if (grid.every((row) => isMarked(row[c]))) return true;
    }
    if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][i]))) return true;
    if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][4 - i]))) return true;
  }
  return false;
}

function hasSuspiciousMarkings(markedNumbers: number[], drawnBalls: number[]): boolean {
  const drawn = new Set(drawnBalls);
  return markedNumbers.some((n) => n !== 0 && !drawn.has(n));
}

function getBallLabel(n: number): string {
  if (n <= 15) return `B-${n}`;
  if (n <= 30) return `I-${n}`;
  if (n <= 45) return `N-${n}`;
  if (n <= 60) return `G-${n}`;
  return `O-${n}`;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function logAction(roundId: number | null, staffUserId: number | null, actionType: string, details: any) {
  try {
    await db.execute(sql`
      INSERT INTO bingo_dealer_actions (round_id, staff_user_id, action_type, details, timestamp)
      VALUES (${roundId}, ${staffUserId}, ${actionType}, ${JSON.stringify(details)}, NOW())
    `);
  } catch {}
}

function formatRound(r: any) {
  return {
    id: r.id,
    status: r.status,
    dealerId: r.dealer_id,
    dealerUsername: r.dealer_username,
    cardPrice: Number(r.card_price),
    maxCardsPerPlayer: Number(r.max_cards_per_player),
    houseCutPercent: Number(r.house_cut_percent),
    prizePoolPercent: Number(r.prize_pool_percent),
    winningPattern: r.winning_pattern,
    drawnBalls: JSON.parse(r.drawn_balls || "[]"),
    totalCardsSold: Number(r.total_cards_sold),
    totalCollected: Number(r.total_collected),
    prizePool: Number(r.prize_pool),
    houseProfit: Number(r.house_profit),
    rolloverApplied: Number(r.rollover_applied || 0),
    createdAt: r.created_at,
    buyingOpenedAt: r.buying_opened_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  };
}

// ─── GET /bingo/settings ─────────────────────────────────────────────────────
router.get("/settings", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.execute(sql`SELECT * FROM bingo_settings ORDER BY id DESC LIMIT 1`);
  const r = (rows.rows as any[])[0];
  if (!r) return res.json({ cardPrice: 1000, maxCardsPerPlayer: 5, houseCutPercent: 20, prizePoolPercent: 80, winningPattern: "single_line" });
  return res.json({
    cardPrice: Number(r.card_price),
    maxCardsPerPlayer: Number(r.max_cards_per_player),
    houseCutPercent: Number(r.house_cut_percent),
    prizePoolPercent: Number(r.prize_pool_percent),
    winningPattern: r.winning_pattern,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  });
});

// ─── POST /bingo/settings ────────────────────────────────────────────────────
router.post("/settings", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const { cardPrice, maxCardsPerPlayer, houseCutPercent, prizePoolPercent, winningPattern } = req.body ?? {};
  if (typeof cardPrice !== "number" || cardPrice < 1) return res.status(400).json({ error: "Invalid cardPrice" });
  if (typeof maxCardsPerPlayer !== "number" || maxCardsPerPlayer < 1 || maxCardsPerPlayer > 50) return res.status(400).json({ error: "Invalid maxCardsPerPlayer" });
  if (typeof houseCutPercent !== "number" || houseCutPercent < 0 || houseCutPercent > 100) return res.status(400).json({ error: "Invalid houseCutPercent" });
  if (typeof prizePoolPercent !== "number" || prizePoolPercent < 0 || prizePoolPercent > 100) return res.status(400).json({ error: "Invalid prizePoolPercent" });
  if (!["single_line"].includes(winningPattern)) return res.status(400).json({ error: "Invalid winningPattern" });

  const existing = await db.execute(sql`SELECT id FROM bingo_settings LIMIT 1`);
  if ((existing.rows as any[]).length > 0) {
    await db.execute(sql`
      UPDATE bingo_settings SET
        card_price = ${cardPrice}, max_cards_per_player = ${maxCardsPerPlayer},
        house_cut_percent = ${houseCutPercent}, prize_pool_percent = ${prizePoolPercent},
        winning_pattern = ${winningPattern}, updated_by = ${session.username}, updated_at = NOW()
    `);
  } else {
    await db.execute(sql`
      INSERT INTO bingo_settings (card_price, max_cards_per_player, house_cut_percent, prize_pool_percent, winning_pattern, updated_by, updated_at)
      VALUES (${cardPrice}, ${maxCardsPerPlayer}, ${houseCutPercent}, ${prizePoolPercent}, ${winningPattern}, ${session.username}, NOW())
    `);
  }
  await logAction(null, session.accountId, "settings_changed", { cardPrice, maxCardsPerPlayer, houseCutPercent, prizePoolPercent, winningPattern, changedBy: session.username });
  return res.json({ ok: true });
});

// ─── GET /bingo/active — public round status ─────────────────────────────────
router.get("/active", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT * FROM bingo_rounds WHERE status NOT IN ('completed', 'cancelled') ORDER BY id DESC LIMIT 1
  `);
  const r = (rows.rows as any[])[0];
  if (!r) return res.json({ round: null });
  return res.json({ round: formatRound(r) });
});

// ─── GET /bingo/rounds — list (dealer+) ─────────────────────────────────────
router.get("/rounds", requireDealerOrAbove, async (_req, res) => {
  const rows = await db.execute(sql`SELECT * FROM bingo_rounds ORDER BY id DESC LIMIT 50`);
  return res.json((rows.rows as any[]).map(formatRound));
});

// ─── POST /bingo/rounds — create (dealer+) ────────────────────────────────────
router.post("/rounds", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const active = await db.execute(sql`
    SELECT id FROM bingo_rounds WHERE status NOT IN ('completed','cancelled') LIMIT 1
  `);
  if ((active.rows as any[]).length > 0) {
    return res.status(409).json({ error: "An active round already exists. Complete or cancel it first." });
  }
  const sRows = await db.execute(sql`SELECT * FROM bingo_settings ORDER BY id DESC LIMIT 1`);
  const s = (sRows.rows as any[])[0];
  const cardPrice = s ? Number(s.card_price) : 1000;
  const maxCardsPerPlayer = s ? Number(s.max_cards_per_player) : 5;
  const houseCutPercent = s ? Number(s.house_cut_percent) : 20;
  const prizePoolPercent = s ? Number(s.prize_pool_percent) : 80;
  const winningPattern = s ? s.winning_pattern : "single_line";
  const rolloverPool = s ? Number(s.rollover_pool || 0) : 0;
  const result = await db.execute(sql`
    INSERT INTO bingo_rounds (status, dealer_id, dealer_username, card_price, max_cards_per_player, house_cut_percent, prize_pool_percent, winning_pattern, drawn_balls, prize_pool, rollover_applied, created_at)
    VALUES ('waiting', ${session.accountId}, ${session.username}, ${cardPrice}, ${maxCardsPerPlayer}, ${houseCutPercent}, ${prizePoolPercent}, ${winningPattern}, '[]', ${rolloverPool}, ${rolloverPool}, NOW())
    RETURNING id
  `);
  const roundId = (result.rows as any[])[0].id;
  if (rolloverPool > 0) {
    await db.execute(sql`UPDATE bingo_settings SET rollover_pool = 0`);
    await logAction(roundId, session.accountId, "rollover_applied", { amount: rolloverPool });
  }
  await logAction(roundId, session.accountId, "round_created", { dealerUsername: session.username, cardPrice, maxCardsPerPlayer, rolloverPool });
  return res.json({ ok: true, roundId, rolloverPool });
});

// ─── POST /bingo/rounds/:id/open-buying ──────────────────────────────────────
router.post("/rounds/:id/open-buying", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "waiting") return res.status(400).json({ error: "Round must be Waiting" });
  await db.execute(sql`UPDATE bingo_rounds SET status='buying_open', buying_opened_at=NOW() WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "buying_opened", {});
  return res.json({ ok: true });
});

// ─── POST /bingo/rounds/:id/close-buying ─────────────────────────────────────
router.post("/rounds/:id/close-buying", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "buying_open") return res.status(400).json({ error: "Round must be Buying Open" });
  await db.execute(sql`UPDATE bingo_rounds SET status='buying_closed' WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "buying_closed", {});
  return res.json({ ok: true });
});

// ─── POST /bingo/rounds/:id/start ────────────────────────────────────────────
router.post("/rounds/:id/start", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "buying_closed") return res.status(400).json({ error: "Round must be Buying Closed" });
  await db.execute(sql`UPDATE bingo_rounds SET status='in_progress', started_at=NOW() WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "round_started", {});
  return res.json({ ok: true });
});

// ─── POST /bingo/rounds/:id/draw ─────────────────────────────────────────────
router.post("/rounds/:id/draw", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (!["in_progress", "claim_review"].includes(round.status)) return res.status(400).json({ error: "Round must be In Progress" });
  const drawnBalls: number[] = JSON.parse(round.drawn_balls || "[]");
  const allBalls: number[] = [];
  for (let i = 1; i <= 75; i++) allBalls.push(i);
  const remaining = allBalls.filter((b) => !drawnBalls.includes(b));
  if (remaining.length === 0) return res.status(400).json({ error: "All 75 balls have been drawn" });
  const newBall = remaining[randomInt(0, remaining.length)];
  drawnBalls.push(newBall);
  await db.execute(sql`UPDATE bingo_rounds SET drawn_balls=${JSON.stringify(drawnBalls)} WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "ball_drawn", { ball: newBall, label: getBallLabel(newBall) });
  return res.json({ ok: true, ball: newBall, label: getBallLabel(newBall), drawnBalls, remaining: remaining.length - 1 });
});

// ─── POST /bingo/rounds/:id/undo-draw ────────────────────────────────────────
router.post("/rounds/:id/undo-draw", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (!["in_progress", "claim_review"].includes(round.status)) return res.status(400).json({ error: "Round must be In Progress" });
  const drawnBalls: number[] = JSON.parse(round.drawn_balls || "[]");
  if (drawnBalls.length === 0) return res.status(400).json({ error: "No balls drawn yet" });
  const removed = drawnBalls.pop()!;
  await db.execute(sql`UPDATE bingo_rounds SET drawn_balls=${JSON.stringify(drawnBalls)} WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "ball_undone", { ball: removed });
  return res.json({ ok: true, removedBall: removed, label: getBallLabel(removed), drawnBalls });
});

// ─── POST /bingo/rounds/:id/complete ─────────────────────────────────────────
router.post("/rounds/:id/complete", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (!["in_progress", "claim_review", "buying_closed"].includes(round.status)) {
    return res.status(400).json({ error: "Round cannot be completed from current status" });
  }
  const payoutRows = await db.execute(sql`SELECT id FROM bingo_payouts WHERE round_id=${roundId} LIMIT 1`);
  const hasWinner = (payoutRows.rows as any[]).length > 0;
  const drawnBalls: number[] = JSON.parse(round.drawn_balls || "[]");
  const allBallsDrawn = drawnBalls.length >= 75;
  let refundedCount = 0;
  let rolloverAmount = 0;
  if (!hasWinner) {
    if (allBallsDrawn) {
      // All 75 balls drawn with no winner — roll the prize pool into the next round
      rolloverAmount = Number(round.prize_pool);
      await db.execute(sql`
        UPDATE bingo_settings SET rollover_pool = rollover_pool + ${rolloverAmount}
      `);
      await logAction(roundId, session.accountId, "prize_rolled_over", { amount: rolloverAmount });
    } else {
      // Early end with no winner — refund all card buyers
      const cardPrice = Number(round.card_price);
      const playerCards = await db.execute(sql`
        SELECT player_id, COUNT(*) as card_count FROM bingo_cards WHERE round_id = ${roundId} GROUP BY player_id
      `);
      for (const c of playerCards.rows as any[]) {
        const refund = Number(c.card_count) * cardPrice;
        if (refund > 0) {
          await db.execute(sql`UPDATE players SET chips = chips + ${refund} WHERE id = ${c.player_id}`);
          await db.execute(sql`
            INSERT INTO transactions (player_id, amount, type, description)
            VALUES (${c.player_id}, ${refund}, 'win', ${"Bingo refund — Round #" + roundId + " no winner"})
          `);
          try { broadcastPlayerBalance(c.player_id, -1); } catch {}
          refundedCount++;
        }
      }
    }
  }
  await db.execute(sql`UPDATE bingo_rounds SET status='completed', completed_at=NOW() WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "round_completed", { hasWinner, allBallsDrawn, refundedCount, rolloverAmount });
  return res.json({ ok: true, hasWinner, allBallsDrawn, refundedCount, rolloverAmount });
});

// ─── POST /bingo/rounds/:id/cancel ───────────────────────────────────────────
router.post("/rounds/:id/cancel", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (["completed", "cancelled"].includes(round.status)) {
    return res.status(400).json({ error: "Round is already finished" });
  }
  const cardPrice = Number(round.card_price);
  const playerCards = await db.execute(sql`
    SELECT player_id, COUNT(*) as card_count FROM bingo_cards WHERE round_id = ${roundId} GROUP BY player_id
  `);
  for (const c of playerCards.rows as any[]) {
    const refund = Number(c.card_count) * cardPrice;
    if (refund > 0) {
      await db.execute(sql`UPDATE players SET chips = chips + ${refund} WHERE id = ${c.player_id}`);
      await db.execute(sql`
        INSERT INTO transactions (player_id, amount, type, description)
        VALUES (${c.player_id}, ${refund}, 'win', ${"Bingo refund — Round #" + roundId + " cancelled"})
      `);
      try { broadcastPlayerBalance(c.player_id, -1); } catch {}
    }
  }
  await db.execute(sql`UPDATE bingo_rounds SET status='cancelled', completed_at=NOW() WHERE id=${roundId}`);
  await logAction(roundId, session.accountId, "round_cancelled", {});
  return res.json({ ok: true });
});

// ─── GET /bingo/rounds/:id — detail (dealer+) ────────────────────────────────
router.get("/rounds/:id", requireDealerOrAbove, async (req, res) => {
  const roundId = parseInt(req.params.id);
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id = ${roundId}`);
  const r = (rRows.rows as any[])[0];
  if (!r) return res.status(404).json({ error: "Round not found" });
  const players = await db.execute(sql`
    SELECT bc.player_id, p.username, COUNT(bc.id) as card_count
    FROM bingo_cards bc JOIN players p ON p.id = bc.player_id
    WHERE bc.round_id = ${roundId}
    GROUP BY bc.player_id, p.username
    ORDER BY bc.player_id
  `);
  return res.json({
    ...formatRound(r),
    players: (players.rows as any[]).map((p) => ({
      playerId: p.player_id,
      username: p.username,
      cardCount: Number(p.card_count),
    })),
  });
});

// ─── GET /bingo/rounds/:id/all-cards — dealer+ ───────────────────────────────
router.get("/rounds/:id/all-cards", requireDealerOrAbove, async (req, res) => {
  const roundId = parseInt(req.params.id);
  const { playerId } = req.query;
  let cardsRows;
  if (playerId) {
    cardsRows = await db.execute(sql`
      SELECT bc.*, p.username FROM bingo_cards bc JOIN players p ON p.id=bc.player_id
      WHERE bc.round_id=${roundId} AND bc.player_id=${parseInt(playerId as string)} ORDER BY bc.id ASC
    `);
  } else {
    cardsRows = await db.execute(sql`
      SELECT bc.*, p.username FROM bingo_cards bc JOIN players p ON p.id=bc.player_id
      WHERE bc.round_id=${roundId} ORDER BY bc.player_id, bc.id ASC
    `);
  }
  return res.json((cardsRows.rows as any[]).map((c) => ({
    id: c.id,
    roundId: c.round_id,
    playerId: c.player_id,
    playerName: c.username,
    cardNumbers: JSON.parse(c.card_numbers),
    markedNumbers: JSON.parse(c.marked_numbers || "[0]"),
    createdAt: c.created_at,
  })));
});

// ─── GET /bingo/rounds/:id/claims — dealer+ ──────────────────────────────────
router.get("/rounds/:id/claims", requireDealerOrAbove, async (req, res) => {
  const roundId = parseInt(req.params.id);
  const claims = await db.execute(sql`SELECT * FROM bingo_claims WHERE round_id=${roundId} ORDER BY claim_time ASC`);
  return res.json((claims.rows as any[]).map((c) => ({
    id: c.id,
    roundId: c.round_id,
    playerId: c.player_id,
    playerName: c.player_name,
    stateId: c.state_id,
    phoneNumber: c.phone_number,
    claimedCardId: c.claimed_card_id,
    cardNumbers: JSON.parse(c.card_numbers),
    markedNumbers: JSON.parse(c.marked_numbers),
    drawnBallsAtClaim: JSON.parse(c.drawn_balls_at_claim),
    status: c.status,
    claimTime: c.claim_time,
    reviewedBy: c.reviewed_by,
    reviewedAt: c.reviewed_at,
    rejectionReason: c.rejection_reason,
  })));
});

// ─── POST /bingo/claims/:id/approve — dealer+ ────────────────────────────────
router.post("/claims/:id/approve", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const claimId = parseInt(req.params.id);
  const claimRows = await db.execute(sql`SELECT * FROM bingo_claims WHERE id=${claimId}`);
  const claim = (claimRows.rows as any[])[0];
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  if (claim.status !== "pending") return res.status(400).json({ error: "Claim is not pending" });
  const alreadyPaid = await db.execute(sql`SELECT id FROM bingo_payouts WHERE claim_id=${claimId}`);
  if ((alreadyPaid.rows as any[]).length > 0) return res.status(409).json({ error: "Claim already paid" });
  const roundId = claim.round_id;
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id=${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });

  const prizePool = Number(round.prize_pool);

  // Fetch all existing payouts for this round so we can retroactively split fairly.
  // Example: Nathan approved first → paid 114k (1 winner). Second winner approved →
  // new share = 114k/2 = 57k. Nathan is adjusted -57k, second winner gets 57k.
  // Total paid always equals exactly prizePool.
  const existingPayoutsRows = await db.execute(sql`
    SELECT bp.id, bp.player_id, bp.amount, bp.transaction_id
    FROM bingo_payouts bp
    WHERE bp.round_id = ${roundId}
  `);
  const existingPayouts = existingPayoutsRows.rows as any[];
  const totalWinners = existingPayouts.length + 1;
  const newShareEach = Math.floor(prizePool / totalWinners);
  if (newShareEach <= 0) return res.status(400).json({ error: "No prize pool to pay out" });

  // Retroactively correct prior winners so each gets newShareEach.
  for (const prev of existingPayouts) {
    const oldAmount = Number(prev.amount);
    const diff = newShareEach - oldAmount; // negative = claw back, positive = top up
    if (diff === 0) continue;
    await db.execute(sql`UPDATE players SET chips = chips + ${diff} WHERE id = ${prev.player_id}`);
    await db.execute(sql`UPDATE bingo_payouts SET amount = ${newShareEach} WHERE id = ${prev.id}`);
    await db.execute(sql`
      INSERT INTO transactions (player_id, amount, type, description, staff_id, staff_username)
      VALUES (
        ${prev.player_id},
        ${Math.abs(diff)},
        ${diff < 0 ? "loss" : "win"},
        ${"Bingo payout adjustment — Round #" + roundId + " (split " + totalWinners + " ways)"},
        ${session.accountId},
        ${session.username}
      )
    `);
    try {
      const pR = await db.execute(sql`SELECT chips FROM players WHERE id=${prev.player_id}`);
      broadcastPlayerBalance(prev.player_id, Number((pR.rows as any[])[0]?.chips ?? 0));
    } catch {}
  }

  // Mark claim approved and pay the new winner their share.
  await db.execute(sql`
    UPDATE bingo_claims SET status='approved', reviewed_by=${session.username}, reviewed_at=NOW() WHERE id=${claimId}
  `);
  await db.execute(sql`UPDATE players SET chips = chips + ${newShareEach} WHERE id = ${claim.player_id}`);
  const txResult = await db.execute(sql`
    INSERT INTO transactions (player_id, amount, type, description, staff_id, staff_username)
    VALUES (${claim.player_id}, ${newShareEach}, 'win', ${"Bingo win — Round #" + roundId}, ${session.accountId}, ${session.username})
    RETURNING id
  `);
  const transactionId = (txResult.rows as any[])[0]?.id ?? null;
  await db.execute(sql`
    INSERT INTO bingo_payouts (round_id, claim_id, player_id, amount, paid_by, paid_at, transaction_id)
    VALUES (${roundId}, ${claimId}, ${claim.player_id}, ${newShareEach}, ${session.username}, NOW(), ${transactionId})
  `);
  await logAction(roundId, session.accountId, "claim_approved", { claimId, playerId: claim.player_id, payoutAmount: newShareEach, winners: totalWinners });
  const pRows = await db.execute(sql`SELECT chips FROM players WHERE id=${claim.player_id}`);
  try { broadcastPlayerBalance(claim.player_id, Number((pRows.rows as any[])[0]?.chips ?? 0)); } catch {}
  if (round.status === "in_progress") {
    await db.execute(sql`UPDATE bingo_rounds SET status='claim_review' WHERE id=${roundId}`);
  }
  return res.json({ ok: true, payoutAmount: newShareEach, winners: totalWinners });
});

// ─── POST /bingo/claims/:id/reject — dealer+ ─────────────────────────────────
router.post("/claims/:id/reject", requireDealerOrAbove, async (req, res) => {
  const session = (req as any).bankerSession;
  const claimId = parseInt(req.params.id);
  const { reason } = req.body ?? {};
  const claimRows = await db.execute(sql`SELECT * FROM bingo_claims WHERE id=${claimId}`);
  const claim = (claimRows.rows as any[])[0];
  if (!claim) return res.status(404).json({ error: "Claim not found" });
  if (claim.status !== "pending") return res.status(400).json({ error: "Claim is not pending" });
  await db.execute(sql`
    UPDATE bingo_claims SET status='rejected', reviewed_by=${session.username}, reviewed_at=NOW(), rejection_reason=${reason || "No reason given"}
    WHERE id=${claimId}
  `);
  await logAction(claim.round_id, session.accountId, "claim_rejected", { claimId, reason });
  // If no more pending claims remain, restore round to in_progress so drawing can continue
  const pending = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM bingo_claims WHERE round_id=${claim.round_id} AND status='pending'
  `);
  const pendingCount = Number((pending.rows as any[])[0]?.cnt ?? 0);
  if (pendingCount === 0) {
    await db.execute(sql`
      UPDATE bingo_rounds SET status='in_progress' WHERE id=${claim.round_id} AND status='claim_review'
    `);
  }
  return res.json({ ok: true });
});

// ─── GET /bingo/stats — banker/owner only ────────────────────────────────────
router.get("/stats", requireBankerOrOwner, async (_req, res) => {
  const agg = await db.execute(sql`
    SELECT COUNT(*) as total_rounds, COALESCE(SUM(total_collected),0) as total_collected,
      COALESCE(SUM(house_profit),0) as total_house_profit, COALESCE(SUM(prize_pool),0) as total_prize_pool,
      COALESCE(SUM(total_cards_sold),0) as total_cards_sold, COALESCE(MAX(total_collected),0) as best_round
    FROM bingo_rounds WHERE status='completed'
  `);
  const row = (agg.rows as any[])[0] ?? {};
  const recent = await db.execute(sql`
    SELECT id, status, dealer_username, card_price, total_cards_sold, total_collected, prize_pool, house_profit, created_at, completed_at
    FROM bingo_rounds ORDER BY id DESC LIMIT 20
  `);
  return res.json({
    totalRounds: Number(row.total_rounds ?? 0),
    totalCollected: Number(row.total_collected ?? 0),
    totalHouseProfit: Number(row.total_house_profit ?? 0),
    totalPrizePool: Number(row.total_prize_pool ?? 0),
    totalCardsSold: Number(row.total_cards_sold ?? 0),
    bestRound: Number(row.best_round ?? 0),
    recentRounds: (recent.rows as any[]).map((r) => ({
      id: r.id, status: r.status, dealerUsername: r.dealer_username,
      cardPrice: Number(r.card_price), totalCardsSold: Number(r.total_cards_sold),
      totalCollected: Number(r.total_collected), prizePool: Number(r.prize_pool),
      houseProfit: Number(r.house_profit), createdAt: r.created_at, completedAt: r.completed_at,
    })),
  });
});

// ─── POST /bingo/rounds/:id/buy-cards — player ───────────────────────────────
router.post("/rounds/:id/buy-cards", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const roundId = parseInt(req.params.id);
  const { quantity } = req.body ?? {};
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return res.status(400).json({ error: "Invalid quantity" });
  }
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id=${roundId}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (round.status !== "buying_open") return res.status(400).json({ error: "Card buying is not open" });
  const cardPrice = Number(round.card_price);
  const maxCards = Number(round.max_cards_per_player);
  const existingRows = await db.execute(sql`SELECT COUNT(*) as cnt FROM bingo_cards WHERE round_id=${roundId} AND player_id=${playerId}`);
  const existing = Number((existingRows.rows as any[])[0]?.cnt ?? 0);
  if (existing + quantity > maxCards) {
    return res.status(400).json({ error: `Max ${maxCards} cards per player. You already have ${existing}.` });
  }
  const totalCost = cardPrice * quantity;
  const updateResult = await db.execute(sql`
    UPDATE players SET chips=chips-${totalCost} WHERE id=${playerId} AND chips>=${totalCost} RETURNING chips, username
  `);
  if ((updateResult.rows as any[]).length === 0) return res.status(400).json({ error: "Insufficient chips" });
  const newChips = Number((updateResult.rows as any[])[0].chips);
  await db.execute(sql`
    INSERT INTO transactions (player_id, amount, type, description)
    VALUES (${playerId}, ${totalCost}, 'loss', ${"Bingo cards ×" + quantity + " — Round #" + roundId})
  `);
  const cards: number[][][] = [];
  for (let i = 0; i < quantity; i++) {
    const grid = await generateUniqueCard(roundId);
    await db.execute(sql`
      INSERT INTO bingo_cards (round_id, player_id, card_numbers, marked_numbers, created_at)
      VALUES (${roundId}, ${playerId}, ${JSON.stringify(grid)}, '[0]', NOW())
    `);
    cards.push(grid);
  }
  const houseCutPct = Number(round.house_cut_percent);
  const prizePoolPct = Number(round.prize_pool_percent);
  const houseProfit = Math.floor(totalCost * houseCutPct / 100);
  const prizeContrib = Math.floor(totalCost * prizePoolPct / 100);
  await db.execute(sql`
    UPDATE bingo_rounds SET
      total_cards_sold=total_cards_sold+${quantity},
      total_collected=total_collected+${totalCost},
      prize_pool=prize_pool+${prizeContrib},
      house_profit=house_profit+${houseProfit}
    WHERE id=${roundId}
  `);
  try { broadcastPlayerBalance(playerId, newChips); } catch {}
  return res.json({ ok: true, cards, newChips, totalCost });
});

// ─── GET /bingo/rounds/:id/my-cards — player ─────────────────────────────────
router.get("/rounds/:id/my-cards", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const roundId = parseInt(req.params.id);
  const cards = await db.execute(sql`
    SELECT * FROM bingo_cards WHERE round_id=${roundId} AND player_id=${playerId} ORDER BY id ASC
  `);
  return res.json((cards.rows as any[]).map((c) => ({
    id: c.id, roundId: c.round_id,
    cardNumbers: JSON.parse(c.card_numbers),
    markedNumbers: JSON.parse(c.marked_numbers || "[0]"),
    createdAt: c.created_at,
  })));
});

// ─── POST /bingo/cards/:id/mark — player ─────────────────────────────────────
router.post("/cards/:id/mark", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const cardId = parseInt(req.params.id);
  const { number } = req.body ?? {};
  if (typeof number !== "number") return res.status(400).json({ error: "Invalid number" });
  const cardRows = await db.execute(sql`SELECT * FROM bingo_cards WHERE id=${cardId}`);
  const card = (cardRows.rows as any[])[0];
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (Number(card.player_id) !== playerId) {
    await logAction(card.round_id, null, "suspicious_mark_attempt", { playerId, cardId, ownerId: card.player_id });
    return res.status(403).json({ error: "You do not own this card" });
  }
  const rRows = await db.execute(sql`SELECT status FROM bingo_rounds WHERE id=${card.round_id}`);
  const round = (rRows.rows as any[])[0];
  if (!round || !["in_progress", "claim_review"].includes(round.status)) {
    return res.status(400).json({ error: "Marking not allowed at this time" });
  }
  const cardNumbers: number[][] = JSON.parse(card.card_numbers);
  const flat = cardNumbers.flat();
  if (number !== 0 && !flat.includes(number)) return res.status(400).json({ error: "Number not on this card" });
  const markedNumbers: number[] = JSON.parse(card.marked_numbers || "[0]");
  if (!markedNumbers.includes(number)) {
    markedNumbers.push(number);
    await db.execute(sql`UPDATE bingo_cards SET marked_numbers=${JSON.stringify(markedNumbers)} WHERE id=${cardId}`);
  }
  return res.json({ ok: true, markedNumbers });
});

// ─── POST /bingo/cards/:id/unmark — player ───────────────────────────────────
router.post("/cards/:id/unmark", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const cardId = parseInt(req.params.id);
  const { number } = req.body ?? {};
  if (typeof number !== "number") return res.status(400).json({ error: "Invalid number" });
  if (number === 0) return res.status(400).json({ error: "Cannot unmark FREE space" });
  const cardRows = await db.execute(sql`SELECT * FROM bingo_cards WHERE id=${cardId}`);
  const card = (cardRows.rows as any[])[0];
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (Number(card.player_id) !== playerId) {
    await logAction(card.round_id, null, "suspicious_unmark_attempt", { playerId, cardId });
    return res.status(403).json({ error: "You do not own this card" });
  }
  const rRows = await db.execute(sql`SELECT status FROM bingo_rounds WHERE id=${card.round_id}`);
  const round = (rRows.rows as any[])[0];
  if (!round || !["in_progress", "claim_review"].includes(round.status)) {
    return res.status(400).json({ error: "Marking not allowed at this time" });
  }
  const markedNumbers: number[] = JSON.parse(card.marked_numbers || "[0]");
  const updated = markedNumbers.filter((n) => n !== number);
  await db.execute(sql`UPDATE bingo_cards SET marked_numbers=${JSON.stringify(updated)} WHERE id=${cardId}`);
  return res.json({ ok: true, markedNumbers: updated });
});

// ─── POST /bingo/cards/:id/claim — player (Call Bingo) ───────────────────────
router.post("/cards/:id/claim", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const cardId = parseInt(req.params.id);
  const cardRows = await db.execute(sql`SELECT * FROM bingo_cards WHERE id=${cardId}`);
  const card = (cardRows.rows as any[])[0];
  if (!card) return res.status(404).json({ error: "Card not found" });
  if (Number(card.player_id) !== playerId) {
    await logAction(card.round_id, null, "suspicious_claim_attempt", { playerId, cardId, ownerId: card.player_id });
    return res.status(403).json({ error: "You do not own this card" });
  }
  const rRows = await db.execute(sql`SELECT * FROM bingo_rounds WHERE id=${card.round_id}`);
  const round = (rRows.rows as any[])[0];
  if (!round) return res.status(404).json({ error: "Round not found" });
  if (!["in_progress", "claim_review"].includes(round.status)) {
    return res.status(400).json({ error: "Claims not allowed at this time" });
  }
  const existingClaim = await db.execute(sql`
    SELECT id FROM bingo_claims WHERE claimed_card_id=${cardId} AND status IN ('pending','approved')
  `);
  if ((existingClaim.rows as any[]).length > 0) return res.status(409).json({ error: "A claim already exists for this card" });
  const pRows = await db.execute(sql`SELECT username FROM players WHERE id=${playerId}`);
  const player = (pRows.rows as any[])[0];
  const cardNumbers: number[][] = JSON.parse(card.card_numbers);
  const markedNumbers: number[] = JSON.parse(card.marked_numbers || "[0]");
  const drawnBalls: number[] = JSON.parse(round.drawn_balls || "[]");
  const suspicious = hasSuspiciousMarkings(markedNumbers, drawnBalls);
  const hasWin = checkPattern(cardNumbers, markedNumbers, round.winning_pattern);
  const claimResult = await db.execute(sql`
    INSERT INTO bingo_claims (round_id, player_id, player_name, state_id, phone_number, claimed_card_id, card_numbers, marked_numbers, drawn_balls_at_claim, status, claim_time)
    VALUES (${card.round_id}, ${playerId}, ${player?.username ?? ""}, '', '', ${cardId}, ${card.card_numbers}, ${card.marked_numbers}, ${JSON.stringify(drawnBalls)}, 'pending', NOW())
    RETURNING id
  `);
  const claimId = (claimResult.rows as any[])[0].id;
  await logAction(card.round_id, null, "claim_created", { claimId, playerId, cardId, suspicious, hasWin });
  if (round.status === "in_progress") {
    await db.execute(sql`UPDATE bingo_rounds SET status='claim_review' WHERE id=${card.round_id}`);
  }
  return res.json({ ok: true, claimId, suspicious, hasWin });
});

export default router;
