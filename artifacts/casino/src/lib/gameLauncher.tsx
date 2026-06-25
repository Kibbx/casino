import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { KeyRound } from "lucide-react";
import { getAccessToken, setAccessToken } from "./gamePasswordGuard";
import { Button, Input } from "../components/ui-elements";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

/**
 * A single game definition used by every gated launch point (section-page cards,
 * Live Activity, Recently Played).
 *
 *  - `key`     storage / guard key — MUST match the game page's usePasswordGuard(key)
 *              and the server's /game-password-tokens map.
 *  - `apiPath` segment of the verify-password endpoint: /api/{apiPath}/verify-password.
 *              Kept separate from `key` because some games store under a different
 *              key than their API path (e.g. High-Low key "highlow" → /api/high-low,
 *              Horse key "horseRacing" → /api/horse).
 *  - `direct`  games that own their lobby (Poker, Tournaments, Mob Tower)
 *              navigate immediately without password gating.
 */
export interface GameDef {
  label: string;
  cat: string;
  img: string;
  route: string;
  key: string;
  apiPath: string;
  neon: string;
  direct?: boolean;
}

export const GAMES: Record<string, GameDef> = {
  blackjack:  { label: "Blackjack",     cat: "TABLE GAMES", img: `${IMGS}images/card-blackjack.webp`,        route: "/blackjack",      key: "blackjack",   apiPath: "blackjack", neon: "neon-green"  },
  roulette:   { label: "Roulette",      cat: "TABLE GAMES", img: `${IMGS}images/card-roulette.webp`,         route: "/roulette",       key: "roulette",    apiPath: "roulette",  neon: "neon-red"    },
  baccarat:   { label: "Baccarat",      cat: "TABLE GAMES", img: `${IMGS}images/card-baccarat.webp`,         route: "/baccarat",       key: "baccarat",    apiPath: "baccarat",  neon: "neon-teal"   },
  highlow:    { label: "High-Low",      cat: "TABLE GAMES", img: "",                                          route: "/high-low",       key: "highlow",     apiPath: "high-low",  neon: "neon-pink"   },
  slots:      { label: "Slot Machines", cat: "MINI GAMES",  img: `${IMGS}images/card-backalley-slots.webp`,  route: "/slots-hub",      key: "slots",       apiPath: "slots",     neon: "neon-yellow" },
  mines:      { label: "Mines",         cat: "MINI GAMES",  img: `${IMGS}images/card-mines.webp`,            route: "/mines",          key: "mines",       apiPath: "mines",     neon: "neon-red"    },
  keno:       { label: "Keno",          cat: "MINI GAMES",  img: "",                                          route: "/keno",           key: "keno",        apiPath: "keno",      neon: "neon-blue"   },
  cases:      { label: "Case Opening",  cat: "MINI GAMES",  img: `${IMGS}images/card-cases.webp`,            route: "/cases",          key: "cases",       apiPath: "cases",     neon: "neon-orange" },
  mobtower:   { label: "Mob Tower",     cat: "MINI GAMES",  img: `${IMGS}images/card-mob-tower.png`,         route: "/mob-tower",      key: "mobtower",    apiPath: "mob-tower", neon: "neon-pink",  direct: true },
  horse:      { label: "Horse Racing",  cat: "LIVE EVENTS", img: `${IMGS}images/card-horseracing.webp`,      route: "/horse-racing",   key: "horseRacing", apiPath: "horse",     neon: "neon-orange" },
  poker:      { label: "Poker",         cat: "TABLE GAMES", img: `${IMGS}images/card-poker.webp`,            route: "/poker",          key: "poker",       apiPath: "poker",     neon: "neon-red",   direct: true },
  tournaments:{ label: "Tournaments",   cat: "EVENTS",      img: `${IMGS}images/card-tournaments.webp`,      route: "/tournaments",    key: "tournaments", apiPath: "tournaments", neon: "neon-yellow", direct: true },
  bingo:      { label: "Bingo",         cat: "EVENTS",      img: "",                                          route: "/bingo",          key: "bingo",       apiPath: "bingo",     neon: "neon-purple", direct: true },
  lottery:    { label: "Lottery",       cat: "EVENTS",      img: "",                                          route: "/lottery",        key: "lottery",     apiPath: "lottery",   neon: "neon-green",  direct: true },
};

function GamePasswordModal({
  apiPath, storageKey, label, onSuccess, onCancel,
}: {
  apiPath: string; storageKey: string; label: string; onSuccess: () => void; onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setError("Please enter the room password"); return; }
    setLoading(true); setError("");
    try {
      const r = await fetch(`${BASE}/api/${apiPath}/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Incorrect password"); setLoading(false); return; }
      setAccessToken(storageKey, d.token ?? "open");
      onSuccess();
    } catch {
      setError("Could not verify password"); setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 px-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display font-bold text-foreground">Room Password</h2>
            <p className="text-xs text-muted-foreground">{label} requires a code</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            placeholder="Enter room password"
            autoFocus
            autoComplete="off"
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" isLoading={loading} className="flex-1">Enter Room</Button>
            <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

/**
 * The one gated launcher. `enter(game, hasPassword?)`:
 *  - direct games  → navigate immediately.
 *  - hasPassword known (section pages pass it from the live status endpoint):
 *      false → store "open" sentinel + navigate.
 *      true  → navigate if a valid (non-"open") token is already stored, else open modal.
 *  - hasPassword unknown (lobby cards): query the server's live token map to decide —
 *      never assume "open" when status is unknown.
 */
export function useGameLauncher() {
  const [, setLocation] = useLocation();
  const [modal, setModal] = useState<{ apiPath: string; storageKey: string; label: string; onSuccess: () => void } | null>(null);

  function gate(game: GameDef, hasPassword: boolean) {
    if (!hasPassword) { setAccessToken(game.key, "open"); setLocation(game.route); return; }
    const stored = getAccessToken(game.key);
    if (stored !== null && stored !== "open") { setLocation(game.route); return; }
    setModal({
      apiPath: game.apiPath,
      storageKey: game.key,
      label: game.label,
      onSuccess: () => { setLocation(game.route); setModal(null); },
    });
  }

  async function enter(game: GameDef, hasPassword?: boolean) {
    if (game.direct) { setLocation(game.route); return; }
    if (hasPassword !== undefined) { gate(game, hasPassword); return; }
    // Unknown status (lobby launch): consult the live token map. A non-null entry
    // means the game currently has a password. On error, fall through to the modal
    // rather than assuming the game is open.
    let pw = true;
    try {
      const r = await fetch(`${BASE}/api/game-password-tokens`);
      if (r.ok) {
        const tokens: Record<string, string | null> = await r.json();
        pw = !!tokens[game.key];
      }
    } catch { /* keep pw = true → modal */ }
    gate(game, pw);
  }

  return { enter, modalNode: modal ? (
    <GamePasswordModal
      apiPath={modal.apiPath}
      storageKey={modal.storageKey}
      label={modal.label}
      onSuccess={modal.onSuccess}
      onCancel={() => setModal(null)}
    />
  ) : null };
}
