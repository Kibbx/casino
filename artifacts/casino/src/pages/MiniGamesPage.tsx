import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { miniGamesData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";

export function MiniGamesPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Mini Games" breadcrumb="Casino / Mini Games" accentColor="#ec4899">
      <CardGrid>
        {miniGamesData.map((g, i) => (
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
