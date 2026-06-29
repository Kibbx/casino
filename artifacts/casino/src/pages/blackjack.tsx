import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { useGetPlayer } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Users, Clock, Lock, X, RotateCcw } from "lucide-react";
import { playSound } from "../lib/sounds";
import { awardXP } from "../lib/rewardsState";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { PlayingCardImg, MiniPlayingCard } from "../components/PlayingCardImg";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";

// ── Types ─────────────────────────────────────────────────────────────────────

type Card = { rank: string; suit: string; hidden?: boolean };
type SeatStatus =
  | "empty" | "seated" | "bet_placed" | "active"
  | "standing" | "busted" | "blackjack" | "finished";
type BJPhase =
  | "WAITING" | "BETTING" | "DEALING" | "PLAYER_TURNS"
  | "DEALER_TURN" | "RESOLUTION" | "RESETTING";

interface BJSeat {
  seatIndex: number;
  playerId: number | null;
  username: string | null;
  avatarUrl: string | null;
  chips: number;
  status: SeatStatus;
  bet: number;
  cards: Card[];
  splitCards: Card[] | null;
  splitBet: number;
  activeHand: "main" | "split";
  result: string | null;
  splitResult: string | null;
  payout: number;
  splitPayout: number;
}

interface TableState {
  roundId: number;
  phase: BJPhase;
  seats: BJSeat[];
  dealerCards: Card[];
  dealerValue: number;
  currentTurnSeat: number | null;
  phaseEndsAt: number | null;
}

interface BJTableInfo {
  id: number;
  name: string;
  minBet: number;
  maxBet: number;
  numSeats: number;
  theme: string;
  isOpen: boolean;
  hasPassword: boolean;
  seatedCount: number;
  phase: string;
}

// ── Seat arc positions ────────────────────────────────────────────────────────
const SEAT_ARCS: Record<number, Array<{ left: string; top: string }>> = {
  1: [{ left: "50%", top: "76%" }],
  2: [{ left: "30%", top: "76%" }, { left: "70%", top: "76%" }],
  3: [{ left: "20%", top: "67%" }, { left: "50%", top: "76%" }, { left: "80%", top: "67%" }],
  4: [{ left: "15%", top: "60%" }, { left: "37%", top: "76%" }, { left: "63%", top: "76%" }, { left: "85%", top: "60%" }],
  5: [{ left: "7%", top: "50%" }, { left: "25%", top: "70%" }, { left: "50%", top: "76%" }, { left: "75%", top: "70%" }, { left: "93%", top: "50%" }],
  6: [{ left: "7%", top: "50%" }, { left: "21%", top: "67%" }, { left: "37%", top: "76%" }, { left: "63%", top: "76%" }, { left: "79%", top: "67%" }, { left: "93%", top: "50%" }],
  7: [{ left: "4%", top: "46%" }, { left: "15%", top: "62%" }, { left: "30%", top: "74%" }, { left: "50%", top: "78%" }, { left: "70%", top: "74%" }, { left: "85%", top: "62%" }, { left: "96%", top: "46%" }],
};
const SEAT_ARC = SEAT_ARCS[6];

// ── Chip definitions (7 physical chips) ───────────────────────────────────────

const CHIP_DEFS = [
  { value: 100,       file: "chip_white.png",  label: "100",   glow: "rgba(230,230,230,0.55)" },
  { value: 500,       file: "chip_green.png",  label: "500",   glow: "rgba(34,197,94,0.55)"   },
  { value: 1_000,     file: "chip_blue.png",   label: "1K",    glow: "rgba(59,130,246,0.55)"  },
  { value: 5_000,     file: "chip_red.png",    label: "5K",    glow: "rgba(239,68,68,0.55)"   },
  { value: 25_000,    file: "chip_orange.png", label: "25K",   glow: "rgba(251,146,60,0.55)"  },
  { value: 100_000,   file: "chip_purple.png", label: "100K",  glow: "rgba(192,132,252,0.55)" },
  { value: 1_000_000, file: "chip_black.png",  label: "1M",    glow: "rgba(255,255,255,0.35)" },
] as const;

type ChipDef = typeof CHIP_DEFS[number];

function getAvailableChips(maxBet: number): ChipDef[] {
  const available = CHIP_DEFS.filter(c => c.value <= maxBet);
  return available.length >= 1 ? available : [CHIP_DEFS[0]];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtChips(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return String(n);
}

function handVal(cards: Card[]): number {
  let v = 0; let aces = 0;
  for (const c of cards) {
    if (c.hidden) continue;
    if (["J","Q","K"].includes(c.rank)) v += 10;
    else if (c.rank === "A") { v += 11; aces++; }
    else v += parseInt(c.rank);
  }
  while (v > 21 && aces-- > 0) v -= 10;
  return v;
}

function resultLabel(r: string | null): { text: string; color: string; bg: string; border: string } {
  switch (r) {
    case "player_win":       return { text: "WIN",        color: "#4ade80", bg: "rgba(21,128,61,0.85)",  border: "rgba(74,222,128,0.5)"  };
    case "player_blackjack": return { text: "BLACKJACK!", color: "#fde047", bg: "rgba(161,98,7,0.85)",   border: "rgba(253,224,71,0.5)"  };
    case "dealer_bust":      return { text: "WIN",        color: "#4ade80", bg: "rgba(21,128,61,0.85)",  border: "rgba(74,222,128,0.5)"  };
    case "push":             return { text: "PUSH",       color: "#93c5fd", bg: "rgba(29,78,216,0.85)",  border: "rgba(147,197,253,0.5)" };
    case "player_bust":      return { text: "BUST",       color: "#fca5a5", bg: "rgba(153,27,27,0.85)",  border: "rgba(252,165,165,0.5)" };
    case "dealer_win":       return { text: "LOSE",       color: "#fca5a5", bg: "rgba(153,27,27,0.85)",  border: "rgba(252,165,165,0.5)" };
    default:                 return { text: "",           color: "",        bg: "",                      border: ""                      };
  }
}

function canSplitCheck(seat: BJSeat): boolean {
  return seat.cards.length === 2
    && seat.splitCards === null
    && seat.cards[0].rank === seat.cards[1].rank
    && seat.activeHand === "main";
}

// ── Mini / Full card ──────────────────────────────────────────────────────────

function MiniCard({ card, w, h }: { card: Card; w?: number | string; h?: number | string; fs?: number | string }) {
  if (typeof w === "string" || typeof h === "string") {
    return <MiniPlayingCard rank={card.rank} suit={card.suit} hidden={card.hidden} cssWidth={w as string} cssHeight={h as string} />;
  }
  return <MiniPlayingCard rank={card.rank} suit={card.suit} hidden={card.hidden} width={w ?? 48} height={h ?? 68} />;
}

function CardView({ card, delay = 0 }: { card: Card; delay?: number }) {
  return <PlayingCardImg rank={card.rank} suit={card.suit} hidden={card.hidden} width={80} height={116} delay={delay} />;
}

// ── Value badge ───────────────────────────────────────────────────────────────

function ValBadge({ value, bust }: { value: number; bust?: boolean }) {
  const bg  = bust ? "rgba(153,27,27,0.9)"  : value === 21 ? "rgba(161,98,7,0.9)"  : "rgba(0,0,0,0.75)";
  const col = bust ? "#fca5a5"               : value === 21 ? "#fde047"              : "#fff";
  const bdr = bust ? "rgba(239,68,68,0.6)"  : value === 21 ? "rgba(253,224,71,0.6)" : "rgba(255,255,255,0.2)";
  return (
    <span style={{
      display: "inline-block", padding: "3px 11px", borderRadius: 99,
      fontSize: 14, fontWeight: 900, lineHeight: "20px",
      background: bg, color: col, border: `1.5px solid ${bdr}`,
      boxShadow: `0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)`,
    }}>
      {bust ? "BUST" : value}
    </span>
  );
}

// ── Countdown ─────────────────────────────────────────────────────────────────

const MAX_PHASE_SECS = 60;
function useCountdown(phaseEndsAt: number | null) {
  const [secs, setSecs] = useState<number | null>(null);
  useEffect(() => {
    if (!phaseEndsAt) { setSecs(null); return; }
    const tick = () => {
      const raw = Math.ceil((phaseEndsAt - Date.now()) / 1000);
      if (raw <= 0) { setSecs(0); return; }
      if (raw > MAX_PHASE_SECS) { setSecs(null); return; }
      setSecs(raw);
    };
    tick(); const id = setInterval(tick, 250); return () => clearInterval(id);
  }, [phaseEndsAt]);
  return secs;
}

function PhaseTimer({ phaseEndsAt }: { phaseEndsAt: number | null }) {
  const secs = useCountdown(phaseEndsAt);
  if (secs === null) return null;
  const urgent = secs <= 5;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: urgent ? "#f87171" : "rgba(255,255,255,0.35)", fontWeight: urgent ? 700 : 400 }}>
      <Clock style={{ width: 11, height: 11 }} />{secs}s
    </span>
  );
}

// ── Circular countdown — centered on felt during BETTING phase ────────────────

function CircularCountdownTimer({ phaseEndsAt }: { phaseEndsAt: number | null }) {
  // Integer seconds for the display text — 250 ms poll (existing hook)
  const secs = useCountdown(phaseEndsAt);

  // Continuous 0→1 fraction for the ring — driven by requestAnimationFrame (60 fps)
  const [fraction, setFraction] = useState<number>(1);
  const rafRef     = useRef<number>(0);
  const totalMsRef = useRef<number>(1);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (!phaseEndsAt) { setFraction(1); return; }
    // Capture total duration the moment this phase's end-time is known
    totalMsRef.current = Math.max(1, phaseEndsAt - Date.now());

    const tick = () => {
      const rem = phaseEndsAt - Date.now();
      if (rem <= 0) { setFraction(0); return; }
      setFraction(rem / totalMsRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phaseEndsAt]);

  if (secs === null) return null;

  const SIZE   = 120;
  const R      = 46;
  const C      = 2 * Math.PI * R;
  const cx     = SIZE / 2;
  const cy     = SIZE / 2;
  const frac   = Math.max(0, Math.min(1, fraction));
  const offset = C * (1 - frac);   // 0 = full ring, C = empty
  const urgent = secs <= 5;
  const color  = urgent ? "#f87171" : "#4ade80";
  const glowA  = urgent ? "rgba(248,113,113,0.65)" : "rgba(74,222,128,0.6)";
  const glowB  = urgent ? "rgba(248,113,113,0.22)" : "rgba(74,222,128,0.22)";

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{
        display: "block",
        width:  "clamp(72px, 7vw, 110px)",
        height: "clamp(72px, 7vw, 110px)",
        filter: `drop-shadow(0 0 18px ${glowA}) drop-shadow(0 0 6px ${glowB})`,
        transition: "filter 0.3s ease",
      }}
    >
      {/* dark glass backdrop */}
      <circle cx={cx} cy={cy} r={R + 5}
        fill="rgba(0,0,0,0.62)"
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={1}
      />
      {/* dim track ring */}
      <circle cx={cx} cy={cy} r={R}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={7}
      />
      {/* progress arc — origin at 12 o'clock, drains clockwise; no CSS transition
          because RAF already provides per-frame updates */}
      <circle cx={cx} cy={cy} r={R}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeDasharray={`${C} ${C}`}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ transition: "stroke 0.3s ease" }}
      />
      {/* seconds number */}
      <text
        x={cx} y={cy - 4}
        textAnchor="middle"
        dominantBaseline="auto"
        fill={color}
        fontSize={28}
        fontWeight={900}
        fontFamily="'Rajdhani', 'Orbitron', monospace"
        style={{ transition: "fill 0.3s ease", userSelect: "none" } as React.CSSProperties}
      >
        {secs}
      </text>
      {/* unit label */}
      <text
        x={cx} y={cy + 18}
        textAnchor="middle"
        dominantBaseline="auto"
        fill={urgent ? "rgba(248,113,113,0.6)" : "rgba(74,222,128,0.5)"}
        fontSize={10}
        fontWeight={700}
        fontFamily="inherit"
        style={{ transition: "fill 0.3s ease", userSelect: "none", letterSpacing: 2 } as React.CSSProperties}
      >
        SEC
      </text>
    </svg>
  );
}

// ── Stacked chip visual ───────────────────────────────────────────────────────

const CHIP_FILE_MAP: Record<number, string> = Object.fromEntries(CHIP_DEFS.map(c => [c.value, c.file]));

function chipFileFor(value: number): string {
  const sorted = CHIP_DEFS.slice().sort((a, b) => b.value - a.value);
  for (const c of sorted) { if (value >= c.value) return c.file; }
  return CHIP_DEFS[0].file;
}

function StackedBetZone({
  betStack, base, onClickStack, totalBet
}: { betStack: number[]; base: string; onClickStack: () => void; totalBet: number }) {
  const CHIP_H = 56;
  const CHIP_OFFSET = 9;
  const MAX_DISPLAY = 12;

  const display = betStack.length > MAX_DISPLAY ? betStack.slice(betStack.length - MAX_DISPLAY) : betStack;
  const n = display.length;
  const stackH = n === 0 ? 0 : CHIP_H + (n - 1) * CHIP_OFFSET;
  const zoneH = Math.max(80, stackH + 28);

  return (
    <div
      onClick={betStack.length > 0 ? onClickStack : undefined}
      title={betStack.length > 0 ? "Click to undo last chip" : ""}
      style={{
        position: "relative",
        width: 80, minHeight: zoneH,
        display: "flex", flexDirection: "column", alignItems: "center",
        cursor: betStack.length > 0 ? "pointer" : "default",
        flexShrink: 0,
      }}
    >
      {/* Circle bet zone background */}
      <div style={{
        position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: 70, height: 70, borderRadius: "50%",
        border: `2px dashed ${totalBet > 0 ? "rgba(253,224,71,0.5)" : "rgba(255,255,255,0.12)"}`,
        background: totalBet > 0 ? "rgba(161,98,7,0.12)" : "rgba(0,0,0,0.15)",
        transition: "border-color 0.3s, background 0.3s",
        boxShadow: totalBet > 0 ? "0 0 20px rgba(253,224,71,0.15)" : "none",
      }} />

      {/* Stacked chips */}
      <div style={{
        position: "absolute", bottom: 8,
        left: "50%", transform: "translateX(-50%)",
        width: CHIP_H, height: stackH || 1,
      }}>
        <AnimatePresence>
          {display.map((v, i) => (
            <motion.img
              key={`${i}-${v}`}
              src={`${base}/chips/${chipFileFor(v)}`}
              alt=""
              initial={{ opacity: 0, y: -20, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ type: "spring", stiffness: 400, damping: 28, delay: 0.02 * i }}
              style={{
                position: "absolute",
                bottom: i * CHIP_OFFSET,
                left: 0,
                width: CHIP_H, height: CHIP_H,
                objectFit: "contain",
                pointerEvents: "none",
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.7))",
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Chip tray ─────────────────────────────────────────────────────────────────

function ChipTray({
  chips, base, onChipClick, disabled, playerChips,
}: {
  chips: ChipDef[]; base: string; onChipClick: (v: number) => void; disabled: boolean; playerChips: number;
}) {
  return (
    <div style={{ display: "flex", gap: "clamp(8px, 1.2vw, 16px)", justifyContent: "center", alignItems: "flex-end", flexWrap: "wrap" }}>
      {chips.map(chip => {
        const canAfford = playerChips >= chip.value;
        return (
          <div
            key={chip.value}
            onClick={() => { if (!disabled && canAfford) onChipClick(chip.value); }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              cursor: disabled || !canAfford ? "not-allowed" : "pointer",
              opacity: disabled || !canAfford ? 0.35 : 1,
              transition: "transform 0.15s, filter 0.15s",
            }}
            onMouseEnter={e => {
              if (!disabled && canAfford) {
                (e.currentTarget as HTMLDivElement).style.transform = "translateY(-6px)";
                (e.currentTarget as HTMLDivElement).style.filter = `drop-shadow(0 6px 14px ${chip.glow})`;
              }
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLDivElement).style.filter = "none";
            }}
          >
            <img
              src={`${base}/chips/${chip.file}`}
              alt={chip.label}
              style={{
                width: "clamp(46px, 4.8vw, 62px)", height: "clamp(46px, 4.8vw, 62px)",
                objectFit: "contain",
                filter: "drop-shadow(0 3px 8px rgba(0,0,0,0.6))",
                pointerEvents: "none",
              }}
            />
            <span style={{
              fontSize: "clamp(9px, 0.9vw, 12px)", fontWeight: 800,
              color: "rgba(255,255,255,0.65)", letterSpacing: 0.5,
            }}>{chip.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────────

const ACTION_THEMES: Record<string, { bg: string; border: string; glow: string; hover: string }> = {
  green:  { bg: "#15803d", border: "#22c55e", glow: "rgba(34,197,94,0.35)",  hover: "#166534" },
  red:    { bg: "#b91c1c", border: "#ef4444", glow: "rgba(239,68,68,0.35)",  hover: "#991b1b" },
  blue:   { bg: "#1d4ed8", border: "#3b82f6", glow: "rgba(59,130,246,0.35)", hover: "#1e3a8a" },
  purple: { bg: "#6d28d9", border: "#8b5cf6", glow: "rgba(139,92,246,0.35)", hover: "#5b21b6" },
  amber:  { bg: "#a16207", border: "#f59e0b", glow: "rgba(245,158,11,0.35)", hover: "#92400e" },
};

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled: boolean }) {
  const c = ACTION_THEMES[color] ?? ACTION_THEMES.green;
  return (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: "0 clamp(18px, 2.8vw, 36px)", height: "clamp(46px, 5.5vh, 62px)",
        borderRadius: 14, background: c.bg, border: `2px solid ${c.border}`,
        color: "#fff", fontSize: "clamp(13px, 1.5vw, 18px)", fontWeight: 900,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
        boxShadow: disabled ? "none" : `0 0 16px ${c.glow}, 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`,
        transition: "all 0.12s", letterSpacing: 1.5, minWidth: "clamp(80px, 9.5vw, 120px)",
        textTransform: "uppercase" as const,
      }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = c.hover; e.currentTarget.style.transform = "translateY(-1px)"; } }}
      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = c.bg; e.currentTarget.style.transform = "translateY(0)"; } }}
    >
      {label}
    </button>
  );
}

// ── Phase labels ──────────────────────────────────────────────────────────────

const PHASE_LABELS: Record<BJPhase, string> = {
  WAITING:      "Waiting for players",
  BETTING:      "Place your bets",
  DEALING:      "Dealing cards…",
  PLAYER_TURNS: "Players acting",
  DEALER_TURN:  "Dealer playing…",
  RESOLUTION:   "Round complete",
  RESETTING:    "Next round soon…",
};

const PHASE_COLOR: Record<BJPhase, string> = {
  WAITING: "rgba(255,255,255,0.3)", BETTING: "#fde047", DEALING: "rgba(255,255,255,0.45)",
  PLAYER_TURNS: "#4ade80", DEALER_TURN: "#fb923c", RESOLUTION: "#c084fc", RESETTING: "rgba(255,255,255,0.3)",
};

// ── Seat component ────────────────────────────────────────────────────────────

function Seat({ seat, isLocal, isCurrentTurn, phase, onSit, onLeave }: {
  seat: BJSeat; isLocal: boolean; isCurrentTurn: boolean; phase: BJPhase;
  onSit: (i: number) => void; onLeave: () => void;
}) {
  const isEmpty  = seat.status === "empty";
  const isMyTurn = isCurrentTurn && phase === "PLAYER_TURNS";
  const canSit   = isEmpty && (phase === "WAITING" || phase === "BETTING");
  const canLeave = isLocal && !isEmpty;
  const showResult = phase === "RESOLUTION" || phase === "RESETTING";
  const rl = showResult ? resultLabel(seat.result) : null;
  const displayCards = seat.activeHand === "split" && seat.splitCards ? seat.splitCards : seat.cards;
  const val = displayCards.length > 0 ? handVal(displayCards) : 0;
  const avatarSz = "clamp(44px, 4.5vw, 68px)";

  return (
    <div onClick={() => canSit ? onSit(seat.seatIndex) : undefined}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: canSit ? "pointer" : "default", userSelect: "none", minWidth: "clamp(64px, 7.5vw, 110px)" }}>

      {displayCards.length > 0 && (
        <div style={{ display: "flex", gap: 2, justifyContent: "center", flexWrap: "wrap" }}>
          {displayCards.map((c, i) => (
            <motion.div key={`${i}-${c.rank}${c.suit}`} initial={{ opacity: 0, y: -10, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: i * 0.08, type: "spring", stiffness: 280, damping: 22 }}>
              <MiniCard card={c} w="clamp(36px, 3.5vw, 56px)" h="clamp(52px, 5vw, 80px)" />
            </motion.div>
          ))}
        </div>
      )}

      {val > 0 && <ValBadge value={val} bust={val > 21} />}

      <div style={{ position: "relative" }}>
        {isMyTurn && (
          <motion.div style={{ position: "absolute", inset: -5, borderRadius: "50%", border: "2.5px solid #fbbf24", boxShadow: "0 0 16px rgba(251,191,36,0.6)" }}
            animate={{ opacity: [1, 0.3, 1], scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 1.3 }} />
        )}
        <div style={{
          width: avatarSz, height: avatarSz, borderRadius: "50%",
          borderWidth: isEmpty ? 2 : 2.5, borderStyle: isEmpty ? "dashed" : "solid",
          borderColor: isEmpty ? "rgba(74,222,128,0.2)" : isMyTurn ? "#fbbf24" : isLocal ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.18)",
          background: isEmpty ? "rgba(6,78,59,0.4)" : "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0,
          boxShadow: isMyTurn ? "0 0 24px rgba(251,191,36,0.45), 0 4px 12px rgba(0,0,0,0.6)" : isLocal ? "0 0 14px rgba(139,92,246,0.3), 0 4px 12px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.4)",
          transition: "border-color 0.3s, box-shadow 0.3s",
        }}>
          {isEmpty ? (
            <span style={{ color: "rgba(74,222,128,0.45)", fontSize: "clamp(14px, 1.8vw, 24px)", fontWeight: 300 }}>+</span>
          ) : seat.avatarUrl ? (
            <img src={seat.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "clamp(14px, 1.8vw, 24px)", fontWeight: 800 }}>{(seat.username ?? "?")[0]?.toUpperCase()}</span>
          )}
        </div>
      </div>

      {!isEmpty && <span style={{ fontSize: "clamp(9px, 1vw, 13px)", fontWeight: 700, color: isLocal ? "rgba(196,181,253,0.95)" : "rgba(255,255,255,0.5)", maxWidth: "clamp(64px, 8.5vw, 110px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "center" }}>{seat.username ?? "Player"}</span>}
      {isEmpty && canSit && <span style={{ fontSize: "clamp(8px, 0.9vw, 11px)", color: "rgba(74,222,128,0.45)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Sit</span>}

      {seat.bet > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 8px", background: "rgba(161,98,7,0.25)", border: "1px solid rgba(253,224,71,0.35)", borderRadius: 99, fontSize: "clamp(8px, 0.9vw, 11px)", color: "#fde047", fontWeight: 800 }}>
          B {fmtChips(seat.bet)}
        </div>
      )}

      {seat.status === "blackjack" && (
        <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring" }}
          style={{ fontSize: "clamp(9px, 1vw, 13px)", color: "#fde047", fontWeight: 900, textTransform: "uppercase", letterSpacing: 1, textShadow: "0 0 10px rgba(253,224,71,0.6)" }}>BJ!</motion.span>
      )}
      {seat.status === "busted" && <span style={{ fontSize: "clamp(9px, 1vw, 13px)", color: "#f87171", fontWeight: 900, textTransform: "uppercase" }}>Bust</span>}
      {isMyTurn && (
        <motion.span animate={{ opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 1 }}
          style={{ fontSize: "clamp(8px, 0.9vw, 12px)", color: "#fbbf24", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>Your turn</motion.span>
      )}
      {showResult && rl?.text && (
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring" }}
          style={{ fontSize: "clamp(9px, 1.1vw, 14px)", fontWeight: 900, textTransform: "uppercase", padding: "3px 10px", borderRadius: 99, color: rl.color, background: rl.bg, border: `1px solid ${rl.border}`, boxShadow: `0 0 12px ${rl.border}`, letterSpacing: 1 }}>
          {seat.splitCards ? "H1 " : ""}{rl.text}
          {seat.payout > 0 && <span style={{ fontSize: "0.7em", opacity: 0.75, marginLeft: 4 }}>+{fmtChips(seat.payout)}</span>}
        </motion.div>
      )}
      {showResult && seat.splitCards && seat.splitResult && (() => {
        const sl = resultLabel(seat.splitResult);
        return sl?.text ? (
          <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", delay: 0.1 }}
            style={{ fontSize: "clamp(8px, 0.9vw, 12px)", fontWeight: 900, textTransform: "uppercase", padding: "2px 8px", borderRadius: 99, color: sl.color, background: sl.bg, border: `1px solid ${sl.border}`, letterSpacing: 1 }}>
            H2 {sl.text}
            {seat.splitPayout > 0 && <span style={{ fontSize: "0.7em", opacity: 0.75, marginLeft: 4 }}>+{fmtChips(seat.splitPayout)}</span>}
          </motion.div>
        ) : null;
      })()}
      {canLeave && (
        <button onClick={e => { e.stopPropagation(); onLeave(); }} title="Leave seat"
          style={{ fontSize: "clamp(8px, 0.85vw, 10px)", color: "rgba(248,113,113,0.5)", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700, padding: "1px 6px" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(248,113,113,0.5)")}>
          leave
        </button>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BlackjackPage() {
  useGameClosedRedirect("blackjack", "/tablegames");
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("blackjack", sessionToken);
  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));
  const displayChips = liveChips ?? currentPlayer?.chips ?? 0;

  const [selectedTableId, setSelectedTableId] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem("bab_bj_autojoin");
      if (!raw) return null;
      const data = JSON.parse(raw);
      return typeof data?.tableId === "number" ? data.tableId : null;
    } catch { return null; }
  });
  const [selectedTableInfo, setSelectedTableInfo] = useState<BJTableInfo | null>(null);
  const [tablePassword, setTablePassword] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem("bab_bj_autojoin");
      if (!raw) return null;
      const data = JSON.parse(raw);
      sessionStorage.removeItem("bab_bj_autojoin");
      return data?.password ?? null;
    } catch { return null; }
  });
  const [bjTables, setBjTables] = useState<BJTableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [pendingJoinTable, setPendingJoinTable] = useState<BJTableInfo | null>(null);
  const [pendingPwInput, setPendingPwInput] = useState("");
  const [pendingPwError, setPendingPwError] = useState<string | null>(null);
  const [pendingPwLoading, setPendingPwLoading] = useState(false);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  // When arriving from /tablegames via sessionStorage auto-join, fetch this table's info
  useEffect(() => {
    if (selectedTableId === null || selectedTableInfo !== null) return;
    fetch(`${BASE}/api/blackjack/tables`)
      .then(r => r.json())
      .then((d: BJTableInfo[]) => {
        if (!Array.isArray(d)) return;
        const t = d.find(x => x.id === selectedTableId);
        if (t) setSelectedTableInfo(t);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyAndJoin = async () => {
    if (!pendingJoinTable || !pendingPwInput.trim() || pendingPwLoading) return;
    setPendingPwError(null); setPendingPwLoading(true);
    try {
      const res = await fetch(`${BASE}/api/blackjack/tables/${pendingJoinTable.id}/verify-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pendingPwInput.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPendingPwError(d.error ?? "Incorrect password");
      } else {
        setTablePassword(pendingPwInput.trim()); setSelectedTableId(pendingJoinTable.id);
        setSelectedTableInfo(pendingJoinTable); setPendingJoinTable(null); setPendingPwInput("");
      }
    } catch { setPendingPwError("Network error, try again"); }
    finally { setPendingPwLoading(false); }
  };

  useEffect(() => {
    if (selectedTableId !== null) return;
    setTablesLoading(true);
    fetch(`${BASE}/api/blackjack/tables`)
      .then(r => r.json())
      .then(d => { setBjTables(Array.isArray(d) ? d : []); setTablesLoading(false); })
      .catch(() => setTablesLoading(false));
  }, [selectedTableId]);

  const wsRef = useRef<WebSocket | null>(null);
  const [table, setTable] = useState<TableState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Chip stacking bet state
  const [betStack, setBetStack] = useState<number[]>([]);
  const [betLoading, setBetLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastStack, setLastStack] = useState<number[]>([]);

  const currentBet = betStack.reduce((a, b) => a + b, 0);

  const mySeat = table?.seats.find(s => s.playerId === playerId) ?? null;
  const myTurn = !!table && table.phase === "PLAYER_TURNS" && table.currentTurnSeat === mySeat?.seatIndex && mySeat?.status === "active";
  const seated = mySeat !== null;
  const phase = table?.phase ?? "WAITING";
  const seatArc = SEAT_ARCS[selectedTableInfo?.numSeats ?? 6] ?? SEAT_ARC;
  const emptySeatsArr: BJSeat[] = Array.from({ length: selectedTableInfo?.numSeats ?? 6 }, (_, i) => ({
    seatIndex: i, playerId: null, username: null, avatarUrl: null,
    chips: 0, status: "empty" as SeatStatus, bet: 0, cards: [], splitCards: null,
    splitBet: 0, activeHand: "main" as const, result: null, splitResult: null, payout: 0, splitPayout: 0,
  }));
  const displaySeats = table?.seats ?? emptySeatsArr;
  const seatedCount = table?.seats.filter(s => s.playerId !== null).length ?? 0;
  const showFullDealer = phase === "DEALER_TURN" || phase === "RESOLUTION" || phase === "RESETTING";
  const dealerVal = table?.dealerValue ?? 0;
  const myRl = (phase === "RESOLUTION" || phase === "RESETTING") && mySeat ? resultLabel(mySeat.result) : null;
  const canDouble = myTurn && mySeat !== null && (
    mySeat.activeHand === "main" ? mySeat.cards.length === 2 : (mySeat.splitCards ?? []).length === 2
  ) && displayChips >= (mySeat.activeHand === "split" ? mySeat.splitBet : mySeat.bet);
  const canSplitNow = myTurn && mySeat !== null && canSplitCheck(mySeat) && displayChips >= mySeat.bet;

  const tableMaxBet = selectedTableInfo?.maxBet ?? 25_000;
  const availableChips = getAvailableChips(tableMaxBet);

  usePasswordGuard("blackjack");

  const wsSubscribe = useCallback((ws: WebSocket) => {
    if (!playerId || !sessionToken || selectedTableId === null) return;
    ws.send(JSON.stringify({ type: "bj_subscribe", token: sessionToken, tableId: selectedTableId, username: currentPlayer?.username ?? "Player", avatarUrl: currentPlayer?.avatarUrl ?? null, ...(tablePassword ? { tablePassword } : {}) }));
    ws.send(JSON.stringify({ type: "subscribe_player", playerId, token: sessionToken }));
  }, [playerId, sessionToken, selectedTableId, currentPlayer?.username, currentPlayer?.avatarUrl, tablePassword]);

  useEffect(() => {
    if (!playerId || !sessionToken || selectedTableId === null) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}${BASE}/api/ws`);
    wsRef.current = ws;
    ws.onopen = () => wsSubscribe(ws);
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "bj_table_state") { setTable(msg); setError(null); }
        else if (msg.type === "bj_error") {
          const errMsg: string = msg.message ?? "Error";
          if (errMsg.toLowerCase().includes("password")) {
            setSelectedTableId(null);
            if (selectedTableInfo) { setPendingJoinTable(selectedTableInfo); setPendingPwInput(""); setPendingPwError(errMsg); }
            setSelectedTableInfo(null); setTablePassword(null); setTable(null);
          } else { setError(errMsg); setBetLoading(false); setActionLoading(false); setTimeout(() => setError(null), 4000); }
        } else if (msg.type === "bj_table_closed") { setSelectedTableId(null); setSelectedTableInfo(null); setTable(null); }
      } catch {}
    };
    return () => { ws.close(); wsRef.current = null; setTable(null); };
  }, [playerId, sessionToken, selectedTableId]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && playerId && sessionToken && currentPlayer?.username && selectedTableId !== null) {
      wsRef.current.send(JSON.stringify({ type: "bj_subscribe", token: sessionToken, tableId: selectedTableId, username: currentPlayer.username, avatarUrl: currentPlayer.avatarUrl ?? null, ...(tablePassword ? { tablePassword } : {}) }));
    }
  }, [currentPlayer?.username, currentPlayer?.avatarUrl, selectedTableId]);

  useEffect(() => { if (!playerId) setLocation("/login"); }, [playerId]);
  useEffect(() => { if (!isGameUnlocked("blackjack")) setLocation("/lobby"); }, []);

  // Reset bet stack when new round starts
  useEffect(() => {
    if (phase === "BETTING" && mySeat?.status === "seated") setBetStack([]);
  }, [phase]);

  const prevPhaseRef    = useRef<BJPhase | null>(null);
  const prevTurnRef     = useRef<number | null>(null);
  const prevMyCardsRef  = useRef<string>("");
  const prevDlrCardsRef = useRef<string>("");

  useEffect(() => {
    if (!table) return;
    const cur = table.phase; const prev = prevPhaseRef.current;
    if (prev !== null && prev !== cur) {
      if (cur === "BETTING")     playSound("chip");
      if (cur === "DEALING")     playSound("deal");
      if (cur === "DEALER_TURN") playSound("deal");
      if (cur === "RESOLUTION" && mySeat) {
        const r = mySeat.result;
        if (r === "player_blackjack")                       playSound("jackpot");
        else if (r === "player_win" || r === "dealer_bust") playSound("win");
        else if (r === "player_bust" || r === "dealer_win") playSound("lose");
        else if (r === "push")                              playSound("check");

        // ── Challenge events ──────────────────────────────────────────────────
        fireChallengeEvent("blackjack_round_played");
        if (mySeat.bet > 0) {
          fireChallengeEvent("single_bet_placed", { amount: mySeat.bet });
          fireChallengeEvent("bet_wagered", { amount: mySeat.bet });
        }
        const won = r === "player_blackjack" || r === "player_win" || r === "dealer_bust";
        fireChallengeEvent(won ? "blackjack_win" : "bet_lost");
      }
    }
    prevPhaseRef.current = cur;
    if (mySeat) {
      const myKey = mySeat.cards.map(c => `${c.rank}${c.suit}`).join(",");
      if (myKey !== prevMyCardsRef.current) { if (myKey.length > prevMyCardsRef.current.length) playSound("newCard"); prevMyCardsRef.current = myKey; }
    }
    const dlrKey = table.dealerCards.map(c => `${c.hidden ? "?" : c.rank + c.suit}`).join(",");
    if (dlrKey !== prevDlrCardsRef.current) { if (dlrKey.length > prevDlrCardsRef.current.length) playSound("deal"); prevDlrCardsRef.current = dlrKey; }
    if (cur === "PLAYER_TURNS" && table.currentTurnSeat !== prevTurnRef.current) {
      prevTurnRef.current = table.currentTurnSeat;
      if (table.currentTurnSeat === mySeat?.seatIndex) playSound("yourTurn");
    } else if (cur !== "PLAYER_TURNS") { prevTurnRef.current = null; }
  }, [table]);

  const wsSend = useCallback((msg: object) => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(msg));
  }, []);

  const handleSit   = (i: number) => sessionToken && wsSend({ type: "bj_sit",   token: sessionToken, seatIndex: i });
  const handleLeave = ()           => sessionToken && wsSend({ type: "bj_leave", token: sessionToken });

  // Chip stacking handlers
  const addChip = (value: number) => {
    if (betLoading || displayChips < currentBet + value || currentBet + value > tableMaxBet) return;
    playSound("chip");
    setBetStack(prev => [...prev, value]);
  };
  const undoLastChip = () => { if (betStack.length > 0) setBetStack(prev => prev.slice(0, -1)); };
  const clearBet = () => setBetStack([]);

  const handleBet = () => {
    if (!sessionToken || betLoading || currentBet <= 0) return;
    setBetLoading(true);
    setLastStack(betStack);
    wsSend({ type: "bj_bet", token: sessionToken, amount: currentBet });
    awardXP(currentBet);
    setTimeout(() => setBetLoading(false), 2000);
  };

  const handleRepeat = () => {
    if (!sessionToken || betLoading || lastStack.length === 0) return;
    const total = lastStack.reduce((a, b) => a + b, 0);
    if (displayChips < total || total > tableMaxBet) return;
    setBetStack(lastStack);
    setBetLoading(true);
    wsSend({ type: "bj_bet", token: sessionToken, amount: total });
    awardXP(total);
    setTimeout(() => setBetLoading(false), 2000);
  };

  const handleAction = (action: "hit" | "stand" | "double" | "split") => {
    if (!sessionToken || actionLoading) return;
    setActionLoading(true);
    wsSend({ type: `bj_${action}`, token: sessionToken });
    playSound(action === "hit" ? "deal" : "chip");
    setTimeout(() => setActionLoading(false), 1500);
  };

  // ── Table Lobby ─────────────────────────────────────────────────────────────

  if (selectedTableId === null) {
    const THEME_STYLES: Record<string, { accent: string; tagline: string; rimColor: string }> = {
      velvet:  { accent: "#dc2626", tagline: "Classic · Standard",   rimColor: "#7f1d1d" },
      gold:    { accent: "#ca8a04", tagline: "High Roller · Prestige", rimColor: "#78350f" },
      diamond: { accent: "#7c3aed", tagline: "VIP · Exclusive",       rimColor: "#3b0764" },
    };
    return (
      <div style={{ minHeight: "100vh", background: "#080811", color: "#fff", fontFamily: "inherit" }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.4)" }}>
          <button onClick={() => setLocation("/lobby")}
            style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 13, padding: "6px 12px", borderRadius: 8 }}
            onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.85)"}
            onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}>
            <ChevronLeft style={{ width: 15, height: 15 }} /> Table Games
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: 1 }}>♠ Blackjack</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>Balance</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fde047" }}>{fmtChips(displayChips)}</span>
          </div>
        </div>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "28px 20px" }}>
          {tablesLoading ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", padding: 80, fontSize: 14 }}>Loading tables…</div>
          ) : bjTables.length === 0 ? (
            <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", padding: 80, fontSize: 14 }}>No tables available.</div>
          ) : (
            <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
              {bjTables.map(t => {
                const ts = THEME_STYLES[t.theme] ?? THEME_STYLES.velvet;
                const canJoin = t.isOpen;
                return (
                  <div key={t.id} style={{ borderRadius: 20, overflow: "hidden", border: `1px solid ${canJoin ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"}`, opacity: canJoin ? 1 : 0.5, background: "#0e0e18", boxShadow: canJoin ? "0 8px 32px rgba(0,0,0,0.5)" : "none", display: "flex", flexDirection: "column", transition: "transform 0.15s, box-shadow 0.15s" }}
                    onMouseEnter={e => { if (canJoin) { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 12px 40px rgba(0,0,0,0.6), 0 0 30px ${ts.accent}20`; } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLDivElement).style.boxShadow = canJoin ? "0 8px 32px rgba(0,0,0,0.5)" : "none"; }}>
                    <div style={{ background: `linear-gradient(135deg, ${ts.rimColor} 0%, rgba(0,0,0,0.8) 100%)`, padding: "22px 22px 18px", borderBottom: `1px solid ${ts.accent}30`, position: "relative", overflow: "hidden" }}>
                      <div style={{ position: "absolute", inset: 0, opacity: 0.04, backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.5) 0, rgba(255,255,255,0.5) 1px, transparent 0, transparent 50%)", backgroundSize: "8px 8px" }} />
                      <div style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ fontSize: 12, color: ts.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>{ts.tagline}</div>
                            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{t.name}</div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{t.numSeats} seats</div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                            {t.hasPassword && <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}><Lock style={{ width: 10, height: 10 }} /> Private</span>}
                            <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: canJoin ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)", color: canJoin ? "#4ade80" : "#f87171", border: `1px solid ${canJoin ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{canJoin ? "Open" : "Closed"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div style={{ padding: "16px 22px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 14px" }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Bet Range</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>{fmtChips(t.minBet)} — {fmtChips(t.maxBet)}</div>
                        </div>
                        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "10px 14px" }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3 }}>Players</div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", gap: 5 }}><Users style={{ width: 13, height: 13, color: "rgba(255,255,255,0.4)" }} />{t.seatedCount} / {t.numSeats}</div>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: t.phase === "BETTING" ? "#4ade80" : "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.phase === "BETTING" ? "#4ade80" : "rgba(255,255,255,0.2)", display: "inline-block", flexShrink: 0 }} />
                        {t.phase === "WAITING" ? "Waiting for players" : t.phase.replace(/_/g, " ").toLowerCase()}
                      </div>
                      <button disabled={!canJoin}
                        onClick={() => { if (!canJoin) return; if (t.hasPassword) { setPendingJoinTable(t); setPendingPwInput(""); setPendingPwError(null); } else { setTablePassword(null); setSelectedTableId(t.id); setSelectedTableInfo(t); } }}
                        style={{ marginTop: 2, padding: "12px 0", borderRadius: 12, border: canJoin ? `1.5px solid ${ts.accent}60` : "1px solid rgba(255,255,255,0.08)", fontWeight: 800, fontSize: 14, cursor: canJoin ? "pointer" : "not-allowed", background: canJoin ? ts.accent : "rgba(255,255,255,0.05)", color: canJoin ? "#fff" : "rgba(255,255,255,0.25)", transition: "opacity 0.15s, transform 0.1s", textTransform: "uppercase", letterSpacing: 1.5, boxShadow: canJoin ? `0 4px 20px ${ts.accent}40` : "none" }}
                        onMouseEnter={e => { if (canJoin) { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}>
                        {canJoin ? (t.hasPassword ? "Join Private Table" : "Join Table") : "Table Closed"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {pendingJoinTable && (
          <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)" }}
            onClick={e => { if (e.target === e.currentTarget) { setPendingJoinTable(null); setPendingPwInput(""); } }}>
            <motion.div initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              style={{ background: "#12121e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "32px 28px 28px", width: 360, boxShadow: "0 24px 80px rgba(0,0,0,0.85)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Lock style={{ width: 16, height: 16, color: "#fbbf24" }} />
                </div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>{pendingJoinTable.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>Password required</div>
                </div>
              </div>
              <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "18px 0" }} />
              <input autoFocus type="password" placeholder="Enter table password" value={pendingPwInput}
                onChange={e => { setPendingPwInput(e.target.value); setPendingPwError(null); }}
                onKeyDown={e => { if (e.key === "Enter" && pendingPwInput.trim() && !pendingPwLoading) verifyAndJoin(); }}
                style={{ width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, border: `1.5px solid ${pendingPwError ? "rgba(239,68,68,0.6)" : "rgba(255,255,255,0.12)"}`, background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 14, outline: "none", marginBottom: 8 }} />
              {pendingPwError && <div style={{ fontSize: 12, color: "#f87171", marginBottom: 12 }}>{pendingPwError}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => { setPendingJoinTable(null); setPendingPwInput(""); }} style={{ flex: 1, padding: "11px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.45)", fontSize: 14, cursor: "pointer" }}>Cancel</button>
                <button disabled={!pendingPwInput.trim() || pendingPwLoading} onClick={verifyAndJoin} style={{ flex: 2, padding: "11px 0", borderRadius: 10, border: "none", background: pendingPwInput.trim() ? "#15803d" : "rgba(255,255,255,0.07)", color: pendingPwInput.trim() ? "#fff" : "rgba(255,255,255,0.25)", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: pendingPwInput.trim() ? "0 4px 16px rgba(21,128,61,0.4)" : "none" }}>
                  {pendingPwLoading ? "Verifying…" : "Join Table"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    );
  }

  // ── Game table ──────────────────────────────────────────────────────────────

  const hudH = myTurn ? 230 : (seated && phase === "BETTING") ? 240 : 90;

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden", fontFamily: "inherit", background: "#080204" }}>

      {/* ── Room: dark back-alley mob casino atmosphere ── */}
      {/* Matches site palette: near-black warm brown #0a0507 */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 100% 85% at 50% -5%, #1a0508 0%, #0d0305 40%, #080204 100%)",
      }} />
      {/* Ambient crimson lamp glow from above — like a red neon ceiling light */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(160,30,50,0.18) 0%, rgba(120,15,30,0.06) 55%, transparent 80%)",
      }} />

      {/* ── SVG: crimson felt table + aged gold rail ── */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <defs>
          {/* ── Felt fill — deep crimson/burgundy matching site primary ── */}
          <radialGradient id="bj_feltFill" cx="50%" cy="20%" r="72%" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#4a0f18" />
            <stop offset="30%"  stopColor="#360a12" />
            <stop offset="60%"  stopColor="#21060d" />
            <stop offset="100%" stopColor="#0f0306" />
          </radialGradient>

          {/* ── Crimson lamp spotlight — warm overhead light on felt ── */}
          <radialGradient id="bj_lamp" cx="50%" cy="15%" r="52%" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="rgba(200,50,70,0.22)" />
            <stop offset="45%"  stopColor="rgba(140,20,40,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>

          {/* ── Amber rim catch — light hitting the inner rail lip ── */}
          <radialGradient id="bj_rimCatch" cx="50%" cy="2%" r="52%" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="rgba(245,158,11,0.12)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>

          {/* ── Felt grain noise ── */}
          <filter id="bj_grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8 0.75" numOctaves="3" seed="7" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0" in="noise" />
          </filter>

          {/* ── Rail: aged dark wood with amber-gold inlay ── */}
          {/* Matches site's amber-400 (#f59e0b) accent on chips/staff */}
          <linearGradient id="bj_railAmber" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="rgba(180,110,15,0)" />
            <stop offset="22%"  stopColor="rgba(215,145,30,0.55)" />
            <stop offset="50%"  stopColor="rgba(245,158,11,0.95)" />
            <stop offset="78%"  stopColor="rgba(215,145,30,0.55)" />
            <stop offset="100%" stopColor="rgba(180,110,15,0)" />
          </linearGradient>
          <linearGradient id="bj_railSheen" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="rgba(255,240,180,0)" />
            <stop offset="40%"  stopColor="rgba(255,240,180,0.07)" />
            <stop offset="50%"  stopColor="rgba(255,240,180,0.18)" />
            <stop offset="60%"  stopColor="rgba(255,240,180,0.07)" />
            <stop offset="100%" stopColor="rgba(255,240,180,0)" />
          </linearGradient>

          {/* ── Crimson inner border accent ── */}
          <linearGradient id="bj_crimsonArc" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="rgba(160,34,54,0)" />
            <stop offset="30%"  stopColor="rgba(160,34,54,0.5)" />
            <stop offset="50%"  stopColor="rgba(192,40,64,0.85)" />
            <stop offset="70%"  stopColor="rgba(160,34,54,0.5)" />
            <stop offset="100%" stopColor="rgba(160,34,54,0)" />
          </linearGradient>
        </defs>

        {/* ── Felt oval: the actual table surface ── */}
        <ellipse cx="50%" cy="38%" rx="53%" ry="84%" fill="url(#bj_feltFill)" />

        {/* Fabric grain overlay — subtle velvet texture */}
        <ellipse cx="50%" cy="38%" rx="53%" ry="84%"
          fill="#5a1020" filter="url(#bj_grain)" opacity="0.07" />

        {/* Crimson overhead lamp glow */}
        <ellipse cx="50%" cy="38%" rx="53%" ry="84%" fill="url(#bj_lamp)" />

        {/* Amber light catching the inner rim */}
        <ellipse cx="50%" cy="38%" rx="53%" ry="84%" fill="url(#bj_rimCatch)" />

        {/* ── Inner table detail lines ── */}
        {/* Crimson inner arc — main dividing line (dealer / player zones) */}
        <ellipse cx="50%" cy="-1%" rx="44%" ry="43%"
          fill="none" stroke="url(#bj_crimsonArc)" strokeWidth="1.5" />
        {/* Thin inner companion line */}
        <ellipse cx="50%" cy="-1%" rx="42%" ry="41%"
          fill="none" stroke="rgba(192,40,64,0.2)" strokeWidth="0.8" />
        {/* Dashed betting zone boundary — amber tint */}
        <ellipse cx="50%" cy="-1%" rx="46%" ry="45%"
          fill="none" stroke="rgba(245,158,11,0.12)" strokeWidth="1"
          strokeDasharray="9 15" />

        {/* ── Outer rail — aged dark wood, 6 layered strokes ── */}
        {/* Deep shadow base */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="rgba(4,1,1,1)" strokeWidth="24" />
        {/* Very dark wood core */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="rgba(18,7,5,0.98)" strokeWidth="18" />
        {/* Dark brown body */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="rgba(38,15,8,0.92)" strokeWidth="12" />
        {/* Mid wood highlight */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="rgba(62,24,12,0.75)" strokeWidth="7" />
        {/* Amber-gold inlay line — matches site accent */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="url(#bj_railAmber)" strokeWidth="2.5" />
        {/* Specular sheen on inlay */}
        <ellipse cx="50%" cy="18%" rx="55.5%" ry="93.5%"
          fill="none" stroke="url(#bj_railSheen)" strokeWidth="1" />

        {/* Felt-meets-rail edge: subtle amber inner border */}
        <ellipse cx="50%" cy="18%" rx="53.8%" ry="91.8%"
          fill="none" stroke="rgba(245,158,11,0.18)" strokeWidth="1.5" />
        <ellipse cx="50%" cy="18%" rx="53.8%" ry="91.8%"
          fill="none" stroke="rgba(255,220,120,0.06)" strokeWidth="0.5" />

        {/* ── Betting spot circles at each seat position ── */}
        {SEAT_ARCS[6].map((pos, i) => {
          const lv = parseFloat(pos.left);
          const tv = parseFloat(pos.top) + 8.5;
          return (
            <g key={i}>
              <ellipse cx={`${lv}%`} cy={`${tv}%`} rx="4.2%" ry="2.7%"
                fill="none" stroke="rgba(245,158,11,0.16)" strokeWidth="1"
                strokeDasharray="5 8" />
              <ellipse cx={`${lv}%`} cy={`${tv}%`} rx="3.1%" ry="2%"
                fill="rgba(0,0,0,0.1)" stroke="rgba(192,40,64,0.12)" strokeWidth="0.5" />
            </g>
          );
        })}

        {/* ── Table watermarks — site identity ── */}
        <text x="50%" y="34%" textAnchor="middle"
          fill="rgba(192,40,64,0.1)" fontSize="clamp(10px, 2vw, 22px)"
          fontFamily="'Oswald', sans-serif" fontWeight="700" letterSpacing="12">BIG HOUSE CASINO</text>
        <text x="50%" y="40.5%" textAnchor="middle"
          fill="rgba(245,158,11,0.07)" fontSize="clamp(6px, 0.9vw, 11px)"
          fontFamily="'Oswald', sans-serif" fontWeight="500" letterSpacing="7">BLACKJACK PAYS 3 TO 2</text>
      </svg>

      {/* Heavy vignette — room darkness closes in around the table */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 85% 80% at 50% 44%, transparent 35%, rgba(4,1,2,0.92) 100%)",
      }} />

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ position: "absolute", top: 56, left: 0, right: 0, zIndex: 50, padding: "10px 20px", textAlign: "center", fontSize: 13, background: "rgba(153,27,27,0.5)", borderBottom: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5" }}>
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", zIndex: 20, background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)" }}>
        <button onClick={() => setLocation("/tablegames")}
          style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", fontSize: 12, padding: "5px 11px", borderRadius: 8 }}
          onMouseEnter={e => e.currentTarget.style.color = "rgba(255,255,255,0.85)"}
          onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}>
          <ChevronLeft style={{ width: 14, height: 14 }} /> Tables
        </button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span style={{ fontSize: "clamp(12px, 1.6vw, 17px)", fontWeight: 900, letterSpacing: 4, color: "rgba(255,255,255,0.9)", textTransform: "uppercase" }}>Blackjack</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: PHASE_COLOR[phase], display: "inline-block" }} />
            <span style={{ fontSize: "clamp(8px, 0.9vw, 11px)", color: PHASE_COLOR[phase], fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{PHASE_LABELS[phase]}</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "rgba(255,255,255,0.3)" }}><Users style={{ width: 12, height: 12 }} />{seatedCount}/{selectedTableInfo?.numSeats ?? 6}</span>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "clamp(13px, 1.7vw, 19px)", fontWeight: 900, color: "#fde047", textShadow: "0 0 10px rgba(253,224,71,0.3)" }}>{Number(displayChips).toLocaleString()}</div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", textTransform: "uppercase", letterSpacing: 1.5 }}>chips</div>
          </div>
        </div>
      </div>

      {/* ── Dealer zone ── */}
      <div style={{ position: "absolute", top: "6%", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: "clamp(32px, 3.5vw, 50px)", height: "clamp(32px, 3.5vw, 50px)", borderRadius: "50%", background: "rgba(0,0,0,0.55)", border: "2px solid rgba(255,255,255,0.15)", boxShadow: "0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: "clamp(10px, 1.3vw, 17px)", fontWeight: 800, color: "rgba(255,255,255,0.55)" }}>D</span>
          </div>
          <div>
            <div style={{ fontSize: "clamp(9px, 1vw, 13px)", fontWeight: 800, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 4 }}>Dealer</div>
            {showFullDealer && dealerVal > 0 && <div style={{ marginTop: 2 }}><ValBadge value={dealerVal} bust={dealerVal > 21} /></div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "center", flexWrap: "wrap", minHeight: 60 }}>
          <AnimatePresence mode="popLayout">
            {table && table.dealerCards.length > 0 ? (
              table.dealerCards.map((c, i) => (
                <motion.div key={`r${table.roundId}-dc-${i}-${c.rank}${c.suit}${c.hidden ? "H" : "V"}`}
                  initial={{ opacity: 0, scale: 0.7, rotateY: 90, y: -10 }} animate={{ opacity: 1, scale: 1, rotateY: 0, y: 0 }}
                  exit={{ opacity: 0, scale: 0.7 }} transition={{ duration: 0.3, type: "spring", stiffness: 300, damping: 24 }}>
                  <MiniCard card={c} w="clamp(56px, 5.2vw, 96px)" h="clamp(80px, 7.4vw, 136px)" />
                </motion.div>
              ))
            ) : (
              [0, 1].map(i => <div key={i} style={{ width: 56, height: 80, borderRadius: 8, border: "1.5px dashed rgba(74,222,128,0.1)", background: "rgba(0,0,0,0.18)" }} />)
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Timer zone — a grid cell spanning the open felt between header and HUD.
           This is the only centering mechanism; no hardcoded top/left offsets. ── */}
      <div style={{
        position: "absolute",
        top: 54,      // flush below the header bar
        left: 0,
        right: 0,
        bottom: hudH, // flush above the HUD (hudH already varies with phase/seat)
        display: "grid",
        placeItems: "center",
        zIndex: 15,
        pointerEvents: "none",
      }}>
        <AnimatePresence>
          {phase === "BETTING" && table?.phaseEndsAt && (
            <motion.div
              key="circ-timer"
              initial={{ opacity: 0, scale: 0.65 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.65 }}
              transition={{ type: "spring", stiffness: 360, damping: 28 }}
            >
              <CircularCountdownTimer phaseEndsAt={table.phaseEndsAt} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Seats ── */}
      {displaySeats.map((seat, i) => (
        <div key={i} style={{ position: "absolute", left: (seatArc[i] ?? seatArc[seatArc.length - 1]).left, top: (seatArc[i] ?? seatArc[seatArc.length - 1]).top, transform: "translate(-50%, -50%)", zIndex: 10 }}>
          <Seat seat={seat} isLocal={seat.playerId === playerId} isCurrentTurn={table?.currentTurnSeat === seat.seatIndex} phase={phase} onSit={handleSit} onLeave={handleLeave} />
        </div>
      ))}

      {/* ── Bottom HUD ── */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 30,
        background: "linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.65) 65%, transparent 100%)",
        padding: "clamp(10px, 1.8vh, 20px) clamp(12px, 3vw, 40px)",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
        minHeight: hudH, justifyContent: "flex-end",
      }}>
        <AnimatePresence>

          {/* ── BETTING — not seated ── */}
          {phase === "BETTING" && !seated && (
            <motion.div key="sit-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "clamp(12px, 1.4vw, 15px)", textAlign: "center", margin: 0 }}>Tap an open seat on the table to join</p>
            </motion.div>
          )}

          {/* ── BETTING — seated — chip stacking UI ── */}
          {phase === "BETTING" && seated && (
            <motion.div key="bet-ctrl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%" }}>

              {/* Row: stack visual + bet info + controls */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 20, justifyContent: "center", width: "100%" }}>

                {/* Stacked chip visual */}
                <StackedBetZone
                  betStack={betStack}
                  base={BASE}
                  onClickStack={undoLastChip}
                  totalBet={currentBet}
                />

                {/* Bet info + buttons */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 140 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 2 }}>Current Bet</div>
                    <div style={{ fontSize: "clamp(20px, 2.8vw, 32px)", fontWeight: 900, color: currentBet > 0 ? "#fde047" : "rgba(255,255,255,0.2)", textShadow: currentBet > 0 ? "0 0 16px rgba(253,224,71,0.4)" : "none", lineHeight: 1 }}>
                      {currentBet > 0 ? fmtChips(currentBet) : "—"}
                    </div>
                  </div>

                  {/* Quick controls */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {betStack.length > 0 && (
                      <button onClick={undoLastChip}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        <RotateCcw style={{ width: 11, height: 11 }} /> Undo
                      </button>
                    )}
                    {betStack.length > 0 && (
                      <button onClick={clearBet}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        <X style={{ width: 11, height: 11 }} /> Clear
                      </button>
                    )}
                    {lastStack.length > 0 && betStack.length === 0 && (
                      <button onClick={handleRepeat} disabled={betLoading}
                        style={{ padding: "5px 10px", borderRadius: 8, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
                        Repeat {fmtChips(lastStack.reduce((a,b)=>a+b,0))}
                      </button>
                    )}
                  </div>

                  {mySeat?.status === "bet_placed" && (
                    <div style={{ fontSize: 11, color: "rgba(74,222,128,0.75)", fontWeight: 700 }}>
                      Bet placed: {fmtChips(mySeat.bet)}
                    </div>
                  )}

                  {/* Place Bet button */}
                  <button
                    onClick={handleBet}
                    disabled={betLoading || currentBet <= 0 || displayChips < currentBet}
                    style={{
                      padding: "11px 28px", borderRadius: 12,
                      background: currentBet > 0 ? "#7c3aed" : "rgba(255,255,255,0.06)",
                      border: currentBet > 0 ? "1.5px solid rgba(167,139,250,0.55)" : "1.5px solid rgba(255,255,255,0.1)",
                      color: currentBet > 0 ? "#fff" : "rgba(255,255,255,0.25)",
                      fontSize: "clamp(13px, 1.5vw, 17px)", fontWeight: 900,
                      cursor: currentBet > 0 && !betLoading ? "pointer" : "not-allowed",
                      opacity: betLoading || currentBet <= 0 ? 0.5 : 1,
                      boxShadow: currentBet > 0 ? "0 0 24px rgba(124,58,237,0.45), 0 4px 20px rgba(0,0,0,0.4)" : "none",
                      transition: "all 0.15s", letterSpacing: 1.5, textTransform: "uppercase" as const,
                      whiteSpace: "nowrap" as const,
                    }}>
                    {betLoading ? "Placing…" : mySeat?.status === "bet_placed" ? `Change → ${fmtChips(currentBet)}` : `Place Bet`}
                  </button>
                </div>
              </div>

              {/* Chip tray */}
              <ChipTray
                chips={availableChips}
                base={BASE}
                onChipClick={addChip}
                disabled={betLoading}
                playerChips={displayChips}
              />
            </motion.div>
          )}

          {/* ── PLAYER_TURNS — my turn ── */}
          {myTurn && mySeat && (
            <motion.div key="my-turn" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
              {mySeat.splitCards ? (
                <div style={{ display: "flex", gap: 14, justifyContent: "center", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 14, background: mySeat.activeHand === "main" ? "rgba(124,58,237,0.1)" : "rgba(0,0,0,0.25)", border: `1.5px solid ${mySeat.activeHand === "main" ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.05)"}`, opacity: mySeat.activeHand === "main" ? 1 : 0.55 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}><ValBadge value={handVal(mySeat.cards)} bust={handVal(mySeat.cards) > 21} /><span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1 }}>H1</span></div>
                    <div style={{ display: "flex", gap: 5 }}>{mySeat.cards.map((c, i) => <CardView key={`r${table?.roundId}-h1-${i}-${c.rank}${c.suit}`} card={c} />)}</div>
                  </div>
                  <div style={{ width: 1, height: 100, background: "rgba(255,255,255,0.07)", marginTop: 20, flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 14, background: mySeat.activeHand === "split" ? "rgba(124,58,237,0.1)" : "rgba(0,0,0,0.25)", border: `1.5px solid ${mySeat.activeHand === "split" ? "rgba(167,139,250,0.35)" : "rgba(255,255,255,0.05)"}`, opacity: mySeat.activeHand === "split" ? 1 : 0.55 }}>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}><ValBadge value={handVal(mySeat.splitCards!)} bust={handVal(mySeat.splitCards!) > 21} /><span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1 }}>H2</span></div>
                    <div style={{ display: "flex", gap: 5 }}>{mySeat.splitCards!.map((c, i) => <CardView key={`r${table?.roundId}-h2-${i}-${c.rank}${c.suit}`} card={c} />)}</div>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ValBadge value={handVal(mySeat.cards)} bust={handVal(mySeat.cards) > 21} />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600 }}>Bet: {fmtChips(mySeat.bet)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center" }}>
                    {mySeat.cards.map((c, i) => <CardView key={`r${table?.roundId}-p-${i}-${c.rank}${c.suit}`} card={c} />)}
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: "clamp(8px, 1.5vw, 16px)", flexWrap: "wrap", justifyContent: "center" }}>
                <ActionBtn label="Hit"    color="green"  onClick={() => handleAction("hit")}    disabled={actionLoading} />
                <ActionBtn label="Stand"  color="red"    onClick={() => handleAction("stand")}  disabled={actionLoading} />
                {canDouble   && <ActionBtn label="Double" color="blue"   onClick={() => handleAction("double")} disabled={actionLoading} />}
                {canSplitNow && <ActionBtn label="Split"  color="purple" onClick={() => handleAction("split")}  disabled={actionLoading} />}
              </div>
            </motion.div>
          )}

          {/* ── RESOLUTION ── */}
          {(phase === "RESOLUTION" || phase === "RESETTING") && mySeat && mySeat.cards.length > 0 && !myTurn && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              {mySeat.splitCards ? (
                <div style={{ display: "flex", gap: 20, justifyContent: "center", alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 2 }}>Hand 1</span>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center" }}>{mySeat.cards.map((c, i) => <CardView key={`r${table?.roundId}-res-h1-${i}-${c.rank}${c.suit}`} card={c} />)}</div>
                    {(() => { const rl = resultLabel(mySeat.result); return rl?.text ? (<motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }} style={{ fontSize: "clamp(14px, 2vw, 22px)", fontWeight: 900, color: rl.color, textTransform: "uppercase", letterSpacing: 2.5, textShadow: `0 0 16px ${rl.color}60` }}>{rl.text}{mySeat.payout > 0 && <span style={{ fontSize: "0.55em", color: "rgba(255,255,255,0.4)", marginLeft: 10, fontWeight: 600, letterSpacing: 0 }}>+{fmtChips(mySeat.payout)}</span>}</motion.div>) : null; })()}
                  </div>
                  <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.07)", flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 2 }}>Hand 2</span>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center" }}>{mySeat.splitCards.map((c, i) => <CardView key={`r${table?.roundId}-res-h2-${i}-${c.rank}${c.suit}`} card={c} />)}</div>
                    {(() => { const rl2 = resultLabel(mySeat.splitResult); return rl2?.text ? (<motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }} style={{ fontSize: "clamp(14px, 2vw, 22px)", fontWeight: 900, color: rl2.color, textTransform: "uppercase", letterSpacing: 2.5, textShadow: `0 0 16px ${rl2.color}60` }}>{rl2.text}{mySeat.splitPayout > 0 && <span style={{ fontSize: "0.55em", color: "rgba(255,255,255,0.4)", marginLeft: 10, fontWeight: 600, letterSpacing: 0 }}>+{fmtChips(mySeat.splitPayout)}</span>}</motion.div>) : null; })()}
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 7, justifyContent: "center", flexWrap: "wrap" }}>{mySeat.cards.map((c, i) => <CardView key={`r${table?.roundId}-res-${i}-${c.rank}${c.suit}`} card={c} />)}</div>
                  {myRl?.text && (
                    <motion.div initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 22 }}
                      style={{ fontSize: "clamp(22px, 3.5vw, 38px)", fontWeight: 900, color: myRl.color, textTransform: "uppercase", letterSpacing: 5, textShadow: `0 0 24px ${myRl.color}70, 0 0 48px ${myRl.color}30` }}>
                      {myRl.text}
                      {mySeat.payout > 0 && <span style={{ fontSize: "0.5em", color: "rgba(255,255,255,0.45)", marginLeft: 14, fontWeight: 700, letterSpacing: 0 }}>+{fmtChips(mySeat.payout)}</span>}
                    </motion.div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Waiting states */}
          {phase === "PLAYER_TURNS" && seated && !myTurn && (
            <motion.p key="wait-turn" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ fontSize: "clamp(12px, 1.3vw, 15px)", color: "rgba(255,255,255,0.3)", textAlign: "center", margin: 0 }}>
              {mySeat?.status === "busted" ? "Busted — waiting for results…" : mySeat?.status === "blackjack" ? "Blackjack! — waiting for results…" : mySeat?.status === "standing" ? "Standing — waiting for others…" : "Waiting for your turn…"}
            </motion.p>
          )}
          {phase === "PLAYER_TURNS" && !seated && (
            <motion.p key="spec" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ fontSize: "clamp(12px, 1.3vw, 15px)", color: "rgba(255,255,255,0.25)", textAlign: "center", margin: 0 }}>Players are taking their turns…</motion.p>
          )}
          {phase === "DEALER_TURN" && (
            <motion.div key="dt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {[0, 1, 2].map(i => (
                <motion.div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: "#fb923c" }}
                  animate={{ opacity: [0.2, 1, 0.2], scale: [0.7, 1.3, 0.7] }} transition={{ repeat: Infinity, duration: 0.85, delay: i * 0.27 }} />
              ))}
              <span style={{ fontSize: "clamp(12px, 1.3vw, 15px)", color: "rgba(251,146,60,0.75)", fontWeight: 600 }}>Dealer drawing…</span>
            </motion.div>
          )}
          {(phase === "WAITING" || phase === "RESETTING" || phase === "DEALING") && !myTurn && (
            <motion.p key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ fontSize: "clamp(12px, 1.3vw, 15px)", color: "rgba(255,255,255,0.25)", textAlign: "center", margin: 0 }}>
              {phase === "WAITING" ? (seated ? "Round starting soon…" : "Tap a seat to play") : phase === "DEALING" ? "Dealing cards…" : "Next round starting…"}
            </motion.p>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
