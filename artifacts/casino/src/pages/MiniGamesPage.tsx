import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";

const miniGames: CatalogGame[] = [
  {
    id: "mines",
    name: "Mines",
    description: "Uncover gems while dodging hidden mines. Cash out before it's too late.",
    gradient: "linear-gradient(135deg, #0a1a10 0%, #122a18 60%, #1a4024 100%)",
    neonClass: "neon-green",
    neonColor: "#39ff14",
    badge: "POPULAR",
    badgeColor: "#e8400a",
    players: "Solo",
    betRange: "$0.10 – $500",
    actionLabel: "Play Now",
    statusLabel: "OPEN",
    statusColor: "#22c55e",
  },
  {
    id: "keno",
    name: "Keno",
    description: "Pick your lucky numbers and watch the draw. The more you match, the more you win.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink",
    neonColor: "#ec4899",
    players: "Multiplayer",
    betRange: "$1 – $200",
    actionLabel: "Play Now",
    statusLabel: "LIVE DRAW",
    statusColor: "#ec4899",
  },
  {
    id: "mob-tower",
    name: "Mob Tower",
    description: "Climb the tower, dodge the mobsters. Each floor multiplies your bet.",
    gradient: "linear-gradient(135deg, #1a0800 0%, #2e1200 60%, #4a1e00 100%)",
    neonClass: "neon-orange",
    neonColor: "#f97316",
    badge: "NEW",
    badgeColor: "#7c3aed",
    players: "Solo",
    betRange: "$0.50 – $1,000",
    actionLabel: "Start Climb",
    statusLabel: "OPEN",
    statusColor: "#f97316",
  },
  {
    id: "case-opening",
    name: "Case Opening",
    description: "Open cases to reveal rare items and exclusive collectibles.",
    gradient: "linear-gradient(135deg, #001525 0%, #002035 60%, #003055 100%)",
    neonClass: "neon-blue",
    neonColor: "#06b6d4",
    players: "Solo",
    betRange: "$2 – $50",
    actionLabel: "Open Case",
    statusLabel: "OPEN",
    statusColor: "#06b6d4",
  },
];

const ROUTES: Record<string, { token?: string; path: string }> = {
  "mines":        { token: "mines",  path: "/mines"     },
  "keno":         { token: "keno",   path: "/keno"      },
  "mob-tower":    {                  path: "/mob-tower" },
  "case-opening": {                  path: "/cases"     },
};

export function MiniGamesPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Mini Games" breadcrumb="Casino / Mini Games" accentColor="#ec4899">
      <CardGrid>
        {miniGames.map((g, i) => {
          const { token, path } = ROUTES[g.id] ?? { path: "/lobby" };
          return (
            <CatalogCard key={g.id} game={g} delay={`${-i}s`} onClick={() => {
              if (token) setAccessToken(token, "open");
              setLocation(path);
            }} />
          );
        })}
      </CardGrid>
    </PageWrapper>
  );
}
