/**
 * game-session.ts
 *
 * Shared per-player session accumulator for all casino games.
 *
 * Instead of writing one transaction per bet/win, each game records
 * rounds into an in-memory session.  After FLUSH_IDLE_MS of inactivity
 * the session is flushed as a SINGLE grouped transaction entry.
 *
 * Usage:
 *   import { recordGameRound } from "../lib/game-session.js";
 *   recordGameRound(db, playerId, "slots", bet, payout);
 */

import { db as _db, transactionsTable } from "@workspace/db";

const FLUSH_IDLE_MS = 60_000; // 60 s of inactivity → flush

interface Session {
  rounds: number;
  totalBet: number;
  totalPayout: number;
  timer: ReturnType<typeof setTimeout>;
}

// key: `${game}:${playerId}`
const sessions = new Map<string, Session>();

const GAME_LABELS: Record<string, string> = {
  slots:      "Slots",
  crash:      "Crash",
  blackjack:  "Blackjack",
  baccarat:   "Baccarat",
  roulette:   "Roulette",
};

const ROUND_LABELS: Record<string, string> = {
  slots:      "spin",
  crash:      "round",
  blackjack:  "hand",
  baccarat:   "hand",
  roulette:   "spin",
};

async function flushSession(playerId: number, game: string) {
  const key = `${game}:${playerId}`;
  const s = sessions.get(key);
  if (!s) return;
  sessions.delete(key);
  if (s.rounds === 0) return;

  const label  = GAME_LABELS[game]  ?? game;
  const unit   = ROUND_LABELS[game] ?? "round";
  const plural = s.rounds === 1 ? unit : `${unit}s`;
  const net    = s.totalPayout - s.totalBet;
  const sign   = net >= 0 ? "+" : "";

  const description =
    `${label} session — ${s.rounds} ${plural}, ` +
    `wagered ${s.totalBet.toLocaleString()}, ` +
    `returned ${s.totalPayout.toLocaleString()} ` +
    `(${sign}${net.toLocaleString()} net)`;

  await _db.insert(transactionsTable).values({
    playerId,
    amount: Math.abs(net),
    type: net >= 0 ? "win" : "loss",
    description,
  });
}

/**
 * Call once per completed game round (after chips have already been updated).
 * `bet`    — chips wagered this round
 * `payout` — chips returned this round (0 if player lost everything)
 */
export function recordGameRound(
  playerId: number,
  game: string,
  bet: number,
  payout: number,
): void {
  const key = `${game}:${playerId}`;
  const existing = sessions.get(key);
  if (existing) clearTimeout(existing.timer);

  const rounds      = (existing?.rounds      ?? 0) + 1;
  const totalBet    = (existing?.totalBet    ?? 0) + bet;
  const totalPayout = (existing?.totalPayout ?? 0) + payout;

  const timer = setTimeout(() => flushSession(playerId, game), FLUSH_IDLE_MS);
  sessions.set(key, { rounds, totalBet, totalPayout, timer });
}

/**
 * Immediately flush a player's session for a specific game.
 * Call this if the player logs out or the game ends server-side.
 */
export function flushGameSession(playerId: number, game: string): void {
  flushSession(playerId, game).catch(console.error);
}
