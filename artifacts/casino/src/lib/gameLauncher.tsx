import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { KeyRound } from "lucide-react";
import { getAccessToken, setAccessToken } from "./gamePasswordGuard";

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
  "mob-tower":        { label: "Mob Tower",       cat: "MINI GAMES",  img: `${IMGS}images/card-mob-tower.png`,        route: "/mob-tower",      key: "mobtower",    apiPath: "mob-tower", neon: "neon-pink",   direct: true },
  "fortuna":          { label: "Fortuna Slots",   cat: "SLOTS",       img: `${IMGS}images/card-fortuna.webp`,         route: "/rome-slots",     key: "slots",       apiPath: "slots",     neon: "neon-purple" },
  "deadwood-dollars": { label: "Deadwood Dollars",cat: "SLOTS",       img: `${IMGS}images/card-deadwood.webp`,        route: "/western-slots",  key: "slots",       apiPath: "slots",     neon: "neon-yellow" },
  horse:      { label: "Horse Racing",  cat: "LIVE EVENTS", img: `${IMGS}images/card-horseracing.webp`,      route: "/horse-racing",   key: "horseRacing", apiPath: "horse",     neon: "neon-orange" },
  poker:      { label: "Poker",         cat: "TABLE GAMES", img: `${IMGS}images/card-poker.webp`,            route: "/poker",          key: "poker",       apiPath: "poker",     neon: "neon-red",   direct: true },
  tournaments:{ label: "Tournaments",   cat: "EVENTS",      img: `${IMGS}images/card-tournaments.webp`,      route: "/tournaments-old", key: "tournaments", apiPath: "tournaments", neon: "neon-yellow", direct: true },
  bingo:      { label: "Bingo",         cat: "EVENTS",      img: "",                                          route: "/bingo",          key: "bingo",       apiPath: "bingo",     neon: "neon-purple", direct: true },
  lottery:    { label: "Lottery",       cat: "EVENTS",      img: "",                                          route: "/lottery",        key: "lottery",     apiPath: "lottery",   neon: "neon-green",  direct: true },
};

const NEON_HEX: Record<string, string> = {
  "neon-green":  "#39ff14",
  "neon-red":    "#ef4444",
  "neon-teal":   "#06b6d4",
  "neon-pink":   "#ec4899",
  "neon-blue":   "#3b82f6",
  "neon-yellow": "#fbbf24",
  "neon-orange": "#f97316",
  "neon-purple": "#a855f7",
};

function GamePasswordModal({
  apiPath, storageKey, label, neonColor, onSuccess, onCancel,
}: {
  apiPath: string; storageKey: string; label: string; neonColor: string; onSuccess: () => void; onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setError("Please enter the room password"); return; }
    setLoading(true); setError("");
    console.log(`[launcher] submitting password for /${apiPath}/verify-password`);
    try {
      const r = await fetch(`${BASE}/api/${apiPath}/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (!r.ok) {
        console.log(`[launcher] password verification FAILED for ${apiPath}: ${d.error}`);
        setError(d.error || "Incorrect password"); setLoading(false); return;
      }
      console.log(`[launcher] password verified OK for ${apiPath} — token received=${!!d.token}`);
      setAccessToken(storageKey, d.token ?? "open");
      onSuccess();
    } catch {
      console.log(`[launcher] network error verifying password for ${apiPath}`);
      setError("Could not verify password"); setLoading(false);
    }
  }

  const canSubmit = !loading && !!password.trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 14 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "linear-gradient(160deg, #09090f 0%, #0d0b14 100%)",
          border: `1px solid ${neonColor}40`,
          boxShadow: `0 0 0 1px ${neonColor}0d, 0 0 48px ${neonColor}18, 0 28px 72px rgba(0,0,0,0.7)`,
          borderRadius: 20,
          padding: "28px 28px 24px",
        }}
      >
        {/* Icon + title */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 50, height: 50, borderRadius: 13,
              background: `${neonColor}14`,
              border: `1px solid ${neonColor}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
              boxShadow: `0 0 20px ${neonColor}20`,
            }}
          >
            <KeyRound size={22} style={{ color: neonColor }} />
          </div>
          <h2
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: "0.16em",
              color: "#f0f0f0",
              textTransform: "uppercase",
              marginBottom: 7,
            }}
          >
            Room Password
          </h2>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.42)", fontFamily: "'Rajdhani', sans-serif", fontWeight: 500 }}>
            <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{label}</span> requires a password to enter
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Enter room password"
            autoFocus
            autoComplete="off"
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${error ? "#ef4444" : focused ? `${neonColor}66` : `${neonColor}2a`}`,
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 14,
              color: "#f0f0f0",
              outline: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 600,
              letterSpacing: "0.05em",
              boxShadow: error ? "0 0 0 1px rgba(239,68,68,0.12)" : focused ? `0 0 0 1px ${neonColor}18` : "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          />
          <div style={{ minHeight: 16 }}>
            {error && (
              <p style={{ fontSize: 11, color: "#f87171", fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, letterSpacing: "0.03em" }}>
                ✕ {error}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: "0 0 auto",
                padding: "11px 18px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 900,
                fontFamily: "'Orbitron', sans-serif",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)",
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                flex: 1,
                padding: "11px 0",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 900,
                fontFamily: "'Orbitron', sans-serif",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                background: canSubmit ? `${neonColor}1a` : `${neonColor}09`,
                border: `1px solid ${canSubmit ? `${neonColor}55` : `${neonColor}20`}`,
                color: canSubmit ? neonColor : `${neonColor}44`,
                cursor: canSubmit ? "pointer" : "not-allowed",
                boxShadow: canSubmit ? `0 0 18px ${neonColor}22` : "none",
                transition: "all 0.15s",
              }}
            >
              {loading ? "Checking…" : "Enter Room"}
            </button>
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
  const [modal, setModal] = useState<{ apiPath: string; storageKey: string; label: string; neonColor: string; onSuccess: () => void } | null>(null);

  function gate(game: GameDef, hasPassword: boolean) {
    console.log(`[launcher] gate game=${game.key} hasPassword=${hasPassword}`);
    if (!hasPassword) {
      console.log(`[launcher] no password — open token set, navigating to ${game.route}`);
      setAccessToken(game.key, "open"); setLocation(game.route); return;
    }
    const stored = getAccessToken(game.key);
    const hasValidToken = stored !== null && stored !== "open";
    console.log(`[launcher] has password — stored token valid=${hasValidToken} (stored=${stored === null ? "null" : stored === "open" ? '"open"' : "uuid"})`);
    if (hasValidToken) { setLocation(game.route); return; }
    console.log(`[launcher] opening password modal for ${game.label} (apiPath=${game.apiPath})`);
    setModal({
      apiPath: game.apiPath,
      storageKey: game.key,
      label: game.label,
      neonColor: NEON_HEX[game.neon] ?? "#a855f7",
      onSuccess: () => { setLocation(game.route); setModal(null); },
    });
  }

  async function enter(game: GameDef, hasPassword?: boolean) {
    console.log(`[launcher] enter game=${game.key} hasPassword=${hasPassword} direct=${!!game.direct}`);
    if (game.direct) { setLocation(game.route); return; }
    if (hasPassword !== undefined) { gate(game, hasPassword); return; }
    // Unknown status (meta not yet loaded, or lobby launch): consult the live token
    // map. A non-null entry means the game currently has a password. On error, fall
    // through to the modal rather than assuming the game is open.
    console.log(`[launcher] hasPassword unknown — querying /api/game-password-tokens for ${game.key}`);
    let pw = true;
    try {
      const r = await fetch(`${BASE}/api/game-password-tokens`);
      if (r.ok) {
        const tokens: Record<string, string | null> = await r.json();
        pw = !!tokens[game.key];
        console.log(`[launcher] game-password-tokens responded — ${game.key} hasPassword=${pw}`);
      } else {
        console.log(`[launcher] game-password-tokens returned ${r.status} — defaulting to password=true (safe)`);
      }
    } catch {
      console.log(`[launcher] game-password-tokens fetch error — defaulting to password=true (safe)`);
    }
    gate(game, pw);
  }

  return { enter, modalNode: modal ? (
    <GamePasswordModal
      apiPath={modal.apiPath}
      storageKey={modal.storageKey}
      label={modal.label}
      neonColor={modal.neonColor}
      onSuccess={modal.onSuccess}
      onCancel={() => setModal(null)}
    />
  ) : null };
}
