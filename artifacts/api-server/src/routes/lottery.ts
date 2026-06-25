import { Router } from "express";
import { randomInt } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePlayer, requireBankerOrOwner } from "../middleware/auth.js";
import { broadcastPlayerBalance } from "../lib/table-ws.js";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getSettings() {
  const rows = await db.execute(sql`SELECT * FROM lottery_settings ORDER BY id DESC LIMIT 1`);
  const s = (rows.rows as any[])[0];
  if (!s) return null;
  return {
    id: s.id,
    enabled: s.enabled,
    ticketCost: Number(s.ticket_cost),
    maxTicketsPerPlayer: Number(s.max_tickets_per_player),
    houseSplitPercent: Number(s.house_split_percent),
    jackpotSplitPercent: Number(s.jackpot_split_percent),
    consolationSplitPercent: Number(s.consolation_split_percent),
    startingJackpot: Number(s.starting_jackpot),
    numberMin: Number(s.number_min),
    numberMax: Number(s.number_max),
    numbersPerTicket: Number(s.numbers_per_ticket),
    allowDuplicates: s.allow_duplicates,
    orderMatters: s.order_matters,
    drawHour: Number(s.draw_hour),
    drawMinute: Number(s.draw_minute),
    ticketCloseMinutes: Number(s.ticket_close_minutes),
    rolloverEnabled: s.rollover_enabled,
    jackpotRollover: Number(s.jackpot_rollover || 0),
    consolationRollover: Number(s.consolation_rollover || 0),
  };
}

async function getActiveDraw() {
  const rows = await db.execute(sql`
    SELECT * FROM lottery_draws WHERE status IN ('open','sales_closed','drawing') ORDER BY id DESC LIMIT 1
  `);
  return (rows.rows as any[])[0] || null;
}

function nextSundayDrawTime(drawHour: number, drawMinute: number): Date {
  const now = new Date();
  // Start from today UTC midnight, find next Sunday that is strictly > 24h from now
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), drawHour, drawMinute, 0, 0));
  const day = d.getUTCDay(); // 0=Sun
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  // Must be strictly in the future AND at least 24h away to avoid same-day re-draws
  const minNext = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (d <= minNext) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

function generateWinningNumbers(min: number, max: number, count: number, allowDuplicates: boolean): number[] {
  if (allowDuplicates) {
    return Array.from({ length: count }, () => randomInt(min, max + 1));
  }
  const pool: number[] = [];
  for (let i = min; i <= max; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function countMatches(ticketNums: number[], winningNums: number[], orderMatters: boolean): number {
  if (orderMatters) {
    let count = 0;
    for (let i = 0; i < ticketNums.length; i++) {
      if (ticketNums[i] === winningNums[i]) count++;
    }
    return count;
  }
  const winSet = new Set(winningNums);
  return ticketNums.filter(n => winSet.has(n)).length;
}

async function logAction(drawId: number | null, actorId: number | null, actorRole: string | null, playerId: number | null, actionType: string, details: object) {
  try {
    await db.execute(sql`
      INSERT INTO lottery_logs (draw_id, action_type, actor_role, actor_id, player_id, details, created_at)
      VALUES (${drawId}, ${actionType}, ${actorRole}, ${actorId}, ${playerId}, ${JSON.stringify(details)}, NOW())
    `);
  } catch {}
}

async function processDraw(drawId: number, forcedBy?: { id: number; username: string }) {
  // Atomically claim the draw — only one caller wins; others see 0 rows and bail.
  const claimed = await db.execute(sql`
    UPDATE lottery_draws SET status='drawing'
    WHERE id=${drawId} AND status IN ('open','sales_closed')
    RETURNING id
  `);
  if (!claimed.rows.length) return; // already drawing or complete

  const drawRows = await db.execute(sql`SELECT * FROM lottery_draws WHERE id=${drawId}`);
  const draw = (drawRows.rows as any[])[0];
  if (!draw) return;

  const settings = await getSettings();
  if (!settings) return;

  const winningNumbers = generateWinningNumbers(settings.numberMin, settings.numberMax, settings.numbersPerTicket, settings.allowDuplicates);
  await db.execute(sql`
    UPDATE lottery_draws SET winning_numbers=${JSON.stringify(winningNumbers)} WHERE id=${drawId}
  `);

  const ticketRows = await db.execute(sql`
    SELECT * FROM lottery_tickets WHERE draw_id=${drawId} AND status='submitted'
  `);
  const tickets = ticketRows.rows as any[];

  const jackpotWinners: any[] = [];
  const consolationWinners: any[] = [];

  for (const t of tickets) {
    const nums: number[] = JSON.parse(t.numbers || "[]");
    const matched = countMatches(nums, winningNumbers, settings.orderMatters);
    let tier: string = "no_win";
    if (matched >= settings.numbersPerTicket) tier = "jackpot";
    else if (matched === settings.numbersPerTicket - 1) tier = "consolation";

    await db.execute(sql`
      UPDATE lottery_tickets SET matched_count=${matched}, result_tier=${tier} WHERE id=${t.id}
    `);
    if (tier === "jackpot") jackpotWinners.push(t);
    if (tier === "consolation") consolationWinners.push(t);
  }

  // Mark void for remaining draft tickets
  await db.execute(sql`
    UPDATE lottery_tickets SET status='void', result_tier='void' WHERE draw_id=${drawId} AND status='draft'
  `);

  const finalJackpot = Number(draw.final_jackpot);
  const finalConsolation = Number(draw.final_consolation);

  let jackpotRolledOver = false;
  let consolationRolledIntoJackpot = false;

  // Pay jackpot winners
  if (jackpotWinners.length > 0) {
    const payoutPerTicket = Math.floor(finalJackpot / jackpotWinners.length);
    for (const t of jackpotWinners) {
      await db.execute(sql`UPDATE players SET chips=chips+${payoutPerTicket} WHERE id=${t.player_id}`);
      const txResult = await db.execute(sql`
        INSERT INTO transactions (player_id, amount, type, description)
        VALUES (${t.player_id}, ${payoutPerTicket}, 'win', ${"Lottery JACKPOT — Draw #" + drawId + " — " + winningNumbers.join(", ")})
        RETURNING id
      `);
      const txId = (txResult.rows as any[])[0]?.id ?? null;
      await db.execute(sql`
        INSERT INTO lottery_payouts (draw_id, ticket_id, player_id, player_username, tier, tier_prize_pool, winning_ticket_count, payout_per_ticket, payout_amount, paid_at, transaction_id)
        VALUES (${drawId}, ${t.id}, ${t.player_id}, ${t.player_username}, 'jackpot', ${finalJackpot}, ${jackpotWinners.length}, ${payoutPerTicket}, ${payoutPerTicket}, NOW(), ${txId})
      `);
      await db.execute(sql`
        UPDATE lottery_tickets SET payout_amount=${payoutPerTicket}, paid_at=NOW() WHERE id=${t.id}
      `);
      try { broadcastPlayerBalance(t.player_id, -1); } catch {}
    }
    // Reset jackpot rollover (jackpot was won)
    await db.execute(sql`UPDATE lottery_settings SET jackpot_rollover=0`);
  } else {
    jackpotRolledOver = true;
    await db.execute(sql`
      UPDATE lottery_settings SET jackpot_rollover = jackpot_rollover + ${finalJackpot}
    `);
  }

  // Pay consolation winners
  if (consolationWinners.length > 0) {
    const payoutPerTicket = Math.floor(finalConsolation / consolationWinners.length);
    for (const t of consolationWinners) {
      await db.execute(sql`UPDATE players SET chips=chips+${payoutPerTicket} WHERE id=${t.player_id}`);
      const txResult = await db.execute(sql`
        INSERT INTO transactions (player_id, amount, type, description)
        VALUES (${t.player_id}, ${payoutPerTicket}, 'win', ${"Lottery WIN — Draw #" + drawId + " 3/4 match — " + winningNumbers.join(", ")})
        RETURNING id
      `);
      const txId = (txResult.rows as any[])[0]?.id ?? null;
      await db.execute(sql`
        INSERT INTO lottery_payouts (draw_id, ticket_id, player_id, player_username, tier, tier_prize_pool, winning_ticket_count, payout_per_ticket, payout_amount, paid_at, transaction_id)
        VALUES (${drawId}, ${t.id}, ${t.player_id}, ${t.player_username}, 'consolation', ${finalConsolation}, ${consolationWinners.length}, ${payoutPerTicket}, ${payoutPerTicket}, NOW(), ${txId})
      `);
      await db.execute(sql`
        UPDATE lottery_tickets SET payout_amount=${payoutPerTicket}, paid_at=NOW() WHERE id=${t.id}
      `);
      try { broadcastPlayerBalance(t.player_id, -1); } catch {}
    }
  } else {
    consolationRolledIntoJackpot = true;
    await db.execute(sql`
      UPDATE lottery_settings SET jackpot_rollover = jackpot_rollover + ${finalConsolation}
    `);
  }

  // Expire all tickets
  await db.execute(sql`
    UPDATE lottery_tickets SET status='expired' WHERE draw_id=${drawId} AND status IN ('submitted','void')
  `);

  // Count draft/submitted
  const stats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status='expired') as total_submitted,
      COUNT(*) FILTER (WHERE status='void') as total_draft
    FROM lottery_tickets WHERE draw_id=${drawId}
  `);

  await db.execute(sql`
    UPDATE lottery_draws SET
      status='complete',
      jackpot_rolled_over=${jackpotRolledOver},
      consolation_rolled_into_jackpot=${consolationRolledIntoJackpot},
      completed_at=NOW()
    WHERE id=${drawId}
  `);

  await logAction(drawId, forcedBy?.id ?? null, "system", null, "draw_processed", {
    winningNumbers, jackpotWinners: jackpotWinners.length, consolationWinners: consolationWinners.length,
    finalJackpot, finalConsolation, jackpotRolledOver, consolationRolledIntoJackpot,
  });

  // Create next draw
  const freshSettings = await getSettings();
  if (freshSettings) {
    await createNextDraw(freshSettings);
  }
}

async function createNextDraw(settings: NonNullable<Awaited<ReturnType<typeof getSettings>>>) {
  const existing = await getActiveDraw();
  if (existing) return; // already has an active draw

  const drawTime = nextSundayDrawTime(settings.drawHour, settings.drawMinute);
  const ticketCloseAt = new Date(drawTime.getTime() - settings.ticketCloseMinutes * 60 * 1000);

  const carriedIn = settings.jackpotRollover > 0 ? settings.jackpotRollover : settings.startingJackpot;

  const result = await db.execute(sql`
    INSERT INTO lottery_draws (status, ticket_close_at, draw_time, jackpot_carried_in, jackpot_added_this_draw, final_jackpot, consolation_carried_in, consolation_added_this_draw, final_consolation, created_at)
    VALUES ('open', ${ticketCloseAt.toISOString()}, ${drawTime.toISOString()}, ${carriedIn}, 0, ${carriedIn}, 0, 0, 0, NOW())
    RETURNING id
  `);
  const drawId = (result.rows as any[])[0].id;
  // Mark rollover consumed by resetting jackpot_rollover to 0 (will be set again if nobody wins)
  await db.execute(sql`UPDATE lottery_settings SET jackpot_rollover=0`);
  await logAction(drawId, null, "system", null, "draw_created", { drawTime: drawTime.toISOString(), carriedIn });
  return drawId;
}

// ─── Background scheduler (checks every 60s) ─────────────────────────────────

setInterval(async () => {
  try {
    const draw = await getActiveDraw();
    if (!draw) return;

    const now = new Date();

    // Close ticket sales if it's time
    if (draw.status === "open" && new Date(draw.ticket_close_at) <= now) {
      await db.execute(sql`UPDATE lottery_draws SET status='sales_closed' WHERE id=${draw.id}`);
    }

    // Process draw if it's time
    if (["open", "sales_closed"].includes(draw.status) && new Date(draw.draw_time) <= now) {
      await processDraw(draw.id);
    }
  } catch (e) {
    console.error("[lottery] scheduler error:", e);
  }
}, 60 * 1000);

// ─── GET /lottery/active — public draw info ───────────────────────────────────
router.get("/active", async (_req, res) => {
  const settings = await getSettings();
  const draw = await getActiveDraw();
  if (!draw) return res.json({ draw: null, settings: settings ? { enabled: settings.enabled, ticketCost: settings.ticketCost, maxTicketsPerPlayer: settings.maxTicketsPerPlayer, numbersPerTicket: settings.numbersPerTicket, numberMin: settings.numberMin, numberMax: settings.numberMax } : null });

  return res.json({
    draw: {
      id: draw.id, status: draw.status,
      ticketCloseAt: draw.ticket_close_at, drawTime: draw.draw_time,
      jackpot: Number(draw.final_jackpot), consolation: Number(draw.final_consolation),
      totalTickets: Number(draw.total_tickets_purchased),
    },
    settings: settings ? {
      enabled: settings.enabled, ticketCost: settings.ticketCost,
      maxTicketsPerPlayer: settings.maxTicketsPerPlayer, numbersPerTicket: settings.numbersPerTicket,
      numberMin: settings.numberMin, numberMax: settings.numberMax,
    } : null,
  });
});

// ─── GET /lottery/my-tickets — player's tickets for active draw ───────────────
router.get("/my-tickets", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const draw = await getActiveDraw();
  if (!draw) return res.json([]);
  const rows = await db.execute(sql`
    SELECT * FROM lottery_tickets WHERE draw_id=${draw.id} AND player_id=${playerId} ORDER BY id ASC
  `);
  return res.json(rows.rows);
});

// ─── POST /lottery/buy — purchase tickets ────────────────────────────────────
router.post("/buy", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const { quantity = 1 } = req.body ?? {};
  const qty = Math.max(1, Math.min(50, parseInt(quantity)));

  const settings = await getSettings();
  if (!settings || !settings.enabled) return res.status(400).json({ error: "Lottery is not enabled" });

  const draw = await getActiveDraw();
  if (!draw) return res.status(400).json({ error: "No active lottery draw" });
  if (draw.status !== "open") return res.status(400).json({ error: "Ticket sales are closed" });
  if (new Date(draw.ticket_close_at) <= new Date()) return res.status(400).json({ error: "Ticket sales have closed" });

  // Check player ticket limit
  const existingRows = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM lottery_tickets WHERE draw_id=${draw.id} AND player_id=${playerId}
  `);
  const existing = Number((existingRows.rows as any[])[0]?.cnt ?? 0);
  if (existing + qty > settings.maxTicketsPerPlayer) {
    return res.status(400).json({ error: `You can only buy ${settings.maxTicketsPerPlayer} tickets per draw. You have ${existing}.` });
  }

  const totalCost = settings.ticketCost * qty;
  const playerRows = await db.execute(sql`SELECT chips, username FROM players WHERE id=${playerId}`);
  const player = (playerRows.rows as any[])[0];
  if (!player || Number(player.chips) < totalCost) return res.status(400).json({ error: "Not enough chips" });

  // Deduct chips
  await db.execute(sql`UPDATE players SET chips=chips-${totalCost} WHERE id=${playerId}`);
  await db.execute(sql`
    INSERT INTO transactions (player_id, amount, type, description)
    VALUES (${playerId}, ${-totalCost}, 'loss', ${"Lottery tickets x" + qty + " — Draw #" + draw.id})
  `);

  // Create blank draft tickets
  for (let i = 0; i < qty; i++) {
    await db.execute(sql`
      INSERT INTO lottery_tickets (draw_id, player_id, player_username, numbers, status, ticket_cost, purchased_at)
      VALUES (${draw.id}, ${playerId}, ${player.username}, '[]', 'draft', ${settings.ticketCost}, NOW())
    `);
  }

  // Update draw pools
  const houseAmount = Math.floor(settings.ticketCost * settings.houseSplitPercent / 100) * qty;
  const jackpotAmount = Math.floor(settings.ticketCost * settings.jackpotSplitPercent / 100) * qty;
  const consolationAmount = Math.floor(settings.ticketCost * settings.consolationSplitPercent / 100) * qty;

  await db.execute(sql`
    UPDATE lottery_draws SET
      total_tickets_purchased = total_tickets_purchased + ${qty},
      total_chips_collected = total_chips_collected + ${totalCost},
      house_profit = house_profit + ${houseAmount},
      jackpot_added_this_draw = jackpot_added_this_draw + ${jackpotAmount},
      final_jackpot = final_jackpot + ${jackpotAmount},
      consolation_added_this_draw = consolation_added_this_draw + ${consolationAmount},
      final_consolation = final_consolation + ${consolationAmount}
    WHERE id=${draw.id}
  `);

  try { broadcastPlayerBalance(playerId, -1); } catch {}
  await logAction(draw.id, null, "player", playerId, "tickets_purchased", { qty, totalCost, ticketCost: settings.ticketCost });

  return res.json({ ok: true, qty, totalCost });
});

// ─── PUT /lottery/tickets/:id/numbers — set numbers on draft ticket ───────────
router.put("/tickets/:id/numbers", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const ticketId = parseInt(req.params.id);
  const { numbers } = req.body ?? {};

  if (!Array.isArray(numbers)) return res.status(400).json({ error: "numbers must be an array" });

  const ticketRows = await db.execute(sql`SELECT * FROM lottery_tickets WHERE id=${ticketId}`);
  const ticket = (ticketRows.rows as any[])[0];
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (ticket.player_id !== playerId) return res.status(403).json({ error: "Not your ticket" });
  if (ticket.status !== "draft") return res.status(400).json({ error: "Ticket is not a draft" });

  const draw = await getActiveDraw();
  if (!draw || draw.id !== ticket.draw_id) return res.status(400).json({ error: "Draw is not active" });
  if (draw.status !== "open") return res.status(400).json({ error: "Ticket sales are closed" });

  const settings = await getSettings();
  if (!settings) return res.status(500).json({ error: "No settings" });

  const nums = numbers.map(Number).filter(n => Number.isInteger(n) && n >= settings.numberMin && n <= settings.numberMax);
  if (nums.length > settings.numbersPerTicket) return res.status(400).json({ error: `Max ${settings.numbersPerTicket} numbers per ticket` });

  if (!settings.allowDuplicates && new Set(nums).size !== nums.length) {
    return res.status(400).json({ error: "Duplicate numbers are not allowed" });
  }

  await db.execute(sql`UPDATE lottery_tickets SET numbers=${JSON.stringify(nums)} WHERE id=${ticketId}`);
  return res.json({ ok: true, numbers: nums });
});

// ─── POST /lottery/tickets/:id/submit ────────────────────────────────────────
router.post("/tickets/:id/submit", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;
  const ticketId = parseInt(req.params.id);

  const ticketRows = await db.execute(sql`SELECT * FROM lottery_tickets WHERE id=${ticketId}`);
  const ticket = (ticketRows.rows as any[])[0];
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (ticket.player_id !== playerId) return res.status(403).json({ error: "Not your ticket" });
  if (ticket.status !== "draft") return res.status(400).json({ error: "Ticket is not a draft" });

  const draw = await getActiveDraw();
  if (!draw || draw.id !== ticket.draw_id) return res.status(400).json({ error: "Draw is not active" });
  if (draw.status !== "open") return res.status(400).json({ error: "Ticket sales are closed" });

  const settings = await getSettings();
  if (!settings) return res.status(500).json({ error: "No settings" });

  const nums: number[] = JSON.parse(ticket.numbers || "[]");
  if (nums.length !== settings.numbersPerTicket) {
    return res.status(400).json({ error: `Ticket must have exactly ${settings.numbersPerTicket} numbers` });
  }

  await db.execute(sql`
    UPDATE lottery_tickets SET status='submitted', submitted_at=NOW() WHERE id=${ticketId}
  `);
  await db.execute(sql`
    UPDATE lottery_draws SET total_submitted=total_submitted+1 WHERE id=${draw.id}
  `);
  await logAction(draw.id, null, "player", playerId, "ticket_submitted", { ticketId, numbers: nums });
  return res.json({ ok: true });
});

// ─── POST /lottery/tickets/submit-all ────────────────────────────────────────
router.post("/tickets/submit-all", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const draw = await getActiveDraw();
  if (!draw) return res.status(400).json({ error: "No active draw" });
  if (draw.status !== "open") return res.status(400).json({ error: "Ticket sales are closed" });

  const settings = await getSettings();
  if (!settings) return res.status(500).json({ error: "No settings" });

  const draftRows = await db.execute(sql`
    SELECT * FROM lottery_tickets WHERE draw_id=${draw.id} AND player_id=${playerId} AND status='draft'
  `);
  const drafts = draftRows.rows as any[];

  let submitted = 0;
  let invalid = 0;
  for (const t of drafts) {
    const nums: number[] = JSON.parse(t.numbers || "[]");
    if (nums.length === settings.numbersPerTicket) {
      await db.execute(sql`UPDATE lottery_tickets SET status='submitted', submitted_at=NOW() WHERE id=${t.id}`);
      submitted++;
    } else {
      invalid++;
    }
  }
  if (submitted > 0) {
    await db.execute(sql`UPDATE lottery_draws SET total_submitted=total_submitted+${submitted} WHERE id=${draw.id}`);
    await logAction(draw.id, null, "player", playerId, "tickets_submit_all", { submitted, invalid });
  }
  return res.json({ ok: true, submitted, invalid });
});

// ─── GET /lottery/history — recent completed draws + player results ───────────
router.get("/history", requirePlayer, async (req, res) => {
  const playerId = (req as any).authenticatedPlayerId as number;

  const drawRows = await db.execute(sql`
    SELECT * FROM lottery_draws WHERE status='complete' ORDER BY id DESC LIMIT 10
  `);
  const draws = drawRows.rows as any[];
  const result = [];

  for (const d of draws) {
    const myTickets = await db.execute(sql`
      SELECT * FROM lottery_tickets WHERE draw_id=${d.id} AND player_id=${playerId}
    `);
    result.push({
      id: d.id, drawTime: d.draw_time,
      winningNumbers: JSON.parse(d.winning_numbers || "[]"),
      jackpot: Number(d.final_jackpot), consolation: Number(d.final_consolation),
      jackpotRolledOver: d.jackpot_rolled_over, consolationRolledIntoJackpot: d.consolation_rolled_into_jackpot,
      myTickets: myTickets.rows,
    });
  }
  return res.json(result);
});

// ─── GET /lottery/recent-winners — public recent winners ─────────────────────
router.get("/recent-winners", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT lp.player_username, lp.tier, lp.payout_amount, lp.paid_at, ld.winning_numbers, ld.id as draw_id
    FROM lottery_payouts lp JOIN lottery_draws ld ON ld.id=lp.draw_id
    ORDER BY lp.paid_at DESC LIMIT 20
  `);
  return res.json(rows.rows);
});

// ─── GET /lottery/stats — banker/owner only ──────────────────────────────────
router.get("/stats", requireBankerOrOwner, async (_req, res) => {
  const agg = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status='complete') AS total_draws,
      COALESCE(SUM(total_chips_collected),0) AS total_collected,
      COALESCE(SUM(final_jackpot) FILTER (WHERE jackpot_rolled_over=false AND status='complete'),0) AS total_jackpot_paid,
      COALESCE(SUM(final_consolation) FILTER (WHERE consolation_rolled_into_jackpot=false AND status='complete'),0) AS total_consolation_paid,
      COALESCE(SUM(total_tickets_purchased),0) AS total_tickets_sold,
      COALESCE(MAX(final_jackpot),0) AS biggest_jackpot
    FROM lottery_draws
  `);
  const row = (agg.rows as any[])[0] ?? {};

  const payoutAgg = await db.execute(sql`
    SELECT COALESCE(SUM(payout_amount),0) AS total_paid_out,
      COUNT(*) FILTER (WHERE tier='jackpot') AS jackpot_winner_count,
      COUNT(*) FILTER (WHERE tier='consolation') AS consolation_winner_count
    FROM lottery_payouts
  `);
  const payRow = (payoutAgg.rows as any[])[0] ?? {};

  const totalCollected = Number(row.total_collected ?? 0);
  const totalPaidOut = Number(payRow.total_paid_out ?? 0);

  const recent = await db.execute(sql`
    SELECT id, status, draw_time, total_tickets_purchased AS total_tickets_sold, total_chips_collected, final_jackpot, final_consolation,
      jackpot_rolled_over, consolation_rolled_into_jackpot, winning_numbers
    FROM lottery_draws ORDER BY id DESC LIMIT 15
  `);

  return res.json({
    totalDraws: Number(row.total_draws ?? 0),
    totalTicketsSold: Number(row.total_tickets_sold ?? 0),
    totalCollected,
    totalPaidOut,
    houseProfit: totalCollected - totalPaidOut,
    biggestJackpot: Number(row.biggest_jackpot ?? 0),
    jackpotWinnerCount: Number(payRow.jackpot_winner_count ?? 0),
    consolationWinnerCount: Number(payRow.consolation_winner_count ?? 0),
    recentDraws: (recent.rows as any[]).map(d => ({
      id: d.id, status: d.status, drawTime: d.draw_time,
      ticketsSold: Number(d.total_tickets_sold ?? 0),
      collected: Number(d.total_chips_collected ?? 0),
      jackpot: Number(d.final_jackpot ?? 0),
      consolation: Number(d.final_consolation ?? 0),
      jackpotRolledOver: d.jackpot_rolled_over,
      consolationRolledOver: d.consolation_rolled_into_jackpot,
      winningNumbers: JSON.parse(d.winning_numbers || "[]"),
    })),
  });
});

// ─── Banker endpoints ─────────────────────────────────────────────────────────

router.get("/settings", requireBankerOrOwner, async (_req, res) => {
  const s = await getSettings();
  return res.json(s);
});

router.post("/settings", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const b = req.body ?? {};

  const houseP = parseInt(b.houseSplitPercent ?? 20);
  const jackpotP = parseInt(b.jackpotSplitPercent ?? 70);
  const consolationP = parseInt(b.consolationSplitPercent ?? 10);
  if (houseP + jackpotP + consolationP !== 100) {
    return res.status(400).json({ error: "Split percentages must sum to 100" });
  }

  await db.execute(sql`
    UPDATE lottery_settings SET
      enabled=${b.enabled === true || b.enabled === "true"},
      ticket_cost=${parseInt(b.ticketCost ?? 5000)},
      max_tickets_per_player=${parseInt(b.maxTicketsPerPlayer ?? 25)},
      house_split_percent=${houseP},
      jackpot_split_percent=${jackpotP},
      consolation_split_percent=${consolationP},
      starting_jackpot=${parseInt(b.startingJackpot ?? 500000)},
      number_min=${parseInt(b.numberMin ?? 1)},
      number_max=${parseInt(b.numberMax ?? 20)},
      numbers_per_ticket=${parseInt(b.numbersPerTicket ?? 4)},
      allow_duplicates=${b.allowDuplicates === true || b.allowDuplicates === "true"},
      order_matters=${b.orderMatters === true || b.orderMatters === "true"},
      draw_hour=${parseInt(b.drawHour ?? 2)},
      draw_minute=${parseInt(b.drawMinute ?? 0)},
      ticket_close_minutes=${parseInt(b.ticketCloseMinutes ?? 5)},
      rollover_enabled=${b.rolloverEnabled !== false && b.rolloverEnabled !== "false"},
      updated_by=${session.username},
      updated_at=NOW()
  `);
  await logAction(null, session.accountId, "banker", null, "settings_updated", b);
  return res.json({ ok: true });
});

router.post("/draws/create", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const settings = await getSettings();
  if (!settings) return res.status(500).json({ error: "No settings found" });

  const existing = await getActiveDraw();
  if (existing) return res.status(409).json({ error: "An active draw already exists" });

  const { drawTime: customDrawTime } = req.body ?? {};
  let drawTime: Date;
  let ticketCloseAt: Date;

  if (customDrawTime) {
    drawTime = new Date(customDrawTime);
    ticketCloseAt = new Date(drawTime.getTime() - settings.ticketCloseMinutes * 60 * 1000);
  } else {
    drawTime = nextSundayDrawTime(settings.drawHour, settings.drawMinute);
    ticketCloseAt = new Date(drawTime.getTime() - settings.ticketCloseMinutes * 60 * 1000);
  }

  const carriedIn = settings.jackpotRollover > 0 ? settings.jackpotRollover : settings.startingJackpot;

  const result = await db.execute(sql`
    INSERT INTO lottery_draws (status, ticket_close_at, draw_time, jackpot_carried_in, jackpot_added_this_draw, final_jackpot, consolation_carried_in, consolation_added_this_draw, final_consolation, created_at)
    VALUES ('open', ${ticketCloseAt.toISOString()}, ${drawTime.toISOString()}, ${carriedIn}, 0, ${carriedIn}, 0, 0, 0, NOW())
    RETURNING id
  `);
  const drawId = (result.rows as any[])[0].id;
  await db.execute(sql`UPDATE lottery_settings SET jackpot_rollover=0`);
  await logAction(drawId, session.accountId, "banker", null, "draw_created", { drawTime: drawTime.toISOString(), carriedIn, createdBy: session.username });
  return res.json({ ok: true, drawId });
});

router.post("/draws/:id/reschedule", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const drawId = parseInt(req.params.id);
  const { drawTime } = req.body ?? {};
  if (!drawTime) return res.status(400).json({ error: "drawTime required" });

  const drawRows = await db.execute(sql`SELECT * FROM lottery_draws WHERE id=${drawId}`);
  const draw = (drawRows.rows as any[])[0];
  if (!draw) return res.status(404).json({ error: "Draw not found" });
  if (draw.status === "complete") return res.status(400).json({ error: "Cannot reschedule a completed draw" });
  if (draw.status === "drawing") return res.status(400).json({ error: "Draw is currently in progress" });

  const newDrawTime = new Date(drawTime);
  if (isNaN(newDrawTime.getTime())) return res.status(400).json({ error: "Invalid drawTime" });

  const settings = await getSettings();
  const closeMinutes = settings?.ticketCloseMinutes ?? 30;
  const newCloseAt = new Date(newDrawTime.getTime() - closeMinutes * 60 * 1000);

  await db.execute(sql`
    UPDATE lottery_draws
    SET draw_time=${newDrawTime.toISOString()}, ticket_close_at=${newCloseAt.toISOString()}, status='open'
    WHERE id=${drawId}
  `);
  await logAction(drawId, session.accountId, "banker", null, "draw_rescheduled", {
    drawTime: newDrawTime.toISOString(), ticketCloseAt: newCloseAt.toISOString(), by: session.username
  });
  return res.json({ ok: true });
});

router.post("/draws/:id/force-draw", requireBankerOrOwner, async (req, res) => {
  const session = (req as any).bankerSession;
  const drawId = parseInt(req.params.id);
  const drawRows = await db.execute(sql`SELECT * FROM lottery_draws WHERE id=${drawId}`);
  const draw = (drawRows.rows as any[])[0];
  if (!draw) return res.status(404).json({ error: "Draw not found" });
  if (draw.status === "complete") return res.status(400).json({ error: "Draw already complete" });
  if (draw.status === "drawing") return res.status(400).json({ error: "Draw in progress" });

  await db.execute(sql`UPDATE lottery_draws SET status='sales_closed' WHERE id=${drawId} AND status='open'`);
  await logAction(drawId, session.accountId, "banker", null, "draw_forced", { by: session.username });

  // Process asynchronously so the API returns immediately
  processDraw(drawId, { id: session.accountId, username: session.username }).catch(e => console.error("[lottery] force draw error:", e));
  return res.json({ ok: true, message: "Draw started — results will be ready shortly" });
});

router.get("/draws/list", requireBankerOrOwner, async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT * FROM lottery_draws ORDER BY id DESC LIMIT 50
  `);
  return res.json(rows.rows);
});

router.get("/draws/active-detail", requireBankerOrOwner, async (_req, res) => {
  const draw = await getActiveDraw();
  if (!draw) return res.json({ draw: null });

  const ticketRows = await db.execute(sql`
    SELECT player_id, player_username, COUNT(*) as ticket_count,
      COUNT(*) FILTER (WHERE status='submitted') as submitted,
      COUNT(*) FILTER (WHERE status='draft') as draft
    FROM lottery_tickets WHERE draw_id=${draw.id}
    GROUP BY player_id, player_username ORDER BY ticket_count DESC
  `);

  const payoutRows = await db.execute(sql`
    SELECT * FROM lottery_payouts WHERE draw_id=${draw.id} ORDER BY paid_at DESC
  `);

  return res.json({ draw, players: ticketRows.rows, payouts: payoutRows.rows });
});

router.get("/logs", requireBankerOrOwner, async (req, res) => {
  const limit = Math.min(200, parseInt((req.query.limit as string) || "100"));
  const rows = await db.execute(sql`SELECT * FROM lottery_logs ORDER BY id DESC LIMIT ${limit}`);
  return res.json(rows.rows);
});

router.get("/draws/:id/tickets", requireBankerOrOwner, async (req, res) => {
  const drawId = parseInt(req.params.id);
  const rows = await db.execute(sql`
    SELECT lt.*, p.username FROM lottery_tickets lt
    LEFT JOIN players p ON p.id=lt.player_id
    WHERE lt.draw_id=${drawId} ORDER BY lt.id ASC
  `);
  return res.json(rows.rows);
});

export default router;
