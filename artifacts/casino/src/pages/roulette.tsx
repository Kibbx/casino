import { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { PromoZone } from "../components/PromoRegion";
import { useGetPlayer, useGetRouletteStatus } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, Trash2, Users, Clock } from "lucide-react";
import { playSound } from "../lib/sounds";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";

// ── Constants ──────────────────────────────────────────────────────────────────

const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const BLACK = new Set([2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35]);

const EURO_WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const AMER_WHEEL = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,-1,27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2];

const BET_PAYOUTS: Record<string, number> = {
  straight: 35, split: 17, street: 11, corner: 8, sixline: 5,
  dozen: 2, column: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
};

const CHIPS = [10, 50, 100, 500, 1000, 5000];
const CHIP_COLORS: Record<number, string> = {
  10: "#3B82F6", 50: "#8B5CF6", 100: "#EC4899",
  500: "#EF4444", 1000: "#F59E0B", 5000: "#10B981",
};

const ROULETTE_CHIP_DEFS = [
  { value: 10,    file: "chip_white.png",  label: "10",   glow: "rgba(200,220,255,0.65)" },
  { value: 50,    file: "chip_green.png",  label: "50",   glow: "rgba(34,197,94,0.65)"  },
  { value: 100,   file: "chip_blue.png",   label: "100",  glow: "rgba(59,130,246,0.65)"  },
  { value: 500,   file: "chip_red.png",    label: "500",  glow: "rgba(239,68,68,0.65)"   },
  { value: 1000,  file: "chip_orange.png", label: "1K",   glow: "rgba(251,146,60,0.65)"  },
  { value: 5000,  file: "chip_purple.png", label: "5K",   glow: "rgba(192,132,252,0.65)" },
];

function numColor(n: number): "red" | "black" | "green" {
  if (n === 0 || n === -1) return "green";
  if (RED.has(n)) return "red";
  return "black";
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Phase = "WAITING" | "BETTING_OPEN" | "BETTING_CLOSED" | "SPINNING" | "RESULT" | "RESETTING";

interface ServerBet {
  type: string;
  numbers: number[];
  amount: number;
}

interface BetResult extends ServerBet {
  won: boolean;
  payout: number;
}

interface PayoutResult {
  bets: BetResult[];
  totalBet: number;
  totalPayout: number;
  netResult: number;
  playerChips: number;
}

interface BetMarkerEntry {
  username: string;
  avatarUrl: string | null;
  amount: number;
}

// ── Player color system — consistent ring color per username ───────────────────

const PLAYER_RING_COLORS = [
  "#7C3AED", // violet
  "#DC2626", // red
  "#059669", // emerald
  "#D97706", // amber
  "#0891B2", // cyan
  "#DB2777", // pink
  "#65A30D", // lime
  "#EA580C", // orange
];

function playerRingColor(username: string): string {
  const idx = username.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % PLAYER_RING_COLORS.length;
  return PLAYER_RING_COLORS[idx];
}

// ── Avatar config (easy to tweak) ─────────────────────────────────────────────

const AVATAR_CFG = {
  size: 28,         // base avatar diameter in px (outside cells)
  maxVisible: 3,    // max avatars shown before +N
  overlap: 9,       // px overlap between adjacent avatars
  showAmount: true, // show total chip amount label
} as const;

// ── Single avatar dot ──────────────────────────────────────────────────────────

function AvatarDot({ username, avatarUrl, isSelf, size = 20, isWinner = false }: {
  username: string;
  avatarUrl: string | null;
  isSelf: boolean;
  size?: number;
  isWinner?: boolean;
}) {
  const initials = username.slice(0, 2).toUpperCase();
  const ringColor = playerRingColor(username);
  const borderW = isSelf ? 2.5 : 2;

  return (
    <div
      title={username}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        overflow: "hidden",
        background: "#18181b",
        border: `${borderW}px solid ${ringColor}`,
        boxShadow: isWinner
          ? `0 0 8px ${ringColor}, 0 0 2px rgba(0,0,0,0.9)`
          : `0 0 ${isSelf ? 5 : 3}px ${ringColor}60, 0 1px 4px rgba(0,0,0,0.7)`,
        animation: isWinner ? "pulse 1.5s ease-in-out infinite" : undefined,
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={username}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: ringColor + "25",
          fontSize: Math.floor(size * 0.38),
          fontWeight: 800,
          color: ringColor,
          userSelect: "none",
        }}>
          {initials}
        </div>
      )}
    </div>
  );
}

// ── Avatar cluster with tooltip ────────────────────────────────────────────────

function AvatarCluster({ markers, myUsername, totalAmount, isWinner = false, sizeOverride }: {
  markers: BetMarkerEntry[];
  myUsername: string;
  totalAmount: number;
  isWinner?: boolean;
  sizeOverride?: number;
}) {
  if (markers.length === 0) return null;

  const size = sizeOverride ?? AVATAR_CFG.size;
  const { maxVisible, overlap, showAmount } = AVATAR_CFG;
  const visible = markers.slice(0, maxVisible);
  const overflow = markers.length - maxVisible;

  const fmtAmount = (n: number) =>
    n >= 10000 ? `${(n / 1000).toFixed(0)}k`
    : n >= 1000 ? `${(n / 1000).toFixed(1)}k`
    : String(n);

  const clusterWidth = visible.length * size - (visible.length - 1) * overlap + (overflow > 0 ? size - overlap : 0);

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 450, damping: 28 }}
      className="group relative inline-flex flex-col items-center"
      style={{ gap: 2 }}
    >
      {/* Avatar row */}
      <div className="relative flex items-center" style={{ width: clusterWidth, height: size }}>
        {visible.map((m, i) => (
          <div
            key={m.username}
            style={{
              position: "absolute",
              left: i * (size - overlap),
              zIndex: visible.length - i,
            }}
          >
            <AvatarDot
              username={m.username}
              avatarUrl={m.avatarUrl}
              isSelf={m.username === myUsername}
              size={size}
              isWinner={isWinner}
            />
          </div>
        ))}
        {overflow > 0 && (
          <div
            style={{
              position: "absolute",
              left: visible.length * (size - overlap),
              width: size, height: size,
              borderRadius: "50%",
              background: "#27272a",
              border: "2px solid #52525b",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: Math.floor(size * 0.32),
              fontWeight: 800,
              color: "#a1a1aa",
              zIndex: 0,
            }}
          >
            +{overflow}
          </div>
        )}
      </div>

      {/* Total chip amount micro-label */}
      {showAmount && totalAmount > 0 && (
        <span style={{
          fontSize: 9,
          fontWeight: 700,
          color: isWinner ? "#FCD34D" : "#D4D4D8",
          lineHeight: 1,
          background: "rgba(0,0,0,0.7)",
          borderRadius: 3,
          padding: "1px 3px",
          whiteSpace: "nowrap",
          letterSpacing: "0.02em",
          pointerEvents: "none",
        }}>
          {fmtAmount(totalAmount)}
        </span>
      )}

      {/* Hover tooltip */}
      <div
        className="absolute z-[300] hidden group-hover:flex flex-col pointer-events-none"
        style={{
          bottom: "calc(100% + 8px)",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(9,9,11,0.97)",
          border: "1px solid #3f3f46",
          borderRadius: 10,
          padding: "8px 10px",
          minWidth: 150,
          boxShadow: "0 8px 32px rgba(0,0,0,0.7)",
          gap: 6,
        }}
      >
        <p style={{ fontSize: 9, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, borderBottom: "1px solid #27272a", paddingBottom: 4 }}>
          Bets on this spot
        </p>
        {markers.map(m => (
          <div key={m.username} style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <AvatarDot username={m.username} avatarUrl={m.avatarUrl} isSelf={m.username === myUsername} size={18} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: m.username === myUsername ? "#FCD34D" : "#e4e4e7", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                {m.username}{m.username === myUsername ? " (you)" : ""}
              </p>
              {m.amount != null && (
                <p style={{ fontSize: 10, color: "#71717a", lineHeight: 1.2 }}>{m.amount.toLocaleString()} chips</p>
              )}
            </div>
          </div>
        ))}
        <div style={{ borderTop: "1px solid #27272a", paddingTop: 5, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#52525b" }}>Total</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#FBBF24" }}>{totalAmount.toLocaleString()}</span>
        </div>
        {/* Arrow */}
        <div style={{
          position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
          borderWidth: 5, borderStyle: "solid",
          borderColor: "#3f3f46 transparent transparent transparent",
        }} />
      </div>
    </motion.div>
  );
}

// ── Roulette Wheel SVG ─────────────────────────────────────────────────────────

const CX = 150, CY = 150, OUTER_R = 138, INNER_R = 76, TEXT_R = 107, HUB_R = 30;

function computeWedgePath(outerR: number, innerR: number, halfAngleDeg: number): string {
  const r = halfAngleDeg * Math.PI / 180;
  const ox1 = CX - outerR * Math.sin(r), oy1 = CY - outerR * Math.cos(r);
  const ox2 = CX + outerR * Math.sin(r), oy2 = CY - outerR * Math.cos(r);
  const ix1 = CX - innerR * Math.sin(r), iy1 = CY - innerR * Math.cos(r);
  const ix2 = CX + innerR * Math.sin(r), iy2 = CY - innerR * Math.cos(r);
  const large = halfAngleDeg * 2 > 180 ? 1 : 0;
  return `M ${ix1} ${iy1} L ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${large} 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1} Z`;
}

const BALL_TRACK_R = 143; // Ball orbits just inside the outer gold ring

function RouletteWheel({ wheelOrder, rotation, spinning, ballRotation, ballDuration, ballEasing }: {
  wheelOrder: number[]; rotation: number; spinning: boolean;
  ballRotation: number; ballDuration: number; ballEasing: string;
}) {
  const total = wheelOrder.length;
  const halfAngle = 180 / total;
  const wedgePath = computeWedgePath(OUTER_R, INNER_R, halfAngle);
  const anglePerSlot = 360 / total;

  return (
    <div className="relative select-none">
      <svg viewBox="0 0 300 300" className="w-full max-w-[360px] mx-auto drop-shadow-2xl">
        {/* Fixed outer bowl / track */}
        <circle cx={CX} cy={CY} r={OUTER_R + 5} fill="#1a0a00" stroke="#8B0000" strokeWidth="7" />
        <circle cx={CX} cy={CY} r={OUTER_R + 11} fill="none" stroke="#FFD700" strokeWidth="1.2" opacity="0.5" />
        {/* Subtle ball groove */}
        <circle cx={CX} cy={CY} r={BALL_TRACK_R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />

        {/* Rotating wheel (rotor) — clockwise */}
        <g
          style={{
            transform: `rotate(${rotation}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transition: "none", // driven by requestAnimationFrame physics loop
          }}
        >
          {wheelOrder.map((num, i) => {
            const rot = i * anglePerSlot;
            const color = numColor(num);
            const fill = color === "red" ? "#B91C1C" : color === "green" ? "#15803D" : "#111";
            const label = num === -1 ? "00" : String(num);
            return (
              <g key={i} transform={`rotate(${rot}, ${CX}, ${CY})`}>
                <path d={wedgePath} fill={fill} stroke="#222" strokeWidth="0.7" />
                <text x={CX} y={CY - TEXT_R} textAnchor="middle" dominantBaseline="middle"
                  fill="white" fontSize={num === 0 || num === -1 ? "14" : "11"}
                  fontWeight="bold" fontFamily="sans-serif">{label}</text>
              </g>
            );
          })}
          {/* Diamond / fret separators on rotor edge */}
          {Array.from({ length: total }).map((_, i) => {
            const a = (i * 360 / total) * Math.PI / 180;
            const r = OUTER_R - 2;
            return <circle key={i} cx={CX + r * Math.sin(a)} cy={CY - r * Math.cos(a)} r="2" fill="#FFD700" opacity="0.55" />;
          })}
          <circle cx={CX} cy={CY} r={INNER_R - 1} fill="#0d0d0d" stroke="#2a2a2a" strokeWidth="1" />
          <circle cx={CX} cy={CY} r={INNER_R - 8} fill="none" stroke="#8B0000" strokeWidth="3" />
          <circle cx={CX} cy={CY} r={INNER_R - 15} fill="none" stroke="#FFD700" strokeWidth="1" opacity="0.45" />
        </g>

        {/* Hub (fixed, on top) */}
        <circle cx={CX} cy={CY} r={HUB_R} fill="#111" stroke="#FFD700" strokeWidth="1.5" />
        <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle" fill="#FFD700" fontSize="10" fontWeight="bold" fontFamily="sans-serif">BACK ALLEY</text>

        {/* Ball — counter-clockwise, on outer track */}
        <g
          style={{
            transform: `rotate(${ballRotation}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transition: spinning ? `transform ${ballDuration}ms ${ballEasing}` : "none",
          }}
        >
          {/* Ball shadow */}
          <circle cx={CX} cy={CY - BALL_TRACK_R + 1.5} r="5.5" fill="rgba(0,0,0,0.5)" />
          {/* Ball */}
          <circle cx={CX} cy={CY - BALL_TRACK_R} r="5" fill="#f0ede0" stroke="#ccc" strokeWidth="0.8" />
          {/* Ball shine */}
          <circle cx={CX - 1.5} cy={CY - BALL_TRACK_R - 1.5} r="1.8" fill="white" opacity="0.7" />
        </g>
      </svg>
    </div>
  );
}

// ── Betting Table ──────────────────────────────────────────────────────────────

// Accurate casino layout: top row = outside bets, middle = 0/00|grid|2:1, bottom = dozens
// Numbers arranged as 12 columns × 3 rows matching real casino felt
const GRID_ROWS = [
  [3,  6,  9,  12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2,  5,  8,  11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1,  4,  7,  10, 13, 16, 19, 22, 25, 28, 31, 34],
];

function BettingTable({
  myBets, tableBets, betMarkers, myUsername, chipAmount, onBet, winningNumber, showResult, wheelType, disabled,
}: {
  myBets: ServerBet[];
  tableBets: Record<string, number>;
  betMarkers: Record<string, BetMarkerEntry[]>;
  myUsername: string;
  chipAmount: number;
  onBet: (bet: Omit<ServerBet, "id">) => void;
  winningNumber: number | null;
  showResult: boolean;
  wheelType?: string;
  disabled: boolean;
}) {
  function myBetTotal(type: string, numbers: number[]) {
    const key = betKeyFor(type, numbers);
    return myBets.filter(b => betKeyFor(b.type, b.numbers) === key).reduce((s, b) => s + b.amount, 0);
  }
  function tableTotal(type: string, numbers: number[]) {
    return tableBets[betKeyFor(type, numbers)] ?? 0;
  }
  function markersFor(type: string, numbers: number[]): BetMarkerEntry[] {
    if (!betMarkers) return [];
    return betMarkers[betKeyFor(type, numbers)] ?? [];
  }

  function betOverlay(myAmt: number, tableAmt: number, markers: BetMarkerEntry[], isWinner = false, avatarSize?: number) {
    if (tableAmt <= 0 && markers.length === 0) return null;
    const myLabel = myAmt >= 10000 ? `${(myAmt/1000).toFixed(0)}k` : myAmt >= 1000 ? `${(myAmt/1000).toFixed(1)}k` : myAmt > 0 ? String(myAmt) : null;
    return (
      <>
        <span style={{ position: "absolute", bottom: 2, left: 2, zIndex: 10 }}>
          <AnimatePresence>
            {markers.length > 0 && (
              <AvatarCluster markers={markers} myUsername={myUsername} totalAmount={tableAmt} isWinner={isWinner} sizeOverride={avatarSize} />
            )}
          </AnimatePresence>
        </span>
        {myLabel && (
          <span style={{
            position: "absolute", top: -8, right: -8, zIndex: 20,
            background: "#f59e0b", color: "#1c1917", fontSize: 9, fontWeight: 900,
            borderRadius: "50%", minWidth: 16, height: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 2px", border: "1px solid #fde68a", pointerEvents: "none",
          }}>
            {myLabel}
          </span>
        )}
      </>
    );
  }

  function numBg(n: number, won: boolean, hasBet: boolean) {
    const c = numColor(n);
    if (won) return "#854d0e";
    if (hasBet) return c === "red" ? "#b91c1c" : c === "green" ? "#15803d" : "#3f3f46";
    return c === "red" ? "#991b1b" : c === "green" ? "#166534" : "#27272a";
  }

  function cellBorder(won: boolean, hasBet: boolean): string {
    if (won) return "2px solid #fde047";
    if (hasBet) return "2px solid #f59e0b";
    return "1px solid #c9a43b55";
  }

  const numCell = (n: number | "0" | "00") => {
    const num = n === "00" ? -1 : Number(n);
    const mk = markersFor("straight", [num]);
    const ta = tableTotal("straight", [num]);
    const won = showResult && winningNumber === num;
    const hasBet = myBetTotal("straight", [num]) > 0 || mk.length > 0;
    return (
      <button key={String(n)} disabled={disabled}
        onClick={() => onBet({ type: "straight", numbers: [num], amount: chipAmount })}
        style={{
          position: "relative",
          width: "100%", height: "100%",
          background: numBg(num, won, hasBet),
          border: cellBorder(won, hasBet),
          borderRadius: 4,
          color: "#ffffff",
          fontWeight: 800,
          fontSize: 13,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "visible",
          transform: won ? "scale(1.1)" : "none",
          zIndex: won ? 5 : "auto",
          transition: "background 0.15s",
        }}>
        <span style={{ position: "relative", zIndex: 1 }}>{n}</span>
        {betOverlay(myBetTotal("straight", [num]), ta, mk, won, 20)}
      </button>
    );
  };

  function OutsideBtn({ label, type, numbers, winCheck, isRed, isBlack, style: extraStyle }: {
    label: string; type: string; numbers: number[];
    winCheck?: number[]; isRed?: boolean; isBlack?: boolean;
    style?: React.CSSProperties;
  }) {
    const myAmt = myBetTotal(type, numbers);
    const tableAmt = tableTotal(type, numbers);
    const markers = markersFor(type, numbers);
    const won = !!(showResult && winCheck && winningNumber != null && winCheck.includes(winningNumber));
    const hasBet = myAmt > 0 || markers.length > 0;
    return (
      <button disabled={disabled}
        onClick={() => onBet({ type, numbers, amount: chipAmount })}
        style={{
          position: "relative",
          background: won ? "#78350f" : hasBet ? "#3f3f46" : "#1c3d2a",
          border: cellBorder(won, hasBet),
          borderRadius: 4,
          color: won ? "#fde047" : "#e5c97e",
          fontWeight: 700,
          fontSize: 12,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          overflow: "visible",
          opacity: disabled ? 0.65 : 1,
          transition: "background 0.15s",
          ...extraStyle,
        }}>
        {isRed && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#dc2626", display: "inline-block", flexShrink: 0 }} />}
        {isBlack && <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#18181b", border: "1px solid #71717a", display: "inline-block", flexShrink: 0 }} />}
        <span>{label}</span>
        {betOverlay(myAmt, tableAmt, markers, won)}
      </button>
    );
  }

  const outsideNumbersRed  = Array.from(RED);
  const outsideNumbersBlack = Array.from(BLACK);
  const outsideOdd  = Array.from({ length: 18 }, (_, i) => i * 2 + 1);
  const outsideEven = Array.from({ length: 18 }, (_, i) => (i + 1) * 2);
  const outsideLow  = Array.from({ length: 18 }, (_, i) => i + 1);
  const outsideHigh = Array.from({ length: 18 }, (_, i) => i + 19);

  // Layout constants
  const ZERO_W = 46;
  const TWO1_W = 46;
  const ROW_H  = 44;
  const NUM_ROWS = 3;
  const GAP = 4;
  const GRID_H = NUM_ROWS * ROW_H + (NUM_ROWS - 1) * GAP; // total middle section height

  // Zero column cell heights: american splits GRID_H into two equal cells, european fills full height
  const zeroCellH = wheelType === "american" ? Math.floor((GRID_H - GAP) / 2) : GRID_H;

  return (
    <div style={{
      background: "#14532d",
      border: "2px solid #c9a43b",
      borderRadius: 12,
      padding: 8,
      opacity: disabled ? 0.88 : 1,
    }}>
      {/* Always rendered — visibility toggled so it never shifts the grid */}
      <div style={{
        textAlign: "center", fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
        color: "#f59e0b", background: "rgba(0,0,0,0.45)", borderRadius: 6,
        padding: "3px 0", marginBottom: 6, textTransform: "uppercase",
        visibility: disabled ? "visible" : "hidden",
        pointerEvents: "none",
      }}>
        Betting Closed
      </div>

      {/* ── TOP ROW: 1-18 / EVEN / RED / BLACK / ODD / 19-36 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: GAP, marginBottom: GAP }}>
        <OutsideBtn label="1–18"    type="low"   numbers={[]} winCheck={outsideLow}          style={{ height: 36 }} />
        <OutsideBtn label="EVEN"    type="even"  numbers={[]} winCheck={outsideEven}         style={{ height: 36 }} />
        <OutsideBtn label="RED"     type="red"   numbers={[]} winCheck={outsideNumbersRed}   style={{ height: 36 }} isRed />
        <OutsideBtn label="BLACK"   type="black" numbers={[]} winCheck={outsideNumbersBlack} style={{ height: 36 }} isBlack />
        <OutsideBtn label="ODD"     type="odd"   numbers={[]} winCheck={outsideOdd}          style={{ height: 36 }} />
        <OutsideBtn label="19–36"   type="high"  numbers={[]} winCheck={outsideHigh}         style={{ height: 36 }} />
      </div>

      {/* ── MIDDLE ROW: 0/00 column | 12×3 number grid | 2:1 column ── */}
      <div style={{ display: "flex", gap: GAP, marginBottom: GAP, height: GRID_H }}>

        {/* Zero column — cells explicitly fill GRID_H */}
        <div style={{ width: ZERO_W, display: "flex", flexDirection: "column", gap: GAP, flexShrink: 0, height: GRID_H }}>
          {wheelType === "american" && (
            <div style={{ height: zeroCellH, flexShrink: 0 }}>
              {numCell("00")}
            </div>
          )}
          <div style={{ height: zeroCellH, flexShrink: 0 }}>
            {numCell("0")}
          </div>
        </div>

        {/* 12 columns × 3 rows number grid */}
        <div style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gridTemplateRows: `repeat(3, ${ROW_H}px)`,
          gap: GAP,
        }}>
          {GRID_ROWS.map(row => row.map(n => numCell(n)))}
        </div>

        {/* 2:1 column bets — one per row: col 3 (top row), col 2 (mid), col 1 (bottom) */}
        <div style={{ width: TWO1_W, display: "flex", flexDirection: "column", gap: GAP, flexShrink: 0 }}>
          {([3, 2, 1] as const).map(col => (
            <OutsideBtn key={col} label="2:1" type="column" numbers={[col]}
              winCheck={Array.from({ length: 12 }, (_, i) => i * 3 + col)}
              style={{ flex: 1 }} />
          ))}
        </div>
      </div>

      {/* ── BOTTOM ROW: Dozens ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: GAP }}>
        <OutsideBtn label="1st 12"  type="dozen" numbers={[1]} winCheck={Array.from({length:12},(_,i)=>i+1)}   style={{ height: 36 }} />
        <OutsideBtn label="2nd 12"  type="dozen" numbers={[2]} winCheck={Array.from({length:12},(_,i)=>i+13)}  style={{ height: 36 }} />
        <OutsideBtn label="3rd 12"  type="dozen" numbers={[3]} winCheck={Array.from({length:12},(_,i)=>i+25)}  style={{ height: 36 }} />
      </div>
    </div>
  );
}

// ── Bet key helper (mirrors server) ───────────────────────────────────────────

function betKeyFor(type: string, numbers: number[]): string {
  switch (type) {
    case "straight": return `s-${numbers[0]}`;
    case "split":    return `sp-${[...numbers].sort((a,b)=>a-b).join(",")}`;
    case "street":   return `st-${numbers[0]}`;
    case "corner":   return `co-${numbers[0]}`;
    case "sixline":  return `sl-${numbers[0]}`;
    case "dozen":    return `d-${numbers[0]}`;
    case "column":   return `c-${numbers[0]}`;
    default:         return type;
  }
}

// ── Phase display helpers ──────────────────────────────────────────────────────

function PhaseBar({ phase, secondsLeft, playerCount }: { phase: Phase; secondsLeft: number; playerCount: number }) {
  const configs: Record<Phase, { label: string; color: string; bg: string }> = {
    WAITING:       { label: "Table closed", color: "text-zinc-400", bg: "bg-zinc-900 border-zinc-700" },
    BETTING_OPEN:  { label: `🟢 Place your bets — ${secondsLeft}s`, color: "text-green-300", bg: "bg-green-950 border-green-800" },
    BETTING_CLOSED:{ label: "🔴 Bets closed — No more bets", color: "text-red-300", bg: "bg-red-950 border-red-800" },
    SPINNING:      { label: "🎡 Wheel spinning…", color: "text-amber-300", bg: "bg-amber-950 border-amber-800" },
    RESULT:        { label: "✅ Round result", color: "text-emerald-300", bg: "bg-emerald-950 border-emerald-800" },
    RESETTING:     { label: "⏳ Next round starting…", color: "text-zinc-400", bg: "bg-zinc-900 border-zinc-700" },
  };
  const { label, color, bg } = configs[phase] ?? configs.WAITING;
  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b ${bg}`}>
      <span className={`text-sm font-bold tracking-wide ${color}`}>{label}</span>
      <span className="flex items-center gap-1 text-xs text-zinc-500">
        <Users className="w-3 h-3" />
        {playerCount} at table
      </span>
    </div>
  );
}

// ── Main Roulette Page ─────────────────────────────────────────────────────────

export default function Roulette() {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("roulette", sessionToken);
  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));
  const { data: httpStatus, refetch: refetchStatus } = useGetRouletteStatus({
    query: { refetchInterval: 5_000 },
  });
  usePasswordGuard("roulette");

  // ── WS state ──────────────────────────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const [wsReady, setWsReady] = useState(false);
  const [wsReconnectKey, setWsReconnectKey] = useState(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Delayed disconnect indicator — never flash on initial connect ──────────
  // Only show "Reconnecting" after being disconnected for 5+ seconds,
  // and never on the first page load (before first successful connect).
  const wsWasEverConnected = useRef(false);
  const disconnectShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDisconnected, setShowDisconnected] = useState(false);

  useEffect(() => {
    if (wsReady) {
      wsWasEverConnected.current = true;
      if (disconnectShowTimerRef.current) {
        clearTimeout(disconnectShowTimerRef.current);
        disconnectShowTimerRef.current = null;
      }
      setShowDisconnected(false);
    } else if (wsWasEverConnected.current) {
      // Only show warning after 5 s of sustained disconnection
      disconnectShowTimerRef.current = setTimeout(() => {
        setShowDisconnected(true);
      }, 5000);
    }
    return () => {
      if (disconnectShowTimerRef.current) {
        clearTimeout(disconnectShowTimerRef.current);
        disconnectShowTimerRef.current = null;
      }
    };
  }, [wsReady]);

  // ── Room state (driven by WS) ─────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("WAITING");
  const [timerEndMs, setTimerEndMs] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [roundId, setRoundId] = useState("");
  const [wheelType, setWheelType] = useState<string>("european");
  const [wsMinBet, setWsMinBet] = useState<number | null>(null);
  const [wsMaxBet, setWsMaxBet] = useState<number | null>(null);
  const [wsMaxBetsPerSpin, setWsMaxBetsPerSpin] = useState<number | null>(null);
  const [tableBets, setTableBets] = useState<Record<string, number>>({});
  const [betMarkers, setBetMarkers] = useState<Record<string, BetMarkerEntry[]>>({});
  const [playerCount, setPlayerCount] = useState(0);
  const [myBets, setMyBets] = useState<ServerBet[]>([]);
  const [myTotal, setMyTotal] = useState(0);
  const [payoutResult, setPayoutResult] = useState<PayoutResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [clearingBets, setClearingBets] = useState(false);

  // ── Wheel animation state ─────────────────────────────────────────────────
  const [chipAmount, setChipAmount] = useState(100);
  const [spinning, setSpinning] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [spinDuration, setSpinDuration] = useState(6000);
  const rotationRef = useRef(0);
  const wheelRafRef = useRef<number | null>(null);
  const pendingResultRef = useRef<(() => void) | null>(null); // deferred until animation finishes
  const [ballRotation, setBallRotation] = useState(0);
  const [ballDuration, setBallDuration] = useState(6000);
  const [ballEasing, setBallEasing] = useState("cubic-bezier(0.05, 0.9, 0.1, 1.0)");
  const ballRotationRef = useRef(0);

  // Cancel wheel rAF on unmount
  useEffect(() => () => { if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current); }, []);
  const [showResult, setShowResult] = useState(false);
  const [recentLandings, setRecentLandings] = useState<Array<{ number: number; color: "red" | "black" | "green" }>>([]);

  const wheelOrder = wheelType === "american" ? AMER_WHEEL : EURO_WHEEL;

  // ── Wheel animation function ───────────────────────────────────────────────
  // Takes `order` explicitly so it never relies on stale closure state.
  const animateWheelTo = useCallback((winningNumber: number, _unused: number, order: number[]) => {
    const total = order.length;
    const idx = winningNumber === -1 ? order.lastIndexOf(-1) : order.indexOf(winningNumber);
    if (idx === -1) return; // safety: unknown number, skip

    // ── Wheel profiles — rotor spins clockwise, decelerates via rAF physics ───
    const wheelProfiles = [
      { minMs: 6000, maxMs: 8000, minRot: 10, maxRot: 14, decayPower: 2.2 },
      { minMs: 7500, maxMs: 10000, minRot: 13, maxRot: 18, decayPower: 2.5 },
      { minMs: 5500, maxMs: 7500, minRot: 9,  maxRot: 13, decayPower: 2.0 },
      { minMs: 9000, maxMs: 12000, minRot: 16, maxRot: 22, decayPower: 3.0 },
    ];
    const wp = wheelProfiles[Math.floor(Math.random() * wheelProfiles.length)];
    const duration = wp.minMs + Math.floor(Math.random() * (wp.maxMs - wp.minMs));
    const extraRotations = wp.minRot + Math.floor(Math.random() * (wp.maxRot - wp.minRot + 1));

    const anglePerSlot = 360 / total;

    // Pick a truly random landing angle anywhere on the ring (0-360°)
    // then add a small jitter within the pocket so it's not always on the slot center line
    const landingAngle = Math.random() * 360;
    const pocketJitter = (Math.random() * 2 - 1) * anglePerSlot * 0.38;
    const finalAngle = landingAngle + pocketJitter;

    // Wheel: clockwise — rotates so winning number ends up at finalAngle in fixed frame
    // normalizedTarget brings winning number to 0 (top); adding finalAngle moves target anywhere
    const normalizedTarget = ((360 - ((idx * anglePerSlot) % 360)) % 360 + 360) % 360;
    const currentMod = ((rotationRef.current % 360) + 360) % 360;
    const delta = ((normalizedTarget + finalAngle - currentMod) % 360 + 360) % 360;
    const fromRotation = rotationRef.current; // capture BEFORE updating so rAF knows start angle
    const newRotation = fromRotation + extraRotations * 360 + delta;
    rotationRef.current = newRotation;

    // ── Ball — counter-clockwise, lands at the same finalAngle as the winning pocket ─
    const ballEasingProfiles = [
      "cubic-bezier(0.02, 0.96, 0.04, 1.0)",
      "cubic-bezier(0.03, 0.92, 0.06, 1.0)",
      "cubic-bezier(0.04, 0.88, 0.08, 1.0)",
      "cubic-bezier(0.02, 0.94, 0.05, 1.0)",
      "cubic-bezier(0.05, 0.85, 0.10, 1.0)",
    ];
    const chosenBallEasing = ballEasingProfiles[Math.floor(Math.random() * ballEasingProfiles.length)];

    const ballExtraRot = 5 + Math.floor(Math.random() * 6);
    const currentBallMod = ((ballRotationRef.current % 360) + 360) % 360;
    // Ball travels counter-clockwise and lands at finalAngle (anywhere on the ring)
    const newBallRotation = ballRotationRef.current - (ballExtraRot * 360 + currentBallMod) + finalAngle;
    ballRotationRef.current = newBallRotation;

    // Ball settles slightly before the wheel (78-96% of wheel time) — realistic physics
    const ballDurationMs = Math.round(duration * (0.78 + Math.random() * 0.18));

    setSpinDuration(duration);

    // ── Wheel: rAF physics loop — constant-friction deceleration (power ease-out) ──
    // f(t) = 1 - (1-t)^power: fast start, very gradual creep to final position
    if (wheelRafRef.current !== null) cancelAnimationFrame(wheelRafRef.current);
    const fromAngle = fromRotation; // captured before updating rotationRef
    const toAngle = newRotation;
    const power = wp.decayPower;
    const startTime = performance.now();
    function wheelTick(now: number) {
      const t = Math.min((now - startTime) / duration, 1);
      const progress = 1 - Math.pow(1 - t, power);
      setWheelRotation(fromAngle + (toAngle - fromAngle) * progress);
      if (t < 1) {
        wheelRafRef.current = requestAnimationFrame(wheelTick);
      } else {
        setWheelRotation(toAngle);
        wheelRafRef.current = null;
        // Fire any result that arrived from the server while we were still spinning
        if (pendingResultRef.current) {
          pendingResultRef.current();
          pendingResultRef.current = null;
        }
      }
    }
    wheelRafRef.current = requestAnimationFrame(wheelTick);

    setBallRotation(newBallRotation);
    setBallDuration(ballDurationMs);
    setBallEasing(chosenBallEasing);
  }, []);

  // ── WebSocket connection ───────────────────────────────────────────────────
  useEffect(() => {
    if (!playerId || !sessionToken) return;

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}${base}/api/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsReady(true);
      ws.send(JSON.stringify({
        type: "subscribe_roulette",
        token: sessionToken,
        playerId,
        username: currentPlayer?.username ?? "Player",
        avatarUrl: currentPlayer?.avatarUrl ?? null,
      }));
      ws.send(JSON.stringify({ type: "subscribe_player", playerId, token: sessionToken }));
    };

    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case "roulette_state": {
          setPhase(msg.phase);
          setTimerEndMs(msg.timerEndMs ?? 0);
          setRoundId(msg.roundId ?? "");
          setWheelType(msg.wheelType ?? "european");
          if (msg.minBet != null) setWsMinBet(msg.minBet);
          if (msg.maxBet != null) setWsMaxBet(msg.maxBet);
          if (msg.maxBetsPerSpin != null) setWsMaxBetsPerSpin(msg.maxBetsPerSpin);
          setTableBets(msg.tableBets ?? {});
          setBetMarkers(msg.betMarkers ?? {});
          setPlayerCount(msg.playerCount ?? 0);
          setMyBets(msg.myBets ?? []);
          setMyTotal(msg.myTotal ?? 0);
          if (msg.phase === "RESULT" || msg.phase === "RESETTING") {
            if (msg.winningNumber != null) setShowResult(true);
          } else {
            setShowResult(false);
            setPayoutResult(null);
          }
          // Restore timer — use server-computed secondsLeft to avoid clock skew
          if (msg.phase === "BETTING_OPEN") {
            setSecondsLeft(msg.secondsLeft ?? 0);
          }
          // Refresh enabled status on reconnect so UI reflects current state immediately
          refetchStatus();
          break;
        }
        case "roulette_phase": {
          const newPhase: Phase = msg.phase;
          setPhase(newPhase);
          if (msg.timerEndMs) setTimerEndMs(msg.timerEndMs);
          if (msg.roundId) setRoundId(msg.roundId);
          if (msg.wheelType) setWheelType(msg.wheelType);

          if (newPhase === "BETTING_OPEN") {
            setMyBets([]);
            setMyTotal(0);
            setTableBets({});
            setBetMarkers({});
            setPlayerCount(0);
            setShowResult(false);
            setPayoutResult(null);
            setErrorMsg(null);
            // Use server-supplied secondsLeft to avoid client/server clock-skew
            setSecondsLeft(msg.secondsLeft ?? Math.max(0, Math.ceil(((msg.timerEndMs ?? 0) - Date.now()) / 1000)));
            if (msg.minBet != null) setWsMinBet(msg.minBet);
            if (msg.maxBet != null) setWsMaxBet(msg.maxBet);
            if (msg.maxBetsPerSpin != null) setWsMaxBetsPerSpin(msg.maxBetsPerSpin);
            // Room just opened — refresh HTTP status so enabled flag updates immediately
            refetchStatus();
          }
          if (newPhase === "WAITING") {
            // Room just closed — refresh HTTP status
            refetchStatus();
          }
          if (newPhase === "SPINNING" && msg.winningNumber != null) {
            setSpinning(true);
            setShowResult(false);
            setPayoutResult(null);
            // Derive wheel order directly from the message to avoid stale closure
            const spinOrder = (msg.wheelType === "american" ? AMER_WHEEL : EURO_WHEEL);
            animateWheelTo(msg.winningNumber, 0, spinOrder);
            playSound("spinStart");
          }
          if (newPhase === "RESULT") {
            const wn = msg.winningNumber;
            const applyResult = () => {
              setSpinning(false);
              setShowResult(true);
              if (wn != null) {
                setRecentLandings(prev =>
                  [{ number: wn, color: numColor(wn) }, ...prev].slice(0, 20)
                );
              }
            };
            // If the wheel rAF animation is still running, defer until it finishes
            if (wheelRafRef.current !== null) {
              pendingResultRef.current = applyResult;
            } else {
              applyResult();
            }
          }
          if (newPhase === "RESETTING") {
            setSpinning(false);
          }
          break;
        }
        case "roulette_timer": {
          setSecondsLeft(msg.secondsLeft ?? 0);
          break;
        }
        case "roulette_bet_confirmed": {
          setMyBets(msg.myBets ?? []);
          setMyTotal(msg.myTotal ?? 0);
          playSound("chip");
          break;
        }
        case "roulette_bets_cleared": {
          setMyBets([]);
          setMyTotal(0);
          setClearingBets(false);
          break;
        }
        case "roulette_table_activity": {
          setTableBets(msg.tableBets ?? {});
          setBetMarkers(msg.betMarkers ?? {});
          setPlayerCount(msg.playerCount ?? 0);
          break;
        }
        case "roulette_payout": {
          const pr: PayoutResult = {
            bets: msg.bets ?? [],
            totalBet: msg.totalBet ?? 0,
            totalPayout: msg.totalPayout ?? 0,
            netResult: msg.netResult ?? 0,
            playerChips: msg.playerChips ?? 0,
          };
          setPayoutResult(pr);
          const won = pr.netResult >= 0;
          const isStraightUp = pr.bets.some((b: any) => b.won && b.type === "straight");
          if (isStraightUp && won) playSound("jackpot");
          else if (won) playSound("win");
          else playSound("lose");
          break;
        }
        case "roulette_error": {
          setErrorMsg(msg.message ?? "Error");
          setTimeout(() => setErrorMsg(null), 4000);
          break;
        }
        case "chip_update": {
          break;
        }
      }
    };

    ws.onclose = () => {
      setWsReady(false);
      wsRef.current = null;
      // Auto-reconnect after 3 s — long enough to avoid thrashing on brief blips
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        setWsReconnectKey(k => k + 1);
      }, 3000);
    };
    // onerror: onclose always fires after onerror, don't duplicate setWsReady(false)
    ws.onerror = () => {};

    return () => {
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      ws.close();
    };
  }, [playerId, sessionToken, wsReconnectKey]);

  // Re-send with latest avatar when player data loads
  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && playerId && currentPlayer?.username && sessionToken) {
      wsRef.current.send(JSON.stringify({
        type: "subscribe_roulette",
        token: sessionToken,
        playerId,
        username: currentPlayer.username,
        avatarUrl: currentPlayer.avatarUrl ?? null,
      }));
    }
  }, [currentPlayer?.username, currentPlayer?.avatarUrl]);

  // ── Redirect if not logged in / no game token ──────────────────────────────
  useEffect(() => {
    if (!playerId) setLocation("/login");
  }, [playerId]);
  useEffect(() => { if (!isGameUnlocked("roulette")) setLocation("/lobby"); }, []);

  // ── Place bet via WS ───────────────────────────────────────────────────────
  function handleBet(bet: Omit<ServerBet, "id">) {
    if (phase !== "BETTING_OPEN" || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const maxBet = wsMaxBet ?? httpStatus?.maxBet;
    if (maxBet != null) {
      // Enforce per-bet amount cap
      if (bet.amount > maxBet) {
        setErrorMsg(`Maximum bet per spot is ${maxBet.toLocaleString()} chips`);
        setTimeout(() => setErrorMsg(null), 3000);
        return;
      }
      // Enforce cumulative per-spot cap
      const spotKey = betKeyFor(bet.type, bet.numbers ?? []);
      const spotTotal = myBets.filter(b => betKeyFor(b.type, b.numbers) === spotKey).reduce((s, b) => s + b.amount, 0);
      if (spotTotal + bet.amount > maxBet) {
        setErrorMsg(`Max ${maxBet.toLocaleString()} chips per spot (${spotTotal.toLocaleString()} already placed)`);
        setTimeout(() => setErrorMsg(null), 3000);
        return;
      }
    }

    wsRef.current.send(JSON.stringify({
      type: "roulette_place_bet",
      token: sessionToken,
      username: currentPlayer?.username ?? "Player",
      avatarUrl: currentPlayer?.avatarUrl ?? null,
      bet,
    }));
  }

  // ── Clear bets via WS ──────────────────────────────────────────────────────
  function handleClearBets() {
    if (phase !== "BETTING_OPEN" || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setClearingBets(true);
    wsRef.current.send(JSON.stringify({ type: "roulette_clear_bets", token: sessionToken }));
  }

  const chips = liveChips ?? currentPlayer?.chips ?? 0;
  // Visual "canBet" is phase-only — WS reconnects must not flash "Betting Closed"
  // The actual handleBet already guards against sending while disconnected
  const canBet = phase === "BETTING_OPEN";
  const winningColor = showResult && payoutResult
    ? numColor(payoutResult.bets.length > 0 ? (recentLandings[0]?.number ?? 0) : 0)
    : recentLandings.length > 0 ? recentLandings[0].color : null;

  // Derive winning number from recentLandings for display
  const displayWinningNumber = (phase === "RESULT" || phase === "RESETTING") && recentLandings.length > 0
    ? recentLandings[0].number
    : null;

  if (!playerId) return null;

  const enabled = httpStatus?.enabled ?? false;

  const winColor = recentLandings[0]?.color === "red" ? "#ef4444" : recentLandings[0]?.color === "green" ? "#22c55e" : "#e4e4e7";
  const timerColor = secondsLeft <= 5 ? "#ef4444" : secondsLeft <= 10 ? "#f59e0b" : "#22c55e";
  const rMin = wsMinBet ?? httpStatus?.minBet;
  const rMax = wsMaxBet ?? httpStatus?.maxBet;
  const rMaxSpots = wsMaxBetsPerSpin ?? httpStatus?.maxBetsPerSpin;
  const rWheel = wheelType || httpStatus?.wheelType;

  const S: Record<string, React.CSSProperties> = {
    card: { background: "#0e070a", border: "1px solid #2a1520", borderRadius: 14 },
    label: { fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#6b2d3e" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "#080204", fontFamily: "Inter, sans-serif" }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", borderBottom: "1px solid #3b0a17",
        background: "#0a0507", position: "sticky", top: 0, zIndex: 20,
      }}>
        <button onClick={() => setLocation("/tablegames")} style={{
          display: "flex", alignItems: "center", gap: 4,
          color: "#6b2d3e", fontSize: 13, background: "none", border: "none", cursor: "pointer",
        }}>
          <ChevronLeft size={16} /> <span style={{ color: "#9ca3af" }}>Table Games</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 17,
            color: "#f5f5f5", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>🎡 Roulette</span>
          {rWheel && (
            <span style={{
              fontSize: 10, fontWeight: 700, color: "#f59e0b",
              background: "#1c0f00", border: "1px solid #92400e",
              padding: "2px 9px", borderRadius: 20, letterSpacing: "0.05em",
            }}>
              {rWheel === "american" ? "AMERICAN" : "EUROPEAN"}
            </span>
          )}
          <span style={{
            fontSize: 10, color: "#52525b", background: "#1a1a1a",
            border: "1px solid #2d2d2d", padding: "2px 8px", borderRadius: 20,
          }}>Multiplayer</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Reserve fixed space — use visibility so it never shifts layout */}
          <span style={{
            fontSize: 11, color: "#ef4444", fontWeight: 600,
            visibility: showDisconnected ? "visible" : "hidden",
          }}>⚠ Reconnecting</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#f59e0b", fontFamily: "Oswald, sans-serif" }}>
            {chips.toLocaleString()}
          </span>
          <span style={{ fontSize: 11, color: "#52525b" }}>chips</span>
        </div>
      </div>

      {/* ── Phase strip — always rendered so it never causes layout shift ── */}
      <PhaseBar phase={enabled ? phase : "WAITING"} secondsLeft={secondsLeft} playerCount={playerCount} />

      {/* ── Error flash ── */}
      <AnimatePresence>
        {errorMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{
              position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)",
              zIndex: 50, background: "#7f1d1d", border: "1px solid #ef4444",
              color: "#fecaca", fontSize: 13, fontWeight: 600, padding: "10px 20px", borderRadius: 12,
            }}>
            {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {!enabled ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 48, marginBottom: 16 }}>🎡</p>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 28, fontWeight: 700, color: "#f5f5f5", marginBottom: 8 }}>Table Closed</h2>
            <p style={{ color: "#71717a", marginBottom: 24 }}>The banker has closed the roulette table.</p>
            <button onClick={() => { refetchStatus(); setWsReconnectKey(k => k + 1); }} style={{
              padding: "8px 24px", borderRadius: 10, fontSize: 13, fontWeight: 600,
              border: "1px solid #3f3f46", color: "#a1a1aa", background: "none", cursor: "pointer",
            }}>Check again</button>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ═══════════════════════════════════════════════════
              MAIN CASINO TABLE — wheel + grid in one felt card
              ═══════════════════════════════════════════════════ */}
          <div style={{
            background: "#0f1f14",
            border: "2px solid #b8922a",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 0 60px rgba(184,146,42,0.12), 0 0 120px rgba(160,34,58,0.1)",
          }}>

            {/* Recent spins strip */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 18px",
              background: "rgba(0,0,0,0.35)",
              borderBottom: "1px solid #b8922a33",
              flexWrap: "wrap", minHeight: 46,
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b4f1a", flexShrink: 0 }}>Last Spins</span>
              {recentLandings.length === 0
                ? <span style={{ fontSize: 11, color: "#374151", fontStyle: "italic" }}>No spins yet</span>
                : recentLandings.map((l, i) => (
                  <motion.span key={i} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 900, color: "#fff",
                      background: l.color === "red" ? "#991b1b" : l.color === "green" ? "#166534" : "#1c1c1c",
                      border: `2px solid ${l.color === "red" ? "#ef4444" : l.color === "green" ? "#22c55e" : "#3f3f46"}`,
                      opacity: Math.max(0.3, 1 - i * 0.05),
                    }}>
                    {l.number === -1 ? "00" : l.number}
                  </motion.span>
                ))
              }
            </div>

            {/* Wheel + Table side-by-side */}
            <div style={{ display: "flex", alignItems: "stretch" }}>

              {/* ── WHEEL PANEL ── */}
              <div style={{
                width: 300, flexShrink: 0,
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 10,
                padding: "16px 12px",
                borderRight: "1px solid #b8922a33",
                background: "rgba(0,0,0,0.25)",
              }}>
                <RouletteWheel
                  wheelOrder={wheelOrder}
                  rotation={wheelRotation}
                  spinning={spinning}
                  ballRotation={ballRotation}
                  ballDuration={ballDuration}
                  ballEasing={ballEasing}
                />

                {/* Status inside wheel panel — FIXED height, content never shifts layout */}
                <div style={{ width: "100%", textAlign: "center", height: 150, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  {phase === "BETTING_OPEN" && (
                    <>
                      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#15803d", marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}>
                        <Clock size={10} /> Time to Bet
                      </p>
                      <p style={{ fontFamily: "Oswald, sans-serif", fontSize: 52, fontWeight: 700, color: timerColor, lineHeight: 1, marginBottom: 6 }}>
                        {secondsLeft}<span style={{ fontSize: 18 }}>s</span>
                      </p>
                      <div style={{ width: "80%", height: 5, background: "#111", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 99,
                          width: `${Math.min(100, (secondsLeft / 30) * 100)}%`,
                          background: timerColor, transition: "width 1s linear",
                        }} />
                      </div>
                    </>
                  )}
                  {phase === "BETTING_CLOSED" && (
                    <p style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, fontWeight: 700, color: "#f59e0b" }}>⏱ Bets Closed</p>
                  )}
                  {phase === "SPINNING" && (
                    <p style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.04em" }}>🎡 Spinning…</p>
                  )}
                  {(phase === "RESULT" || phase === "RESETTING") && displayWinningNumber != null && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b4f1a" }}>Winner</span>
                      <span style={{
                        fontFamily: "Oswald, sans-serif", fontSize: 48, fontWeight: 700,
                        color: winColor, lineHeight: 1,
                        textShadow: `0 0 20px ${winColor}66`,
                      }}>
                        {displayWinningNumber === -1 ? "00" : displayWinningNumber}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20,
                        textTransform: "uppercase", letterSpacing: "0.08em",
                        background: recentLandings[0]?.color === "red" ? "#450a0a" : recentLandings[0]?.color === "green" ? "#052e16" : "#18181b",
                        color: winColor, border: `1px solid ${winColor}44`,
                      }}>
                        {recentLandings[0]?.color ?? "—"}
                      </span>
                      {payoutResult && (
                        <p style={{
                          fontFamily: "Oswald, sans-serif", fontSize: 22, fontWeight: 700, marginTop: 4,
                          color: payoutResult.netResult >= 0 ? "#22c55e" : "#ef4444",
                        }}>
                          {payoutResult.netResult >= 0 ? "+" : ""}{payoutResult.netResult.toLocaleString()}
                          <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3 }}>chips</span>
                        </p>
                      )}
                    </div>
                  )}
                  {(phase === "WAITING" || (phase === "RESETTING" && displayWinningNumber == null)) && (
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#374151", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      {phase === "RESETTING" ? "Next round soon…" : "Waiting to start"}
                    </p>
                  )}
                </div>
              </div>

              {/* ── BETTING GRID PANEL ── */}
              <div style={{ flex: 1, padding: "14px 16px", minWidth: 0 }}>
                <BettingTable
                  myBets={myBets}
                  tableBets={tableBets}
                  betMarkers={betMarkers}
                  myUsername={currentPlayer?.username ?? ""}
                  chipAmount={chipAmount}
                  onBet={handleBet}
                  winningNumber={displayWinningNumber}
                  showResult={showResult}
                  wheelType={wheelType}
                  disabled={!canBet}
                />
              </div>

            </div>

            {/* ── FELT FOOTER: PNG chips + My Bets ── */}
            <div style={{
              borderTop: "1px solid #b8922a33",
              background: "rgba(0,0,0,0.32)",
              padding: "10px 18px",
              display: "flex", alignItems: "center", gap: 0,
            }}>

              {/* PNG Chip tray */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6b4f1a" }}>Chip Value</span>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                  {ROULETTE_CHIP_DEFS.map(cd => {
                    const selected = chipAmount === cd.value;
                    return (
                      <div
                        key={cd.value}
                        onClick={() => setChipAmount(cd.value)}
                        style={{
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                          cursor: "pointer",
                          transition: "transform 0.15s, filter 0.15s",
                          transform: selected ? "translateY(-6px) scale(1.12)" : "translateY(0) scale(1)",
                          filter: selected
                            ? `drop-shadow(0 6px 14px ${cd.glow})`
                            : "drop-shadow(0 2px 6px rgba(0,0,0,0.55))",
                        }}
                        onMouseEnter={e => {
                          if (!selected) {
                            (e.currentTarget as HTMLDivElement).style.transform = "translateY(-5px)";
                            (e.currentTarget as HTMLDivElement).style.filter = `drop-shadow(0 6px 14px ${cd.glow})`;
                          }
                        }}
                        onMouseLeave={e => {
                          if (!selected) {
                            (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                            (e.currentTarget as HTMLDivElement).style.filter = "drop-shadow(0 2px 6px rgba(0,0,0,0.55))";
                          }
                        }}
                      >
                        <div style={{ position: "relative" }}>
                          {selected && (
                            <div style={{
                              position: "absolute", inset: -4, borderRadius: "50%",
                              border: `2px solid ${cd.glow.replace("0.65", "1")}`,
                              boxShadow: `0 0 10px ${cd.glow}`,
                              pointerEvents: "none",
                            }} />
                          )}
                          <img
                            src={`${BASE}/chips/${cd.file}`}
                            alt={cd.label}
                            style={{
                              width: 46, height: 46,
                              objectFit: "contain",
                              pointerEvents: "none",
                              display: "block",
                            }}
                          />
                        </div>
                        <span style={{
                          fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                          color: selected ? "#fff" : "rgba(255,255,255,0.4)",
                        }}>{cd.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Divider */}
              <div style={{ width: 1, alignSelf: "stretch", background: "#b8922a22", margin: "0 16px" }} />

              {/* My Bets — fills remaining width */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#6b4f1a", display: "flex", alignItems: "center", gap: 5 }}>
                    My Bets
                    {myBets.length > 0 && (
                      <span style={{
                        background: "#f59e0b", color: "#1c1917", fontSize: 8, fontWeight: 900,
                        borderRadius: "50%", width: 14, height: 14,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}>{myBets.length}</span>
                    )}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    {myBets.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>
                        {myTotal.toLocaleString()} wagered
                      </span>
                    )}
                    {myBets.length > 0 && phase === "BETTING_OPEN" && (
                      <button onClick={handleClearBets} disabled={clearingBets} style={{
                        display: "flex", alignItems: "center", gap: 3,
                        fontSize: 10, color: "#9f1239", background: "none", border: "none",
                        cursor: "pointer", fontWeight: 600,
                      }}>
                        <Trash2 size={11} /> {clearingBets ? "…" : "Clear"}
                      </button>
                    )}
                  </div>
                </div>
                {myBets.length === 0 ? (
                  <p style={{ fontSize: 11, color: "#374151", fontStyle: "italic" }}>
                    {canBet ? "Click the table to place bets" : phase === "SPINNING" ? "Wheel spinning…" : phase === "RESULT" ? "Round complete" : "Waiting for next round"}
                  </p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 52, overflowY: "auto" }}>
                    {myBets.map((bet, i) => {
                      const odds = BET_PAYOUTS[bet.type] ?? 1;
                      const accent =
                        bet.type === "red" ? "#ef4444" :
                        bet.type === "black" ? "#9ca3af" :
                        bet.type === "straight" ? (numColor(bet.numbers?.[0] ?? 0) === "red" ? "#ef4444" : numColor(bet.numbers?.[0] ?? 0) === "green" ? "#22c55e" : "#9ca3af") :
                        ["dozen","column"].includes(bet.type) ? "#f59e0b" : "#60a5fa";
                      return (
                        <span key={i} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "3px 8px", borderRadius: 5,
                          background: "#060d09", border: `1px solid ${accent}44`,
                          fontSize: 10, color: "#e5e5e5",
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, display: "inline-block", flexShrink: 0 }} />
                          <span style={{ textTransform: "capitalize" }}>
                            {bet.type}{bet.numbers?.length > 0 && bet.numbers.length <= 2 ? ` ${bet.numbers.join(",")}` : ""}
                          </span>
                          <span style={{ fontWeight: 800, color: accent }}>{bet.amount.toLocaleString()}</span>
                          <span style={{ color: "#374151", fontSize: 8 }}>{odds}:1</span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* ── Table Info compact row ── */}
          {(rMin != null || rMax != null) && (
            <div style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "6px 14px",
              background: "#0a0507", border: "1px solid #1e1015", borderRadius: 10,
              fontSize: 11,
            }}>
              <span style={{ color: "#4b5563", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", fontSize: 9 }}>Table</span>
              {rWheel && <span style={{ color: "#9ca3af" }}>{rWheel === "american" ? "American" : "European"}</span>}
              {rMin != null && <span style={{ color: "#6b7280" }}>Min <span style={{ color: "#f5f5f5", fontWeight: 700 }}>{rMin.toLocaleString()}</span></span>}
              {rMax != null && <span style={{ color: "#6b7280" }}>Max <span style={{ color: "#f5f5f5", fontWeight: 700 }}>{rMax.toLocaleString()}</span></span>}
              {rMaxSpots != null && <span style={{ color: "#6b7280" }}>Spots <span style={{ color: "#f5f5f5", fontWeight: 700 }}>{rMaxSpots > 0 ? rMaxSpots : "∞"}</span></span>}
              <span style={{ marginLeft: "auto", color: "#4b5563" }}>35:1 straight · 2:1 dozen · 1:1 even</span>
            </div>
          )}
        </div>
      )}
      <PromoZone pageKey="roulette" />
    </div>
  );
}
