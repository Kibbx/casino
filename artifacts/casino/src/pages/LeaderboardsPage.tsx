import { useState, useEffect, useMemo } from "react";
import { PageWrapper } from "./shared";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LeaderEntry = {
  id: number;
  username: string;
  games: number;
  wins: number;
  winRate: number;
  totalWon: number;
  chips: number;
  tier: string;
  avatarUrl: string | null;
  staffRole: string | null;
};

type Tab = "winnings" | "winrate" | "games";

const TABS: { id: Tab; label: string; col: string }[] = [
  { id: "winnings", label: "Total Winnings", col: "Total Won"    },
  { id: "winrate",  label: "Win Rate",        col: "Win Rate"    },
  { id: "games",    label: "Games Played",    col: "Games"       },
];

const TIER_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  Diamond:  { color: "#7dd3fc", bg: "rgba(125,211,252,0.12)", border: "rgba(125,211,252,0.3)" },
  Platinum: { color: "#e2e8f0", bg: "rgba(226,232,240,0.10)", border: "rgba(226,232,240,0.25)" },
  Gold:     { color: "#f5c518", bg: "rgba(245,197,24,0.12)",  border: "rgba(245,197,24,0.3)"  },
  Silver:   { color: "#9ca3af", bg: "rgba(156,163,175,0.10)", border: "rgba(156,163,175,0.25)" },
  Bronze:   { color: "#cd7f32", bg: "rgba(205,127,50,0.12)",  border: "rgba(205,127,50,0.3)"  },
};

const MEDALS = ["🥇", "🥈", "🥉"];
const CURRENT_USER = "Jonah Hydell";

function fmtWon(n: number): string {
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = (abs / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  else if (abs >= 1_000) s = (abs / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  else s = abs.toLocaleString();
  return (n >= 0 ? "+" : "-") + "$" + s;
}

function fmtGames(n: number): string {
  return n.toLocaleString();
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export function LeaderboardsPage() {
  const { sessionToken, playerId, playerUsername } = useStore();
  const [activeTab, setActiveTab] = useState<Tab>("winnings");
  const [data, setData] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/players/leaderboard`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e?.error ?? "Failed")))
      .then((rows: LeaderEntry[]) => { setData(rows); setLoading(false); })
      .catch((e: any) => { setError(typeof e === "string" ? e : "Failed to load leaderboard"); setLoading(false); });
  }, [sessionToken]);

  const sorted = useMemo(() => {
    const copy = [...data];
    if (activeTab === "winnings") copy.sort((a, b) => b.totalWon - a.totalWon);
    if (activeTab === "winrate")  copy.sort((a, b) => b.winRate  - a.winRate);
    if (activeTab === "games")    copy.sort((a, b) => b.games    - a.games);
    return copy;
  }, [data, activeTab]);

  const myRank = sorted.findIndex(e => e.id === playerId || e.username === (playerUsername ?? CURRENT_USER)) + 1;
  const currentTab = TABS.find(t => t.id === activeTab)!;

  function getStatDisplay(entry: LeaderEntry): string {
    if (activeTab === "winnings") return fmtWon(entry.totalWon);
    if (activeTab === "winrate")  return entry.winRate + "%";
    return fmtGames(entry.games);
  }

  function getStatColor(entry: LeaderEntry, rank: number): string {
    if (activeTab === "winnings") return entry.totalWon >= 0 ? "#22c55e" : "#ef4444";
    if (activeTab === "winrate") {
      if (entry.winRate >= 65) return "#22c55e";
      if (entry.winRate >= 50) return "rgba(255,255,255,0.75)";
      return "#f97316";
    }
    if (rank === 1) return "#f5c518";
    if (rank === 2) return "#9ca3af";
    if (rank === 3) return "#cd7f32";
    return "rgba(255,255,255,0.65)";
  }

  return (
    <PageWrapper title="Leaderboards" breadcrumb="The Hub / Leaderboards" accentColor="#a855f7">

      {/* ── Tab row ───────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(tab => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
              style={{
                background: active ? "rgba(168,85,247,0.18)" : "rgba(255,255,255,0.04)",
                color:      active ? "#a855f7"               : "rgba(255,255,255,0.40)",
                border:     `1px solid ${active ? "rgba(168,85,247,0.50)" : "rgba(255,255,255,0.08)"}`,
                boxShadow:  active ? "0 0 14px rgba(168,85,247,0.2)" : "none",
                transform:  active ? "translateY(-1px)" : "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Your rank banner ─────────────────────────────────────────── */}
      {!loading && !error && myRank > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl mb-5"
          style={{
            background: "rgba(168,85,247,0.08)",
            border: "1px solid rgba(168,85,247,0.25)",
          }}
        >
          <span style={{ fontSize: 18 }}>
            {myRank <= 3 ? MEDALS[myRank - 1] : `#${myRank}`}
          </span>
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
            Your rank on <span style={{ color: "#a855f7", fontWeight: 700 }}>{currentTab.label}</span>
            {" "}— <span style={{ color: "#fff", fontWeight: 700 }}>#{myRank}</span> of {sorted.length} players
          </span>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden w-full"
        style={{ border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Header */}
        <div
          className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.28)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            display: "grid",
            gridTemplateColumns: "52px 1fr 80px 80px 110px 110px",
          }}
        >
          <span>Rank</span>
          <span>Player</span>
          <span className="hidden sm:block">Games</span>
          <span className="hidden sm:block">Win %</span>
          <span className="hidden sm:block">Tier</span>
          <span style={{ textAlign: "right" }}>{currentTab.col}</span>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16 gap-3">
            <div
              className="w-5 h-5 rounded-full border-2 animate-spin"
              style={{ borderColor: "rgba(168,85,247,0.8) transparent transparent transparent" }}
            />
            <span className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>Loading leaderboard…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="py-12 text-center text-sm" style={{ color: "rgba(255,100,100,0.6)" }}>
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && sorted.length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: "rgba(255,255,255,0.28)" }}>
            No players yet
          </div>
        )}

        {/* Rows */}
        {!loading && !error && sorted.map((entry, i) => {
          const rank   = i + 1;
          const isMe   = entry.id === playerId || entry.username === (playerUsername ?? CURRENT_USER);
          const hovered = hoveredRow === entry.id && !isMe;
          const tier   = TIER_COLORS[entry.tier] ?? TIER_COLORS.Bronze;

          return (
            <div
              key={entry.id}
              onMouseEnter={() => setHoveredRow(entry.id)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: "grid",
                gridTemplateColumns: "52px 1fr 80px 80px 110px 110px",
                padding: "14px 20px",
                alignItems: "center",
                borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                background: isMe
                  ? "rgba(168,85,247,0.10)"
                  : hovered ? "rgba(255,255,255,0.03)" : "transparent",
                transition: "background 0.12s ease",
                cursor: "default",
              }}
            >
              {/* Rank */}
              <div style={{ display: "flex", alignItems: "center" }}>
                {rank <= 3 ? (
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{MEDALS[rank - 1]}</span>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 900, color: "rgba(255,255,255,0.28)", fontVariantNumeric: "tabular-nums" }}>
                    #{rank}
                  </span>
                )}
              </div>

              {/* Player */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {entry.avatarUrl ? (
                  <img
                    src={entry.avatarUrl}
                    alt=""
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      objectFit: "cover", flexShrink: 0,
                      border: `1.5px solid ${isMe ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)"}`,
                    }}
                  />
                ) : (
                  <div style={{
                    width: 32, height: 32, borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 900, flexShrink: 0,
                    background: isMe ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.06)",
                    border: `1.5px solid ${isMe ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.09)"}`,
                    color: isMe ? "#a855f7" : "rgba(255,255,255,0.45)",
                  }}>
                    {getInitials(entry.username)}
                  </div>
                )}

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      className="font-rajdhani font-bold text-sm truncate"
                      style={{ color: isMe ? "#c084fc" : "rgba(255,255,255,0.88)" }}
                    >
                      {entry.username}
                    </span>
                    {isMe && (
                      <span style={{
                        fontSize: 9, fontWeight: 900, letterSpacing: "0.1em",
                        padding: "1px 6px", borderRadius: 99,
                        background: "rgba(168,85,247,0.2)", color: "#a855f7",
                        border: "1px solid rgba(168,85,247,0.35)", textTransform: "uppercase",
                      }}>
                        you
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Games */}
              <span
                className="hidden sm:block text-sm tabular-nums"
                style={{ color: "rgba(255,255,255,0.45)" }}
              >
                {fmtGames(entry.games)}
              </span>

              {/* Win Rate */}
              <span
                className="hidden sm:block text-sm font-bold tabular-nums"
                style={{
                  color: entry.winRate >= 65
                    ? "#22c55e"
                    : entry.winRate >= 50
                      ? "rgba(255,255,255,0.7)"
                      : "#f97316",
                }}
              >
                {entry.games > 0 ? entry.winRate + "%" : "—"}
              </span>

              {/* Tier */}
              <div className="hidden sm:flex">
                <span style={{
                  fontSize: 10, fontWeight: 900, letterSpacing: "0.08em",
                  padding: "2px 8px", borderRadius: 99, textTransform: "uppercase",
                  color: tier.color, background: tier.bg, border: `1px solid ${tier.border}`,
                }}>
                  {entry.tier}
                </span>
              </div>

              {/* Primary stat */}
              <div style={{ textAlign: "right" }}>
                <span style={{
                  fontSize: 14, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                  color: getStatColor(entry, rank),
                }}>
                  {getStatDisplay(entry)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-center" style={{ color: "rgba(255,255,255,0.20)" }}>
        Live data · Updates on page load · Bots excluded from rankings
      </p>
    </PageWrapper>
  );
}
