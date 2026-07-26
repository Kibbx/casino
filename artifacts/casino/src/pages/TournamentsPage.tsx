import { useState, useEffect, useCallback } from "react";
import { PageWrapper } from "./shared";
import { useLocation } from "wouter";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { motion } from "framer-motion";
import { Users, Clock, Trophy, Zap, Shield, Star, Gift, ChevronRight } from "lucide-react";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

/* ── Types ─────────────────────────────────────────────────────────────────── */
interface LiveTournament {
  id: number;
  name: string;
  description: string | null;
  type: string;
  buyIn: number;
  startingChips: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBet: number | null;
  maxBet: number | null;
  slotGame: string;
  status: "registering" | "running" | "finished";
  prizePool: number;
  basePrizePool: number;
  buyInPrizePercent: number;
  durationMinutes: number | null;
  endTime: string | null;
  createdAt: string;
  rebuysEnabled: boolean;
  maxRebuys: number;
  registeredCount: number;
  entries: { playerId: number; status: string }[];
}

/* ── Theme config per tournament type ──────────────────────────────────────── */
const THEMES: Record<string, {
  primary: string; secondary: string; glow: string;
  img: string; categoryIcon: string; categoryLabel: string;
}> = {
  poker: {
    primary:       "#f97316",
    secondary:     "#fbbf24",
    glow:          "rgba(249,115,22,0.35)",
    img:           "card-poker.webp",
    categoryIcon:  "♠",
    categoryLabel: "Texas Hold'em",
  },
  slots: {
    primary:       "#a855f7",
    secondary:     "#ec4899",
    glow:          "rgba(168,85,247,0.35)",
    img:           "card-slots.webp",
    categoryIcon:  "◆",
    categoryLabel: "Slots",
  },
};

function getTheme(type: string) {
  return THEMES[type] ?? THEMES.poker;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function fmtChips(n: number): string {
  if (n === 0) return "FREE";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n.toLocaleString()}`;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

/* ── CountdownTimer ─────────────────────────────────────────────────────────── */
function CountdownTimer({ endTime, color }: { endTime: string | null; color: string }) {
  const [display, setDisplay] = useState("--:--:--");

  useEffect(() => {
    if (!endTime) { setDisplay("∞"); return; }

    function tick() {
      const diff = Math.max(0, new Date(endTime!).getTime() - Date.now());
      if (diff === 0) { setDisplay("00:00:00"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setDisplay(`${pad(h)}:${pad(m)}:${pad(s)}`);
    }

    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [endTime]);

  return (
    <span style={{
      fontFamily: "monospace", fontWeight: 900, fontSize: 15,
      color, letterSpacing: "0.04em",
      textShadow: `0 0 12px ${color}80`,
    }}>
      {display}
    </span>
  );
}

/* ── StatusBadge ────────────────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "4px 10px", borderRadius: 999,
          background: "rgba(239,68,68,0.9)", color: "#fff",
          fontSize: 10, fontWeight: 900, letterSpacing: "0.1em",
          textTransform: "uppercase",
          boxShadow: "0 0 12px rgba(239,68,68,0.6)",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse 1.2s ease-in-out infinite" }} />
          LIVE
        </span>
      </div>
    );
  }
  if (status === "registering") {
    return (
      <span style={{
        display: "inline-flex", padding: "4px 10px", borderRadius: 999,
        background: "rgba(34,197,94,0.15)", color: "#4ade80",
        border: "1px solid rgba(34,197,94,0.4)",
        fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
        boxShadow: "0 0 10px rgba(34,197,94,0.2)",
      }}>
        OPEN
      </span>
    );
  }
  return (
    <span style={{
      display: "inline-flex", padding: "4px 10px", borderRadius: 999,
      background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)",
      fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase",
    }}>
      ENDED
    </span>
  );
}

/* ── StatPanel ──────────────────────────────────────────────────────────────── */
function StatPanel({ label, value, icon: Icon, accent }: {
  label: string; value: React.ReactNode;
  icon: React.ElementType; accent: string;
}) {
  return (
    <div style={{
      flex: 1, minWidth: 72,
      padding: "7px 11px", borderRadius: 10,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.07)",
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <Icon size={11} style={{ color: accent, opacity: 0.8 }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>
        {value}
      </div>
    </div>
  );
}

/* ── TournamentCard ─────────────────────────────────────────────────────────── */
function TournamentCard({ t, myPlayerId, sessionToken, onRegistered, index }: {
  t: LiveTournament;
  myPlayerId: number | null;
  sessionToken: string | null;
  onRegistered: () => void;
  index: number;
}) {
  const [, setLocation] = useLocation();
  const [hov, setHov] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const theme = getTheme(t.type);

  const pct = t.maxPlayers > 0 ? Math.min(100, Math.round((t.registeredCount / t.maxPlayers) * 100)) : 0;
  const isFull = t.registeredCount >= t.maxPlayers;
  const isRegistered = myPlayerId
    ? t.entries.some(e => e.playerId === myPlayerId && (e.status === "registered" || e.status === "active"))
    : false;
  const canRegister = t.status === "registering" && !isRegistered && !isFull;

  const prizeDisplay = t.prizePool > 0 ? fmtChips(t.prizePool) : fmtChips(t.basePrizePool);
  const slotName = t.slotGame === "fortuna" ? "Fortuna" : t.slotGame === "deadwood" ? "Deadwood $" : t.slotGame;
  const typeLabel = t.type === "poker"
    ? `Texas Hold'em${t.rebuysEnabled ? " · Rebuys" : ""}`
    : `Slots · ${slotName}`;

  async function handleRegister(e: React.MouseEvent) {
    e.stopPropagation();
    if (!sessionToken) { setErr("You must be logged in."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${BASE}/api/tournaments/${t.id}/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setErr((b as any).error ?? "Registration failed.");
      } else {
        fireChallengeEvent("tournament_entered");
        onRegistered();
      }
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  function handleView(e: React.MouseEvent) {
    e.stopPropagation();
    setLocation(`/tournament/${t.id}`);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.12, ease: [0.23, 1, 0.32, 1] }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={handleView}
      style={{
        width: "100%", maxWidth: 1100,
        margin: "0 auto",
        borderRadius: 20,
        overflow: "hidden",
        position: "relative",
        cursor: "pointer",
        border: `1px solid ${hov ? theme.primary + "55" : "rgba(255,255,255,0.07)"}`,
        background: "rgba(8,6,6,0.95)",
        boxShadow: hov
          ? `0 0 40px ${theme.glow}, 0 20px 60px rgba(0,0,0,0.6)`
          : "0 8px 32px rgba(0,0,0,0.4)",
        transform: hov ? "translateY(-3px) scale(1.003)" : "translateY(0) scale(1)",
        transition: "all 0.25s cubic-bezier(0.23, 1, 0.32, 1)",
        display: "flex", flexDirection: "row",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* ── Left artwork ────────────────────────────────────────────── */}
      <div style={{
        width: "36%", minWidth: 240, flexShrink: 0,
        position: "relative", overflow: "hidden",
      }}>
        {/* Background image */}
        <img
          src={`${IMGS}images/${theme.img}`}
          alt=""
          style={{
            width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center",
            transform: hov ? "scale(1.06)" : "scale(1)",
            transition: "transform 0.5s ease",
          }}
        />
        {/* Gradient overlay — fade right */}
        <div style={{
          position: "absolute", inset: 0,
          background: `linear-gradient(to right, transparent 40%, rgba(8,6,6,0.98) 100%), linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, transparent 40%, rgba(0,0,0,0.4) 100%)`,
        }} />
        {/* Glow overlay */}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at 30% 50%, ${theme.glow} 0%, transparent 65%)`,
          opacity: hov ? 0.5 : 0.25,
          transition: "opacity 0.3s ease",
          mixBlendMode: "screen",
        }} />
        {/* Status badge — top left */}
        <div style={{ position: "absolute", top: 14, left: 14 }}>
          <StatusBadge status={t.status} />
        </div>
      </div>

      {/* ── Right content ────────────────────────────────────────────── */}
      <div style={{
        flex: 1, padding: "14px 22px 14px",
        display: "flex", flexDirection: "column", gap: 9,
        position: "relative",
      }} onClick={e => e.stopPropagation()}>

        {/* Type badge — top right */}
        <div style={{ position: "absolute", top: 18, right: 20 }}>
          <span style={{
            padding: "4px 12px", borderRadius: 999,
            border: `1px solid ${theme.primary}55`,
            background: `${theme.primary}15`,
            color: theme.primary,
            fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase",
          }}>
            {t.type === "poker" ? "POKER" : "SLOTS"}
          </span>
        </div>

        {/* Category + Title */}
        <div style={{ paddingRight: 80 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ color: theme.primary, fontSize: 13, lineHeight: 1 }}>{theme.categoryIcon}</span>
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: "0.14em",
              textTransform: "uppercase", color: theme.primary,
            }}>
              {theme.categoryLabel}
            </span>
          </div>
          <h2 style={{
            fontSize: "clamp(15px, 1.8vw, 21px)",
            fontWeight: 900, letterSpacing: "0.04em",
            textTransform: "uppercase", color: "#ffffff",
            lineHeight: 1.1, margin: 0,
            textShadow: `0 0 24px ${theme.glow}`,
          }}>
            {t.name}
          </h2>
          {t.description && (
            <p style={{
              marginTop: 5, fontSize: 12.5,
              color: "rgba(255,255,255,0.45)", lineHeight: 1.4,
            }}>
              {t.description.replace(/<[^>]+>/g, "")}
            </p>
          )}
        </div>

        {/* Stat panels */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatPanel label="Buy-In"     value={fmtChips(t.buyIn)}          icon={Trophy} accent={theme.primary} />
          <StatPanel label="Prize Pool" value={
            <span style={{ color: prizeDisplay === "FREE" ? "#4ade80" : "#fff" }}>{prizeDisplay}</span>
          } icon={Gift} accent={theme.primary} />
          <StatPanel label="Players"    value={
            <span style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
              <span style={{ color: theme.primary }}>{t.registeredCount}</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>/ {t.maxPlayers}</span>
            </span>
          } icon={Users} accent={theme.primary} />
          <StatPanel label={t.status === "running" ? "Ends In" : "Duration"} value={
            t.status === "running" && t.endTime
              ? <CountdownTimer endTime={t.endTime} color={theme.primary} />
              : <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>
                  {t.durationMinutes ? `${t.durationMinutes < 60 ? t.durationMinutes + "m" : (t.durationMinutes / 60).toFixed(0) + "h"}` : "Open"}
                </span>
          } icon={Clock} accent={theme.primary} />
        </div>

        {/* Progress bar */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)" }}>{typeLabel}</span>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.30)" }}>
              {t.registeredCount}/{t.maxPlayers} registered · {pct}% filled
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${pct}%`, borderRadius: 999,
              background: `linear-gradient(90deg, ${theme.primary}, ${theme.secondary})`,
              boxShadow: `0 0 8px ${theme.glow}`,
              transition: "width 0.6s ease",
            }} />
          </div>
        </div>

        {err && <p style={{ fontSize: 10, color: "#f87171", margin: 0 }}>{err}</p>}

        {/* CTA Button */}
        <div>
          {isRegistered ? (
            <button
              onClick={handleView}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", maxWidth: 360, padding: "10px 20px", borderRadius: 10,
                background: `linear-gradient(135deg, ${theme.primary}cc, ${theme.secondary}88)`,
                border: `1px solid ${theme.primary}88`,
                color: "#fff", fontSize: 12, fontWeight: 900,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                boxShadow: hov ? `0 0 28px ${theme.glow}` : `0 0 14px ${theme.glow}60`,
                transition: "box-shadow 0.2s ease",
              }}
            >
              ✓ REGISTERED — VIEW <ChevronRight size={14} />
            </button>
          ) : canRegister ? (
            <button
              onClick={handleRegister}
              disabled={busy}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", maxWidth: 360, padding: "10px 20px", borderRadius: 10,
                background: hov
                  ? `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})`
                  : `linear-gradient(135deg, ${theme.primary}22, ${theme.secondary}11)`,
                border: `1px solid ${theme.primary}66`,
                color: hov ? "#000" : theme.primary,
                fontSize: 12, fontWeight: 900,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: busy ? "wait" : "pointer",
                boxShadow: hov ? `0 0 32px ${theme.glow}` : "none",
                transition: "all 0.2s ease",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "REGISTERING…" : "REGISTER NOW"} <ChevronRight size={14} />
            </button>
          ) : t.status === "running" ? (
            <button
              onClick={handleView}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                width: "100%", maxWidth: 360, padding: "10px 20px", borderRadius: 10,
                background: `linear-gradient(135deg, ${theme.primary}18, ${theme.secondary}0a)`,
                border: `1px solid ${theme.primary}44`,
                color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 900,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              IN PROGRESS — VIEW <ChevronRight size={14} />
            </button>
          ) : isFull ? (
            <button
              disabled
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "100%", maxWidth: 360, padding: "10px 20px", borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.25)", fontSize: 12, fontWeight: 900,
                letterSpacing: "0.1em", textTransform: "uppercase", cursor: "not-allowed",
              }}
            >
              TOURNAMENT FULL
            </button>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Feature strip ──────────────────────────────────────────────────────────── */
const FEATURES = [
  { icon: Trophy,  color: "#f97316", title: "BIG PRIZES",    desc: "Win huge from massive prize pools!" },
  { icon: Users,   color: "#f59e0b", title: "FAIR PLAY",     desc: "Secure, fair and transparent tournaments." },
  { icon: Zap,     color: "#ec4899", title: "LIVE ACTION",   desc: "Real-time tournaments with real players." },
  { icon: Gift,    color: "#a855f7", title: "DAILY EVENTS",  desc: "New tournaments every day." },
];

function FeatureStrip() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      style={{
        display: "flex", gap: 12, flexWrap: "wrap",
        padding: "18px 20px", borderRadius: 16,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {FEATURES.map(f => (
        <div key={f.title} style={{ flex: "1 1 180px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: `${f.color}18`, border: `1px solid ${f.color}30`,
          }}>
            <f.icon size={15} style={{ color: f.color }} />
          </div>
          <div>
            <p style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: f.color, margin: "0 0 2px", textTransform: "uppercase" }}>{f.title}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, lineHeight: 1.4 }}>{f.desc}</p>
          </div>
        </div>
      ))}
    </motion.div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────── */
export function TournamentsPage() {
  const { sessionToken, playerId } = useStore();
  const [tournaments, setTournaments] = useState<LiveTournament[]>([]);
  const [lobbyEnabled, setLobbyEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [enabledRes, tournyRes] = await Promise.all([
        fetch(`${BASE}/api/tournaments/lobby-enabled`),
        fetch(`${BASE}/api/tournaments`),
      ]);
      const { enabled } = await enabledRes.json();
      const data: LiveTournament[] = await tournyRes.json();
      setLobbyEnabled(enabled);
      setTournaments(data.filter(t => t.status !== "finished"));
    } catch {
      setError("Failed to load tournaments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5_000);
    return () => clearInterval(id);
  }, [fetchData]);

  return (
    <PageWrapper title="Tournaments" breadcrumb="Events / Tournaments" accentColor="#f97316" fillHeight>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "64px 0", gap: 12 }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%",
              border: "2px solid transparent", borderTopColor: "#f97316",
              animation: "spin 0.7s linear infinite",
            }} />
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>Loading tournaments…</span>
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", padding: "48px 0", color: "rgba(255,100,100,0.6)", fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && !lobbyEnabled && tournaments.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ textAlign: "center", padding: "64px 0" }}
          >
            <p style={{ fontSize: 32, marginBottom: 12 }}>🎰</p>
            <p style={{ fontSize: 18, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fff", marginBottom: 8 }}>
              Tournaments Coming Soon
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>No tournaments are open right now. Check back later.</p>
          </motion.div>
        )}

        {!loading && !error && lobbyEnabled && tournaments.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ textAlign: "center", padding: "64px 0" }}
          >
            <p style={{ fontSize: 32, marginBottom: 12 }}>🏆</p>
            <p style={{ fontSize: 18, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fff", marginBottom: 8 }}>
              No Active Tournaments
            </p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>No tournaments are open right now. Check back later.</p>
          </motion.div>
        )}

        {!loading && !error && tournaments.map((t, i) => (
          <TournamentCard
            key={t.id}
            t={t}
            myPlayerId={playerId ?? null}
            sessionToken={sessionToken ?? null}
            onRegistered={fetchData}
            index={i}
          />
        ))}

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </PageWrapper>
  );
}
