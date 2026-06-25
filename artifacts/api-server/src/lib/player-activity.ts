interface ActivityRecord {
  playerId: number;
  username: string;
  game: string;
  lastSeenAt: number;
  lastActionAt: number;
}

type ActivityHook = (playerId: number, username: string, game: string, isFirstSeen: boolean, previousGame?: string) => void;
const activityHooks: ActivityHook[] = [];

export function registerActivityHook(fn: ActivityHook): void {
  activityHooks.push(fn);
}

export type PlayerActivityStatus = "playing" | "watching";

export interface ActivePlayer extends ActivityRecord {
  status: PlayerActivityStatus;
}

const activityMap = new Map<number, ActivityRecord>();

const ACTIVE_WINDOW_MS = 3 * 60 * 1000;  // 3 min — reflects current room presence
const ACTION_WINDOW_MS = 60 * 1000;       // 60 s — "playing" badge

export function recordPlayerActivity(
  playerId: number,
  username: string,
  game: string,
  isAction = false,
): void {
  const now = Date.now();
  const existing = activityMap.get(playerId);

  // A "lobby" ping must never overwrite a more-specific game that was seen
  // recently. This handles the case where a player has the lobby open in one
  // tab and a game open in another — the game tab always wins.
  if (
    game === "lobby" &&
    existing &&
    existing.game !== "lobby" &&
    existing.lastSeenAt >= now - ACTIVE_WINDOW_MS
  ) {
    // Only refresh the timestamp so they stay "online", but keep the game.
    activityMap.set(playerId, {
      ...existing,
      username,
      lastSeenAt: now,
    });
    console.log(`[activity] ${username} lobby ping blocked — keeping ${existing.game}`);
    return;
  }

  const previousGame = existing?.game;
  const gameChanged = previousGame !== game;

  if (gameChanged && previousGame !== undefined) {
    console.log(`[activity] ${username} ${previousGame} → ${game} (isAction=${isAction})`);
  }

  const isFirstSeen = !existing || existing.lastSeenAt < now - ACTIVE_WINDOW_MS;
  activityMap.set(playerId, {
    playerId,
    username,
    game,
    lastSeenAt: now,
    lastActionAt: isAction ? now : (existing?.lastActionAt ?? 0),
  });

  // Only call hooks when the game location actually changed, or on first appearance.
  // Repeated pings from the same location don't need to fire hooks.
  if (activityHooks.length > 0 && (gameChanged || isFirstSeen)) {
    for (const hook of activityHooks) {
      try { hook(playerId, username, game, isFirstSeen, previousGame); } catch {}
    }
  }
}

export function getActivePlayers(): ActivePlayer[] {
  const cutoff       = Date.now() - ACTIVE_WINDOW_MS;
  const actionCutoff = Date.now() - ACTION_WINDOW_MS;
  const results: ActivePlayer[] = [];
  for (const record of activityMap.values()) {
    if (record.lastSeenAt >= cutoff) {
      results.push({
        ...record,
        status: record.lastActionAt >= actionCutoff ? "playing" : "watching",
      });
    }
  }
  return results.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function clearPlayerActivity(playerId: number): void {
  activityMap.delete(playerId);
}
