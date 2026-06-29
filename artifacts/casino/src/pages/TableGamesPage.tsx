import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CardGrid, CatalogGame } from "./shared";
import { tableGamesData } from "../lib/gamesData";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { trackRecentGame } from "../lib/recentGames";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";
import { Lock } from "lucide-react";
import { useGamesMeta, formatBetRange } from "../lib/useGamesMeta";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";

/* ─── Types ───────────────────────────────────────────────────────────── */
export interface BJTable {
  id: number;
  name: string;
  minBet: number;
  maxBet: number;
  numSeats: number;
  theme: string;
  isOpen: boolean;
  hasPassword: boolean;
  seatedCount: number;
  phase: string;
}

const IMGS = import.meta.env.BASE_URL;

/* ─── Static CLOSED card shown when BJ is disabled or has no open tables ── */
const BJ_CLOSED_GAME: CatalogGame = {
  id: "blackjack",
  name: "Blackjack",
  description: "No tables are currently open.",
  gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)",
  neonClass: "neon-green",
  neonColor: "#39ff14",
  badge: "BLACKJACK",
  actionLabel: "Join Table",
  statusLabel: "CLOSED",
  statusColor: "#ef4444",
  image: `${IMGS}images/card-blackjack.webp`,
  disabled: true,
};

/* ─── Theme config ────────────────────────────────────────────────────── */
const THEME_CFG = {
  velvet:  { gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)", neonClass: "neon-green",  neonColor: "#39ff14", label: "Classic" },
  gold:    { gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)", neonClass: "neon-yellow", neonColor: "#fbbf24", label: "High Roller" },
  diamond: { gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)", neonClass: "neon-blue",   neonColor: "#06b6d4", label: "VIP" },
} as const;

function bjTableToGame(table: BJTable): CatalogGame {
  const th = THEME_CFG[table.theme as keyof typeof THEME_CFG] ?? THEME_CFG.velvet;
  const fmtBet = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;
  return {
    id: `bj-table-${table.id}`,
    name: table.name,
    description: `${th.label} · Blackjack · ${table.numSeats} seats`,
    gradient: th.gradient,
    neonClass: th.neonClass,
    neonColor: th.neonColor,
    badge: table.hasPassword ? "PRIVATE" : "BLACKJACK",
    players: `${table.seatedCount}/${table.numSeats}`,
    betRange: `${fmtBet(table.minBet)} – ${fmtBet(table.maxBet)}`,
    actionLabel: table.hasPassword ? "Join Private" : "Join Table",
    statusLabel: "OPEN",
    statusColor: "#22c55e",
    image: `${IMGS}images/card-blackjack.webp`,
  };
}


/* ─── Dynamic Blackjack Table Card ───────────────────────────────────── */
export function BJTableCard({ table, onClick, delay }: { table: BJTable; onClick: () => void; delay: string }) {
  const [hov, setHov] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const th = THEME_CFG[table.theme as keyof typeof THEME_CFG] ?? THEME_CFG.velvet;
  const fmtBet = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${th.neonClass}`}
      style={{
        width: "100%",
        minWidth: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "rgba(10,7,7,0.92)",
        animationDelay: delay,
        opacity: table.isOpen ? 1 : 0.45,
        cursor: table.isOpen ? "pointer" : "not-allowed",
      }}
      onClick={table.isOpen ? onClick : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Artwork header */}
      <div style={{
        height: "clamp(132px, 10vw, 164px)",
        flexShrink: 0,
        background: th.gradient,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Blackjack artwork image */}
        <img
          src={`${IMGS}images/card-blackjack.webp`}
          alt="Blackjack"
          onLoad={() => setImgLoaded(true)}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center",
            transform: hov && table.isOpen ? "scale(1.07)" : "scale(1)",
            opacity: imgLoaded ? 1 : 0,
            transition: "transform 0.4s ease, opacity 0.4s ease",
          }}
        />
        {/* Brightness lift on hover */}
        <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.06)", opacity: hov && table.isOpen ? 1 : 0, transition: "opacity 0.2s" }} />
        {/* Neon edge glow */}
        <div style={{ position: "absolute", bottom: 0, left: "15%", right: "15%", height: 1, background: `linear-gradient(90deg, transparent, ${th.neonColor}66, transparent)`, opacity: hov ? 1 : 0.4, transition: "opacity 0.2s" }} />

        {/* Top-left: category badge */}
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(0,0,0,0.65)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)" }}>
            BLACKJACK
          </span>
        </div>

        {/* Top-right: PRIVATE + OPEN/CLOSED */}
        <div className="absolute top-2.5 right-2.5 flex flex-col items-end gap-1">
          {table.hasPassword && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
              style={{ color: "#fbbf24", background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)" }}>
              <Lock size={8} /> PRIVATE
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider"
            style={{
              color: table.isOpen ? "#22c55e" : "#ef4444",
              background: table.isOpen ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              border: `1px solid ${table.isOpen ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)"}`,
            }}>
            {table.isOpen ? "OPEN" : "CLOSED"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3" style={{ background: "#0c0a0a", flex: 1, display: "flex", flexDirection: "column" }}>
        <h3 className="font-rajdhani font-black text-base uppercase tracking-wider mb-0.5 text-center" style={{ color: "#f0f0f0" }}>
          {table.name}
        </h3>
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.42)" }}>
            👥 {table.seatedCount}/{table.numSeats}
          </span>
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.42)" }}>
            💰 {fmtBet(table.minBet)} – {fmtBet(table.maxBet)}
          </span>
        </div>

        <button
          className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-200"
          style={{
            marginTop: "auto",
            background: table.isOpen ? `${th.neonColor}18` : "rgba(255,255,255,0.04)",
            border: `1px solid ${table.isOpen ? `${th.neonColor}55` : "rgba(255,255,255,0.12)"}`,
            color: table.isOpen ? th.neonColor : "rgba(255,255,255,0.3)",
            cursor: table.isOpen ? "pointer" : "not-allowed",
            boxShadow: hov && table.isOpen ? `0 0 14px ${th.neonColor}33` : "none",
          }}
        >
          {table.isOpen ? (table.hasPassword ? "🔒 Join Private" : "Join Table") : "Closed"}
        </button>
      </div>
    </div>
  );
}

/* ─── Password Modal ─────────────────────────────────────────────────── */
export function BJPasswordModal({ table, onClose, onSuccess }: {
  table: BJTable;
  onClose: () => void;
  onSuccess: (password: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const submit = async () => {
    if (!pw.trim() || loading) return;
    setErr(null); setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/blackjack/tables/${table.id}/verify-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error ?? "Incorrect password");
      } else {
        onSuccess(pw.trim());
      }
    } catch {
      setErr("Network error, try again");
    } finally {
      setLoading(false);
    }
  };

  const [focused, setFocused] = useState(false);
  const neon = "#fbbf24";
  const canSubmit = !loading && !!pw.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: "linear-gradient(160deg, #09090f 0%, #0d0b14 100%)",
          border: `1px solid ${neon}40`,
          boxShadow: `0 0 0 1px ${neon}0d, 0 0 48px ${neon}18, 0 28px 72px rgba(0,0,0,0.7)`,
          borderRadius: 20,
          padding: "28px 28px 24px",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Icon + title */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 50, height: 50, borderRadius: 13,
              background: `${neon}14`,
              border: `1px solid ${neon}33`,
              display: "flex", alignItems: "center", justifyContent: "center",
              marginBottom: 14,
              boxShadow: `0 0 20px ${neon}20`,
            }}
          >
            <Lock size={22} style={{ color: neon }} />
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
            <span style={{ color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{table.name}</span> requires a password to enter
          </p>
        </div>

        {/* Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="password"
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(null); }}
            onKeyDown={e => e.key === "Enter" && submit()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Enter room password"
            autoFocus
            style={{
              width: "100%",
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${err ? "#ef4444" : focused ? `${neon}66` : `${neon}2a`}`,
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 14,
              color: "#f0f0f0",
              outline: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontWeight: 600,
              letterSpacing: "0.05em",
              boxShadow: err ? "0 0 0 1px rgba(239,68,68,0.12)" : focused ? `0 0 0 1px ${neon}18` : "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
          />
          <div style={{ minHeight: 16 }}>
            {err && (
              <p style={{ fontSize: 11, color: "#f87171", fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, letterSpacing: "0.03em" }}>
                ✕ {err}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
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
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
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
                background: canSubmit ? `${neon}1a` : `${neon}09`,
                border: `1px solid ${canSubmit ? `${neon}55` : `${neon}20`}`,
                color: canSubmit ? neon : `${neon}44`,
                cursor: canSubmit ? "pointer" : "not-allowed",
                boxShadow: canSubmit ? `0 0 18px ${neon}22` : "none",
                transition: "all 0.15s",
              }}
            >
              {loading ? "Checking…" : "Enter Room"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */
export function TableGamesPage() {
  const [, setLocation] = useLocation();
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { meta: gamesMeta, loading: gamesLoading } = useGamesMeta();
  const { enter, modalNode } = useGameLauncher();

  const [bjTables, setBjTables] = useState<BJTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTable, setPendingTable] = useState<BJTable | null>(null);

  const fetchTables = useCallback(() => {
    fetch(`${BASE}/api/blackjack/tables`)
      .then(r => r.json())
      .then(d => { setBjTables(Array.isArray(d) ? d : []); setLoading(false); setError(null); })
      .catch(() => { setError("Could not load blackjack tables"); setLoading(false); });
  }, [BASE]);

  useEffect(() => {
    fetchTables();
    const id = setInterval(fetchTables, 10_000);
    return () => clearInterval(id);
  }, [fetchTables]);

  const joinTable = (table: BJTable, password: string | null) => {
    addRecentlyPlayed({
      id: `bj-table-${table.id}`,
      game: bjTableToGame(table),
      route: "/blackjack",
      launchData: { tableId: table.id, password },
    });
    trackRecentGame("blackjack", "Blackjack", { tableId: table.id });
    setAccessToken("blackjack", "open");
    sessionStorage.setItem("bab_bj_autojoin", JSON.stringify({ tableId: table.id, password }));
    setLocation("/blackjack");
  };

  const handleBJClick = (table: BJTable) => {
    if (!table.isOpen) return;
    if (table.hasPassword) {
      setPendingTable(table);
    } else {
      joinTable(table, null);
    }
  };

  const bjMeta     = gamesMeta["blackjack"];
  // Admin has explicitly disabled blackjack when the setting is "false"
  const bjAdminOff = !gamesLoading && bjMeta?.status === "closed";
  const openTables = bjAdminOff ? [] : bjTables.filter(t => t.isOpen);
  // Show a CLOSED card when: admin disabled, OR tables loaded with none open
  const showBJClosed = !loading && !error && (bjAdminOff || openTables.length === 0);

  return (
    <PageWrapper title="Table Games" breadcrumb="Casino / Table Games" accentColor="#39ff14">
      {modalNode}
      {/* Password modal */}
      {pendingTable && (
        <BJPasswordModal
          table={pendingTable}
          onClose={() => setPendingTable(null)}
          onSuccess={pw => { joinTable(pendingTable, pw); setPendingTable(null); }}
        />
      )}

      {/* Blackjack loading */}
      {loading && (
        <p className="text-sm text-center mb-4" style={{ color: "rgba(255,255,255,0.28)" }}>Loading blackjack tables…</p>
      )}
      {!loading && error && (
        <p className="text-sm text-center mb-4" style={{ color: "#f87171" }}>{error}</p>
      )}

      <CardGrid>
        {/* Dynamic blackjack tables — only shown when BJ is enabled + open */}
        {openTables.map((table, i) => (
          <BJTableCard key={table.id} table={table} onClick={() => handleBJClick(table)} delay={`${-i}s`} />
        ))}

        {/* CLOSED blackjack card — shown when admin disabled or no open tables */}
        {showBJClosed && (
          <CatalogCard game={BJ_CLOSED_GAME} delay="0s" />
        )}

        {/* Static games — player counts + bet ranges from live API */}
        {tableGamesData.map((g, i) => {
          const live = gamesMeta[g.id];
          const closed = live?.status === "closed";
          const isLoading = gamesLoading && !live;
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
            <CatalogCard key={g.id} game={game} delay={`${-(openTables.length + i)}s`} onClick={() => {
              if (closed) return;
              addRecentlyPlayed({ id: g.id, game: g, route: g.route, tokenId: g.tokenId });
              trackRecentGame(g.lobbyKey ?? g.id, g.name);
              const def = GAMES[g.id];
              if (def) {
                // Pass undefined when meta hasn't loaded yet so enter() safely
                // queries /api/game-password-tokens instead of assuming no password.
                enter(def, gamesMeta[g.id] !== undefined ? gamesMeta[g.id].hasPassword : undefined);
              } else {
                console.warn(`[launcher] table-games: ${g.id} has no GAMES entry — navigating without password gate`);
                setLocation(g.route);
              }
            }} />
          );
        })}
      </CardGrid>
    </PageWrapper>
  );
}
