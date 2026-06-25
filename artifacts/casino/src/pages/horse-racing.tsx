import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { PromoZone } from "../components/PromoRegion";
import { useWs } from "../lib/WsContext";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { ChevronLeft, Trophy, Clock, Coins, Bell, CalendarDays } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { HorseSprite } from "../components/horses/HorseSprite";
import { SpriteRenderer } from "../components/horses/SpriteRenderer";
import { HorseEffectLayer, type EffectType } from "../components/horses/HorseEffectLayer";
import { TrackHorse, HorseRaceTrack } from "../components/HorseRaceTrack";
import { getSpriteConfig } from "../config/horseSprites";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const EST = "America/New_York";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Saddle-cloth colours in sync with HorseRaceTrack.tsx
const LANE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];
function laneColor(idx: number) { return LANE_COLORS[idx % LANE_COLORS.length]; }

const RARITY_MAP: Record<string, { bg: string; text: string; label: string }> = {
  common:    { bg: "rgba(113,113,122,0.18)", text: "#a1a1aa", label: "Common" },
  uncommon:  { bg: "rgba(34,197,94,0.15)",  text: "#4ade80", label: "Uncommon" },
  rare:      { bg: "rgba(59,130,246,0.18)", text: "#60a5fa", label: "Rare" },
  epic:      { bg: "rgba(168,85,247,0.2)",  text: "#c084fc", label: "Epic" },
  legendary: { bg: "rgba(245,158,11,0.2)",  text: "#fcd34d", label: "Legendary" },
};
function rarityInfo(r?: string) { return RARITY_MAP[r ?? "common"] ?? RARITY_MAP.common; }

interface Horse {
  id: number;
  name: string;
  odds: number;
  weight: number;
  variantId: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  ownerId: number | null;
  ownerName?: string | null;
  baseSpriteKey?: string | null;
  animFrames?: string | null;
  animFps?: number;
  effectType?: string;
  glowColor?: string | null;
  outlineColor?: string | null;
  tackColor?: string | null;
  rarity?: string;
  speed?: number;
  stamina?: number;
  acceleration?: number;
  luck?: number;
  totalBets: number;
  horsePool: number;
  totalPool: number;
  liveOdds: number | null; // parimutuel: estimated return per chip bet
}

interface RaceStatus {
  raceId: number;
  status: "idle" | "scheduled" | "betting" | "running" | "finished";
  startTime: number | null;
  startedAt: number | null;
  elapsedMs: number | null;
  winner: { id: number; name: string } | null;
  horses: Horse[];
  resultsUntil: number | null;
}

interface StableHorse {
  id: number;
  name: string;
  rarity: string;
  ownerId: number | null;
  ownerName: string | null;
  stats: { speed: number; stamina: number; acceleration: number; luck: number };
  history: { races: number; wins: number; losses: number; earnings: number };
  price: number | null;
  isForSale: boolean;
  // Cosmetics for avatar rendering
  baseSpriteKey: string | null;
  animFrames: string | null;
  animFps: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  effectType: string;
  glowColor: string | null;
  outlineColor: string | null;
  tackColor: string | null;
}

interface UpcomingRaceHorse {
  id: number; name: string; rarity: string;
  visualBase: string; visualPattern: string; visualFlair: string;
  baseSpriteKey: string | null; animFrames: string | null; animFps: number;
  effectType: string; glowColor: string | null; outlineColor: string | null; tackColor: string | null;
  ownerId: number | null; ownerName: string | null;
  speed: number; stamina: number; acceleration: number; luck: number;
  variantId: number; horsePool: number; totalPool: number; liveOdds: number | null; laneIndex: number;
}
interface UpcomingRace {
  queueId: string;
  raceId: number | null;
  isActive: boolean;
  scheduledTime: number;
  bettingOpensAt: number;
  bettingClosesAt: number;
  bettingStatus: "OPEN" | "CLOSING_SOON" | "CLOSED" | "NOT_YET_OPEN";
  timeUntilStart: number;
  bettingClosesIn: number;
  horses: UpcomingRaceHorse[];
  totalPool: number;
  priority: boolean;
  delayMs?: number;
  isDelayed?: boolean;
}

// EST helpers
function toEst(epochMs: number) { return toZonedTime(new Date(epochMs), EST); }
function fmtEstTime(epochMs: number) { return format(toEst(epochMs), "h:mm a") + " EST"; }
function fmtEstDay(epochMs: number) {
  const d = toEst(epochMs);
  const today = toEst(Date.now());
  const tomorrow = toEst(Date.now() + 86_400_000);
  if (format(d, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")) return "Today";
  if (format(d, "yyyy-MM-dd") === format(tomorrow, "yyyy-MM-dd")) return "Tomorrow";
  return format(d, "EEEE, MMM d"); // e.g. "Wednesday, Apr 9"
}
function fmtEstDateKey(epochMs: number) { return format(toEst(epochMs), "yyyy-MM-dd"); }
function fmtCountdown(secs: number) {
  if (secs <= 0) return "0:00";
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimeClean(totalSeconds: number): string {
  if (totalSeconds <= 120) return "Starting Soon";
  const weeks   = Math.floor(totalSeconds / 604800);
  const days    = Math.floor((totalSeconds % 604800) / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (weeks   > 0) parts.push(`${weeks}w`);
  if (days    > 0) parts.push(`${days}d`);
  if (hours   > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  return parts.length === 0 ? "<1m" : parts.slice(0, 2).join(" ");
}

/** Live countdown cell for the schedule board — isolated component so hooks work correctly */
function RaceCountdownCell({ scheduledTime, bettingClosesAt, bettingStatus, isDelayed, delayMs }: {
  scheduledTime: number;
  bettingClosesAt: number;
  bettingStatus: string;
  isDelayed?: boolean;
  delayMs?: number;
}) {
  const [startSecs, setStartSecs] = useState(Math.max(0, Math.ceil((scheduledTime - Date.now()) / 1000)));
  const [closeSecs, setCloseSecs] = useState(Math.max(0, Math.ceil((bettingClosesAt - Date.now()) / 1000)));
  useEffect(() => {
    const iv = setInterval(() => {
      setStartSecs(Math.max(0, Math.ceil((scheduledTime - Date.now()) / 1000)));
      setCloseSecs(Math.max(0, Math.ceil((bettingClosesAt - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(iv);
  }, [scheduledTime, bettingClosesAt]);

  const isBettingOpen  = bettingStatus === "OPEN" || bettingStatus === "CLOSING_SOON";
  const startLabel     = startSecs > 0 ? formatTimeClean(startSecs) : "Starting…";
  const isStartingSoon = startLabel === "Starting Soon";

  const delayMins = delayMs != null ? Math.round(delayMs / 60_000) : 0;

  return (
    <div style={{ lineHeight: 1.2 }}>
      {/* DELAYED badge — shown when race is running late */}
      {isDelayed && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          backgroundColor: "rgba(234,179,8,0.18)", border: "1px solid rgba(234,179,8,0.5)",
          borderRadius: 4, padding: "1px 5px", marginBottom: 3,
          fontSize: 9, fontWeight: 700, color: "#eab308", letterSpacing: "0.05em",
        }}>
          ⏳ DELAYED{delayMins > 1 ? ` ~${delayMins}m` : ""}
        </div>
      )}
      {isStartingSoon ? (
        <div style={{
          fontSize: 13, fontWeight: 900, fontFamily: "monospace",
          color: "#f97316",
          textShadow: "0 0 8px rgba(249,115,22,0.7)",
          animation: "pulse 1.2s ease-in-out infinite",
        }}>
          Starting Soon
        </div>
      ) : (
        <div style={{ fontSize: 13, fontWeight: 900, color: "#fff", fontFamily: "monospace" }}>
          Starts in {startLabel}
        </div>
      )}
      {isBettingOpen && closeSecs > 0 && (
        <div style={{ fontSize: 9, color: bettingStatus === "CLOSING_SOON" ? "#f97316" : "rgba(255,255,255,0.4)", marginTop: 2 }}>
          Betting closes in {fmtCountdown(closeSecs)}
        </div>
      )}
      {!isBettingOpen && (
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
          Betting closed
        </div>
      )}
    </div>
  );
}

function useCountdown(target: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!target) { setLeft(0); return; }
    const update = () => setLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    update();
    const iv = setInterval(update, 500);
    return () => clearInterval(iv);
  }, [target]);
  return left;
}

function fmt(secs: number) {
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = (secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ── Mini stat bar ─────────────────────────────────────────────────────────
function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 8, fontWeight: 800, color: "rgba(255,255,255,0.32)", width: 22, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, value)}%`, height: "100%", background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,0.35)", width: 20, textAlign: "right", fontFamily: "monospace", flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

// ── Horse avatar circle ───────────────────────────────────────────────────
function HorseAvatar({ horse, size = 56, laneIdx }: { horse: Horse; size?: number; laneIdx: number }) {
  const color = laneColor(laneIdx);
  const spriteSize = horse.baseSpriteKey ? Math.round(size * 1.4) : size - 8;
  return (
    <div style={{
      width: size, height: size,
      borderRadius: "50%",
      border: `2.5px solid ${color}`,
      overflow: "hidden",
      background: "#0f0f16",
      display: "flex", alignItems: "center", justifyContent: "flex-end",
      flexShrink: 0,
      boxShadow: `0 0 14px ${color}44`,
    }}>
      {horse.baseSpriteKey ? (
        <div style={{ transform: "translateY(12px)" }}>
          <SpriteRenderer
            spriteKey={horse.baseSpriteKey}
            animation="idle"
            size={spriteSize}
            fallbackBase={horse.visualBase ?? "brown"}
            fallbackPattern={horse.visualPattern ?? "none"}
            fallbackFlair={horse.visualFlair ?? "none"}
          />
        </div>
      ) : (
        <HorseSprite
          base={horse.visualBase ?? "brown"}
          pattern={horse.visualPattern ?? "none"}
          flair={horse.visualFlair ?? "none"}
          size={size - 8}
        />
      )}
    </div>
  );
}


// ── Status chip ──────────────────────────────────────────────────────────
function StatusChip({ status }: { status: string }) {
  const cfgs: Record<string, { text: string; color: string; pulse: boolean }> = {
    idle:      { text: "NO RACE",      color: "#52525b", pulse: false },
    scheduled: { text: "STARTING SOON",color: "#a855f7", pulse: true  },
    betting:   { text: "BETTING OPEN", color: "#22c55e", pulse: true  },
    running:   { text: "LIVE",         color: "#ef4444", pulse: true  },
    finished:  { text: "RACE OVER",    color: "#52525b", pulse: false },
  };
  const c = cfgs[status] ?? cfgs.idle;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      background: `${c.color}18`,
      border: `1px solid ${c.color}45`,
      borderRadius: 20, padding: "4px 12px",
      flexShrink: 0,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: "50%", background: c.color,
        boxShadow: c.pulse ? `0 0 6px ${c.color}` : undefined,
        animation: c.pulse ? "ping-slow 1.6s ease-in-out infinite" : undefined,
      }} />
      <span style={{ fontSize: 9, fontWeight: 900, color: c.color, letterSpacing: "0.14em", textTransform: "uppercase" }}>
        {c.text}
      </span>
    </div>
  );
}

// ── Horse selection card ─────────────────────────────────────────────────
function HorseCard({
  horse, laneIdx, isSelected, myBet, canBet, onSelect, playerId,
}: {
  horse: Horse; laneIdx: number; isSelected: boolean;
  myBet: number; canBet: boolean; onSelect: () => void; playerId: number | null;
}) {
  const color   = laneColor(laneIdx);
  const rar     = rarityInfo(horse.rarity);
  const hasBet  = myBet > 0;
  const liveOdds = horse.liveOdds;
  const estimatedPayout = (liveOdds && myBet > 0) ? Math.floor(myBet * liveOdds) : null;
  const isMyHorse = playerId != null && horse.ownerId === playerId;

  let borderColor = "rgba(255,255,255,0.07)";
  let bgColor     = "rgba(15,15,22,0.85)";
  if (isMyHorse) { borderColor = "#a855f780"; bgColor = "rgba(168,85,247,0.06)"; }
  if (isSelected) { borderColor = "#f59e0b"; bgColor = "rgba(245,158,11,0.06)"; }
  else if (hasBet) { borderColor = "#22c55e80"; bgColor = "rgba(34,197,94,0.05)"; }

  return (
    <button
      onClick={() => { if (!hasBet && canBet) onSelect(); }}
      disabled={hasBet || !canBet}
      style={{
        all: "unset",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        boxSizing: "border-box",
        borderRadius: 16,
        border: `1.5px solid ${borderColor}`,
        background: bgColor,
        overflow: "hidden",
        cursor: hasBet || !canBet ? "default" : "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: isSelected
          ? `0 0 24px rgba(245,158,11,0.15), 0 0 0 1px #f59e0b40`
          : isMyHorse
            ? `0 0 18px rgba(168,85,247,0.12), 0 0 0 1px #a855f730`
            : "none",
      }}
    >
      {/* Top bar: lane number + badges + rarity */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: `${color}14`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 22, height: 22, borderRadius: "50%",
            background: color,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 900, color: "#fff",
            border: "1.5px solid rgba(255,255,255,0.6)",
            boxShadow: `0 0 6px ${color}80`,
            flexShrink: 0,
          }}>
            {laneIdx + 1}
          </div>
          {isMyHorse && (
            <span style={{ fontSize: 8, fontWeight: 800, color: "#c084fc", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              ⭐ MY HORSE
            </span>
          )}
          {hasBet && (
            <span style={{ fontSize: 8, fontWeight: 800, color: "#22c55e", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              ✓ BET PLACED
            </span>
          )}
          {isSelected && !hasBet && (
            <span style={{ fontSize: 8, fontWeight: 800, color: "#f59e0b", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              SELECTED
            </span>
          )}
        </div>
        <div style={{
          fontSize: 8, fontWeight: 800,
          color: rar.text,
          background: rar.bg,
          padding: "2px 8px", borderRadius: 20,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>
          {rar.label}
        </div>
      </div>

      {/* Owner name row — full width, under rarity */}
      {horse.ownerName && (
        <div style={{
          padding: "5px 14px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          background: isMyHorse ? "rgba(232,121,249,0.07)" : "rgba(167,139,250,0.05)",
          display: "flex", flexDirection: "column", gap: 1,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: "#d4a849", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Owned by
          </span>
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: isMyHorse ? "#f0abfc" : "#c4b5fd",
            letterSpacing: "0.03em",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: isMyHorse ? "0 0 12px rgba(232,121,249,0.5)" : "0 0 10px rgba(167,139,250,0.4)",
          }}>
            {horse.ownerName}
          </span>
        </div>
      )}

      {/* Body: avatar + name + stats */}
      <div style={{ display: "flex", gap: 14, padding: "14px 14px 10px" }}>
        <HorseAvatar horse={horse} size={60} laneIdx={laneIdx} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div>
            <p style={{
              fontSize: 13, fontWeight: 900, textTransform: "uppercase",
              letterSpacing: "0.06em", color: "#fff",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              lineHeight: 1.2, margin: 0,
            }}>
              {horse.name}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
            <MiniStat label="SPD" value={horse.speed ?? 50}        color="#f59e0b" />
            <MiniStat label="STA" value={horse.stamina ?? 50}      color="#3b82f6" />
            <MiniStat label="LCK" value={horse.luck ?? 50}         color="#a855f7" />
          </div>
        </div>
      </div>

      {/* Bottom: live odds + action */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.2)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Odds</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace", lineHeight: 1 }}>
            {liveOdds != null ? `${liveOdds.toFixed(2)}×` : "—"}
          </span>
          {horse.horsePool > 0 && (
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
              {horse.horsePool.toLocaleString()} in pool
            </span>
          )}
        </div>
        {hasBet ? (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, color: "#22c55e", fontWeight: 700 }}>Bet: {myBet.toLocaleString()}</div>
            <div style={{ fontSize: 9, color: "#4ade80", fontWeight: 800 }}>
              {estimatedPayout != null ? `Est: ~${estimatedPayout.toLocaleString()}` : "Est: —"}
            </div>
          </div>
        ) : canBet ? (
          <span style={{
            fontSize: 9, fontWeight: 800,
            color: isSelected ? "#f59e0b" : "rgba(255,255,255,0.3)",
            letterSpacing: "0.12em", textTransform: "uppercase",
          }}>
            {isSelected ? "READY TO BET →" : "SELECT →"}
          </span>
        ) : (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            NOT OPEN
          </span>
        )}
      </div>
    </button>
  );
}

// ── Bet slip panel ────────────────────────────────────────────────────────
function BetSlipPanel({
  horse, laneIdx, betAmount, setBetAmount, displayChips, estimatedReturn, betting,
  betError, betConfirmed, myBets, onPlace, onCancel,
}: {
  horse: Horse | null; laneIdx: number; betAmount: number;
  setBetAmount: (v: number | ((prev: number) => number)) => void;
  displayChips: number; estimatedReturn: number | null; betting: boolean;
  betError: string | null; betConfirmed: string | null;
  myBets: Map<number, number>;
  onPlace: () => void; onCancel: () => void;
}) {
  const color = horse ? laneColor(laneIdx) : "rgba(255,255,255,0.15)";
  const totalMyBets = [...myBets.values()].reduce((s, v) => s + v, 0);

  // Quick-add amounts
  const addAmounts = [500, 1000, 5000, 10000].filter((v) => v <= displayChips);

  const btnBase: React.CSSProperties = {
    all: "unset" as any, cursor: "pointer", fontSize: 10, fontWeight: 800,
    padding: "5px 10px", borderRadius: 8, textAlign: "center",
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.6)",
    transition: "all 0.12s",
  };

  return (
    <div style={{
      background: "#0f0f18",
      border: "1.5px solid rgba(255,255,255,0.09)",
      borderRadius: 16,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 18px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(245,158,11,0.06)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 10, fontWeight: 900, color: "#f59e0b", letterSpacing: "0.18em", textTransform: "uppercase" }}>
          Bet Slip
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {totalMyBets > 0 && (
            <span style={{ fontSize: 9, fontWeight: 700, color: "#4ade80" }}>
              {totalMyBets.toLocaleString()} placed
            </span>
          )}
          {horse && (
            <button onClick={onCancel} style={{ all: "unset", cursor: "pointer", fontSize: 16, color: "rgba(255,255,255,0.3)", lineHeight: 1 }}>✕</button>
          )}
        </div>
      </div>

      {/* Inline confirmation */}
      {betConfirmed && (
        <div style={{ padding: "8px 18px", background: "rgba(74,222,128,0.1)", borderBottom: "1px solid rgba(74,222,128,0.2)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#4ade80" }}>✔ {betConfirmed}</span>
        </div>
      )}

      {/* Selected horse — or empty prompt */}
      {horse ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <HorseAvatar horse={horse} size={52} laneIdx={laneIdx} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: "#fff", margin: 0 }}>
              {horse.name}
            </p>
            {horse.ownerName && (
              <div style={{ margin: "3px 0 0", display: "flex", flexDirection: "column", gap: 0 }}>
                <span style={{ fontSize: 8, fontWeight: 800, color: "#d4a849", letterSpacing: "0.14em", textTransform: "uppercase" }}>Owned by</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#c084fc" }}>{horse.ownerName} · 10% cut</span>
              </div>
            )}
            <p style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b", margin: "3px 0 0", fontFamily: "monospace" }}>
              {horse.liveOdds != null ? `${horse.liveOdds.toFixed(2)}× (live)` : "No bets yet"}
            </p>
          </div>
          <div style={{ width: 26, height: 26, borderRadius: "50%", background: color, border: "2px solid rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: "#fff", flexShrink: 0 }}>
            {laneIdx + 1}
          </div>
        </div>
      ) : (
        <div style={{ padding: "20px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "1.5px dashed rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🏇</div>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>
            Select a horse to place your bet
          </p>
        </div>
      )}

      {/* Balance */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Balance</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Coins style={{ width: 13, height: 13, color: "#f59e0b" }} />
          <span style={{ fontSize: 13, fontWeight: 800, color: "#fff", fontFamily: "monospace" }}>{displayChips.toLocaleString()}</span>
        </div>
      </div>

      {/* Bet amount — direct input + quick-add buttons */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Bet Amount</div>
        {/* Number input */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <Coins style={{ width: 16, height: 16, color: "#f59e0b", flexShrink: 0 }} />
          <input
            type="number"
            min={10}
            step={100}
            value={betAmount}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 0;
              setBetAmount(Math.max(0, Math.min(displayChips, v)));
            }}
            style={{
              flex: 1, background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8,
              padding: "8px 12px", color: "#fff", fontSize: 18, fontWeight: 900,
              fontFamily: "monospace", outline: "none", width: "100%", boxSizing: "border-box",
            }}
          />
        </div>
        {/* Quick-add buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {addAmounts.map((v) => (
            <button key={v} onClick={() => setBetAmount((cur) => Math.min(displayChips, cur + v))} style={btnBase}>
              +{v >= 1000 ? `${v / 1000}K` : v}
            </button>
          ))}
          <button
            onClick={() => setBetAmount(displayChips)}
            style={{ ...btnBase, color: "#f59e0b", borderColor: "rgba(245,158,11,0.35)", background: "rgba(245,158,11,0.08)" }}
          >
            MAX
          </button>
          {betAmount > 0 && (
            <button onClick={() => setBetAmount(0)} style={{ ...btnBase, color: "rgba(255,100,100,0.7)" }}>CLR</button>
          )}
        </div>
        {/* Inline error */}
        {betError && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#f87171", fontWeight: 600 }}>⚠ {betError}</div>
        )}
      </div>

      {/* Live bet summary */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ flex: 1, padding: "10px 18px", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>This Bet</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#fff", fontFamily: "monospace" }}>{betAmount.toLocaleString()}</div>
        </div>
        <div style={{ flex: 1, padding: "10px 18px", background: "rgba(245,158,11,0.04)" }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 2 }}>Est. Win</div>
          <div style={{ fontSize: 14, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
            {estimatedReturn != null ? `~${estimatedReturn.toLocaleString()}` : "—"}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          onClick={onPlace}
          disabled={!horse || betting || betAmount < 10 || betAmount > displayChips}
          style={{
            all: "unset",
            cursor: !horse || betting || betAmount < 10 || betAmount > displayChips ? "not-allowed" : "pointer",
            width: "100%", boxSizing: "border-box",
            padding: "13px 0",
            background: !horse || betting || betAmount < 10 || betAmount > displayChips
              ? "rgba(255,255,255,0.06)"
              : "linear-gradient(135deg, #f59e0b, #d97706)",
            borderRadius: 12,
            fontSize: 12, fontWeight: 900, textAlign: "center",
            color: !horse || betting || betAmount < 10 || betAmount > displayChips ? "rgba(255,255,255,0.3)" : "#000",
            letterSpacing: "0.15em", textTransform: "uppercase",
            transition: "opacity 0.15s",
            opacity: betting ? 0.6 : 1,
          }}
        >
          {betting ? "Placing Bet…" : !horse ? "Select a Horse" : "Place Bet"}
        </button>
        {horse && (
          <button
            onClick={onCancel}
            style={{
              all: "unset", cursor: "pointer",
              width: "100%", boxSizing: "border-box",
              padding: "10px 0",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              fontSize: 11, fontWeight: 700, textAlign: "center",
              color: "rgba(255,255,255,0.35)",
              letterSpacing: "0.1em", textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function HorseRacing() {
  const [, setLocation]   = useLocation();
  const { sessionToken, playerId } = useStore();
  const [race, setRace]   = useState<RaceStatus | null>(null);
  const [horsePositions, setHorsePositions] = useState<Record<number, number>>({});
  const [selectedHorseId, setSelectedHorseId] = useState<number | null>(null);
  const [betAmount, setBetAmount]   = useState(100);
  const [betting, setBetting]       = useState(false);
  const [betError, setBetError]     = useState<string | null>(null);
  const [betConfirmed, setBetConfirmed] = useState<string | null>(null);
  const [myBets, setMyBets]         = useState<Map<number, number>>(new Map());
  const [lastResult, setLastResult] = useState<{
    winnerName: string;
    myBetHorseName: string | null;
    myBet: number;
    payout: number | null;
    won: boolean;
  } | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [localChips, setLocalChips] = useState<number | null>(null);
  const [viewMode, setViewMode]     = useState<"race" | "stables" | "upcoming">("race");
  const [stables, setStables]       = useState<StableHorse[] | null>(null);
  const [stablesLoading, setStablesLoading] = useState(false);
  const [stablesError, setStablesError] = useState(false);
  const [stablesSort, setStablesSort] = useState<"wins" | "earnings" | "races">("wins");
  const [stablesFilter, setStablesFilter] = useState<"all" | "mine">("all");
  const [stablesPage, setStablesPage] = useState(0);
  const [flippedStable, setFlippedStable] = useState<number | null>(null);
  // Upcoming races board
  const [upcomingRaces, setUpcomingRaces] = useState<UpcomingRace[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  // Per-race advance betting UI state: { [queueId]: { selectedHorseId, amount, placing, error, confirmed } }
  const [advanceBetState, setAdvanceBetState] = useState<Record<string, {
    open: boolean; selectedHorseId: number | null; amount: number;
    placing: boolean; error: string | null; confirmed: string | null;
  }>>({});

  const { chips: socketChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const { subscribe }  = useWs();
  const countdown      = useCountdown(race?.startTime ?? null);
  const resetCountdown = useCountdown(race?.resultsUntil ?? null);
  const preloadedRef   = useRef<Set<string>>(new Set());

  usePasswordGuard("horseRacing");
  useEffect(() => { if (!isGameUnlocked("horseRacing")) setLocation("/lobby"); }, []);

  const loadStables = useCallback(() => {
    setStablesLoading(true);
    setStablesError(false);
    const baseUrl = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${baseUrl}/api/horses`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setStables(data as StableHorse[]);
        else setStablesError(true);
        setStablesLoading(false);
      })
      .catch(() => { setStablesError(true); setStablesLoading(false); });
  }, []);

  useEffect(() => {
    if (viewMode === "stables") loadStables();
  }, [viewMode, loadStables]);

  const loadUpcoming = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/horse/races/upcoming`, {
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setUpcomingRaces(data.races ?? []);
      }
    } catch {}
  }, [sessionToken]);

  useEffect(() => {
    loadUpcoming();
    const iv = setInterval(loadUpcoming, 5000);
    return () => clearInterval(iv);
  }, [loadUpcoming]);

  async function placeAdvanceBet(queueId: string, isActive: boolean) {
    const bs = advanceBetState[queueId];
    if (!bs?.selectedHorseId || !sessionToken) return;
    const amount = bs.amount;
    if (amount < 10) {
      setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], error: "Minimum bet is 10 chips" } }));
      return;
    }
    if (amount > (displayChips)) {
      setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], error: "Insufficient chips" } }));
      return;
    }
    setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], placing: true, error: null } }));
    try {
      const endpoint = isActive ? "/api/horse/bet" : "/api/horse/queue-bet";
      const body = isActive
        ? { horseId: bs.selectedHorseId, amount }
        : { queueId, horseId: bs.selectedHorseId, amount };
      const res = await fetch(`${BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], placing: false, error: data.error || "Failed" } }));
        return;
      }
      setLocalChips(data.newChips);
      const race = upcomingRaces.find(r => r.queueId === queueId);
      const horseName = race?.horses.find(h => h.id === bs.selectedHorseId)?.name ?? "horse";
      setAdvanceBetState(p => ({
        ...p,
        [queueId]: { ...p[queueId], placing: false, confirmed: `Bet placed: ${amount.toLocaleString()} chips on ${horseName}`, error: null },
      }));
      setTimeout(() => setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], confirmed: null, open: false } })), 3000);
      loadUpcoming();
    } catch (e: any) {
      setAdvanceBetState(p => ({ ...p, [queueId]: { ...p[queueId], placing: false, error: e.message || "Failed" } }));
    }
  }

  useEffect(() => {
    if (!race?.horses) return;
    for (const h of race.horses) {
      const key = (h as any).baseSpriteKey;
      if (!key || preloadedRef.current.has(key)) continue;
      const cfg = getSpriteConfig(key);
      if (!cfg) continue;
      preloadedRef.current.add(key);
      const img = new Image();
      img.src = cfg.path;
    }
  }, [race?.horses]);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/horse/status`, {
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        cache: "no-store",
      });
      if (res.ok) {
        const data: RaceStatus = await res.json();
        setRace((prev) => {
          if (prev && prev.raceId !== data.raceId && prev.status !== "idle") {
            setMyBets(new Map());
            setSelectedHorseId(null);
            setHorsePositions({});
          }
          return data;
        });
        if ((data as any).positions) setHorsePositions((data as any).positions);
      }
    } catch {}
  }, [sessionToken]);

  useEffect(() => {
    if (!playerId || !sessionToken) { setLocation("/lobby"); return; }
  }, [playerId, sessionToken]);

  useEffect(() => {
    loadStatus();
    const iv = setInterval(loadStatus, 3000);
    return () => clearInterval(iv);
  }, [loadStatus]);

  useEffect(() => {
    const unsub = subscribe("horse_race_update", (msg) => {
      const newRace: RaceStatus = msg.race;
      setRace((prev) => {
        if (prev && prev.raceId !== newRace.raceId) {
          setMyBets(new Map());
          setSelectedHorseId(null);
          setHorsePositions({});
          setLastResult(null); // clear result when a brand-new race starts
          setBetConfirmed(null);
        }
        if (newRace.status === "finished" && newRace.winner && prev?.status === "running") {
          const bets: Map<number, number> = (window as any)._myBets ?? new Map();
          const totalMyBet = [...bets.values()].reduce((s, v) => s + v, 0);
          const myBetOnWinner = bets.get(newRace.winner.id) ?? 0;
          const won = myBetOnWinner > 0;
          // Approximate payout from live odds at finish
          const winnerOdds = newRace.horses.find((h: any) => h.id === newRace.winner!.id)?.liveOdds ?? null;
          const payout = won && winnerOdds ? Math.floor(myBetOnWinner * winnerOdds) : null;
          const myBetHorse = [...bets.entries()].reduce<[number, number] | null>(
            (best, [id, amt]) => (!best || amt > best[1] ? [id, amt] : best), null,
          );
          const myBetHorseName = myBetHorse
            ? (newRace.horses.find((h: any) => h.id === myBetHorse[0])?.name ?? null)
            : null;
          setLastResult({ winnerName: newRace.winner.name, myBetHorseName, myBet: totalMyBet, payout, won });
        }
        return newRace;
      });
      if (msg.race.positions) setHorsePositions(msg.race.positions);
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const unsub = subscribe("race_update", (msg: { horses: { id: number; position: number }[] }) => {
      setHorsePositions((prev) => {
        const next = { ...prev };
        for (const h of msg.horses) next[h.id] = h.position;
        return next;
      });
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => {
    const unsub = subscribe("horse_announcement", (msg) => {
      setAnnouncement(msg.message);
      setTimeout(() => setAnnouncement(null), 4000);
    });
    return unsub;
  }, [subscribe]);

  useEffect(() => { (window as any)._myBets = myBets; }, [myBets]);

  async function placeBet() {
    if (!selectedHorseId || !sessionToken) return;
    setBetError(null);
    if (betAmount < 10) { setBetError("Minimum bet is 10 chips"); return; }
    if (betAmount > displayChips) { setBetError("Insufficient chips"); return; }
    setBetting(true);
    try {
      const res = await fetch(`${BASE}/api/horse/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ horseId: selectedHorseId, amount: betAmount }),
      });
      const data = await res.json();
      if (!res.ok) { setBetError(data.error || "Failed to place bet"); setBetting(false); return; }
      const horseName = race?.horses.find((h) => h.id === selectedHorseId)?.name ?? "horse";
      setMyBets((prev) => new Map(prev).set(selectedHorseId, (prev.get(selectedHorseId) ?? 0) + betAmount));
      setLocalChips(data.newChips);
      setBetConfirmed(`Bet placed: ${betAmount.toLocaleString()} chips on ${horseName}`);
      setSelectedHorseId(null);
      setTimeout(() => setBetConfirmed(null), 4000);
    } catch (e: any) { setBetError(e.message || "Failed to place bet"); }
    setBetting(false);
  }

  const displayChips    = socketChips ?? localChips ?? 0;
  const status          = race?.status ?? "idle";
  const totalPoolChips  = race?.horses[0]?.totalPool ?? 0;
  const canBet         = status === "betting";
  const selectedHorse    = race?.horses.find((h) => h.id === selectedHorseId) ?? null;
  const selectedIdx      = race?.horses.findIndex((h) => h.id === selectedHorseId) ?? -1;
  const estimatedReturn  = (selectedHorse?.liveOdds != null)
    ? Math.floor(betAmount * selectedHorse.liveOdds)
    : null;
  const hasHorses      = (race?.horses.length ?? 0) > 0;
  const showTrack      = hasHorses && (status === "betting" || status === "running" || status === "finished");

  const trackHorses: TrackHorse[] = (race?.horses ?? []).map((h) => ({
    id: h.id, name: h.name, liveOdds: h.liveOdds ?? null, variantId: h.variantId ?? 1,
    visualBase: h.visualBase ?? "brown",
    visualPattern: h.visualPattern ?? "none",
    visualFlair: h.visualFlair ?? "none",
    ownerId: h.ownerId ?? null,
    baseSpriteKey: h.baseSpriteKey ?? null,
    animFrames: h.animFrames ?? null,
    animFps: h.animFps ?? 12,
    effectType: h.effectType ?? "none",
    glowColor: h.glowColor ?? null,
    outlineColor: h.outlineColor ?? null,
    tackColor: h.tackColor ?? null,
    rarity: h.rarity ?? "common",
    speed: h.speed ?? 50,
    stamina: h.stamina ?? 50,
    acceleration: h.acceleration ?? 50,
    luck: h.luck ?? 50,
  }));

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#07070c", color: "#fff" }}>

      {/* ── Toasts ── */}
      <div style={{
        position: "fixed", top: 60, left: 0, right: 0, zIndex: 50,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 8, paddingTop: 8, pointerEvents: "none",
      }}>
        <AnimatePresence>
          {announcement && (
            <motion.div
              key="ann"
              initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 20px", borderRadius: 20,
                background: "rgba(10,10,20,0.97)", backdropFilter: "blur(12px)",
                border: "1px solid rgba(168,85,247,0.3)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                pointerEvents: "auto",
              }}
            >
              <Bell style={{ width: 14, height: 14, color: "#a855f7", flexShrink: 0 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "#e4e4e7", margin: 0 }}>{announcement}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {lastResult && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              style={{
                padding: "12px 24px", borderRadius: 20, textAlign: "center",
                background: lastResult.won ? "rgba(5,30,15,0.97)" : "rgba(10,10,20,0.97)",
                border: `1px solid ${lastResult.won ? "rgba(34,197,94,0.4)" : "rgba(255,255,255,0.1)"}`,
                backdropFilter: "blur(12px)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                pointerEvents: "auto",
              }}
            >
              <p style={{ fontSize: 15, fontWeight: 900, color: lastResult.won ? "#4ade80" : "#fff", margin: 0 }}>
                {lastResult.won ? "🏆 You Won!" : "Race Finished"}
              </p>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: "4px 0 0" }}>
                Winner: <strong style={{ color: "#fff" }}>{lastResult.horseName}</strong>
              </p>
              {lastResult.won && (
                <p style={{ fontSize: 11, color: "#86efac", margin: "4px 0 0" }}>
                  Parimutuel payout sent to your balance
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Sticky Header ── */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "rgba(7,7,12,0.96)", backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{
          maxWidth: 1280, margin: "0 auto", padding: "0 20px",
          height: 60, display: "flex", alignItems: "center", gap: 14,
        }}>
          <button
            onClick={() => setLocation("/lobby")}
            style={{
              all: "unset", cursor: "pointer",
              width: 34, height: 34, borderRadius: "50%",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.5)", flexShrink: 0,
              transition: "background 0.15s",
            }}
          >
            <ChevronLeft style={{ width: 17, height: 17 }} />
          </button>

          <div style={{ lineHeight: 1, flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 900, letterSpacing: "0.22em", color: "#f59e0b", textTransform: "uppercase" }}>
              INSIDE TRACK
            </div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", letterSpacing: "0.16em", textTransform: "uppercase", marginTop: 2 }}>
              Back Alley Bets · Horse Racing
            </div>
          </div>

          <div style={{ width: 1, height: 26, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

          <StatusChip status={status} />

          {race && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace", fontWeight: 700, flexShrink: 0 }}>
              RACE #{race.raceId}
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* View toggle */}
          <div style={{
            display: "flex", alignItems: "center", gap: 2,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: 3, flexShrink: 0,
          }}>
            {(["race", "upcoming", "stables"] as const).map((mode) => (
              <button key={mode} onClick={() => setViewMode(mode)} style={{
                padding: "5px 12px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 900,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                background: viewMode === mode ? "rgba(245,158,11,0.18)" : "transparent",
                color: viewMode === mode ? "#f59e0b" : "rgba(255,255,255,0.35)",
                transition: "all 0.15s",
                position: "relative",
              }}>
                {mode === "race" ? "🏇 Race" : mode === "upcoming" ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <CalendarDays style={{ width: 11, height: 11, display: "inline" }} />
                    Schedule
                    {upcomingRaces.length > 0 && (
                      <span style={{
                        background: "#f59e0b", color: "#07070c", borderRadius: 6,
                        fontSize: 9, fontWeight: 900, padding: "0px 4px", lineHeight: "14px",
                        minWidth: 14, display: "inline-block", textAlign: "center",
                      }}>{upcomingRaces.length}</span>
                    )}
                  </span>
                ) : "🐴 Stables"}
              </button>
            ))}
          </div>

          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(245,158,11,0.07)",
            border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: 10, padding: "7px 14px", flexShrink: 0,
          }}>
            <Coins style={{ width: 14, height: 14, color: "#f59e0b" }} />
            <span style={{ fontSize: 14, fontWeight: 900, fontFamily: "monospace", color: "#fff", letterSpacing: "-0.01em" }}>
              {displayChips.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* ── Main ── */}
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 20px 40px" }}>

        {/* ── STABLES VIEW ── */}
        {viewMode === "stables" && (() => {
          const rarityColor: Record<string, string> = {
            legendary: "#a855f7", epic: "#f59e0b", rare: "#3b82f6", uncommon: "#22c55e", common: "#6b7280",
          };
          const myHorseIds = new Set((stables ?? []).filter((h) => h.ownerId === playerId).map((h) => h.id));
          const racingNowIds = new Set(
            (race?.status === "running" || race?.status === "betting" || race?.status === "scheduled")
              ? (race?.horses ?? []).map((h) => h.id)
              : []
          );
          const filtered = stablesFilter === "mine"
            ? (stables ?? []).filter((h) => h.ownerId === playerId)
            : (stables ?? []);
          const RARITY_ORDER: Record<string, number> = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
          const sorted = [...filtered].sort((a, b) => {
            const aOwned = a.ownerId === playerId ? 0 : 1;
            const bOwned = b.ownerId === playerId ? 0 : 1;
            if (aOwned !== bOwned) return aOwned - bOwned;
            const aRar = RARITY_ORDER[a.rarity] ?? 0;
            const bRar = RARITY_ORDER[b.rarity] ?? 0;
            if (aRar !== bRar) return bRar - aRar;
            if (stablesSort === "wins")     return b.history.wins - a.history.wins;
            if (stablesSort === "earnings") return b.history.earnings - a.history.earnings;
            return b.history.races - a.history.races;
          });

          const topEarnerId = filtered.length > 0 ? [...filtered].sort((a,b) => b.history.earnings - a.history.earnings)[0]?.id : -1;
          const mostWinsId  = filtered.length > 0 ? [...filtered].sort((a,b) => b.history.wins - a.history.wins)[0]?.id : -1;

          const myRacingHorses = sorted.filter((h) => h.ownerId === playerId && racingNowIds.has(h.id));

          const STABLES_PER_PAGE = 25;
          const totalStablePages = Math.ceil(sorted.length / STABLES_PER_PAGE);
          const pageHorses = sorted.slice(stablesPage * STABLES_PER_PAGE, (stablesPage + 1) * STABLES_PER_PAGE);

          return (
            <div>
              {/* My horse is racing — alert banner */}
              {myRacingHorses.length > 0 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 12, padding: "12px 18px", marginBottom: 16,
                  background: "linear-gradient(90deg, rgba(249,115,22,0.12) 0%, rgba(168,85,247,0.08) 100%)",
                  border: "1.5px solid rgba(249,115,22,0.45)",
                  borderRadius: 14,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 22 }}>🏇</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "#f97316", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        Your horse{myRacingHorses.length > 1 ? "s are" : " is"} racing right now!
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                        {myRacingHorses.map((h) => h.name).join(", ")} — earning you 10% of the pool if {myRacingHorses.length > 1 ? "they win" : "it wins"}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setViewMode("race")}
                    style={{
                      all: "unset", cursor: "pointer",
                      fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em",
                      color: "#f97316",
                      background: "rgba(249,115,22,0.15)",
                      border: "1px solid rgba(249,115,22,0.45)",
                      padding: "6px 14px", borderRadius: 8,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Watch Race →
                  </button>
                </div>
              )}

              {/* Controls row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>

                {/* My Horses / All toggle */}
                {myHorseIds.size > 0 && (
                  <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 2, flexShrink: 0 }}>
                    {(["all", "mine"] as const).map((f) => (
                      <button key={f} onClick={() => { setStablesFilter(f); setStablesPage(0); }} style={{
                        padding: "4px 11px", borderRadius: 6, border: "none", cursor: "pointer",
                        fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
                        background: stablesFilter === f ? "rgba(168,85,247,0.2)" : "transparent",
                        color: stablesFilter === f ? "#c084fc" : "rgba(255,255,255,0.3)",
                        transition: "all 0.15s",
                      }}>
                        {f === "all" ? `All (${(stables ?? []).length})` : `⭐ Mine (${myHorseIds.size})`}
                      </button>
                    ))}
                  </div>
                )}

                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Sort</span>
                {(["wins", "earnings", "races"] as const).map((s) => (
                  <button key={s} onClick={() => { setStablesSort(s); setStablesPage(0); }} style={{
                    padding: "5px 12px", borderRadius: 7, border: "1px solid",
                    borderColor: stablesSort === s ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)",
                    background: stablesSort === s ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.03)",
                    color: stablesSort === s ? "#f59e0b" : "rgba(255,255,255,0.4)",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", cursor: "pointer",
                  }}>
                    {s === "wins" ? "Most Wins" : s === "earnings" ? "Top Earner" : "Most Races"}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={loadStables} disabled={stablesLoading} style={{
                  padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.35)",
                  fontSize: 10, fontWeight: 700, cursor: stablesLoading ? "default" : "pointer",
                  opacity: stablesLoading ? 0.5 : 1,
                }}>↻ Refresh</button>
                {stables && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{sorted.length}/{stables.length} horses</span>}
              </div>

              {stablesLoading && (
                <div style={{ textAlign: "center", padding: "60px 0", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                  Loading stables...
                </div>
              )}

              {!stablesLoading && stablesError && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
                  <div style={{ fontSize: 13, color: "rgba(255,100,100,0.7)", letterSpacing: "0.05em", marginBottom: 16 }}>Failed to load stables.</div>
                  <button onClick={loadStables} style={{ padding: "7px 18px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.08em" }}>
                    ↻ Retry
                  </button>
                </div>
              )}

              {!stablesLoading && !stablesError && sorted.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 0" }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>{stablesFilter === "mine" ? "⭐" : "🐴"}</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em" }}>
                    {stablesFilter === "mine" ? "You don't own any horses yet." : "No horses in the stables yet."}
                  </div>
                </div>
              )}

              {!stablesLoading && !stablesError && sorted.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 16 }}>
                  {pageHorses.map((h) => {
                    const rc          = rarityColor[h.rarity] ?? rarityColor.common;
                    const isTopEarner = h.id === topEarnerId && h.history.earnings > 0;
                    const isMostWins  = h.id === mostWinsId  && h.history.wins > 0;
                    const isMyHorse   = h.ownerId === playerId;
                    const isRacingNow = racingNowIds.has(h.id);
                    const winRate     = h.history.races > 0 ? Math.round((h.history.wins / h.history.races) * 100) : 0;
                    const isFlipped   = flippedStable === h.id;
                    const flair       = h.visualFlair ?? "none";
                    const flairGlowMap: Record<string,string> = {
                      glow:     "0 0 20px 8px rgba(255,255,255,0.7)",
                      smoke:    "0 0 16px 6px rgba(130,130,150,0.7)",
                      fire:     "0 0 22px 9px rgba(255,70,0,0.9)",
                      neon:     "0 0 22px 9px rgba(0,255,200,0.9)",
                      electric: "0 0 22px 9px rgba(80,120,255,0.9)",
                      gold:     "0 0 22px 9px rgba(255,210,0,0.95)",
                    };
                    const flairGlow   = flair !== "none" ? (flairGlowMap[flair] ?? "none") : "none";
                    const circleGlow  = [flairGlow !== "none" ? flairGlow : null, `0 0 18px ${rc}50`].filter(Boolean).join(", ");
                    const cosmetics   = [
                      { label: "Coat",    value: h.visualBase, swatch: null as string | null },
                      h.visualPattern !== "none" ? { label: "Pattern", value: h.visualPattern, swatch: null } : null,
                      flair !== "none"            ? { label: "Flair",   value: flair,           swatch: null } : null,
                      h.effectType && h.effectType !== "none" ? { label: "Effect", value: h.effectType, swatch: null } : null,
                      h.tackColor ? { label: "Tack", value: "", swatch: h.tackColor } : null,
                    ].filter(Boolean) as { label: string; value: string; swatch: string | null }[];
                    const portraitSpriteSize = Math.round(120 * 1.4);

                    return (
                      <div
                        key={h.id}
                        style={{ perspective: 900, height: 360, cursor: "pointer" }}
                        onClick={() => setFlippedStable(isFlipped ? null : h.id)}
                      >
                        <div style={{
                          position: "relative", width: "100%", height: "100%",
                          transformStyle: "preserve-3d",
                          transition: "transform 0.55s cubic-bezier(0.4,0,0.2,1)",
                          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                        }}>

                          {/* ── FRONT ── */}
                          <div style={{
                            position: "absolute", inset: 0,
                            backfaceVisibility: "hidden",
                            background: "#0c0c14",
                            border: isRacingNow
                              ? "1.5px solid rgba(249,115,22,0.65)"
                              : isMyHorse
                                ? "1.5px solid rgba(168,85,247,0.55)"
                                : `1.5px solid ${rc}35`,
                            borderRadius: 14, overflow: "hidden",
                            display: "flex", flexDirection: "column",
                            boxShadow: isRacingNow
                              ? "0 0 18px rgba(249,115,22,0.18)"
                              : isMyHorse
                                ? "0 0 18px rgba(168,85,247,0.18)"
                                : undefined,
                          }}>
                            <div style={{ height: 2, background: isRacingNow ? "#f97316" : isMyHorse ? "#a855f7" : rc, opacity: 0.85, flexShrink: 0 }} />

                            {/* Portrait */}
                            <div style={{
                              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              padding: "20px 16px 10px",
                              background: `radial-gradient(ellipse at 50% 80%, ${isMyHorse ? "rgba(168,85,247,0.12)" : `${rc}14`} 0%, transparent 70%)`,
                              position: "relative",
                            }}>
                              <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
                                {isMyHorse   && <span style={{ fontSize: 8, fontWeight: 900, color: "#c084fc", background: "rgba(168,85,247,0.18)", border: "1px solid rgba(168,85,247,0.45)", borderRadius: 4, padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.06em" }}>⭐ My Horse</span>}
                                {isRacingNow && <span style={{ fontSize: 8, fontWeight: 900, color: "#f97316", background: "rgba(249,115,22,0.18)", border: "1px solid rgba(249,115,22,0.5)", borderRadius: 4, padding: "2px 5px", textTransform: "uppercase", letterSpacing: "0.06em" }}>🏇 Racing</span>}
                                {isTopEarner && <span style={{ fontSize: 8, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: 4, padding: "2px 5px", textTransform: "uppercase" }}>💰 Earner</span>}
                                {isMostWins  && <span style={{ fontSize: 8, fontWeight: 800, color: "#4ade80", background: "rgba(74,222,128,0.12)",  border: "1px solid rgba(74,222,128,0.3)",  borderRadius: 4, padding: "2px 5px", textTransform: "uppercase" }}>🏆 Wins</span>}
                              </div>

                              {/* Head portrait circle */}
                              <div style={{
                                width: 120, height: 120, borderRadius: "50%",
                                border: `2.5px solid ${rc}`,
                                overflow: "hidden", background: "#0f0f16",
                                display: "flex", alignItems: "center", justifyContent: "flex-end",
                                flexShrink: 0, boxShadow: circleGlow,
                              }}>
                                {h.baseSpriteKey ? (
                                  <div style={{ transform: "translateY(28px)" }}>
                                    <SpriteRenderer spriteKey={h.baseSpriteKey} animation="idle" size={portraitSpriteSize}
                                      fallbackBase={h.visualBase} fallbackPattern={h.visualPattern} fallbackFlair={flair}
                                      tackColor={h.tackColor} />
                                  </div>
                                ) : (
                                  <HorseSprite base={h.visualBase} pattern={h.visualPattern} flair={flair} size={112} />
                                )}
                              </div>

                              {/* Name + rarity + owner */}
                              <div style={{ textAlign: "center", marginTop: 12 }}>
                                <div style={{ fontSize: 13, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h.name}</div>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
                                  <span style={{ fontSize: 8, fontWeight: 800, color: rc, background: `${rc}15`, border: `1px solid ${rc}30`, borderRadius: 4, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.1em" }}>{h.rarity}</span>
                                </div>
                                {h.isForSale && h.price != null && h.price > 0 && (
                                  <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4, background: "linear-gradient(90deg, rgba(245,158,11,0.18), rgba(234,179,8,0.12))", border: "1px solid rgba(245,158,11,0.5)", borderRadius: 6, padding: "2px 8px" }}>
                                    <span style={{ fontSize: 10, color: "#fcd34d", fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.04em" }}>
                                      ${h.price.toLocaleString()}
                                    </span>
                                    <span style={{ fontSize: 7, color: "rgba(252,211,77,0.6)", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em" }}>For Sale</span>
                                  </div>
                                )}
                                {h.ownerName && (
                                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
                                    <span style={{ fontSize: 8, fontWeight: 800, color: "#d4a849", letterSpacing: "0.14em", textTransform: "uppercase" }}>Owned by</span>
                                    <span style={{
                                      fontSize: 13, fontWeight: 800,
                                      color: isMyHorse ? "#f0abfc" : "#c4b5fd",
                                      letterSpacing: "0.03em",
                                      textShadow: isMyHorse ? "0 0 14px rgba(232,121,249,0.6)" : "0 0 10px rgba(167,139,250,0.4)",
                                    }}>{h.ownerName}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Record strip */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, borderTop: `1px solid ${rc}15`, padding: "10px 14px" }}>
                              {[
                                { label: "Races", value: h.history.races,   color: "rgba(255,255,255,0.5)" },
                                { label: "Wins",  value: h.history.wins,    color: "#4ade80" },
                                { label: "Loss",  value: h.history.losses,  color: "rgba(255,100,100,0.65)" },
                                { label: "Win%",  value: `${winRate}%`,     color: "#f59e0b" },
                              ].map((item) => (
                                <div key={item.label} style={{ textAlign: "center" }}>
                                  <div style={{ fontSize: 12, fontWeight: 900, color: item.color, fontFamily: "monospace" }}>{item.value}</div>
                                  <div style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 2 }}>{item.label}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{ textAlign: "center", paddingBottom: 9, fontSize: 8, color: "rgba(255,255,255,0.18)", letterSpacing: "0.08em" }}>TAP FOR DETAILS ▸</div>
                          </div>

                          {/* ── BACK ── */}
                          <div style={{
                            position: "absolute", inset: 0,
                            backfaceVisibility: "hidden",
                            transform: "rotateY(180deg)",
                            background: "#0c0c14",
                            border: isMyHorse ? "1.5px solid rgba(168,85,247,0.55)" : `1.5px solid ${rc}35`,
                            borderRadius: 14, overflow: "hidden",
                            display: "flex", flexDirection: "column",
                            boxShadow: isMyHorse ? "0 0 18px rgba(168,85,247,0.18)" : undefined,
                          }}>
                            <div style={{ height: 2, background: isMyHorse ? "#a855f7" : rc, opacity: 0.85, flexShrink: 0 }} />

                            {/* Full galloping horse with cosmetic effects */}
                            <div style={{
                              display: "flex", alignItems: "center", justifyContent: "center",
                              padding: "16px 0 8px",
                              background: `radial-gradient(ellipse at 50% 60%, ${rc}16 0%, transparent 70%)`,
                              flexShrink: 0,
                              overflow: "visible",
                            }}>
                              {h.baseSpriteKey ? (
                                <HorseEffectLayer
                                  effect={(h.effectType ?? "none") as EffectType}
                                  glowColor={h.glowColor}
                                  outlineColor={h.outlineColor}
                                  rarity={h.rarity}
                                  size={90}
                                  spriteKey={h.baseSpriteKey}
                                >
                                  <SpriteRenderer
                                    spriteKey={h.baseSpriteKey}
                                    animation="gallop"
                                    customFrames={h.animFrames ? JSON.parse(h.animFrames) : undefined}
                                    customFps={h.animFps}
                                    size={90}
                                    fallbackBase={h.visualBase}
                                    fallbackPattern={h.visualPattern}
                                    fallbackFlair={flair}
                                    tackColor={h.tackColor}
                                  />
                                </HorseEffectLayer>
                              ) : (
                                <HorseSprite base={h.visualBase} pattern={h.visualPattern} flair={flair} size={90} />
                              )}
                            </div>

                            {/* Name */}
                            <div style={{ textAlign: "center", padding: "0 14px 8px" }}>
                              <div style={{ fontSize: 12, fontWeight: 900, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h.name}</div>
                            </div>

                            {/* Cosmetics */}
                            <div style={{ padding: "0 14px 8px" }}>
                              <div style={{ fontSize: 8, fontWeight: 700, color: rc, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Cosmetics</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {cosmetics.map((c) => (
                                  <span key={c.label} style={{
                                    fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", gap: 4,
                                    background: `${rc}12`, border: `1px solid ${rc}30`,
                                    borderRadius: 4, padding: "2px 7px", color: "rgba(255,255,255,0.75)",
                                    textTransform: "capitalize",
                                  }}>
                                    <span style={{ color: rc, opacity: 0.75 }}>{c.label}:</span>
                                    {c.swatch ? (
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: c.swatch, border: "1px solid rgba(255,255,255,0.2)", flexShrink: 0, display: "inline-block" }} />
                                      </span>
                                    ) : (
                                      <span>{c.value}</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Stats */}
                            <div style={{ padding: "0 14px 6px", flex: 1 }}>
                              <div style={{ fontSize: 8, fontWeight: 700, color: rc, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Stats</div>
                              {(["speed", "stamina", "acceleration", "luck"] as const).map((stat) => {
                                const val = h.stats[stat];
                                const abbr = stat === "acceleration" ? "accel" : stat;
                                return (
                                  <div key={stat} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: 7, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", width: 32, flexShrink: 0 }}>{abbr}</span>
                                    <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.07)", borderRadius: 2, overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${val}%`, background: rc, borderRadius: 2, opacity: 0.75 }} />
                                    </div>
                                    <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", width: 22, textAlign: "right", flexShrink: 0 }}>{val}</span>
                                  </div>
                                );
                              })}
                            </div>

                            {/* Earnings */}
                            {h.history.earnings > 0 && (
                              <div style={{ margin: "0 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.14)", borderRadius: 7 }}>
                                <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(245,158,11,0.55)", textTransform: "uppercase" }}>Earnings</span>
                                <span style={{ fontSize: 11, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>+{h.history.earnings.toLocaleString()}</span>
                              </div>
                            )}

                            <div style={{ textAlign: "center", paddingBottom: 9, fontSize: 8, color: "rgba(255,255,255,0.18)", letterSpacing: "0.08em" }}>◂ TAP TO GO BACK</div>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination controls */}
              {!stablesLoading && !stablesError && totalStablePages > 1 && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, marginTop: 24, paddingTop: 16,
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                }}>
                  <button
                    onClick={() => setStablesPage(0)}
                    disabled={stablesPage === 0}
                    style={{
                      padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)", color: stablesPage === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
                      fontSize: 11, fontWeight: 700, cursor: stablesPage === 0 ? "default" : "pointer",
                    }}
                  >«</button>
                  <button
                    onClick={() => setStablesPage((p) => Math.max(0, p - 1))}
                    disabled={stablesPage === 0}
                    style={{
                      padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)", color: stablesPage === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
                      fontSize: 11, fontWeight: 700, cursor: stablesPage === 0 ? "default" : "pointer",
                    }}
                  >‹ Prev</button>

                  <div style={{ display: "flex", gap: 4 }}>
                    {Array.from({ length: totalStablePages }, (_, i) => {
                      const near = Math.abs(i - stablesPage) <= 2 || i === 0 || i === totalStablePages - 1;
                      const showEllipsis = !near && (i === 1 || i === totalStablePages - 2);
                      if (showEllipsis) return <span key={i} style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, padding: "5px 2px" }}>…</span>;
                      if (!near) return null;
                      return (
                        <button
                          key={i}
                          onClick={() => setStablesPage(i)}
                          style={{
                            width: 30, height: 30, borderRadius: 7, border: "1px solid",
                            borderColor: stablesPage === i ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.08)",
                            background: stablesPage === i ? "rgba(168,85,247,0.18)" : "rgba(255,255,255,0.03)",
                            color: stablesPage === i ? "#c084fc" : "rgba(255,255,255,0.4)",
                            fontSize: 11, fontWeight: 800, cursor: "pointer",
                          }}
                        >{i + 1}</button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setStablesPage((p) => Math.min(totalStablePages - 1, p + 1))}
                    disabled={stablesPage === totalStablePages - 1}
                    style={{
                      padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)", color: stablesPage === totalStablePages - 1 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
                      fontSize: 11, fontWeight: 700, cursor: stablesPage === totalStablePages - 1 ? "default" : "pointer",
                    }}
                  >Next ›</button>
                  <button
                    onClick={() => setStablesPage(totalStablePages - 1)}
                    disabled={stablesPage === totalStablePages - 1}
                    style={{
                      padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.04)", color: stablesPage === totalStablePages - 1 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
                      fontSize: 11, fontWeight: 700, cursor: stablesPage === totalStablePages - 1 ? "default" : "pointer",
                    }}
                  >»</button>

                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", marginLeft: 4 }}>
                    {stablesPage * STABLES_PER_PAGE + 1}–{Math.min((stablesPage + 1) * STABLES_PER_PAGE, sorted.length)} of {sorted.length}
                  </span>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── UPCOMING RACES VIEW ── */}
        {viewMode === "upcoming" && (() => {
          // Group by EST date key
          const groups: { dateKey: string; label: string; races: UpcomingRace[] }[] = [];
          for (const r of upcomingRaces) {
            const dk = fmtEstDateKey(r.scheduledTime);
            let g = groups.find(x => x.dateKey === dk);
            if (!g) {
              g = { dateKey: dk, label: fmtEstDay(r.scheduledTime), races: [] };
              groups.push(g);
            }
            g.races.push(r);
          }

          return (
            <div>
              {/* Header */}
              <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#f59e0b", letterSpacing: "0.08em" }}>
                    📅 RACE SCHEDULE
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>
                    ALL TIMES IN EASTERN TIME (EST/EDT) · PARIMUTUEL BETTING
                  </p>
                </div>
                <button onClick={loadUpcoming} style={{
                  all: "unset", cursor: "pointer", color: "rgba(255,255,255,0.35)",
                  padding: 6, borderRadius: 8, background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center",
                }}>
                  <Clock style={{ width: 14, height: 14 }} />
                </button>
              </div>

              {upcomingRaces.length === 0 && !upcomingLoading && (
                <div style={{
                  textAlign: "center", padding: "60px 20px",
                  color: "rgba(255,255,255,0.25)", fontSize: 14,
                }}>
                  <CalendarDays style={{ width: 40, height: 40, margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
                  No upcoming races scheduled
                </div>
              )}

              {groups.map((group, gIdx) => (
                <div key={group.dateKey} style={{ marginBottom: 28 }}>
                  {/* Day header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, marginBottom: 12,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 900, color: "#f59e0b",
                      letterSpacing: "0.14em", textTransform: "uppercase",
                    }}>{group.label}</span>
                    <div style={{ flex: 1, height: 1, background: "rgba(245,158,11,0.15)" }} />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {group.races.map((race, rIdx) => {
                      const isFirst = gIdx === 0 && rIdx === 0;
                      const bs = race.bettingStatus;
                      const canBet = bs === "OPEN" || bs === "CLOSING_SOON";
                      const bsColor = bs === "OPEN" ? "#4ade80" : bs === "CLOSING_SOON" ? "#f97316" : "rgba(255,255,255,0.3)";
                      const bsLabel = bs === "OPEN" ? "BETTING OPEN" : bs === "CLOSING_SOON" ? "CLOSING SOON" : bs === "NOT_YET_OPEN" ? "OPENS LATER" : "CLOSED";
                      const abState = advanceBetState[race.queueId];

                      return (
                        <div key={race.queueId} style={{
                          background: isFirst
                            ? "rgba(245,158,11,0.06)"
                            : "rgba(255,255,255,0.025)",
                          border: isFirst
                            ? "1px solid rgba(245,158,11,0.25)"
                            : "1px solid rgba(255,255,255,0.07)",
                          borderRadius: 16,
                          overflow: "hidden",
                        }}>
                          {/* Card header */}
                          <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            {/* Next badge */}
                            {isFirst && (
                              <span style={{
                                background: "#f59e0b", color: "#07070c",
                                fontSize: 8, fontWeight: 900, padding: "2px 7px",
                                borderRadius: 6, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0,
                              }}>NEXT</span>
                            )}
                            {race.priority && (
                              <span style={{
                                background: "rgba(245,158,11,0.15)", color: "#f59e0b",
                                fontSize: 8, fontWeight: 900, padding: "2px 7px",
                                border: "1px solid rgba(245,158,11,0.3)",
                                borderRadius: 6, letterSpacing: "0.1em", flexShrink: 0,
                              }}>⚡ PRIORITY</span>
                            )}

                            {/* Time */}
                            <div style={{ lineHeight: 1.1 }}>
                              <div style={{ fontSize: 16, fontWeight: 900, color: "#fff", letterSpacing: "-0.01em" }}>
                                {fmtEstTime(race.scheduledTime)}
                              </div>
                              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                                {race.isActive ? `Race #${race.raceId}` : "Queued"}
                              </div>
                            </div>

                            <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

                            {/* Countdown */}
                            <RaceCountdownCell
                              scheduledTime={race.scheduledTime}
                              bettingClosesAt={race.bettingClosesAt}
                              bettingStatus={bs}
                              isDelayed={race.isDelayed}
                              delayMs={race.delayMs}
                            />

                            <div style={{ flex: 1 }} />

                            {/* Betting status badge */}
                            <div style={{
                              display: "flex", alignItems: "center", gap: 5,
                              padding: "5px 10px", borderRadius: 8,
                              background: canBet ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
                              border: `1px solid ${canBet ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.08)"}`,
                            }}>
                              <div style={{
                                width: 6, height: 6, borderRadius: "50%",
                                background: bsColor, flexShrink: 0,
                                boxShadow: canBet ? `0 0 6px ${bsColor}` : "none",
                              }} />
                              <span style={{ fontSize: 9, fontWeight: 900, color: bsColor, letterSpacing: "0.1em" }}>{bsLabel}</span>
                            </div>

                            {/* Pool */}
                            {race.totalPool > 0 && (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Coins style={{ width: 12, height: 12, color: "#f59e0b" }} />
                                <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", fontFamily: "monospace" }}>
                                  {race.totalPool.toLocaleString()}
                                </span>
                              </div>
                            )}

                            {/* Place Bet button */}
                            {canBet && (
                              <button
                                onClick={() => setAdvanceBetState(p => ({
                                  ...p,
                                  [race.queueId]: p[race.queueId]
                                    ? { ...p[race.queueId], open: !p[race.queueId].open }
                                    : { open: true, selectedHorseId: null, amount: 100, placing: false, error: null, confirmed: null },
                                }))}
                                style={{
                                  all: "unset", cursor: "pointer",
                                  padding: "7px 14px", borderRadius: 9,
                                  background: abState?.open ? "rgba(245,158,11,0.12)" : "#f59e0b",
                                  color: abState?.open ? "#f59e0b" : "#07070c",
                                  border: abState?.open ? "1px solid rgba(245,158,11,0.4)" : "none",
                                  fontSize: 11, fontWeight: 900, letterSpacing: "0.06em",
                                  flexShrink: 0,
                                }}>
                                {abState?.open ? "✕ Cancel" : "Place Bet"}
                              </button>
                            )}
                          </div>

                          {/* Horses row */}
                          <div style={{ paddingBottom: 14, paddingLeft: 16, paddingRight: 16, display: "flex", gap: 8, overflowX: "auto" }}>
                            {race.horses.map((h, hi) => {
                              const ri = rarityInfo(h.rarity);
                              const isSelected = abState?.selectedHorseId === h.id;
                              return (
                                <button
                                  key={h.id}
                                  onClick={() => canBet && setAdvanceBetState(p => ({
                                    ...p,
                                    [race.queueId]: {
                                      ...(p[race.queueId] ?? { open: true, amount: 100, placing: false, error: null, confirmed: null }),
                                      open: true, selectedHorseId: h.id,
                                    },
                                  }))}
                                  style={{
                                    all: "unset",
                                    cursor: canBet ? "pointer" : "default",
                                    flexShrink: 0,
                                    width: 80, padding: "8px 6px",
                                    borderRadius: 10, textAlign: "center",
                                    background: isSelected ? "rgba(245,158,11,0.12)" : ri.bg,
                                    border: isSelected ? "1px solid rgba(245,158,11,0.5)" : `1px solid rgba(255,255,255,0.06)`,
                                    transition: "border 0.12s",
                                  }}>
                                  {/* Saddle cloth */}
                                  <div style={{
                                    width: 10, height: 4, borderRadius: 2,
                                    background: LANE_COLORS[hi % LANE_COLORS.length],
                                    margin: "0 auto 4px",
                                  }} />
                                  {/* Sprite */}
                                  <div style={{ margin: "0 auto 4px", display: "flex", justifyContent: "center" }}>
                                    <SpriteRenderer
                                      spriteKey={h.baseSpriteKey ?? null}
                                      animation="idle" size={36}
                                      fallbackBase={h.visualBase ?? "brown"}
                                      fallbackPattern={h.visualPattern ?? "none"}
                                      fallbackFlair={h.visualFlair ?? "none"}
                                      tackColor={h.tackColor ?? null}
                                    />
                                  </div>
                                  <div style={{ fontSize: 9, fontWeight: 800, color: ri.text, lineHeight: 1.2, marginBottom: 2 }}>
                                    {h.name}
                                  </div>
                                  {h.liveOdds != null && (
                                    <div style={{ fontSize: 9, color: "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>
                                      {h.liveOdds.toFixed(2)}×
                                    </div>
                                  )}
                                  {h.horsePool > 0 && (
                                    <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                                      {h.horsePool.toLocaleString()}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {/* Advance bet panel */}
                          {abState?.open && canBet && (
                            <div style={{
                              borderTop: "1px solid rgba(255,255,255,0.07)",
                              padding: "12px 16px",
                              background: "rgba(0,0,0,0.2)",
                            }}>
                              {abState.confirmed ? (
                                <p style={{ margin: 0, color: "#4ade80", fontSize: 12, fontWeight: 700 }}>
                                  ✓ {abState.confirmed}
                                </p>
                              ) : (
                                <>
                                  {!abState.selectedHorseId && (
                                    <p style={{ margin: "0 0 8px", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
                                      Select a horse above, then choose your bet amount
                                    </p>
                                  )}
                                  {abState.selectedHorseId && (
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                                        Betting on <strong style={{ color: "#fff" }}>
                                          {race.horses.find(h => h.id === abState.selectedHorseId)?.name}
                                        </strong>
                                      </span>
                                      {/* Quick amounts */}
                                      {[100, 250, 500, 1000, 2500].map(amt => (
                                        <button key={amt} onClick={() => setAdvanceBetState(p => ({ ...p, [race.queueId]: { ...p[race.queueId], amount: amt } }))}
                                          style={{
                                            all: "unset", cursor: "pointer",
                                            padding: "4px 10px", borderRadius: 7,
                                            background: abState.amount === amt ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.05)",
                                            border: abState.amount === amt ? "1px solid rgba(245,158,11,0.4)" : "1px solid rgba(255,255,255,0.08)",
                                            fontSize: 10, fontWeight: 700,
                                            color: abState.amount === amt ? "#f59e0b" : "rgba(255,255,255,0.5)",
                                          }}>{amt.toLocaleString()}</button>
                                      ))}
                                      <input
                                        type="number" min={10} max={50000}
                                        value={abState.amount}
                                        onChange={e => setAdvanceBetState(p => ({ ...p, [race.queueId]: { ...p[race.queueId], amount: parseInt(e.target.value) || 0 } }))}
                                        style={{
                                          background: "rgba(255,255,255,0.06)",
                                          border: "1px solid rgba(255,255,255,0.12)",
                                          borderRadius: 7, color: "#fff",
                                          fontSize: 12, fontWeight: 700,
                                          padding: "4px 8px", width: 80, fontFamily: "monospace",
                                        }}
                                      />
                                      <button
                                        onClick={() => placeAdvanceBet(race.queueId, race.isActive)}
                                        disabled={abState.placing}
                                        style={{
                                          all: "unset", cursor: "pointer",
                                          padding: "6px 16px", borderRadius: 9,
                                          background: "#f59e0b", color: "#07070c",
                                          fontSize: 11, fontWeight: 900,
                                          opacity: abState.placing ? 0.6 : 1,
                                        }}>
                                        {abState.placing ? "Placing…" : `Bet ${abState.amount.toLocaleString()}`}
                                      </button>
                                    </div>
                                  )}
                                  {abState.error && (
                                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "#f87171" }}>{abState.error}</p>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {viewMode === "race" && <>

        {/* IDLE ── */}
        {status === "idle" && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "80px 20px", textAlign: "center",
            background: "#0c0c14", borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ fontSize: 56, marginBottom: 16, lineHeight: 1 }}>🏇</div>
            <div style={{ fontSize: 13, fontWeight: 900, color: "rgba(255,255,255,0.18)", letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 10 }}>
              No Race In Progress
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", maxWidth: 300 }}>
              The next race is being prepared. Keep this window open and you'll be notified when betting opens.
            </div>
          </div>
        )}

        {/* SCHEDULED (no horses yet) ── */}
        {status === "scheduled" && !hasHorses && (
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
            padding: "60px 20px", textAlign: "center",
            background: "#0c0c14", borderRadius: 20,
            border: "1px solid rgba(168,85,247,0.15)",
          }}>
            <Clock style={{ width: 28, height: 28, color: "#a855f7" }} />
            <div style={{ fontSize: 52, fontWeight: 900, fontFamily: "monospace", color: "#fff", letterSpacing: "-0.02em" }}>
              {fmt(countdown)}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
              Until Betting Opens
            </div>
          </div>
        )}

        {/* TRACK ── */}
        {showTrack && (
          <div style={{
            marginBottom: 20,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: status === "running"
              ? "0 0 0 1.5px rgba(245,158,11,0.3), 0 0 50px rgba(245,158,11,0.07)"
              : "0 0 0 1px rgba(255,255,255,0.07)",
          }}>
            <HorseRaceTrack
              horses={trackHorses}
              status={race!.status}
              winnerId={race!.winner?.id ?? null}
              horsePositions={horsePositions}
              raceId={race!.raceId}
              hideInlineLeaderboard={race!.status === "running"}
            />
          </div>
        )}

        {/* BETTING / SCHEDULED with horses ── */}
        {hasHorses && (status === "betting" || status === "scheduled") && (
          <>
            {/* Section header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 16,
            }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(255,255,255,0.5)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                  {canBet ? "Select a horse to place your bet" : "Horses — betting opens soon"}
                </div>
              </div>
              {status === "scheduled" && countdown > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock style={{ width: 12, height: 12, color: "#a855f7" }} />
                  <span style={{ fontSize: 14, fontWeight: 900, color: "#a855f7", fontFamily: "monospace" }}>
                    {fmt(countdown)}
                  </span>
                </div>
              )}
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: canBet ? "1fr 320px" : "1fr",
              gap: 20,
              alignItems: "start",
            }}>
              {/* Horse grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 14,
              }}>
                {race!.horses.map((horse, idx) => (
                  <HorseCard
                    key={horse.id}
                    horse={horse}
                    laneIdx={idx}
                    isSelected={selectedHorseId === horse.id}
                    myBet={myBets.get(horse.id) ?? 0}
                    canBet={canBet}
                    onSelect={() => setSelectedHorseId(selectedHorseId === horse.id ? null : horse.id)}
                    playerId={playerId ?? null}
                  />
                ))}
              </div>

              {/* Bet slip + pool breakdown — sticky right column */}
              {canBet && (
                <div style={{ position: "sticky", top: 80, display: "flex", flexDirection: "column", gap: 12 }}>
                  <BetSlipPanel
                    horse={selectedHorse}
                    laneIdx={selectedIdx}
                    betAmount={betAmount}
                    setBetAmount={setBetAmount}
                    displayChips={displayChips}
                    estimatedReturn={estimatedReturn}
                    betting={betting}
                    betError={betError}
                    betConfirmed={betConfirmed}
                    myBets={myBets}
                    onPlace={placeBet}
                    onCancel={() => { setSelectedHorseId(null); setBetError(null); }}
                  />

                  {/* Pool breakdown */}
                  <div style={{ background: "#0c0c14", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.16em" }}>Total Pool</span>
                      <span style={{ fontSize: 16, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>{totalPoolChips.toLocaleString()}</span>
                    </div>
                    <div style={{ padding: "8px 0" }}>
                      {race!.horses.map((horse, idx) => {
                        const pct = totalPoolChips > 0 ? (horse.horsePool / totalPoolChips) * 100 : 0;
                        const color = laneColor(idx);
                        return (
                          <div key={horse.id} style={{ padding: "5px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                              <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.7)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {horse.name}
                              </span>
                              <span style={{ fontSize: 10, fontWeight: 900, color: "#fff", fontFamily: "monospace" }}>
                                {horse.horsePool.toLocaleString()}
                              </span>
                              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", minWidth: 36, textAlign: "right", fontFamily: "monospace" }}>
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                            <div style={{ height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.5s ease" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Persistent race result */}
                  {lastResult && (
                    <div style={{
                      background: lastResult.won ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${lastResult.won ? "rgba(74,222,128,0.25)" : "rgba(255,255,255,0.08)"}`,
                      borderRadius: 14, overflow: "hidden",
                    }}>
                      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${lastResult.won ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.07)"}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: lastResult.won ? "#4ade80" : "rgba(255,255,255,0.35)" }}>
                          {lastResult.won ? "You Won!" : "Last Race"}
                        </span>
                        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Results</span>
                      </div>
                      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Winner</span>
                          <span style={{ fontSize: 13, fontWeight: 900, color: "#f59e0b" }}>{lastResult.winnerName}</span>
                        </div>
                        {lastResult.myBet > 0 && (
                          <>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Your Bet</span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", fontFamily: "monospace" }}>{lastResult.myBet.toLocaleString()}</span>
                            </div>
                            {lastResult.payout != null ? (
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Payout</span>
                                <span style={{ fontSize: 14, fontWeight: 900, color: "#4ade80", fontFamily: "monospace" }}>+{lastResult.payout.toLocaleString()}</span>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, fontWeight: 700, color: "#f87171", textAlign: "right" }}>
                                {lastResult.myBetHorseName ? `${lastResult.myBetHorseName} didn't win` : "No winning bet"}
                              </div>
                            )}
                          </>
                        )}
                        {lastResult.myBet === 0 && (
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>No bet placed this race</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* RUNNING — my bets strip ── */}
        {status === "running" && hasHorses && (
          <div style={{
            background: "#0c0c14",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14,
            padding: "14px 20px",
            marginTop: 0,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.3)", letterSpacing: "0.18em", textTransform: "uppercase" }}>
                Pool Breakdown
              </span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
                {totalPoolChips.toLocaleString()} total
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {race!.horses.map((horse, idx) => {
                const myBet = myBets.get(horse.id) ?? 0;
                const color = laneColor(idx);
                const pct = totalPoolChips > 0 ? ((horse.horsePool / totalPoolChips) * 100).toFixed(1) : "0.0";
                return (
                  <div key={horse.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: myBet > 0 ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${myBet > 0 ? "rgba(34,197,94,0.25)" : "rgba(255,255,255,0.07)"}`,
                    borderRadius: 10, padding: "6px 12px",
                    flex: "0 0 auto",
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%",
                      background: color, border: "1.5px solid rgba(255,255,255,0.6)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 8, fontWeight: 900, color: "#fff", flexShrink: 0,
                    }}>
                      {idx + 1}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: myBet > 0 ? "#fff" : "rgba(255,255,255,0.55)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {horse.name}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
                      {horse.liveOdds != null ? `${horse.liveOdds.toFixed(2)}×` : "—"}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                      {pct}%
                    </span>
                    {myBet > 0 && (
                      <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700 }}>
                        · {myBet.toLocaleString()} bet
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* RUNNING — live standings (below starting grid) ── */}
        {status === "running" && hasHorses && (
          <div style={{
            background: "#0c0c14",
            border: "1px solid rgba(245,158,11,0.18)",
            borderRadius: 14,
            overflow: "hidden",
            marginTop: 0,
          }}>
            <div style={{
              padding: "8px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              fontSize: 9, fontWeight: 800, color: "#f59e0b",
              letterSpacing: "0.18em", textTransform: "uppercase",
            }}>
              🏇 Live Standings
            </div>
            <div>
              {[...race!.horses]
                .sort((a, b) => (horsePositions[b.id] ?? 0) - (horsePositions[a.id] ?? 0))
                .map((horse, rank) => {
                  const origIdx = race!.horses.findIndex((h) => h.id === horse.id);
                  const color   = laneColor(origIdx);
                  const pct     = Math.min(100, horsePositions[horse.id] ?? 0);
                  const myBet   = myBets.get(horse.id) ?? 0;
                  return (
                    <div key={horse.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 16px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      background: myBet > 0 ? "rgba(34,197,94,0.04)" : undefined,
                    }}>
                      <span style={{ fontSize: 13, fontWeight: 900, color: "#f59e0b", minWidth: 16, fontFamily: "monospace" }}>
                        {rank + 1}
                      </span>
                      <div style={{
                        width: 18, height: 18, borderRadius: "50%",
                        background: color, border: "1.5px solid rgba(255,255,255,0.6)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 8, fontWeight: 900, color: "#fff", flexShrink: 0,
                      }}>
                        {origIdx + 1}
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {horse.name}
                      </span>
                      {myBet > 0 && (
                        <span style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, flexShrink: 0 }}>
                          {myBet.toLocaleString()} bet
                        </span>
                      )}
                      <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 3, flexShrink: 0, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.4s linear" }} />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* FINISHED — results ── */}
        {status === "finished" && hasHorses && (
          <div style={{ marginTop: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Reset countdown banner */}
            {resetCountdown > 0 && (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 18px",
                background: "rgba(15,15,20,0.8)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  Race Board Resets In
                </span>
                <span style={{ fontSize: 14, fontWeight: 900, color: "#f59e0b", fontFamily: "monospace" }}>
                  {resetCountdown}s
                </span>
              </div>
            )}
            {/* Winner spotlight */}
            {race!.winner && (() => {
              const w = race!.horses.find((h) => h.id === race!.winner!.id);
              const wIdx = race!.horses.findIndex((h) => h.id === race!.winner!.id);
              const myBet = myBets.get(race!.winner.id) ?? 0;
              const won = myBet > 0;
              if (!w) return null;
              return (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 20,
                    padding: "20px 24px",
                    background: won ? "rgba(5,30,15,0.95)" : "rgba(245,158,11,0.06)",
                    border: `1.5px solid ${won ? "rgba(34,197,94,0.35)" : "rgba(245,158,11,0.25)"}`,
                    borderRadius: 16,
                    boxShadow: won ? "0 0 40px rgba(34,197,94,0.1)" : "0 0 40px rgba(245,158,11,0.08)",
                  }}
                >
                  <div style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>🏆</div>
                  <HorseAvatar horse={w} size={64} laneIdx={wIdx} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.4)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
                      Winner
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {w.name}
                    </div>
                    {w.ownerName && (
                      <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 0 }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: "#d4a849", letterSpacing: "0.14em", textTransform: "uppercase" }}>Owned by</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#e879f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.ownerName}</span>
                      </div>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.35)", marginTop: 3 }}>
                      {w.liveOdds != null ? `${w.liveOdds.toFixed(2)}× final odds` : "Parimutuel"}
                    </div>
                  </div>
                  {won ? (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: "#4ade80", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>You Won!</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#4ade80", fontFamily: "monospace" }}>
                        Parimutuel payout
                      </div>
                      <div style={{ fontSize: 10, color: "rgba(34,197,94,0.6)", marginTop: 2 }}>sent to balance</div>
                    </div>
                  ) : myBet > 0 ? (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.12em" }}>Your bet</div>
                      <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                        {myBet.toLocaleString()}
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              );
            })()}

            {/* All results */}
            <div style={{
              background: "#0c0c14",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 16, overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,0.3)",
                letterSpacing: "0.18em", textTransform: "uppercase",
              }}>
                Final Results
              </div>
              <div>
                {[...race!.horses]
                  .sort((a, b) =>
                    (b.id === (race!.winner?.id ?? -1) ? 1 : 0) - (a.id === (race!.winner?.id ?? -1) ? 1 : 0)
                  )
                  .map((horse, sortedIdx) => {
                    const isWinner = horse.id === race!.winner?.id;
                    const origIdx  = race!.horses.findIndex((h) => h.id === horse.id);
                    const myBet    = myBets.get(horse.id) ?? 0;
                    return (
                      <div
                        key={horse.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 14,
                          padding: "12px 20px",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          background: isWinner ? "rgba(245,158,11,0.05)" : undefined,
                          opacity: isWinner ? 1 : 0.5,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 900, color: isWinner ? "#f59e0b" : "rgba(255,255,255,0.35)", minWidth: 20, fontFamily: "monospace" }}>
                          {sortedIdx + 1}
                        </span>
                        <HorseAvatar horse={horse} size={42} laneIdx={origIdx} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {isWinner && <Trophy style={{ width: 14, height: 14, color: "#f59e0b", flexShrink: 0 }} />}
                            <span style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.06em", color: isWinner ? "#fff" : "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {horse.name}
                            </span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {horse.ownerName && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                                <span style={{ fontSize: 8, fontWeight: 800, color: "#d4a849", letterSpacing: "0.12em", textTransform: "uppercase" }}>Owned by</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: isWinner ? "#e879f9" : "#a78bfa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{horse.ownerName}</span>
                              </div>
                            )}
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                              {horse.liveOdds != null ? `${horse.liveOdds.toFixed(2)}×` : "—"}
                            </span>
                          </div>
                        </div>
                        {myBet > 0 && (
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 10, color: isWinner ? "#4ade80" : "rgba(255,100,100,0.7)", fontWeight: 700 }}>
                              {isWinner ? "Payout sent" : `-${myBet.toLocaleString()}`}
                            </div>
                            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>your bet: {myBet.toLocaleString()}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        </>}

      </div>
    </div>
  );
}
