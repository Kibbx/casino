import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ChevronLeft, Lock } from "lucide-react";
import { useStore } from "../store";
import { useGetBlackjackStatus, useGetRouletteStatus, useListTables } from "@workspace/api-client-react";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";
import { usePageTracker } from "../lib/usePageTracker";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

export default function TableGamesPage() {
  const [, setLocation] = useLocation();
  const { sessionToken } = useStore();
  usePageTracker("table-games");

  const { data: bjStatus } = useGetBlackjackStatus({ query: { refetchInterval: 10000 } });
  const { data: rouletteStatus } = useGetRouletteStatus({ query: { refetchInterval: 10000 } });
  const { data: restTables = [] } = useListTables({});

  const [baccaratTables, setBaccaratTables] = useState<any[]>([]);
  const [highlowStatus, setHighlowStatus] = useState<{ enabled: boolean; hasPassword?: boolean } | null>(null);
  const { enter, modalNode } = useGameLauncher();

  useEffect(() => {
    if (!sessionToken) { setLocation("/login"); return; }
  }, [sessionToken]);

  useEffect(() => {
    const load = () => {
      fetch(`${BASE}/api/baccarat/tables`).then(r => r.json()).then(d => setBaccaratTables(Array.isArray(d) ? d : [])).catch(() => {});
      fetch(`${BASE}/api/high-low/status`).then(r => r.json()).then(setHighlowStatus).catch(() => {});
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const bacOpenTable = baccaratTables.find((t: any) => t.isOpen !== false);
  const bacEnabled = baccaratTables.length > 0 && !!bacOpenTable;
  const tables = (restTables as any[]).filter((t: any) => !t.tournamentId);
  const pokerOpenTables = tables.filter((t: any) => t.status !== "closed");
  const pokerSeated = tables.reduce((n: number, t: any) => n + t.seats.filter((s: any) => s.playerId).length, 0);
  const pokerEnabled = pokerOpenTables.length > 0;

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
          <span style={{ fontSize: 18 }}>♠</span>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "0.18em", color: "rgba(255,255,255,0.85)" }}>TABLE GAMES</span>
        </div>
        <div style={{ width: 80 }} />
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ textAlign: "center", padding: "36px 24px 24px" }}
      >
        <h1 style={{ fontWeight: 900, fontSize: "clamp(26px, 5vw, 42px)", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0, lineHeight: 1.1, background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          Pick Your Table
        </h1>
        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, letterSpacing: "0.12em", marginTop: 10, textTransform: "uppercase" }}>
          Blackjack · Roulette · Baccarat · Poker · High-Low
        </p>
        <div style={{ width: 60, height: 2, margin: "16px auto 0", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)" }} />
      </motion.div>

      {/* Card grid */}
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", flexWrap: "wrap", gap: 14, padding: "16px 32px 48px" }}>

        {/* Blackjack */}
        {(() => {
          const enabled = !!bjStatus?.enabled;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}
              onClick={() => enabled && enter(GAMES.blackjack, (bjStatus as any)?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#050a0f", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-blackjack.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Blackjack</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px", fontVariantNumeric: "tabular-nums" }}>
                  {enabled ? `${bjStatus!.minBet.toLocaleString()} – ${bjStatus!.maxBet.toLocaleString()} chips` : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {(bjStatus as any)?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Roulette */}
        {(() => {
          const enabled = !!rouletteStatus?.enabled;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}
              onClick={() => enabled && enter(GAMES.roulette, (rouletteStatus as any)?.hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#030e05", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-roulette.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Roulette</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {enabled ? `${rouletteStatus!.minBet.toLocaleString()} – ${rouletteStatus!.maxBet.toLocaleString()} chips` : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {(rouletteStatus as any)?.hasPassword && enabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Baccarat */}
        {(() => {
          const minBet = bacOpenTable?.minBet ?? 0;
          const maxBet = bacOpenTable?.maxBet ?? 0;
          const hasPw = !!bacOpenTable?.hasPassword;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
              onClick={() => bacEnabled && enter(GAMES.baccarat, hasPw)}
              disabled={!bacEnabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#020f08", flexShrink: 0 }}
            >
              <img src={`${IMGS}images/card-baccarat.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Baccarat</p>
                <p style={{ color: bacEnabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
                  {bacEnabled ? `${minBet.toLocaleString()} – ${maxBet.toLocaleString()} chips` : "Closed"}
                </p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!bacEnabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              {hasPw && bacEnabled && (
                <div className="absolute top-2 right-2">
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: "rgba(245,158,11,0.9)", color: "#000" }}><Lock className="w-2 h-2" /> Private</span>
                </div>
              )}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: bacEnabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
            </motion.button>
          );
        })()}

        {/* Poker */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}
          onClick={() => enter(GAMES.poker)}
          className="group relative rounded-2xl overflow-hidden cursor-pointer focus:outline-none"
          style={{ width: 200, height: 280, background: "#0f0303", flexShrink: 0 }}
        >
          <img src={`${IMGS}images/card-poker.webp`} alt="" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover", objectPosition: "center top" }} />
          <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "rgba(0,0,0,0.85)" }}>
            <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.2, margin: 0 }}>Poker</p>
            <p style={{ color: pokerEnabled ? "rgba(251,191,36,0.9)" : "rgba(248,113,113,0.9)", fontSize: "12px", marginTop: "3px" }}>
              {tables.length === 0 ? "No tables open" : `${pokerOpenTables.length} table${pokerOpenTables.length !== 1 ? "s" : ""} open · ${pokerSeated} seated`}
            </p>
          </div>
          <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
          <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: pokerEnabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
        </motion.button>

        {/* High-Low */}
        {(() => {
          const enabled = !!highlowStatus && highlowStatus.enabled !== false;
          const hasPassword = !!highlowStatus?.hasPassword;
          return (
            <motion.button
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}
              onClick={() => enabled && enter(GAMES.highlow, hasPassword)}
              disabled={!enabled}
              className="group relative rounded-2xl overflow-hidden cursor-pointer disabled:cursor-default focus:outline-none"
              style={{ width: 200, height: 280, background: "#07020c", flexShrink: 0 }}
            >
              <div className="absolute inset-0" style={{ background: "linear-gradient(160deg, #0d0410 0%, #130618 50%, #0a0210 100%)" }} />
              <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, rgba(140,15,35,0.18) 0%, transparent 70%)" }} />
              <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: 70 }}>
                <div style={{ position: "relative", width: 150, height: 125 }}>
                  <div style={{ position: "absolute", right: 0, top: 4, width: 80, height: 110, borderRadius: 10, background: "linear-gradient(155deg, #1a0a0e, #0e0408)", border: "1px solid rgba(160,20,45,0.35)", boxShadow: "0 6px 20px rgba(0,0,0,0.7)", transform: "rotate(6deg)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", inset: 6, borderRadius: 6, border: "1px solid rgba(160,20,45,0.3)" }} />
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 26, color: "rgba(200,30,60,0.4)", lineHeight: 1 }}>?</span>
                    </div>
                  </div>
                  <div style={{ position: "absolute", left: 0, top: 8, width: 80, height: 110, borderRadius: 10, background: "#f5f2ea", border: "1px solid rgba(0,0,0,0.12)", boxShadow: "0 8px 24px rgba(0,0,0,0.8)", transform: "rotate(-5deg)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 6, left: 7, lineHeight: 1 }}>
                      <div style={{ color: "#1a1a2e", fontSize: 16, fontWeight: 800, fontFamily: "Georgia,serif", lineHeight: 1 }}>A</div>
                      <div style={{ color: "#1a1a2e", fontSize: 11, lineHeight: 1 }}>♠</div>
                    </div>
                    <div style={{ position: "absolute", bottom: 6, right: 7, lineHeight: 1, transform: "rotate(180deg)" }}>
                      <div style={{ color: "#1a1a2e", fontSize: 16, fontWeight: 800, fontFamily: "Georgia,serif", lineHeight: 1 }}>A</div>
                      <div style={{ color: "#1a1a2e", fontSize: 11, lineHeight: 1 }}>♠</div>
                    </div>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 36, color: "#1a1a2e", lineHeight: 1, opacity: 0.85 }}>★</span>
                    </div>
                  </div>
                  <div style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)" }}>
                    <span style={{ color: "#4ade80", fontSize: 15, fontWeight: 900, lineHeight: 1, textShadow: "0 0 8px rgba(74,222,128,0.6)" }}>▲</span>
                  </div>
                  <div style={{ position: "absolute", bottom: -20, left: "50%", transform: "translateX(-50%)" }}>
                    <span style={{ color: "#f87171", fontSize: 15, fontWeight: 900, lineHeight: 1, textShadow: "0 0 8px rgba(248,113,113,0.6)" }}>▼</span>
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 inset-x-0 px-4 py-3" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.7) 100%)" }}>
                <p style={{ color: "#fff", fontWeight: 900, fontSize: "15px", textTransform: "uppercase", letterSpacing: "0.08em", lineHeight: 1.2, margin: 0 }}>High · Low</p>
                <p style={{ color: enabled ? "rgba(251,191,36,0.85)" : "rgba(248,113,113,0.9)", fontSize: "12px", margin: 0, marginTop: 3 }}>{enabled ? "Guess the next card" : "Closed"}</p>
              </div>
              <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0)", transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")} onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0)")} />
              {!enabled && <div className="absolute inset-0 rounded-2xl" style={{ background: "rgba(0,0,0,0.55)" }} />}
              <div className="absolute top-2 left-2"><span className="w-2 h-2 rounded-full inline-block" style={{ background: enabled ? "#4ade80" : "rgba(239,68,68,0.7)" }} /></div>
              {hasPassword && enabled && (
                <div className="absolute top-2 right-2 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: "rgba(0,0,0,0.7)", color: "rgba(251,191,36,0.9)", border: "1px solid rgba(251,191,36,0.3)" }}>
                  <Lock className="w-2 h-2" /> Private
                </div>
              )}
            </motion.button>
          );
        })()}

      </div>

      <div style={{ textAlign: "center", padding: "0 0 24px", color: "rgba(255,255,255,0.15)", fontSize: 11, letterSpacing: "0.1em" }}>
        BACK ALLEY BETS · EST. LOS SANTOS
      </div>
    </div>
  );
}
