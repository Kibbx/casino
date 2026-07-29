import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { isGameUnlocked, usePasswordGuard } from "../lib/gamePasswordGuard";
import { awardXP } from "../lib/rewardsState";
import { fireChallengeEvent } from "../lib/challengeEventService";

import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { useGetSlotsStatus } from "@workspace/api-client-react";
import {
  playSpinClick,
  playReelTick,
  playReelStop,
  playScatterLand,
  playResultWin,
  playBonusMusic,
  playBonusAmbience,
  playBonusEntryThunderstrike,
  stopBonusMusic,
  stopBonusAmbience,
  setRomeSfxVolume,
  setRomeSfxMuted,
  getRomeSfxVolume,
  getRomeSfxMuted,
  preloadRomeSounds,
} from "./rome-sounds";
import {
  playBetClickSound,
  playCustomSound,
  startWinCountSound,
  stopWinCountSound,
  updateWinCountPitch,
} from "../lib/customSounds";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";
import { PaylineOverlay, type PaylineWin } from "./payline-overlay";
import { Menu, X, ChevronUp, ChevronDown, RotateCw, RefreshCw, Volume2, VolumeX, Music2, Info } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SLOTS_MAINTENANCE = false;
const RS   = import.meta.env.BASE_URL + "rome-slots/";
const WIN_COUNT_CURVE_EXPONENT = 1.35;
const WIN_COUNT_DURATION_TIERS = [
  { maxMultiplier: 2, durationMs: 500 },
  { maxMultiplier: 10, durationMs: 900 },
  { maxMultiplier: 25, durationMs: 1500 },
  { maxMultiplier: 50, durationMs: 2200 },
  { maxMultiplier: 100, durationMs: 3200 },
] as const;
const WIN_COUNT_MAX_DURATION_MS = 4500;
const BONUS_EXIT_DURATION_MULTIPLIER = 4;

function getWinCountDuration(winCents: number, betCents: number): number {
  const multiplier = betCents > 0 ? winCents / betCents : 1;
  for (const tier of WIN_COUNT_DURATION_TIERS) {
    if (multiplier < tier.maxMultiplier) return tier.durationMs;
  }
  return WIN_COUNT_MAX_DURATION_MS;
}

const HEADER_H = 72; // px — fixed header bar height

// ── Layout constants — pixel-scanned from SlotMachine3x5.png ─────────────────
const CW = 1920; // canvas width
const CH = 1080; // canvas height

// Machine frame image (1720×946), centered on BKG (1920×1080)
const M = { x: 100, y: 0, w: 1720, h: 946 };

// ── Layout source of truth — shared with slots-western ───────────────────────────
const REEL_COL  = [423, 638, 853, 1068, 1283]; // left-X of each column window
const REEL_TOP  = 238;                          // top-Y of reel window (all 3 rows)
const CELL_W    = 215;
const CELL_H    = 215;
const N_REELS   = 5;
const N_ROWS    = 3;

// Reel window: pixel-scanned separator peaks at y=500
// Column separators at machine-x: 223, 484, 734, 984, 1234, 1484
// Row area: y=217 (inner top border) to y=866 (bottom border), height=649
const REEL_COLS = [
  { left: M.x + 223, w: 261 }, // 484-223
  { left: M.x + 484, w: 250 }, // 734-484
  { left: M.x + 734, w: 250 }, // 984-734
  { left: M.x + 984, w: 250 }, // 1234-984
  { left: M.x + 1234, w: 250 },// 1484-1234
];
//   inner top of reel window (cover-frame anchored; Western's REEL_TOP above is raw px)
const MACHINE_REEL_TOP = M.y + 217;
const ROW_H    = 216;          // (866-217)/3 = 216
const ROWS  = 3;
const REELS = 5;

// ── Symbol data ───────────────────────────────────────────────────────────────
const SYMBOL_IDS = [
  "BronzeCoin", "CooperCoin", "SilverCoin", "GoldCoin",
  "Amphora", "Wreath", "Gladius", "Helmet", "Wild", "Scatter",
];

// Symbols that have animation frames (Amphora has none)
const ANIM_SYMBOLS = new Set([
  "BronzeCoin","CooperCoin","SilverCoin","GoldCoin",
  "Gladius","Helmet","Wreath","Wild","Scatter",
]);
const ANIM_FRAMES  = 24;
const ANIM_FPS     = 20; // frames per second → 50ms per frame
// Keep completed winners brighter without adding a post-overlay halo. The
// drop-shadow previously made static winners appear larger/frozen after the
// payline trace ended, while animated frames themselves had no matching glow.
const SYMBOL_VIEW_W = 250;
const SYMBOL_VIEW_H = 215;
const WILD_CENTER_OFFSET_X = 4;

// Paylines — mirrors api-server/src/routes/rome-slots.ts PAYLINES exactly
const PAYLINES: number[][] = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,0,1,2,2], [2,2,1,0,0],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,1,1,1,2], [2,1,1,1,0],
  [0,1,2,2,2], [2,1,0,0,0],
  [0,0,1,0,0], [2,2,1,2,2],
  [1,1,0,1,1], [1,1,2,1,1],
  [0,1,0,1,0],
  [0,2,0,2,0], [2,0,2,0,2],
  [1,2,0,2,1], [1,0,2,0,1],
  [2,0,0,2,0],
];

const SYMBOL_NAMES: Record<string, string> = {
  BronzeCoin: "Bronze Coin", CooperCoin: "Cooper Coin", SilverCoin: "Silver Coin",
  GoldCoin: "Gold Coin", Amphora: "Amphora", Wreath: "Wreath",
  Gladius: "Gladius", Helmet: "Helmet", Wild: "WILD", Scatter: "SCATTER",
};


// ── Bet steps ─────────────────────────────────────────────────────────────────
const DEFAULT_BET_STEPS = [20, 40, 100, 200, 400, 1000, 2000, 5000];

function nextBet(current: number, dir: 1 | -1, steps: number[]): number {
  const idx = steps.indexOf(current);
  if (idx === -1) return steps[0];
  const next = idx + dir;
  if (next < 0) return steps[0];
  if (next >= steps.length) return steps[steps.length - 1];
  return steps[next];
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Reel animation config ──────────────────────────────────────────────────────
// Each reel has a different prefix length so they stop left-to-right with natural stagger.
// Strip layout: [prefixCount random symbols] [row0result, row1result, row2result]
// Animation scrolls translateY from 0 → -(prefixCount * ROW_H)
// setInterval (not RAF) because FiveM CEF throttles requestAnimationFrame.
const REEL_PREFIXES = [12, 15, 18, 21, 24]; // symbols before the result per reel
const SPIN_SPEED    = 75;                    // px per 16ms tick
const DECEL_ZONE    = ROW_H * 2.75;          // decelerate over last ~2.75 rows

// ── Scatter tease config ───────────────────────────────────────────────────────
// Extra symbols added per tease step. At SPIN_SPEED=75px/16ms-tick (≈4687 px/s),
// 216 px/row: 30 symbols ≈ 1.4 s. Each reel in the chain gets 30 × step more, so they
// stop ~1.4 s apart and each one is clearly still spinning when the previous lands.
const TEASE_STEP = 30;

function buildInitialStrips(): string[][] {
  return REEL_PREFIXES.map(prefixCount => [
    ...Array.from({ length: prefixCount }, () =>
      SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]
    ),
    "BronzeCoin", "BronzeCoin", "BronzeCoin",
  ]);
}

// ── Win popup tiers ───────────────────────────────────────────────────────────
type WinTier = "small" | "huge" | "mega" | null;
function winTier(totalWin: number, bet: number): WinTier {
  if (totalWin <= 0) return null;
  const mult = totalWin / bet;
  if (mult >= 20) return "mega";
  if (mult >= 10) return "huge";
  return "small";
}

// ── Reusable panel with label + value overlay ─────────────────────────────────
function PanelDisplay({ img, w, h, x, y, label, value, highlight }: {
  img: string; w: number; h: number; x: number; y: number;
  label: string; value: string; highlight: boolean;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
      <img src={img} draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }} />
      <div style={{
        position: "relative", width: "100%", height: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 15, letterSpacing: "0.14em", color: "rgba(220,180,80,0.95)", textTransform: "uppercase" }}>
          {label}
        </span>
        <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 800, fontSize: 30, letterSpacing: "0.04em", lineHeight: 1.15, color: highlight ? "#fcd34d" : "#fff" }}>
          {value}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function RomeSlots() {
  useGameClosedRedirect("fortuna", "/slots");
  const [, navigate] = useLocation();
  const { playerId, sessionToken, playerStaffRoles } = useStore();
  const isOwner = playerStaffRoles.some(role => role.toLowerCase() === "owner");
  usePageTracker("rome-slots");
  usePasswordGuard("slots");
  useEffect(() => { preloadRomeSounds(); }, []);
  useEffect(() => { if (!isGameUnlocked("slots")) navigate("/slots-hub"); }, []);
  useEffect(() => { if (SLOTS_MAINTENANCE) navigate("/slots-hub"); }, []);

  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => navigate("/lobby"));
  const [displayChips, setDisplayChips] = useState<number>(0);

  const { data: slotsStatus } = useGetSlotsStatus({ query: { refetchInterval: 30000 } });

  // ── Bet steps (fetched from server, fall back to defaults) ─────────────────
  const [betSteps, setBetSteps] = useState<number[]>(DEFAULT_BET_STEPS);
  useEffect(() => {
    fetch(`${BASE}/api/slot-bet-limits`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.fortuna) && d.fortuna.length) {
          setBetSteps(d.fortuna);
          setBet(d.fortuna[0]);
        }
      })
      .catch(() => {});
  }, []);

  // Game state
  const [bet, setBet] = useState(DEFAULT_BET_STEPS[0]);
  const [strips, setStrips] = useState<string[][]>(buildInitialStrips);
  const [spinning, setSpinning] = useState(false);
  const spinningRef = useRef(false);
  useEffect(() => { if (!spinning) setDisplayChips(liveChips ?? 0); }, [liveChips, spinning]);
  const [lastWin, setLastWin] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [autoSpin, setAutoSpin] = useState(false);
  const autoSpinRef = useRef(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSfx, setShowSfx] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(getRomeSfxMuted);
  const [sfxVolume, setSfxVolume] = useState(getRomeSfxVolume);
  const [musicVolume, setMusicVolume] = useState(() =>
    Number(localStorage.getItem("fortuna-music-volume") ?? "1")
  );
  const [musicEnabled, setMusicEnabled] = useState(
    () => localStorage.getItem("fortuna-music-enabled") !== "false"
  );
  // Free spins mode
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0);
  const [freeSpinsTotal, setFreeSpinsTotal] = useState(0);
  const [showFreeSpinsBanner, setShowFreeSpinsBanner] = useState(false);
  const freeSpinsRef = useRef(0); // mirror for use inside callbacks
  const [bonusWinTotal, setBonusWinTotal] = useState(0);
  const bonusWinRef = useRef(0);
  const [showBonusEnd, setShowBonusEnd] = useState(false);
  const bonusEndResolveRef = useRef<(()=>void)|null>(null);
  const [bonusEndCountComplete, setBonusEndCountComplete] = useState(false);
  const bonusEndCountCompleteRef = useRef(false);
  const paylineFirstPassCompleteRef = useRef(true);
  const paylineFirstPassResolveRef = useRef<(() => void) | null>(null);
  // Animated value displayed in the bonus-end summary (count-up from 0 → bonusWinTotal)
  const [bonusEndDisplayed, setBonusEndDisplayed] = useState(0);
  const bonusEndRafRef = useRef<number | null>(null);
  const [showFreeSpinsEntry, setShowFreeSpinsEntry] = useState(false);
  const [showDevThreeScatters, setShowDevThreeScatters] = useState(false);
  const freeSpinsEntryRef  = useRef(false);  // ref mirror — readable inside spinOnce callback
  const bonusEverActiveRef = useRef(false);  // guard: prevents bonus-end firing on mount
  // True once reels have settled
  const [reelsStopped, setReelsStopped] = useState(false);
  // Winning paylines to display in the overlay (cleared on each new spin)
  const [overlayWins, setOverlayWins] = useState<PaylineWin[]>([]);
  const [bigWinPopup, setBigWinPopup] = useState<{
    amount: number;
    multiplier: number;
    tier: "huge" | "mega";
  } | null>(null);
  const animRef        = useRef<number | null>(null);

  // ── Animated win counter ─────────────────────────────────────────────────
  const [displayedWin, setDisplayedWin] = useState(0);
  const winRafRef = useRef<number | null>(null);
  const betHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const betHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleMusic = () => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    localStorage.setItem("fortuna-music-enabled", String(next));
    if (!next) stopBonusMusic();
    else if (freeSpinsRef.current > 0) playBonusMusic();
  };
  const updateSfxVolume = (value: number) => {
    setSfxVolume(value);
    setRomeSfxVolume(value);
  };
  const updateMusicVolume = (value: number) => {
    setMusicVolume(value);
    localStorage.setItem("fortuna-music-volume", String(value));
    // Rome currently exposes one shared audio master; keep music aligned
    // with that existing sound engine rather than adding a parallel mixer.
    setRomeSfxVolume(value);
  };
  const changeBet = (direction: "increase" | "decrease") => {
    if (spinning) return;
    setBet(current => {
      const index = betSteps.indexOf(current);
      const nextIndex = index + (direction === "increase" ? 1 : -1);
      if (index < 0 || nextIndex < 0 || nextIndex >= betSteps.length) return current;
      playBetClickSound(direction);
      return betSteps[nextIndex];
    });
  };
  const stopBetHold = () => {
    if (betHoldTimerRef.current) clearTimeout(betHoldTimerRef.current);
    if (betHoldIntervalRef.current) clearInterval(betHoldIntervalRef.current);
    betHoldTimerRef.current = null;
    betHoldIntervalRef.current = null;
  };
  const startBetHold = (direction: "increase" | "decrease") => {
    if (spinning) return;
    stopBetHold();
    betHoldTimerRef.current = setTimeout(() => {
      betHoldIntervalRef.current = setInterval(() => changeBet(direction), 120);
    }, 350);
  };
  useEffect(() => () => stopBetHold(), []);
  useEffect(() => {
    if (!showSfx) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-western-settings-menu]")) setShowSfx(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSfx(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showSfx]);

  /**
   * animateWinCount — counts displayed win from 0 → endValue using ease-out
   * cubic RAF animation. Safe to call mid-animation; cancels any prior frame.
   * Respects prefers-reduced-motion (shows final value immediately).
   */
  const animateWinCount = useCallback((endValue: number, tier: WinTier) => {
    // Cancel any active animation first
    if (winRafRef.current !== null) {
      cancelAnimationFrame(winRafRef.current);
      winRafRef.current = null;
    }
    if (endValue === 0) { setDisplayedWin(0); return; }
    // Instant display when user prefers reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayedWin(endValue);
      return;
    }
    // Duration: small ≈1–1.5 s, huge ≈2.5 s, mega ≈3.5 s; scaled slightly by size
    const base     = tier === "mega" ? 3200 : tier === "huge" ? 2400 : 1000;
    const sizeBump = Math.log10(Math.max(endValue, 10)) * 50;
    const cap      = tier === "mega" ? 3800 : tier === "huge" ? 3000 : 1500;
    const duration = Math.min(base + sizeBump, cap);
    const startTime = performance.now();
    function tick(now: number) {
      const t      = Math.min((now - startTime) / duration, 1);
      const eased  = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplayedWin(Math.round(eased * endValue));
      if (t < 1) {
        winRafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplayedWin(endValue); // guarantee exact final value — no float drift
        winRafRef.current = null;
      }
    }
    winRafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * animateBonusEndCount — counts displayed bonus total from 0 → endValue using
   * ease-out cubic RAF. Safe to call mid-animation; respects prefers-reduced-motion.
   * Used by the bonus-end "TOTAL WON" screen.
   */
  const animateBonusEndCount = useCallback((endValue: number) => {
    if (bonusEndRafRef.current !== null) {
      cancelAnimationFrame(bonusEndRafRef.current);
      bonusEndRafRef.current = null;
    }
    const finalCents = Math.max(0, Math.round(endValue * 100));
    if (finalCents <= 0) { setBonusEndDisplayed(0); return; }
    if (typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBonusEndDisplayed(finalCents / 100);
      return;
    }
    const duration = getWinCountDuration(
      finalCents,
      Math.round(bet * 100),
    ) * BONUS_EXIT_DURATION_MULTIPLIER;
    const startTime = performance.now();
    const tick = (now: number) => {
      const t     = Math.min((now - startTime) / duration, 1);
      const curvedProgress = Math.pow(t, WIN_COUNT_CURVE_EXPONENT);
      const displayedCents = t >= 1
        ? finalCents
        : Math.round(finalCents * curvedProgress);
      setBonusEndDisplayed(displayedCents / 100);
      updateWinCountPitch(displayedCents, finalCents);
      if (t < 1) {
        bonusEndRafRef.current = requestAnimationFrame(tick);
      } else {
        setBonusEndDisplayed(finalCents / 100);
        bonusEndCountCompleteRef.current = true;
        setBonusEndCountComplete(true);
        stopWinCountSound();
        bonusEndRafRef.current = null;
      }
    };
    bonusEndRafRef.current = requestAnimationFrame(tick);
  }, [bet]);
  // Direct DOM refs for each reel's inner strip
  const stripRefs          = useRef<(HTMLDivElement | null)[]>(Array(REELS).fill(null));
  // Outer reel container refs — used for dim/glow tease effects (no React re-render)
  const reelContainerRefs  = useRef<(HTMLDivElement | null)[]>(Array(REELS).fill(null));
  // Canvas refs for symbol animation overlays (15 cells: col*ROWS+row)
  const animCanvasRefs = useRef<(HTMLCanvasElement | null)[]>(Array(REELS * ROWS).fill(null));
  // Refs to the result-row static <img> elements in each reel strip (same 15-cell indexing)
  const cellImgRefs    = useRef<(HTMLImageElement | null)[]>(Array(REELS * ROWS).fill(null));
  const highlightedPaylineCellsRef = useRef<Set<number>>(new Set());
  const highlightedStaticSymbolsRef = useRef<Map<number, string>>(new Map());
  const paylineSoundedRef = useRef<Set<number>>(new Set());
  // Which symbol is in each overlay cell (updated when reels stop)
  const visibleSymsRef = useRef<string[]>(Array(REELS * ROWS).fill("BronzeCoin"));
  // Pre-decoded frame Image objects: sym → frame array (index 0 = frame 1)
  const frameImgsRef   = useRef<Map<string, HTMLImageElement[]>>(new Map());
  // Interval handle for symbol animation (setInterval — immune to CEF RAF throttling)
  const symAnimIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSymbolAnimIndicesRef = useRef<Set<number>>(new Set());
  const symbolAnimFrameRef = useRef<Map<number, number>>(new Map());

  // On mount: strip positioning + decode ALL frames into Image objects immediately
  useEffect(() => {
    for (let i = 0; i < REELS; i++) {
      const el = stripRefs.current[i];
      if (el) {
        el.style.transition = "none";
        el.style.transform = `translateY(${-(REEL_PREFIXES[i] * ROW_H)}px)`;
      }
    }
    // Decode all frames upfront — ctx.drawImage from a loaded HTMLImageElement is instant
    for (const sym of ANIM_SYMBOLS) {
      const frames: HTMLImageElement[] = [];
      for (let f = 1; f <= ANIM_FRAMES; f++) {
        const img = new Image();
        img.src = `${RS}animations/${sym}${String(f).padStart(2, "0")}.webp`;
        frames.push(img);
      }
      frameImgsRef.current.set(sym, frames);
    }
    return () => {
      if (symAnimIntervalRef.current !== null) clearInterval(symAnimIntervalRef.current);
    };
  }, []);

  // ── Symbol animation helpers ─────────────────────────────────────────────────
  const stopSymbolAnims = useCallback(() => {
    if (symAnimIntervalRef.current !== null) {
      clearInterval(symAnimIntervalRef.current);
      symAnimIntervalRef.current = null;
    }
    activeSymbolAnimIndicesRef.current.clear();
    symbolAnimFrameRef.current.clear();
    for (const cv of animCanvasRefs.current) {
      if (cv) {
        cv.style.visibility = "hidden";
        const ctx = cv.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
      }
    }
    // Restore the static reel-strip symbols that were hidden during animation
    for (const img of cellImgRefs.current) {
      if (img) {
        img.style.visibility = "";
        img.style.opacity = "";
        img.style.display = "";
      }
    }
  }, []);

  const startSymbolAnims = useCallback((winIndices: Set<number>) => {
    // Add only newly reached cells. Each cell gets its own frame cursor and
    // completes one full 24-frame animation instead of joining a permanent
    // shared loop with every other winning icon.
    winIndices.forEach(idx => {
      if (!activeSymbolAnimIndicesRef.current.has(idx)) {
        activeSymbolAnimIndicesRef.current.add(idx);
        symbolAnimFrameRef.current.set(idx, 0);
      }
      // The animation canvas owns this cell while it is playing. Hide both
      // other layers first so a previous bright winner cannot overlap it.
      cellImgRefs.current[idx]?.style.setProperty("visibility", "hidden");
      cellImgRefs.current[idx]?.style.setProperty("opacity", "0");
      cellImgRefs.current[idx]?.style.setProperty("display", "none");
      animCanvasRefs.current[idx]?.style.setProperty("visibility", "hidden");
      animCanvasRefs.current[idx]?.style.setProperty("opacity", "1");
    });
    if (activeSymbolAnimIndicesRef.current.size === 0 ||
        symAnimIntervalRef.current !== null) return;

    // Draw frame — only hide static img + show canvas once we can actually draw
    const drawFrame = () => {
      animCanvasRefs.current.forEach((cv, idx) => {
        if (!cv || !activeSymbolAnimIndicesRef.current.has(idx)) return;
        const sym = visibleSymsRef.current[idx];
        const frames = frameImgsRef.current.get(sym);
        if (!frames) return;
        const frame = symbolAnimFrameRef.current.get(idx) ?? 0;
        const img = frames[frame % frames.length];
        // If image isn't decoded yet, leave static img visible and skip
        if (!img.complete || img.naturalWidth === 0) return;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        // All Rome symbol artwork uses a 250x215 symbol viewport. Wild's
        // animation frames are 262x224 with transparent padding around the
        // artwork; crop that padding so the animated Wild matches the size
        // of the static Wild symbol instead of appearing smaller.
        if (sym === "Wild" && img.naturalWidth >= 262 && img.naturalHeight >= 224) {
          ctx.drawImage(img, 6, 4, 250, 215, 0, 0, SYMBOL_VIEW_W, SYMBOL_VIEW_H);
        } else {
          ctx.drawImage(img, 0, 0, SYMBOL_VIEW_W, SYMBOL_VIEW_H);
        }
        // Only hide the static img + reveal canvas after a successful draw
        cv.style.visibility = "visible";
        const staticImg = cellImgRefs.current[idx];
        if (staticImg) staticImg.style.visibility = "hidden";
      });

      activeSymbolAnimIndicesRef.current.forEach(idx => {
        const nextFrame = (symbolAnimFrameRef.current.get(idx) ?? 0) + 1;
        if (nextFrame >= ANIM_FRAMES) {
          activeSymbolAnimIndicesRef.current.delete(idx);
          symbolAnimFrameRef.current.delete(idx);
          const cv = animCanvasRefs.current[idx];
          if (cv) {
            cv.style.visibility = "hidden";
            cv.style.opacity = "0";
            cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
          }
          // Return to the original reel image for the persistent highlight.
          // Do not add a second image layer over the reel symbol.
          const sourceImg = cellImgRefs.current[idx];
          if (sourceImg) {
            sourceImg.style.visibility = "visible";
            sourceImg.style.opacity = "1";
            sourceImg.style.display = "";
          }
        } else {
          symbolAnimFrameRef.current.set(idx, nextFrame);
        }
      });

      if (activeSymbolAnimIndicesRef.current.size === 0 &&
          symAnimIntervalRef.current !== null) {
        clearInterval(symAnimIntervalRef.current);
        symAnimIntervalRef.current = null;
      }
    };

    drawFrame();
    const MS_PER_FRAME = Math.round(1000 / ANIM_FPS);
    symAnimIntervalRef.current = setInterval(drawFrame, MS_PER_FRAME);
  }, []);

  const onPaylineActive = useCallback((
    positions: Array<{ reel: number; row: number; symbol: string }>,
  ) => {
    // Keep every winning cell reached by the current sequence highlighted.
    // The prefix still arrives left-to-right, but prior payline icons remain
    // bright while the next payline is traced.
    const indices = new Set<number>();
    for (const { reel, row, symbol } of positions) {
      const idx = reel * ROWS + row;
      highlightedPaylineCellsRef.current.add(idx);
      highlightedStaticSymbolsRef.current.set(idx, symbol);
      const sourceImg = cellImgRefs.current[idx];
      if (ANIM_SYMBOLS.has(symbol)) {
        indices.add(idx);
      } else if (sourceImg) {
        sourceImg.style.visibility = "visible";
        sourceImg.style.opacity = "1";
        sourceImg.style.display = "";
      }
    }
    // Add only the cells reached by the trace. startSymbolAnims keeps the
    // existing interval alive, so newly reached icons join on the next frame
    // instead of every winning icon starting before the trace.
    if (indices.size > 0) startSymbolAnims(indices);
    highlightedStaticSymbolsRef.current.forEach((symbol, idx) => {
      if (ANIM_SYMBOLS.has(symbol)) return;
      const sourceImg = cellImgRefs.current[idx];
      if (sourceImg) {
        sourceImg.style.visibility = "visible";
      }
    });
  }, [startSymbolAnims]);

  const onPaylineStart = useCallback((lineIndex: number) => {
    if (paylineSoundedRef.current.has(lineIndex)) return;
    paylineSoundedRef.current.add(lineIndex);
    // Match Western's bonus-round presentation: the per-line "multi" cue
    // starts exactly when the tracer begins the active payline.
    playCustomSound("multi");
  }, []);

  const onPaylineFirstPassComplete = useCallback(() => {
    paylineFirstPassCompleteRef.current = true;
    paylineFirstPassResolveRef.current?.();
    paylineFirstPassResolveRef.current = null;
  }, []);

  const dismissBonusEnd = useCallback(() => {
    setShowBonusEnd(false);
    setFreeSpinsTotal(0);
    freeSpinsRef.current = 0;
    bonusEverActiveRef.current = false;
    setOverlayWins([]);
    stopSymbolAnims();
    stopWinCountSound();
    bonusEndResolveRef.current?.();
    bonusEndResolveRef.current = null;
  }, [stopSymbolAnims]);

  useEffect(() => {
    highlightedPaylineCellsRef.current.clear();
    highlightedStaticSymbolsRef.current.clear();
    paylineSoundedRef.current.clear();

    // During the payline presentation, dim only cells that do not belong to
    // any winning payline. Winning symbols stay at their native brightness;
    // animated winners are rendered on the undimmed canvas.
    const winningCells = new Set<number>();
    overlayWins.forEach(({ positions }) => {
      positions?.forEach(({ reel, row }) => {
        winningCells.add(reel * ROWS + row);
      });
    });
    cellImgRefs.current.forEach((img, idx) => {
      if (!img) return;
      img.style.filter = overlayWins.length > 0 && !winningCells.has(idx)
        ? "brightness(0.38) saturate(0.72)"
        : "";
    });

    return () => {
      cellImgRefs.current.forEach(img => {
        if (img) img.style.filter = "";
      });
    };
  }, [overlayWins]);

  // Canvas scaling — ResizeObserver on wrapper so FiveM CEF tablet sizes work correctly
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale]           = useState(1);
  const [infoScale, setInfoScale]   = useState(1);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const availH = height - HEADER_H;
      setScale(Math.min(width / CW, availH / CH));
      setInfoScale(Math.min(width * 0.96 / 1284, availH * 0.96 / 659));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const chips = displayChips;

  // ── Spin logic ──────────────────────────────────────────────────────────────
  const spinOnce = useCallback(async (
    currentBet: number,
    isFree = false,
    forceDevThreeScatters = false,
  ): Promise<boolean> => {
    if (!sessionToken) return false;
    if (spinningRef.current) return false;
    if (freeSpinsEntryRef.current) return false; // block while bonus entry panel is open
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    // Cancel any in-progress count-up and snap display to 0 immediately
    if (winRafRef.current !== null) { cancelAnimationFrame(winRafRef.current); winRafRef.current = null; }
    setDisplayedWin(0);
    setBigWinPopup(null);
    setErrMsg(null);
    setReelsStopped(false);
    setOverlayWins([]);
    stopSymbolAnims();

    // ── 1. Fetch result from server ──────────────────────────────────────────
    let data: any = null;
    try {
      const url = isFree ? `${BASE}/api/rome-slots/free-spin` : `${BASE}/api/rome-slots/spin`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: isFree ? undefined : JSON.stringify({
          bet: currentBet,
          ...(forceDevThreeScatters ? { forceDevThreeScatters: true } : {}),
        }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Spin failed");
      if (!isFree) awardXP(currentBet);
      // Challenge tracking — fires after confirmed server transaction
      fireChallengeEvent("any_game_round_played");
      if (!isFree) {
        fireChallengeEvent("bet_wagered", { amount: currentBet });
        fireChallengeEvent("single_bet_placed", { amount: currentBet });
      }
      if ((data.totalWin ?? 0) > 0) fireChallengeEvent("bet_won");
      else fireChallengeEvent("bet_lost");
    } catch (e: any) {
      spinningRef.current = false;
      setSpinning(false);
      setErrMsg(e.message);
      return false;
    }

    // ── 2. Compute scatter positions + tease extensions ──────────────────────
    // Scatter column detection — uses predetermined result, does NOT change odds
    const scatterInCol: boolean[] = Array(REELS).fill(false);
    for (let col = 0; col < REELS; col++) {
      for (let row = 0; row < ROWS; row++) {
        if (data.grid[row]?.[col] === "Scatter") { scatterInCol[col] = true; break; }
      }
    }
    // Extra symbols added before result for teased reels (ensures they stop last)
    const teaseExtraSyms: number[] = Array(REELS).fill(0);
    // Find the column where the tease chain begins (the reel after the 2nd scatter)
    let scsSoFar = 0;
    let firstTeaseCol = -1;
    for (let col = 0; col < REELS; col++) {
      if (scatterInCol[col]) {
        scsSoFar++;
        if (scsSoFar === 2 && firstTeaseCol < 0) firstTeaseCol = col + 1;
      }
    }
    // Cascade: every reel from firstTeaseCol onwards gets progressively more symbols
    // so each one is still visibly spinning when the previous tease reel stops.
    if (firstTeaseCol >= 0 && firstTeaseCol < REELS) {
      for (let col = firstTeaseCol; col < REELS; col++) {
        const step = col - firstTeaseCol + 1; // 1, 2, 3 …
        const passLast = Math.max(0, REEL_PREFIXES[REELS - 1] - REEL_PREFIXES[col]);
        teaseExtraSyms[col] = passLast + TEASE_STEP * step;
      }
    }

    // ── 3. Build strips: NEW result at index 0-2 (so translateY(0) lands at
    //       result), random+tease padding in the middle, OLD result (prev) at
    //       the bottom. Animation scrolls translateY DOWN from a position
    //       ABOVE the viewport (showing prev) to 0 (showing result), so
    //       symbols enter from the top and exit at the bottom.
    const newStrips = REEL_PREFIXES.map((prefixCount, reelIdx) => {
      const prev = [0, 1, 2].map(r =>
        visibleSymsRef.current[reelIdx * ROWS + r] || "BronzeCoin"
      );
      return [
        data.grid[0][reelIdx],
        data.grid[1][reelIdx],
        data.grid[2][reelIdx],
        ...Array.from({ length: prefixCount }, () =>
          SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]
        ),
        ...Array.from({ length: teaseExtraSyms[reelIdx] }, () =>
          SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]
        ),
        ...prev,
      ];
    });
    setStrips(newStrips);

    // ── 3b. Reset each strip ABOVE the viewport — translateY = -(length - ROWS) *
    //        ROW_H places the OLD result row at viewport top, identical to what
    //        was shown before the spin (no snap). Animation will scroll DOWN.
    for (let i = 0; i < REELS; i++) {
      const el = stripRefs.current[i];
      if (el) {
        el.style.transition = "none";
        el.style.transform = `translateY(${-(newStrips[i].length - ROWS) * ROW_H}px)`;
      }
    }

    // Wait 2 frames for React to re-render the new strips and browser to paint
    await new Promise(r => setTimeout(r, 32));

    // ── 3c. Sequential lift-before-spin (mirrors Western): each reel's container
    //        jumps LIFT_PX pixels UP over LIFT_MS, returns to 0 over LIFT_MS, then
    //        releases into the spin loop. Stagger STAGGER_MS between reels.
    const reelStarted = Array(REELS).fill(false);
    const LIFT_PX = 40, LIFT_MS = 130, STAGGER_MS = 120;
    for (let i = 0; i < REELS; i++) {
      ((col) => {
        setTimeout(() => {
          const cEl = reelContainerRefs.current[col];
          if (!cEl) { reelStarted[col] = true; return; }
          cEl.style.transition = `transform ${LIFT_MS}ms ease-out`;
          cEl.style.transform  = `translateY(-${LIFT_PX}px)`;
          setTimeout(() => {
            cEl.style.transition = `transform ${LIFT_MS}ms ease-in`;
            cEl.style.transform  = "translateY(0)";
            setTimeout(() => {
              cEl.style.transition = "none";
              reelStarted[col] = true;
            }, LIFT_MS);
          }, LIFT_MS);
        }, col * STAGGER_MS);
      })(i);
    }

    // ── 4. Drive reel scroll DOWNWARD via setInterval (RAF throttled in FiveM CEF) ─
    //       Each strip starts at translateY = -(length - ROWS) * ROW_H (OLD result at
    //       viewport top) and slides DOWN to 0 (NEW result at viewport top).
    //       Decelerate smoothly over the final DECEL_ZONE px — no CSS transition
    //       snap, no overshoot, lands exactly on the target pixel.
    const yPos    = newStrips.map(strip => -(strip.length - ROWS) * ROW_H);
    const stopped = Array(REELS).fill(false);
    const targets = newStrips.map(() => 0);

    if (animRef.current) { clearInterval(animRef.current as any); animRef.current = null; }

    // Play spin click exactly when reels begin moving (not on button press) so
    // audio aligns with the visual start — no API-latency gap
    playSpinClick();

    // Track row index per reel for tick detection
    const lastRowIdx = Array(REELS).fill(0);
    // Scatter cells are animated as soon as their reel settles, matching
    // Western's landing presentation rather than waiting for all reels.
    const settledScatterCells = new Set<number>();

    // ── Tease visual helpers — direct DOM writes, no React re-render ──────────
    const applyTeaseDim = (idx: number) => {
      // Keep any reel with a landed Scatter bright as a whole.
      const reelHasScatter = data.grid.some((row: string[]) => row?.[idx] === "Scatter");
      if (reelHasScatter) {
        const scatterReel = reelContainerRefs.current[idx];
        if (scatterReel) {
          scatterReel.style.transition = "filter 0.3s, box-shadow 0.3s";
          scatterReel.style.filter = "";
          scatterReel.style.boxShadow = "";
        }
        return;
      }
      const el = reelContainerRefs.current[idx];
      if (el) { el.style.transition = "filter 0.25s"; el.style.filter = "brightness(0.42)"; el.style.boxShadow = ""; }
    };
    const clearTeaseEffects = () => {
      for (let j = 0; j < REELS; j++) {
        const el = reelContainerRefs.current[j];
        if (el) { el.style.transition = "filter 0.3s, box-shadow 0.3s"; el.style.filter = ""; el.style.boxShadow = ""; }
      }
    };

    // Tease state (closure-local — no useState needed, driven purely from loop)
    let teaseScatterCount = 0;
    let teaseReelIdx      = -1;
    let pulsePhase        = 0;

    await Promise.race([
      new Promise<void>(resolve => {
        animRef.current = setInterval(() => {
          let anyMoving = false;
          let tickedThisFrame = false; // at most ONE tick sound per 16ms frame

          // ── Pulse glow on the focused teased reel ──────────────────────────
          if (teaseReelIdx >= 0 && !stopped[teaseReelIdx]) {
            pulsePhase = (pulsePhase + 1) % 40;
            const bright  = 1.08 + 0.10 * Math.sin(pulsePhase * Math.PI / 20);
            const spread  = 18  + 8    * Math.sin(pulsePhase * Math.PI / 20);
            const glowEl  = reelContainerRefs.current[teaseReelIdx];
            if (glowEl) {
              glowEl.style.transition = "";
              glowEl.style.filter     = `brightness(${bright.toFixed(3)})`;
              glowEl.style.boxShadow  = `0 0 ${spread.toFixed(0)}px 6px rgba(255,195,50,0.72)`;
            }
          }

          for (let i = 0; i < REELS; i++) {
            if (stopped[i]) continue;
            if (!reelStarted[i]) { anyMoving = true; continue; } // still lifting
            const remaining = targets[i] - yPos[i]; // positive, shrinking (yPos climbing toward 0)
            const speed = remaining > DECEL_ZONE
              ? SPIN_SPEED
              : Math.max(1.5, SPIN_SPEED * (remaining / DECEL_ZONE));
            yPos[i] += speed;
            const el = stripRefs.current[i];
            // Snap + fire stop when within 1 step OR remaining imperceptible (<15% row)
            if (yPos[i] >= targets[i] || remaining < ROW_H * 0.12) {
              yPos[i] = targets[i]; // clamp — zero overshoot
              stopped[i] = true;
              if (el) { el.style.transition = "none"; el.style.transform = `translateY(${targets[i]}px)`; }

              // Play the edited Rome reel-stop clip once for every reel landing.
              playReelStop();

              // Sync the just-settled column immediately so the first Scatter
              // animation frame uses the symbol that actually landed. The
              // final-grid sync below still refreshes every cell after the
              // complete reel sequence.
              let hasScatterInReel = false;
              for (let r = 0; r < ROWS; r++) {
                visibleSymsRef.current[i * ROWS + r] = data.grid[r]?.[i] ?? "BronzeCoin";
                if (data.grid[r]?.[i] === "Scatter") {
                  settledScatterCells.add(i * ROWS + r);
                  hasScatterInReel = true;
                }
              }
              // Match Western: one impact cue per reel containing a Scatter,
              // and start the landed Scatter sprite on this stop callback.
              if (hasScatterInReel) {
                playScatterLand();
                startSymbolAnims(new Set(
                  Array.from(settledScatterCells).filter(idx => Math.floor(idx / ROWS) === i),
                ));
              }

              // When the focused tease reel stops — either pass focus forward or resolve
              if (i === teaseReelIdx) {
                teaseReelIdx = -1;
                if (!scatterInCol[i] && teaseScatterCount < 3) {
                  // No scatter here — keep suspense alive on the next reel
                  let nextReel = -1;
                  for (let j = i + 1; j < REELS; j++) { if (!stopped[j]) { nextReel = j; break; } }
                  if (nextReel >= 0) {
                    teaseReelIdx = nextReel;
                    pulsePhase   = 0;
                    // Keep dims on stopped reels — glow shifts to new target reel
                    applyTeaseDim(i);
                  } else {
                    clearTeaseEffects(); // ran out of reels — clean up
                  }
                } else {
                  clearTeaseEffects(); // scatter landed (resolve) or already 3 scatters
                }
              }

              // Start tease exactly when the 2nd scatter lands (not on 3rd+)
              if (scatterInCol[i]) {
                teaseScatterCount++;
                if (teaseScatterCount === 2) {
                  let nextReel = -1;
                  for (let j = i + 1; j < REELS; j++) { if (!stopped[j]) { nextReel = j; break; } }
                  if (nextReel >= 0) {
                    teaseReelIdx = nextReel;
                    pulsePhase   = 0;
                    for (let j = 0; j < REELS; j++) { if (stopped[j]) applyTeaseDim(j); }
                  }
                }
              }

              // Dim any reel that stops while a tease is already in progress
              if (teaseReelIdx >= 0 && i !== teaseReelIdx) applyTeaseDim(i);

            } else {
              anyMoving = true;
              // Tick on row-boundary crossing, but max one tick per frame
              const rowNow = Math.floor(Math.abs(yPos[i]) / ROW_H);
              if (rowNow !== lastRowIdx[i]) {
                lastRowIdx[i] = rowNow;
                if (!tickedThisFrame) { tickedThisFrame = true; playReelTick(); }
              }
              if (el) el.style.transform = `translateY(${yPos[i]}px)`;
            }
          }
          if (!anyMoving) {
            clearInterval(animRef.current as any);
            animRef.current = null;
            resolve();
          }
        }, 16) as any;
      }),
      new Promise<void>(r => setTimeout(r, Math.max(20000, Math.max(...yPos.map(t => Math.abs(t))) / SPIN_SPEED * 16 * 1.4 + 3000))),
    ]);
    // Force-snap all reels + clear any lingering tease effects (safety)
    clearTeaseEffects();
    if (animRef.current) { clearInterval(animRef.current as any); animRef.current = null; }
    for (let i = 0; i < REELS; i++) {
      const el = stripRefs.current[i];
      if (el) { el.style.transition = "none"; el.style.transform = `translateY(${targets[i]}px)`; }
    }

    // ── 5. Animate only winning cells ────────────────────────────────────────
    // Update visible-symbol ref from final grid
    for (let col = 0; col < REELS; col++) {
      for (let row = 0; row < ROWS; row++) {
        visibleSymsRef.current[col * ROWS + row] =
          data.grid[row]?.[col] ?? "BronzeCoin";
      }
    }
    setReelsStopped(true);
    const lineWins: PaylineWin[] = Array.isArray(data.lineWins)
      ? data.lineWins.map((lineWin: { lineIndex: number; count: number; symbol: string; win: number }) => ({
          ...lineWin,
          positions: Array.from({ length: lineWin.count }, (_, reel) => ({
            reel,
            row: PAYLINES[lineWin.lineIndex]?.[reel] ?? 0,
            symbol: data.grid[PAYLINES[lineWin.lineIndex]?.[reel] ?? 0]?.[reel] ?? lineWin.symbol,
          })),
        }))
      : [];
    paylineFirstPassCompleteRef.current = lineWins.length === 0;
    setOverlayWins(lineWins);

    // ── 6. Show win results ──────────────────────────────────────────────────
    setLastWin(data.totalWin);
    if (data.totalWin > 0) playResultWin();
    const paylineWinTotal = lineWins.reduce((sum, win) => sum + Number(win.win ?? 0), 0);
    const paylineMultiplier = currentBet > 0 ? paylineWinTotal / currentBet : 0;
    if (paylineMultiplier >= 10) {
      setBigWinPopup({
        amount: data.totalWin,
        multiplier: paylineMultiplier,
        tier: paylineMultiplier >= 20 ? "mega" : "huge",
      });
    }

    // Update free spins counters from server response
    if (data.freeSpinsAwarded > 0) {
      const total = data.freeSpinsAwarded;
      setBonusWinTotal(0); bonusWinRef.current = 0;
      setFreeSpinsTotal(total);
      freeSpinsRef.current = total;
      // Release lock immediately — free spins start at once, no lockout.
      spinningRef.current = false;
      setSpinning(false);
      setFreeSpinsLeft(total);
      // Show full-screen bonus entry panel — dismisses only on tap/click
      bonusEverActiveRef.current = true;
      freeSpinsEntryRef.current = true;
      setShowFreeSpinsEntry(true);
      playBonusEntryThunderstrike();
      playBonusAmbience();
      return true;
    }
    if (isFree) {
      const remaining = data.freeSpinsRemaining ?? 0;
      setFreeSpinsLeft(remaining);
      freeSpinsRef.current = remaining;
      if (data.retriggered > 0) {
        setFreeSpinsTotal(t => t + data.retriggered);
      }
      // Track cumulative bonus winnings
      if (data.totalWin > 0) {
        bonusWinRef.current += data.totalWin;
        setBonusWinTotal(bonusWinRef.current);
      }
      // Stop music immediately when the last free spin completes — don't rely on the effect alone
      if (remaining <= 0) stopBonusMusic();
      if (remaining <= 0) stopBonusAmbience();
    }

    const tier = winTier(data.totalWin, currentBet);
    // Start count-up animation — runs independently of popup/balance logic
    animateWinCount(data.totalWin, tier ?? "small");
    if (tier) {
      const duration =
        tier === "mega"    ? 3500 :
        tier === "huge"    ? 3000 : isFree ? 1500 : 2000;
      await delay(duration);
    }

    spinningRef.current = false;
    setSpinning(false);
    return true;
  }, [sessionToken, stopSymbolAnims, startSymbolAnims]);

  // Auto spin loop
  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

  // Match Western Slots: once the bonus entry screen is dismissed, free spins
  // continue automatically without requiring another tap on the spin button.
  // Keep the entry/end screens as hard gates so a bonus cannot spin underneath
  // either transition scene.
  useEffect(() => {
    if (
      freeSpinsLeft > 0 &&
      !showFreeSpinsEntry &&
      !showBonusEnd &&
      !autoSpin
    ) {
      autoSpinRef.current = true;
      setAutoSpin(true);
    }
  }, [freeSpinsLeft, showFreeSpinsEntry, showBonusEnd, autoSpin]);

  useEffect(() => {
    if (!autoSpin) return;
    let alive = true;
    const loop = async () => {
      while (alive && autoSpinRef.current) {
        // Use a free spin if one is available, otherwise consume a paid spin
        const ok = await spinOnce(bet, freeSpinsRef.current > 0);
        if (!ok) { setAutoSpin(false); break; }
        await delay(400);
      }
    };
    loop();
    return () => { alive = false; };
  }, [autoSpin]);

  // Check for pending free spins on mount (server restart safe)
  useEffect(() => {
    if (!sessionToken) return;
    fetch(`${BASE}/api/rome-slots/free-spins-status`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.remaining > 0) {
          setFreeSpinsLeft(d.remaining);
          setFreeSpinsTotal(d.remaining);
          freeSpinsRef.current = d.remaining;
        }
      })
      .catch(() => {});
  }, [sessionToken]);



  // Bonus-end summary effect — fires once when freeSpinsLeft transitions >0 → 0
  useEffect(() => {
    if (freeSpinsLeft > 0) return;
    if (!bonusEverActiveRef.current) return; // skip on initial mount (freeSpinsLeft starts at 0)
    // Stop music immediately (sync) — don't let it outlive a cancelled async
    stopBonusMusic();
    stopBonusAmbience();
    // Cancel auto-spin SYNCHRONOUSLY here — if we wait until inside the async
    // IIFE, the 700 ms delay gives the while-loop time to fire a paid spin.
    setAutoSpin(false);
    autoSpinRef.current = false;
    let cancelled = false;
    (async () => {
      await delay(700);
      if (cancelled) return;
      if (!paylineFirstPassCompleteRef.current) {
        await new Promise<void>(resolve => {
          paylineFirstPassResolveRef.current = resolve;
          window.setTimeout(resolve, 6000);
        });
        paylineFirstPassResolveRef.current = null;
      }
      if (cancelled) return;
      setBonusEndDisplayed(0);
      bonusEndCountCompleteRef.current = bonusWinRef.current <= 0;
      setBonusEndCountComplete(bonusEndCountCompleteRef.current);
      animateBonusEndCount(bonusWinRef.current);
      startWinCountSound();
      setShowBonusEnd(true);
      await new Promise<void>(r => { bonusEndResolveRef.current = r; });
      if (cancelled) return;
      setShowBonusEnd(false);
      stopWinCountSound();
      bonusWinRef.current = 0;
      setBonusWinTotal(0);
      setBonusEndDisplayed(0);
      setFreeSpinsTotal(0);
      freeSpinsRef.current = 0;
      bonusEverActiveRef.current = false;
      setOverlayWins([]);
      stopSymbolAnims();
      bonusEndCountCompleteRef.current = false;
      setBonusEndCountComplete(false);
      if (bonusEndRafRef.current !== null) {
        cancelAnimationFrame(bonusEndRafRef.current);
        bonusEndRafRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      paylineFirstPassResolveRef.current?.();
      paylineFirstPassResolveRef.current = null;
      bonusEndResolveRef.current?.();
      bonusEndResolveRef.current = null;
      if (bonusEndRafRef.current !== null) {
        cancelAnimationFrame(bonusEndRafRef.current);
        bonusEndRafRef.current = null;
      }
      stopWinCountSound();
      bonusEndCountCompleteRef.current = false;
      setBonusEndCountComplete(false);
    };
  }, [freeSpinsLeft === 0 ? 1 : 0]); // fires once when counter hits 0

  const handleSpin = () => {
    if (spinning || autoSpin) return;
    // Free spins are played manually — no auto-play during bonus round
    spinOnce(bet, freeSpinsLeft > 0);
  };

  const handleDevThreeScatters = () => {
    if (spinning || autoSpin || freeSpinsLeft > 0 || showFreeSpinsEntry || showBonusEnd) return;
    spinOnce(bet, false, true);
  };

  // Owner-only development shortcut: hold Shift, press O, then press P.
  useEffect(() => {
    if (!import.meta.env.DEV || !isOwner) return;
    let shiftOPrimed = false;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      shiftOPrimed = false;
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey) {
        reset();
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "o") {
        shiftOPrimed = true;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(reset, 1200);
        return;
      }
      if (key === "p" && shiftOPrimed) {
        event.preventDefault();
        reset();
        setShowDevThreeScatters(value => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      reset();
    };
  }, [isOwner, handleDevThreeScatters]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      ref={wrapperRef}
      style={{
        width: "100%", height: "100%",
        background: "#060208",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* ── Header bar ── */}
      <div style={{
        flexShrink: 0,
        height: HEADER_H,
        background: "rgba(6,2,8,0.95)",
        borderBottom: "1px solid rgba(185,28,28,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        zIndex: 50,
      }}>
        {/* Back button */}
        <button
          onClick={() => navigate("/slots")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6,
            color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: "Oswald, sans-serif",
            letterSpacing: "0.06em", textTransform: "uppercase",
            padding: "4px 8px", borderRadius: 6,
            transition: "color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.9)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}
        >
          ← Slots
        </button>

        {/* Logo */}
        <div style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          fontFamily: "Oswald, sans-serif", fontWeight: 700,
          fontSize: 20, letterSpacing: "0.12em", textTransform: "uppercase",
          color: "#dc2626",
          textShadow: "0 0 18px rgba(220,38,38,0.55)",
          userSelect: "none",
        }}>
          Big House Casino
        </div>

      </div>

      {/* ── Game area — remaining height ── */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#060208" }}>

      {/* Fixed-size 1920×1080 canvas — centered and scaled to fit game area */}
      <div
        style={{
          width: CW, height: CH,
          flexShrink: 0,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* ── Background ── */}
        <img
          src={RS + `screen/${
            freeSpinsLeft > 0 || freeSpinsTotal > 0 || showFreeSpinsEntry
              ? "BKGNight.webp"
              : "BKG.webp"
          }`}
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }}
        />
        {(freeSpinsLeft > 0 || freeSpinsTotal > 0 || showFreeSpinsEntry) && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: 0.72,
              backgroundImage: [
                "repeating-linear-gradient(108deg, transparent 0px, transparent 15px, rgba(190,215,255,0.24) 16px, rgba(190,215,255,0.24) 17px, transparent 18px, transparent 34px)",
                "repeating-linear-gradient(106deg, transparent 0px, transparent 27px, rgba(145,185,245,0.18) 28px, rgba(145,185,245,0.18) 29px, transparent 30px, transparent 54px)",
                "repeating-linear-gradient(110deg, transparent 0px, transparent 43px, rgba(220,235,255,0.14) 44px, rgba(220,235,255,0.14) 45px, transparent 46px, transparent 78px)",
              ].join(","),
              backgroundSize: "100px 150px, 140px 190px, 180px 240px",
              animation: "romeBonusRain 0.95s linear infinite",
              mixBlendMode: "screen",
            }}
          />
        )}
        {(freeSpinsLeft > 0 || freeSpinsTotal > 0 || showFreeSpinsEntry) && (
          <>
            {/* BKGNight storm atmosphere — kept behind the machine artwork */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "-12%",
                right: "-12%",
                top: "-18%",
                height: "58%",
                borderRadius: "0 0 50% 50%",
                background: "radial-gradient(ellipse at 18% 65%, rgba(80,100,138,0.42) 0 12%, transparent 32%), radial-gradient(ellipse at 56% 48%, rgba(42,61,96,0.54) 0 16%, transparent 38%), radial-gradient(ellipse at 84% 70%, rgba(67,84,119,0.38) 0 14%, transparent 34%), linear-gradient(180deg, rgba(2,7,19,0.82), rgba(14,25,48,0.56) 72%, transparent)",
                filter: "blur(10px)",
                animation: "stormCloudDrift 8s ease-in-out infinite",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(170,205,255,0.34)",
                animation: "stormLightningFlash 12s linear 1.4s infinite",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                boxShadow: "inset 0 0 160px rgba(115,175,255,0.48)",
                animation: "stormGlowPulse 12s linear 1.4s infinite",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "8%",
                right: "8%",
                top: "25%",
                height: "32%",
                borderRadius: "50%",
                background: "radial-gradient(ellipse, rgba(158,204,255,0.34) 0%, rgba(105,166,240,0.12) 32%, transparent 72%)",
                filter: "blur(14px)",
                animation: "stormHorizonPulse 12s linear 1.4s infinite",
                pointerEvents: "none",
              }}
            />
          </>
        )}

        {/* ── Machine frame ── */}
        <img
          src={RS + "screen/SlotMachine3x5.webp"}
          draggable={false}
          style={{ position: "absolute", left: M.x, top: M.y, width: M.w, height: M.h, userSelect: "none" }}
        />

        {/* ── Reel grid ── */}
        {Array.from({ length: REELS }, (_, reelIdx) => (
          <div
            key={reelIdx}
            ref={el => { reelContainerRefs.current[reelIdx] = el; }}
            style={{
              position: "absolute",
              left: REEL_COLS[reelIdx].left,
              top: MACHINE_REEL_TOP,
              width: REEL_COLS[reelIdx].w,
              height: ROW_H * ROWS,
              overflow: "hidden",
            }}
          >
            {/* Inner strip — animation drives transform directly on this div, no React re-renders */}
            <div
              ref={el => { stripRefs.current[reelIdx] = el; }}
              style={{ position: "absolute", top: 0, width: "100%", willChange: "transform" }}
            >
              {strips[reelIdx].map((sym, symIdx) => {
                // The server result is placed at the beginning of each strip.
                // The animation scrolls down to translateY=0, so these are
                // the three images visible in the stopped result window.
                const isResultCell = symIdx < ROWS;
                const resultRow = symIdx;
                const cellIdx = reelIdx * ROWS + resultRow;
                return (
                  <div
                    key={symIdx}
                    style={{
                      width: "100%",
                      height: ROW_H,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <img
                      ref={isResultCell ? el => { cellImgRefs.current[cellIdx] = el; } : undefined}
                      src={`${RS}symbols/${sym}.webp`}
                      draggable={false}
                       style={{
                         width: 240,
                         height: 210,
                         objectFit: "contain",
                         userSelect: "none",
                         transform: sym === "Wild"
                           ? `translateX(${WILD_CENTER_OFFSET_X}px)`
                           : undefined,
                       }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── Symbol animation overlays — always in DOM so refs are stable ──
              Visibility toggled by stopSymbolAnims / startSymbolAnims via direct DOM.
              reelsStopped drives initial visibility mount; after that the RAF loop owns it. */}
        {Array.from({ length: REELS }, (_, col) =>
          Array.from({ length: ROWS }, (_, row) => {
            const idx = col * ROWS + row;
            return (
              <div
                key={`sa-${col}-${row}`}
                style={{
                  position: "absolute",
                  left: REEL_COLS[col].left,
                  top: MACHINE_REEL_TOP + row * ROW_H,
                  width: REEL_COLS[col].w,
                  height: ROW_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                   overflow: "hidden",
                   zIndex: 27,
                }}
              >
                <canvas
                  ref={el => { animCanvasRefs.current[idx] = el; }}
                    width={SYMBOL_VIEW_W}
                    height={SYMBOL_VIEW_H}
                  style={{
                     width: 240, height: 210,
                     transform: visibleSymsRef.current[idx] === "Wild"
                       ? `translateX(${WILD_CENTER_OFFSET_X}px)`
                       : undefined,
                    imageRendering: "pixelated",
                    visibility: "hidden",
                  }}
                />
              </div>
            );
          })
        )}

        {/* ── Payline glow overlay — pointer-events:none, z-index:20 ── */}
        <PaylineOverlay
          wins={overlayWins}
          onLineActive={onPaylineActive}
          onLineStart={onPaylineStart}
          onFirstPassComplete={onPaylineFirstPassComplete}
          hideTotalWin={freeSpinsLeft > 0 || showFreeSpinsEntry || showBonusEnd}
          westernBonusTiming={freeSpinsLeft > 0 || showFreeSpinsEntry}
        />

        {/* ── Compact HUD copied from Western Slots; Rome handlers/state remain bound ── */}
        {(() => {
          const bonusHudActive = freeSpinsLeft > 0 || freeSpinsTotal > 0 || showFreeSpinsEntry || showBonusEnd;
          const betProgress = betSteps.length > 1
            ? Math.max(0, Math.min(1, betSteps.indexOf(bet) / (betSteps.length - 1)))
            : 0;
          return (
            <div data-western-settings-menu style={{
              position:"absolute",left:"50%",top:900,width:"fit-content",minWidth:980,height:112,
              transform:"translateX(-50%)",maxWidth:"calc(100% - 32px)",
              zIndex:100,boxSizing:"border-box",display:"flex",alignItems:"center",
              padding:"0 24px",background:"linear-gradient(180deg,rgba(24,24,28,0.92) 0%,rgba(15,15,18,0.88) 100%)",
              border:"1px solid rgba(255,255,255,0.08)",borderRadius:10,
              boxShadow:"0 10px 30px rgba(0,0,0,0.42),0 0 0 1px rgba(0,0,0,0.25)",
              fontFamily:"Oswald,sans-serif",
            }}>
              {import.meta.env.DEV && isOwner && showDevThreeScatters && (
                <button
                  type="button"
                  onClick={handleDevThreeScatters}
                  disabled={spinning || autoSpin || freeSpinsLeft > 0 || showFreeSpinsEntry || showBonusEnd}
                  style={{
                    position: "absolute", right: 12, bottom: -34,
                    border: "1px solid rgba(255,190,60,0.55)",
                    borderRadius: 5, padding: "4px 8px",
                    background: "rgba(70,35,0,0.85)",
                    color: "#fcd34d", fontFamily: "Oswald,sans-serif",
                    fontSize: 11, letterSpacing: "0.08em", cursor: "pointer",
                    opacity: spinning || autoSpin || freeSpinsLeft > 0 || showFreeSpinsEntry || showBonusEnd ? 0.45 : 1,
                  }}
                >
                  DEV: 3 SCATTERS
                </button>
              )}
              <div data-western-settings-menu onClick={()=>setShowSfx(v=>!v)}
                aria-label={showSfx?"Close settings":"Open settings"} style={{
                width:50,height:50,borderRadius:7,flexShrink:0,background:"transparent",border:"1px solid transparent",
                display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",cursor:"pointer",
              }}>
                {showSfx
                  ? <X size={50} strokeWidth={3.2} color="white" />
                  : <Menu size={50} strokeWidth={3.2} color="white" />}
              </div>
              {showSfx && (
                <div data-western-settings-menu style={{
                  position:"absolute",left:0,bottom:"calc(100% - 4px)",width:210,minHeight:300,boxSizing:"border-box",
                  padding:"18px 14px",zIndex:1000,background:"rgba(8,8,9,0.99)",
                  border:"1px solid rgba(255,255,255,0.10)",borderRadius:12,boxShadow:"0 10px 24px rgba(0,0,0,0.55)",
                  display:"flex",flexDirection:"column",gap:8,fontFamily:"Oswald,sans-serif",
                }}>
                  <button style={{width:"100%",boxSizing:"border-box",height:62,display:"grid",alignItems:"center",columnGap:9,
                    gridTemplateColumns:"auto 1fr auto",gridTemplateRows:"1fr 24px",padding:"0 10px",border:"none",
                    background:"transparent",color:"rgba(255,255,255,0.82)",cursor:"default",fontFamily:"inherit",fontSize:15,fontWeight:600,
                    letterSpacing:"0.08em",textAlign:"left"}}
                    onMouseEnter={e=>{e.currentTarget.style.color="#fff";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.82)";}}>
                    <span onClick={()=>{const next=!sfxMuted;setSfxMuted(next);setRomeSfxMuted(next);}} style={{display:"flex",cursor:"pointer"}}
                      aria-label={sfxMuted?"Unmute sound":"Mute sound"}>
                      {sfxMuted?<VolumeX size={19} strokeWidth={2}/>:<Volume2 size={19} strokeWidth={2}/>}
                    </span>
                    <span>SOUND</span>
                    <span style={{fontSize:11,opacity:0.9,marginLeft:5,color:sfxMuted?"#ff5b5b":"rgba(255,255,255,0.62)"}}>{sfxMuted?"MUTED":`${Math.round(sfxVolume*100)}%`}</span>
                    <input aria-label="Sound volume" type="range" min="0" max="1" step="0.01" value={sfxVolume}
                      onClick={e=>e.stopPropagation()} onChange={e=>updateSfxVolume(Number(e.target.value))}
                      style={{gridColumn:"1 / -1",width:"100%",accentColor:"#fff",cursor:"pointer"}}/>
                  </button>
                  <button style={{width:"100%",boxSizing:"border-box",height:62,display:"grid",alignItems:"center",columnGap:9,
                    gridTemplateColumns:"auto 1fr auto",gridTemplateRows:"1fr 24px",padding:"0 10px",border:"none",
                    background:"transparent",color:"rgba(255,255,255,0.82)",cursor:"default",fontFamily:"inherit",fontSize:15,fontWeight:600,
                    letterSpacing:"0.08em",textAlign:"left"}}
                    onMouseEnter={e=>{e.currentTarget.style.color="#fff";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.82)";}}>
                    <span onClick={toggleMusic} style={{display:"flex",cursor:"pointer"}}
                      aria-label={musicEnabled?"Turn music off":"Turn music on"}>
                      <Music2 size={19} strokeWidth={2}/>
                    </span>
                    <span>MUSIC</span>
                    <span style={{fontSize:11,opacity:0.9,marginLeft:5,color:!musicEnabled?"#ff5b5b":"rgba(255,255,255,0.62)"}}>{!musicEnabled?"MUTED":`${Math.round(musicVolume*100)}%`}</span>
                    <input aria-label="Music volume" type="range" min="0" max="1" step="0.01" value={musicVolume}
                      onClick={e=>e.stopPropagation()} onChange={e=>updateMusicVolume(Number(e.target.value))}
                      style={{gridColumn:"1 / -1",width:"100%",accentColor:"#fff",cursor:"pointer"}}/>
                  </button>
                  <button onClick={()=>{setShowSfx(false);setShowInfo(true)}} style={{height:48,display:"flex",alignItems:"center",gap:10,
                    width:"100%",boxSizing:"border-box",padding:"0 10px",border:"none",borderRadius:5,background:"transparent",
                    color:"rgba(255,255,255,0.82)",cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:600,letterSpacing:"0.08em",textAlign:"left"}}
                    onMouseEnter={e=>{e.currentTarget.style.color="#fff";}}
                    onMouseLeave={e=>{e.currentTarget.style.color="rgba(255,255,255,0.82)";}}>
                    <Info size={19} strokeWidth={2}/><span>INFO</span>
                  </button>
                </div>
              )}
              <div style={{width:24,flexShrink:0}}/>
              <div style={{display:"flex",alignItems:"center",gap:34,flexShrink:0,padding:"0 10px"}}>
                {[
                  ["Balance", chips.toLocaleString(), 106],
                  ["Win", lastWin > 0 ? displayedWin.toLocaleString() : "—", 76],
                ].map(([label,value,minWidth])=>(
                  <div key={String(label)} style={{minWidth:Number(minWidth)}}>
                    <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.55)",letterSpacing:"0.14em",textTransform:"uppercase"}}>{label}</div>
                    <div style={{fontSize:26,fontWeight:800,color:label==="Win"&&lastWin===0?"rgba(255,255,255,0.38)":"#fff",lineHeight:1.05}}>{value}</div>
                  </div>
                ))}
              </div>
              {bonusHudActive ? (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:34,paddingLeft:30,marginLeft:24,borderLeft:"1px solid rgba(255,255,255,0.18)"}}>
                    <div style={{minWidth:110}}>
                      <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.55)",letterSpacing:"0.14em",textTransform:"uppercase"}}>Bet</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#fff",lineHeight:1.05}}>{bet.toLocaleString()}</div>
                    </div>
                    <div style={{minWidth:150}}>
                      <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.55)",letterSpacing:"0.14em",textTransform:"uppercase"}}>Total Win</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#fff",lineHeight:1.05}}>{bonusWinTotal.toLocaleString()}</div>
                    </div>
                    <div style={{minWidth:190}}>
                      <div style={{fontSize:12,fontWeight:600,color:"rgba(255,255,255,0.55)",letterSpacing:"0.10em",textTransform:"uppercase"}}>Free Spins Remaining</div>
                      <div style={{fontSize:26,fontWeight:800,color:"#fff",lineHeight:1.05}}>{freeSpinsLeft}</div>
                    </div>
                  </div>
                </>
              ) : (
              <div style={{display:"flex",alignItems:"center",flex:1}}>
                <div style={{display:"flex",alignItems:"stretch",height:64,flexShrink:0,marginLeft:"auto",background:"#222228",
                  border:"1px solid rgba(255,255,255,0.11)",borderRadius:8,overflow:"hidden",position:"relative"}}>
                  <div style={{padding:"0 18px",borderRight:"1px solid rgba(255,255,255,0.07)",display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",textAlign:"center"}}>
                    <div style={{fontSize:13,fontWeight:600,color:"rgba(255,255,255,0.42)",letterSpacing:"0.13em",textTransform:"uppercase",marginBottom:2}}>Total Bet</div>
                    <div style={{fontSize:28,fontWeight:800,color:"#fff",lineHeight:1,minWidth:104}}>{bet.toLocaleString()}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",width:52}}>
                    <button disabled={spinning} onClick={()=>changeBet("increase")} onPointerDown={()=>startBetHold("increase")} onPointerUp={stopBetHold} onPointerCancel={stopBetHold} onPointerLeave={stopBetHold}
                      style={{flex:1,background:"transparent",border:"none",borderBottom:"1px solid rgba(255,255,255,0.07)",cursor:spinning?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                      <ChevronUp size={22} strokeWidth={2.5} color="white"/>
                    </button>
                    <button disabled={spinning} onClick={()=>changeBet("decrease")} onPointerDown={()=>startBetHold("decrease")} onPointerUp={stopBetHold} onPointerCancel={stopBetHold} onPointerLeave={stopBetHold}
                      style={{flex:1,background:"transparent",border:"none",cursor:spinning?"not-allowed":"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                      <ChevronDown size={22} strokeWidth={2.5} color="white"/>
                    </button>
                  </div>
                  <div aria-hidden="true" style={{position:"absolute",left:0,right:52,bottom:0,height:3,background:"rgba(255,255,255,0.12)",pointerEvents:"none"}}>
                    <div style={{height:"100%",width:`${Math.max(6,betProgress*100)}%`,background:"#fff",transition:"width 160ms ease-out"}}/>
                  </div>
                </div>
                <div onClick={!spinning?handleSpin:undefined} style={{width:104,height:104,borderRadius:"50%",flexShrink:0,marginLeft:18,
                  background:spinning?"#1a1a20":"radial-gradient(circle at 38% 36%,#30303a,#16161b)",
                  border:spinning?"2px solid rgba(255,255,255,0.06)":"2px solid rgba(255,255,255,0.22)",
                  boxShadow:spinning?"none":"0 0 24px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.08)",
                  display:"flex",alignItems:"center",justifyContent:"center",cursor:spinning?"not-allowed":"pointer",opacity:spinning?0.45:1,transition:"opacity 0.2s,border-color 0.2s"}}>
                  <RotateCw size={56} strokeWidth={2} color="white"/>
                </div>
                <div style={{width:16}}/>
                <div onClick={()=>setAutoSpin(a=>!a)} style={{width:64,height:64,borderRadius:"50%",flexShrink:0,background:autoSpin?"rgba(255,208,40,0.12)":"#222228",
                  border:autoSpin?"2px solid rgba(255,208,40,0.55)":"1.5px solid rgba(255,255,255,0.14)",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                  <RefreshCw size={30} strokeWidth={2} color={autoSpin?"#FFD028":"rgba(255,255,255,0.7)"}/>
                </div>
              </div>
              )}
            </div>
          );
        })()}

        {/* ── Error toast ── */}
        {errMsg && (
          <div style={{
            position: "absolute", left: "50%", top: 60, transform: "translateX(-50%)",
            background: "rgba(139,26,26,0.92)", border: "1px solid rgba(200,60,60,0.5)",
            borderRadius: 8, padding: "10px 22px",
            fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 16,
            color: "#fff", letterSpacing: "0.08em", zIndex: 30,
          }}>
            {errMsg}
          </div>
        )}

        {/* win popup is rendered OUTSIDE scaled canvas below */}

      </div>{/* ── end scaled canvas ── */}

      {/* ── Huge/Mega win popup — Rome artwork with Western-style count-up ── */}
      {bigWinPopup && !showBonusEnd && !showFreeSpinsEntry && (
        <div
          role="dialog"
          aria-label={`${bigWinPopup.tier} win`}
          onClick={() => setBigWinPopup(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9998,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.68)", cursor: "pointer",
          }}
        >
          <div
            onClick={event => event.stopPropagation()}
            style={{
              position: "relative",
              width: bigWinPopup.tier === "mega" ? 331 : 349,
              height: bigWinPopup.tier === "mega" ? 368 : 371,
              animation: "bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both",
              filter: bigWinPopup.tier === "mega"
                ? "drop-shadow(0 0 34px rgba(255,204,0,0.82))"
                : "drop-shadow(0 0 30px rgba(255,136,0,0.78))",
            }}
          >
            <img
              src={RS + `popups/${bigWinPopup.tier === "mega" ? "MegaWinPanel.webp" : "HugeWinPanel.webp"}`}
              draggable={false}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
            <div style={{
              position: "absolute", left: 0, right: 0, top: "57%",
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: 5, animation: "bonusCountPop 0.7s ease-out 0.15s both",
            }}>
              <div style={{
                fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 48,
                lineHeight: 1, color: bigWinPopup.tier === "mega" ? "#ffe880" : "#ffd580",
                letterSpacing: "0.02em",
                textShadow: bigWinPopup.tier === "mega"
                  ? "0 0 22px #ffcc00, 0 3px 8px rgba(0,0,0,0.95)"
                  : "0 0 22px #ff8800, 0 3px 8px rgba(0,0,0,0.95)",
              }}>
                {displayedWin.toLocaleString()}
              </div>
              <div style={{
                fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 22,
                color: "#fff4c2", letterSpacing: "0.08em",
                textShadow: "0 2px 5px rgba(0,0,0,0.9)",
              }}>
                {bigWinPopup.multiplier.toFixed(2)}×
              </div>
              <div style={{
                fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 12,
                color: "rgba(255,244,194,0.78)", letterSpacing: "0.22em",
              }}>
                {bigWinPopup.tier === "mega" ? "MEGA WIN" : "HUGE WIN"}
              </div>
            </div>
            <div style={{
              position: "absolute", bottom: -34, left: 0, right: 0,
              textAlign: "center", fontFamily: "Cinzel,serif", fontSize: 11,
              color: "rgba(255,244,194,0.45)", letterSpacing: "0.22em",
            }}>
              TAP TO CONTINUE
            </div>
          </div>
        </div>
      )}

      {/* ── Bonus active: screen edge glow ── */}
      {freeSpinsLeft > 0 && !showBonusEnd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9990, pointerEvents: "none",
          border: "3px solid rgba(245,158,11,0.4)", borderRadius: 2,
          animation: "bonusEdgePulse 1.8s ease-in-out infinite" }} />
      )}

      {/* ── Bonus entry panel — full-screen overlay when bonus triggers ── */}
      {showFreeSpinsEntry && (
        <div
          onClick={() => {
            freeSpinsEntryRef.current = false;
            setShowFreeSpinsEntry(false);
            playBonusMusic();
            autoSpinRef.current = true;
            setAutoSpin(true);
          }}
          style={{
            position: "fixed", inset: 0, zIndex: 10000, cursor: "pointer",
             background: "radial-gradient(ellipse at 50% 45%, rgba(18,30,56,0.96) 0%, rgba(3,7,18,0.99) 68%, rgba(1,3,10,1) 100%)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}
        >
           {/* Storm clouds */}
          <div style={{
             position: "absolute", left: "-12%", right: "-12%", top: "-18%", height: "58%",
             borderRadius: "0 0 50% 50%",
             background: "radial-gradient(ellipse at 18% 65%, rgba(80,100,138,0.45) 0 12%, transparent 32%), radial-gradient(ellipse at 56% 48%, rgba(42,61,96,0.58) 0 16%, transparent 38%), radial-gradient(ellipse at 84% 70%, rgba(67,84,119,0.42) 0 14%, transparent 34%), linear-gradient(180deg, rgba(2,7,19,0.98), rgba(14,25,48,0.7) 72%, transparent)",
             filter: "blur(10px)",
             animation: "stormCloudDrift 8s ease-in-out infinite",
            pointerEvents: "none",
          }} />

           {/* Rain curtain */}
           <div style={{
             position: "absolute", inset: 0, pointerEvents: "none",
             backgroundImage: [
               "repeating-linear-gradient(108deg, transparent 0 18px, rgba(178,211,255,0.22) 19px 20px, transparent 21px 42px)",
               "repeating-linear-gradient(106deg, transparent 0 29px, rgba(126,174,237,0.18) 30px 31px, transparent 32px 66px)",
               "repeating-linear-gradient(110deg, transparent 0 47px, rgba(220,235,255,0.14) 48px 49px, transparent 50px 94px)",
             ].join(","),
             backgroundSize: "100px 180px, 150px 230px, 210px 300px",
             animation: "stormRainFall 1.05s linear infinite",
             mixBlendMode: "screen",
           }} />

            {/* Distant lightning flashes — no foreground bolts */}
           <div aria-hidden="true" style={{
             position: "absolute", inset: 0, pointerEvents: "none",
              background: "rgba(170,205,255,0.7)",
              animation: "stormLightningFlash 12s linear 0.35s infinite",
           }} />
           <div aria-hidden="true" style={{
             position: "absolute", inset: 0, pointerEvents: "none",
             boxShadow: "inset 0 0 160px rgba(115,175,255,0.8)",
              animation: "stormGlowPulse 12s linear 0.35s infinite",
            }} />
            <div aria-hidden="true" style={{
              position: "absolute", left: "8%", right: "8%", top: "25%", height: "32%",
              borderRadius: "50%", pointerEvents: "none",
              background: "radial-gradient(ellipse, rgba(158,204,255,0.64) 0%, rgba(105,166,240,0.2) 32%, transparent 72%)",
              filter: "blur(14px)",
              animation: "stormHorizonPulse 12s linear 0.35s infinite",
           }} />

           {/* Entry text card — styled to match the bonus exit scene */}
           <div style={{
             display: "flex", flexDirection: "column", alignItems: "center",
             gap: 0, padding: "40px 72px 36px",
             background: "rgba(0,0,0,0.55)",
             borderRadius: 22,
             boxShadow: "0 0 90px rgba(120,180,255,0.24), inset 0 0 28px rgba(90,150,220,0.06)",
             border: "1px solid rgba(180,215,255,0.16)",
             animation: "bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both",
           }}>
             {/* BONUS ROUND title */}
             <div style={{
               fontFamily: "'Cinzel',serif", fontWeight: 900, fontSize: 52,
               color: "#fcd34d", letterSpacing: "0.12em",
               textShadow: "0 0 40px rgba(255,200,0,0.9), 0 0 80px rgba(255,140,0,0.4), 0 4px 10px rgba(0,0,0,0.9)",
               animation: "bonusTitleCrash 0.65s cubic-bezier(0.34,1.56,0.64,1) both, bonusShimmer 2.2s ease-in-out 0.65s infinite",
             }}>⚡ BONUS ROUND ⚡</div>

             {/* Subtitle */}
             <div style={{
               fontFamily: "'Cinzel',serif", fontWeight: 400, fontSize: 15,
               color: "rgba(252,211,77,0.55)", letterSpacing: "0.45em",
               textTransform: "uppercase", marginTop: 10, marginBottom: 28,
               animation: "bonusSubtitleSlide 0.45s ease-out 0.5s both",
             }}>Free Spins Awarded</div>

             {/* Count */}
             <div style={{
                position: "relative", top: -12,
               fontFamily: "'Oswald',sans-serif", fontWeight: 900, fontSize: 130,
               color: "#fff", lineHeight: 1,
               textShadow: "0 0 60px rgba(255,180,0,1), 0 0 120px rgba(255,120,0,0.5), 0 4px 12px rgba(0,0,0,0.9)",
               animation: "bonusCountPop 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.85s both",
             }}>{freeSpinsTotal}</div>

             {/* "FREE SPINS" label */}
             <div style={{
               fontFamily: "'Cinzel',serif", fontWeight: 700, fontSize: 24,
               color: "rgba(252,211,77,0.85)", letterSpacing: "0.28em",
               textShadow: "0 2px 8px rgba(0,0,0,0.8)",
               animation: "bonusSubtitleSlide 0.45s ease-out 1.1s both",
               marginTop: 6,
             }}>FREE SPINS</div>
           </div>

          {/* Tap hint */}
          <div style={{
            position: "absolute", bottom: "7%",
            fontFamily: "'Cinzel',serif", fontSize: 12,
            color: "rgba(255,210,80,0.35)", letterSpacing: "0.32em",
            textTransform: "uppercase",
            animation: "bonusSubtitleSlide 0.4s ease-out 1.6s both",
          }}>Tap anywhere to continue</div>
        </div>
      )}

      {/* ── Bonus round end ── */}
      {showBonusEnd && (
        <>
          {/* Layer 1 — dark backdrop; click anywhere to dismiss */}
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "all",
              background: "rgba(0,0,0,0.88)",
            }}
            onClick={() => {
              if (!bonusEndCountCompleteRef.current) {
                const finalValue = bonusWinRef.current;
                setBonusEndDisplayed(finalValue);
                if (bonusEndRafRef.current !== null) {
                  cancelAnimationFrame(bonusEndRafRef.current);
                  bonusEndRafRef.current = null;
                }
                bonusEndCountCompleteRef.current = true;
                setBonusEndCountComplete(true);
                stopWinCountSound();
                return;
              }
              dismissBonusEnd();
            }}
          />

          {/* Card content; entire layer is clickable to dismiss */}
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 10001,
              pointerEvents: "all",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!bonusEndCountCompleteRef.current) {
                const finalValue = bonusWinRef.current;
                setBonusEndDisplayed(finalValue);
                if (bonusEndRafRef.current !== null) {
                  cancelAnimationFrame(bonusEndRafRef.current);
                  bonusEndRafRef.current = null;
                }
                bonusEndCountCompleteRef.current = true;
                setBonusEndCountComplete(true);
                stopWinCountSound();
                return;
              }
              dismissBonusEnd();
            }}
          >
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
               animation: "bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both",
               background: "rgba(0,0,0,0.55)",
               borderRadius: 22,
               padding: "40px 72px 36px",
               boxShadow: "0 0 90px rgba(255,180,40,0.20)",
            }}>
              <div style={{
                 fontFamily: "'Cinzel',serif", fontWeight: 700, fontSize: 36,
                 color: "#FFD060", letterSpacing: "0.18em",
                 textShadow: "0 0 30px rgba(255,200,60,0.55),0 2px 6px rgba(0,0,0,0.85)",
               }}>
                 Congratulations
               </div>
               <div style={{
                 width: 160, height: 1, marginTop: -2,
                 background: "linear-gradient(90deg,transparent,rgba(255,200,80,0.55),transparent)",
               }} />
              <div style={{
                 fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 22,
                 color: "rgba(255,210,120,0.75)", letterSpacing: "0.40em",
                 textTransform: "uppercase", marginTop: -2,
               }}>
                 You Have Won
               </div>
              <div style={{
                 fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 110,
                color: "#fff", lineHeight: 1,
                 textShadow: "0 0 70px rgba(255,200,60,0.75),0 4px 14px rgba(0,0,0,0.9)",
               }}>
                 ${bonusEndDisplayed.toLocaleString(undefined, {
                   minimumFractionDigits: 2,
                   maximumFractionDigits: 2,
                 })}
               </div>
              <div style={{
                 fontFamily: "Oswald,sans-serif", fontSize: 20,
                 color: "rgba(255,210,100,0.75)", letterSpacing: "0.12em",
                 textTransform: "uppercase",
               }}>
                 In
                 <span style={{
                   fontFamily: "Oswald,sans-serif", fontWeight: 700,
                   fontSize: 30, letterSpacing: 0, color: "#FFD060",
                   margin: "0 12px", lineHeight: 1,
                   textShadow: "0 0 22px rgba(255,200,60,0.7),0 2px 6px rgba(0,0,0,0.85)",
                   verticalAlign: "-2px",
                 }}>{freeSpinsTotal}</span>
                 Free Spins
               </div>
              <div style={{
                 marginTop: 8,
                 fontFamily: "Oswald,sans-serif", fontWeight: 600, fontSize: 14,
                 letterSpacing: "0.30em", textTransform: "uppercase",
                 color: "rgba(255,210,120,0.45)",
                animation: "bonusClickPulse 1.8s ease-in-out infinite",
                userSelect: "none",
               }}>Tap to Continue</div>
            </div>
          </div>
        </>
      )}

      {/* ── Info / Paytable panel — rendered OUTSIDE scaled canvas so it fills viewport ── */}
      {showInfo && (
        <div
          style={{
            position: "fixed", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.78)", zIndex: 9999,
          }}
          onClick={() => setShowInfo(false)}
        >
          {/* Panel container — 1284×659 native, scaled independently to fill viewport */}
          <div
            style={{
              position: "relative", width: 1284, height: 659,
              transform: `scale(${infoScale})`, transformOrigin: "center center",
              flexShrink: 0,
            }}
            onClick={e => e.stopPropagation()}
          >
              <img
                src={RS + "popups/InfoPanel.webp"}
                draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }}
              />

              {/* Title */}
              <div style={{
                position: "absolute", left: 0, right: 0, top: 18,
                textAlign: "center",
                fontFamily: "'Cinzel',serif", fontWeight: 900,
                fontSize: 32, color: "#ffe566",
                textShadow: "0 0 24px rgba(255,180,0,0.9), 0 2px 8px #000, 0 0 2px #000",
                letterSpacing: "0.25em", textTransform: "uppercase",
              }}>
                Paytable
              </div>

              {/* ── Left column ── */}

              {/* Header row */}
              {([
                ["Symbol","center", 60,  72],
                ["Name",  "left",  138, 114],
                ["× 3",  "center", 258, 110],
                ["× 4",  "center", 374, 110],
                ["× 5",  "center", 490, 110],
              ] as const).map(([label, align, x, w]) => (
                <div key={label} style={{
                  position: "absolute", left: x, top: 70, width: w,
                  textAlign: align,
                  fontFamily: "'Cinzel',serif", fontWeight: 800,
                  fontSize: 15, color: "#ffd700",
                  textShadow: "0 1px 4px #000, 0 0 10px rgba(255,160,0,0.6)",
                  letterSpacing: "0.14em", textTransform: "uppercase",
                }}>
                  {label}
                </div>
              ))}

              {/* Header divider */}
              <div style={{
                position: "absolute", left: 56, width: 582, top: 94,
                height: 2, background: "linear-gradient(90deg, transparent, #c8a028, #ffd700, #c8a028, transparent)",
              }} />

              {/* Symbol rows — left */}
              {([
                ["BronzeCoin", "Bronze Coin",  5,  20,  60],
                ["CooperCoin", "Cooper Coin",  5,  25,  80],
                ["SilverCoin", "Silver Coin", 10,  30, 100],
                ["GoldCoin",   "Gold Coin",   10,  40, 150],
                ["Amphora",    "Amphora",     15,  60, 200],
              ] as const).map(([id, name, p3, p4, p5], ri) => (
                <div key={id} style={{
                  position: "absolute", left: 56, top: 98 + ri * 97, width: 582, height: 88,
                  display: "flex", alignItems: "center",
                  background: ri % 2 === 0 ? "rgba(0,0,0,0.28)" : "rgba(255,200,80,0.05)",
                  borderBottom: "1px solid rgba(200,160,40,0.3)",
                }}>
                  <img src={`${RS}symbols/${id}.webp`} draggable={false}
                    style={{ width: 72, height: 66, objectFit: "contain", flexShrink: 0 }} />
                  <span style={{ width: 114, fontFamily: "'Cinzel',serif", fontSize: 14, fontWeight: 700,
                    color: "#f0dfa0", textShadow: "0 1px 4px #000", letterSpacing: "0.04em" }}>{name}</span>
                  {[p3, p4, p5].map((v, vi) => (
                    <span key={vi} style={{ width: 110, textAlign: "center",
                      fontFamily: "'Cinzel',serif", fontWeight: 800,
                      fontSize: vi === 2 ? 20 : vi === 1 ? 18 : 16,
                      color: vi === 2 ? "#ffe566" : vi === 1 ? "#ffc940" : "#d4a830",
                      textShadow: vi === 2
                        ? "0 0 14px rgba(255,210,0,0.8), 0 1px 5px #000"
                        : "0 1px 4px #000",
                    }}>{v}</span>
                  ))}
                </div>
              ))}

              {/* Vertical divider */}
              <div style={{
                position: "absolute", left: 643, top: 64, bottom: 55,
                width: 2, background: "linear-gradient(180deg, transparent, #c8a028 10%, #ffd700 50%, #c8a028 90%, transparent)",
              }} />

              {/* ── Right column ── */}

              {/* Header row */}
              {([
                ["Symbol","center", 662,  72],
                ["Name",  "left",   738, 122],
                ["× 3",  "center",  866,  82],
                ["× 4",  "center",  950,  82],
                ["× 5",  "center", 1034,  82],
              ] as const).map(([label, align, x, w]) => (
                <div key={label + "r"} style={{
                  position: "absolute", left: x, top: 70, width: w,
                  textAlign: align,
                  fontFamily: "'Cinzel',serif", fontWeight: 800,
                  fontSize: 15, color: "#ffd700",
                  textShadow: "0 1px 4px #000, 0 0 10px rgba(255,160,0,0.6)",
                  letterSpacing: "0.14em", textTransform: "uppercase",
                }}>
                  {label}
                </div>
              ))}

              {/* Header divider — right */}
              <div style={{
                position: "absolute", left: 650, right: 54, top: 94,
                height: 2, background: "linear-gradient(90deg, transparent, #c8a028, #ffd700, #c8a028, transparent)",
              }} />

              {/* Symbol rows — right */}
              {([
                ["Wreath",  "Wreath",  20,  80,  300],
                ["Gladius", "Gladius", 25, 100,  500],
                ["Helmet",  "Helmet",  50, 200, 1000],
                ["Wild",    "Wild",   100, 500, 2000],
              ] as const).map(([id, name, p3, p4, p5], ri) => (
                <div key={id} style={{
                  position: "absolute", left: 650, top: 98 + ri * 97, right: 54, height: 88,
                  display: "flex", alignItems: "center",
                  background: ri % 2 === 0 ? "rgba(0,0,0,0.28)" : "rgba(255,200,80,0.05)",
                  borderBottom: ri < 3 ? "1px solid rgba(200,160,40,0.3)" : "none",
                }}>
                  <img src={`${RS}symbols/${id}.webp`} draggable={false}
                    style={{ width: 72, height: 66, objectFit: "contain", flexShrink: 0 }} />
                  <span style={{ width: 122, fontFamily: "'Cinzel',serif", fontSize: 14, fontWeight: 700,
                    color: "#f0dfa0", textShadow: "0 1px 4px #000", letterSpacing: "0.04em" }}>{name}</span>
                  {[p3, p4, p5].map((v, vi) => (
                    <span key={vi} style={{ width: 82, textAlign: "center",
                      fontFamily: "'Cinzel',serif", fontWeight: 800,
                      fontSize: vi === 2 ? 20 : vi === 1 ? 18 : 16,
                      color: vi === 2 ? "#ffe566" : vi === 1 ? "#ffc940" : "#d4a830",
                      textShadow: vi === 2
                        ? "0 0 14px rgba(255,210,0,0.8), 0 1px 5px #000"
                        : "0 1px 4px #000",
                    }}>{v}</span>
                  ))}
                </div>
              ))}

              {/* Scatter row — bottom */}
              <div style={{
                position: "absolute", left: 56, right: 54, bottom: 14,
                height: 76, display: "flex", alignItems: "center", gap: 14,
                background: "rgba(0,0,0,0.35)",
                borderTop: "2px solid rgba(200,160,40,0.5)",
                borderRadius: "0 0 4px 4px",
              }}>
                <img src={`${RS}symbols/Scatter.webp`} draggable={false}
                  style={{ width: 66, height: 58, objectFit: "contain", flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span style={{ fontFamily: "'Cinzel',serif", fontSize: 15, fontWeight: 800,
                    color: "#ffe566", textShadow: "0 0 12px rgba(255,200,0,0.7), 0 1px 4px #000",
                    letterSpacing: "0.12em" }}>SCATTER — Pays Anywhere</span>
                  <span style={{ fontFamily: "'Cinzel',serif", fontSize: 12, fontWeight: 600,
                    color: "#d4a830", textShadow: "0 1px 4px #000", letterSpacing: "0.04em" }}>
                    Also triggers FREE SPINS &amp; locks bet for the bonus round
                  </span>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 20, alignItems: "center", paddingRight: 12 }}>
                  {([
                    ["3×", "× 2 bet", "10 Free Spins"],
                    ["4×", "× 10 bet", "12 Free Spins"],
                    ["5×", "× 50 bet", "15 Free Spins"],
                  ] as const).map(([cnt, pay, fs]) => (
                    <div key={cnt} style={{ textAlign: "center", minWidth: 80 }}>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: 13, fontWeight: 700,
                        color: "#d4a830", textShadow: "0 1px 4px #000" }}>{cnt}</div>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: 15, fontWeight: 800,
                        color: "#ffe566", textShadow: "0 0 10px rgba(255,200,0,0.7), 0 1px 4px #000" }}>{pay}</div>
                      <div style={{ fontFamily: "'Cinzel',serif", fontSize: 11, fontWeight: 700,
                        color: "#4ade80", textShadow: "0 0 8px rgba(74,222,128,0.6), 0 1px 4px #000",
                        marginTop: 2 }}>{fs}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Wild note */}
              <div style={{
                position: "absolute", left: 662, top: 488, right: 60,
                fontFamily: "'Cinzel',serif", fontSize: 13, fontWeight: 600,
                color: "#c8a060", textShadow: "0 1px 4px #000",
                letterSpacing: "0.04em", lineHeight: 1.6,
              }}>
                <span style={{ color: "#ffe566", fontWeight: 800, textShadow: "0 0 10px rgba(255,200,0,0.6), 0 1px 4px #000" }}>WILD</span>{" "}
                substitutes for all symbols except Scatter.
              </div>

              {/* Close button */}
              <div
                onClick={() => setShowInfo(false)}
                style={{
                  position: "absolute", right: 24, top: 20,
                  cursor: "pointer", zIndex: 10,
                  width: 44, height: 44,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(0,0,0,0.5)",
                  border: "1px solid rgba(200,160,40,0.5)",
                  borderRadius: "50%",
                  fontFamily: "'Cinzel',serif", fontWeight: 900,
                  fontSize: 20, color: "rgba(255,215,0,0.9)",
                  lineHeight: 1,
                }}
              >
                ×
              </div>
            </div>
          </div>
        )}
      </div> {/* game area */}
    </div>
  );
}
