export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

export interface RarityDef {
  key: Rarity;
  label: string;
  color: string;
  bg: string;
  border: string;
  glow: string | null;
  autoEffect: "none" | "outline" | "glow";
  hasTrail: boolean;
  hasParticles: boolean;
  statBonus: number;
}

export const RARITIES: RarityDef[] = [
  {
    key: "common",
    label: "Common",
    color: "#9ca3af",
    bg: "#1f2937",
    border: "#374151",
    glow: null,
    autoEffect: "none",
    hasTrail: false,
    hasParticles: false,
    statBonus: 0,
  },
  {
    key: "uncommon",
    label: "Uncommon",
    color: "#4ade80",
    bg: "#14532d",
    border: "#166534",
    glow: "#4ade8066",
    autoEffect: "outline",
    hasTrail: false,
    hasParticles: false,
    statBonus: 5,
  },
  {
    key: "rare",
    label: "Rare",
    color: "#60a5fa",
    bg: "#1e3a8a",
    border: "#2563eb",
    glow: "#60a5fa88",
    autoEffect: "glow",
    hasTrail: false,
    hasParticles: false,
    statBonus: 10,
  },
  {
    key: "epic",
    label: "Epic",
    color: "#c084fc",
    bg: "#3b0764",
    border: "#7c3aed",
    glow: "#c084fc88",
    autoEffect: "glow",
    hasTrail: true,
    hasParticles: false,
    statBonus: 20,
  },
  {
    key: "legendary",
    label: "Legendary",
    color: "#fbbf24",
    bg: "#451a03",
    border: "#d97706",
    glow: "#fbbf2488",
    autoEffect: "glow",
    hasTrail: true,
    hasParticles: true,
    statBonus: 35,
  },
];

export function getRarity(key: string): RarityDef {
  return RARITIES.find((r) => r.key === key) ?? RARITIES[0];
}

export const RARITY_KEYS = RARITIES.map((r) => r.key);
