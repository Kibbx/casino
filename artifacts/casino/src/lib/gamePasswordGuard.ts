import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// New key prefix — completely separate from the old game_token_* keys so no
// stale values from previous code versions can interfere.
const KEY = (game: string) => `bab_v2_${game}`;

// Sentinel used when a game has no password at all
const OPEN = "open";

function inPreview(): boolean {
  return typeof window !== "undefined" &&
    window.location.pathname.includes("/page-preview/");
}

// ── Storage helpers ────────────────────────────────────────────────────────────

export function getAccessToken(game: string): string | null {
  try { return sessionStorage.getItem(KEY(game)); } catch { return null; }
}

export function setAccessToken(game: string, token: string): void {
  try { sessionStorage.setItem(KEY(game), token); } catch {}
}

export function clearAccessToken(game: string): void {
  try { sessionStorage.removeItem(KEY(game)); } catch {}
}

// ── isGameUnlocked ─────────────────────────────────────────────────────────────
// Returns true if the player is allowed to be on this game's page.
// A token of "open" means the game has no password and anyone can enter.
// Any other non-null value is a server-issued UUID verified via the modal.

export function isGameUnlocked(game: string): boolean {
  if (inPreview()) return true;
  return getAccessToken(game) !== null;
}

// ── usePasswordGuard ──────────────────────────────────────────────────────────
// Polls every 10 s to detect if the password was changed while the player is
// inside the game. If the server token no longer matches what was stored on
// entry, the player is sent back to the lobby immediately.

export function usePasswordGuard(
  game: "blackjack" | "slots" | "roulette" | "crash" | "horseRacing" | "mines" | "keno" | "highlow",
): void {
  const [, setLocation] = useLocation();
  const kickedRef = useRef(false);

  useEffect(() => {
    if (inPreview()) return;

    // Capture the token that was stored when this player entered the game.
    const entryToken = getAccessToken(game);

    async function check() {
      if (kickedRef.current) return;
      try {
        const r = await fetch(`${BASE}/api/game-password-tokens`);
        if (!r.ok) return;
        const tokens: Record<string, string | null> = await r.json();
        const serverToken = tokens[game] || null;

        // If the game has a password and it differs from what the player
        // used to enter, kick them back to the lobby.
        if (serverToken && serverToken !== entryToken) {
          kickedRef.current = true;
          clearAccessToken(game);
          setLocation("/lobby");
        }
      } catch { /* network error — try again next interval */ }
    }

    const iv = setInterval(check, 10_000);
    check(); // also run immediately on mount
    return () => clearInterval(iv);
  }, [game]);
}
