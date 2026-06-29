import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { PromoZone } from "../components/PromoRegion";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { awardXP } from "../lib/rewardsState";
import { playSound } from "../lib/sounds";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IMGS = import.meta.env.BASE_URL;

type TileState = "hidden" | "safe" | "mine" | "exploded";

interface GameSession {
  gameId: number;
  bet: number;
  mines: number;
  revealedTiles: number[];
  currentMultiplier: number;
}

type GamePhase = "idle" | "playing" | "cashed_out" | "lost";

// Payout factor scales with risk: riskier options reward slightly above fair odds
function minesPayoutFactor(mines: number): number {
  if (mines <= 3)  return 1.00;   // fair odds
  if (mines <= 5)  return 1.02;   // +2%
  if (mines <= 10) return 1.05;   // +5%
  return 1.08;                    // +8% (24 mines)
}

function calcMultiplier(mines: number, revealed: number): number {
  if (revealed === 0) return 1.0;
  let odds = 1.0;
  for (let i = 0; i < revealed; i++) {
    odds *= (25 - mines - i) / (25 - i);
  }
  return Math.max(1.0, parseFloat(((1 / odds) * minesPayoutFactor(mines)).toFixed(4)));
}

function nextMultiplier(mines: number, revealed: number): number {
  return calcMultiplier(mines, revealed + 1);
}

// ── Tile component ──────────────────────────────────────────────────────────

function Tile({ state, clickable, revealing, onClick }: {
  state: TileState;
  clickable: boolean;
  revealing: boolean;
  onClick: () => void;
}) {
  const base: React.CSSProperties = {
    display: "block",
    width: "100%",
    height: "72px",
    position: "relative",
    borderRadius: "10px",
    border: "none",
    cursor: clickable ? "pointer" : "default",
    overflow: "hidden",
    transition: "box-shadow 0.18s, background 0.18s",
  };

  const styles: Record<TileState, React.CSSProperties> = {
    hidden: {
      ...base,
      background: "linear-gradient(155deg, #1c0c10 0%, #100408 100%)",
      boxShadow: revealing
        ? "0 0 0 2px #f59e0b, 0 0 18px rgba(245,158,11,0.4), inset 0 1px 0 rgba(255,255,255,0.07)"
        : clickable
          ? "inset 0 1px 0 rgba(255,255,255,0.07), 0 3px 10px rgba(0,0,0,0.6)"
          : "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 6px rgba(0,0,0,0.5)",
    },
    safe: {
      ...base,
      background: "linear-gradient(155deg, #0a2218 0%, #05120e 100%)",
      boxShadow: "0 0 16px rgba(52,211,153,0.35), 0 0 6px rgba(52,211,153,0.2), inset 0 1px 0 rgba(52,211,153,0.15)",
    },
    mine: {
      ...base,
      background: "linear-gradient(155deg, #1f0a0e 0%, #120308 100%)",
      boxShadow: "0 0 10px rgba(220,38,38,0.25), inset 0 1px 0 rgba(255,100,100,0.08)",
    },
    exploded: {
      ...base,
      background: "linear-gradient(155deg, #5c1020 0%, #3a0a10 100%)",
      boxShadow: "0 0 32px rgba(220,38,38,0.8), 0 0 60px rgba(220,38,38,0.3), inset 0 1px 0 rgba(255,150,150,0.2)",
    },
  };

  return (
    <motion.button
      onClick={onClick}
      disabled={!clickable}
      initial={false}
      animate={
        state === "exploded"
          ? { scale: [1, 1.25, 0.92, 1.04, 1], rotate: [0, -6, 6, -2, 0] }
          : state === "safe"
            ? { scale: [1, 1.1, 0.97, 1] }
            : {}
      }
      transition={{ duration: 0.35 }}
      whileHover={clickable ? { scale: 1.06, y: -2 } : {}}
      whileTap={clickable ? { scale: 0.93 } : {}}
      style={styles[state]}
    >
      {/* Inner content layer */}
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "10px" }}>
        {/* Grid texture */}
        {state === "hidden" && (
          <span style={{
            position: "absolute", inset: 0, borderRadius: "10px",
            background: "repeating-linear-gradient(0deg, transparent, transparent 7px, rgba(255,255,255,0.012) 8px), repeating-linear-gradient(90deg, transparent, transparent 7px, rgba(255,255,255,0.012) 8px)",
          }} />
        )}
        {state === "hidden" && clickable && (
          <span style={{ position: "absolute", inset: 0, borderRadius: "10px", border: "1px solid rgba(160,34,58,0.2)" }} />
        )}

        <AnimatePresence mode="wait">
          {state === "safe" && (
            <motion.span key="gem" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }}
              style={{ position: "relative", zIndex: 1, display: "flex" }}>
              <span style={{ fontSize: "22px", filter: "drop-shadow(0 0 8px rgba(52,211,153,0.9))" }}>💎</span>
            </motion.span>
          )}
          {state === "mine" && (
            <motion.span key="mine" initial={{ scale: 0 }} animate={{ scale: 1 }}
              style={{ position: "relative", zIndex: 1 }}>
              <span style={{ fontSize: "18px", filter: "drop-shadow(0 0 6px rgba(220,38,38,0.7))" }}>💣</span>
            </motion.span>
          )}
          {state === "exploded" && (
            <motion.span key="exploded" initial={{ scale: 0 }} animate={{ scale: 1 }}
              style={{ position: "relative", zIndex: 1 }}>
              <span style={{ fontSize: "26px", filter: "drop-shadow(0 0 12px rgba(255,80,80,1))" }}>💥</span>
            </motion.span>
          )}
          {state === "hidden" && (
            <motion.span key="dot" style={{ position: "relative", zIndex: 1, width: "8px", height: "8px", borderRadius: "50%", background: clickable ? "rgba(160,34,58,0.4)" : "rgba(255,255,255,0.06)", display: "block" }} />
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Mines() {
  useGameClosedRedirect("mines", "/minigames");
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("mines", sessionToken);
  usePasswordGuard("mines");
  useEffect(() => { if (!isGameUnlocked("mines")) setLocation("/lobby"); }, []);

  const { data: currentPlayer, refetch: refetchPlayer } = useGetPlayer(playerId!, {
    query: { enabled: !!playerId },
  });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const [betInput, setBetInput] = useState("200");
  const [mineCount, setMineCount] = useState(3);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [session, setSession] = useState<GameSession | null>(null);
  const [tiles, setTiles] = useState<TileState[]>(Array(25).fill("hidden"));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [payout, setPayout] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [revealingTile, setRevealingTile] = useState<number | null>(null);
  const [gameStatus, setGameStatus] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/mines/status`).then(r => r.json()).then(setGameStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!sessionToken) return;
    fetch(`${BASE}/api/mines/active`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.json())
      .then(d => {
        if (d.game) {
          const g = d.game;
          const t: TileState[] = Array(25).fill("hidden");
          for (const idx of g.revealedTiles) t[idx] = "safe";
          setTiles(t);
          setSession({ gameId: g.id, bet: g.bet, mines: g.mines, revealedTiles: g.revealedTiles, currentMultiplier: g.currentMultiplier });
          setMineCount(g.mines);
          setBetInput(String(g.bet));
          setPhase("playing");
          setStatusMsg("Game restored — continue or cash out");
        }
      })
      .catch(() => {});
  }, [sessionToken]);

  function resetBoard() {
    setTiles(Array(25).fill("hidden"));
    setSession(null);
    setPayout(null);
    setErrorMsg(null);
    setStatusMsg(null);
  }

  async function handleStart() {
    if (!sessionToken) return;
    const bet = parseInt(betInput);
    if (!bet || bet <= 0) { setErrorMsg("Enter a valid bet amount"); return; }
    if (gameStatus && (bet < gameStatus.minBet || bet > gameStatus.maxBet)) {
      setErrorMsg(`Bet: ${gameStatus.minBet.toLocaleString()} – ${gameStatus.maxBet.toLocaleString()} chips`);
      return;
    }
    setIsLoading(true); setErrorMsg(null); resetBoard();
    playSound("chip");
    try {
      const r = await fetch(`${BASE}/api/mines/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bet, mines: mineCount }),
      });
      const d = await r.json();
      if (r.status === 409 && d.activeGame) {
        const g = d.activeGame;
        const t: TileState[] = Array(25).fill("hidden");
        for (const idx of g.revealedTiles) t[idx] = "safe";
        setTiles(t);
        setSession({ gameId: g.gameId, bet: g.bet, mines: g.mines, revealedTiles: g.revealedTiles, currentMultiplier: g.currentMultiplier });
        setMineCount(g.mines);
        setBetInput(String(g.bet));
        setPhase("playing");
        setStatusMsg("Active game restored — cash out or keep playing");
        setIsLoading(false);
        return;
      }
      if (!r.ok) { setErrorMsg(d.error || "Failed to start"); setIsLoading(false); return; }
      awardXP(bet);
      setSession({ gameId: d.gameId, bet: d.bet, mines: d.mines, revealedTiles: [], currentMultiplier: 1.0 });
      setPhase("playing");
    } catch { setErrorMsg("Connection error"); }
    setIsLoading(false);
  }

  async function handleReveal(idx: number) {
    if (!sessionToken || !session || phase !== "playing") return;
    if (tiles[idx] !== "hidden" || revealingTile !== null) return;
    setRevealingTile(idx); setErrorMsg(null);
    playSound("chip");
    try {
      const r = await fetch(`${BASE}/api/mines/reveal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tileIndex: idx }),
      });
      const d = await r.json();
      if (!r.ok) { setErrorMsg(d.error || "Error"); setRevealingTile(null); return; }

      const t = [...tiles];
      if (d.result === "mine") {
        t[idx] = "exploded";
        for (const m of d.minePositions as number[]) { if (m !== idx) t[m] = "mine"; }
        setTiles(t); setPhase("lost"); setPayout(0);
        setStatusMsg("💥 You hit a mine!"); setSession(null);
        playSound("mineBust");
        fireChallengeEvent("mini_game_round_played");
        fireChallengeEvent("bet_lost");
      } else {
        t[idx] = "safe";
        setTiles(t);
        setSession(prev => prev ? { ...prev, revealedTiles: d.revealedTiles, currentMultiplier: d.currentMultiplier } : null);
        playSound("mineSafe");
        if (d.complete) {
          for (const m of d.minePositions as number[]) t[m] = "mine";
          setTiles([...t]);
          setPhase("cashed_out"); setPayout(d.payout);
          setStatusMsg(`🏆 Board cleared! +${d.payout.toLocaleString()} chips`);
          setSession(null); refetchPlayer();
          playSound("cashOut");
        }
      }
    } catch { setErrorMsg("Connection error"); }
    setRevealingTile(null);
  }

  async function handleCashout() {
    if (!sessionToken || !session || phase !== "playing") return;
    if (!session.revealedTiles.length) { setErrorMsg("Reveal at least one tile first"); return; }
    setIsLoading(true); setErrorMsg(null);
    try {
      const r = await fetch(`${BASE}/api/mines/cashout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) { setErrorMsg(d.error || "Cashout failed"); setIsLoading(false); return; }
      const t = [...tiles];
      for (const m of d.minePositions as number[]) { if (t[m] === "hidden") t[m] = "mine"; }
      setTiles(t); setPhase("cashed_out"); setPayout(d.payout);
      setStatusMsg(`✅ Cashed out at ${d.multiplier.toFixed(2)}× — +${d.payout.toLocaleString()} chips`);
      setSession(null); refetchPlayer();
      playSound("cashOut");
      fireChallengeEvent("mini_game_round_played");
      fireChallengeEvent("bet_won");
    } catch { setErrorMsg("Connection error"); }
    setIsLoading(false);
  }

  const chips = liveChips ?? currentPlayer?.chips ?? 0;
  const canStart = gameStatus?.enabled && phase !== "playing" && !isLoading;
  const currentMult = session?.currentMultiplier ?? 1.0;
  const revealed = session?.revealedTiles.length ?? 0;
  const activeMines = phase === "playing" && session ? session.mines : mineCount;

  const panel: React.CSSProperties = {
    background: "linear-gradient(160deg, #110608 0%, #0a0305 100%)",
    border: "1px solid rgba(160,34,58,0.22)",
    borderRadius: "14px",
    boxShadow: "0 4px 28px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
  };

  const multColor = phase === "playing" ? "#f59e0b" : phase === "cashed_out" ? "#4ade80" : phase === "lost" ? "#f87171" : "#334155";
  const canCashout = phase === "playing" && (session?.revealedTiles.length ?? 0) > 0 && !isLoading;

  return (
    <div style={{ minHeight: "100vh", background: "#06020a", color: "#f1f5f9", position: "relative" }}>

      {/* Atmospheric glow */}
      <div style={{ position: "fixed", top: "35%", left: "50%", transform: "translate(-50%,-50%)", width: "600px", height: "400px", borderRadius: "50%", background: "radial-gradient(ellipse, rgba(120,20,45,0.14) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <div style={{ borderBottom: "1px solid rgba(160,34,58,0.2)", background: "rgba(6,2,10,0.97)", position: "sticky", top: 0, zIndex: 20, boxShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
        <div style={{ maxWidth: "700px", margin: "0 auto", padding: "0 20px", height: "54px", display: "flex", alignItems: "center", gap: "14px" }}>
          <button onClick={() => setLocation("/minigames")} style={{ display: "flex", alignItems: "center", gap: "5px", color: "#64748b", background: "none", border: "none", cursor: "pointer", fontSize: "13px", padding: "6px 10px", borderRadius: "8px", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")} onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
            <ChevronLeft size={15} /> Mini Games
          </button>
          <div style={{ width: "1px", height: "20px", background: "rgba(160,34,58,0.3)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "linear-gradient(135deg, #a0223a, #6b0f22)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 12px rgba(160,34,58,0.5)", fontSize: "16px" }}>💣</div>
            <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: "20px", fontWeight: 700, color: "#e8c5cb", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Mines</h1>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <div style={{ ...panel, padding: "6px 14px", display: "flex", alignItems: "center", gap: "7px", borderRadius: "10px" }}>
              <span style={{ fontSize: "14px" }}>🪙</span>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, color: "#fcd34d", fontSize: "15px" }}>{chips.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "24px 20px", position: "relative", zIndex: 1 }}>

        {/* Closed banner */}
        {gameStatus && !gameStatus.enabled && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ ...panel, padding: "14px 20px", marginBottom: "20px", textAlign: "center", borderColor: "rgba(160,34,58,0.5)" }}>
            <span style={{ color: "#fca5a5", fontSize: "13px", fontWeight: 600 }}>💥 Mines is currently closed</span>
          </motion.div>
        )}

        {/* ── Single game card ── */}
        <div style={{ ...panel, overflow: "hidden" }}>

          {/* ── Top stat bar ── */}
          <div style={{ padding: "12px 20px", borderBottom: "1px solid rgba(160,34,58,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            {/* Multiplier */}
            <div style={{ minWidth: "90px" }}>
              <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>Multiplier</div>
              <AnimatePresence mode="wait">
                <motion.div key={currentMult.toFixed(4)} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  style={{ fontFamily: "'Oswald', sans-serif", fontSize: "30px", fontWeight: 900, lineHeight: 1, color: multColor, textShadow: phase === "playing" ? "0 0 18px rgba(245,158,11,0.45)" : phase === "cashed_out" ? "0 0 18px rgba(74,222,128,0.45)" : "none" }}>
                  {currentMult.toFixed(2)}×
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Status / payout center */}
            <div style={{ flex: 1, textAlign: "center" }}>
              <AnimatePresence mode="wait">
                {statusMsg ? (
                  <motion.div key={statusMsg} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    style={{ fontFamily: "'Oswald', sans-serif", fontSize: "15px", fontWeight: 700, color: phase === "lost" ? "#fca5a5" : "#6ee7b7", letterSpacing: "0.04em" }}>
                    {statusMsg}
                  </motion.div>
                ) : phase === "playing" && session && revealed > 0 ? (
                  <motion.div key="profit" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "2px" }}>Payout</div>
                    <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: "20px", fontWeight: 800, color: "#fcd34d" }}>
                      {Math.floor(session.bet * currentMult).toLocaleString()}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    style={{ fontSize: "12px", color: "#334155" }}>
                    {phase === "idle" ? "Pick a tile to start" : ""}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: mines + next mult */}
            <div style={{ minWidth: "90px", textAlign: "right" }}>
              <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "3px" }}>
                {phase === "playing" ? "Next Tile" : "Mines"}
              </div>
              <div style={{ fontFamily: "'Oswald', sans-serif", fontSize: "22px", fontWeight: 800, lineHeight: 1 }}>
                {phase === "playing" && session ? (
                  <span style={{ color: "#94a3b8" }}>{nextMultiplier(session.mines, revealed).toFixed(2)}×</span>
                ) : (
                  <span style={{ color: "#f87171" }}>{activeMines} 💣</span>
                )}
              </div>
              {phase === "playing" && session && (
                <div style={{ fontSize: "10px", color: "#475569", marginTop: "2px" }}>
                  {25 - session.mines - revealed} safe left
                </div>
              )}
            </div>
          </div>

          {/* ── Grid ── */}
          <div style={{ padding: "10px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
              {tiles.map((tileState, idx) => (
                <Tile
                  key={idx}
                  state={tileState}
                  clickable={phase === "playing" && tileState === "hidden" && revealingTile === null}
                  revealing={revealingTile === idx}
                  onClick={() => handleReveal(idx)}
                />
              ))}
            </div>
          </div>

          {/* ── Controls row ── */}
          <div style={{ padding: "16px 16px 20px", borderTop: "1px solid rgba(160,34,58,0.12)", display: "flex", gap: "10px", alignItems: "flex-end" }}>

            {/* Bet */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Bet Amount</div>
              <input
                type="number" value={betInput} onChange={e => setBetInput(e.target.value)}
                disabled={phase === "playing"}
                style={{ width: "100%", boxSizing: "border-box", background: "rgba(0,0,0,0.45)", border: "1px solid rgba(160,34,58,0.25)", borderRadius: "9px", padding: "10px 12px", color: "#f1f5f9", fontSize: "17px", fontFamily: "'Oswald', sans-serif", fontWeight: 700, outline: "none", letterSpacing: "0.04em" }}
                min={gameStatus?.minBet ?? 50} max={gameStatus?.maxBet ?? 10000}
              />
              <div style={{ display: "flex", gap: "4px", marginTop: "5px" }}>
                {([["½", 0.5], ["2×", 2], ["Max", 0]] as [string, number][]).map(([label, factor]) => (
                  <button key={String(label)} onClick={() => {
                    if (factor === 0) { setBetInput(String(Math.min(chips, gameStatus?.maxBet ?? 10000))); return; }
                    const cur = parseInt(betInput) || 0;
                    setBetInput(String(Math.max(gameStatus?.minBet ?? 50, Math.min(gameStatus?.maxBet ?? 10000, Math.floor(cur * (factor as number))))));
                  }}
                    disabled={phase === "playing"}
                    style={{ flex: 1, padding: "5px 0", borderRadius: "7px", background: "rgba(160,34,58,0.08)", border: "1px solid rgba(160,34,58,0.18)", color: "#9b4a5a", fontSize: "11px", fontWeight: 600, cursor: phase === "playing" ? "not-allowed" : "pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Mines quick pick */}
            <div style={{ width: "150px" }}>
              <div style={{ fontSize: "10px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
                Mines 💣 &nbsp;<span style={{ color: "#f87171", fontFamily: "'Oswald', sans-serif", fontWeight: 700 }}>{activeMines}</span>
              </div>
              <div style={{ display: "flex", gap: "5px" }}>
                {[3, 5, 10, 24].map(n => (
                  <button key={n} onClick={() => setMineCount(n)} disabled={phase === "playing"}
                    style={{ flex: 1, padding: "10px 0", borderRadius: "9px", fontFamily: "'Oswald', sans-serif", fontSize: "14px", fontWeight: 800, cursor: phase === "playing" ? "not-allowed" : "pointer", background: activeMines === n ? "linear-gradient(135deg, rgba(160,34,58,0.5), rgba(197,48,80,0.3))" : "rgba(0,0,0,0.3)", border: activeMines === n ? "1px solid rgba(197,48,80,0.7)" : "1px solid rgba(255,255,255,0.07)", color: activeMines === n ? "#fca5a5" : "#475569", boxShadow: activeMines === n ? "0 0 10px rgba(160,34,58,0.3)" : "none", transition: "all 0.12s" }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Action button */}
            <div style={{ width: "140px" }}>
              <AnimatePresence mode="wait">
                {phase !== "playing" ? (
                  <motion.button key="start" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={handleStart} disabled={!canStart || isLoading}
                    style={{
                      width: "100%", padding: "30px 0", borderRadius: "10px",
                      fontFamily: "'Oswald', sans-serif", fontSize: "14px", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.08em",
                      cursor: canStart && !isLoading ? "pointer" : "not-allowed",
                      background: canStart && !isLoading
                        ? "linear-gradient(135deg, #a0223a 0%, #c42d4a 50%, #a0223a 100%)"
                        : "rgba(255,255,255,0.04)",
                      color: canStart && !isLoading ? "#fff" : "#1e293b",
                      border: canStart && !isLoading ? "1px solid rgba(196,45,74,0.5)" : "1px solid rgba(255,255,255,0.06)",
                      boxShadow: canStart && !isLoading ? "0 0 20px rgba(160,34,58,0.4), 0 4px 12px rgba(0,0,0,0.5)" : "none",
                      transition: "all 0.15s",
                    }}>
                    {isLoading ? "Starting…" : phase === "idle" ? "Start" : "New Game"}
                  </motion.button>
                ) : (
                  <motion.button key="cashout" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    onClick={handleCashout} disabled={!canCashout}
                    style={{
                      width: "100%", padding: "30px 0", borderRadius: "10px",
                      fontFamily: "'Oswald', sans-serif", fontSize: "13px", fontWeight: 700,
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      cursor: canCashout ? "pointer" : "not-allowed",
                      background: canCashout
                        ? "linear-gradient(135deg, #065f46 0%, #10b981 50%, #065f46 100%)"
                        : "rgba(255,255,255,0.04)",
                      color: canCashout ? "#fff" : "#1e293b",
                      border: canCashout ? "1px solid rgba(16,185,129,0.4)" : "1px solid rgba(255,255,255,0.06)",
                      boxShadow: canCashout ? "0 0 18px rgba(16,185,129,0.3), 0 4px 12px rgba(0,0,0,0.5)" : "none",
                      transition: "all 0.15s",
                      whiteSpace: "pre-line",
                    }}>
                    {isLoading ? "Cashing…" : `Cash Out\n${currentMult.toFixed(2)}×`}
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {errorMsg && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                style={{ borderTop: "1px solid rgba(220,38,38,0.15)", padding: "10px 20px", color: "#fca5a5", fontSize: "12px", textAlign: "center", background: "rgba(220,38,38,0.05)" }}>
                {errorMsg}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <PromoZone pageKey="mines" />
      </div>
    </div>
  );
}
