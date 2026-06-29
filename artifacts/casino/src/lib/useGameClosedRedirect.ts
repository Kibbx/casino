import { useEffect } from "react";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL;

/**
 * Route guard for direct-URL game access.
 *
 * On mount, fetches /api/games once (no polling) and redirects to `redirectTo`
 * if the game's status is "closed". Fails open on network error so a transient
 * failure never locks a player out of an open game.
 *
 * @param gameId     - Key in the /api/games response ("blackjack", "fortuna", etc.)
 * @param redirectTo - Route to navigate to when the game is closed ("/tablegames", etc.)
 */
export function useGameClosedRedirect(gameId: string, redirectTo: string): void {
  const [, setLocation] = useLocation();

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}api/games`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Record<string, { status: string }>) => {
        if (!alive) return;
        const game = data[gameId];
        console.log(`[route-guard] game=${gameId} status=${game?.status ?? "unknown"}`);
        if (game?.status === "closed") {
          console.log(`[route-guard] ${gameId} is closed — redirecting to ${redirectTo}`);
          setLocation(redirectTo);
        }
      })
      .catch(() => {
        console.log(`[route-guard] ${gameId} status check failed — staying (fail-open)`);
      });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
