import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";

const slotGames: CatalogGame[] = [
  {
    id: "fortuna",
    name: "Fortuna",
    description: "Spin the reels of fortune and uncover massive wins in this classic slot.",
    gradient: "linear-gradient(135deg, #0d0020 0%, #1a0035 60%, #280050 100%)",
    neonClass: "neon-purple",
    neonColor: "#a855f7",
    badge: "POPULAR",
    badgeColor: "#e8400a",
    players: "Solo",
    betRange: "$50 – $1,000",
    actionLabel: "Play Now",
    statusLabel: "OPEN",
    statusColor: "#a855f7",
  },
  {
    id: "deadwood-dollars",
    name: "Deadwood Dollars",
    description: "Saddle up for big wins in the wild west with Deadwood Dollars.",
    gradient: "linear-gradient(135deg, #0a1a08 0%, #122810 60%, #1a3a16 100%)",
    neonClass: "neon-green",
    neonColor: "#22c55e",
    badge: "NEW",
    badgeColor: "#7c3aed",
    players: "Solo",
    betRange: "$50 – $1,000",
    actionLabel: "Play Now",
    statusLabel: "OPEN",
    statusColor: "#22c55e",
  },
];

const SLOT_ROUTES: Record<string, string> = {
  "fortuna":          "/rome-slots",
  "deadwood-dollars": "/western-slots",
};

export function SlotsPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Slots" breadcrumb="Casino / Slots" accentColor="#a855f7">
      <CardGrid>
        {slotGames.map((g, i) => (
          <CatalogCard key={g.id} game={g} delay={`${-i}s`} onClick={() => {
            setAccessToken("slots", "open");
            setLocation(SLOT_ROUTES[g.id] ?? "/slots-hub");
          }} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
