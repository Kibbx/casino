/**
 * recentGames.ts — Lightweight localStorage tracker for recently visited games.
 *
 * Call trackRecentGame() whenever the user navigates into any game.
 * The home page reads this list to populate "Recently Played".
 */

const STORAGE_KEY = "bh_recent_games";
const MAX_ENTRIES = 4;

export interface TrackedGame {
  /** GAME_DISPLAY key (e.g. "roulette", "mines", "rome_slots") */
  key: string;
  /** Human-readable display name */
  name: string;
  /** Unix timestamp (ms) when the user last visited */
  playedAt: number;
  /** Optional data needed to re-launch the game directly (e.g. { tableId, password }) */
  launchData?: Record<string, unknown>;
}

export function trackRecentGame(key: string, name: string, launchData?: Record<string, unknown>): void {
  try {
    const current = getTrackedGames().filter(g => g.key !== key);
    const updated: TrackedGame[] = [{ key, name, playedAt: Date.now(), launchData }, ...current].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable (FiveM CEF sandbox) — silent no-op
  }
}

export function getTrackedGames(): TrackedGame[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
