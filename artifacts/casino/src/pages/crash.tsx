import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { PromoZone } from "../components/PromoRegion";
import { awardXP } from "../lib/rewardsState";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, TrendingUp, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Quadratic exponent: m = exp(A*t + B*t²), t in seconds — must match API server
const CRASH_A = 0.04;
const CRASH_B = 0.001;

const GW = 500;
const GH = 220;
const GP = { left: 48, right: 12, top: 16, bottom: 32 };
const IW = GW - GP.left - GP.right;
const IH = GH - GP.top - GP.bottom;

function getMultiplier(elapsedMs: number): number {
  const t = elapsedMs / 1000;
  return Math.exp(CRASH_A * t + CRASH_B * t * t);
}

// Inverse: solve B*t² + A*t - ln(m) = 0 for t
function crashTimeMs(cp: number): number {
  const lnM = Math.log(cp);
  const t = (-CRASH_A + Math.sqrt(CRASH_A * CRASH_A + 4 * CRASH_B * lnM)) / (2 * CRASH_B);
  return t * 1000;
}

// 0=safe 1=warm 2=hot 3=critical
function tensionLevel(m: number): number {
  if (m >= 15) return 3;
  if (m >= 7) return 2;
  if (m >= 3) return 1;
  return 0;
}

function fmt(m: number): string {
  return m.toFixed(2) + "x";
}

type GameState = "idle" | "playing" | "cashed_out" | "crashed";

interface GraphPoint { t: number; m: number; }

function buildSvgPath(points: GraphPoint[], maxT: number, maxM: number): string {
  if (points.length < 2) return "";
  const scaleX = (t: number) => GP.left + (t / maxT) * IW;
  const scaleY = (m: number) => GP.top + IH - ((m - 1) / Math.max(maxM - 1, 0.5)) * IH;
  const pts = points.map(p => `${scaleX(p.t).toFixed(1)},${scaleY(p.m).toFixed(1)}`);
  return "M" + pts.join("L");
}

export default function Crash() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("crash", sessionToken);
  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));
  usePasswordGuard("crash");

  const [betAmount, setBetAmount] = useState("200");
  const [gameState, setGameState] = useState<GameState>("idle");
  const [gameId, setGameId] = useState<number | null>(null);
  const [liveMultiplier, setLiveMultiplier] = useState(1.0);
  const [crashPoint, setCrashPoint] = useState<number | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [cashoutMultiplier, setCashoutMultiplier] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [autoCashout, setAutoCashout] = useState("");

  const [graphPath, setGraphPath] = useState("");
  const [rocketPos, setRocketPos] = useState({ x: GP.left, y: GP.top + IH });
  const [graphMaxM, setGraphMaxM] = useState(2);

  const startTimeRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gameIdRef = useRef<number | null>(null);
  const graphPointsRef = useRef<GraphPoint[]>([]);
  const autoCashoutRef = useRef(autoCashout);
  const isActiveRef = useRef(false); // rAF loop checks this to know if it should stop
  const sessionTokenRef = useRef(sessionToken);
  gameIdRef.current = gameId;
  autoCashoutRef.current = autoCashout;
  sessionTokenRef.current = sessionToken;

  useEffect(() => {
    fetch(`${BASE}/api/crash/status`).then((r) => r.json()).then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!playerId) setLocation("/login");
  }, [playerId]);
  useEffect(() => { if (!isGameUnlocked("crash")) setLocation("/lobby"); }, []);

  function stopAnimation() {
    isActiveRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }

  function stopPolling() {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }

  // Freeze graph at the crash point: trim data past crashT and snap the rocket
  function freezeAtCrash(cp: number) {
    const crashT = crashTimeMs(cp);
    const trimmed = graphPointsRef.current.filter(p => p.t <= crashT);
    if (trimmed.length === 0) trimmed.push({ t: 0, m: 1.0 });
    trimmed.push({ t: crashT, m: cp });

    const maxT = Math.max(crashT * 1.1, 1000);
    const maxM = Math.max(cp * 1.15, 2);
    const path = buildSvgPath(trimmed, maxT, maxM);
    const rx = GP.left + (crashT / maxT) * IW;
    const ry = GP.top + IH - ((cp - 1) / Math.max(maxM - 1, 0.5)) * IH;

    setGraphPath(path);
    setGraphMaxM(maxM);
    setRocketPos({ x: rx, y: ry });
    setLiveMultiplier(cp);
  }

  function startPolling(gId: number) {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      if (!isActiveRef.current) { stopPolling(); return; }
      try {
        const r = await fetch(`${BASE}/api/crash/${gId}/result`, {
          headers: { Authorization: `Bearer ${sessionTokenRef.current}` },
        });
        const d = await r.json();
        if (d.status === "crashed") {
          stopAnimation();
          stopPolling();
          const cp = d.crashPoint ?? 1.0;
          freezeAtCrash(cp);
          setCrashPoint(cp);
          setGameState("crashed");
          fireChallengeEvent("bet_lost");
        } else if (d.status === "cashed_out") {
          // Cashed out via another trigger — keep current animation state
          stopPolling();
        }
      } catch {
        // Network error — keep polling
      }
    }, 150);
  }

  const startAnimation = useCallback((anchorMs: number) => {
    startTimeRef.current = anchorMs;
    graphPointsRef.current = [{ t: 0, m: 1.0 }];
    isActiveRef.current = true;

    const loop = () => {
      if (!isActiveRef.current) return;

      const elapsed = Date.now() - (startTimeRef.current ?? Date.now());
      const m = getMultiplier(elapsed);

      graphPointsRef.current.push({ t: elapsed, m });

      const maxM = Math.max(m * 1.15, 2);
      const maxT = Math.max(elapsed, 1000);
      setGraphMaxM(maxM);
      setGraphPath(buildSvgPath(graphPointsRef.current, maxT, maxM));

      const rx = GP.left + (elapsed / maxT) * IW;
      const ry = GP.top + IH - ((m - 1) / Math.max(maxM - 1, 0.5)) * IH;
      setRocketPos({ x: rx, y: ry });
      setLiveMultiplier(m);

      const auto = parseFloat(autoCashoutRef.current);
      if (!isNaN(auto) && auto > 1 && m >= auto) {
        cashOut();
        return;
      }

      if (m < 200) {
        animFrameRef.current = requestAnimationFrame(loop);
      } else {
        fetchResult();
      }
    };
    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  async function cashOut() {
    const gId = gameIdRef.current;
    if (!gId) return;
    stopAnimation();
    stopPolling();
    try {
      const r = await fetch(`${BASE}/api/crash/${gId}/cashout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      });
      const d = await r.json();
      if (d.status === "cashed_out") {
        setGameState("cashed_out");
        setCashoutMultiplier(d.cashoutMultiplier);
        setPayout(d.payout);
        setCrashPoint(d.crashPoint);
        fireChallengeEvent("bet_won");
      } else {
        // Already crashed by the time cashout hit
        const cp = d.crashPoint ?? 1.0;
        freezeAtCrash(cp);
        setCrashPoint(cp);
        setGameState("crashed");
        fireChallengeEvent("bet_lost");
      }
    } catch {
      setGameState("crashed");
    }
  }

  async function fetchResult() {
    const gId = gameIdRef.current;
    if (!gId) return;
    stopAnimation();
    stopPolling();
    try {
      const r = await fetch(`${BASE}/api/crash/${gId}/result`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const d = await r.json();
      if (d.status === "cashed_out") {
        setGameState("cashed_out");
        setCashoutMultiplier(d.cashoutMultiplier);
        setPayout(d.payout);
        setCrashPoint(d.crashPoint);
      } else {
        const cp = d.crashPoint ?? 1.0;
        freezeAtCrash(cp);
        setCrashPoint(cp);
        setGameState("crashed");
      }
    } catch {}
  }

  async function placeBet() {
    const bet = parseInt(betAmount);
    if (!bet || bet <= 0) return;
    setErrorMsg(null);
    setGameState("playing");
    setCrashPoint(null);
    setPayout(null);
    setCashoutMultiplier(null);
    setLiveMultiplier(1.0);
    setGraphPath("");
    setGraphMaxM(2);
    setRocketPos({ x: GP.left, y: GP.top + IH });

    try {
      const clientBeforeMs = Date.now();
      const r = await fetch(`${BASE}/api/crash/play`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ bet }),
      });
      const d = await r.json();
      const clientAfterMs = Date.now();
      if (!r.ok) { setErrorMsg(d.error || "Failed to place bet"); setGameState("idle"); return; }
      awardXP(bet);
      // Challenge tracking — bet placed
      fireChallengeEvent("any_game_round_played");
      fireChallengeEvent("bet_wagered", { amount: bet });
      fireChallengeEvent("single_bet_placed", { amount: bet });
      setGameId(d.gameId);

      // Account for full RTT: half of it was transit after the server stamped serverNowMs
      const rtt = clientAfterMs - clientBeforeMs;
      const serverElapsed = (d.serverNowMs - d.startedAtMs) + rtt / 2;
      const anchoredStart = clientAfterMs - Math.max(0, serverElapsed);
      startAnimation(anchoredStart);
      startPolling(d.gameId);
    } catch {
      setErrorMsg("Network error"); setGameState("idle");
    }
  }

  function reset() {
    stopAnimation();
    stopPolling();
    setGameState("idle");
    setGameId(null);
    setLiveMultiplier(1.0);
    setCrashPoint(null);
    setPayout(null);
    setCashoutMultiplier(null);
    setErrorMsg(null);
    setGraphPath("");
    setGraphMaxM(2);
    setRocketPos({ x: GP.left, y: GP.top + IH });
    startTimeRef.current = null;
    graphPointsRef.current = [];
  }

  const chips = liveChips ?? currentPlayer?.chips ?? 0;

  const tension = gameState === "playing" ? tensionLevel(liveMultiplier) : 0;

  const multColor =
    gameState === "crashed" ? "#ef4444"
    : gameState === "cashed_out" ? "#22c55e"
    : liveMultiplier >= 15 ? "#ef4444"
    : liveMultiplier >= 7  ? "#f97316"
    : liveMultiplier >= 3  ? "#f59e0b"
    : liveMultiplier >= 2  ? "#22c55e"
    : "#ffffff";

  const displayM = gameState === "cashed_out" ? (cashoutMultiplier ?? liveMultiplier)
    : gameState === "crashed" ? (crashPoint ?? liveMultiplier)
    : liveMultiplier;

  // Shake keyframes per tension level
  const shakeAnim = tension === 3
    ? { x: [0, -4, 4, -3, 3, -2, 2, 0], transition: { duration: 0.25, repeat: Infinity } }
    : tension === 2
    ? { x: [0, -2, 2, -1, 1, 0], transition: { duration: 0.35, repeat: Infinity } }
    : tension === 1
    ? { x: [0, -1, 1, 0], transition: { duration: 0.55, repeat: Infinity } }
    : {};

  const yTicks = [1, ...[graphMaxM * 0.33, graphMaxM * 0.66, graphMaxM].map(v => parseFloat(v.toFixed(1)))];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(135deg, #070710 0%, #0c0d1e 100%)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-red-800 bg-black/70 sticky top-0 z-10">
        <button onClick={() => { reset(); setLocation("/lobby"); }} className="flex items-center gap-1 text-muted-foreground hover:text-white transition-colors text-sm">
          <ChevronLeft className="w-4 h-4" /> Lobby
        </button>
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-orange-400" />
          <span className="font-display font-bold text-white tracking-wider text-sm uppercase">Crash</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-sm font-bold text-amber-400 tabular-nums">{chips.toLocaleString()} chips</span>
          {status && <span className="text-[10px] text-white/35 tabular-nums">{status.minBet.toLocaleString()}–{status.maxBet.toLocaleString()} limits</span>}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 gap-5">

        <div className="w-full max-w-lg rounded-3xl border border-white/10 overflow-hidden"
          style={{ background: "linear-gradient(180deg, #090912 0%, #0e0f20 100%)", boxShadow: `0 0 ${60 + tension * 30}px ${multColor}${["18","28","40","60"][tension]}` }}>

          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <div className="text-xs font-bold tracking-widest uppercase" style={{ color: multColor }}>
              {gameState === "crashed" ? `💥 CRASHED`
               : gameState === "cashed_out" ? `✅ CASHED OUT`
               : gameState === "playing" ? "🔴 LIVE"
               : "Place your bet"}
            </div>
            <motion.div animate={shakeAnim}>
              <motion.div
                key={Math.floor(displayM * 10)}
                initial={{ scale: 1.25, opacity: 0.6 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.1 }}
                className="font-display font-black tabular-nums"
                style={{ fontSize: 42, lineHeight: 1, color: multColor, textShadow: `0 0 ${tension * 15 + 20}px ${multColor}${tension > 0 ? "90" : "70"}` }}
              >
                {fmt(displayM)}
              </motion.div>
            </motion.div>
          </div>

          <div className="relative">
            <svg width="100%" viewBox={`0 0 ${GW} ${GH}`} style={{ display: "block" }}>
              <defs>
                <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={multColor} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={multColor} stopOpacity="0.02" />
                </linearGradient>
                <filter id="rocketGlow">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                <clipPath id="graphClip">
                  <rect x={GP.left} y={GP.top} width={IW} height={IH} />
                </clipPath>
              </defs>

              {[0.25, 0.5, 0.75, 1].map((frac) => (
                <line key={frac} x1={GP.left} y1={GP.top + IH * frac} x2={GP.left + IW} y2={GP.top + IH * frac}
                  stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              ))}
              {[0.25, 0.5, 0.75, 1].map((frac) => (
                <line key={frac} x1={GP.left + IW * frac} y1={GP.top} x2={GP.left + IW * frac} y2={GP.top + IH}
                  stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}

              {yTicks.map((tick, i) => {
                const y = GP.top + IH - (i / (yTicks.length - 1)) * IH;
                return (
                  <text key={i} x={GP.left - 6} y={y + 4} textAnchor="end"
                    fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">
                    {tick.toFixed(1)}x
                  </text>
                );
              })}

              <line x1={GP.left} y1={GP.top + IH} x2={GP.left + IW} y2={GP.top + IH}
                stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

              {graphPath && (
                <path
                  d={graphPath + `L${rocketPos.x.toFixed(1)},${GP.top + IH}L${GP.left},${GP.top + IH}Z`}
                  fill="url(#curveGrad)" clipPath="url(#graphClip)"
                />
              )}

              {graphPath && (
                <path d={graphPath} fill="none" stroke={multColor} strokeWidth="2.5"
                  strokeLinejoin="round" clipPath="url(#graphClip)"
                  style={{ filter: `drop-shadow(0 0 6px ${multColor}80)` }}
                />
              )}

              {gameState === "playing" && (
                <text x={rocketPos.x} y={rocketPos.y} fontSize="18"
                  textAnchor="middle" dominantBaseline="central" filter="url(#rocketGlow)"
                  style={{ transform: "rotate(-45deg)", transformOrigin: `${rocketPos.x}px ${rocketPos.y}px` }}>
                  🚀
                </text>
              )}

              {(gameState === "crashed") && (
                <text x={rocketPos.x} y={rocketPos.y} fontSize="20"
                  textAnchor="middle" dominantBaseline="central">
                  💥
                </text>
              )}

              {gameState === "cashed_out" && (
                <text x={rocketPos.x} y={rocketPos.y} fontSize="18"
                  textAnchor="middle" dominantBaseline="central">
                  💰
                </text>
              )}
            </svg>
          </div>

          <AnimatePresence>
            {(gameState === "cashed_out" || gameState === "crashed") && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="px-5 pb-4 text-center">
                {gameState === "cashed_out" && payout !== null && (
                  <span className="text-green-400 font-bold text-base">+{payout.toLocaleString()} chips at {fmt(cashoutMultiplier ?? 1)}</span>
                )}
                {gameState === "crashed" && (
                  <span className="text-red-400 font-bold text-base">Crashed at {fmt(crashPoint ?? 1)} — {parseInt(betAmount).toLocaleString()} chips lost</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="w-full max-w-lg space-y-3">
          {errorMsg && <p className="text-red-400 text-sm text-center">{errorMsg}</p>}

          {gameState === "idle" && (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/40 uppercase tracking-widest block mb-1">Bet Amount</label>
                <input type="number" value={betAmount} onChange={(e) => setBetAmount(e.target.value)}
                  min={status?.minBet ?? 50} max={status?.maxBet ?? 10000}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-lg font-bold text-center focus:outline-none focus:border-white/30" />
                <div className="flex gap-2 mt-2">
                  {[100, 250, 500, 1000].map((v) => (
                    <button key={v} onClick={() => setBetAmount(String(v))}
                      className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white/60 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
                      {v.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={placeBet} disabled={!status?.enabled}
                className="w-full py-4 rounded-2xl font-display font-black text-lg uppercase tracking-widest text-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg, #f97316, #ef4444)", boxShadow: "0 0 30px rgba(249,115,22,0.4)" }}>
                {status?.enabled ? "🚀 Launch Bet" : "Crash Closed"}
              </button>
            </div>
          )}

          {gameState === "playing" && (
            <button onClick={cashOut}
              className="w-full py-5 rounded-2xl font-display font-black text-2xl uppercase tracking-widest text-black transition-all active:scale-95 animate-pulse"
              style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)", boxShadow: "0 0 40px rgba(34,197,94,0.5)" }}>
              💰 CASH OUT {fmt(liveMultiplier)}
            </button>
          )}

          {(gameState === "cashed_out" || gameState === "crashed") && (
            <button onClick={reset}
              className="w-full py-4 rounded-2xl font-display font-bold text-lg uppercase tracking-widest text-white border border-white/20 hover:border-white/40 transition-all"
              style={{ background: "rgba(255,255,255,0.05)" }}>
              Play Again
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-white/20">
          <TrendingUp className="w-3 h-3" />
          <span>95% RTP · Cash out before the rocket crashes</span>
        </div>
      </div>
      <PromoZone pageKey="crash" />
    </div>
  );
}
