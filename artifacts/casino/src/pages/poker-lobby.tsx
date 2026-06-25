import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePageTracker } from "../lib/usePageTracker";
import { ChevronLeft, Users, Lock } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmtChips(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

const THEME_STYLES: Record<string, { bg: string; accent: string; badge: string }> = {
  velvet:  { bg: "from-[#7b1a1a] via-[#9e2020] to-[#5c1010]", accent: "#f87171", badge: "♠" },
  gold:    { bg: "from-[#7a5c00] via-[#b8860b] to-[#5a4000]", accent: "#fbbf24", badge: "👑" },
  diamond: { bg: "from-[#2d1a5c] via-[#4a2d8a] to-[#1a0d40]", accent: "#a78bfa", badge: "💎" },
};

interface PokerTable {
  id: number;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  rakePercent: number;
  rakeCap: number;
  theme: string;
  status: string;
  hasPassword: boolean;
  seats: { playerId: number | null }[];
}

export default function PokerLobby() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });

  usePageTracker("poker-lobby", sessionToken);

  const [tables, setTables] = useState<PokerTable[]>([]);
  const [loading, setLoading] = useState(true);

  const displayChips = currentPlayer?.chips ?? 0;

  function fetchTables() {
    fetch(`${BASE}/api/tables`, { headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {} })
      .then((r) => r.json())
      .then((data: any[]) => {
        setTables(data.filter((t) => !t.tournamentId));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  useEffect(() => {
    fetchTables();
    const iv = setInterval(fetchTables, 6000);
    return () => clearInterval(iv);
  }, [sessionToken]);

  // Table page handles password prompt natively when player tries to sit
  function joinTable(table: PokerTable) {
    setLocation(`/table/${table.id}`);
  }

  const openTables = tables.filter((t) => t.status !== "closed");

  return (
    <div style={{ minHeight: "100dvh", background: "#0a0a0f", color: "#fff", fontFamily: "inherit" }}>

      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 50,
        background: "rgba(10,10,15,0.95)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "0 20px", height: 52,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button
          onClick={() => setLocation("/lobby")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.45)", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "6px 8px", borderRadius: 8 }}
        >
          <ChevronLeft style={{ width: 16, height: 16 }} /> Table Games
        </button>
        <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)" }} />
        <span style={{ fontSize: 18, fontWeight: 700, background: "linear-gradient(90deg, #fff 0%, rgba(255,255,255,0.6) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          ♠ Poker Tables
        </span>
        <span style={{ marginLeft: "auto", fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          {fmtChips(displayChips)} chips
        </span>
      </div>

      {/* Subtitle */}
      <div style={{ textAlign: "center", padding: "18px 20px 4px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
        {loading ? "Loading…" : openTables.length === 0 ? "No tables open — ask a dealer to open one." : `${openTables.length} table${openTables.length !== 1 ? "s" : ""} open · Texas Hold'em`}
      </div>

      {/* Tables grid */}
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "16px 20px 40px" }}>
        {loading ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 80, fontSize: 15 }}>Loading tables…</div>
        ) : tables.length === 0 ? (
          <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", padding: 80, fontSize: 15 }}>
            No tables available. Ask a dealer to open one.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {tables.map((t) => {
              const style = THEME_STYLES[t.theme] ?? THEME_STYLES.velvet;
              const seated = t.seats.filter((s) => s.playerId).length;
              const totalSeats = t.seats.length;
              const isClosed = t.status === "closed";
              const isPlaying = t.status === "playing";
              const isFinished = t.status === "finished";
              const canJoin = !isClosed;

              return (
                <div key={t.id} style={{
                  borderRadius: 16, overflow: "hidden",
                  border: `1px solid rgba(255,255,255,${canJoin ? "0.12" : "0.05"})`,
                  opacity: canJoin ? 1 : 0.5,
                  display: "flex", flexDirection: "column",
                }}>
                  {/* Banner */}
                  <div className={`relative bg-gradient-to-br ${style.bg}`} style={{ padding: "20px 20px 16px", minHeight: 96 }}>
                    <div style={{ position: "relative", zIndex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 28 }}>{style.badge}</span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {t.hasPassword && (
                            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "rgba(0,0,0,0.35)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)", display: "flex", alignItems: "center", gap: 3 }}>
                              <Lock style={{ width: 10, height: 10 }} /> Private
                            </span>
                          )}
                          <span style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 99,
                            background: isClosed ? "rgba(239,68,68,0.2)" : isPlaying ? "rgba(250,204,21,0.2)" : "rgba(34,197,94,0.2)",
                            color: isClosed ? "#f87171" : isPlaying ? "#fde047" : "#4ade80",
                            border: `1px solid ${isClosed ? "rgba(239,68,68,0.3)" : isPlaying ? "rgba(250,204,21,0.3)" : "rgba(34,197,94,0.3)"}`,
                          }}>
                            {isClosed ? "Closed" : isPlaying ? "In Progress" : isFinished ? "Hand Over" : "Open"}
                          </span>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, color: "#fff" }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                        {t.theme === "velvet" ? "Classic" : t.theme === "gold" ? "High Roller" : "VIP"} · {totalSeats} seats
                      </div>
                    </div>
                  </div>

                  {/* Info rows */}
                  <div style={{ background: "#111118", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Blinds</span>
                      <span style={{ color: "#fff", fontWeight: 600 }}>{fmtChips(t.smallBlind)} / {fmtChips(t.bigBlind)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Buy-in</span>
                      <span style={{ color: "#fff" }}>{fmtChips(t.minBuyIn)} – {fmtChips(t.maxBuyIn)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Players</span>
                      <span style={{ color: "#fff", display: "flex", alignItems: "center", gap: 4 }}>
                        <Users style={{ width: 13, height: 13 }} />
                        {seated} / {totalSeats}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>Rake</span>
                      <span style={{ color: "rgba(255,255,255,0.6)" }}>{t.rakePercent}% (cap {fmtChips(t.rakeCap)})</span>
                    </div>

                    <button
                      disabled={!canJoin}
                      onClick={() => canJoin && joinTable(t)}
                      style={{
                        marginTop: 4,
                        padding: "10px 0",
                        borderRadius: 10,
                        border: "none",
                        fontWeight: 700,
                        fontSize: 14,
                        cursor: canJoin ? "pointer" : "not-allowed",
                        background: canJoin
                          ? `linear-gradient(135deg, ${style.accent}33, ${style.accent}55)`
                          : "rgba(255,255,255,0.04)",
                        color: canJoin ? style.accent : "rgba(255,255,255,0.2)",
                        borderTop: `1px solid ${canJoin ? style.accent + "40" : "rgba(255,255,255,0.06)"}`,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {isClosed ? "Table Closed" : "Join Table"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
