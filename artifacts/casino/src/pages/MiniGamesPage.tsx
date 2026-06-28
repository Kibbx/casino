import { useLocation } from "wouter";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { miniGamesData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";
import { useGamesMeta, formatBetRange } from "../lib/useGamesMeta";

const LIVE_IDS = new Set(["mines", "keno", "mob-tower"]);

export function MiniGamesPage() {
  const [, setLocation] = useLocation();
  const { meta, loading } = useGamesMeta();

  return (
    <PageWrapper title="Mini Games" breadcrumb="Casino / Mini Games" accentColor="#ec4899">
      <CardGrid>
        {miniGamesData.map((g, i) => {
          const live = LIVE_IDS.has(g.id) ? meta[g.id] : undefined;
          const isLoading = loading && !live;
          const game = {
            ...g,
            players: LIVE_IDS.has(g.id)
              ? isLoading ? "…" : `${live!.currentPlayers} playing`
              : g.players,
            betRange: LIVE_IDS.has(g.id)
              ? isLoading ? undefined : formatBetRange(live!.minBet, live!.maxBet)
              : g.betRange,
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
