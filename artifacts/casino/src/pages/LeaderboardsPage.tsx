import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageWrapper } from "./shared";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ITEMS_PER_PAGE = 10;

/* ── Types ─────────────────────────────────────────────────────────────────── */
type ApiEntry = {
  id: number;
  username: string;
  games: number;
  wins: number;
  winRate: number;
  biggestWin: number;
  chips: number;
  avatarUrl: string | null;
  staffRole: string | null;
};

type RankedEntry = ApiEntry & {
  rank: number;
  prevRank: number | null;
  trendDelta: number | null;
};

/* ── Constants ──────────────────────────────────────────────────────────────── */

const RANK_1_GRADIENT = "linear-gradient(135deg, rgba(255,215,0,0.18) 0%, rgba(255,215,0,0.04) 100%)";
const RANK_2_GRADIENT = "linear-gradient(135deg, rgba(192,192,192,0.14) 0%, rgba(192,192,192,0.03) 100%)";
const RANK_3_GRADIENT = "linear-gradient(135deg, rgba(205,127,50,0.16) 0%, rgba(205,127,50,0.03) 100%)";

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function fmtBiggestWin(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return "$" + (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return "$" + n.toLocaleString();
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

/* ── Sub-components ──────────────────────────────────────────────────────────── */

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

/* ── Pagination component ────────────────────────────────────────────────────── */
function LeaderboardPagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const [hovBtn, setHovBtn] = useState<string | null>(null);

  const pageNumbers: number[] = [];
  const delta = 2;
  const rangeStart = Math.max(1, currentPage - delta);
  const rangeEnd   = Math.min(totalPages, currentPage + delta);
  for (let i = rangeStart; i <= rangeEnd; i++) pageNumbers.push(i);
  if (rangeStart > 1) { pageNumbers.unshift(-1); pageNumbers.unshift(1); }
  if (rangeEnd < totalPages) { pageNumbers.push(-2); pageNumbers.push(totalPages); }

  const btnBase: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: 34, minWidth: 34, padding: "0 12px", borderRadius: 8,
    fontSize: 12, fontWeight: 800, letterSpacing: "0.04em",
    cursor: "pointer", border: "1px solid",
    transition: "all 0.18s ease",
    userSelect: "none",
  };

  const navBtn = (key: string, label: string, page: number, disabled: boolean): React.ReactNode => {
    const hov = hovBtn === key && !disabled;
    return (
      <motion.button
        key={key}
        whileTap={disabled ? {} : { scale: 0.94 }}
        onMouseEnter={() => !disabled && setHovBtn(key)}
        onMouseLeave={() => setHovBtn(null)}
        onClick={() => !disabled && onPageChange(page)}
        style={{
          ...btnBase,
          borderColor: disabled
            ? "rgba(255,255,255,0.06)"
            : hov ? "rgba(168,85,247,0.6)" : "rgba(255,255,255,0.12)",
          background: disabled
            ? "rgba(255,255,255,0.02)"
            : hov ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.04)",
          color: disabled ? "rgba(255,255,255,0.2)" : hov ? "#c084fc" : "rgba(255,255,255,0.6)",
          boxShadow: hov ? "0 0 18px rgba(168,85,247,0.2)" : "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {label}
      </motion.button>
    );
  };

  return (
    <div style={{
      marginTop: 14,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "12px 20px", borderRadius: 14,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      backdropFilter: "blur(12px)",
    }}>
      {navBtn("prev", "← Prev", currentPage - 1, currentPage === 1)}

      <div style={{ display: "flex", gap: 4, marginLeft: 6, marginRight: 6 }}>
        {pageNumbers.map((n, idx) => {
          if (n < 0) {
            return (
              <span key={`ellipsis-${idx}`} style={{
                ...btnBase, border: "none", background: "none",
                color: "rgba(255,255,255,0.22)", minWidth: 24, padding: 0,
              }}>
                …
              </span>
            );
          }
          const isActive = n === currentPage;
          const hov = hovBtn === `pg-${n}` && !isActive;
          return (
            <motion.button
              key={n}
              whileTap={{ scale: 0.9 }}
              onMouseEnter={() => !isActive && setHovBtn(`pg-${n}`)}
              onMouseLeave={() => setHovBtn(null)}
              onClick={() => !isActive && onPageChange(n)}
              style={{
                ...btnBase,
                minWidth: 34, padding: 0,
                borderColor: isActive ? "rgba(168,85,247,0.7)" : hov ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.08)",
                background: isActive
                  ? "rgba(168,85,247,0.22)"
                  : hov ? "rgba(168,85,247,0.1)" : "rgba(255,255,255,0.03)",
                color: isActive ? "#e9d5ff" : hov ? "#c084fc" : "rgba(255,255,255,0.45)",
                boxShadow: isActive ? "0 0 20px rgba(168,85,247,0.35), inset 0 0 12px rgba(168,85,247,0.08)" : "none",
                cursor: isActive ? "default" : "pointer",
              }}
            >
              {n}
            </motion.button>
          );
        })}
      </div>

      {navBtn("next", "Next →", currentPage + 1, currentPage === totalPages)}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────────── */
export function LeaderboardsPage() {
  const { playerId, playerUsername } = useStore();
  const [data, setData]         = useState<ApiEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [hovered, setHovered]   = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageDir, setPageDir]   = useState<1 | -1>(1);
  const snapshotSaved = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);

  /* fetch — public endpoint, no auth required */
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/players/leaderboard`)
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e?.error ?? "Failed")))
      .then((rows: ApiEntry[]) => { setData(rows); setLoading(false); setCurrentPage(1); })
      .catch((e: any) => { setError(typeof e === "string" ? e : "Failed to load"); setLoading(false); });
  }, []);

  /* sorted + ranked + trend — biggestWin DESC → wins DESC → games DESC */
  const ranked = useMemo((): RankedEntry[] => {
    const copy = [...data].sort((a, b) =>
      b.biggestWin !== a.biggestWin ? b.biggestWin - a.biggestWin :
      b.wins !== a.wins             ? b.wins - a.wins :
                                      b.games - a.games
    );
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

  /* pagination */
  const totalPages = Math.max(1, Math.ceil(ranked.length / ITEMS_PER_PAGE));
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex   = startIndex + ITEMS_PER_PAGE;
  const paginated  = ranked.slice(startIndex, endIndex);

  const goToPage = useCallback((page: number) => {
    const clamped = Math.max(1, Math.min(totalPages, page));
    setPageDir(clamped >= currentPage ? 1 : -1);
    setCurrentPage(clamped);
    setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [currentPage, totalPages]);

  const myEntry = ranked.find(e => e.id === playerId || e.username === playerUsername);
  const myRank  = myEntry?.rank ?? null;

  const colLayout = "48px 1fr 72px 72px 100px 68px";

  return (
    <PageWrapper title="Leaderboards" breadcrumb="The Hub / Leaderboards" accentColor="#a855f7" fillHeight>

      {/* ── Your rank banner ────────────────────────────────────────────── */}
      {!loading && !error && myRank !== null && (
        <div style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", borderRadius: 12, marginBottom: 10,
          background: "rgba(168,85,247,0.07)",
          border: "1px solid rgba(168,85,247,0.22)",
        }}>
          <span style={{ fontSize: 16 }}>
            {myRank <= 3 ? ["🥇","🥈","🥉"][myRank - 1] : `#${myRank}`}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Your current rank ·{" "}
            <span style={{ color: "#c084fc", fontWeight: 800 }}>#{myRank}</span>
            {" "}of {ranked.length} players
            {myEntry && myEntry.trendDelta !== null && myEntry.trendDelta !== 0 && (
              <span style={{ marginLeft: 8 }}>
                <TrendBadge delta={myEntry.trendDelta} />
                {" "}since last visit
              </span>
            )}
            {myRank > 0 && (
              <button
                onClick={() => goToPage(Math.ceil(myRank / ITEMS_PER_PAGE))}
                style={{
                  marginLeft: 12, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em",
                  padding: "2px 8px", borderRadius: 6, cursor: "pointer",
                  background: "rgba(168,85,247,0.15)", color: "#c084fc",
                  border: "1px solid rgba(168,85,247,0.35)",
                }}
              >
                JUMP TO MY PAGE
              </button>
            )}
          </span>
        </div>
      )}

      {/* ── Table card ──────────────────────────────────────────────────── */}
      <div
        ref={tableRef}
        style={{
          flex: 1, minHeight: 0,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.02)",
          backdropFilter: "blur(12px)",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
        }}
      >
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
          <span style={{ textAlign: "right" }}>Biggest Win</span>
          <span style={{ textAlign: "center" }}>Trend</span>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              border: "2px solid transparent", borderTopColor: "#a855f7",
              animation: "spin 0.7s linear infinite",
            }} />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Loading leaderboard…</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "rgba(255,100,100,0.55)" }}>
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && ranked.length === 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "rgba(255,255,255,0.22)" }}>
            No players yet
          </div>
        )}

        {/* Rows with page transition */}
        {!loading && !error && ranked.length > 0 && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, y: pageDir * 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: pageDir * -12 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            >
              {paginated.map((entry, i) => {
                const isMe  = entry.id === playerId || entry.username === playerUsername;
                const isHov = hovered === entry.id && !isMe;

                let rowBg = "transparent";
                if (isMe) rowBg = "rgba(168,85,247,0.09)";
                else if (isHov) rowBg = "rgba(255,255,255,0.025)";
                else if (entry.rank === 1) rowBg = RANK_1_GRADIENT;
                else if (entry.rank === 2) rowBg = RANK_2_GRADIENT;
                else if (entry.rank === 3) rowBg = RANK_3_GRADIENT;

                const profitColor = "#22c55e";
                const profitGlow  = "rgba(34,197,94,0.3)";

                let winRateColor = "rgba(255,255,255,0.5)";
                if (entry.winRate >= 65)      winRateColor = "#22c55e";
                else if (entry.winRate >= 50) winRateColor = "rgba(255,255,255,0.75)";
                else if (entry.winRate > 0)   winRateColor = "#f97316";

                return (
                  <div
                    key={entry.id}
                    onMouseEnter={() => setHovered(entry.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      flex: 1,
                      display: "grid", gridTemplateColumns: colLayout,
                      padding: "0 20px", alignItems: "center",
                      background: rowBg,
                      borderBottom: i < paginated.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                      boxShadow: isMe ? "inset 3px 0 0 rgba(168,85,247,0.7)" : undefined,
                      transition: "background 0.15s ease, box-shadow 0.15s ease",
                      cursor: "default", position: "relative",
                    }}
                  >
                    {/* Rank */}
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <RankCell rank={entry.rank} />
                    </div>

                    {/* Player */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      {entry.avatarUrl ? (
                        <img
                          src={entry.avatarUrl} alt=""
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

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 13, fontWeight: 800,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
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
                    <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.45)" }}>
                      {fmtGames(entry.games)}
                    </span>

                    {/* Win % */}
                    <span style={{
                      fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                      color: entry.games > 0 ? winRateColor : "rgba(255,255,255,0.2)",
                    }}>
                      {entry.games > 0 ? entry.winRate + "%" : "—"}
                    </span>

                    {/* Biggest Win */}
                    <div style={{ textAlign: "right" }}>
                      <span style={{
                        fontSize: 13, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                        color: entry.biggestWin > 0 ? profitColor : "rgba(255,255,255,0.2)",
                        textShadow: entry.biggestWin > 0 && isHov ? `0 0 12px ${profitGlow}` : undefined,
                      }}>
                        {entry.biggestWin > 0 ? fmtBiggestWin(entry.biggestWin) : "—"}
                      </span>
                    </div>

                    {/* Trend */}
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <TrendBadge delta={entry.trendDelta} />
                    </div>
                  </div>
                );
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {!loading && !error && (
        <LeaderboardPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={goToPage}
        />
      )}

      {/* Footer note */}
      <p style={{
        marginTop: 12, fontSize: 10, textAlign: "center",
        color: "rgba(255,255,255,0.18)", letterSpacing: "0.04em",
      }}>
        LIVE DATA · TREND TRACKS RANK CHANGES BETWEEN VISITS
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </PageWrapper>
  );
}
