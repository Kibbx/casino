import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { miniGamesData } from "../lib/gamesData";
import { trackRecentGame } from "../lib/recentGames";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";
import { useGamesMeta, formatBetRange } from "../lib/useGamesMeta";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";

export function MiniGamesPage() {
  const [, setLocation] = useLocation();
  const { meta, loading } = useGamesMeta();
  const { enter, modalNode } = useGameLauncher();

  return (
    <PageWrapper title="Mini Games" breadcrumb="Casino / Mini Games" accentColor="#ec4899">
      {modalNode}
      <CardGrid>
        {miniGamesData.map((g, i) => {
          const live = meta[g.id];
          const closed = live?.status === "closed";
          const isLoading = loading && !live;
          const game = {
            ...g,
            players: isLoading ? "…" : live ? `${live.currentPlayers} playing` : g.players,
            betRange: isLoading ? undefined : live ? formatBetRange(live.minBet, live.maxBet) : g.betRange,
            disabled: closed,
            hasPassword: live?.hasPassword ?? false,
            statusLabel: closed ? "CLOSED" : g.statusLabel,
            statusColor: closed ? "#ef4444" : g.statusColor,
          };
          return (
            <CatalogCard key={g.id} game={game} delay={`${-i}s`} onClick={() => {
              if (closed) return;
              addRecentlyPlayed({ id: g.id, game: g, route: g.route, tokenId: g.tokenId });
              trackRecentGame(g.lobbyKey ?? g.id, g.name);
              const def = GAMES[g.id];
              if (def) {
                // Pass undefined when meta hasn't loaded yet so enter() safely
                // queries /api/game-password-tokens instead of assuming no password.
                enter(def, live !== undefined ? live.hasPassword : undefined);
              } else {
                console.warn(`[launcher] mini-games: ${g.id} has no GAMES entry — navigating without password gate`);
                setLocation(g.route);
              }
            }} />
          );
        })}
      </CardGrid>
    </PageWrapper>
  );
}
