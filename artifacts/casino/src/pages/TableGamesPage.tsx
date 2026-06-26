import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CardGrid } from "./shared";
import { tableGamesData } from "../lib/gamesData";
import { setAccessToken } from "../lib/gamePasswordGuard";
import { trackRecentGame } from "../lib/recentGames";
import { Lock } from "lucide-react";

/* ─── Types ───────────────────────────────────────────────────────────── */
interface BJTable {
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

/* ─── Theme config ────────────────────────────────────────────────────── */
const THEME_CFG = {
  velvet:  { gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)", neonClass: "neon-green",  neonColor: "#39ff14", label: "Classic" },
  gold:    { gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)", neonClass: "neon-yellow", neonColor: "#fbbf24", label: "High Roller" },
  diamond: { gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)", neonClass: "neon-blue",   neonColor: "#06b6d4", label: "VIP" },
} as const;


/* ─── Dynamic Blackjack Table Card ───────────────────────────────────── */
function BJTableCard({ table, onClick, delay }: { table: BJTable; onClick: () => void; delay: string }) {
  const [hov, setHov] = useState(false);
  const th = THEME_CFG[table.theme as keyof typeof THEME_CFG] ?? THEME_CFG.velvet;
  const fmtBet = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `$${n}`;

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${th.neonClass}`}
      style={{
        width: "220px",
        flexShrink: 0,
        background: "rgba(10,7,7,0.92)",
        animationDelay: delay,
        opacity: table.isOpen ? 1 : 0.45,
        cursor: table.isOpen ? "pointer" : "not-allowed",
      }}
      onClick={table.isOpen ? onClick : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Gradient image area */}
      <div style={{
        height: 128,
        background: th.gradient,
        position: "relative",
        overflow: "hidden",
        transition: "filter 0.2s",
        filter: hov && table.isOpen ? "brightness(1.2)" : "brightness(1)",
      }}>
        {/* Watermark */}
        <div
          className="absolute inset-0 flex items-center justify-center select-none"
          style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 62, fontWeight: 900, color: th.neonColor, opacity: 0.11, letterSpacing: 2 }}
        >♠</div>

        {/* Neon radial glow */}
        <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 60%, ${th.neonColor}20 0%, transparent 70%)` }} />

        {/* Top-left: category badge */}
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(0,0,0,0.75)", color: "rgba(255,255,255,0.62)", border: "1px solid rgba(255,255,255,0.14)" }}>
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

        {/* Bottom fade */}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,5,5,0.85) 0%, transparent 60%)" }} />
      </div>

      {/* Body */}
      <div className="px-4 py-3" style={{ background: "#0c0a0a" }}>
        <h3 className="font-rajdhani font-black text-base uppercase tracking-wider mb-0.5 text-center" style={{ color: "#f0f0f0" }}>
          {table.name}
        </h3>
        <p className="text-[11px] mb-2 leading-snug text-center" style={{ color: "rgba(255,255,255,0.40)" }}>
          {th.label} · {table.numSeats} seats
        </p>

        <div className="flex items-center gap-3 mb-2">
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
function PasswordModal({ table, onClose, onSuccess }: {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.78)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl p-6 w-80"
        style={{ background: "#0e0e18", border: "1px solid rgba(251,191,36,0.3)", boxShadow: "0 0 40px rgba(251,191,36,0.08)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock size={16} style={{ color: "#fbbf24" }} />
          <h3 className="font-black text-base uppercase tracking-wider" style={{ color: "#fbbf24" }}>Private Table</h3>
        </div>
        <p className="text-sm mb-4" style={{ color: "rgba(255,255,255,0.5)" }}>
          Enter the password to join <span className="font-bold text-white">{table.name}</span>.
        </p>
        <input
          type="password"
          value={pw}
          onChange={e => { setPw(e.target.value); setErr(null); }}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Table password…"
          autoFocus
          className="w-full rounded-lg px-3 py-2 text-sm mb-3 outline-none"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}
        />
        {err && <p className="text-xs mb-3" style={{ color: "#f87171" }}>{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs font-bold uppercase"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !pw.trim()}
            className="flex-1 py-2 rounded-lg text-xs font-black uppercase transition-opacity"
            style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", cursor: loading || !pw.trim() ? "not-allowed" : "pointer", opacity: loading || !pw.trim() ? 0.5 : 1 }}
          >
            {loading ? "Checking…" : "Join"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────── */
export function TableGamesPage() {
  const [, setLocation] = useLocation();
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
    trackRecentGame("blackjack", "Blackjack");
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

  const openTables = bjTables.filter(t => t.isOpen);

  return (
    <PageWrapper title="Table Games" breadcrumb="Casino / Table Games" accentColor="#39ff14">
      {/* Password modal */}
      {pendingTable && (
        <PasswordModal
          table={pendingTable}
          onClose={() => setPendingTable(null)}
          onSuccess={pw => { joinTable(pendingTable, pw); setPendingTable(null); }}
        />
      )}

      {/* Blackjack loading / error */}
      {loading && (
        <p className="text-sm text-center mb-4" style={{ color: "rgba(255,255,255,0.28)" }}>Loading blackjack tables…</p>
      )}
      {!loading && error && (
        <p className="text-sm text-center mb-4" style={{ color: "#f87171" }}>{error}</p>
      )}

      <CardGrid>
        {/* Dynamic blackjack tables */}
        {openTables.map((table, i) => (
          <BJTableCard key={table.id} table={table} onClick={() => handleBJClick(table)} delay={`${-i}s`} />
        ))}

        {/* Empty state: no open BJ tables */}
        {!loading && !error && openTables.length === 0 && (
          <div className="text-sm py-2" style={{ color: "rgba(255,255,255,0.25)" }}>
            No blackjack tables open right now.
          </div>
        )}

        {/* Static games */}
        {tableGamesData.map((g, i) => (
          <CatalogCard key={g.id} game={g} delay={`${-(openTables.length + i)}s`} onClick={() => {
            trackRecentGame(g.lobbyKey ?? g.id, g.name);
            if (g.tokenId) setAccessToken(g.tokenId, "open");
            setLocation(g.route);
          }} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
