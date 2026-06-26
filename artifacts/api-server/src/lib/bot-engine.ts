/**
 * bot-engine.ts
 * Manages a pool of bot players that actively play at blackjack tables
 * and simulate presence across other games (roulette, poker, slots, etc.)
 * to keep live activity numbers realistic.
 */

import { db, playersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAllBJRooms } from "./blackjack-room.js";
import { recordPlayerActivity } from "./player-activity.js";

// ── Bot definitions ─────────────────────────────────────────────────────────

const BOT_DEFS = [
  { username: "VegasVince",    startChips: 75_000 },
  { username: "LuckyLena",     startChips: 50_000 },
  { username: "CardShark_K",   startChips: 60_000 },
  { username: "RoyalFlush_R",  startChips: 90_000 },
  { username: "AceHunter",     startChips: 45_000 },
  { username: "DealBreaker",   startChips: 55_000 },
  { username: "SilverStack",   startChips: 40_000 },
  { username: "NeonNick",      startChips: 65_000 },
];

const BJ_BOT_COUNT     = 4;   // first N bots play BJ at tables
const REFILL_BELOW     = 15_000;
const REFILL_TARGET    = 60_000;
const TICK_INTERVAL_MS = 2_500;

const ACTIVITY_GAMES = [
  "roulette", "poker", "slots", "minigames",
  "horse-racing", "baccarat", "high-low",
];

interface BotMeta {
  playerId: number;
  username: string;
  assignedTableId: number | null;
  activityGame: string | null;
  activityRotateAt: number;
}

const bots: BotMeta[] = [];
let engineRunning = false;

// ── Ensure bots exist in DB ─────────────────────────────────────────────────

async function ensureBotPlayers(): Promise<void> {
  for (const def of BOT_DEFS) {
    const rows = await db.select().from(playersTable).where(eq(playersTable.username, def.username));
    if (rows.length === 0) {
      const [bot] = await db.insert(playersTable).values({
        username: def.username,
        stateId: null,
        chips: def.startChips,
        isBot: true,
        pin: "0000",
      }).returning();
      bots.push({ playerId: bot.id, username: bot.username, assignedTableId: null, activityGame: null, activityRotateAt: 0 });
      console.log(`[BotEngine] Created bot: ${def.username} (id=${bot.id})`);
    } else {
      const bot = rows[0];
      bots.push({ playerId: bot.id, username: bot.username, assignedTableId: null, activityGame: null, activityRotateAt: 0 });
      console.log(`[BotEngine] Loaded bot: ${def.username} (id=${bot.id})`);
    }
  }
}

// ── Blackjack basic strategy ────────────────────────────────────────────────
// Stand on hard 17+, hit on 16 or less. Good enough for realistic play.

function bjDecide(handVal: number): "hit" | "stand" {
  return handVal >= 17 ? "stand" : "hit";
}

// ── BJ bot tick ─────────────────────────────────────────────────────────────

async function tickBJBots(): Promise<void> {
  const rooms = getAllBJRooms().filter(r => r.isOpen);
  if (rooms.length === 0) return;

  const bjBots = bots.slice(0, BJ_BOT_COUNT);

  for (const bot of bjBots) {
    try {
      // Check and possibly refill chips
      const [row] = await db.select({ chips: playersTable.chips })
        .from(playersTable).where(eq(playersTable.id, bot.playerId));
      const currentChips = Number(row?.chips ?? 0);
      if (currentChips < REFILL_BELOW) {
        await db.update(playersTable).set({ chips: REFILL_TARGET })
          .where(eq(playersTable.id, bot.playerId));
        console.log(`[BotEngine] Refilled ${bot.username} chips → ${REFILL_TARGET}`);
      }

      // Assign a table if needed
      if (bot.assignedTableId === null) {
        const room = rooms[Math.floor(Math.random() * rooms.length)];
        bot.assignedTableId = room.tableId;
      }

      const room = rooms.find(r => r.tableId === bot.assignedTableId);
      if (!room || !room.isOpen) {
        bot.assignedTableId = null;
        continue;
      }

      const phase = room.getPhase();
      const info  = room.getBotSeatInfo(bot.playerId);

      // ── Sit down if not seated ──────────────────────────────────────────
      if (!info.isSeated) {
        if (phase === "WAITING" || phase === "BETTING") {
          const seatIdx = room.getFirstEmptySeatIndex();
          if (seatIdx !== null) {
            const res = await room.sitDown(null as any, bot.playerId, seatIdx);
            if (res.error) {
              // Table may be full or closed — reassign next tick
              if (res.error.includes("closed") || res.error.includes("taken") || res.error.includes("Already")) {
                bot.assignedTableId = null;
              }
            }
          }
        }
        continue;
      }

      // ── Place bet ────────────────────────────────────────────────────────
      if (phase === "BETTING" && !info.hasBet) {
        const chips    = Math.max(currentChips, REFILL_TARGET);
        const betMin   = room.minBet;
        const betCap   = Math.min(room.maxBet, Math.floor(chips * 0.06)); // max ~6% of stack
        if (betCap >= betMin) {
          const bet = betMin + Math.floor(Math.random() * (betCap - betMin + 1));
          const res = await room.placeBet(null as any, bot.playerId, bet);
          if (res.error) {
            console.log(`[BotEngine] ${bot.username} placeBet error: ${res.error}`);
          }
        }
      }

      // ── Take game action ─────────────────────────────────────────────────
      if (phase === "PLAYER_TURNS" && info.isMyTurn) {
        const action = bjDecide(info.handValue);
        const res = await room.playerAction(bot.playerId, action);
        if (res?.error) {
          console.log(`[BotEngine] ${bot.username} action error: ${res.error}`);
        }
      }

      // Record BJ activity so live counts are accurate
      recordPlayerActivity(bot.playerId, bot.username, "blackjack", false);

    } catch (err) {
      console.error(`[BotEngine] BJ tick error for ${bot.username}:`, err);
    }
  }
}

// ── Activity bots ────────────────────────────────────────────────────────────

function tickActivityBots(): void {
  const activityBots = bots.slice(BJ_BOT_COUNT);
  const now = Date.now();

  for (const bot of activityBots) {
    // Rotate to a new game every 3–8 minutes
    if (!bot.activityGame || now >= bot.activityRotateAt) {
      bot.activityGame = ACTIVITY_GAMES[Math.floor(Math.random() * ACTIVITY_GAMES.length)];
      bot.activityRotateAt = now + 180_000 + Math.floor(Math.random() * 300_000);
      console.log(`[BotEngine] ${bot.username} moved to ${bot.activityGame}`);
    }
    recordPlayerActivity(bot.playerId, bot.username, bot.activityGame!, true);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function startBotEngine(): Promise<void> {
  if (engineRunning) return;
  engineRunning = true;

  await ensureBotPlayers();

  // Small delay so all BJ rooms are fully initialized before the first tick
  setTimeout(() => {
    setInterval(async () => {
      try {
        await tickBJBots();
        tickActivityBots();
      } catch (err) {
        console.error("[BotEngine] Tick error:", err);
      }
    }, TICK_INTERVAL_MS);
    console.log(`[BotEngine] Tick loop started (${TICK_INTERVAL_MS}ms interval)`);
  }, 6_000);

  console.log(`[BotEngine] Initialized with ${bots.length} bots (${BJ_BOT_COUNT} playing BJ, ${bots.length - BJ_BOT_COUNT} on activity)`);
}
