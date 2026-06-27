const STORAGE_KEY = "bab_challenges_v2";
export const CHALLENGES_EVENT = "bab:challenges:update";

export interface ChallengeDefinition {
  id: string;
  category: "daily" | "weekly" | "special";
  icon: string;
  name: string;
  desc: string;
  total: number;
  reward: number;
  color: string;
  limited?: boolean;
}

export interface ChallengeState {
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export const CHALLENGE_DEFS: ChallengeDefinition[] = [
  { id: "daily_high_roller",    category: "daily",   icon: "🃏", name: "High Roller",          desc: "Play 5 rounds of Blackjack",                 total: 5,    reward: 50,   color: "#22c55e" },
  { id: "daily_spin_doctor",    category: "daily",   icon: "🎡", name: "Spin Doctor",           desc: "Spin the Roulette wheel 3 times",             total: 3,    reward: 75,   color: "#f97316" },
  { id: "daily_big_bettor",     category: "daily",   icon: "💰", name: "Big Bettor",            desc: "Place a single bet over $100",                total: 1,    reward: 100,  color: "#f5c518" },
  { id: "weekly_tourney",       category: "weekly",  icon: "🏆", name: "Tournament Regular",    desc: "Enter 3 tournaments this week",               total: 3,    reward: 400,  color: "#a855f7" },
  { id: "weekly_mini_marathon", category: "weekly",  icon: "🎰", name: "Mini Game Marathon",    desc: "Play 20 rounds of any mini game",             total: 20,   reward: 250,  color: "#ec4899" },
  { id: "weekly_social",        category: "weekly",  icon: "🤝", name: "Social Butterfly",      desc: "Play at full tables 5 times",                 total: 5,    reward: 300,  color: "#06b6d4" },
  { id: "special_diamond_run",  category: "special", icon: "👑", name: "The Diamond Run",       desc: "Win 10 consecutive bets — legendary streak",  total: 10,   reward: 2000, color: "#7dd3fc", limited: true },
  { id: "special_on_fire",      category: "special", icon: "🔥", name: "On Fire",               desc: "Win $1,000 in a single session",              total: 1000, reward: 500,  color: "#f97316", limited: true },
];

interface StoredState {
  playerId: number | null;
  lastDailyReset: string;
  lastWeeklyReset: string;
  progress: Record<string, number>;
  claimed: string[];
  consecutiveWins: number;
  sessionProfit: number;
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoWeek(): string {
  const d = new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((d.getTime() - startOfYear.getTime()) / 86_400_000);
  const weekNum = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

const SEED_PROGRESS: Record<string, number> = {
  daily_high_roller:    3,
  daily_spin_doctor:    3,
  daily_big_bettor:     0,
  weekly_tourney:       1,
  weekly_mini_marathon: 8,
  weekly_social:        2,
  special_diamond_run:  4,
  special_on_fire:      620,
};

function defaultState(playerId: number | null = null): StoredState {
  return {
    playerId,
    lastDailyReset: isoDate(),
    lastWeeklyReset: isoWeek(),
    progress: { ...SEED_PROGRESS },
    claimed: [],
    consecutiveWins: 4,
    sessionProfit: 620,
  };
}

function load(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw) as Partial<StoredState>;
    return {
      playerId:        p.playerId ?? null,
      lastDailyReset:  p.lastDailyReset  ?? isoDate(),
      lastWeeklyReset: p.lastWeeklyReset ?? isoWeek(),
      progress:        typeof p.progress === "object" && p.progress ? p.progress : { ...SEED_PROGRESS },
      claimed:         Array.isArray(p.claimed) ? p.claimed : [],
      consecutiveWins: typeof p.consecutiveWins === "number" ? p.consecutiveWins : 4,
      sessionProfit:   typeof p.sessionProfit   === "number" ? p.sessionProfit   : 620,
    };
  } catch {
    return defaultState();
  }
}

function save(state: StoredState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function applyResets(state: StoredState): StoredState {
  const today = isoDate();
  const week  = isoWeek();
  let changed = false;

  if (state.lastDailyReset !== today) {
    const ids = CHALLENGE_DEFS.filter(c => c.category === "daily").map(c => c.id);
    for (const id of ids) state.progress[id] = 0;
    state.claimed = state.claimed.filter(id => !ids.includes(id));
    state.lastDailyReset = today;
    changed = true;
  }

  if (state.lastWeeklyReset !== week) {
    const ids = CHALLENGE_DEFS.filter(c => c.category === "weekly").map(c => c.id);
    for (const id of ids) state.progress[id] = 0;
    state.claimed = state.claimed.filter(id => !ids.includes(id));
    state.lastWeeklyReset = week;
    changed = true;
  }

  if (changed) save(state);
  return state;
}

function emit(): void {
  window.dispatchEvent(new Event(CHALLENGES_EVENT));
}

export function getChallengeStates(playerId?: number | null): (ChallengeDefinition & ChallengeState)[] {
  let state = load();
  if (playerId !== undefined && playerId !== null && state.playerId !== playerId) {
    state = defaultState(playerId);
    save(state);
  }
  state = applyResets(state);
  return CHALLENGE_DEFS.map(def => {
    const progress  = state.progress[def.id] ?? 0;
    const completed = progress >= def.total;
    const claimed   = state.claimed.includes(def.id);
    return { ...def, progress, completed, claimed };
  });
}

export function incrementProgress(id: string, by = 1): void {
  const state = load();
  const def = CHALLENGE_DEFS.find(c => c.id === id);
  if (!def) return;
  const cur = state.progress[id] ?? 0;
  if (cur >= def.total) return;
  state.progress[id] = Math.min(def.total, cur + by);
  save(state);
  emit();
}

export function setProgress(id: string, value: number): void {
  const state = load();
  const def = CHALLENGE_DEFS.find(c => c.id === id);
  if (!def) return;
  state.progress[id] = Math.min(def.total, Math.max(0, value));
  save(state);
  emit();
}

export function markClaimed(id: string): void {
  const state = load();
  if (!state.claimed.includes(id)) {
    state.claimed.push(id);
    save(state);
    emit();
  }
}

export function recordConsecutiveWin(won: boolean): void {
  const state = load();
  if (won) {
    state.consecutiveWins = (state.consecutiveWins ?? 0) + 1;
    const prev = state.progress["special_diamond_run"] ?? 0;
    if (state.consecutiveWins > prev) {
      state.progress["special_diamond_run"] = Math.min(10, state.consecutiveWins);
    }
  } else {
    state.consecutiveWins = 0;
  }
  save(state);
  emit();
}

export function recordSessionProfit(profit: number): void {
  const state = load();
  state.sessionProfit = profit;
  state.progress["special_on_fire"] = Math.min(1000, Math.max(0, profit));
  save(state);
  emit();
}
