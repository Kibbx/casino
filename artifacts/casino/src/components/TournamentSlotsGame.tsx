import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Zap } from "lucide-react";
import { useStore } from "../store";
import { playSound } from "../lib/sounds";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Symbol visual registry (identical to slots.tsx) ───────────────────────────
const SYMBOL_DATA: Record<string, { display: string; color: string; bg: string; glow: string; isText?: boolean }> = {
  seven:   { display: "7",   color: "#FF3B3B", bg: "radial-gradient(circle at 35% 35%, #3a0000, #1a0000)", glow: "#FF3B3B", isText: true },
  diamond: { display: "💎", color: "#88eeff", bg: "radial-gradient(circle at 35% 35%, #001f3a, #000e1a)", glow: "#88eeff" },
  bar:     { display: "BAR", color: "#FFD700", bg: "radial-gradient(circle at 35% 35%, #2a2000, #1a1400)", glow: "#FFD700", isText: true },
  star:    { display: "⭐", color: "#FFD700", bg: "radial-gradient(circle at 35% 35%, #2a2000, #1a1400)", glow: "#FFD700" },
  bell:    { display: "🔔", color: "#FFA500", bg: "radial-gradient(circle at 35% 35%, #2a1400, #1a0e00)", glow: "#FFA500" },
  cherry:  { display: "🍒", color: "#FF6680", bg: "radial-gradient(circle at 35% 35%, #2a0018, #1a0010)", glow: "#FF6680" },
  lemon:   { display: "🍋", color: "#F0E040", bg: "radial-gradient(circle at 35% 35%, #28230a, #181400)", glow: "#F0E040" },
  wild:    { display: "🃏", color: "#00FF88", bg: "radial-gradient(circle at 35% 35%, #002a18, #001810)", glow: "#00FF88" },
  scatter: { display: "✦",  color: "#a855f7", bg: "radial-gradient(circle at 35% 35%, #1e0035, #0e001a)", glow: "#a855f7", isText: true },
};

const ALL_IDS = Object.keys(SYMBOL_DATA);
const NUM_REELS = 5;
const NUM_ROWS  = 3;

function randomSymbol() { return ALL_IDS[Math.floor(Math.random() * ALL_IDS.length)]; }
function randomGrid(): string[][] {
  return Array.from({ length: NUM_REELS }, () => Array.from({ length: NUM_ROWS }, randomSymbol));
}

// ── ReelCell (identical to slots.tsx) ─────────────────────────────────────────
function ReelCell({ symbolId, spinning, highlight, isScatter, isWild }: {
  symbolId: string; spinning: boolean; highlight: boolean; isScatter?: boolean; isWild?: boolean;
}) {
  const sym = SYMBOL_DATA[symbolId] ?? SYMBOL_DATA["lemon"];
  const special = isScatter || isWild;
  const active  = highlight || special;
  return (
    <motion.div
      key={spinning ? "spin" : symbolId}
      initial={spinning ? { y: -12, opacity: 0 } : false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.09 }}
      style={{
        background: special
          ? `radial-gradient(circle at 35% 35%, ${sym.glow}40, ${sym.bg.match(/,\s*([^,]+)\)$/)?.[1] ?? "#000"})`
          : highlight
          ? `radial-gradient(circle at 35% 35%, ${sym.glow}25, ${sym.bg.match(/,\s*([^,]+)\)$/)?.[1] ?? "#000"})`
          : sym.bg,
        borderColor: special ? sym.glow : highlight ? sym.glow : "rgba(255,255,255,0.06)",
        boxShadow: special
          ? `0 0 18px ${sym.glow}80, inset 0 1px 0 rgba(255,255,255,0.1)`
          : highlight
          ? `0 0 14px ${sym.glow}60, inset 0 1px 0 rgba(255,255,255,0.08)`
          : "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.3)",
        flex: 1,
        aspectRatio: "1",
        minHeight: 0,
      }}
      className="rounded-xl border flex items-center justify-center select-none"
    >
      <span style={{
        color: sym.color,
        fontFamily: sym.isText ? "'Oswald', 'Impact', sans-serif" : "inherit",
        textShadow: active ? `0 0 20px ${sym.glow}, 0 0 6px ${sym.glow}` : `0 0 8px ${sym.glow}50`,
        transition: "text-shadow 0.2s",
        fontSize: sym.isText ? "clamp(10px, 3vw, 22px)" : "clamp(16px, 4vw, 32px)",
        fontWeight: sym.isText ? 900 : 400,
        letterSpacing: sym.display === "BAR" ? "-0.5px" : 0,
      }}>
        {sym.display}
      </span>
    </motion.div>
  );
}

// ── LED dot ───────────────────────────────────────────────────────────────────
function LedDot({ on, color }: { on: boolean; color: string }) {
  return (
    <div style={{
      width: 7, height: 7, borderRadius: "50%",
      background: on ? color : "rgba(255,255,255,0.07)",
      boxShadow: on ? `0 0 5px ${color}, 0 0 10px ${color}60` : "none",
      transition: "all 0.25s",
      flexShrink: 0,
    }} />
  );
}

// ── Countdown bar ─────────────────────────────────────────────────────────────
function CountdownBar({ countdown }: { countdown: number | null }) {
  if (countdown === null) return null;
  const urgent = countdown < 120_000;
  const warn   = countdown < 300_000;
  const m = Math.floor(countdown / 60_000);
  const s = Math.floor((countdown % 60_000) / 1_000);
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
      urgent ? "bg-red-950 border-red-700" :
      warn   ? "bg-yellow-950 border-yellow-700" :
               "bg-primary/10 border-primary/30"
    }`}>
      <div className="flex items-center gap-2">
        <Clock className={`w-4 h-4 ${urgent ? "text-red-400" : warn ? "text-yellow-400" : "text-primary"}`} />
        <span className="text-sm font-medium text-foreground">Time remaining</span>
      </div>
      <span className={`font-mono font-bold text-lg tabular-nums ${urgent ? "text-red-400" : warn ? "text-yellow-400" : "text-primary"}`}>
        {countdown > 0 ? `${m}:${s.toString().padStart(2, "0")}` : "Time's up!"}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  tournamentId: number;
  initialChips: number;
  initialScore: number;
  minBet: number;
  maxBet: number | null | undefined;
  countdown: number | null;
  isEliminated: boolean;
  onResult: (data: { tournamentChips: number; score: number; status: string }) => void;
}

export default function TournamentSlotsGame({
  tournamentId, initialChips, initialScore, minBet, maxBet, countdown, isEliminated, onResult,
}: Props) {
  const { sessionToken } = useStore();

  const effectiveMax = maxBet ?? initialChips;

  // Bet presets: min, min*2, min*5, max
  const presets = Array.from(new Set([
    minBet,
    Math.min(minBet * 2, effectiveMax),
    Math.min(minBet * 5, effectiveMax),
    effectiveMax,
  ])).filter((v, i, a) => a.indexOf(v) === i);

  const [betAmount, setBetAmount] = useState(String(minBet));
  const [tChips, setTChips]       = useState(initialChips);
  const [score, setScore]         = useState(initialScore);
  const [eliminated, setEliminated] = useState(isEliminated);

  // Reel state
  const [displayGrid, setDisplayGrid]     = useState<string[][]>(randomGrid);
  const [spinning, setSpinning]           = useState(false);
  const [stoppedReels, setStoppedReels]   = useState<boolean[]>(Array(NUM_REELS).fill(true));
  const stoppedRef = useRef<boolean[]>(Array(NUM_REELS).fill(true));
  const spinIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Result state
  const [lastResult, setLastResult] = useState<{
    payout: number; outcome: string;
    wins: { symbol: string; reelCount: number; ways: number }[];
  } | null>(null);
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [showWin, setShowWin]   = useState(false);

  // Session stats
  const [stats, setStats] = useState({ spins: 0, wins: 0, totalWon: 0, totalBet: 0 });

  // LED animation
  const [ledFrame, setLedFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLedFrame(f => (f + 1) % 8), 380);
    return () => clearInterval(t);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { if (spinIntervalRef.current) clearInterval(spinIntervalRef.current); }, []);

  // ── Spin animation (staggered reel stops, like real slots) ──────────────────
  const runSpinAnimation = useCallback((finalGrid: string[][]): Promise<void> => {
    return new Promise((resolve) => {
      const STAGGER = 480;
      const BASE_MS = 1300;
      Array.from({ length: NUM_REELS }).forEach((_, reelIdx) => {
        setTimeout(() => {
          stoppedRef.current = stoppedRef.current.map((v, i) => i <= reelIdx ? true : v);
          setStoppedReels([...stoppedRef.current]);
          setDisplayGrid(prev => prev.map((col, i) => i === reelIdx ? finalGrid[i] : col));
          playSound("slotStop");
          if (reelIdx === NUM_REELS - 1) {
            clearInterval(spinIntervalRef.current!);
            setSpinning(false);
            resolve();
          }
        }, BASE_MS + reelIdx * STAGGER);
      });
    });
  }, []);

  const startReelSpin = useCallback(() => {
    setSpinning(true);
    setShowWin(false);
    setWinCells(new Set());
    setLastResult(null);
    stoppedRef.current = Array(NUM_REELS).fill(false);
    setStoppedReels(Array(NUM_REELS).fill(false));
    spinIntervalRef.current = setInterval(() => {
      setDisplayGrid(prev => prev.map((col, ri) => stoppedRef.current[ri] ? col : col.map(randomSymbol)));
    }, 90);
  }, []);

  // ── Call tournament spin API ────────────────────────────────────────────────
  async function handleSpin() {
    const bet = parseInt(betAmount);
    if (!bet || bet <= 0 || spinning || eliminated) return;
    if (countdown !== null && countdown <= 0) return;
    if (tChips < bet) return;

    playSound("spinStart");
    startReelSpin();

    let result: any;
    try {
      const res = await fetch(`${BASE}/api/tournaments/${tournamentId}/spin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ betAmount: bet }),
      });
      result = await res.json();
      if (!res.ok) {
        clearInterval(spinIntervalRef.current!);
        setSpinning(false);
        return;
      }
    } catch {
      clearInterval(spinIntervalRef.current!);
      setSpinning(false);
      return;
    }

    // The API returns grid as string[][] (5 cols × 3 rows)
    const grid: string[][] = result.grid ?? randomGrid();
    await runSpinAnimation(grid);

    const wins = result.wins ?? [];
    const cells = new Set<string>(
      wins.flatMap((w: any) => (w.winningCells ?? []).map(([r, row]: [number, number]) => `${r},${row}`))
    );
    setWinCells(cells);

    setLastResult({ payout: result.payout ?? 0, outcome: result.outcome ?? "", wins });

    const newChips = result.tournamentChips ?? (tChips - bet);
    const newScore = result.score ?? (score + (result.payout ?? 0));
    setTChips(newChips);
    setScore(newScore);

    const newStatus = result.status ?? "active";
    if (newStatus === "eliminated") setEliminated(true);

    setStats(prev => ({
      spins: prev.spins + 1,
      wins: prev.wins + (result.payout > 0 ? 1 : 0),
      totalWon: prev.totalWon + (result.payout ?? 0),
      totalBet: prev.totalBet + bet,
    }));

    onResult({ tournamentChips: newChips, score: newScore, status: newStatus });

    if (result.payout > 0) {
      setShowWin(true);
      playSound("win");
    }
  }

  const timeUp = countdown !== null && countdown <= 0;
  const canSpin = !spinning && !eliminated && !timeUp && tChips >= parseInt(betAmount || "0");

  // ── LED colors based on score ───────────────────────────────────────────────
  const LED_COLORS = ["#ff3b3b", "#FFD700", "#22c55e", "#88eeff", "#a855f7", "#FF6680"];
  const ledColor = LED_COLORS[ledFrame % LED_COLORS.length];

  return (
    <div className="space-y-3">
      {/* Countdown bar */}
      <CountdownBar countdown={countdown} />

      {/* Tournament balance row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-primary/10 border border-primary/30 rounded-2xl p-4 text-center">
          <p className="text-xs text-primary/60 uppercase tracking-wide font-medium">Tournament Chips</p>
          <p className="text-2xl font-display font-bold text-primary mt-1 tabular-nums">
            {tChips.toLocaleString()}
          </p>
        </div>
        <div className="bg-yellow-950 border border-yellow-700 rounded-2xl p-4 text-center">
          <p className="text-xs text-yellow-400 uppercase tracking-wide font-medium">Your Score</p>
          <p className="text-2xl font-display font-bold text-yellow-400 mt-1 tabular-nums">
            {score.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Done spinning banner */}
      {eliminated && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center">
          <p className="text-zinc-300 font-semibold text-sm">Out of chips — your score is locked in</p>
          <p className="text-xs text-muted-foreground mt-0.5">Score: <span className="text-yellow-400 font-mono font-bold">{score.toLocaleString()}</span></p>
          <p className="text-xs text-zinc-500 mt-1">Tournament ends when the timer runs out — highest score wins</p>
        </div>
      )}

      {/* ── Slot machine visual ── */}
      {!eliminated && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(160deg, #0d0d0d 0%, #111 100%)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* LED strip top */}
          <div className="flex items-center justify-between px-4 py-2">
            <div className="flex gap-1.5">
              {Array.from({ length: 11 }).map((_, i) => (
                <LedDot key={i} on={(i + ledFrame) % 3 === 0} color={ledColor} />
              ))}
            </div>
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">
              Tournament Mode
            </span>
            <div className="flex gap-1.5">
              {Array.from({ length: 11 }).map((_, i) => (
                <LedDot key={i} on={(i + ledFrame + 2) % 3 === 0} color={ledColor} />
              ))}
            </div>
          </div>

          {/* Reel grid */}
          <div
            className="flex gap-1 px-3 pb-1"
            style={{ height: "clamp(150px, 28vw, 260px)" }}
          >
            {displayGrid.map((col, reelIdx) => (
              <div key={reelIdx} className="flex flex-col gap-1 flex-1">
                {col.map((symbolId, rowIdx) => (
                  <ReelCell
                    key={rowIdx}
                    symbolId={symbolId}
                    spinning={spinning && !stoppedReels[reelIdx]}
                    highlight={showWin && winCells.has(`${reelIdx},${rowIdx}`)}
                    isScatter={stoppedReels[reelIdx] && symbolId === "scatter"}
                    isWild={stoppedReels[reelIdx] && symbolId === "wild"}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Result panel */}
          <div
            className="mx-3 mb-3 rounded-xl overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #0a0a0a, #111)",
              border: "1px solid rgba(255,255,255,0.05)",
              minHeight: 56,
            }}
          >
            <AnimatePresence mode="wait">
              {showWin && lastResult && lastResult.payout > 0 ? (
                <motion.div
                  key="win"
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 18 }}
                  className="flex flex-col items-center justify-center py-2 px-4 text-center"
                >
                  <p className="text-3xl font-display font-black tabular-nums" style={{ color: "#22C55E", textShadow: "0 0 24px rgba(34,197,94,0.8)" }}>
                    +{lastResult.payout.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">score</p>
                  {lastResult.wins.length > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {lastResult.wins.map(w => `${SYMBOL_DATA[w.symbol]?.display ?? w.symbol} ×${w.reelCount}`).join("  ·  ")}
                    </p>
                  )}
                </motion.div>
              ) : spinning ? (
                <motion.div key="spinning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-2 h-14">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }} className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                    ))}
                  </div>
                </motion.div>
              ) : lastResult && lastResult.payout === 0 ? (
                <motion.div key="lose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center h-14">
                  <p className="text-zinc-700 font-display font-bold text-sm">No luck this spin</p>
                </motion.div>
              ) : (
                <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center h-14">
                  <p className="text-zinc-800 text-sm">243 ways to win · winnings add to score</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bet controls */}
          <div className="px-3 pb-4 space-y-2">
            {/* Presets */}
            <div className="flex gap-2 flex-wrap">
              {presets.map(v => (
                <button
                  key={v}
                  onClick={() => setBetAmount(String(v))}
                  className={`flex-1 min-w-0 px-2 py-2 rounded-xl text-sm font-bold border transition-all ${
                    betAmount === String(v)
                      ? "bg-red-600 text-white border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                      : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : String(v)}
                  {v === effectiveMax && v !== minBet ? " MAX" : ""}
                </button>
              ))}
            </div>

            {/* Custom input + spin */}
            <div className="flex gap-2">
              <input
                type="number"
                min={minBet}
                max={effectiveMax}
                step={minBet}
                value={betAmount}
                onChange={e => setBetAmount(e.target.value)}
                disabled={spinning}
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-zinc-600 text-center"
              />
              <button
                onClick={handleSpin}
                disabled={!canSpin}
                className={`flex-[2] flex items-center justify-center gap-2 rounded-xl py-2.5 text-base font-black uppercase tracking-wide transition-all ${
                  canSpin
                    ? "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-[0_4px_20px_rgba(239,68,68,0.4)] hover:from-red-400 hover:to-red-600 active:scale-[0.98]"
                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                }`}
              >
                {spinning ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }} className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" />
                ) : timeUp ? (
                  "Time's Up"
                ) : eliminated ? (
                  "Done"
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    SPIN
                  </>
                )}
              </button>
            </div>

            <p className="text-[11px] text-zinc-700 text-center">
              Bet {minBet.toLocaleString()} – {effectiveMax.toLocaleString()} T-chips · Winnings add to score only
            </p>
          </div>

          {/* LED strip bottom */}
          <div className="flex items-center justify-between px-4 pb-2.5">
            <div className="flex gap-1.5">
              {Array.from({ length: 11 }).map((_, i) => (
                <LedDot key={i} on={(i + ledFrame + 1) % 3 === 0} color={ledColor} />
              ))}
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 11 }).map((_, i) => (
                <LedDot key={i} on={(i + ledFrame + 3) % 3 === 0} color={ledColor} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Session stats */}
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          { label: "Spins", value: stats.spins },
          { label: "Wins",  value: stats.wins },
          { label: "Scored", value: stats.totalWon },
          { label: "Spent",  value: stats.totalBet },
        ].map(item => (
          <div key={item.label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wide">{item.label}</p>
            <p className="text-sm font-mono font-bold text-zinc-300 tabular-nums">
              {item.value >= 1000 ? `${(item.value / 1000).toFixed(1)}k` : item.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
