import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";

const bingoRooms: CatalogGame[] = [
  {
    id: "classic",
    name: "Classic Bingo",
    description: "Standard 90-ball bingo. First to a full house wins the jackpot.",
    gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)",
    neonClass: "neon-green",
    neonColor: "#22c55e",
    players: "4 waiting",
    betRange: "$1 – $10 / card",
    actionLabel: "Join Room",
    statusLabel: "FILLING",
    statusColor: "#22c55e",
  },
  {
    id: "speed",
    name: "Speed Bingo",
    description: "Faster calls, higher energy. Games complete in under 3 minutes.",
    gradient: "linear-gradient(135deg, #1a0800 0%, #2e1200 60%, #4a1e00 100%)",
    neonClass: "neon-orange",
    neonColor: "#f97316",
    badge: "FAST",
    badgeColor: "#e8400a",
    players: "7 playing",
    betRange: "$2 – $20 / card",
    actionLabel: "Join Room",
    statusLabel: "LIVE",
    statusColor: "#22c55e",
  },
  {
    id: "75ball",
    name: "75-Ball Bingo",
    description: "American-style bingo on a 5×5 card. More patterns, more ways to win.",
    gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)",
    neonClass: "neon-blue",
    neonColor: "#06b6d4",
    players: "12 playing",
    betRange: "$0.50 – $5 / card",
    actionLabel: "Join Room",
    statusLabel: "LIVE",
    statusColor: "#22c55e",
  },
  {
    id: "pattern",
    name: "Pattern Bingo",
    description: "Match special patterns on your card for bonus prizes and multipliers.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink",
    neonColor: "#ec4899",
    players: "2 waiting",
    betRange: "$3 – $25 / card",
    actionLabel: "Join Room",
    statusLabel: "OPEN",
    statusColor: "#06b6d4",
  },
];

export function BingoPage() {
  return (
    <PageWrapper title="Bingo" breadcrumb="Events / Bingo" accentColor="#22c55e">
      <CardGrid>
        {bingoRooms.map((r, i) => (
          <CatalogCard key={r.id} game={r} delay={`${-i}s`} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
