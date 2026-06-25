import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";

const pokerTypes: CatalogGame[] = [
  {
    id: "cash",
    name: "Cash Games",
    description: "Sit down, play at your own pace. Leave anytime with your chips.",
    gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)",
    neonClass: "neon-green",
    neonColor: "#22c55e",
    players: "24 active",
    betRange: "$1/$2 – $100/$200",
    actionLabel: "Find a Table",
    statusLabel: "OPEN",
    statusColor: "#22c55e",
  },
  {
    id: "sng",
    name: "Sit & Go",
    description: "Single-table tournaments that start when seats fill. Fast & focused.",
    gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)",
    neonClass: "neon-blue",
    neonColor: "#06b6d4",
    players: "8 registering",
    betRange: "$5 – $100 buy-in",
    actionLabel: "Register",
    statusLabel: "FILLING",
    statusColor: "#06b6d4",
  },
  {
    id: "mtt",
    name: "Multi-Table",
    description: "Big fields, bigger prizes. Compete against hundreds for massive prize pools.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink",
    neonColor: "#a855f7",
    players: "45 registered",
    betRange: "$10 – $200 buy-in",
    actionLabel: "Register",
    statusLabel: "OPEN",
    statusColor: "#a855f7",
  },
  {
    id: "highstakes",
    name: "High Stakes",
    description: "For elite players only. Massive blinds, massive pots, maximum prestige.",
    gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)",
    neonClass: "neon-yellow",
    neonColor: "#f5c518",
    badge: "VIP",
    badgeColor: "#7c3aed",
    players: "3 playing",
    betRange: "$50/$100 – $500/$1K",
    actionLabel: "Request Access",
    statusLabel: "LIVE",
    statusColor: "#f5c518",
  },
];

export function PokerPage() {
  return (
    <PageWrapper title="Poker" breadcrumb="Casino / Poker" accentColor="#22c55e">
      <CardGrid>
        {pokerTypes.map((g, i) => (
          <CatalogCard key={g.id} game={g} delay={`${-i}s`} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
