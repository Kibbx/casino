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
  playScatterLand,
  playBonusMusic,
  stopBonusMusic,
  playSmallWin,
  playHugeWin,
  playMegaWin,
  setRomeSfxVolume,
  setRomeSfxMuted,
  getRomeSfxVolume,
  getRomeSfxMuted,
} from "./rome-sounds";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";
import { PaylineOverlay, type PaylineWin } from "./payline-overlay";
import { BellagioChipsAnimation } from "./BellagioChipsAnimation";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SLOTS_MAINTENANCE = false;
const RS   = import.meta.env.BASE_URL + "rome-slots/";

const HEADER_H = 72; // px — fixed header bar height

// ── Layout constants — pixel-scanned from SlotMachine3x5.png ─────────────────
const CW = 1920; // canvas width
const CH = 1080; // canvas height

// Machine frame image (1720×946), centered on BKG (1920×1080)
const M = { x: 100, y: 0, w: 1720, h: 946 };

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
const REEL_TOP = M.y + 217;   // inner top of reel window
const ROW_H    = 216;          // (866-217)/3 = 216
const ROWS  = 3;
const REELS = 5;

// Bottom GUI panel image (1920×146)
const PANEL_Y = 934;
const PANEL_H = 146;

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
const REEL_PREFIXES = [16, 20, 24, 28, 32]; // symbols before the result per reel
const SPIN_SPEED    = 38;                    // px per requestAnimationFrame tick (~60fps)

// ── Scatter tease config ───────────────────────────────────────────────────────
// Extra symbols added per tease step. At SPIN_SPEED=38px/frame, 216px/row, 60fps:
// 30 symbols ≈ 2.8 s. Each reel in the chain gets 30 × step more, so they
// stop ~2.8 s apart and each one is clearly still spinning when the previous lands.
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
  const { playerId, sessionToken } = useStore();
  usePageTracker("rome-slots");
  usePasswordGuard("slots");
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
  const [winPopup, setWinPopup] = useState<WinTier>(null);
  const [winLineBreakdown, setWinLineBreakdown] = useState<{lineIndex:number;count:number;symbol:string;win:number}[]>([]);
  const [winIsFree, setWinIsFree] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [autoSpin, setAutoSpin] = useState(false);
  const autoSpinRef = useRef(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSfx, setShowSfx] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(getRomeSfxMuted);
  const [sfxVolume, setSfxVolume] = useState(getRomeSfxVolume);
  // Free spins mode
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0);
  const [freeSpinsTotal, setFreeSpinsTotal] = useState(0);
  const [showFreeSpinsBanner, setShowFreeSpinsBanner] = useState(false);
  const freeSpinsRef = useRef(0); // mirror for use inside callbacks
  const [bonusWinTotal, setBonusWinTotal] = useState(0);
  const bonusWinRef = useRef(0);
  const [showBonusEnd, setShowBonusEnd] = useState(false);
  const bonusEndResolveRef = useRef<(()=>void)|null>(null);
  // Animated value displayed in the bonus-end summary (count-up from 0 → bonusWinTotal)
  const [bonusEndDisplayed, setBonusEndDisplayed] = useState(0);
  const bonusEndRafRef = useRef<number | null>(null);
  const [showFreeSpinsEntry, setShowFreeSpinsEntry] = useState(false);
  const freeSpinsEntryRef  = useRef(false);  // ref mirror — readable inside spinOnce callback
  const bonusEverActiveRef = useRef(false);  // guard: prevents bonus-end firing on mount
  // True once reels have settled
  const [reelsStopped, setReelsStopped] = useState(false);
  // Winning paylines to display in the overlay (cleared on each new spin)
  const [overlayWins, setOverlayWins] = useState<PaylineWin[]>([]);
  const animRef        = useRef<number | null>(null);

  // ── Animated win counter ─────────────────────────────────────────────────
  const [displayedWin, setDisplayedWin] = useState(0);
  const winRafRef = useRef<number | null>(null);

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
    if (endValue <= 0) { setBonusEndDisplayed(0); return; }
    if (typeof window !== "undefined"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBonusEndDisplayed(endValue);
      return;
    }
    const duration = 5500; // 5.5 s — slow, dramatic reveal
    const startTime = performance.now();
    const tick = (now: number) => {
      const t     = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 5); // ease-out quintic — fast start, crawls to final value
      setBonusEndDisplayed(Math.round(eased * endValue));
      if (t < 1) {
        bonusEndRafRef.current = requestAnimationFrame(tick);
      } else {
        setBonusEndDisplayed(endValue); // exact final value — no float drift
        bonusEndRafRef.current = null;
      }
    };
    bonusEndRafRef.current = requestAnimationFrame(tick);
  }, []);
  // Direct DOM refs for each reel's inner strip
  const stripRefs          = useRef<(HTMLDivElement | null)[]>(Array(REELS).fill(null));
  // Outer reel container refs — used for dim/glow tease effects (no React re-render)
  const reelContainerRefs  = useRef<(HTMLDivElement | null)[]>(Array(REELS).fill(null));
  // Canvas refs for symbol animation overlays (15 cells: col*ROWS+row)
  const animCanvasRefs = useRef<(HTMLCanvasElement | null)[]>(Array(REELS * ROWS).fill(null));
  // Refs to the result-row static <img> elements in each reel strip (same 15-cell indexing)
  const cellImgRefs    = useRef<(HTMLImageElement | null)[]>(Array(REELS * ROWS).fill(null));
  // Which symbol is in each overlay cell (updated when reels stop)
  const visibleSymsRef = useRef<string[]>(Array(REELS * ROWS).fill("BronzeCoin"));
  // Pre-decoded frame Image objects: sym → frame array (index 0 = frame 1)
  const frameImgsRef   = useRef<Map<string, HTMLImageElement[]>>(new Map());
  // Interval handle for symbol animation (setInterval — immune to CEF RAF throttling)
  const symAnimIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    for (const cv of animCanvasRefs.current) {
      if (cv) {
        cv.style.visibility = "hidden";
        const ctx = cv.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
      }
    }
    // Restore the static reel-strip symbols that were hidden during animation
    for (const img of cellImgRefs.current) {
      if (img) img.style.visibility = "";
    }
  }, []);

  const startSymbolAnims = useCallback((winIndices: Set<number>) => {
    if (symAnimIntervalRef.current !== null) {
      clearInterval(symAnimIntervalRef.current);
      symAnimIntervalRef.current = null;
    }
    // Hide & clear all canvases
    for (const cv of animCanvasRefs.current) {
      if (!cv) continue;
      cv.style.visibility = "hidden";
      const ctx = cv.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
    }
    if (winIndices.size === 0) return;

    // Draw frame — only hide static img + show canvas once we can actually draw
    const drawFrame = (frame: number) => {
      animCanvasRefs.current.forEach((cv, idx) => {
        if (!cv || !winIndices.has(idx)) return;
        const sym = visibleSymsRef.current[idx];
        const frames = frameImgsRef.current.get(sym);
        if (!frames) return;
        const img = frames[frame % frames.length];
        // If image isn't decoded yet, leave static img visible and skip
        if (!img.complete || img.naturalWidth === 0) return;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        // Only hide the static img + reveal canvas after a successful draw
        cv.style.visibility = "visible";
        const staticImg = cellImgRefs.current[idx];
        if (staticImg) staticImg.style.visibility = "hidden";
      });
    };

    drawFrame(0);

    let frame = 1;
    const MS_PER_FRAME = Math.round(1000 / ANIM_FPS);
    symAnimIntervalRef.current = setInterval(() => {
      drawFrame(frame);
      frame = (frame + 1) % ANIM_FRAMES;
    }, MS_PER_FRAME);
  }, []);

  // Canvas scaling — ResizeObserver on wrapper so FiveM CEF tablet sizes work correctly
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale]           = useState(1);
  const [infoScale, setInfoScale]   = useState(1);
  const [popupScale, setPopupScale] = useState(1);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const availH = height - HEADER_H;
      setScale(Math.min(width / CW, availH / CH));
      setInfoScale(Math.min(width * 0.96 / 1284, availH * 0.96 / 659));
      setPopupScale(Math.min(width * 0.7 / 698, availH * 0.7 / 742));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const chips = displayChips;

  // ── Spin logic ──────────────────────────────────────────────────────────────
  const spinOnce = useCallback(async (currentBet: number, isFree = false): Promise<boolean> => {
    if (!sessionToken) return false;
    if (spinningRef.current) return false;
    if (freeSpinsEntryRef.current) return false; // block while bonus entry panel is open
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    // Cancel any in-progress count-up and snap display to 0 immediately
    if (winRafRef.current !== null) { cancelAnimationFrame(winRafRef.current); winRafRef.current = null; }
    setDisplayedWin(0);
    setWinPopup(null);
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
        body: isFree ? undefined : JSON.stringify({ bet: currentBet }),
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

    // ── 3. Build strips: prev result at index 0-2 (so y=0 matches old visual, no snap)
    //       then random padding, then tease padding (if any), then actual result ─
    const newStrips = REEL_PREFIXES.map((prefixCount, reelIdx) => {
      const prev = [0, 1, 2].map(r =>
        visibleSymsRef.current[reelIdx * ROWS + r] || "BronzeCoin"
      );
      return [
        ...prev,
        ...Array.from({ length: prefixCount }, () =>
          SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]
        ),
        ...Array.from({ length: teaseExtraSyms[reelIdx] }, () =>
          SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]
        ),
        data.grid[0][reelIdx],
        data.grid[1][reelIdx],
        data.grid[2][reelIdx],
      ];
    });
    setStrips(newStrips);

    // ── 3. Reset all strip positions to top (no transition) ──────────────────
    //       y=0 now shows the OLD result symbols → seamless, no visual snap
    for (const el of stripRefs.current) {
      if (el) { el.style.transition = "none"; el.style.transform = "translateY(0)"; }
    }

    // Wait 2 frames for React to re-render the new strips and browser to paint
    await new Promise(r => setTimeout(r, 32));

    // ── 4. Drive reel scroll via setInterval (RAF throttled in FiveM CEF) ──────
    //       Targets: result symbols are always the last ROWS entries in each strip.
    //       Decelerate smoothly over the final DECEL_ZONE px — no CSS transition
    //       snap, no overshoot, lands exactly on the target pixel.
    const yPos    = Array(REELS).fill(0);
    const stopped = Array(REELS).fill(false);
    const targets = newStrips.map(strip => -(strip.length - ROWS) * ROW_H);
    const DECEL_ZONE = ROW_H * 4; // decelerate over the last ~4 rows

    if (animRef.current) { clearInterval(animRef.current as any); animRef.current = null; }

    // Play spin click exactly when reels begin moving (not on button press) so
    // audio aligns with the visual start — no API-latency gap
    playSpinClick();

    // Track row index per reel for tick detection
    const lastRowIdx = Array(REELS).fill(0);

    // ── Tease visual helpers — direct DOM writes, no React re-render ──────────
    const applyTeaseDim = (idx: number) => {
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
            const remaining = yPos[i] - targets[i]; // positive, shrinking
            const speed = remaining > DECEL_ZONE
              ? SPIN_SPEED
              : Math.max(2, SPIN_SPEED * (remaining / DECEL_ZONE));
            yPos[i] -= speed;
            const el = stripRefs.current[i];
            // Snap + fire stop when within 1 step OR remaining imperceptible (<15% row)
            if (yPos[i] <= targets[i] || remaining < ROW_H * 0.15) {
              yPos[i] = targets[i]; // clamp — zero overshoot
              stopped[i] = true;
              if (el) { el.style.transition = "none"; el.style.transform = `translateY(${targets[i]}px)`; }

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

              // Play impact sound only for scatters in the first 3 columns
              if (scatterInCol[i] && i < 3) playScatterLand();

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
      new Promise<void>(r => setTimeout(r, Math.max(20000, Math.max(...targets.map(t => Math.abs(t))) / SPIN_SPEED * 16 * 1.4 + 3000))),
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
    // Compute winning cell indices (col*ROWS+row)
    const winIndices = new Set<number>();
    for (const lw of (data.lineWins as {lineIndex: number; count: number}[])) {
      const payline = PAYLINES[lw.lineIndex];
      for (let col = 0; col < lw.count; col++) {
        winIndices.add(col * ROWS + payline[col]);
      }
    }
    if ((data.scatters ?? 0) >= 3) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < REELS; c++) {
          if (data.grid[r]?.[c] === "Scatter") winIndices.add(c * ROWS + r);
        }
      }
    }
    setReelsStopped(true);
    setOverlayWins(Array.isArray(data.lineWins) ? data.lineWins : []);
    // Small delay so React renders the overlay imgs before the RAF loop touches them
    setTimeout(() => startSymbolAnims(winIndices), 16);

    // ── 6. Show win results ──────────────────────────────────────────────────
    setLastWin(data.totalWin);

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
      playBonusMusic();
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
    }

    const tier = winTier(data.totalWin, currentBet);
    // Start count-up animation — runs independently of popup/balance logic
    animateWinCount(data.totalWin, tier ?? "small");
    if (tier) {
      setWinLineBreakdown(Array.isArray(data.lineWins) ? data.lineWins : []);
      setWinIsFree(isFree);
      setWinPopup(tier);
      if (tier === "mega") playMegaWin();
      else if (tier === "huge") playHugeWin();
      else playSmallWin();
      const duration =
        tier === "mega"    ? 3500 :
        tier === "huge"    ? 3000 : isFree ? 1500 : 2000;
      await delay(duration);
      setWinPopup(null);
    }

    spinningRef.current = false;
    setSpinning(false);
    return true;
  }, [sessionToken, stopSymbolAnims, startSymbolAnims]);

  // Auto spin loop
  useEffect(() => {
    autoSpinRef.current = autoSpin;
  }, [autoSpin]);

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
    // Cancel auto-spin SYNCHRONOUSLY here — if we wait until inside the async
    // IIFE, the 700 ms delay gives the while-loop time to fire a paid spin.
    setAutoSpin(false);
    autoSpinRef.current = false;
    let cancelled = false;
    (async () => {
      await delay(700);
      if (cancelled) return;
      setBonusEndDisplayed(0);
      animateBonusEndCount(bonusWinRef.current);
      setShowBonusEnd(true);
      await new Promise<void>(r => { bonusEndResolveRef.current = r; });
      if (cancelled) return;
      setShowBonusEnd(false);
      bonusWinRef.current = 0;
      setBonusWinTotal(0);
      setBonusEndDisplayed(0);
      if (bonusEndRafRef.current !== null) {
        cancelAnimationFrame(bonusEndRafRef.current);
        bonusEndRafRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
      bonusEndResolveRef.current?.();
      bonusEndResolveRef.current = null;
      if (bonusEndRafRef.current !== null) {
        cancelAnimationFrame(bonusEndRafRef.current);
        bonusEndRafRef.current = null;
      }
    };
  }, [freeSpinsLeft === 0 ? 1 : 0]); // fires once when counter hits 0

  const handleSpin = () => {
    if (spinning || autoSpin) return;
    // Free spins are played manually — no auto-play during bonus round
    spinOnce(bet, freeSpinsLeft > 0);
  };

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

      {/* Backdrop — sibling to game viewport so overflow:hidden can't trap it */}
      {showSfx && <div onClick={() => setShowSfx(false)}
        style={{ position: "fixed", inset: 0, zIndex: 997 }} />}

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
          src={RS + "screen/BKG.webp"}
          draggable={false}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }}
        />

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
              top: REEL_TOP,
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
                // Result symbols are always the last ROWS entries in the strip
                const resultStart = strips[reelIdx].length - ROWS;
                const isResultCell = symIdx >= resultStart;
                const resultRow = symIdx - resultStart;
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
                      style={{ width: 240, height: 210, objectFit: "contain", userSelect: "none" }}
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
                  top: REEL_TOP + row * ROW_H,
                  width: REEL_COLS[col].w,
                  height: ROW_H,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                  zIndex: 8,
                }}
              >
                <canvas
                  ref={el => { animCanvasRefs.current[idx] = el; }}
                  width={250}
                  height={215}
                  style={{
                    width: 248, height: 218,
                    imageRendering: "pixelated",
                    visibility: "hidden",
                  }}
                />
              </div>
            );
          })
        )}

        {/* ── Payline glow overlay — pointer-events:none, z-index:20 ── */}
        <PaylineOverlay wins={overlayWins} />

        {/* ── Bottom GUI panel ── */}
        <img
          src={RS + "screen/PanelGUI.webp"}
          draggable={false}
          style={{
            position: "absolute", left: 0, top: PANEL_Y, width: CW, height: PANEL_H,
            userSelect: "none",
          }}
        />

        {/* ── Layout: [Set][Lines][−][TotalBet][+][MaxBet] [SPIN] [AutoSpin][Balance][Win][Info] ── */}

        {/* Settings button — far left (where Info was) */}
        <div
          onClick={() => setShowSfx(v => !v)}
          style={{ position: "absolute", left: 112, top: PANEL_Y + 28, cursor: "pointer",
            filter: showSfx ? "brightness(1.4) saturate(1.3)" : sfxMuted ? "brightness(0.5)" : "none",
            transition: "filter 0.15s" }}>
          <img src={RS + (showSfx ? "screen/ButtonSettingsHover.webp" : "screen/ButtonSettings.webp")}
            draggable={false} style={{ width: 52, height: 89, objectFit: "contain" }} />
        </div>

        {/* Info/paytable — far right (was far left) */}
        <div onClick={() => setShowInfo(true)}
          style={{ position: "absolute", left: 1772, top: PANEL_Y + 28, cursor: "pointer" }}>
          <img src={RS + "screen/ButtonInfo.webp"} draggable={false} style={{ width: 52, height: 89, objectFit: "contain" }} />
        </div>

        {/* Lines */}
        <PanelDisplay img={RS+"screen/PanelLines.webp"} w={196} h={88} x={174} y={PANEL_Y+29}
          label="Lines" value="20" highlight={false} />

        {/* Bet ◄ arrow (left of TotalBet) */}
        <div onClick={() => { if (!spinning) setBet(b => nextBet(b, -1, betSteps)); }}
          style={{ position: "absolute", left: 376, top: PANEL_Y+51, cursor: "pointer", userSelect: "none" }}>
          <img src={RS + "screen/ButtonMinus.webp"} draggable={false} style={{ width: 38, height: 44 }} />
        </div>

        {/* Total Bet */}
        <PanelDisplay img={RS+"screen/PanelTotalBet.webp"} w={240} h={88} x={416} y={PANEL_Y+29}
          label="Total Bet" value={bet.toLocaleString()} highlight={false} />

        {/* Bet ► arrow (right of TotalBet) */}
        <div onClick={() => { if (!spinning) setBet(b => nextBet(b, 1, betSteps)); }}
          style={{ position: "absolute", left: 658, top: PANEL_Y+51, cursor: "pointer", userSelect: "none" }}>
          <img src={RS + "screen/ButtonPlus.webp"} draggable={false} style={{ width: 38, height: 44 }} />
        </div>

        {/* MaxBet */}
        <div onClick={() => { if (!spinning) setBet(betSteps[betSteps.length-1]); }}
          style={{ position: "absolute", left: 700, top: PANEL_Y+31, cursor: "pointer" }}>
          <img src={RS + "screen/ButtonMaxBet.webp"} draggable={false} style={{ width: 132, height: 83 }} />
        </div>

        {/* SPIN — centered at x=960 */}
        <div onClick={handleSpin}
          style={{ position: "absolute", left: 840, top: PANEL_Y - 22, cursor: spinning ? "default" : "pointer" }}>
          <img
            src={RS + (spinning ? "screen/ButtonSpinHover.webp" : "screen/ButtonSpin.webp")}
            draggable={false}
            style={{ width: 240, height: 168, filter: spinning ? "brightness(0.7)" : "none", transition: "filter 0.15s" }}
          />
        </div>

        {/* AutoSpin */}
        <div onClick={() => { if (autoSpin) setAutoSpin(false); else if (!spinning) setAutoSpin(true); }}
          style={{ position: "absolute", left: 1092, top: PANEL_Y+31, cursor: "pointer", userSelect: "none" }}>
          <img src={RS + "screen/ButtonAutoSpin.webp"} draggable={false}
            style={{ width: 146, height: 83, filter: autoSpin ? "brightness(1.5) saturate(1.6)" : "none" }} />
        </div>

        {/* Balance */}
        <PanelDisplay img={RS+"screen/PanelBalance.webp"} w={246} h={88} x={1252} y={PANEL_Y+29}
          label="Balance" value={chips.toLocaleString()} highlight={false} />

        {/* Win */}
        <PanelDisplay img={RS+"screen/PanelWin.webp"} w={246} h={88} x={1512} y={PANEL_Y+29}
          label="Win" value={lastWin > 0 ? displayedWin.toLocaleString() : "—"} highlight={lastWin > 0} />

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

      {/* ── Bonus active: screen edge glow ── */}
      {freeSpinsLeft > 0 && !showBonusEnd && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9990, pointerEvents: "none",
          border: "3px solid rgba(245,158,11,0.4)", borderRadius: 2,
          animation: "bonusEdgePulse 1.8s ease-in-out infinite" }} />
      )}

      {/* ── Free spins counter pill (always visible during bonus) ── */}
      {freeSpinsLeft > 0 && !showBonusEnd && (
        <div style={{
          position: "fixed", top: "3%", left: "50%", transform: "translateX(-50%)",
          zIndex: 9996, pointerEvents: "none",
          background: "linear-gradient(135deg, rgba(30,10,0,0.97), rgba(60,20,0,0.97))",
          border: "2px solid rgba(245,158,11,0.65)",
          borderRadius: 50, padding: "8px 24px",
          display: "flex", alignItems: "center", gap: 18,
          animation: "freeSpinPulse 1.8s ease-in-out infinite",
        }}>
          <span style={{ fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 13,
            color: "rgba(252,211,77,0.75)", letterSpacing: "0.16em" }}>⚡ BONUS ROUND</span>
          <div style={{ width: 1, height: 28, background: "rgba(245,158,11,0.3)" }} />
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 38,
              color: "#fff", textShadow: "0 0 16px rgba(245,158,11,0.6)" }}>
              {freeSpinsLeft}
            </span>
            <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 16,
              color: "rgba(255,210,80,0.5)" }}>/ {freeSpinsTotal}</span>
          </div>
          {bonusWinTotal > 0 && (
            <>
              <div style={{ width: 1, height: 28, background: "rgba(245,158,11,0.3)" }} />
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                <span style={{ fontFamily: "Cinzel,serif", fontSize: 10,
                  color: "rgba(252,211,77,0.5)", letterSpacing: "0.15em" }}>WON</span>
                <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 22,
                  color: "#fcd34d", textShadow: "0 0 12px rgba(245,158,11,0.5)" }}>
                  +{bonusWinTotal.toLocaleString()}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Bonus entry panel — full-screen overlay when bonus triggers ── */}
      {showFreeSpinsEntry && (
        <div
          onClick={() => { freeSpinsEntryRef.current = false; setShowFreeSpinsEntry(false); }}
          style={{
            position: "fixed", inset: 0, zIndex: 10000, cursor: "pointer",
            background: "radial-gradient(ellipse at 50% 48%, rgba(70,24,0,0.97) 0%, rgba(6,2,0,0.99) 72%)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* Rotating conic rays */}
          <div style={{
            position: "absolute", inset: "-50%",
            backgroundImage: [
              "conic-gradient(from 0deg at 50% 50%,",
              "transparent 0deg, rgba(255,180,0,0.07) 8deg, transparent 16deg,",
              "transparent 30deg, rgba(255,160,0,0.05) 36deg, transparent 42deg,",
              "transparent 60deg, rgba(255,180,0,0.07) 66deg, transparent 72deg,",
              "transparent 90deg, rgba(255,160,0,0.05) 96deg, transparent 102deg,",
              "transparent 120deg, rgba(255,180,0,0.07) 126deg, transparent 132deg,",
              "transparent 150deg, rgba(255,160,0,0.05) 156deg, transparent 162deg,",
              "transparent 180deg, rgba(255,180,0,0.07) 186deg, transparent 192deg,",
              "transparent 210deg, rgba(255,160,0,0.05) 216deg, transparent 222deg,",
              "transparent 240deg, rgba(255,180,0,0.07) 246deg, transparent 252deg,",
              "transparent 270deg, rgba(255,160,0,0.05) 276deg, transparent 282deg,",
              "transparent 300deg, rgba(255,180,0,0.07) 306deg, transparent 312deg,",
              "transparent 330deg, rgba(255,160,0,0.05) 336deg, transparent 342deg)",
            ].join(" "),
            animation: "bonusRayRotate 12s linear infinite",
            pointerEvents: "none",
          }} />

          {/* Expanding rings */}
          {[0, 0.9, 1.8].map((delayS, i) => (
            <div key={i} style={{
              position: "absolute",
              width: 320, height: 320, borderRadius: "50%",
              border: `${i === 0 ? 2 : 1}px solid rgba(255,190,0,0.35)`,
              animation: `bonusRingExpand 2.4s ease-out ${delayS}s infinite`,
              pointerEvents: "none",
            }} />
          ))}

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
            onClick={() => { bonusEndResolveRef.current?.(); bonusEndResolveRef.current = null; }}
          />

          {/* Layer 2 — Bellagio chip fountain (pointer-events:none, sits behind card) */}
          <BellagioChipsAnimation active={showBonusEnd} total={bonusWinTotal} />

          {/* Layer 3 — card content; entire layer is clickable to dismiss */}
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 10001,
              pointerEvents: "all",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
            onClick={() => { bonusEndResolveRef.current?.(); bonusEndResolveRef.current = null; }}
          >
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              animation: "bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 20,
              padding: "36px 56px 32px",
              boxShadow: "0 0 80px rgba(245,158,11,0.18)",
            }}>
              <span style={{ fontSize: 52 }}>🏆</span>
              <div style={{
                fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 16,
                color: "rgba(252,211,77,0.65)", letterSpacing: "0.45em", textTransform: "uppercase",
              }}>Bonus Round Complete</div>
              <div style={{
                fontFamily: "Cinzel,serif", fontWeight: 900, fontSize: 48,
                color: "#fcd34d", letterSpacing: "0.06em",
                animation: "bonusShimmer 1.4s ease-in-out infinite",
              }}>TOTAL WON</div>
              <div style={{
                fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 96,
                color: "#fff", lineHeight: 1,
                textShadow: "0 0 60px rgba(245,158,11,0.8), 0 4px 12px rgba(0,0,0,0.9)",
              }}>+{bonusEndDisplayed.toLocaleString()}</div>
              <div style={{
                fontFamily: "Cinzel,serif", fontSize: 18,
                color: "rgba(252,211,77,0.45)", letterSpacing: "0.2em",
              }}>COINS</div>
              <div style={{
                marginTop: 18,
                fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 15,
                letterSpacing: "0.30em", textTransform: "uppercase",
                color: "#fcd34d",
                animation: "bonusClickPulse 1.8s ease-in-out infinite",
                userSelect: "none",
              }}>Click Anywhere to Continue</div>
            </div>
          </div>
        </>
      )}

      {/* ── Win popup — rendered OUTSIDE scaled canvas ── */}
      {winPopup && (() => {
        // Small win: compact SmallMessagesPanel (455×210 native, displayed at 2×)
        if (winPopup === "small") {
          // Clean styled win banner — no chat-box panel image
          return (
            <div style={{
              position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "none",
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              paddingBottom: "7%",
            }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                background: "linear-gradient(180deg, rgba(60,30,0,0.97) 0%, rgba(25,10,0,0.97) 100%)",
                border: "2px solid #b8860b",
                borderRadius: 6,
                padding: "10px 36px 12px",
                boxShadow: "0 0 24px rgba(200,140,0,0.5), 0 4px 20px rgba(0,0,0,0.8)",
              }}>
                <span style={{
                  fontFamily: "'Cinzel',serif", fontWeight: 400,
                  fontSize: 11, color: "rgba(255,210,80,0.8)",
                  letterSpacing: "0.28em", textTransform: "uppercase",
                }}>
                  {winIsFree ? "Bonus Win" : "You Win"}
                </span>
                <span style={{
                  fontFamily: "'Cinzel',serif", fontWeight: 900,
                  fontSize: 38, color: "#ffd700", lineHeight: 1,
                  textShadow: "0 0 18px rgba(255,180,0,0.9), 0 2px 6px rgba(0,0,0,0.9)",
                  letterSpacing: "0.04em",
                }}>
                  +{displayedWin.toLocaleString()}
                </span>
                {winLineBreakdown.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,marginTop:2}}>
                    {winLineBreakdown.map((lw,i)=>(
                      <span key={i} style={{fontFamily:"'Cinzel',serif",fontSize:10,
                        color:"rgba(255,220,110,0.7)",letterSpacing:"0.08em"}}>
                        Line {lw.lineIndex+1}: {lw.count}× {lw.symbol} → +{lw.win.toLocaleString()}{winIsFree?" ×2":""}
                      </span>
                    ))}
                  </div>
                )}
                <span style={{
                  fontFamily: "'Cinzel',serif", fontWeight: 500,
                  fontSize: 10, color: "rgba(200,160,60,0.75)",
                  letterSpacing: "0.22em", textTransform: "uppercase",
                  marginTop: 2,
                }}>
                  BET Coins
                </span>
              </div>
            </div>
          );
        }
        // Big wins: full overlay — textTop targets the dark red plaque area in each image
        const cfg = winPopup === "mega"
          ? { file: "MegaWinPanel",    w: 331, h: 368, textTop: "63%" }
          : { file: "HugeWinPanel",    w: 349, h: 371, textTop: "63%" };
        const pw = cfg.w * 2, ph = cfg.h * 2;
        return (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9998,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.65)",
          }}
            onClick={() => setWinPopup(null)}
          >
            <div style={{
              position: "relative", width: pw, height: ph,
              transform: `scale(${popupScale})`, transformOrigin: "center center",
            }}>
              <img
                src={RS + `popups/${cfg.file}.webp`}
                draggable={false}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }}
              />
              <div style={{
                position: "absolute", left: 0, right: 0, top: cfg.textTop,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}>
                <span style={{
                  fontFamily: "'Cinzel',serif", fontWeight: 900,
                  fontSize: 80, color: "#ffd700",
                  textShadow: "0 0 30px rgba(255,180,0,0.9), 0 0 60px rgba(255,120,0,0.5), 0 3px 8px rgba(0,0,0,0.9)",
                  letterSpacing: "0.04em", lineHeight: 1,
                }}>
                  +{displayedWin.toLocaleString()}
                </span>
                <span style={{
                  fontFamily: "'Cinzel',serif", fontWeight: 600,
                  fontSize: 24, color: "rgba(255,220,100,0.85)",
                  textShadow: "0 2px 6px rgba(0,0,0,0.8)",
                  letterSpacing: "0.18em", textTransform: "uppercase",
                }}>
                  BET Coins
                </span>
                {winLineBreakdown.length > 0 && (
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,marginTop:4}}>
                    {winLineBreakdown.map((lw,i)=>(
                      <span key={i} style={{fontFamily:"'Cinzel',serif",fontSize:11,
                        color:"rgba(255,230,130,0.75)",letterSpacing:"0.08em"}}>
                        Line {lw.lineIndex+1}: {lw.count}× {lw.symbol} → +{lw.win.toLocaleString()}{winIsFree?" ×2":""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Sound settings panel — rome SettingsPanel image ── */}
      {showSfx && (
        <>
          {/* Panel: 551×601 image → rendered at 240×261 (same ratio) */}
          <div onClick={e => e.stopPropagation()}
            style={{ position: "fixed", bottom: 72, left: 8, zIndex: 998,
              width: 240, height: 261, userSelect: "none" }}>
            <img src={RS + "popups/SettingsPanel.webp"} draggable={false}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />

            {/* Exit button — top-right corner */}
            <img
              src={RS + "popups/ExitButton.webp"} draggable={false}
              onClick={() => setShowSfx(false)}
              style={{ position: "absolute", top: "4%", right: "4%", width: 28, height: 28,
                cursor: "pointer", zIndex: 2 }}
              onMouseEnter={e => (e.currentTarget.src = RS + "popups/ExitButtonHover.webp")}
              onMouseLeave={e => (e.currentTarget.src = RS + "popups/ExitButton.webp")}
            />

            {/* Content area: dark panel starts at ~24% top, ~7% sides, ~5% bottom */}
            <div style={{
              position: "absolute",
              top: "26%", bottom: "6%", left: "9%", right: "9%",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "flex-start",
              paddingTop: 10, gap: 12, fontFamily: "Oswald, sans-serif",
            }}>
              {/* Sound label */}
              <span style={{ color: "#fbbf24", fontSize: 20, fontWeight: 700,
                letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2,
                textShadow: "0 0 8px rgba(251,191,36,0.5)" }}>
                Sound
              </span>

              {/* Mute — ON/OFF button image */}
              <div style={{ display: "flex", alignItems: "center",
                justifyContent: "space-between", width: "100%" }}>
                <span style={{ color: "#fde68a", fontSize: 13, fontWeight: 600,
                  letterSpacing: "0.05em" }}>Mute</span>
                <img
                  src={RS + (sfxMuted ? "popups/ButtonOff.webp" : "popups/ButtonOn.webp")}
                  draggable={false}
                  onClick={() => { const m = !sfxMuted; setSfxMuted(m); setRomeSfxMuted(m); }}
                  style={{ width: 80, height: 38, cursor: "pointer", transition: "opacity 0.15s" }}
                />
              </div>

              {/* Volume row */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                <span style={{ color: sfxMuted ? "rgba(253,230,138,0.3)" : "#fde68a",
                  fontSize: 12, fontWeight: 600, letterSpacing: "0.05em",
                  minWidth: 30, flexShrink: 0 }}>Vol</span>
                <input type="range" min={0} max={1} step={0.05} value={sfxVolume}
                  disabled={sfxMuted}
                  onChange={e => { const v = parseFloat(e.target.value); setSfxVolume(v); setRomeSfxVolume(v); }}
                  style={{ flex: 1, accentColor: "#dc2626", opacity: sfxMuted ? 0.25 : 1 }} />
                <span style={{ color: sfxMuted ? "rgba(253,230,138,0.3)" : "#fbbf24",
                  fontSize: 11, minWidth: 30, textAlign: "right", flexShrink: 0 }}>
                  {sfxMuted ? "—" : Math.round(sfxVolume * 100) + "%"}
                </span>
              </div>
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
                    ["3×", "× 2 bet", "8 Free Spins"],
                    ["4×", "× 10 bet", "12 Free Spins"],
                    ["5×", "× 50 bet", "18 Free Spins"],
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
