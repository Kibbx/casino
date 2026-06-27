/**
 * challengeEventService
 *
 * Drop-in event dispatcher.  Import fireChallengeEvent() from any game page
 * to advance challenge progress without coupling the page to challenge logic.
 *
 * ── Quick reference ──────────────────────────────────────────────────────────
 *
 *   fireChallengeEvent("blackjack_round_played")
 *     → High Roller daily (+1 round), Blackjack Devotee weekly (+1 round),
 *       The Long Haul monthly (+1 round)
 *
 *   fireChallengeEvent("blackjack_win")
 *     → Blackjack Ace monthly (+1 win)
 *     → also triggers bet_won logic (consecutive wins / totals)
 *
 *   fireChallengeEvent("roulette_spin")
 *     → Spin Doctor daily (+1 spin)
 *
 *   fireChallengeEvent("roulette_win")
 *     → Roulette Winner daily (+1 win), Fortune Seeker monthly (+1 win)
 *     → also triggers bet_won logic
 *
 *   fireChallengeEvent("single_bet_placed", { amount: 500 })
 *     → Big Bettor daily (amount > 100), Whale Bet daily (amount > 500)
 *
 *   fireChallengeEvent("bet_wagered", { amount: 200 })
 *     → High Roller Month monthly (+amount chips wagered)
 *
 *   fireChallengeEvent("tournament_entered")
 *     → Tournament Regular weekly (+1)
 *
 *   fireChallengeEvent("mini_game_round_played")
 *     → Mini Game Marathon weekly (+1), The Long Haul monthly (+1)
 *
 *   fireChallengeEvent("full_table_played")
 *     → Social Butterfly weekly (+1)
 *
 *   fireChallengeEvent("case_opened")
 *     → Case Opener daily (+1), Case Hunter weekly (+1),
 *       Case Connoisseur monthly (+1)
 *
 *   fireChallengeEvent("any_game_round_played")
 *     → Quick Gambler daily (+1), The Long Haul monthly (+1)
 *
 *   fireChallengeEvent("bet_won")
 *     → consecutive win tracking (Diamond Run, Lucky Streak),
 *       cumulative win tracking (Unstoppable monthly, Big Winner weekly)
 *
 *   fireChallengeEvent("bet_lost")
 *     → breaks consecutive win streak
 *
 *   fireChallengeEvent("session_profit_updated", { profit: 800 })
 *     → On Fire special (set to profit value)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  incrementProgress,
  recordConsecutiveWin,
  recordSessionProfit,
  recordWager,
} from "./challengeService";

export type ChallengeEventType =
  | "blackjack_round_played"
  | "blackjack_win"
  | "roulette_spin"
  | "roulette_win"
  | "single_bet_placed"
  | "bet_wagered"
  | "tournament_entered"
  | "mini_game_round_played"
  | "full_table_played"
  | "case_opened"
  | "any_game_round_played"
  | "bet_won"
  | "bet_lost"
  | "session_profit_updated";

export interface ChallengeEventPayload {
  amount?: number;
  profit?: number;
}

export function fireChallengeEvent(
  type: ChallengeEventType,
  payload: ChallengeEventPayload = {},
): void {
  switch (type) {

    // ── Daily ───────────────────────────────────────────────────────────────

    case "blackjack_round_played":
      incrementProgress("d_high_roller");
      incrementProgress("w_high_roller");  // weekly Blackjack Devotee
      incrementProgress("m_marathon");      // monthly The Long Haul
      incrementProgress("d_quick_gambler"); // daily Quick Gambler (any game)
      break;

    case "blackjack_win":
      incrementProgress("m_blackjack_ace");
      recordConsecutiveWin(true);
      break;

    case "roulette_spin":
      incrementProgress("d_spin_doctor");
      incrementProgress("m_marathon");      // monthly The Long Haul
      incrementProgress("d_quick_gambler"); // daily Quick Gambler (any game)
      break;

    case "roulette_win":
      incrementProgress("d_roulette_winner");
      incrementProgress("m_fortune_seeker");
      recordConsecutiveWin(true);
      break;

    case "single_bet_placed": {
      const amt = payload.amount ?? 0;
      if (amt > 100) incrementProgress("d_big_bettor");
      if (amt > 500) incrementProgress("d_whale_bet");
      break;
    }

    case "bet_wagered":
      if (typeof payload.amount === "number" && payload.amount > 0) {
        recordWager(payload.amount);
      }
      break;

    // ── Weekly ──────────────────────────────────────────────────────────────

    case "tournament_entered":
      incrementProgress("w_tourney");
      break;

    case "mini_game_round_played":
      incrementProgress("w_mini_marathon");
      incrementProgress("m_marathon");
      incrementProgress("d_quick_gambler"); // daily Quick Gambler (any game)
      break;

    case "full_table_played":
      incrementProgress("w_social");
      break;

    // ── Multi-category ──────────────────────────────────────────────────────

    case "case_opened":
      incrementProgress("d_case_opener");
      incrementProgress("w_case_hunter");
      incrementProgress("m_case_connoisseur");
      break;

    case "any_game_round_played":
      incrementProgress("d_quick_gambler");
      incrementProgress("m_marathon");
      break;

    // ── Win / loss tracking ─────────────────────────────────────────────────

    case "bet_won":
      recordConsecutiveWin(true);
      break;

    case "bet_lost":
      recordConsecutiveWin(false);
      break;

    // ── Special ─────────────────────────────────────────────────────────────

    case "session_profit_updated":
      if (typeof payload.profit === "number") {
        recordSessionProfit(payload.profit);
      }
      break;
  }
}

/** Alias — same as fireChallengeEvent, satisfies the spec name. */
export const updateChallengeProgress = fireChallengeEvent;

// ── Dev-only test helpers (stripped in production builds) ─────────────────────
if (import.meta.env.DEV) {
  (window as any).testChallengeEvent = (
    type: ChallengeEventType,
    payload: ChallengeEventPayload = {},
  ) => {
    console.info("[challenge] testChallengeEvent:", type, payload);
    fireChallengeEvent(type, payload);
  };

  (window as any).testChallengeReset = () => {
    localStorage.removeItem("bab_challenges_v4");
    window.location.reload();
  };

  console.info(
    "[challenge] Dev helpers available:\n" +
    "  window.testChallengeEvent(type, payload?)\n" +
    "  window.testChallengeReset()\n" +
    "Event types: blackjack_round_played | blackjack_win | roulette_spin |\n" +
    "  roulette_win | single_bet_placed | bet_wagered | tournament_entered |\n" +
    "  mini_game_round_played | full_table_played | case_opened |\n" +
    "  any_game_round_played | bet_won | bet_lost | session_profit_updated"
  );
}
