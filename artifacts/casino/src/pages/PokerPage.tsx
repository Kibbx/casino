import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PageWrapper, CatalogCard, CatalogGame, CardGrid } from "./shared";
import { useStore } from "../store";
import { addRecentlyPlayed } from "../lib/recentlyPlayed";

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
    description: `${themeLabel} · Blinds ${fmtChips(table.smallBlind)}/${fmtChips(table.bigBlind)}`,
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
    image: `${BASE}images/card-poker.webp`,
  };
}


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
    addRecentlyPlayed({
      id: `poker-table-${table.id}`,
      game: tableToGame(table),
      route: `/table/${table.id}`,
    });
    setLocation(`/table/${table.id}`);
  }

  return (
    <PageWrapper title="Poker" breadcrumb="Casino / Poker" accentColor="#22c55e">

      {/* Live Tables section */}
      <div style={{ marginBottom: 28 }}>
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

    </PageWrapper>
  );
}
