import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { slotsData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";

export function SlotsPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Slots" breadcrumb="Casino / Slots" accentColor="#a855f7">
      <CardGrid>
        {slotsData.map((g, i) => (
          <CatalogCard key={g.id} game={g} delay={`${-i}s`} onClick={() => {
            trackRecentGame(g.lobbyKey ?? g.id, g.name);
            if (g.tokenId) setAccessToken(g.tokenId, "open");
            setLocation(g.route);
          }} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
