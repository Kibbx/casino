// ─────────────────────────────────────────────────────────────────────────────
// Big House Casino — Challenge Rotation Service  (schema v3)
//
// How it works:
//  • Each category (daily / weekly / monthly) has a POOL of challenges.
//  • On load the service checks whether a rotation period has elapsed.
//  • If it has, a new set is picked from the pool (avoiding the previous set
//    wherever possible), progress + claimed flags for that category are wiped,
//    and the new state is persisted.
//  • Special challenges never rotate and are always shown.
//
// Adding a new challenge:
//  Push one object to the relevant pool array. That's it.
//  The rotation engine picks it up automatically next cycle.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "bab_challenges_v4";
export const CHALLENGES_EVENT = "bab:challenges:update";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChallengeDefinition {
  id: string;
  category: "daily" | "weekly" | "monthly" | "special";
  icon: string;
  name: string;
  desc: string;
  total: number;
  reward: number;          // chips
  rewardPoints?: number;   // reward points (optional — 0 / undefined = chips only)
  color: string;
  limited?: boolean;
  enabled?: boolean;
}

export interface ChallengeState {
  progress: number;
  completed: boolean;
  claimed: boolean;
}

interface StoredState {
  version: 4;
  playerId: number | null;
  // Rotation timestamps
  lastDailyReset:   string; // YYYY-MM-DD
  lastWeeklyReset:  string; // YYYY-Www
  lastMonthlyReset: string; // YYYY-MM
  // Active selections (IDs from each pool)
  activeDailyIds:   string[];
  activeWeeklyIds:  string[];
  activeMonthlyIds: string[];
  // Previous selections — used for deduplication on next rotation
  prevDailyIds:   string[];
  prevWeeklyIds:  string[];
  prevMonthlyIds: string[];
  // Progress keyed by challenge ID
  progress: Record<string, number>;
  claimed:  string[];
  // Streak / session tracking
  consecutiveWins: number;
  sessionProfit:   number;
}

// ── Reward ranges — adjust here without touching any other logic ──────────────
// Daily:   Chips 1,000–3,500 | sometimes + 50–100 RP
// Weekly:  Chips 5,000–10,000 + 250–500 RP
// Monthly: Chips 10,000–25,000 + 750–1,500 RP
// Special: Chips 25,000+ + 2,000+ RP
export const REWARD_RANGES = {
  daily:   { easy: [1_000, 2_000],  medium: [2_000, 3_500],  hard: [3_500, 5_000]   },
  weekly:  { easy: [5_000, 6_500],  medium: [6_500, 8_000],  hard: [8_000, 10_000]  },
  monthly: { easy: [10_000, 15_000], medium: [15_000, 20_000], hard: [20_000, 25_000] },
  special: { easy: [25_000, 40_000], medium: [40_000, 75_000], hard: [75_000, 100_000] },
} as const;

// ── Challenge Pools ───────────────────────────────────────────────────────────
// 3 are active at a time per category (except special which always shows all).

export const DAILY_POOL: ChallengeDefinition[] = [
  {
    id: "d_high_roller", category: "daily", icon: "🃏",
    name: "High Roller", desc: "Play 5 rounds of Blackjack",
    total: 5, reward: 1_500, color: "#22c55e",
  },
  {
    id: "d_spin_doctor", category: "daily", icon: "🎡",
    name: "Spin Doctor", desc: "Spin the Roulette wheel 3 times",
    total: 3, reward: 1_200, color: "#f97316",
  },
  {
    id: "d_big_bettor", category: "daily", icon: "💰",
    name: "Big Bettor", desc: "Place a single bet over $100",
    total: 1, reward: 1_000, color: "#f5c518",
  },
  {
    id: "d_lucky_streak", category: "daily", icon: "⚡",
    name: "Lucky Streak", desc: "Win 3 consecutive hands",
    total: 3, reward: 2_500, rewardPoints: 75, color: "#eab308",
  },
  {
    id: "d_quick_gambler", category: "daily", icon: "🎲",
    name: "Quick Gambler", desc: "Play 10 rounds of any game",
    total: 10, reward: 1_000, color: "#6366f1",
  },
  {
    id: "d_case_opener", category: "daily", icon: "📦",
    name: "Case Opener", desc: "Open 1 case",
    total: 1, reward: 2_000, rewardPoints: 50, color: "#8b5cf6",
  },
  {
    id: "d_whale_bet", category: "daily", icon: "🐋",
    name: "Whale Bet", desc: "Wager over $500 in a single bet",
    total: 1, reward: 3_000, rewardPoints: 100, color: "#14b8a6",
  },
  {
    id: "d_roulette_winner", category: "daily", icon: "🔴",
    name: "Roulette Winner", desc: "Win 2 Roulette spins",
    total: 2, reward: 2_500, rewardPoints: 75, color: "#ef4444",
  },
];

export const WEEKLY_POOL: ChallengeDefinition[] = [
  {
    id: "w_tourney", category: "weekly", icon: "🏆",
    name: "Tournament Regular", desc: "Enter 3 tournaments this week",
    total: 3, reward: 7_500, rewardPoints: 350, color: "#a855f7",
  },
  {
    id: "w_mini_marathon", category: "weekly", icon: "🎰",
    name: "Mini Game Marathon", desc: "Play 20 rounds of any mini game",
    total: 20, reward: 5_000, rewardPoints: 250, color: "#ec4899",
  },
  {
    id: "w_social", category: "weekly", icon: "🤝",
    name: "Social Butterfly", desc: "Play at full tables 5 times",
    total: 5, reward: 6_000, rewardPoints: 300, color: "#06b6d4",
  },
  {
    id: "w_high_roller", category: "weekly", icon: "🃏",
    name: "Blackjack Devotee", desc: "Play 50 rounds of Blackjack this week",
    total: 50, reward: 7_000, rewardPoints: 400, color: "#22c55e",
  },
  {
    id: "w_case_hunter", category: "weekly", icon: "📦",
    name: "Case Hunter", desc: "Open 5 cases this week",
    total: 5, reward: 8_000, rewardPoints: 500, color: "#8b5cf6",
  },
  {
    id: "w_big_winner", category: "weekly", icon: "🏅",
    name: "Big Winner", desc: "Win 20 total bets this week",
    total: 20, reward: 10_000, rewardPoints: 500, color: "#f59e0b",
  },
];

export const MONTHLY_POOL: ChallengeDefinition[] = [
  {
    id: "m_marathon", category: "monthly", icon: "🏃",
    name: "The Long Haul", desc: "Play 500 rounds of any game this month",
    total: 500, reward: 15_000, rewardPoints: 750, color: "#f97316",
  },
  {
    id: "m_blackjack_ace", category: "monthly", icon: "🃏",
    name: "Blackjack Ace", desc: "Win 50 Blackjack hands this month",
    total: 50, reward: 12_000, rewardPoints: 800, color: "#22c55e",
  },
  {
    id: "m_fortune_seeker", category: "monthly", icon: "🎡",
    name: "Fortune Seeker", desc: "Win 30 Roulette spins this month",
    total: 30, reward: 10_000, rewardPoints: 750, color: "#ef4444",
  },
  {
    id: "m_case_connoisseur", category: "monthly", icon: "🎁",
    name: "Case Connoisseur", desc: "Open 10 cases this month",
    total: 10, reward: 18_000, rewardPoints: 1_200, color: "#a855f7",
  },
  {
    id: "m_big_spender", category: "monthly", icon: "💎",
    name: "High Roller Month", desc: "Wager 100,000 chips total this month",
    total: 100000, reward: 25_000, rewardPoints: 1_500, color: "#f59e0b",
  },
  {
    id: "m_winner", category: "monthly", icon: "🏆",
    name: "Unstoppable", desc: "Win 100 total bets this month",
    total: 100, reward: 22_000, rewardPoints: 1_200, color: "#7dd3fc",
  },
];

export const SPECIAL_CHALLENGES: ChallengeDefinition[] = [
  {
    id: "s_diamond_run", category: "special", icon: "👑",
    name: "The Diamond Run", desc: "Win 10 consecutive bets — legendary streak",
    total: 10, reward: 50_000, rewardPoints: 3_000, color: "#7dd3fc", limited: true,
  },
  {
    id: "s_on_fire", category: "special", icon: "🔥",
    name: "On Fire", desc: "Win $1,000 in a single session",
    total: 1000, reward: 25_000, rewardPoints: 2_000, color: "#f97316", limited: true,
  },
];

// ── All definitions in one flat list (for lookup by ID) ───────────────────────
export const ALL_CHALLENGE_DEFS: ChallengeDefinition[] = [
  ...DAILY_POOL,
  ...WEEKLY_POOL,
  ...MONTHLY_POOL,
  ...SPECIAL_CHALLENGES,
];

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function isoWeek(): string {
  const d = new Date();
  // ISO week: Monday-based, week 1 contains Jan 4
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfWeek = jan4.getDay() === 0 ? 7 : jan4.getDay(); // Mon=1..Sun=7
  const weekStart = new Date(jan4.getTime() - (dayOfWeek - 1) * 86_400_000);
  const diff = Math.floor((d.getTime() - weekStart.getTime()) / (7 * 86_400_000));
  const weekNum = diff + 1;
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function isoMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// ── Pool selection ────────────────────────────────────────────────────────────

function pickFromPool(
  pool: ChallengeDefinition[],
  count: number,
  prevIds: string[],
): string[] {
  const enabled = pool.filter(c => c.enabled !== false);
  // Prefer challenges not seen in the previous rotation
  const fresh    = enabled.filter(c => !prevIds.includes(c.id));
  const source   = fresh.length >= count ? fresh : enabled;
  // Fisher-Yates shuffle then take first N
  const arr = [...source];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length)).map(c => c.id);
}

// ── Seed data (used on first boot) ───────────────────────────────────────────

const INITIAL_DAILY_IDS   = ["d_high_roller",   "d_spin_doctor",   "d_big_bettor"];
const INITIAL_WEEKLY_IDS  = ["w_tourney",        "w_mini_marathon", "w_social"];
const INITIAL_MONTHLY_IDS = ["m_marathon",       "m_fortune_seeker","m_case_connoisseur"];

// ── Default / reset state ─────────────────────────────────────────────────────

function defaultState(playerId: number | null = null): StoredState {
  return {
    version: 4,
    playerId,
    lastDailyReset:   isoDate(),
    lastWeeklyReset:  isoWeek(),
    lastMonthlyReset: isoMonth(),
    activeDailyIds:   [...INITIAL_DAILY_IDS],
    activeWeeklyIds:  [...INITIAL_WEEKLY_IDS],
    activeMonthlyIds: [...INITIAL_MONTHLY_IDS],
    prevDailyIds:     [],
    prevWeeklyIds:    [],
    prevMonthlyIds:   [],
    progress:         {},
    claimed:          [],
    consecutiveWins:  0,
    sessionProfit:    0,
  };
}

// ── Persistence ───────────────────────────────────────────────────────────────

function load(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw) as Partial<StoredState>;
    // Version guard — if schema mismatch, start fresh
    if ((p as any).version !== 4) return defaultState(p.playerId ?? null);
    return {
      version:         4,
      playerId:        p.playerId ?? null,
      lastDailyReset:  p.lastDailyReset   ?? isoDate(),
      lastWeeklyReset: p.lastWeeklyReset  ?? isoWeek(),
      lastMonthlyReset:p.lastMonthlyReset ?? isoMonth(),
      activeDailyIds:  Array.isArray(p.activeDailyIds)   ? p.activeDailyIds   : [...INITIAL_DAILY_IDS],
      activeWeeklyIds: Array.isArray(p.activeWeeklyIds)  ? p.activeWeeklyIds  : [...INITIAL_WEEKLY_IDS],
      activeMonthlyIds:Array.isArray(p.activeMonthlyIds) ? p.activeMonthlyIds : [...INITIAL_MONTHLY_IDS],
      prevDailyIds:    Array.isArray(p.prevDailyIds)     ? p.prevDailyIds     : [],
      prevWeeklyIds:   Array.isArray(p.prevWeeklyIds)    ? p.prevWeeklyIds    : [],
      prevMonthlyIds:  Array.isArray(p.prevMonthlyIds)   ? p.prevMonthlyIds   : [],
      progress:        (typeof p.progress === "object" && p.progress) ? p.progress : {},
      claimed:         Array.isArray(p.claimed)           ? p.claimed          : [],
      consecutiveWins: typeof p.consecutiveWins === "number" ? p.consecutiveWins : 0,
      sessionProfit:   typeof p.sessionProfit   === "number" ? p.sessionProfit   : 0,
    };
  } catch {
    return defaultState();
  }
}

function save(state: StoredState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// ── Rotation / reset logic ────────────────────────────────────────────────────

function applyRotations(state: StoredState): StoredState {
  const today = isoDate();
  const week  = isoWeek();
  const month = isoMonth();
  let dirty   = false;

  // ── Daily rotation ──────────────────────────────────────────────────────────
  if (state.lastDailyReset !== today) {
    const prev = [...state.activeDailyIds];
    const next = pickFromPool(DAILY_POOL, 3, prev);
    // Clear progress + claimed for outgoing + incoming daily IDs
    const allDailyIds = DAILY_POOL.map(c => c.id);
    for (const id of allDailyIds) { delete state.progress[id]; }
    state.claimed = state.claimed.filter(id => !allDailyIds.includes(id));
    state.activeDailyIds = next;
    state.prevDailyIds   = prev;
    state.lastDailyReset = today;
    dirty = true;
  }

  // ── Weekly rotation ─────────────────────────────────────────────────────────
  if (state.lastWeeklyReset !== week) {
    const prev = [...state.activeWeeklyIds];
    const next = pickFromPool(WEEKLY_POOL, 3, prev);
    const allWeeklyIds = WEEKLY_POOL.map(c => c.id);
    for (const id of allWeeklyIds) { delete state.progress[id]; }
    state.claimed = state.claimed.filter(id => !allWeeklyIds.includes(id));
    state.activeWeeklyIds = next;
    state.prevWeeklyIds   = prev;
    state.lastWeeklyReset = week;
    dirty = true;
  }

  // ── Monthly rotation ────────────────────────────────────────────────────────
  if (state.lastMonthlyReset !== month) {
    const prev = [...state.activeMonthlyIds];
    const next = pickFromPool(MONTHLY_POOL, 3, prev);
    const allMonthlyIds = MONTHLY_POOL.map(c => c.id);
    for (const id of allMonthlyIds) { delete state.progress[id]; }
    state.claimed = state.claimed.filter(id => !allMonthlyIds.includes(id));
    state.activeMonthlyIds = next;
    state.prevMonthlyIds   = prev;
    state.lastMonthlyReset = month;
    dirty = true;
  }

  if (dirty) save(state);
  return state;
}

// ── Emit helper ───────────────────────────────────────────────────────────────

function emit(): void {
  window.dispatchEvent(new Event(CHALLENGES_EVENT));
}

// ── Lookup helper ─────────────────────────────────────────────────────────────

function defById(id: string): ChallengeDefinition | undefined {
  return ALL_CHALLENGE_DEFS.find(c => c.id === id);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns current active challenges with live progress/claimed state. */
export function getChallengeStates(playerId?: number | null): (ChallengeDefinition & ChallengeState)[] {
  let state = load();

  // If a different player logs in, reset to fresh state for them
  if (playerId !== undefined && playerId !== null && state.playerId !== playerId) {
    state = defaultState(playerId);
    save(state);
  }

  state = applyRotations(state);

  const toResult = (ids: string[]) =>
    ids
      .map(id => defById(id))
      .filter((d): d is ChallengeDefinition => !!d)
      .map(def => {
        const progress  = state.progress[def.id] ?? 0;
        const completed = progress >= def.total;
        const claimed   = state.claimed.includes(def.id);
        return { ...def, progress, completed, claimed };
      });

  return [
    ...toResult(state.activeDailyIds),
    ...toResult(state.activeWeeklyIds),
    ...toResult(state.activeMonthlyIds),
    ...toResult(SPECIAL_CHALLENGES.map(c => c.id)),
  ];
}

/** Increment a challenge's progress by `by` (default 1). No-ops if already complete. */
export function incrementProgress(id: string, by = 1): void {
  const state = load();
  const def = defById(id);
  if (!def) return;

  // Only update if the challenge is currently active
  const allActive = [
    ...state.activeDailyIds,
    ...state.activeWeeklyIds,
    ...state.activeMonthlyIds,
    ...SPECIAL_CHALLENGES.map(c => c.id),
  ];
  if (!allActive.includes(id)) return;

  const cur = state.progress[id] ?? 0;
  if (cur >= def.total) return;
  state.progress[id] = Math.min(def.total, cur + by);
  save(state);
  emit();
}

/** Directly set a challenge's progress value (used for streak / profit tracking). */
export function setProgress(id: string, value: number): void {
  const state = load();
  const def = defById(id);
  if (!def) return;
  state.progress[id] = Math.min(def.total, Math.max(0, value));
  save(state);
  emit();
}

/** Mark a challenge as claimed (prevents double-claim client-side). */
export function markClaimed(id: string): void {
  const state = load();
  if (!state.claimed.includes(id)) {
    state.claimed.push(id);
    save(state);
    emit();
  }
}

/**
 * Record a bet outcome for consecutive-win challenges.
 * Updates: s_diamond_run (special) and d_lucky_streak (daily, if active).
 */
export function recordConsecutiveWin(won: boolean): void {
  const state = load();
  if (won) {
    state.consecutiveWins = (state.consecutiveWins ?? 0) + 1;
    const wins = state.consecutiveWins;

    // Special: Diamond Run — never resets on loss (track peak)
    const dr = state.progress["s_diamond_run"] ?? 0;
    if (wins > dr) state.progress["s_diamond_run"] = Math.min(10, wins);

    // Daily: Lucky Streak — resets on loss (true consecutive)
    if (state.activeDailyIds.includes("d_lucky_streak")) {
      state.progress["d_lucky_streak"] = Math.min(3, wins);
    }

    // Monthly: Unstoppable (cumulative wins, not consecutive)
    if (state.activeMonthlyIds.includes("m_winner")) {
      const cur = state.progress["m_winner"] ?? 0;
      if (cur < 100) state.progress["m_winner"] = Math.min(100, cur + 1);
    }

    // Weekly: Big Winner (cumulative wins, not consecutive)
    if (state.activeWeeklyIds.includes("w_big_winner")) {
      const cur = state.progress["w_big_winner"] ?? 0;
      if (cur < 20) state.progress["w_big_winner"] = Math.min(20, cur + 1);
    }
  } else {
    state.consecutiveWins = 0;
    // Lucky Streak daily resets on any loss
    if (state.activeDailyIds.includes("d_lucky_streak")) {
      const prog = state.progress["d_lucky_streak"] ?? 0;
      if (prog < 3) state.progress["d_lucky_streak"] = 0; // only reset if not yet complete
    }
  }
  save(state);
  emit();
}

/** Update session profit for the "On Fire" special challenge. */
export function recordSessionProfit(profit: number): void {
  const state = load();
  state.sessionProfit = profit;
  state.progress["s_on_fire"] = Math.min(1000, Math.max(0, profit));
  save(state);
  emit();
}

/** Increment wagered amount for monthly big-spender challenge. */
export function recordWager(amount: number): void {
  const state = load();
  if (state.activeMonthlyIds.includes("m_big_spender")) {
    const cur = state.progress["m_big_spender"] ?? 0;
    if (cur < 100_000) {
      state.progress["m_big_spender"] = Math.min(100_000, cur + amount);
      save(state);
      emit();
    }
  }
}
