import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { awardXP } from "../lib/rewardsState";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { playSound } from "../lib/sounds";
import buttonClickUrl from "@assets/buttonclick_1777322204907.mp3";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";

function playBtnClick() {
  try { const a = new Audio(buttonClickUrl); a.volume = 0.3; a.play().catch(() => {}); } catch {}
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// PAYTABLE[pickCount][hits] = multiplier — must mirror server keno.ts
// Partial hits pay modest amounts; high hit counts pay very well.
const PAYTABLE: Record<number, Record<number, number>> = {
  1:  { 1: 3 },
  2:  { 2: 13 },
  3:  { 2: 2,  3: 35 },
  4:  { 3: 3,  4: 60 },
  5:  { 4: 8,  5: 120 },
  6:  { 5: 10, 6: 300 },
  7:  { 5: 4,  6: 60,  7: 1000 },
  8:  { 6: 10, 7: 130, 8: 3500 },
  9:  { 7: 40, 8: 500, 9: 1000 },
  10: { 5: 2,  6: 8,  7: 30,  8: 200, 9: 1000, 10: 5000 },
};

const MAX_PAYOUT = 10_000_000;

type Phase = "idle" | "animating" | "result";

// tile state after a round
type TileResult = "idle" | "picked" | "hit" | "miss" | "drawn";

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// ── Keno grid tile ────────────────────────────────────────────────────────────

function KenoTile({
  num, state, clickable, onClick, justRevealed,
}: {
  num: number;
  state: TileResult;
  clickable: boolean;
  onClick: () => void;
  justRevealed: boolean;
}) {
  let bg = "#111118";
  let border = "1px solid rgba(255,255,255,0.07)";
  let color = "#9ca3af";
  let glow = "none";
  let scale = 1;

  if (state === "picked") {
    bg = "linear-gradient(135deg, #7a5c00, #c49a0c)";
    border = "1px solid #fbbf24";
    color = "#fff";
  } else if (state === "hit") {
    bg = "linear-gradient(135deg, #064e1e, #16a34a)";
    border = "2px solid #22c55e";
    color = "#fff";
    glow = "0 0 12px 2px rgba(34,197,94,0.5)";
    scale = justRevealed ? 1.12 : 1;
  } else if (state === "miss") {
    bg = "#0e0e14";
    border = "1px solid rgba(239,68,68,0.55)";
    color = "#ef4444";
  } else if (state === "drawn") {
    bg = "#1a2030";
    border = "1px solid rgba(100,130,200,0.35)";
    color = "#7aa0d4";
  }

  return (
    <motion.button
      animate={{ scale }}
      transition={{ type: "spring", stiffness: 600, damping: 20 }}
      onClick={clickable ? onClick : undefined}
      style={{
        width: "54px",
        height: "54px",
        flexShrink: 0,
        border,
        background: bg,
        borderRadius: "9px",
        color,
        fontSize: "16px",
        fontWeight: 700,
        cursor: clickable ? "pointer" : "default",
        boxShadow: glow,
        fontFamily: "'Oswald', sans-serif",
        transition: "background 0.15s, border 0.15s, color 0.15s, box-shadow 0.2s",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {num}
    </motion.button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Keno() {
  useGameClosedRedirect("keno", "/minigames");
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePasswordGuard("keno");
  useEffect(() => { if (!isGameUnlocked("keno")) setLocation("/lobby"); }, []);
  usePageTracker("keno", sessionToken);

  const { data: currentPlayer } = useGetPlayer(playerId!, {
    query: { enabled: !!playerId },
  });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const displayChips = liveChips ?? currentPlayer?.chips ?? 0;

  // ── Game state
  const [picks, setPicks] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [drawn, setDrawn] = useState<number[]>([]);
  const [revealedSet, setRevealedSet] = useState<Set<number>>(new Set());
  const [lastRevealedNum, setLastRevealedNum] = useState<number | null>(null);
  const [resultHits, setResultHits] = useState<number>(0);
  const [resultMult, setResultMult] = useState<number>(0);
  const [resultPayout, setResultPayout] = useState<number>(0);
  const [lastWin, setLastWin] = useState<number | null>(null);
  const [sessionDelta, setSessionDelta] = useState(0);
  const [betInput, setBetInput] = useState("500");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [gameStatus, setGameStatus] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [bigWin, setBigWin] = useState(false);
  const [lastBet, setLastBet] = useState<number>(0);

  // Auto bet
  const [autoPlay, setAutoPlay] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoRunningRef = useRef(false);
  const sessionDeltaRef = useRef(0);

  // Track tile states
  function getTileState(num: number): TileResult {
    if (phase === "idle") {
      return picks.includes(num) ? "picked" : "idle";
    }
    if (phase === "animating") {
      const isRevealed = revealedSet.has(num);
      const isPicked = picks.includes(num);
      if (isRevealed) {
        if (isPicked) return "hit";
        return "drawn";
      }
      return isPicked ? "picked" : "idle";
    }
    // result phase
    const isPicked = picks.includes(num);
    const isDrawn  = drawn.includes(num);
    if (isPicked && isDrawn) return "hit";
    if (isPicked && !isDrawn) return "miss";
    if (!isPicked && isDrawn) return "drawn";
    return "idle";
  }

  useEffect(() => {
    fetch(`${BASE}/api/keno/status`).then(r => r.json()).then(setGameStatus).catch(() => {});
  }, []);

  useEffect(() => { if (!playerId) setLocation("/lobby"); }, [playerId]);

  // Autoplay stop conditions
  useEffect(() => {
    sessionDeltaRef.current = sessionDelta;
  }, [sessionDelta]);

  function autoPick() {
    const count = picks.length || 10;
    const pool = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPicks(pool.slice(0, count));
  }

  function togglePick(num: number) {
    if (phase !== "idle") return;
    setPicks(prev => {
      if (prev.includes(num)) return prev.filter(n => n !== num);
      if (prev.length >= 10) return prev;
      return [...prev, num];
    });
  }

  async function runRound(isAuto = false): Promise<boolean> {
    if (!sessionToken) return false;
    const bet = parseInt(betInput);
    if (!bet || bet <= 0) { if (!isAuto) setErrorMsg("Enter a valid bet amount"); return false; }
    if (picks.length < 1) { if (!isAuto) setErrorMsg("Pick at least 1 number"); return false; }
    if (gameStatus && (bet < gameStatus.minBet || bet > gameStatus.maxBet)) {
      if (!isAuto) setErrorMsg(`Bet: ${gameStatus.minBet.toLocaleString()} – ${gameStatus.maxBet.toLocaleString()} chips`);
      return false;
    }

    setLastBet(bet);
    setIsLoading(true);
    setErrorMsg(null);
    setRevealedSet(new Set());
    setLastRevealedNum(null);
    setBigWin(false);

    try {
      const r = await fetch(`${BASE}/api/keno/play`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bet, picks }),
      });
      const d = await r.json();
      setIsLoading(false);
      if (!r.ok) { setErrorMsg(d.error || "Failed to play"); return false; }
      awardXP(bet);

      const { drawn: serverDrawn, hits, multiplier, payout } = d;

      setDrawn(serverDrawn);
      setResultHits(hits);
      setResultMult(multiplier);
      setResultPayout(payout);
      setPhase("animating");

      const profit = payout - bet;
      setSessionDelta(prev => prev + profit);

      // Animate reveal — tick for each ball, ding when it's a pick
      const pickSet = new Set(picks);
      for (const num of serverDrawn) {
        if (!autoRunningRef.current && isAuto) break;
        setRevealedSet(prev => new Set([...prev, num]));
        setLastRevealedNum(num);
        playSound(pickSet.has(num) ? "kenoHit" : "kenoTick");
        await sleep(110);
      }

      setPhase("result");
      setLastWin(payout);

      // ── Challenge events ───────────────────────────────────────────────────
      fireChallengeEvent("mini_game_round_played");
      if (bet > 0) {
        fireChallengeEvent("single_bet_placed", { amount: bet });
        fireChallengeEvent("bet_wagered", { amount: bet });
      }
      fireChallengeEvent(payout > 0 ? "bet_won" : "bet_lost");

      // Win / loss sound
      if (multiplier >= 50 || payout >= bet * 30) {
        playSound("jackpot");
        setBigWin(true);
        await sleep(1500);
        setBigWin(false);
      } else if (payout > 0) {
        playSound("win");
      } else {
        playSound("lose");
      }

      return true;
    } catch {
      setIsLoading(false);
      setErrorMsg("Connection error");
      return false;
    }
  }

  async function handleBet() {
    if (phase !== "idle" && phase !== "result") return;
    setPhase("idle");
    await runRound(false);
  }

  // Auto bet loop
  async function startAuto() {
    if (picks.length < 1) { setErrorMsg("Pick at least 1 number first"); return; }
    autoRunningRef.current = true;
    setAutoRunning(true);
    setSessionDelta(0);
    sessionDeltaRef.current = 0;

    while (autoRunningRef.current) {
      setPhase("idle");
      await sleep(400);
      if (!autoRunningRef.current) break;

      const ok = await runRound(true);
      if (!ok) { autoRunningRef.current = false; break; }

      await sleep(600);
    }

    setAutoRunning(false);
    autoRunningRef.current = false;
  }

  function stopAuto() {
    autoRunningRef.current = false;
    setAutoRunning(false);
  }

  function handleAutoToggle() {
    if (autoRunning) {
      stopAuto();
    } else if (autoPlay) {
      startAuto();
    }
  }

  // BET button press — starts single round or auto
  async function handlePlayPress() {
    playBtnClick();
    if (autoRunning) { stopAuto(); return; }
    if (phase === "animating" || isLoading) return;
    if (autoPlay) { startAuto(); return; }
    setPhase("idle");
    await runRound(false);
  }

  const isPlaying = phase === "animating" || isLoading;
  const canBet = gameStatus?.enabled !== false && !isPlaying && picks.length >= 1 && !autoRunning;

  // Multiplier preview table — keyed by pick count then hits
  const multRow = picks.length > 0 ? PAYTABLE[picks.length] ?? {} : null;

  const betNum = parseInt(betInput) || 0;
  const chartBet = betNum;

  // ── Render ────────────────────────────────────────────────────────────────────
  const sessionColor = sessionDelta > 0 ? "#22c55e" : sessionDelta < 0 ? "#ef4444" : "#6b7280";

  return (
    <div style={{ height: "100vh", background: "#08090e", color: "#e5e7eb", fontFamily: "'Oswald', sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0 12px", height: "42px", flexShrink: 0, background: "#0b0c12", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <button
          onClick={() => setLocation("/minigames")}
          style={{ display: "flex", alignItems: "center", gap: "3px", color: "#64748b", background: "none", border: "none", cursor: "pointer", fontSize: "12px", padding: "4px 8px", borderRadius: "6px" }}
        >
          <ChevronLeft size={14} /> Mini Games
        </button>
        <span style={{ color: "#fbbf24", fontWeight: 900, fontSize: "17px", letterSpacing: "0.1em", textTransform: "uppercase" }}>KENO</span>
        <div style={{ flex: 1 }} />
        {/* Inline stats */}
        {[
          { label: "BET", value: betNum > 0 ? fmt(betNum) : "—", c: "#9ca3af" },
          { label: "WIN", value: lastWin !== null ? fmt(lastWin) : "—", c: lastWin && lastWin > 0 ? "#22c55e" : "#6b7280" },
          { label: "SESSION", value: sessionDelta === 0 ? "—" : (sessionDelta >= 0 ? `+${fmt(sessionDelta)}` : fmt(sessionDelta)), c: sessionColor },
        ].map(({ label, value, c }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "0 10px", borderLeft: "1px solid rgba(255,255,255,0.06)" }}>
            <span style={{ color: "#4b5563", fontSize: "10px", letterSpacing: "0.06em" }}>{label}</span>
            <span style={{ color: c, fontWeight: 700, fontSize: "13px" }}>{value}</span>
          </div>
        ))}
        <div style={{ paddingLeft: "10px", borderLeft: "1px solid rgba(255,255,255,0.06)", color: "#6b7280", fontSize: "12px" }}>
          <span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(displayChips)}</span>
        </div>
      </div>

      {/* ── Error banner — fixed height slot so main area never shifts ── */}
      <div style={{ height: "28px", flexShrink: 0, overflow: "hidden" }}>
        <AnimatePresence>
          {errorMsg && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ height: "28px", background: "rgba(239,68,68,0.12)", borderBottom: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: "12px", padding: "0 12px", display: "flex", alignItems: "center" }}>
              {errorMsg}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Big win overlay ── */}
      <AnimatePresence>
        {bigWin && (
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2 }}
            style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)", pointerEvents: "none" }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "56px", fontWeight: 900, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.1em", textShadow: "0 0 40px rgba(251,191,36,0.9)" }}>BIG WIN!</div>
              <div style={{ fontSize: "28px", color: "#22c55e", fontWeight: 700, marginTop: "6px" }}>+{fmt(resultPayout)} chips</div>
              <div style={{ fontSize: "16px", color: "#fbbf24", marginTop: "4px" }}>{resultMult}× multiplier</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main area — whole game block top-anchored so heights never shift the grid ── */}
      {/* Grid is 10×54px + 9×5px gap = 585px wide. Left panel = 210px. Total = ~811px centered. */}
      <div style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "16px", paddingBottom: "10px", paddingLeft: "16px", paddingRight: "16px", overflow: "auto" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "flex-start" }}>

          {/* ── LEFT PANEL ── 210px fixed */}
          <div style={{ width: "210px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "8px" }}>

            {/* Bet amount */}
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "10px", border: "1px solid rgba(255,255,255,0.07)" }}>
              <label style={{ color: "#6b7280", fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Bet Amount</label>
              <input
                type="number" value={betInput} onChange={e => setBetInput(e.target.value)} disabled={isPlaying || autoRunning}
                style={{ width: "100%", background: "#0d0f14", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "7px", color: "#fff", padding: "7px 10px", fontSize: "15px", fontWeight: 700, fontFamily: "'Oswald', sans-serif", boxSizing: "border-box", outline: "none" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "4px", marginTop: "6px" }}>
                {[2, 5, 10, "Max"].map(m => (
                  <button key={m} disabled={isPlaying || autoRunning} onClick={() => {
                    if (m === "Max") setBetInput(String(gameStatus?.maxBet ?? displayChips));
                    else setBetInput(String(Math.min((parseInt(betInput) || 0) * (m as number), gameStatus?.maxBet ?? 999999999)));
                  }} style={{ padding: "4px 0", fontSize: "10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "5px", color: "#9ca3af", cursor: "pointer", fontFamily: "'Oswald', sans-serif" }}>
                    {m === "Max" ? "MAX" : `×${m}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Picks + pay chart */}
            <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: "10px", padding: "10px", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ color: "#6b7280", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Picks</span>
                <span style={{ fontWeight: 900, fontSize: "18px", color: picks.length > 0 ? "#fbbf24" : "#374151" }}>
                  {picks.length}<span style={{ color: "#374151", fontSize: "12px", fontWeight: 400 }}>/10</span>
                </span>
              </div>

              {picks.length > 0 && multRow ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "3px 4px 4px", marginBottom: "3px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ color: "#4b5563", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Hits</span>
                    <span style={{ color: "#4b5563", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>Mult</span>
                    <span style={{ color: "#4b5563", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Win</span>
                  </div>
                  {Object.entries(multRow)
                    .map(([h, m]) => [Number(h), m as number] as [number, number])
                    .filter(([h]) => h <= picks.length)
                    .sort((a, b) => b[0] - a[0])
                    .map(([h, m]) => {
                      const isCurrentHit = phase === "result" && resultHits === h;
                      const win = chartBet > 0 ? Math.min(Math.floor(chartBet * m), MAX_PAYOUT) : null;
                      return (
                        <div key={h} style={{
                          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                          padding: "4px", borderRadius: "6px", marginBottom: "2px",
                          background: isCurrentHit ? "rgba(34,197,94,0.12)" : "transparent",
                          border: isCurrentHit ? "1px solid rgba(34,197,94,0.3)" : "1px solid transparent",
                        }}>
                          <span style={{ color: isCurrentHit ? "#22c55e" : "#9ca3af", fontSize: "12px", fontWeight: isCurrentHit ? 700 : 400 }}>{h} hits</span>
                          <span style={{ color: "#fbbf24", fontSize: "12px", fontWeight: 700, textAlign: "center" }}>{m}×</span>
                          <span style={{ color: isCurrentHit ? "#22c55e" : "#6b7280", fontSize: "11px", fontWeight: isCurrentHit ? 700 : 400, textAlign: "right" }}>
                            {win !== null ? fmt(win) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  {(() => {
                    const minHits = Math.min(...Object.keys(multRow).map(Number));
                    const isMiss = phase === "result" && resultHits < minHits;
                    return (
                      <div style={{
                        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
                        padding: "4px", borderRadius: "6px",
                        background: isMiss ? "rgba(239,68,68,0.08)" : "transparent",
                        border: isMiss ? "1px solid rgba(239,68,68,0.25)" : "1px solid transparent",
                      }}>
                        <span style={{ color: isMiss ? "#ef4444" : "#4b5563", fontSize: "12px" }}>&lt;{minHits} hits</span>
                        <span style={{ color: "#374151", fontSize: "12px", fontWeight: 700, textAlign: "center" }}>0×</span>
                        <span style={{ color: "#374151", fontSize: "11px", textAlign: "right" }}>—</span>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <span style={{ color: "#374151", fontSize: "11px" }}>Pick numbers to see payouts</span>
              )}
            </div>

            {/* Auto Pick / Clear */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <button disabled={isPlaying || autoRunning} onClick={() => { playSound("chip"); autoPick(); }}
                style={{ padding: "8px 0", borderRadius: "8px", border: "1px solid rgba(251,191,36,0.3)", background: "rgba(251,191,36,0.08)", color: "#fbbf24", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'Oswald', sans-serif", textTransform: "uppercase" }}>
                Auto Pick
              </button>
              <button disabled={isPlaying || autoRunning} onClick={() => { playSound("buttonClick"); setPicks([]); }}
                style={{ padding: "8px 0", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#6b7280", fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "'Oswald', sans-serif", textTransform: "uppercase" }}>
                Clear
              </button>
            </div>

            {/* BET / STOP */}
            <button
              disabled={!canBet && !autoRunning}
              onClick={handlePlayPress}
              style={{
                width: "100%", padding: "13px 0", borderRadius: "9px", border: "none",
                background: autoRunning ? "linear-gradient(135deg, #7f1d1d, #991b1b)" : canBet ? "linear-gradient(135deg, #92400e, #d97706, #fbbf24)" : "rgba(255,255,255,0.05)",
                color: canBet || autoRunning ? "#fff" : "#374151",
                fontSize: "17px", fontWeight: 900, cursor: (canBet || autoRunning) ? "pointer" : "default",
                letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'Oswald', sans-serif",
                boxShadow: canBet && !autoRunning ? "0 4px 18px rgba(251,191,36,0.3)" : "none",
              }}
            >
              {isLoading ? "..." : autoRunning ? "STOP" : autoPlay ? "AUTO BET" : "BET"}
            </button>

            {/* Auto bet toggle */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
              <span style={{ color: "#6b7280", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.08em" }}>Auto Bet</span>
              <button onClick={() => { playSound("buttonClick"); setAutoPlay(v => !v); }} disabled={autoRunning}
                style={{ width: "36px", height: "20px", borderRadius: "10px", border: "none", cursor: autoRunning ? "default" : "pointer", background: autoPlay ? "#d97706" : "rgba(255,255,255,0.1)", position: "relative", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: "3px", left: autoPlay ? "17px" : "3px", width: "14px", height: "14px", borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
              </button>
            </div>
          </div>

          {/* ── RIGHT PANEL — grid, natural width = 585px ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "stretch" }}>

            {/* Result banner — always in DOM, opacity-only transition, never affects layout */}
            <motion.div
              animate={{ opacity: phase === "result" ? 1 : 0 }}
              transition={{ duration: 0.2 }}
              style={{
                height: "44px", flexShrink: 0, padding: "0 16px", borderRadius: "9px",
                background: resultPayout > 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${resultPayout > 0 ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.25)"}`,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                pointerEvents: phase === "result" ? "auto" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: "#6b7280", fontSize: "13px" }}>{resultHits} hit{resultHits !== 1 ? "s" : ""} of {picks.length}</span>
                {resultMult > 0 && <span style={{ color: "#fbbf24", fontWeight: 700, fontSize: "15px" }}>{resultMult}×</span>}
              </div>
              {resultPayout > 0
                ? <span style={{ color: "#22c55e", fontWeight: 900, fontSize: "18px" }}>+{fmt(resultPayout)}</span>
                : <span style={{ color: "#ef4444", fontWeight: 700, fontSize: "14px" }}>No win</span>
              }
            </motion.div>

            {/* 10×8 grid — 80 numbers */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 54px)", gap: "5px" }}>
              {Array.from({ length: 80 }, (_, i) => i + 1).map(num => (
                <KenoTile
                  key={num} num={num} state={getTileState(num)}
                  clickable={phase === "idle" || phase === "result"}
                  onClick={() => {
                    if (phase === "result") { setPhase("idle"); setDrawn([]); setRevealedSet(new Set()); }
                    playSound("chip");
                    togglePick(num);
                  }}
                  justRevealed={lastRevealedNum === num}
                />
              ))}
            </div>

            {/* Closed notice */}
            {gameStatus?.enabled === false && (
              <div style={{ padding: "10px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "8px", color: "#f87171", fontSize: "13px" }}>
                Keno is currently closed
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
