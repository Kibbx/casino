const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface PlayerSearchResult {
  id: number;
  username: string;
  stateId: string | null;
  chips: number;
  avatarUrl: string | null;
  wins: number;
  totalWon: number;
  handsPlayed: number;
  createdAt: string;
  isOnline: boolean;
  currentGame: string | null;
}

export interface PublicProfile extends PlayerSearchResult {
  challengeStats: {
    completed: number;
    chipsEarned: number;
  };
}

export async function searchPlayers(
  query: string,
  sessionToken: string
): Promise<PlayerSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(
      `${BASE}/api/players/search?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function fetchPublicProfile(
  playerId: number,
  sessionToken: string
): Promise<PublicProfile | null> {
  try {
    const res = await fetch(
      `${BASE}/api/players/${playerId}/public-profile`,
      { headers: { Authorization: `Bearer ${sessionToken}` } }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
