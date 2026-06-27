const STORAGE_KEY = "bab_rewards";
const REWARDS_EVENT = "bab:rewards:update";

export interface RewardsState {
  xp: number;
  tier: string;
  points: number;
  claimed: number[];
  inventory: string[];
  vipAccessExpiresAt: number | null;
  doubleXpExpiresAt: number | null;
}

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: "already_claimed" | "insufficient_points" };

export const TIERS = [
  { name: "Bronze",   minXP: 0,      color: "#cd7f32", icon: "🥉" },
  { name: "Silver",   minXP: 5000,   color: "#9ca3af", icon: "🥈" },
  { name: "Gold",     minXP: 15000,  color: "#f5c518", icon: "🥇" },
  { name: "Platinum", minXP: 40000,  color: "#e2e8f0", icon: "💎" },
  { name: "Diamond",  minXP: 100000, color: "#7dd3fc", icon: "👑" },
];

const DEFAULT_STATE: RewardsState = {
  xp: 0,
  tier: "Bronze",
  points: 0,
  claimed: [],
  inventory: [],
  vipAccessExpiresAt: null,
  doubleXpExpiresAt: null,
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
      tier:               computeTier(xp),
      points:             typeof p.points             === "number" ? p.points             : DEFAULT_STATE.points,
      claimed:            Array.isArray(p.claimed)                 ? p.claimed             : [],
      inventory:          Array.isArray(p.inventory)               ? p.inventory           : [],
      vipAccessExpiresAt: typeof p.vipAccessExpiresAt === "number" ? p.vipAccessExpiresAt : null,
      doubleXpExpiresAt:  typeof p.doubleXpExpiresAt  === "number" ? p.doubleXpExpiresAt  : null,
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
  const s = load();
  const isDoubleXP = s.doubleXpExpiresAt != null && Date.now() < s.doubleXpExpiresAt;
  const mult   = isDoubleXP ? 2 : 1;
  const xp     = Math.floor(betAmount * 0.003 * mult);
  const points = Math.floor(betAmount * 0.001);
  if (xp <= 0) return;
  const newXP = s.xp + xp;
  persist({ ...s, xp: newXP, tier: computeTier(newXP), points: s.points + points });
}

export function claimReward(id: number, cost: number, currentChips = 0): ClaimResult {
  const s = load();
  if (s.claimed.includes(id)) return { ok: false, reason: "already_claimed" };
  if (s.points < cost)        return { ok: false, reason: "insufficient_points" };

  const next: RewardsState = {
    ...s,
    points:  s.points - cost,
    claimed: [...s.claimed, id],
  };

  switch (id) {
    case 2: {
      const bonus = Math.floor(currentChips * 0.1);
      const prev  = Number(localStorage.getItem("bab_pending_chips_bonus") || 0);
      localStorage.setItem("bab_pending_chips_bonus", String(prev + bonus));
      break;
    }
    case 3:
      next.inventory = [...s.inventory, "lottery_ticket"];
      break;
    case 4:
      next.vipAccessExpiresAt = Date.now() + 60 * 60 * 1000;
      break;
    case 6:
      next.doubleXpExpiresAt = Date.now() + 48 * 60 * 60 * 1000;
      break;
  }

  persist(next);
  return { ok: true };
}

export function subscribeRewards(cb: (s: RewardsState) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<RewardsState>).detail);
  window.addEventListener(REWARDS_EVENT, h);
  return () => window.removeEventListener(REWARDS_EVENT, h);
}
