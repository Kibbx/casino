import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PokerTableSeat {
  playerId: number | null;
}

interface PokerTable {
  id: number;
  name: string;
  status: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  rakePercent: number;
  rakeCap: number;
  seats: PokerTableSeat[];
  tournamentId: number | null;
  hasPassword: boolean;
  theme: string;
  locked: boolean;
  createdAt: string;
}

const THEME_CONFIG: Record<string, { gradient: string; neonClass: string; neonColor: string; badge: string }> = {
  velvet:  { gradient: "linear-gradient(135deg, #1a0505 0%, #2e0a0a 60%, #4a1212 100%)", neonClass: "neon-red",    neonColor: "#f87171", badge: "♠" },
  gold:    { gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)", neonClass: "neon-yellow", neonColor: "#fbbf24", badge: "👑" },
  diamond: { gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)", neonClass: "neon-pink",   neonColor: "#a78bfa", badge: "💎" },
};

function fmtChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function tableToGame(table: PokerTable): CatalogGame {
  const cfg = THEME_CONFIG[table.theme] ?? THEME_CONFIG.velvet;
  const seated = table.seats.filter((s) => s.playerId).length;
  const total = table.seats.length;
  const isPlaying = table.status === "playing";
  const themeLabel = table.theme === "gold" ? "High Roller" : table.theme === "diamond" ? "VIP" : "Classic";

  return {
    id: String(table.id),
    name: table.name,
    description: `${themeLabel} · Blinds ${fmtChips(table.smallBlind)}/${fmtChips(table.bigBlind)} · ${seated}/${total} seated`,
    gradient: cfg.gradient,
    neonClass: cfg.neonClass,
    neonColor: cfg.neonColor,
    badge: table.hasPassword ? "PRIVATE" : cfg.badge,
    badgeColor: table.hasPassword ? "#92400e" : undefined,
    players: `${seated} / ${total} seated`,
    betRange: `${fmtChips(table.minBuyIn)} – ${fmtChips(table.maxBuyIn)} buy-in`,
    actionLabel: "Join Table",
    statusLabel: isPlaying ? "IN PROGRESS" : "OPEN",
    statusColor: isPlaying ? "#fbbf24" : "#22c55e",
  };
}

const staticPokerTypes: CatalogGame[] = [
  {
    id: "cash",
    name: "Cash Games",
    description: "Sit down, play at your own pace. Leave anytime with your chips.",
    gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)",
    neonClass: "neon-green",
    neonColor: "#22c55e",
    players: "Texas Hold'em",
    betRange: "No limit",
    actionLabel: "Find a Table",
    statusLabel: "OPEN",
    statusColor: "#22c55e",
  },
  {
    id: "sng",
    name: "Sit & Go",
    description: "Single-table tournaments that start when seats fill. Fast & focused.",
    gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)",
    neonClass: "neon-blue",
    neonColor: "#06b6d4",
    players: "Texas Hold'em",
    betRange: "Tournament chips",
    actionLabel: "Register",
    statusLabel: "FILLING",
    statusColor: "#06b6d4",
  },
  {
    id: "mtt",
    name: "Multi-Table",
    description: "Big fields, bigger prizes. Compete against hundreds for massive prize pools.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink",
    neonColor: "#a855f7",
    players: "Texas Hold'em",
    betRange: "Tournament chips",
    actionLabel: "Register",
    statusLabel: "OPEN",
    statusColor: "#a855f7",
  },
  {
    id: "highstakes",
    name: "High Stakes",
    description: "For elite players only. Massive blinds, massive pots, maximum prestige.",
    gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)",
    neonClass: "neon-yellow",
    neonColor: "#f5c518",
    badge: "VIP",
    badgeColor: "#7c3aed",
    players: "Texas Hold'em",
    betRange: "High limit",
    actionLabel: "Request Access",
    statusLabel: "LIVE",
    statusColor: "#f5c518",
  },
];

export function PokerPage() {
  const [, setLocation] = useLocation();
  const { sessionToken } = useStore();
  const [tables, setTables] = useState<PokerTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchTables = useCallback(() => {
    fetch(`${BASE}/api/tables`, {
      headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    })
      .then((r) => {
        if (!r.ok) throw new Error("failed");
        return r.json();
      })
      .then((data: PokerTable[]) => {
        const cashTables = data.filter((t) => !t.tournamentId && !t.locked && t.status !== "closed");
        setTables(cashTables);
        setLoading(false);
        setError(false);
      })
      .catch(() => {
        setLoading(false);
        setError(true);
      });
  }, [sessionToken]);

  useEffect(() => {
    fetchTables();
    const iv = setInterval(fetchTables, 10_000);
    return () => clearInterval(iv);
  }, [fetchTables]);

  function joinTable(table: PokerTable) {
    setLocation(`/table/${table.id}`);
  }

  return (
    <PageWrapper title="Poker" breadcrumb="Casino / Poker" accentColor="#22c55e">

      {/* Live Tables section */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
            Live Tables
          </span>
          {!loading && !error && (
            <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 99, background: tables.length > 0 ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)", color: tables.length > 0 ? "#4ade80" : "rgba(255,255,255,0.3)", border: `1px solid ${tables.length > 0 ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.08)"}` }}>
              {tables.length} open
            </span>
          )}
        </div>

        {loading && (
          <div style={{ display: "flex", gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 220, height: 232, borderRadius: 16, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", animation: "pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: "20px 0", color: "rgba(248,113,113,0.7)", fontSize: 13 }}>
            Could not load tables — retrying…
          </div>
        )}

        {!loading && !error && tables.length === 0 && (
          <div style={{ padding: "20px 0", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
            No tables open right now — ask a dealer to open one.
          </div>
        )}

        {!loading && !error && tables.length > 0 && (
          <CardGrid>
            {tables.map((t, i) => (
              <CatalogCard
                key={t.id}
                game={tableToGame(t)}
                delay={`${-i * 0.3}s`}
                onClick={() => joinTable(t)}
              />
            ))}
          </CardGrid>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.07)", marginBottom: 28 }} />

      {/* Game Types */}
      <div style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
          Game Formats
        </span>
      </div>
      <CardGrid>
        {staticPokerTypes.map((g, i) => (
          <CatalogCard key={g.id} game={g} delay={`${-i}s`} />
        ))}
      </CardGrid>

    </PageWrapper>
  );
}
