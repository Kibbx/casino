import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { PageWrapper, CardGrid } from "./shared";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

const NEON_COLORS: Record<string, string> = {
  poker: "#f97316",
  slots: "#06b6d4",
};

function fmtChips(n: number): string {
  if (n === 0) return "FREE";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n.toLocaleString()}`;
}

function fmtDuration(mins: number | null): string {
  if (!mins) return "Open";
  if (mins < 60) return `~${mins}m`;
  const h = mins / 60;
  return `~${h % 1 === 0 ? h : h.toFixed(1)} hrs`;
}

function statusLabel(s: string): string {
  if (s === "registering") return "OPEN";
  if (s === "running") return "LIVE";
  return "ENDED";
}

function TourneyCard({ t, myPlayerId, sessionToken, onRegistered }: {
  t: LiveTournament;
  myPlayerId: number | null;
  sessionToken: string | null;
  onRegistered: () => void;
}) {
  const [, setLocation] = useLocation();
  const [hov, setHov] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const neon = NEON_COLORS[t.type] ?? "#f97316";
  const registeredCount = t.registeredCount;
  const pct = t.maxPlayers > 0 ? Math.min(100, Math.round((registeredCount / t.maxPlayers) * 100)) : 0;
  const isFull = registeredCount >= t.maxPlayers;

  const isRegistered = myPlayerId
    ? t.entries.some((e) => e.playerId === myPlayerId && (e.status === "registered" || e.status === "active"))
    : false;

  const canRegister = t.status === "registering" && !isRegistered && !isFull;

  async function handleRegister() {
    if (!sessionToken) {
      setErr("You must be logged in to register.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`${BASE}/api/tournaments/${t.id}/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as any).error ?? "Registration failed.");
      } else {
        onRegistered();
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleCardClick() {
    setLocation(`/tournament/${t.id}`);
  }

  const typeLabel = t.type === "poker"
    ? `Texas Hold'em${t.rebuysEnabled ? " · Rebuys" : ""}`
    : `Slots · ${t.slotGame === "fortuna" ? "Fortuna" : "Deadwood $"}`;

  const prizeDisplay = t.prizePool > 0 ? fmtChips(t.prizePool) : fmtChips(t.basePrizePool);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#0c0a0a",
        border: `1px solid ${neon}33`,
        boxShadow: hov ? `0 0 20px ${neon}22` : "none",
        transition: "box-shadow 0.2s",
        width: 280,
        minWidth: 260,
        flexShrink: 0,
        cursor: "pointer",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={handleCardClick}
    >
      {/* Header stripe */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${neon}22`, background: `${neon}08` }}
      >
        <span className="font-rajdhani font-black text-sm uppercase tracking-wider text-white truncate pr-2">
          {t.name}
        </span>
        <div className="flex gap-1.5 flex-shrink-0">
          {t.status === "running" && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase" style={{ background: "#ef4444", color: "#fff" }}>
              LIVE
            </span>
          )}
          <span
            className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase"
            style={{ color: neon, background: `${neon}22`, border: `1px solid ${neon}44` }}
          >
            {statusLabel(t.status)}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Buy-in", fmtChips(t.buyIn)],
            ["Prize Pool", prizeDisplay],
            ["Type", t.type === "poker" ? "Poker" : "Slots"],
            ["Duration", fmtDuration(t.durationMinutes)],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>{label}</p>
              <p className="text-[12px] font-bold" style={{ color: "rgba(255,255,255,0.80)" }}>{val}</p>
            </div>
          ))}
        </div>

        {/* Registration bar */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{typeLabel}</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{registeredCount}/{t.maxPlayers} registered</span>
          </div>
          <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-1.5 rounded-full transition-all"
              style={{ width: `${pct}%`, background: neon, boxShadow: `0 0 6px ${neon}` }}
            />
          </div>
        </div>

        {err && (
          <p className="text-[10px] text-red-400">{err}</p>
        )}

        {isRegistered ? (
          <button
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider"
            style={{
              background: `${neon}22`,
              color: neon,
              border: `1px solid ${neon}55`,
            }}
            onClick={handleCardClick}
          >
            ✓ Registered — View
          </button>
        ) : canRegister ? (
          <button
            disabled={busy}
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150 disabled:opacity-50"
            style={{
              background: hov ? neon : "transparent",
              color: hov ? "#060404" : neon,
              border: `1px solid ${neon}55`,
              boxShadow: hov ? `0 0 16px ${neon}55` : "none",
            }}
            onClick={handleRegister}
          >
            {busy ? "Registering…" : "Register Now"}
          </button>
        ) : t.status === "running" ? (
          <button
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider"
            style={{ color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}
            onClick={handleCardClick}
          >
            In Progress — View
          </button>
        ) : isFull ? (
          <button
            disabled
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider opacity-40"
            style={{ color: neon, border: `1px solid ${neon}33` }}
          >
            Full
          </button>
        ) : null}
      </div>
    </div>
  );
}

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
      setTournaments(data.filter((t) => t.status !== "finished"));
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

  const content = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-24">
          <p className="text-muted-foreground text-sm">Loading tournaments…</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center py-24">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      );
    }
    if (!lobbyEnabled) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-2xl">🎰</p>
          <p className="font-rajdhani font-black text-lg text-white uppercase tracking-wider">Tournaments Coming Soon</p>
          <p className="text-sm text-muted-foreground">No tournaments are open right now. Check back later.</p>
        </div>
      );
    }
    if (tournaments.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-2xl">🏆</p>
          <p className="font-rajdhani font-black text-lg text-white uppercase tracking-wider">No Active Tournaments</p>
          <p className="text-sm text-muted-foreground">No tournaments are open right now. Check back later.</p>
        </div>
      );
    }
    return (
      <CardGrid gap={20}>
        {tournaments.map((t) => (
          <TourneyCard
            key={t.id}
            t={t}
            myPlayerId={playerId ?? null}
            sessionToken={sessionToken ?? null}
            onRegistered={fetchData}
          />
        ))}
      </CardGrid>
    );
  };

  return (
    <PageWrapper title="Tournaments" breadcrumb="Events / Tournaments" accentColor="#f97316">
      {content()}
    </PageWrapper>
  );
}
