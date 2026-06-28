import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { slotsData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";
import { useGamesMeta, formatBetRange } from "../lib/useGamesMeta";

export function SlotsPage() {
  const [, setLocation] = useLocation();
  const { meta, loading } = useGamesMeta();

  return (
    <PageWrapper title="Slots" breadcrumb="Casino / Slots" accentColor="#a855f7">
      <CardGrid>
        {slotsData.map((g, i) => {
          const live = meta[g.id];
          const isLoading = loading && !live;
          const game = {
            ...g,
            players: isLoading ? "…" : live ? `${live.currentPlayers} playing` : g.players,
            betRange: isLoading ? undefined : live ? formatBetRange(live.minBet, live.maxBet) : g.betRange,
          };
          return (
            <CatalogCard key={g.id} game={game} delay={`${-i}s`} onClick={() => {
              addRecentlyPlayed({ id: g.id, game: g, route: g.route, tokenId: g.tokenId });
              trackRecentGame(g.lobbyKey ?? g.id, g.name);
              if (g.tokenId) setAccessToken(g.tokenId, "open");
              setLocation(g.route);
            }} />
          );
        })}
      </CardGrid>
    </PageWrapper>
  );
}
