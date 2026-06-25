import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { PlayingCardImg } from "../components/PlayingCardImg";

// ── Audio (Web Audio API, zero external files) ────────────────────────────────

let _ac: AudioContext | null = null;
function getAC() {
  if (!_ac) _ac = new AudioContext();
  if (_ac.state === "suspended") _ac.resume();
  return _ac;
}

function playCardSound(delayS = 0) {
  try {
    const ac = getAC();
    const t = ac.currentTime + delayS;
    const bufLen = Math.floor(ac.sampleRate * 0.08);
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
    const src = ac.createBufferSource(); src.buffer = buf;
    const bpf = ac.createBiquadFilter(); bpf.type = "bandpass"; bpf.frequency.value = 2600; bpf.Q.value = 0.7;
    const g = ac.createGain(); g.gain.setValueAtTime(0.38, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    src.connect(bpf); bpf.connect(g); g.connect(ac.destination); src.start(t);
    const osc = ac.createOscillator(); const g2 = ac.createGain();
    osc.type = "sine"; osc.frequency.setValueAtTime(130, t); osc.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    g2.gain.setValueAtTime(0.45, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(g2); g2.connect(ac.destination); osc.start(t); osc.stop(t + 0.13);
  } catch {}
}

function _tone(freq: number, t: number, dur: number, vol: number, type: OscillatorType = "sine") {
  try {
    const ac = getAC();
    const osc = ac.createOscillator(); const g = ac.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.018); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(ac.destination); osc.start(t); osc.stop(t + dur);
  } catch {}
}

function playWin() {
  const t = getAC().currentTime;
  [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => _tone(f, t + i * 0.11, 0.5, 0.13));
}

function playLose() {
  const t = getAC().currentTime;
  [392, 329.63, 261.63].forEach((f, i) => _tone(f, t + i * 0.17, 0.55, 0.1));
}

function playPush() { _tone(415.3, getAC().currentTime, 0.38, 0.09); }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface Card { suit: string; rank: string }
type Side = "player" | "banker" | "tie";
type GameState = "idle" | "dealing" | "result";

interface Result {
  playerCards: Card[]; bankerCards: Card[];
  playerTotal: number; bankerTotal: number;
  outcome: Side; side: Side; bet: number;
  payout: number; netProfit: number; chips: number;
  config: { minBet: number; maxBet: number; bankerCommission: number; tiePayout: number };
}

interface HistoryEntry { outcome: Side; netProfit: number }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(Math.abs(n) % 1000 === 0 ? 0 : 1)}K`;
  return String(n);
}

const CHIPS = [100, 500, 1000, 5000, 10000];

const CHIP_STYLE: Record<number, { bg: string; border: string }> = {
  100:   { bg: "#374151", border: "#6b7280" },
  500:   { bg: "#1d4ed8", border: "#3b82f6" },
  1000:  { bg: "#a16207", border: "#ca8a04" },
  5000:  { bg: "#166534", border: "#22c55e" },
  10000: { bg: "#9d174d", border: "#ec4899" },
};

const OUTCOME_COL: Record<Side, string> = {
  player: "#4f8eff",
  banker: "#ff4f4f",
  tie:    "#22c55e",
};

const SIDE_LABEL: Record<Side, string> = { player: "P", banker: "B", tie: "T" };

// ── Card components ───────────────────────────────────────────────────────────

function PlayingCard({ card, delay = 0 }: { card?: Card; delay?: number }) {
  return <PlayingCardImg rank={card?.rank} suit={card?.suit} hidden={!card} width={78} height={112} delay={delay} />;
}

// ── Hand display ──────────────────────────────────────────────────────────────

function Hand({ label, cards, total, color, isWinner, dealing, dealingOffset = 0 }: {
  label: string; cards: Card[]; total: number | null; color: string;
  isWinner?: boolean; dealing: boolean; dealingOffset?: number;
}) {
  const [scoreVisible, setScoreVisible] = useState(false);

  useEffect(() => {
    if (dealing || cards.length === 0 || total === null) {
      setScoreVisible(false);
      return;
    }
    // Delay until the last card's flip animation finishes:
    // last card delay = dealingOffset + (cards.length - 1) * 0.8, anim duration = 0.45s
    const lastCardDelay = dealingOffset + (cards.length - 1) * 0.8;
    const showAfterMs = Math.round((lastCardDelay + 0.45) * 1000);
    const timer = setTimeout(() => setScoreVisible(true), showAfterMs);
    return () => clearTimeout(timer);
  }, [dealing, cards.length, total, dealingOffset]);

  const showScore = scoreVisible && cards.length > 0 && total !== null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
      {/* Fixed height label row — 24px */}
      <div style={{ height: 24, display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: isWinner ? color : "rgba(255,255,255,0.4)", letterSpacing: "0.14em", textTransform: "uppercase", transition: "color 0.25s" }}>{label}</span>
      </div>

      {/* Fixed height card row — 112px */}
      <div style={{ height: 112, display: "flex", gap: 8, alignItems: "flex-end" }}>
        {dealing
          ? [0, 1].map(i => <PlayingCard key={i} delay={dealingOffset + i * 0.8} />)
          : cards.length > 0
            ? cards.map((c, i) => <PlayingCard key={`${i}-${c.rank}${c.suit}`} card={c} delay={dealingOffset + i * 0.8} />)
            : [0, 1].map(i => <PlayingCard key={i} />)
        }
      </div>

      {/* Fixed height score badge — always 50px, opacity crossfade only */}
      <div style={{ width: 50, height: 50, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: showScore && isWinner ? color : "rgba(255,255,255,0.05)", border: `2px solid ${showScore && isWinner ? color : "rgba(255,255,255,0.08)"}`, boxShadow: showScore && isWinner ? `0 0 18px ${color}55` : "none", transition: "background 0.3s, border-color 0.3s, box-shadow 0.3s" }}>
        <span style={{ fontSize: 24, fontWeight: 900, color: showScore ? (isWinner ? "#fff" : "rgba(255,255,255,0.7)") : "transparent", transition: "color 0.25s" }}>
          {showScore ? total : "0"}
        </span>
      </div>
    </div>
  );
}

// ── Chip button ───────────────────────────────────────────────────────────────

function Chip({ value, selected, onClick }: { value: number; selected: boolean; onClick: () => void }) {
  const s = CHIP_STYLE[value];
  return (
    <button onClick={onClick} style={{
      width: 58, height: 58, borderRadius: "50%",
      border: `2.5px solid ${s.border}`,
      background: selected ? `radial-gradient(ellipse at 35% 30%, ${s.border}cc, ${s.bg})` : "rgba(255,255,255,0.03)",
      color: selected ? "#fff" : s.border,
      fontSize: 12, fontWeight: 800,
      boxShadow: selected ? `0 0 14px ${s.bg}aa, 0 0 0 3px rgba(255,255,255,0.15), 0 4px 12px rgba(0,0,0,0.5)` : "0 2px 8px rgba(0,0,0,0.3)",
      transform: selected ? "translateY(-3px) scale(1.1)" : "none",
      transition: "all 0.15s cubic-bezier(0.34,1.56,0.64,1)",
      cursor: "pointer",
    }}>
      {fmt(value)}
    </button>
  );
}

// ── Bet zone button ───────────────────────────────────────────────────────────

function BetZone({ side, label, odds, myBet, selected, isWinner, isLoser, disabled, onClick }: {
  side: Side; label: string; odds: string; myBet: number;
  selected: boolean; isWinner: boolean; isLoser: boolean; disabled: boolean; onClick: () => void;
}) {
  const col = OUTCOME_COL[side];
  const active = selected && !disabled;

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={!disabled ? { scale: 0.97 } : {}}
      style={{
        flex: side === "tie" ? "0 0 130px" : 1,
        minHeight: 96,
        borderRadius: 12,
        border: isWinner ? `2px solid ${col}` : active ? `2px solid ${col}66` : "2px solid rgba(255,255,255,0.07)",
        background: isWinner
          ? `linear-gradient(135deg, ${col}22, ${col}0a)`
          : active
          ? `linear-gradient(135deg, ${col}18, ${col}06)`
          : isLoser ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.04)",
        cursor: disabled ? "default" : "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        opacity: isLoser ? 0.4 : 1,
        position: "relative", overflow: "hidden",
        transition: "all 0.25s",
        boxShadow: isWinner ? `0 0 30px ${col}33` : active ? `0 0 16px ${col}22` : "none",
      }}>
      {/* Winner pulse overlay */}
      {isWinner && (
        <motion.div style={{ position: "absolute", inset: 0, background: `${col}08`, borderRadius: 10 }}
          animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
      )}

      <span style={{ fontSize: 16, fontWeight: 800, color: isWinner || active ? col : "rgba(255,255,255,0.55)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{odds}</span>

      {myBet > 0 && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          style={{ padding: "2px 10px", borderRadius: 99, background: `${col}25`, border: `1px solid ${col}55`, fontSize: 11, fontWeight: 700, color: col, marginTop: 2 }}>
          {fmt(myBet)}
        </motion.div>
      )}
    </motion.button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BaccaratPage() {
  const { playerId, sessionToken, currentPlayer } = useStore();
  const [, setLocation] = useLocation();
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/login"));

  const [gamePhase, setGamePhase] = useState<GameState>("idle");
  const [selectedSide, setSelectedSide] = useState<Side | null>(null);
  const [betAmount, setBetAmount] = useState(500);
  const [result, setResult] = useState<Result | null>(null);
  const [revealResult, setRevealResult] = useState(false);
  const [error, setErrorMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [localChips, setLocalChips] = useState<number | null>(null);
  const [minBet, setMinBet] = useState(100);
  const [maxBet, setMaxBet] = useState(100000);

  useEffect(() => { if (!playerId) setLocation("/login"); }, [playerId]);

  const chips = localChips ?? liveChips ?? currentPlayer?.chips ?? 0;

  // Fetch config on mount
  useEffect(() => {
    fetch(`${BASE}/api/baccarat/tables`).then(r => r.json()).then((tables: any[]) => {
      const open = tables.find(t => t.isOpen);
      if (open) { setMinBet(open.minBet); setMaxBet(open.maxBet); }
    }).catch(() => {});
  }, []);

  function showError(msg: string) {
    setErrorMsg(msg);
    setTimeout(() => setErrorMsg(null), 3000);
  }

  const MIN_DEAL_MS = 2000; // minimum before result reveal (extra waits added per card count)

  const deal = useCallback(async () => {
    if (!selectedSide || !sessionToken) return;
    if (betAmount < minBet) return showError(`Min bet: ${fmt(minBet)}`);
    if (betAmount > maxBet) return showError(`Max bet: ${fmt(maxBet)}`);
    if (betAmount > chips) return showError("Not enough chips");

    setGamePhase("dealing");
    setResult(null);
    setRevealResult(false);
    const startedAt = Date.now();

    try {
      const r = await fetch(`${BASE}/api/baccarat/play-single`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ side: selectedSide, amount: betAmount }),
      });
      const data = await r.json();
      if (!r.ok) { setGamePhase("idle"); showError(data.error ?? "Failed"); return; }

      // Wait for dealing animation to finish before revealing
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_DEAL_MS) await new Promise(res => setTimeout(res, MIN_DEAL_MS - elapsed));

      // Compute card reveal times from actual card counts (handles 2 or 3 cards per hand)
      // Sequence: P1=0, B1=0.4, P2=0.8, B2=1.2, P3=1.6, B3=2.0
      const playerTimes = (data.playerCards as Card[]).map((_, i) => i * 0.8);
      const bankerTimes = (data.bankerCards as Card[]).map((_, i) => 0.4 + i * 0.8);
      const allCardTimes = [...playerTimes, ...bankerTimes].sort((a, b) => a - b);
      const lastCardTime = allCardTimes.at(-1) ?? 1.2;
      const requiredMs = Math.round((lastCardTime + 0.5) * 1000);

      // Ensure animation has enough time to finish for this many cards
      const elapsed2 = Date.now() - startedAt;
      if (elapsed2 < requiredMs) await new Promise(res => setTimeout(res, requiredMs - elapsed2));

      setLocalChips(data.chips);
      setResult(data);
      setGamePhase("result");

      // Fire card sounds synced to each card's reveal animation
      requestAnimationFrame(() => requestAnimationFrame(() => {
        allCardTimes.forEach(d => playCardSound(d));

        const afterLastCard = (lastCardTime + 0.55) * 1000;

        // Reveal winner, history, and sound all at the same moment — after last card fully flips
        setTimeout(() => {
          setRevealResult(true);
          setHistory(h => [{ outcome: data.outcome, netProfit: data.netProfit }, ...h].slice(0, 50));
          if (data.side === data.outcome) playWin();
          else if (data.side !== "tie" && data.outcome === "tie") playPush();
          else playLose();
        }, afterLastCard);
      }));
    } catch {
      setGamePhase("idle");
      showError("Connection error");
    }
  }, [selectedSide, betAmount, chips, sessionToken, minBet, maxBet]);

  function reset() {
    setGamePhase("idle");
    setResult(null);
    setRevealResult(false);
  }

  const isDealing = gamePhase === "dealing";
  const isResult = gamePhase === "result";
  const canDeal = gamePhase === "idle" && !!selectedSide && betAmount >= minBet && betAmount <= chips;

  const outcome = result?.outcome ?? null;
  // revealResult gates all winner displays — only goes true after card animations finish
  const playerWins = revealResult && outcome === "player";
  const bankerWins = revealResult && outcome === "banker";
  const tieWins    = revealResult && outcome === "tie";
  const isWin  = revealResult && result?.side === result?.outcome;
  const isPush = revealResult && result?.side !== "tie" && outcome === "tie";

  const tiePayout = result?.config.tiePayout ?? 8;
  const bankerComm = result?.config.bankerCommission ?? 5;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: "#0a1018", color: "#fff", fontFamily: "inherit", overflowY: "auto" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 0 40px" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#0f1923" }}>
        <button onClick={() => setLocation("/tablegames")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(255,255,255,0.4)", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "4px 0" }}
          onMouseEnter={e => e.currentTarget.style.color = "#fff"} onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}>
          <ChevronLeft style={{ width: 16, height: 16 }} /> Table Games
        </button>

        <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.7)", textTransform: "uppercase" }}>Baccarat</span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "4px 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b" }}>{Number(chips).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* ── History ribbon ─────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div style={{ display: "flex", gap: 4, padding: "8px 16px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0, overflowX: "auto" }}>
          {history.slice(0, 20).map((h, i) => (
            <div key={i} style={{ width: 20, height: 20, borderRadius: "50%", background: OUTCOME_COL[h.outcome], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 900, color: "#fff", flexShrink: 0, opacity: Math.max(0.3, 1 - i * 0.04) }}>
              {SIDE_LABEL[h.outcome]}
            </div>
          ))}
        </div>
      )}

      {/* ── Error toast ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {error && (
          <motion.div key="err" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 100, padding: "8px 18px", borderRadius: 99, background: "#7f1d1d", border: "1px solid #dc2626", color: "#fca5a5", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content area ────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", padding: "24px 20px", gap: 18 }}>

        {/* ── Card table ─────────────────────────────────────────────────────── */}
        <div style={{ background: "linear-gradient(135deg, #142030 0%, #0d1a28 100%)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "28px 24px 24px", boxShadow: "0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)" }}>

          {/* Fixed-height status row — 32px, never causes layout shift */}
          <div style={{ height: 32, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
            <AnimatePresence mode="wait">
              {revealResult && outcome ? (
                <motion.div key="result"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 16px", borderRadius: 99, background: isWin ? `${OUTCOME_COL[outcome]}22` : isPush ? "rgba(255,255,255,0.07)" : "rgba(239,68,68,0.12)", border: `1px solid ${isWin ? OUTCOME_COL[outcome] + "55" : isPush ? "rgba(255,255,255,0.12)" : "rgba(239,68,68,0.25)"}` }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: isWin ? OUTCOME_COL[outcome] : isPush ? "#e5e7eb" : "#f87171", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                    {isPush ? "PUSH — bet returned" : `${outcome.toUpperCase()} WINS`}
                  </span>
                  {isWin && result!.netProfit > 0 && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: OUTCOME_COL[outcome] }}>+{fmt(result!.netProfit)}</span>
                  )}
                </motion.div>
              ) : isDealing ? (
                <motion.span key="dealing"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em" }}>
                  DEALING…
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>

          {/* Hands — all fixed heights, nothing shifts */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 40, justifyContent: "center" }}>
            <Hand
              label="Player"
              cards={result?.playerCards ?? []}
              total={result?.playerTotal ?? null}
              color={OUTCOME_COL.player}
              isWinner={playerWins}
              dealing={isDealing}
              dealingOffset={0}
            />

            {/* VS divider — fixed height matching hand content */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 32, height: 210 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.1)", letterSpacing: "0.15em" }}>VS</span>
            </div>

            <Hand
              label="Banker"
              cards={result?.bankerCards ?? []}
              total={result?.bankerTotal ?? null}
              color={OUTCOME_COL.banker}
              isWinner={bankerWins}
              dealing={isDealing}
              dealingOffset={0.4}
            />
          </div>
        </div>

        {/* ── Betting zones ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <BetZone
            side="player" label="Player" odds="1:1"
            myBet={selectedSide === "player" && gamePhase === "idle" ? betAmount : 0}
            selected={selectedSide === "player"}
            isWinner={playerWins}
            isLoser={revealResult && !playerWins && !tieWins}
            disabled={gamePhase !== "idle"}
            onClick={() => setSelectedSide(s => s === "player" ? null : "player")}
          />
          <BetZone
            side="tie" label="Tie" odds={`${tiePayout}:1`}
            myBet={selectedSide === "tie" && gamePhase === "idle" ? betAmount : 0}
            selected={selectedSide === "tie"}
            isWinner={tieWins}
            isLoser={revealResult && !tieWins}
            disabled={gamePhase !== "idle"}
            onClick={() => setSelectedSide(s => s === "tie" ? null : "tie")}
          />
          <BetZone
            side="banker" label="Banker" odds={`1:1 (-${bankerComm}%)`}
            myBet={selectedSide === "banker" && gamePhase === "idle" ? betAmount : 0}
            selected={selectedSide === "banker"}
            isWinner={bankerWins}
            isLoser={revealResult && !bankerWins && !tieWins}
            disabled={gamePhase !== "idle"}
            onClick={() => setSelectedSide(s => s === "banker" ? null : "banker")}
          />
        </div>

        {/* ── Controls ───────────────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Chip row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {CHIPS.map(v => (
              <Chip key={v} value={v} selected={betAmount === v}
                onClick={() => { if (gamePhase !== "idle") return; setBetAmount(v); }} />
            ))}
            {/* Manual input */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "8px 14px" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>BET</span>
              <input
                type="number" value={betAmount} min={minBet} max={maxBet}
                onChange={e => { const v = Math.max(1, parseInt(e.target.value) || 0); setBetAmount(v); }}
                disabled={gamePhase !== "idle"}
                style={{ width: 80, background: "none", border: "none", color: "#fff", fontSize: 16, fontWeight: 700, outline: "none", textAlign: "center" }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12 }}>
            {/* Deal / Result action */}
            {gamePhase !== "result" ? (
              <motion.button
                onClick={deal}
                disabled={!canDeal || isDealing}
                whileTap={canDeal ? { scale: 0.97 } : {}}
                style={{
                  flex: 1, height: 58, borderRadius: 12,
                  background: canDeal ? "linear-gradient(135deg, #1e8c4a, #166534)" : "rgba(255,255,255,0.06)",
                  border: canDeal ? "1px solid #22c55e44" : "1px solid rgba(255,255,255,0.06)",
                  color: canDeal ? "#fff" : "rgba(255,255,255,0.3)",
                  fontSize: 17, fontWeight: 800, letterSpacing: "0.06em",
                  cursor: canDeal ? "pointer" : "not-allowed",
                  boxShadow: canDeal ? "0 4px 20px rgba(34,197,94,0.25)" : "none",
                  transition: "all 0.2s",
                }}>
                {isDealing ? "Dealing…" : !selectedSide ? "Select a side" : `Deal — ${fmt(betAmount)}`}
              </motion.button>
            ) : (
              <motion.button
                onClick={reset}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                whileTap={{ scale: 0.97 }}
                style={{
                  flex: 1, height: 58, borderRadius: 12,
                  background: "linear-gradient(135deg, #1e3a5f, #152d4a)",
                  border: "1px solid rgba(79,142,255,0.3)",
                  color: "#4f8eff",
                  fontSize: 16, fontWeight: 800, letterSpacing: "0.06em",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: "0 4px 16px rgba(79,142,255,0.15)",
                }}>
                <RotateCcw style={{ width: 16, height: 16 }} /> Deal Again
              </motion.button>
            )}

            {/* Clear side selection */}
            {gamePhase === "idle" && selectedSide && (
              <button onClick={() => setSelectedSide(null)}
                style={{ padding: "0 20px", height: 58, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Bet range info */}
        <div style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.18)" }}>
          Min {fmt(minBet)} · Max {fmt(maxBet)} · Banker commission {bankerComm}% · Tie pays {tiePayout}:1
        </div>
      </div>

      </div>{/* maxWidth container */}
    </div>
  );
}
