import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { bingoData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";

export function BingoPage() {
  const [, setLocation] = useLocation();
  return (
    <PageWrapper title="Bingo" breadcrumb="Events / Bingo" accentColor="#22c55e">
      <CardGrid>
        {bingoData.map((r, i) => (
          <CatalogCard key={r.id} game={r} delay={`${-i}s`} onClick={() => {
            addRecentlyPlayed({ id: r.id, game: r, route: r.route, tokenId: r.tokenId });
            trackRecentGame(r.lobbyKey ?? r.id, r.name);
            if (r.tokenId) setAccessToken(r.tokenId, "open");
            setLocation(r.route);
          }} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
