import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ChevronLeft, Lock } from "lucide-react";
import { useStore } from "../store";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";
import { usePageTracker } from "../lib/usePageTracker";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

export default function LiveEventsPage() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("live-events");

  const [horseStatus, setHorseStatus] = useState<{ status: string; enabled?: boolean; hasPassword?: boolean; minBet?: number; maxBet?: number } | null>(null);
  const [activeTournamentCount, setActiveTournamentCount] = useState(0);
  const [tournamentSummary, setTournamentSummary] = useState<{ totalPrizePool: number } | null>(null);
  const [tournamentsEnabled, setTournamentsEnabled] = useState(false);
  const { enter, modalNode } = useGameLauncher();

  useEffect(() => {
    if (!sessionToken) { setLocation("/login"); return; }
  }, [sessionToken]);

  useEffect(() => {
    const load = () => {
      fetch(`${BASE}/api/horse/status`).then(r => r.json()).then(setHorseStatus).catch(() => {});
      fetch(`${BASE}/api/settings`).then(r => r.json()).then((s: any) => setTournamentsEnabled(!!s.tournamentsEnabled)).catch(() => {});
      fetch(`${BASE}/api/tournaments`).then(r => r.json()).then((ts: any[]) => {
        if (!Array.isArray(ts)) return;
        const active = ts.filter((t: any) => t.status === "active" || t.status === "running");
        setActiveTournamentCount(active.length);
        const totalPrizePool = active.reduce((s: number, t: any) => s + (t.prizePool ?? 0), 0);
        setTournamentSummary({ totalPrizePool });
      }).catch(() => {});
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  function handleEnterHorseRacing() {
    if (!horseEnabled) return;
    enter(GAMES.horse, horseStatus?.hasPassword);
  }

  const horseEnabled = !!horseStatus && horseStatus.enabled !== false;
  const horseLabel = !horseEnabled ? "Closed"
    : horseStatus?.status === "betting" ? "Betting Open"
    : horseStatus?.status === "running"  ? "Race Running"
    : horseStatus?.status === "finished" ? "Next race soon"
    : "Waiting for race";
  const myHorseRacing = horseEnabled
    && horseStatus?.status === "running"
    && Array.isArray((horseStatus as any).horses)
    && (horseStatus as any).horses.some((h: any) => h.ownerId === playerId);

  if (!sessionToken) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#fff", display: "flex", flexDirection: "column" }}>
      {modalNode}

      {/* Nav bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={() => setLocation("/lobby")}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", color: "rgba(255,255,255,0.55)", cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 0" }}
        >
          <ChevronLeft size={18} /> LOBBY
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🎟️</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}>LIVE EVENTS</span>
        </div>
        <div style={{ width: 80 }} />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ textAlign: "center", padding: "36px 24px 24px" }}
      >
        <h1 style={{ fontWeight: 900, fontSize: "clamp(26px, 5vw, 42px)", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0, lineHeight: 1.1, background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Live Events
        </h1>
        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, letterSpacing: "0.12em", marginTop: 10, textTransform: "uppercase" }}>
          Horse Racing · Tournaments · Bingo · Lottery
        </p>
        <div style={{ width: 60, height: 2, margin: "16px auto 0", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
      </motion.div>

      {/* Card grid */}
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", flexWrap: "wrap", gap: 14, padding: "16px 32px 48px" }}>

        {/* Horse Racing */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
          onClick={handleEnterHorseRacing}
          disabled={!horseEnabled}
          className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
          style={{ width: 200, height: 280, background: "#040e05", flexShrink: 0, boxShadow: myHorseRacing ? "0 0 0 2.5px #f97316, 0 0 18px 4px rgba(249,115,22,0.35)" : undefined }}
        >
          <img src={`${IMGS}images/card-horseracing.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.92) 100%)" }} />
          {!horseEnabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
          <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
            <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Horse Racing</p>
            <p style={{ color: myHorseRacing ? "#f97316" : horseEnabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
              {myHorseRacing ? "🏇 Your horse is racing!" : horseLabel}
            </p>
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
          <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: horseEnabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
          {myHorseRacing && <div className="absolute top-2 right-2"><span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(249,115,22,0.85)", color: "#fff" }}>Racing</span></div>}
          {!myHorseRacing && horseStatus?.hasPassword && horseEnabled && <div className="absolute top-2 right-2"><span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span></div>}
        </motion.button>

        {/* Tournaments */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
          onClick={() => enter(GAMES.tournaments)}
          className="group relative rounded-2xl overflow-hidden cursor-pointer focus:outline-none"
          style={{ width: 200, height: 280, background: "#100800", flexShrink: 0 }}
        >
          <img src={`${IMGS}images/card-tournaments.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.92) 100%)" }} />
          <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
            <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Tournaments</p>
            {activeTournamentCount > 0 && tournamentSummary ? (
              <p style={{ color: "#4ade80", fontSize: "12px", marginTop: "3px", fontWeight: 600 }}>🔥 {activeTournamentCount} Active · {tournamentSummary.totalPrizePool.toLocaleString()} pool</p>
            ) : (
              <p style={{ color: "rgba(251,191,36,0.9)", fontSize: "12px", marginTop: "3px" }}>No active tournaments</p>
            )}
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
          <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: activeTournamentCount > 0 ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
          {activeTournamentCount > 0 && <div className="absolute top-2 right-2"><span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(34,197,94,0.9)", color: "#fff" }}>LIVE</span></div>}
        </motion.button>

        {/* Bingo */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          onClick={() => enter(GAMES.bingo)}
          className="group relative rounded-2xl overflow-hidden cursor-pointer focus:outline-none"
          style={{ width: 200, height: 280, background: "#050010", flexShrink: 0 }}
        >
          <img src={`${IMGS}images/card-bingo.png`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.92) 100%)" }} />
          <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
            <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Bingo</p>
            <p style={{ color: "rgba(168,85,247,0.9)", fontSize: "12px", marginTop: "3px" }}>Live dealer event</p>
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
          <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#4ade80" }} /></div>
        </motion.button>

        {/* Lottery */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          onClick={() => enter(GAMES.lottery)}
          className="group relative rounded-2xl overflow-hidden cursor-pointer focus:outline-none"
          style={{ width: 200, height: 280, background: "#0d0900", flexShrink: 0 }}
        >
          <img src={`${IMGS}images/card-lottery.png`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.92) 100%)" }} />
          <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
            <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Lottery</p>
            <p style={{ color: "rgba(251,191,36,0.9)", fontSize: "12px", marginTop: "3px" }}>Weekly jackpot draw</p>
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(251,191,36,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
          <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: "#fbbf24" }} /></div>
        </motion.button>

      </div>

      <div style={{ textAlign: "center", padding: "0 0 24px", color: "rgba(255,255,255,0.15)", fontSize: 11, letterSpacing: "0.1em" }}>
        BIG HOUSE CASINO · EST. LOS SANTOS
      </div>
    </div>
  );
}
