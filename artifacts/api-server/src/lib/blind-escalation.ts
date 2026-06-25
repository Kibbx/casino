import { db, pokerTablesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface BlindLevel {
  small: number;
  big: number;
  duration: number; // seconds
}

interface EscalationState {
  tableId: number;
  enabled: boolean;
  resetDelay: number;
  blindLevels: BlindLevel[];
  levelIndex: number;
  elapsedTime: number;
  inactiveTime: number;
  isActive: boolean;
  wasActive: boolean;
  seatedCount: number;
}

const states = new Map<number, EscalationState>();
let tickInterval: ReturnType<typeof setInterval> | null = null;

type BroadcastFn = (tableId: number, event: string, data: object) => void;
let broadcastFn: BroadcastFn | null = null;

export function setBlindBroadcastFn(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export function initEscalation(table: {
  id: number;
  escalationEnabled?: boolean | null;
  resetDelay?: number | null;
  blindLevels?: unknown;
}): void {
  if (states.has(table.id)) {
    const existing = states.get(table.id)!;
    existing.enabled = table.escalationEnabled ?? false;
    existing.resetDelay = table.resetDelay ?? 30;
    existing.blindLevels = parseBlindLevels(table.blindLevels);
    return;
  }
  states.set(table.id, {
    tableId: table.id,
    enabled: table.escalationEnabled ?? false,
    resetDelay: table.resetDelay ?? 30,
    blindLevels: parseBlindLevels(table.blindLevels),
    levelIndex: 0,
    elapsedTime: 0,
    inactiveTime: 0,
    isActive: false,
    wasActive: false,
    seatedCount: 0,
  });
}

export function updateEscalationConfig(
  tableId: number,
  config: { enabled?: boolean; resetDelay?: number; blindLevels?: BlindLevel[] },
): void {
  const state = states.get(tableId);
  if (!state) return;
  if (config.enabled != null) state.enabled = config.enabled;
  if (config.resetDelay != null) state.resetDelay = config.resetDelay;
  if (config.blindLevels != null) {
    state.blindLevels = config.blindLevels;
    state.levelIndex = 0;
    state.elapsedTime = 0;
  }
}

export function updateSeatedCount(tableId: number, count: number): void {
  const state = states.get(tableId);
  if (state) state.seatedCount = count;
}

export function removeEscalation(tableId: number): void {
  states.delete(tableId);
}

export function getEscalationState(tableId: number): {
  levelIndex: number;
  totalLevels: number;
  timeToNextLevel: number | null;
  currentSmallBlind: number | null;
  currentBigBlind: number | null;
} | null {
  const s = states.get(tableId);
  if (!s || !s.enabled || !s.blindLevels.length) return null;
  const level = s.blindLevels[s.levelIndex];
  const isLast = s.levelIndex >= s.blindLevels.length - 1;
  return {
    levelIndex: s.levelIndex,
    totalLevels: s.blindLevels.length,
    timeToNextLevel: isLast ? null : level.duration - s.elapsedTime,
    currentSmallBlind: level?.small ?? null,
    currentBigBlind: level?.big ?? null,
  };
}

function parseBlindLevels(raw: unknown): BlindLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is BlindLevel =>
      typeof l === "object" && l !== null &&
      typeof (l as any).small === "number" &&
      typeof (l as any).big === "number" &&
      typeof (l as any).duration === "number",
  );
}

function buildPayload(state: EscalationState) {
  const level = state.blindLevels[state.levelIndex];
  const isLast = state.levelIndex >= state.blindLevels.length - 1;
  return {
    tableId: state.tableId,
    smallBlind: level.small,
    bigBlind: level.big,
    levelIndex: state.levelIndex,
    totalLevels: state.blindLevels.length,
    timeToNextLevel: isLast ? null : level.duration - state.elapsedTime,
  };
}

function applyBlinds(state: EscalationState, event: "table:levelUp" | "table:reset" | "table:blindsUpdated"): void {
  if (!state.blindLevels.length) return;
  const level = state.blindLevels[state.levelIndex];
  db.update(pokerTablesTable)
    .set({ smallBlind: level.small, bigBlind: level.big })
    .where(eq(pokerTablesTable.id, state.tableId))
    .catch((err) => console.error(`[Escalation] DB update failed table ${state.tableId}:`, err));
  broadcastFn?.(state.tableId, event, buildPayload(state));
}

function tick(): void {
  for (const [, state] of states) {
    if (!state.enabled || !state.blindLevels.length) continue;

    const nowActive = state.seatedCount >= 2;

    if (nowActive) {
      state.isActive = true;
      state.inactiveTime = 0;
      state.elapsedTime += 1;

      const currentLevel = state.blindLevels[state.levelIndex];
      if (state.elapsedTime >= currentLevel.duration) {
        if (state.levelIndex < state.blindLevels.length - 1) {
          state.levelIndex++;
          state.elapsedTime = 0;
          applyBlinds(state, "table:levelUp");
          console.log(`[Escalation] Table ${state.tableId} → level ${state.levelIndex} (${state.blindLevels[state.levelIndex].small}/${state.blindLevels[state.levelIndex].big})`);
        }
      } else if (state.elapsedTime % 5 === 0) {
        broadcastFn?.(state.tableId, "table:blindsUpdated", buildPayload(state));
      }
    } else {
      state.isActive = false;
      state.inactiveTime += 1;

      if (state.inactiveTime >= state.resetDelay && state.wasActive) {
        state.levelIndex = 0;
        state.elapsedTime = 0;
        state.inactiveTime = 0;
        applyBlinds(state, "table:reset");
        console.log(`[Escalation] Table ${state.tableId} reset to level 0 after inactivity`);
      }
    }

    state.wasActive = state.isActive;
  }
}

export function startEscalationLoop(): void {
  if (tickInterval) return;
  tickInterval = setInterval(tick, 1000);
  console.log("[Escalation] Blind escalation loop started");
}
