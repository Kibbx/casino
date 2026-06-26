import type { CatalogGame } from "../pages/shared";

export interface RecentlyPlayedEntry {
  id: string;
  game: CatalogGame;
  route: string;
  tokenId?: string;
  launchData?: Record<string, unknown>;
  playedAt: number;
}

const KEY = "bh_recently_played";
const MAX = 4;

export function addRecentlyPlayed(entry: Omit<RecentlyPlayedEntry, "playedAt">): void {
  try {
    const current = getRecentlyPlayed().filter(e => e.id !== entry.id);
    localStorage.setItem(KEY, JSON.stringify([{ ...entry, playedAt: Date.now() }, ...current].slice(0, MAX)));
  } catch {}
}

export function getRecentlyPlayed(): RecentlyPlayedEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
