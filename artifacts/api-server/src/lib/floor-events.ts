import { broadcastToSecurityClients } from "./table-ws.js";
import { registerActivityHook, getActivePlayers } from "./player-activity.js";

export type FloorEventType =
  | "flagged_presence"
  | "flagged_movement"
  | "large_transaction"
  | "player_kicked"
  | "player_warned"
  | "player_banned"
  | "player_flagged"
  | "player_joined"
  | "player_left"
  | "bet_placed"
  | "player_login"
  | "player_site_active"
  | "player_left_site";

export type FloorEventSeverity = "info" | "warn" | "critical";

export interface FloorEvent {
  id: string;
  timestamp: number;
  type: FloorEventType;
  severity: FloorEventSeverity;
  playerId: number;
  username: string;
  message: string;
  location?: string;
  flagSeverity?: string;
}

const MAX_EVENTS = 200;
const events: FloorEvent[] = [];

// Players excluded from login/site-active log events
const loginLogsExcluded = new Set<number>();

export function setLoginLogsExclusion(playerId: number, excluded: boolean) {
  if (excluded) loginLogsExcluded.add(playerId);
  else loginLogsExcluded.delete(playerId);
}

export function isExcludedFromLoginLogs(playerId: number) {
  return loginLogsExcluded.has(playerId);
}

// Track which flagged players we've already emitted a presence event for
// (keyed by playerId → last presence event timestamp)
const presenceDebounce = new Map<number, number>();
const PRESENCE_DEBOUNCE_MS = 5 * 60 * 1000;

// Track last known location per player for movement detection
const lastKnownLocation = new Map<number, string>();

let _eventCounter = 0;
function nextId() {
  return `fe-${Date.now()}-${_eventCounter++}`;
}

export function addFloorEvent(event: Omit<FloorEvent, "id" | "timestamp">) {
  const full: FloorEvent = { ...event, id: nextId(), timestamp: Date.now() };
  events.unshift(full);
  if (events.length > MAX_EVENTS) events.pop();
  try {
    broadcastToSecurityClients({ type: "floor_event", event: full });
  } catch {
    // table-ws not yet ready
  }
  return full;
}

export function getFloorEvents(limit = 40): FloorEvent[] {
  return events.slice(0, limit);
}

export function clearPresenceDebounce(playerId: number) {
  presenceDebounce.delete(playerId);
  lastKnownLocation.delete(playerId);
  lastEmittedLocation.delete(playerId);
}

/**
 * Called by player-activity when a flagged player's activity is recorded.
 * Emits presence events (debounced) and movement events.
 */
export function onFlaggedPlayerActivity(
  playerId: number,
  username: string,
  location: string,
  flagSeverity: string | null,
) {
  const now = Date.now();

  // Presence event — debounced per player
  const lastSeen = presenceDebounce.get(playerId) ?? 0;
  if (now - lastSeen > PRESENCE_DEBOUNCE_MS) {
    presenceDebounce.set(playerId, now);
    addFloorEvent({
      type: "flagged_presence",
      severity: flagSeverity === "HIGH" ? "critical" : flagSeverity === "LOW" ? "info" : "warn",
      playerId,
      username,
      message: `${username} is on the floor`,
      location,
      flagSeverity: flagSeverity ?? "MED",
    });
  }

  // Movement event — only if location changed
  const prevLocation = lastKnownLocation.get(playerId);
  if (prevLocation && prevLocation !== location && location !== "lobby") {
    addFloorEvent({
      type: "flagged_movement",
      severity: flagSeverity === "HIGH" ? "critical" : "info",
      playerId,
      username,
      message: `${username} moved: ${prevLocation} → ${location}`,
      location,
      flagSeverity: flagSeverity ?? "MED",
    });
  }
  lastKnownLocation.set(playerId, location);
}

export function emitKickEvent(playerId: number, username: string, by: string, location?: string) {
  addFloorEvent({
    type: "player_kicked",
    severity: "info",
    playerId,
    username,
    message: `${username} kicked to lobby by ${by}`,
    location,
  });
}

export function emitWarnEvent(playerId: number, username: string, by: string, reason: string) {
  addFloorEvent({
    type: "player_warned",
    severity: "warn",
    playerId,
    username,
    message: `${username} warned by ${by}: ${reason}`,
  });
}

export function emitBanEvent(playerId: number, username: string, by: string, game: string, reason: string) {
  addFloorEvent({
    type: "player_banned",
    severity: "critical",
    playerId,
    username,
    message: `${username} banned from ${game} by ${by}: ${reason}`,
  });
}

export function emitFlagEvent(
  playerId: number,
  username: string,
  by: string,
  reason: string,
  severity: string,
) {
  addFloorEvent({
    type: "player_flagged",
    severity: severity === "HIGH" ? "critical" : severity === "LOW" ? "info" : "warn",
    playerId,
    username,
    message: `${username} flagged [${severity}] by ${by}: ${reason}`,
    flagSeverity: severity,
  });
}

// ── Movement tracking (all players, not just flagged) ──────────────────────────

const GAME_LABELS: Record<string, string> = {
  blackjack: "Blackjack", slots: "Slots", roulette: "Roulette",
  crash: "Crash", poker: "Poker",
  "horse-racing": "Horse Racing", baccarat: "Baccarat",
};

function gameLabel(game: string) {
  return GAME_LABELS[game] || game;
}

// Track the last location we actually emitted a join/leave event for per player.
// This is the source of truth for "where does the floor feed think this player is".
// It lets us fire events ONLY on genuine transitions — no debounce needed.
const lastEmittedLocation = new Map<number, string>();

export function emitPlayerJoined(playerId: number, username: string, game: string) {
  if (game === "lobby") return;
  addFloorEvent({
    type: "player_joined",
    severity: "info",
    playerId,
    username,
    message: `${username} joined ${gameLabel(game)}`,
    location: game,
  });
}

export function emitPlayerLeft(playerId: number, username: string, game: string) {
  if (game === "lobby") return;
  addFloorEvent({
    type: "player_left",
    severity: "info",
    playerId,
    username,
    message: `${username} left ${gameLabel(game)}`,
    location: game,
  });
}

export function emitLoginEvent(playerId: number, username: string) {
  if (loginLogsExcluded.has(playerId)) return;
  addFloorEvent({
    type: "player_login",
    severity: "info",
    playerId,
    username,
    message: `${username} logged in`,
  });
}

export function emitSiteActiveEvent(playerId: number, username: string) {
  if (loginLogsExcluded.has(playerId)) return;
  addFloorEvent({
    type: "player_site_active",
    severity: "info",
    playerId,
    username,
    message: `${username} is active on site`,
    location: "lobby",
  });
}

export function emitPlayerLeftSiteEvent(playerId: number, username: string) {
  if (loginLogsExcluded.has(playerId)) return;
  addFloorEvent({
    type: "player_left_site",
    severity: "info",
    playerId,
    username,
    message: `${username} left the site`,
  });
}

export function emitBetPlaced(
  playerId: number,
  username: string,
  game: string,
  amount: number,
  note?: string,
) {
  addFloorEvent({
    type: "bet_placed",
    severity: amount >= 50_000 ? "warn" : "info",
    playerId,
    username,
    message: `${username} bet ${amount.toLocaleString()} chips${note ? ` — ${note}` : ""}`,
    location: game,
  });
}

// Register an activity hook to emit join/leave ONLY when the emitted location changes.
// The activity tracker already filters hooks to game-change or first-appearance only,
// so this hook runs at most once per genuine location change per player.
registerActivityHook((playerId, username, game, isFirstSeen, _previousGame) => {
  const lastEmitted = lastEmittedLocation.get(playerId);

  // Emit a site-active event when a player is first seen (returning after absence)
  if (isFirstSeen && !lastEmitted) {
    emitSiteActiveEvent(playerId, username);
  }

  // Suppress if the floor feed already knows the player is here
  if (lastEmitted === game) return;

  // Emit a "left" event for where the floor feed last tracked them (if not lobby)
  if (lastEmitted && lastEmitted !== "lobby") {
    emitPlayerLeft(playerId, username, lastEmitted);
  }

  // Emit a "joined" event for the new location (if not lobby)
  if (game !== "lobby") {
    emitPlayerJoined(playerId, username, game);
  }

  // Update the emitted-location tracker
  lastEmittedLocation.set(playerId, game);
});

// ── Periodic "left site" scanner ──────────────────────────────────────────────
// Every 30 s, compare lastEmittedLocation (who we know is on-site) against
// getActivePlayers() (who is still within the 3-min heartbeat window).
// Anyone in the tracker but no longer active gets a "left site" event.
setInterval(() => {
  if (lastEmittedLocation.size === 0) return;
  const activeIds = new Set(getActivePlayers().map(p => p.playerId));
  for (const [pid, _loc] of lastEmittedLocation) {
    if (!activeIds.has(pid)) {
      // Retrieve username from events (most recent event for this player)
      const ev = events.find(e => e.playerId === pid);
      const username = ev?.username ?? String(pid);
      emitPlayerLeftSiteEvent(pid, username);
      lastEmittedLocation.delete(pid);
      presenceDebounce.delete(pid);
      lastKnownLocation.delete(pid);
    }
  }
}, 30_000);
