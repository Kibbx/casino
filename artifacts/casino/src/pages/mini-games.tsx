import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ChevronLeft, Lock } from "lucide-react";
import { useStore } from "../store";
import { useGetSlotsStatus } from "@workspace/api-client-react";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";
import { usePageTracker } from "../lib/usePageTracker";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

export default function MiniGamesPage() {
  const [, setLocation] = useLocation();
  const { sessionToken } = useStore();
  usePageTracker("mini-games");

  const { data: slotsStatus } = useGetSlotsStatus({ query: { refetchInterval: 10000 } });
  const [minesStatus, setMinesStatus] = useState<{ enabled: boolean; hasPassword?: boolean } | null>(null);
  const [kenoStatus, setKenoStatus] = useState<{ enabled: boolean; hasPassword?: boolean } | null>(null);
  const [mobTowerStatus, setMobTowerStatus] = useState<{ enabled: boolean; minBet?: number; maxBet?: number } | null>(null);
  const [casesStatus, setCasesStatus] = useState<{ enabled: boolean; hasPassword?: boolean } | null>(null);
  const { enter, modalNode } = useGameLauncher();

  useEffect(() => {
    if (!sessionToken) { setLocation("/login"); return; }
  }, [sessionToken]);

  useEffect(() => {
    const load = () => {
      fetch(`${BASE}/api/mines/status`).then(r => r.json()).then(setMinesStatus).catch(() => {});
      fetch(`${BASE}/api/keno/status`).then(r => r.json()).then(setKenoStatus).catch(() => {});
      fetch(`${BASE}/api/mob-tower/status`).then(r => r.json()).then(setMobTowerStatus).catch(() => {});
      fetch(`${BASE}/api/cases/game-settings`).then(r => r.json()).then(setCasesStatus).catch(() => {});
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

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
          <span style={{ fontSize: 16 }}>🎮</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}>MINI GAMES</span>
        </div>
        <div style={{ width: 80 }} />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ textAlign: "center", padding: "36px 24px 24px" }}
      >
        <h1 style={{ fontWeight: 900, fontSize: "clamp(26px, 5vw, 42px)", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0, lineHeight: 1.1, background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Pick Your Game
        </h1>
        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, letterSpacing: "0.12em", marginTop: 10, textTransform: "uppercase" }}>
          Slots · Mines · Keno · Mob Tower · Cases
        </p>
        <div style={{ width: 60, height: 2, margin: "16px auto 0", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
      </motion.div>

      {/* Card grid */}
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", flexWrap: "wrap", gap: 14, padding: "16px 32px 48px" }}>

        {/* Slot Machines */}
        {(() => {
          const enabled = !!slotsStatus?.enabled;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
              onClick={() => enabled && enter(GAMES.slots, (slotsStatus as any)?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#040207", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-backalley-slots.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.9) 100%)" }} />
              <div className="absolute top-2 left-1/2" style={{ transform: "translateX(-50%)" }}>
                <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: "10px", letterSpacing: "0.16em", color: "rgba(251,191,36,0.9)", background: "rgba(0,0,0,0.65)", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 4, padding: "2px 8px", textTransform: "uppercase" }}>2 MACHINES</span>
              </div>
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Slot Machines</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled && slotsStatus ? `${slotsStatus.minBet.toLocaleString()} – ${slotsStatus.maxBet.toLocaleString()} chips` : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {(slotsStatus as any)?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Mines */}
        {(() => {
          const enabled = !!minesStatus && minesStatus.enabled !== false;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
              onClick={() => enabled && enter(GAMES.mines, minesStatus?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#080204", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-mines.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Mines</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled ? "Pick tiles, cash out" : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {minesStatus?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Keno */}
        {(() => {
          const enabled = !!kenoStatus && kenoStatus.enabled !== false;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
              onClick={() => enabled && enter(GAMES.keno, kenoStatus?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#070a0f", flexShrink: 0 }}
            >
              <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #070a0f 0%, #0d1520 50%, #080c14 100%)" }} />
              <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(251,191,36,0.14) 0%, transparent 70%)" }} />
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: 70 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "5px", padding: "12px" }}>
                  {[3,14,22,31,40,7,19,25,33,38,11,28,35,42,17,6,23,37,44,9].map((n, i) => (
                    <div key={n} style={{
                      width: "30px", height: "30px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "11px", fontWeight: 700, fontFamily: "Oswald,sans-serif",
                      background: i < 6 ? "linear-gradient(135deg, #7a5c00, #c49a0c)" : "rgba(255,255,255,0.05)",
                      border: i < 6 ? "1px solid #fbbf24" : "1px solid rgba(255,255,255,0.08)",
                      color: i < 6 ? "#fff" : "#374151",
                      boxShadow: i < 6 ? "0 0 8px rgba(251,191,36,0.4)" : "none",
                    }}>{n}</div>
                  ))}
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Keno</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled ? "Pick numbers, win big" : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {kenoStatus?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Mob Tower */}
        {(() => {
          const enabled = mobTowerStatus?.enabled === true;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
              onClick={() => enabled && enter(GAMES.mobtower)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#08020f", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-mob-tower.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.88) 100%)" }} />
              <div className="absolute top-2 left-1/2" style={{ transform: "translateX(-50%)" }}>
                <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: "10px", letterSpacing: "0.14em", color: "rgba(167,139,250,0.95)", background: "rgba(0,0,0,0.65)", border: "1px solid rgba(124,58,237,0.5)", borderRadius: 4, padding: "2px 8px", textTransform: "uppercase", whiteSpace: "nowrap" }}>UP TO 24.86×</span>
              </div>
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Mob Tower</p>
                <p style={{ color: enabled ? "rgba(167,139,250,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled && mobTowerStatus?.minBet != null
                    ? `${mobTowerStatus.minBet.toLocaleString()} – ${mobTowerStatus.maxBet!.toLocaleString()} chips`
                    : enabled ? "8 floors · pick 1 of 3" : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(124,58,237,0.08)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Case Opening */}
        {(() => {
          const enabled = !!casesStatus && casesStatus.enabled !== false;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}
              onClick={() => enabled && enter(GAMES.cases, casesStatus?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#0a0a0a", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-cases.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Case Opening</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled ? "Open now" : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {casesStatus?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

      </div>

      <div style={{ textAlign: "center", padding: "0 0 24px", color: "rgba(255,255,255,0.15)", fontSize: 11, letterSpacing: "0.1em" }}>
        BIG HOUSE CASINO · EST. LOS SANTOS
      </div>
    </div>
  );
}
