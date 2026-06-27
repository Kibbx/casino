const STORAGE_KEY = "bab_rewards";
const REWARDS_EVENT = "bab:rewards:update";

export interface RewardsState {
  xp: number;
  tier: string;
  points: number;
  claimed: number[];
}

export const TIERS = [
  { name: "Bronze",   minXP: 0,     color: "#cd7f32", icon: "🥉" },
  { name: "Silver",   minXP: 5000,  color: "#9ca3af", icon: "🥈" },
  { name: "Gold",     minXP: 15000, color: "#f5c518", icon: "🥇" },
  { name: "Platinum", minXP: 40000, color: "#e2e8f0", icon: "💎" },
  { name: "Diamond",  minXP: 100000, color: "#7dd3fc", icon: "👑" },
];

const DEFAULT_STATE: RewardsState = {
  xp: 0,
  tier: "Bronze",
  points: 0,
  claimed: [],
};

function computeTier(xp: number): string {
  let name = TIERS[0].name;
  for (const t of TIERS) {
    if (xp >= t.minXP) name = t.name;
    else break;
  }
  return name;
}

function load(): RewardsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const p = JSON.parse(raw);
    const xp = typeof p.xp === "number" ? p.xp : DEFAULT_STATE.xp;
    return {
      xp,
      tier:    computeTier(xp),
      points:  typeof p.points === "number" ? p.points : DEFAULT_STATE.points,
      claimed: Array.isArray(p.claimed)     ? p.claimed : [],
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persist(state: RewardsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent(REWARDS_EVENT, { detail: state }));
}

export function getRewardsState(): RewardsState {
  return load();
}

export function awardXP(betAmount: number): void {
  const xp     = Math.floor(betAmount * 0.003);
  const points = Math.floor(betAmount * 0.001);
  if (xp <= 0) return;
  const s = load();
  const newXP = s.xp + xp;
  persist({ ...s, xp: newXP, tier: computeTier(newXP), points: s.points + points });
}

export function claimReward(id: number, cost: number): boolean {
  const s = load();
  if (s.claimed.includes(id) || s.points < cost) return false;
  persist({ ...s, points: s.points - cost, claimed: [...s.claimed, id] });
  return true;
}

export function subscribeRewards(cb: (s: RewardsState) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<RewardsState>).detail);
  window.addEventListener(REWARDS_EVENT, h);
  return () => window.removeEventListener(REWARDS_EVENT, h);
}
