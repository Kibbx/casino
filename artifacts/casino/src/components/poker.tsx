import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, LogOut } from "lucide-react";
import { cn } from "../lib/utils";
import { AvatarImg } from "./AvatarUpload";
import { PlayingCardImg } from "./PlayingCardImg";

const IMGS = import.meta.env.BASE_URL;

// ─── Playing Card ─────────────────────────────────────────────────────────────

function parsePokerCard(card: string): { rank: string; suit: string } {
  const rawRank = card.length === 3 ? card.slice(0, 2) : card[0];
  const rank = rawRank === "T" ? "10" : rawRank;
  const suit = card[card.length - 1];
  return { rank, suit };
}

export function PlayingCard({
  card,
  hidden,
  small,
  tiny,
}: {
  card?: string;
  hidden?: boolean;
  small?: boolean;
  tiny?: boolean;
}) {
  const parsed = card && !hidden ? parsePokerCard(card) : null;
  if (tiny) {
    return <PlayingCardImg rank={parsed?.rank} suit={parsed?.suit} hidden={!parsed} width={28} height={40} animate={false} />;
  }
  if (small) {
    return <PlayingCardImg rank={parsed?.rank} suit={parsed?.suit} hidden={!parsed} width={40} height={56} animate={false} />;
  }
  return <PlayingCardImg rank={parsed?.rank} suit={parsed?.suit} hidden={!parsed} width={58} height={82} animate={false} />;
}

// ─── Chip PNG system — matches blackjack chip images ─────────────────────────

const CHIP_DENOMINATIONS = [
  { value: 1_000_000, color: "black" },
  { value: 100_000,   color: "purple" },
  { value:  25_000,   color: "orange" },
  { value:   5_000,   color: "red" },
  { value:   1_000,   color: "blue" },
  { value:     500,   color: "green" },
  { value:     100,   color: "white" },
];

function chipColorForAmount(amount: number): string {
  for (const { value, color } of CHIP_DENOMINATIONS) {
    if (amount >= value) return color;
  }
  return "white";
}

function fmtChips(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/**
 * Stacked chip PNG display — denomination-aware, renders real chip images.
 * count = how many chips to show in the stack (visual only)
 */
function PokerChipStack({
  amount,
  count = 4,
  size = 34,
}: {
  amount: number;
  count?: number;
  size?: number;
}) {
  const color = chipColorForAmount(amount);
  const stackH = size + (count - 1) * 9;
  return (
    <div style={{ position: "relative", width: size, height: stackH, flexShrink: 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        <img
          key={i}
          src={`${IMGS}chips/chip_${color}.png`}
          alt=""
          style={{
            position: "absolute",
            bottom: i * 9,
            left: 0,
            width: size,
            height: size,
            objectFit: "contain",
            filter: i === count - 1
              ? "drop-shadow(0 2px 4px rgba(0,0,0,0.8))"
              : "none",
          }}
        />
      ))}
    </div>
  );
}

// ─── Seat positioning ─────────────────────────────────────────────────────────

function getSeatStyle(index: number, total: number) {
  const angle = (index / total) * Math.PI * 2 + Math.PI / 2;
  const rx = 54;
  const ry = 48;
  const left = 50 + rx * Math.cos(angle);
  const top = 50 + ry * Math.sin(angle);
  return {
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, -50%)",
    position: "absolute" as const,
  };
}

function getBetStyle(index: number, total: number) {
  const angle = (index / total) * Math.PI * 2 + Math.PI / 2;
  const rx = 33;
  const ry = 33;
  const left = 50 + rx * Math.cos(angle);
  const top = 50 + ry * Math.sin(angle);
  return {
    left: `${left}%`,
    top: `${top}%`,
    transform: "translate(-50%, -50%)",
    position: "absolute" as const,
  };
}

// ─── Action Log ───────────────────────────────────────────────────────────────

export type LogEntry = {
  id: number;
  text: string;
  type: "info" | "action" | "phase" | "win" | "blind";
};

// ─── Seat action props (passed from table page → visual → player's seat) ──────

export interface SeatActionProps {
  isMyTurn: boolean;
  pot: number;
  callAmount: number;
  raiseAmount: string;
  setRaiseAmount: (v: string) => void;
  doAction: (action: string, amount?: number) => void;
  bigBlind: number;
  myChips: number;
  visibleChips: Array<{ value: number; label: string; bg: string; ring: string }>;
  raisePresets: Array<{ label: string; value: number }>;
  isActing: boolean;
  peeking: boolean;
  setPeeking: (v: boolean) => void;
  playSound: (key: string) => void;
  turnTimerSec: number | null;
  myCards: string[];
  TURN_LIMIT: number;
}

// ─── Shared table types ───────────────────────────────────────────────────────

export interface PokerSeat {
  seatIndex: number;
  playerId: number | null;
  playerName: string | null;
  playerAvatarUrl?: string | null;
  chips: number | null;
  currentBet: number;
  status: string;
  isDealer?: boolean;
  afkFolds?: number;
}

export interface PokerGameState {
  phase: string;
  pot: number;
  currentPlayerSeat: number | null;
  dealerSeat?: number | null;
  smallBlindSeat?: number | null;
  bigBlindSeat?: number | null;
  communityCards: string[];
  playerHands: Record<string | number, string[]>;
  winners?: Array<{ seatIndex: number; playerId: number; playerName?: string; amount: number; handDescription?: string; rakeCollected?: number }>;
  showdownHands?: Record<string | number, string>;
  playerContributions?: Record<string | number, number>;
  turnStartedAt?: number;
}

export interface PokerTable {
  id: number;
  name: string;
  status: string;
  seats: PokerSeat[];
  gameState: PokerGameState | null;
  tournamentId?: number | null;
  smallBlind: number;
  bigBlind: number;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PokerTableVisual({
  table,
  myPlayerId,
  onSeatClick,
  onStandUp,
  peeking,
  actionProps,
}: {
  table: PokerTable;
  myPlayerId: number | null;
  onSeatClick?: (seatIndex: number) => void;
  onStandUp?: () => void;
  peeking?: boolean;
  actionProps?: SeatActionProps;
}) {
  const [hoveredSeat, setHoveredSeat] = useState<number | null>(null);
  const [showWinnerOverlay, setShowWinnerOverlay] = useState(false);
  const [localPeeking, setLocalPeeking] = useState(false);
  // Reset peek when cards change (new hand dealt)
  const prevCardsKey = useRef<string>("");
  const curCardsKey = (actionProps?.myCards ?? []).join(",");
  if (curCardsKey !== prevCardsKey.current) {
    prevCardsKey.current = curCardsKey;
    if (localPeeking) setLocalPeeking(false);
  }
  const winnerDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { gameState, seats } = table;
  const isSeated = seats.some((s) => s.playerId === myPlayerId);
  const canJoin = !isSeated && !!onSeatClick;
  const mySeatStatus = seats.find((s) => s.playerId === myPlayerId)?.status;
  const canStandUp = (table.status !== "playing" || mySeatStatus === "sitting_out") && !!onStandUp;

  const hasActivePlayers = seats.some((s) => s.playerId !== null);

  useEffect(() => {
    const hasWinners = !!(gameState?.phase === "showdown" && gameState?.winners?.length);
    if (hasWinners) {
      setShowWinnerOverlay(true);
      if (winnerDismissTimer.current) clearTimeout(winnerDismissTimer.current);
      winnerDismissTimer.current = setTimeout(() => setShowWinnerOverlay(false), 4500);
    } else {
      setShowWinnerOverlay(false);
      if (winnerDismissTimer.current) {
        clearTimeout(winnerDismissTimer.current);
        winnerDismissTimer.current = null;
      }
    }
    return () => {
      if (winnerDismissTimer.current) clearTimeout(winnerDismissTimer.current);
    };
  }, [gameState?.phase, gameState?.winners]);

  return (
    <div className="relative w-full max-w-5xl mx-auto">

      {/* ── Winner banner ── */}
      <AnimatePresence>
        {showWinnerOverlay && gameState && gameState.winners && gameState.winners.length > 0 && (() => {
          const winnerSeatIndexes = new Set(gameState.winners!.map((w) => w.seatIndex));
          const losers = seats.filter(
            (s) => s.playerId && gameState.showdownHands?.[s.seatIndex] && !winnerSeatIndexes.has(s.seatIndex)
          );
          const rake = gameState.winners[0]?.rakeCollected ?? 0;
          const isSplit = gameState.winners.length > 1;
          return (
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 28 }}
              className="absolute top-[11%] left-1/2 -translate-x-1/2 z-50 pointer-events-none select-none"
              style={{ minWidth: 260, maxWidth: "min(480px, 88%)" }}
            >
              <div className="absolute inset-0 rounded-2xl bg-amber-950 blur-xl" />
              <div className="relative rounded-2xl border border-amber-700 bg-black/88 shadow-[0_0_32px_rgba(0,0,0,0.8)] overflow-hidden">
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
                <div className="px-5 py-3.5 flex flex-col items-center gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">🏆</span>
                    <h2 className="text-base font-display font-bold tracking-wide text-amber-300 uppercase">
                      {isSplit ? "Split Pot!" : "Winner!"}
                    </h2>
                  </div>
                  <div className="flex flex-col items-center gap-0.5 w-full">
                    {gameState.winners.map((w, i) => (
                      <div key={i} className="flex flex-col items-center">
                        <p className="text-white font-bold text-sm leading-tight">
                          <span className="text-amber-200">{w.playerName}</span>
                          <span className="text-white/60 font-normal mx-1">{isSplit ? "splits" : "wins"}</span>
                          <span className="text-green-300">{fmtChips(w.amount)}</span>
                        </p>
                        <p className="text-amber-400 text-xs font-medium">{w.handDescription}</p>
                      </div>
                    ))}
                  </div>
                  {losers.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 border-t border-white/8 pt-1.5 mt-0.5 w-full">
                      {losers.map((s) => (
                        <span key={s.seatIndex} className="text-white/35 text-[11px] whitespace-nowrap">
                          {s.playerName}
                          <span className="text-white/50 ml-1">{gameState.showdownHands![s.seatIndex]}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {rake > 0 && (
                    <p className="text-white/25 text-[10px] mt-0.5">Rake {fmtChips(rake)}</p>
                  )}
                </div>
                <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ── Poker oval table — crimson felt, amber-gold rail ── */}
      <div
        className="relative w-full aspect-[1.9/1] rounded-[50%] flex items-center justify-center overflow-visible"
        style={{
          background: "radial-gradient(ellipse 80% 75% at 50% 25%, #4a0f18 0%, #2d0810 40%, #180408 75%, #0e0305 100%)",
          border: "18px solid #1a0a04",
          boxShadow: [
            "0 0 0 2px rgba(245,158,11,0.55)",   /* amber-gold inlay */
            "0 0 0 5px #0f0604",                  /* dark wood outer */
            "0 0 0 7px rgba(245,158,11,0.18)",    /* second amber ring */
            "inset 0 0 60px rgba(0,0,0,0.75)",   /* depth */
            "0 16px 48px rgba(0,0,0,0.85)",       /* drop shadow */
            "0 0 80px rgba(160,30,50,0.12)",      /* ambient crimson glow */
          ].join(","),
        }}
      >
        {/* SVG decorative details on the felt */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", borderRadius: "50%" }}>
          <defs>
            {/* Crimson overhead lamp glow */}
            <radialGradient id="pk_lamp" cx="50%" cy="20%" r="55%" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgba(200,50,70,0.2)" />
              <stop offset="50%"  stopColor="rgba(140,20,40,0.07)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            {/* Ambient gold rim light at top */}
            <radialGradient id="pk_rimGold" cx="50%" cy="0%" r="45%" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stopColor="rgba(245,158,11,0.1)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            {/* Inner arc crimson accent */}
            <linearGradient id="pk_arcCrimson" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(192,40,64,0)" />
              <stop offset="30%"  stopColor="rgba(192,40,64,0.45)" />
              <stop offset="50%"  stopColor="rgba(192,40,64,0.8)" />
              <stop offset="70%"  stopColor="rgba(192,40,64,0.45)" />
              <stop offset="100%" stopColor="rgba(192,40,64,0)" />
            </linearGradient>
            <linearGradient id="pk_arcAmber" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(245,158,11,0)" />
              <stop offset="30%"  stopColor="rgba(245,158,11,0.25)" />
              <stop offset="50%"  stopColor="rgba(245,158,11,0.55)" />
              <stop offset="70%"  stopColor="rgba(245,158,11,0.25)" />
              <stop offset="100%" stopColor="rgba(245,158,11,0)" />
            </linearGradient>
            {/* Grain noise */}
            <filter id="pk_grain">
              <feTurbulence type="fractalNoise" baseFrequency="0.78 0.72" numOctaves="3" seed="5" stitchTiles="stitch" result="noise" />
              <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.055 0" in="noise" />
            </filter>
          </defs>

          {/* Crimson lamp glow — fills the felt */}
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="url(#pk_lamp)" />

          {/* Amber rim catch at top */}
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="url(#pk_rimGold)" />

          {/* Fabric grain — subtle velvet texture */}
          <ellipse cx="50%" cy="50%" rx="50%" ry="50%" fill="#5a1020" filter="url(#pk_grain)" opacity="0.07" />

          {/* Inner oval detail lines */}
          <ellipse cx="50%" cy="50%" rx="44%" ry="42%"
            fill="none" stroke="url(#pk_arcCrimson)" strokeWidth="1.2" />
          <ellipse cx="50%" cy="50%" rx="42%" ry="40%"
            fill="none" stroke="rgba(192,40,64,0.15)" strokeWidth="0.7" />
          <ellipse cx="50%" cy="50%" rx="46%" ry="44%"
            fill="none" stroke="url(#pk_arcAmber)" strokeWidth="0.8"
            strokeDasharray="10 16" />

          {/* Watermark */}
          <text x="50%" y="78%" textAnchor="middle"
            fill="rgba(192,40,64,0.08)" fontSize="clamp(8px, 1.8vw, 20px)"
            fontFamily="'Oswald', sans-serif" fontWeight="700" letterSpacing="14">
            BACK ALLEY BETS
          </text>
        </svg>

        {/* Center: Pot + community cards — only when a hand is active */}
        <div className="flex flex-col items-center gap-3 z-10">
          {hasActivePlayers && gameState && gameState.pot > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(0,0,0,0.72)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 10, padding: "5px 12px",
              boxShadow: "0 0 12px rgba(0,0,0,0.6)",
            }}>
              <img src={`${IMGS}chips/chip_${chipColorForAmount(gameState.pot)}.png`} alt="" style={{ width: 22, height: 22, objectFit: "contain", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
                <span style={{ color: "rgba(245,158,11,0.7)", fontSize: 9, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>
                  POT
                </span>
                <span style={{ color: "#f59e0b", fontWeight: 900, fontSize: 15, fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>
                  {fmtChips(gameState.pot)}
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-2 items-center min-h-16">
            {hasActivePlayers && gameState?.communityCards.map((c: string, i: number) => (
              <motion.div
                key={i}
                initial={{ scale: 0, opacity: 0, y: -10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <PlayingCard card={c} />
              </motion.div>
            ))}
          </div>
        </div>

        {/* ── Bet labels on felt — minimal chip icon + amount, no stacked visuals ── */}
        {hasActivePlayers && gameState &&
          seats.map((seat, i) => {
            if (!seat.playerId || seat.currentBet <= 0) return null;
            return (
              <div
                key={`bet-${seat.seatIndex}`}
                style={{ ...getBetStyle(i, seats.length), zIndex: 30 }}
                className="flex items-center gap-1 pointer-events-none"
              >
                <img src={`${IMGS}chips/chip_${chipColorForAmount(seat.currentBet)}.png`} alt="" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />
                <div style={{
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: 5,
                  padding: "2px 7px",
                  color: "#f59e0b",
                  fontSize: 10,
                  fontWeight: 900,
                  fontFamily: "'Oswald', sans-serif",
                  letterSpacing: 1,
                  whiteSpace: "nowrap",
                }}>
                  {fmtChips(seat.currentBet)}
                </div>
              </div>
            );
          })}

        {/* ── Seats ── */}
        {seats.map((seat, i) => {
          const isCurrent = gameState?.currentPlayerSeat === seat.seatIndex;
          const isDealer = gameState?.dealerSeat === seat.seatIndex;
          const isSB = gameState?.smallBlindSeat === seat.seatIndex;
          const isBB = gameState?.bigBlindSeat === seat.seatIndex;
          const isMe = myPlayerId === seat.playerId;
          const isEmpty = seat.status === "empty";
          const isFolded = seat.status === "folded";
          const isSittingOut = seat.status === "sitting_out";
          const roleLabel = isDealer ? "Dealer" : isSB ? "Small Blind" : isBB ? "Big Blind" : null;

          return (
            <div key={seat.seatIndex} style={getSeatStyle(i, seats.length)} className="z-20">
              {isEmpty ? (
                canJoin ? (
                  <motion.button
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => onSeatClick!(seat.seatIndex)}
                    style={{
                      width: 80, height: 80, borderRadius: 12,
                      border: "2px dashed rgba(192,40,64,0.3)",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.3)",
                      color: "rgba(192,40,64,0.55)",
                      cursor: "pointer",
                      backdropFilter: "blur(4px)",
                    }}
                    title={`Take Seat ${seat.seatIndex + 1}`}
                  >
                    <Plus style={{ width: 16, height: 16 }} />
                    <span style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginTop: 2 }}>Sit In</span>
                  </motion.button>
                ) : (
                  <div style={{
                    width: 80, height: 80, borderRadius: 12,
                    border: "1px dashed rgba(255,255,255,0.08)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.15)",
                    color: "rgba(255,255,255,0.12)",
                    backdropFilter: "blur(4px)",
                  }}>
                    <span style={{ fontSize: 8 }}>Seat</span>
                    <span style={{ fontWeight: 700 }}>{seat.seatIndex + 1}</span>
                  </div>
                )
              ) : (
                <div
                  className="relative"
                  onMouseEnter={() => isMe && setHoveredSeat(seat.seatIndex)}
                  onMouseLeave={() => setHoveredSeat(null)}
                >
                  {/* Stand Up button */}
                  <AnimatePresence>
                    {isMe && canStandUp && hoveredSeat === seat.seatIndex && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8, y: 4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        onClick={onStandUp}
                        className="absolute -top-7 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-red-700 hover:bg-red-600 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-lg border border-red-500 whitespace-nowrap cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        Stand Up
                      </motion.button>
                    )}
                  </AnimatePresence>

                  {/* Dealer button */}
                  {isDealer && (
                    <div style={{
                      position: "absolute", top: -8, right: -8, zIndex: 30,
                      width: 22, height: 22, borderRadius: "50%",
                      background: "#f59e0b", color: "#000",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 900,
                      boxShadow: "0 0 8px rgba(245,158,11,0.6), 0 2px 4px rgba(0,0,0,0.8)",
                      border: "1px solid rgba(255,220,100,0.8)",
                    }}>
                      D
                    </div>
                  )}

                  {/* Player card */}
                  <motion.div
                    animate={isCurrent ? {
                      boxShadow: [
                        "0 0 0 2px rgba(192,40,64,0.9)",
                        "0 0 14px 5px rgba(192,40,64,0.4)",
                        "0 0 0 2px rgba(192,40,64,0.9)",
                      ]
                    } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                    style={{
                      width: 192, position: "relative",
                      borderRadius: 10, overflow: "hidden",
                      boxShadow: isCurrent
                        ? "0 0 0 2px rgba(192,40,64,0.9), 0 0 14px 5px rgba(192,40,64,0.35)"
                        : isMe
                        ? "0 0 0 1px rgba(192,40,64,0.4)"
                        : "0 0 0 1px rgba(255,255,255,0.08)",
                      opacity: isFolded ? 0.45 : isSittingOut ? 0.6 : 1,
                      filter: isFolded ? "grayscale(1)" : "none",
                      background: isMe ? "rgba(20,10,8,0.96)" : "rgba(10,6,8,0.93)",
                    }}
                  >
                    {/* Turn timer — top-right corner, only when it's my turn */}
                    {isMe && actionProps?.isMyTurn && (
                      <div style={{ position: "absolute", top: 6, right: 6, zIndex: 10, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg style={{ position: "absolute", inset: 0, width: 26, height: 26, transform: "rotate(-90deg)" }} viewBox="0 0 32 32">
                          <circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
                          <circle cx="16" cy="16" r="13" fill="none"
                            stroke={actionProps.turnTimerSec !== null && actionProps.turnTimerSec <= 10 ? "#ef4444" : "#eab308"}
                            strokeWidth="3"
                            strokeDasharray={`${2 * Math.PI * 13}`}
                            strokeDashoffset={`${2 * Math.PI * 13 * (1 - (actionProps.turnTimerSec ?? 0) / actionProps.TURN_LIMIT)}`}
                            strokeLinecap="round"
                            style={{ transition: "stroke-dashoffset 0.1s linear, stroke 0.3s" }}
                          />
                        </svg>
                        <span style={{ position: "relative", zIndex: 1, fontSize: 9, fontWeight: 900, fontVariantNumeric: "tabular-nums",
                          color: actionProps.turnTimerSec !== null && actionProps.turnTimerSec <= 10 ? "#f87171" : "#fde047" }}>
                          {actionProps.turnTimerSec ?? "—"}
                        </span>
                      </div>
                    )}

                    {/* Chip stack + amount row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px 5px" }}>
                      <img
                        src={`${IMGS}chips/chip_${chipColorForAmount(seat.chips ?? 0)}.png`}
                        alt=""
                        style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }}
                      />
                      <span style={{
                        color: isMe ? "#f59e0b" : "rgba(245,158,11,0.75)",
                        fontWeight: 900, fontSize: 14,
                        fontFamily: "'Oswald', sans-serif", letterSpacing: 0.5,
                      }}>
                        {fmtChips(seat.chips ?? 0)}
                      </span>
                    </div>

                    {/* Avatar + cards row */}
                    <div className="flex items-center gap-1.5 px-2.5 pb-1.5">
                      <div className="relative flex-shrink-0">
                        <AvatarImg src={seat.playerAvatarUrl} username={seat.playerName ?? "?"} size="lg" />
                        {isFolded && (
                          <div className="absolute inset-0 rounded-full bg-black/70 flex items-center justify-center">
                            <span style={{ color: "#f87171", fontSize: 8, fontWeight: 900, transform: "rotate(-15deg)", display: "block" }}>FOLD</span>
                          </div>
                        )}
                        {isSittingOut && (
                          <div className="absolute inset-0 rounded-full bg-black/70 flex items-center justify-center">
                            <span style={{ color: "#fbbf24", fontSize: 7, fontWeight: 900, textAlign: "center", lineHeight: 1.2 }}>SIT OUT</span>
                          </div>
                        )}
                      </div>
                      {/* Face-down card backs on every seat */}
                      {isSittingOut ? (
                        <div className="flex gap-1 opacity-25">
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                        </div>
                      ) : isFolded ? (
                        <div className="flex gap-1 opacity-25">
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                          <PlayingCardImg hidden={true} width={38} height={54} animate={false} />
                        </div>
                      )}
                    </div>

                    {/* Name + role */}
                    <div style={{ padding: "0 10px 6px" }}>
                      <div style={{
                        color: isMe ? "#c0253c" : "rgba(255,255,255,0.82)",
                        fontWeight: 700, fontSize: 13,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {seat.playerName}
                      </div>
                    </div>

                  </motion.div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    {/* ── Fixed action HUD — bottom-right corner, only when seated ── */}
    {actionProps && (
      <div style={{
        position: "fixed", bottom: 18, right: 18,
        zIndex: 200, display: "flex", flexDirection: "column", alignItems: "stretch",
        gap: 6, width: 300,
      }}>
        {/* Cards + peek — always visible while seated */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {actionProps.myCards.length > 0 ? (
            <>
              {actionProps.myCards.map((card: string, ci: number) => {
                const { rank, suit } = parsePokerCard(card);
                return localPeeking
                  ? <PlayingCardImg key={ci} rank={rank} suit={suit} hidden={false} width={56} height={78} animate={false} />
                  : <PlayingCardImg key={ci} hidden={true} width={56} height={78} animate={false} />;
              })}
            </>
          ) : (
            <>
              <div style={{ width: 56, height: 78, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} />
              <div style={{ width: 56, height: 78, borderRadius: 6, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }} />
            </>
          )}
          <button
            onClick={() => setLocalPeeking(p => !p)}
            disabled={actionProps.myCards.length === 0}
            style={{
              width: 36, height: 78, borderRadius: 6, cursor: actionProps.myCards.length > 0 ? "pointer" : "default",
              background: localPeeking ? "rgba(192,40,64,0.3)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${localPeeking ? "rgba(192,40,64,0.7)" : "rgba(255,255,255,0.1)"}`,
              color: localPeeking ? "#e04060" : "rgba(255,255,255,0.35)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
              opacity: actionProps.myCards.length === 0 ? 0.3 : 1,
              transition: "background 0.15s, border 0.15s",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {localPeeking
                ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
              }
            </svg>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase" }}>
              {localPeeking ? "hide" : "peek"}
            </span>
          </button>
        </div>

        {/* Action controls — visible only on my turn */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 6,
          opacity: actionProps.isMyTurn ? 1 : 0,
          pointerEvents: actionProps.isMyTurn ? "auto" : "none",
          transition: "opacity 0.2s",
        }}>
        {/* Call amount label */}
        {actionProps.callAmount > 0 && (
          <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700,
            color: "rgba(255,255,255,0.5)", fontFamily: "'Oswald', sans-serif", letterSpacing: 1 }}>
            TO CALL&nbsp;<strong style={{ color: "#ef4444" }}>{actionProps.callAmount.toLocaleString()}</strong>
          </div>
        )}

        {/* Raise stepper */}
        <div style={{
          display: "flex", alignItems: "center", height: 36,
          background: "rgba(0,0,0,0.75)", borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(6px)",
        }}>
          <button onClick={() => actionProps.setRaiseAmount(String(Math.max(actionProps.bigBlind, (parseInt(actionProps.raiseAmount) || 0) - actionProps.bigBlind)))}
            style={{ padding: "0 14px", color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>−</button>
          <span style={{
            flex: 1, textAlign: "center", fontSize: 15, fontWeight: 900,
            color: parseInt(actionProps.raiseAmount) > 0 ? "#f59e0b" : "rgba(255,255,255,0.2)",
            fontFamily: "'Oswald', sans-serif",
          }}>
            {parseInt(actionProps.raiseAmount) > 0 ? parseInt(actionProps.raiseAmount).toLocaleString() : "BET AMT"}
          </span>
          <button onClick={() => actionProps.setRaiseAmount(String(Math.min((parseInt(actionProps.raiseAmount) || 0) + actionProps.bigBlind, actionProps.myChips)))}
            style={{ padding: "0 14px", color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>+</button>
          {parseInt(actionProps.raiseAmount) > 0 && (
            <button onClick={() => actionProps.setRaiseAmount("0")}
              style={{ padding: "0 8px", color: "rgba(255,80,80,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, borderLeft: "1px solid rgba(255,255,255,0.08)" }}>✕</button>
          )}
        </div>

        {/* Fold / Check-Call / Bet-Raise */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => actionProps.doAction("fold")} disabled={actionProps.isActing}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 7,
              fontSize: 15, fontWeight: 900, textTransform: "uppercase" as const,
              color: "#fca5a5", background: "rgba(127,29,29,0.9)", border: "1px solid rgba(185,28,28,0.6)",
              fontFamily: "'Oswald', sans-serif", cursor: "pointer",
            }}>Fold</button>
          <button onClick={() => actionProps.doAction(actionProps.callAmount === 0 ? "check" : "call")} disabled={actionProps.isActing}
            style={{
              flex: 1.5, padding: "11px 0", borderRadius: 7,
              fontSize: 15, fontWeight: 900, textTransform: "uppercase" as const,
              color: "#93c5fd", background: "rgba(30,58,95,0.95)", border: "1px solid rgba(59,130,246,0.5)",
              fontFamily: "'Oswald', sans-serif", cursor: "pointer",
            }}>
            {actionProps.callAmount === 0 ? "Check" : "Call"}
          </button>
          <button
            onClick={() => { const amt = parseInt(actionProps.raiseAmount) || 0; if (amt > 0) { actionProps.doAction("raise", amt); actionProps.setRaiseAmount("0"); } }}
            disabled={actionProps.isActing || !(parseInt(actionProps.raiseAmount) > 0)}
            style={{
              flex: 1.5, padding: "11px 0", borderRadius: 7,
              fontSize: 15, fontWeight: 900, textTransform: "uppercase" as const,
              color: parseInt(actionProps.raiseAmount) > 0 ? "#000" : "rgba(245,158,11,0.3)",
              background: parseInt(actionProps.raiseAmount) > 0 ? "linear-gradient(135deg,#d97706,#92400e)" : "rgba(120,90,20,0.15)",
              border: "1px solid rgba(217,119,6,0.6)",
              fontFamily: "'Oswald', sans-serif", cursor: "pointer", transition: "background 0.15s",
            }}>
            {actionProps.callAmount > 0 ? "Raise" : "Bet"}
          </button>
        </div>
        </div>
      </div>
    )}
    </div>
  );
}
