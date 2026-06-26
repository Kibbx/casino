import { useState, useEffect, useMemo, useRef } from "react";
import { PageWrapper } from "./shared";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Types ─────────────────────────────────────────────────────────────────── */
type ApiEntry = {
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

type RankedEntry = ApiEntry & {
  rank: number;
  prevRank: number | null;
  trendDelta: number | null;
};

const TIER_STYLE: Record<string, { color: string; bg: string; border: string; glow: string }> = {
  Diamond:  { color: "#7dd3fc", bg: "rgba(125,211,252,0.12)", border: "rgba(125,211,252,0.35)", glow: "rgba(125,211,252,0.2)"  },
  Platinum: { color: "#e2e8f0", bg: "rgba(226,232,240,0.09)", border: "rgba(226,232,240,0.28)", glow: "rgba(226,232,240,0.12)" },
  Gold:     { color: "#f5c518", bg: "rgba(245,197,24,0.12)",  border: "rgba(245,197,24,0.35)",  glow: "rgba(245,197,24,0.2)"  },
  Silver:   { color: "#9ca3af", bg: "rgba(156,163,175,0.09)", border: "rgba(156,163,175,0.25)", glow: "rgba(156,163,175,0.12)" },
  Bronze:   { color: "#cd7f32", bg: "rgba(205,127,50,0.12)",  border: "rgba(205,127,50,0.3)",   glow: "rgba(205,127,50,0.15)" },
};

const RANK_1_GRADIENT = "linear-gradient(135deg, rgba(255,215,0,0.18) 0%, rgba(255,215,0,0.04) 100%)";
const RANK_2_GRADIENT = "linear-gradient(135deg, rgba(192,192,192,0.14) 0%, rgba(192,192,192,0.03) 100%)";
const RANK_3_GRADIENT = "linear-gradient(135deg, rgba(205,127,50,0.16) 0%, rgba(205,127,50,0.03) 100%)";

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function fmtProfit(n: number): string {
  const abs = Math.abs(n);
  let s: string;
  if (abs >= 1_000_000) s = "$" + (abs / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  else if (abs >= 1_000)  s = "$" + (abs / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  else                    s = "$" + abs.toLocaleString();
  return (n >= 0 ? "+" : "-") + s;
}

function fmtGames(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

const SNAPSHOT_KEY = "lb_snapshot";

function loadSnapshot(): Record<number, number> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveSnapshot(entries: RankedEntry[]): void {
  const map: Record<number, number> = {};
  for (const e of entries) map[e.id] = e.rank;
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(map)); } catch {}
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */
function TierBadge({ tier }: { tier: string }) {
  const s = TIER_STYLE[tier] ?? TIER_STYLE.Bronze;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
      padding: "3px 9px", borderRadius: 999,
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      boxShadow: `0 0 8px ${s.glow}`,
      whiteSpace: "nowrap",
    }}>
      {tier}
    </span>
  );
}

function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) {
    return (
      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", fontWeight: 700, letterSpacing: "-0.02em" }}>
        ▬
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 2,
      fontSize: 11, fontWeight: 900,
      color: up ? "#22c55e" : "#ef4444",
    }}>
      {up ? "▲" : "▼"}{Math.abs(delta)}
    </span>
  );
}

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) return <span style={{ fontSize: 22, lineHeight: 1, filter: "drop-shadow(0 0 6px rgba(255,215,0,0.5))" }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: 22, lineHeight: 1, filter: "drop-shadow(0 0 5px rgba(192,192,192,0.4))" }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: 22, lineHeight: 1, filter: "drop-shadow(0 0 5px rgba(205,127,50,0.4))" }}>🥉</span>;
  return (
    <span style={{ fontSize: 12, fontWeight: 900, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>
      #{rank}
    </span>
  );
}

/* ── Main component ─────────────────────────────────────────────────────────── */
export function LeaderboardsPage() {
  const { sessionToken, playerId, playerUsername } = useStore();
  const [data, setData]       = useState<ApiEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const snapshotSaved = useRef(false);

  /* fetch */
  useEffect(() => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/players/leaderboard`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e?.error ?? "Failed")))
      .then((rows: ApiEntry[]) => { setData(rows); setLoading(false); })
      .catch((e: any) => { setError(typeof e === "string" ? e : "Failed to load"); setLoading(false); });
  }, [sessionToken]);

  /* sorted + ranked + trend — always by total winnings */
  const ranked = useMemo((): RankedEntry[] => {
    const copy = [...data].sort((a, b) => b.totalWon - a.totalWon);
    const snapshot = loadSnapshot();
    return copy.map((entry, i) => {
      const rank = i + 1;
      const prevRank = snapshot[entry.id] ?? null;
      const trendDelta = prevRank !== null ? prevRank - rank : null;
      return { ...entry, rank, prevRank, trendDelta };
    });
  }, [data]);

  /* save snapshot once after first load */
  useEffect(() => {
    if (ranked.length === 0 || snapshotSaved.current) return;
    snapshotSaved.current = true;
    setTimeout(() => saveSnapshot(ranked), 2000);
  }, [ranked]);

  const myEntry  = ranked.find(e => e.id === playerId || e.username === playerUsername);
  const myRank   = myEntry?.rank ?? null;

  const colLayout = "48px 1fr 72px 72px 96px 100px 68px";

  return (
    <PageWrapper title="Leaderboards" breadcrumb="The Hub / Leaderboards" accentColor="#a855f7">

      {/* ── Your rank banner ───────────────────────────────────────────── */}
      {!loading && !error && myRank !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 12, marginBottom: 16,
          background: "rgba(168,85,247,0.07)",
          border: "1px solid rgba(168,85,247,0.22)",
        }}>
          <span style={{ fontSize: 16 }}>
            {myRank <= 3 ? ["🥇","🥈","🥉"][myRank - 1] : `#${myRank}`}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Your current rank ·{" "}
            <span style={{ color: "#c084fc", fontWeight: 800 }}>
              #{myRank}
            </span>{" "}
            of {ranked.length} players
            {myEntry && myEntry.trendDelta !== null && myEntry.trendDelta !== 0 && (
              <span style={{ marginLeft: 8 }}>
                <TrendBadge delta={myEntry.trendDelta} />
                {" "}since last visit
              </span>
            )}
          </span>
        </div>
      )}

      {/* ── Table card ─────────────────────────────────────────────────── */}
      <div style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(255,255,255,0.02)",
        backdropFilter: "blur(12px)",
        overflow: "hidden",
      }}>

        {/* Sticky header */}
        <div style={{
          position: "sticky", top: 0, zIndex: 10,
          display: "grid", gridTemplateColumns: colLayout,
          padding: "11px 20px", alignItems: "center",
          background: "rgba(10,10,18,0.88)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.25)",
        }}>
          <span>Rank</span>
          <span>Player</span>
          <span>Games</span>
          <span>Win %</span>
          <span>Tier</span>
          <span style={{ textAlign: "right" }}>Profit</span>
          <span style={{ textAlign: "center" }}>Trend</span>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              border: "2px solid transparent",
              borderTopColor: "#a855f7",
              animation: "spin 0.7s linear infinite",
            }} />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Loading leaderboard…</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "rgba(255,100,100,0.55)" }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && ranked.length === 0 && (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "rgba(255,255,255,0.22)" }}>
            No players yet
          </div>
        )}

        {/* Rows */}
        {!loading && !error && (
          <div>
            {ranked.map((entry, i) => {
              const isMe = entry.id === playerId || entry.username === playerUsername;
              const isHov = hovered === entry.id && !isMe;
              const tier = TIER_STYLE[entry.tier] ?? TIER_STYLE.Bronze;

              let rowBg = "transparent";
              if (isMe) rowBg = "rgba(168,85,247,0.09)";
              else if (isHov) rowBg = "rgba(255,255,255,0.025)";
              else if (entry.rank === 1) rowBg = RANK_1_GRADIENT;
              else if (entry.rank === 2) rowBg = RANK_2_GRADIENT;
              else if (entry.rank === 3) rowBg = RANK_3_GRADIENT;

              const profitColor = entry.totalWon >= 0 ? "#22c55e" : "#ef4444";
              const profitGlow  = entry.totalWon >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)";

              let winRateColor = "rgba(255,255,255,0.5)";
              if (entry.winRate >= 65) winRateColor = "#22c55e";
              else if (entry.winRate >= 50) winRateColor = "rgba(255,255,255,0.75)";
              else if (entry.winRate > 0) winRateColor = "#f97316";

              return (
                <div
                  key={entry.id}
                  onMouseEnter={() => setHovered(entry.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: colLayout,
                    padding: "13px 20px",
                    alignItems: "center",
                    background: rowBg,
                    borderBottom: i < ranked.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    boxShadow: isMe ? "inset 3px 0 0 rgba(168,85,247,0.7)" : undefined,
                    transition: "background 0.15s ease, box-shadow 0.15s ease",
                    cursor: "default",
                    position: "relative",
                  }}
                >
                  {/* Rank */}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <RankCell rank={entry.rank} />
                  </div>

                  {/* Player */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    {/* Avatar */}
                    {entry.avatarUrl ? (
                      <img
                        src={entry.avatarUrl}
                        alt=""
                        style={{
                          width: 32, height: 32, borderRadius: "50%",
                          objectFit: "cover", flexShrink: 0,
                          border: `2px solid ${isMe ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.08)"}`,
                          boxShadow: isMe ? "0 0 10px rgba(168,85,247,0.35)" : undefined,
                        }}
                      />
                    ) : (
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 900,
                        background: isMe
                          ? "linear-gradient(135deg, rgba(168,85,247,0.3), rgba(168,85,247,0.1))"
                          : "rgba(255,255,255,0.06)",
                        border: `2px solid ${isMe ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isMe ? "0 0 12px rgba(168,85,247,0.3)" : undefined,
                        color: isMe ? "#c084fc" : "rgba(255,255,255,0.4)",
                      }}>
                        {getInitials(entry.username)}
                      </div>
                    )}

                    {/* Name + you badge */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 13, fontWeight: 800, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap",
                          color: isMe ? "#c084fc" : "rgba(255,255,255,0.88)",
                          textShadow: isMe ? "0 0 14px rgba(192,132,252,0.45)" : undefined,
                        }}>
                          {entry.username}
                        </span>
                        {isMe && (
                          <span style={{
                            fontSize: 8, fontWeight: 900, letterSpacing: "0.12em",
                            padding: "2px 6px", borderRadius: 999, textTransform: "uppercase",
                            background: "rgba(168,85,247,0.2)", color: "#a855f7",
                            border: "1px solid rgba(168,85,247,0.4)",
                            boxShadow: "0 0 8px rgba(168,85,247,0.2)",
                          }}>
                            you
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Games */}
                  <span style={{
                    fontSize: 13, fontVariantNumeric: "tabular-nums",
                    color: "rgba(255,255,255,0.45)",
                  }}>
                    {fmtGames(entry.games)}
                  </span>

                  {/* Win % */}
                  <span style={{
                    fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    color: entry.games > 0 ? winRateColor : "rgba(255,255,255,0.2)",
                  }}>
                    {entry.games > 0 ? entry.winRate + "%" : "—"}
                  </span>

                  {/* Tier */}
                  <div>
                    <TierBadge tier={entry.tier} />
                  </div>

                  {/* Profit */}
                  <div style={{ textAlign: "right" }}>
                    <span style={{
                      fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                      color: entry.games > 0 ? profitColor : "rgba(255,255,255,0.2)",
                      textShadow: entry.games > 0 && isHov ? `0 0 12px ${profitGlow}` : undefined,
                    }}>
                      {entry.games > 0 ? fmtProfit(entry.totalWon) : "—"}
                    </span>
                  </div>

                  {/* Trend */}
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <TrendBadge delta={entry.trendDelta} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer note */}
      <p style={{
        marginTop: 14, fontSize: 10, textAlign: "center",
        color: "rgba(255,255,255,0.18)", letterSpacing: "0.04em",
      }}>
        LIVE DATA · BOTS EXCLUDED · TREND TRACKS RANK CHANGES BETWEEN VISITS
      </p>

      {/* Spin keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </PageWrapper>
  );
}
