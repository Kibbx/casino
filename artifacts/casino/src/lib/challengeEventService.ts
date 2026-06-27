/**
 * challengeEventService
 *
 * Call fireChallengeEvent() from any game page to advance challenge progress.
 *
 * Example usage:
 *   import { fireChallengeEvent } from "../lib/challengeEventService";
 *
 *   // After a blackjack round resolves:
 *   fireChallengeEvent("blackjack_round_played");
 *
 *   // After placing a large bet:
 *   fireChallengeEvent("single_bet_placed", { amount: 500 });
 *
 *   // After a bet outcome:
 *   fireChallengeEvent(won ? "bet_won" : "bet_lost");
 */

import { incrementProgress, recordConsecutiveWin, recordSessionProfit } from "./challengeService";

export type ChallengeEventType =
  | "blackjack_round_played"
  | "roulette_spin"
  | "single_bet_placed"
  | "tournament_entered"
  | "mini_game_round_played"
  | "full_table_played"
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
    case "blackjack_round_played":
      incrementProgress("daily_high_roller");
      break;

    case "roulette_spin":
      incrementProgress("daily_spin_doctor");
      break;

    case "single_bet_placed":
      if ((payload.amount ?? 0) > 100) {
        incrementProgress("daily_big_bettor");
      }
      break;

    case "tournament_entered":
      incrementProgress("weekly_tourney");
      break;

    case "mini_game_round_played":
      incrementProgress("weekly_mini_marathon");
      break;

    case "full_table_played":
      incrementProgress("weekly_social");
      break;

    case "bet_won":
      recordConsecutiveWin(true);
      break;

    case "bet_lost":
      recordConsecutiveWin(false);
      break;

    case "session_profit_updated":
      if (typeof payload.profit === "number") {
        recordSessionProfit(payload.profit);
      }
      break;
  }
}
