// Tournament-aware Rome (Fortuna) Slots — literal copy of rome-slots.tsx with only:
// 1. Header changed (tournament name, countdown, leaderboard button, back to lobby)
// 2. Spin endpoint → /api/tournaments/:id/spin
// 3. Balance label → "T-Chips", value → tChips (from server responses)
// 4. No free spins (tournament mode)
// All reel animation, sound, image layout = unchanged from rome-slots.tsx

import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../store";
import {
  playSpinClick,
  playReelTick,
  playReelStop,
  playSmallWin,
  playHugeWin,
  playMegaWin,
  setRomeSfxVolume,
  setRomeSfxMuted,
  getRomeSfxVolume,
  getRomeSfxMuted,
} from "./rome-sounds";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const RS   = import.meta.env.BASE_URL + "rome-slots/";

const HEADER_H = 72;
const CW = 1920;
const CH = 1080;
const M = { x: 100, y: 0, w: 1720, h: 946 };

const REEL_COLS = [
  { left: M.x + 223, w: 261 },
  { left: M.x + 484, w: 250 },
  { left: M.x + 734, w: 250 },
  { left: M.x + 984, w: 250 },
  { left: M.x + 1234, w: 250 },
];
const REEL_TOP = M.y + 217;
const ROW_H    = 216;
const ROWS  = 3;
const REELS = 5;
const PANEL_Y = 934;
const PANEL_H = 146;

const SYMBOL_IDS = [
  "BronzeCoin", "CooperCoin", "SilverCoin", "GoldCoin",
  "Amphora", "Wreath", "Gladius", "Helmet", "Wild", "Scatter",
];
const ANIM_SYMBOLS = new Set([
  "BronzeCoin","CooperCoin","SilverCoin","GoldCoin",
  "Gladius","Helmet","Wreath","Wild","Scatter",
]);
const ANIM_FRAMES = 24;
const ANIM_FPS    = 20;

const PAYLINES: number[][] = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
  [0,1,2,1,0],[2,1,0,1,2],
  [1,0,0,0,1],[1,2,2,2,1],
  [0,0,1,2,2],[2,2,1,0,0],
  [1,0,1,2,1],[1,2,1,0,1],
  [0,1,1,1,2],[2,1,1,1,0],
  [0,1,2,2,2],[2,1,0,0,0],
  [0,0,1,0,0],[2,2,1,2,2],
  [1,1,0,1,1],[1,1,2,1,1],
  [0,1,0,1,0],
  [0,2,0,2,0],[2,0,2,0,2],
  [1,2,0,2,1],[1,0,2,0,1],
  [2,0,0,2,0],
];

const SYMBOL_NAMES: Record<string, string> = {
  BronzeCoin: "Bronze Coin", CooperCoin: "Cooper Coin", SilverCoin: "Silver Coin",
  GoldCoin: "Gold Coin", Amphora: "Amphora", Wreath: "Wreath",
  Gladius: "Gladius", Helmet: "Helmet", Wild: "WILD", Scatter: "SCATTER",
};

const SYMBOL_PAYTABLE: Record<string, Partial<Record<number, number>>> = {
  BronzeCoin: {3:5,4:15,5:50},
  CooperCoin: {3:8,4:25,5:80},
  SilverCoin: {3:12,4:40,5:120},
  GoldCoin:   {3:20,4:60,5:200},
  Amphora:    {3:25,4:80,5:250},
  Wreath:     {3:35,4:100,5:350},
  Gladius:    {3:50,4:150,5:500},
  Helmet:     {3:80,4:250,5:800},
  Wild:       {3:100,4:400,5:2000},
  Scatter:    {},
};

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
const REEL_PREFIXES = [16, 20, 24, 28, 32];
const SPIN_SPEED    = 38;

function buildInitialStrips(): string[][] {
  return REEL_PREFIXES.map(pfx => [
    ...Array.from({ length: pfx }, () => SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]),
    "BronzeCoin", "BronzeCoin", "BronzeCoin",
  ]);
}

type WinTier = "small" | "huge" | "mega" | null;
function winTier(totalWin: number, bet: number): WinTier {
  if (totalWin <= 0) return null;
  const mult = totalWin / bet;
  if (mult >= 20) return "mega";
  if (mult >= 10) return "huge";
  return "small";
}

function PanelDisplay({ img, w, h, x, y, label, value, highlight }: {
  img: string; w: number; h: number; x: number; y: number;
  label: string; value: string; highlight: boolean;
}) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
      <img src={img} draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }} />
      <div style={{ position: "relative", width: "100%", height: "100%",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 15, letterSpacing: "0.14em",
          color: "rgba(220,180,80,0.95)", textTransform: "uppercase" }}>{label}</span>
        <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 800, fontSize: 30, letterSpacing: "0.04em",
          lineHeight: 1.15, color: highlight ? "#fcd34d" : "#fff" }}>{value}</span>
      </div>
    </div>
  );
}

interface Props {
  tournamentId: number;
  tournamentName: string;
  initialChips: number;
  initialScore: number;
  endTime: string | null;
  minBet: number;
  maxBet: number;
  onBack: () => void;
  onLeaderboard: () => void;
}

export default function TournamentRome({ tournamentId, tournamentName, initialChips, initialScore, endTime, minBet, maxBet, onBack, onLeaderboard }: Props) {
  const { sessionToken } = useStore();

  const [tChips, setTChips] = useState(initialChips);
  const [score, setScore]   = useState(initialScore);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!endTime) { setCountdown(null); return; }
    const tick = () => setCountdown(Math.max(0, new Date(endTime).getTime() - Date.now()));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [endTime]);

  const betSteps = (() => {
    const steps = DEFAULT_BET_STEPS.filter(s => s >= minBet && s <= maxBet);
    if (steps.length === 0) return [minBet];
    if (!steps.includes(minBet)) steps.unshift(minBet);
    if (!steps.includes(maxBet)) steps.push(maxBet);
    return [...new Set(steps)].sort((a,b)=>a-b);
  })();

  const [bet, setBet] = useState(betSteps[0]);
  const [strips, setStrips] = useState<string[][]>(buildInitialStrips);
  const [spinning, setSpinning] = useState(false);
  const spinningRef = useRef(false);
  const [lastWin, setLastWin] = useState(0);
  const [winPopup, setWinPopup] = useState<WinTier>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [autoSpin, setAutoSpin] = useState(false);
  const autoSpinRef = useRef(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showSfx, setShowSfx] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(getRomeSfxMuted);
  const [sfxVolume, setSfxVolume] = useState(getRomeSfxVolume);

  const animRef           = useRef<any>(null);
  const stripRefs         = useRef<(HTMLDivElement | null)[]>(Array(REELS).fill(null));
  const animCanvasRefs    = useRef<(HTMLCanvasElement | null)[]>(Array(REELS * ROWS).fill(null));
  const cellImgRefs       = useRef<(HTMLImageElement | null)[]>(Array(REELS * ROWS).fill(null));
  const visibleSymsRef    = useRef<string[]>(Array(REELS * ROWS).fill("BronzeCoin"));
  const frameImgsRef      = useRef<Map<string, HTMLImageElement[]>>(new Map());
  const symAnimIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale]         = useState(1);
  const [infoScale, setInfoScale] = useState(1);
  const [popupScale, setPopupScale] = useState(1);
  useEffect(() => {
    const el = wrapperRef.current; if (!el) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const availH = height - HEADER_H;
      setScale(Math.min(width / CW, availH / CH));
      setInfoScale(Math.min(width * 0.96 / 1284, availH * 0.96 / 659));
      setPopupScale(Math.min(width * 0.7 / 698, availH * 0.7 / 742));
    });
    obs.observe(el); return () => obs.disconnect();
  }, []);

  useEffect(() => {
    for (let i = 0; i < REELS; i++) {
      const el = stripRefs.current[i];
      if (el) { el.style.transition = "none"; el.style.transform = `translateY(${-(REEL_PREFIXES[i] * ROW_H)}px)`; }
    }
    for (const sym of ANIM_SYMBOLS) {
      const frames: HTMLImageElement[] = [];
      for (let f = 1; f <= ANIM_FRAMES; f++) {
        const img = new Image();
        img.src = `${RS}animations/${sym}${String(f).padStart(2, "0")}.webp`;
        frames.push(img);
      }
      frameImgsRef.current.set(sym, frames);
    }
    return () => { if (symAnimIntervalRef.current !== null) clearInterval(symAnimIntervalRef.current); };
  }, []);

  const stopSymbolAnims = useCallback(() => {
    if (symAnimIntervalRef.current !== null) { clearInterval(symAnimIntervalRef.current); symAnimIntervalRef.current = null; }
    for (const cv of animCanvasRefs.current) {
      if (cv) { cv.style.visibility = "hidden"; const ctx = cv.getContext("2d"); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height); }
    }
    for (const img of cellImgRefs.current) { if (img) img.style.visibility = ""; }
  }, []);

  const startSymbolAnims = useCallback((winIndices: Set<number>) => {
    if (symAnimIntervalRef.current !== null) { clearInterval(symAnimIntervalRef.current); symAnimIntervalRef.current = null; }
    for (const cv of animCanvasRefs.current) {
      if (!cv) continue;
      cv.style.visibility = "hidden";
      const ctx = cv.getContext("2d"); if (ctx) ctx.clearRect(0, 0, cv.width, cv.height);
    }
    if (winIndices.size === 0) return;
    const drawFrame = (frame: number) => {
      animCanvasRefs.current.forEach((cv, idx) => {
        if (!cv || !winIndices.has(idx)) return;
        const sym = visibleSymsRef.current[idx];
        const frames = frameImgsRef.current.get(sym);
        if (!frames) return;
        const img = frames[frame % frames.length];
        if (!img.complete || img.naturalWidth === 0) return;
        const ctx = cv.getContext("2d"); if (!ctx) return;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.style.visibility = "visible";
        const staticImg = cellImgRefs.current[idx];
        if (staticImg) staticImg.style.visibility = "hidden";
      });
    };
    drawFrame(0);
    let frame = 1;
    const MS_PER_FRAME = Math.round(1000 / ANIM_FPS);
    symAnimIntervalRef.current = setInterval(() => { drawFrame(frame); frame = (frame + 1) % ANIM_FRAMES; }, MS_PER_FRAME);
  }, []);

  const timeUp = countdown !== null && countdown <= 0;
  const eliminated = tChips <= 0;

  function fmtCountdown(ms: number) {
    if (ms <= 0) return "Time's up!";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}:${s.toString().padStart(2,"0")}`;
  }

  const spinOnce = useCallback(async (currentBet: number): Promise<boolean> => {
    if (!sessionToken) return false;
    if (spinningRef.current) return false;
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    setWinPopup(null);
    setErrMsg(null);
    stopSymbolAnims();

    let data: any = null;
    try {
      const r = await fetch(`${BASE}/api/tournaments/${tournamentId}/spin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ betAmount: currentBet }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Spin failed");
    } catch (e: any) {
      spinningRef.current = false; setSpinning(false); setErrMsg(e.message); return false;
    }

    // Tournament grid is [reel][row] (column-major), same as western.
    // We need to build strips where each reel's prefix is followed by result rows.
    // strips[reelIdx] = [...prefix, row0, row1, row2]
    // row_k of reel_i = data.grid[i][k]
    const grid = data.grid as string[][];  // grid[reel][row]
    const newStrips = REEL_PREFIXES.map((prefixCount, reelIdx) => {
      const prev = [0, 1, 2].map(r => visibleSymsRef.current[reelIdx * ROWS + r] || "BronzeCoin");
      return [
        ...prev,
        ...Array.from({ length: prefixCount }, () => SYMBOL_IDS[Math.floor(Math.random() * SYMBOL_IDS.length)]),
        grid[reelIdx][0],
        grid[reelIdx][1],
        grid[reelIdx][2],
      ];
    });
    setStrips(newStrips);

    for (const el of stripRefs.current) {
      if (el) { el.style.transition = "none"; el.style.transform = "translateY(0)"; }
    }
    await new Promise(r => setTimeout(r, 32));

    const yPos    = Array(REELS).fill(0);
    const stopped = Array(REELS).fill(false);
    const targets = newStrips.map(strip => -(strip.length - ROWS) * ROW_H);
    const DECEL_ZONE = ROW_H * 4;
    if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
    playSpinClick();
    const lastRowIdx = Array(REELS).fill(0);

    await new Promise<void>(resolve => {
      animRef.current = setInterval(() => {
        let anyMoving = false;
        let tickedThisFrame = false;
        for (let i = 0; i < REELS; i++) {
          if (stopped[i]) continue;
          const remaining = yPos[i] - targets[i];
          const speed = remaining > DECEL_ZONE ? SPIN_SPEED : Math.max(2, SPIN_SPEED * (remaining / DECEL_ZONE));
          yPos[i] -= speed;
          const el = stripRefs.current[i];
          if (yPos[i] <= targets[i] || remaining < ROW_H * 0.15) {
            yPos[i] = targets[i]; stopped[i] = true;
            playReelStop();
            if (el) { el.style.transition = "none"; el.style.transform = `translateY(${targets[i]}px)`; }
          } else {
            anyMoving = true;
            const rowNow = Math.floor(Math.abs(yPos[i]) / ROW_H);
            if (rowNow !== lastRowIdx[i]) {
              lastRowIdx[i] = rowNow;
              if (!tickedThisFrame) { tickedThisFrame = true; playReelTick(); }
            }
            if (el) el.style.transform = `translateY(${yPos[i]}px)`;
          }
        }
        if (!anyMoving) { clearInterval(animRef.current); animRef.current = null; resolve(); }
      }, 16) as any;
    });

    // Update visible symbol ref — grid[reel][row]
    for (let col = 0; col < REELS; col++) {
      for (let row = 0; row < ROWS; row++) {
        visibleSymsRef.current[col * ROWS + row] = grid[col]?.[row] ?? "BronzeCoin";
      }
    }

    // Compute winning cell indices using server wins array (uses lineIndex)
    const winIndices = new Set<number>();
    for (const lw of (data.wins as { lineIndex: number; count: number }[] ?? [])) {
      const payline = PAYLINES[lw.lineIndex];
      if (!payline) continue;
      for (let col = 0; col < lw.count; col++) {
        winIndices.add(col * ROWS + payline[col]);
      }
    }
    if ((data.scatterCount ?? 0) >= 3) {
      for (let col = 0; col < REELS; col++) {
        for (let row = 0; row < ROWS; row++) {
          if (grid[col]?.[row] === "Scatter") winIndices.add(col * ROWS + row);
        }
      }
    }
    setTimeout(() => startSymbolAnims(winIndices), 16);

    const totalWin = data.payout ?? 0;
    setLastWin(totalWin);
    const tier = winTier(totalWin, currentBet);
    if (tier) {
      setWinPopup(tier);
      if (tier === "mega") playMegaWin();
      else if (tier === "huge") playHugeWin();
      else playSmallWin();
      const duration = tier === "mega" ? 3500 : tier === "huge" ? 3000 : 2000;
      await delay(duration);
      setWinPopup(null);
    }

    setTChips(data.tournamentChips ?? 0);
    setScore(data.score ?? 0);

    spinningRef.current = false; setSpinning(false);
    return true;
  }, [sessionToken, stopSymbolAnims, startSymbolAnims, tournamentId]);

  useEffect(() => { autoSpinRef.current = autoSpin; }, [autoSpin]);

  useEffect(() => {
    if (!autoSpin) return;
    let alive = true;
    const loop = async () => {
      while (alive && autoSpinRef.current) {
        if (timeUp || tChips <= 0) { setAutoSpin(false); break; }
        const ok = await spinOnce(bet);
        if (!ok) { setAutoSpin(false); break; }
        await delay(400);
      }
    };
    loop();
    return () => { alive = false; };
  }, [autoSpin]);

  const handleSpin = () => {
    if (spinning || autoSpin || timeUp || eliminated) return;
    if (tChips < bet) { setErrMsg("Not enough tournament chips"); return; }
    spinOnce(bet);
  };

  return (
    <div ref={wrapperRef} style={{ width: "100%", height: "100%", background: "#060208", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ flexShrink: 0, height: HEADER_H, background: "rgba(6,2,8,0.95)", borderBottom: "1px solid rgba(185,28,28,0.35)",
        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", zIndex: 50 }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.55)", fontSize: 13,
          fontFamily: "Oswald, sans-serif", letterSpacing: "0.06em", textTransform: "uppercase",
          padding: "4px 8px", borderRadius: 6, transition: "color 0.15s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.9)")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.55)")}>
          ← Lobby
        </button>

        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "#dc2626", textShadow: "0 0 18px rgba(220,38,38,0.55)", userSelect: "none" }}>
            {tournamentName}
          </span>
          {countdown !== null && (
            <span style={{ fontFamily: "Oswald, sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em",
              color: countdown < 120000 ? "#f87171" : countdown < 3600000 ? "#fbbf24" : "rgba(185,28,28,0.6)" }}>
              ⏱ {fmtCountdown(countdown)}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em" }}>
            Score: {score.toLocaleString()}
          </span>
          <button onClick={onLeaderboard} style={{ background: "rgba(185,28,28,0.25)", border: "1px solid rgba(185,28,28,0.5)",
            borderRadius: 6, cursor: "pointer", fontFamily: "Oswald,sans-serif", fontSize: 12, fontWeight: 700,
            color: "#fcd34d", letterSpacing: "0.1em", textTransform: "uppercase", padding: "5px 14px" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(185,28,28,0.5)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(185,28,28,0.25)")}>
            🏆 Leaderboard
          </button>
        </div>
      </div>

      {showSfx && <div onClick={() => setShowSfx(false)} style={{ position: "fixed", inset: 0, zIndex: 997 }} />}

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#060208" }}>
        <div style={{ width: CW, height: CH, flexShrink: 0, transform: `scale(${scale})`, transformOrigin: "center center" }}>

          <img src={RS + "screen/BKG.webp"} draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", userSelect: "none" }} />

          <img src={RS + "screen/SlotMachine3x5.webp"} draggable={false}
            style={{ position: "absolute", left: M.x, top: M.y, width: M.w, height: M.h, userSelect: "none" }} />

          {Array.from({ length: REELS }, (_, reelIdx) => (
            <div key={reelIdx} style={{ position: "absolute", left: REEL_COLS[reelIdx].left, top: REEL_TOP,
              width: REEL_COLS[reelIdx].w, height: ROW_H * ROWS, overflow: "hidden" }}>
              <div ref={el => { stripRefs.current[reelIdx] = el; }}
                style={{ position: "absolute", top: 0, width: "100%", willChange: "transform" }}>
                {strips[reelIdx].map((sym, symIdx) => {
                  const resultStart = strips[reelIdx].length - ROWS;
                  const isResultCell = symIdx >= resultStart;
                  const resultRow = symIdx - resultStart;
                  const cellIdx = reelIdx * ROWS + resultRow;
                  return (
                    <div key={symIdx} style={{ width: "100%", height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <img ref={isResultCell ? el => { cellImgRefs.current[cellIdx] = el; } : undefined}
                        src={`${RS}symbols/${sym}.webp`} draggable={false}
                        style={{ width: 240, height: 210, objectFit: "contain", userSelect: "none" }} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {Array.from({ length: REELS }, (_, col) =>
            Array.from({ length: ROWS }, (_, row) => {
              const idx = col * ROWS + row;
              return (
                <div key={`sa-${col}-${row}`} style={{ position: "absolute", left: REEL_COLS[col].left, top: REEL_TOP + row * ROW_H,
                  width: REEL_COLS[col].w, height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none", zIndex: 8 }}>
                  <canvas ref={el => { animCanvasRefs.current[idx] = el; }} width={250} height={215}
                    style={{ width: 248, height: 218, imageRendering: "pixelated", visibility: "hidden" }} />
                </div>
              );
            })
          )}

          <img src={RS + "screen/PanelGUI.webp"} draggable={false}
            style={{ position: "absolute", left: 0, top: PANEL_Y, width: CW, height: PANEL_H, userSelect: "none" }} />

          {/* Settings */}
          <div onClick={() => setShowSfx(v => !v)} style={{ position: "absolute", left: 112, top: PANEL_Y + 28, cursor: "pointer",
            filter: showSfx ? "brightness(1.4) saturate(1.3)" : sfxMuted ? "brightness(0.5)" : "none", transition: "filter 0.15s" }}>
            <img src={RS + (showSfx ? "screen/ButtonSettingsHover.webp" : "screen/ButtonSettings.webp")}
              draggable={false} style={{ width: 52, height: 89, objectFit: "contain" }} />
          </div>

          {/* Info */}
          <div onClick={() => setShowInfo(true)} style={{ position: "absolute", left: 1772, top: PANEL_Y + 28, cursor: "pointer" }}>
            <img src={RS + "screen/ButtonInfo.webp"} draggable={false} style={{ width: 52, height: 89, objectFit: "contain" }} />
          </div>

          <PanelDisplay img={RS+"screen/PanelLines.webp"} w={196} h={88} x={174} y={PANEL_Y+29} label="Lines" value="20" highlight={false} />

          <div onClick={() => { if (!spinning) setBet(b => nextBet(b, -1, betSteps)); }}
            style={{ position: "absolute", left: 376, top: PANEL_Y+51, cursor: "pointer", userSelect: "none" }}>
            <img src={RS + "screen/ButtonMinus.webp"} draggable={false} style={{ width: 38, height: 44 }} />
          </div>

          <PanelDisplay img={RS+"screen/PanelTotalBet.webp"} w={240} h={88} x={416} y={PANEL_Y+29} label="Total Bet" value={bet.toLocaleString()} highlight={false} />

          <div onClick={() => { if (!spinning) setBet(b => nextBet(b, 1, betSteps)); }}
            style={{ position: "absolute", left: 658, top: PANEL_Y+51, cursor: "pointer", userSelect: "none" }}>
            <img src={RS + "screen/ButtonPlus.webp"} draggable={false} style={{ width: 38, height: 44 }} />
          </div>

          <div onClick={() => { if (!spinning) setBet(betSteps[betSteps.length-1]); }}
            style={{ position: "absolute", left: 700, top: PANEL_Y+31, cursor: "pointer" }}>
            <img src={RS + "screen/ButtonMaxBet.webp"} draggable={false} style={{ width: 132, height: 83 }} />
          </div>

          <div onClick={handleSpin}
            style={{ position: "absolute", left: 840, top: PANEL_Y - 22,
              cursor: (spinning || timeUp || eliminated || tChips < bet) ? "default" : "pointer",
              opacity: (timeUp || eliminated || tChips < bet) ? 0.45 : 1 }}>
            <img src={RS + (spinning ? "screen/ButtonSpinHover.webp" : "screen/ButtonSpin.webp")} draggable={false}
              style={{ width: 240, height: 168, filter: spinning ? "brightness(0.7)" : "none", transition: "filter 0.15s" }} />
          </div>

          <div onClick={() => { if (autoSpin) setAutoSpin(false); else if (!spinning) setAutoSpin(true); }}
            style={{ position: "absolute", left: 1092, top: PANEL_Y+31, cursor: "pointer", userSelect: "none" }}>
            <img src={RS + "screen/ButtonAutoSpin.webp"} draggable={false}
              style={{ width: 146, height: 83, filter: autoSpin ? "brightness(1.5) saturate(1.6)" : "none" }} />
          </div>

          {/* T-Chips (replaces Balance) */}
          <PanelDisplay img={RS+"screen/PanelBalance.webp"} w={246} h={88} x={1252} y={PANEL_Y+29}
            label="T-Chips" value={tChips.toLocaleString()} highlight={false} />

          <PanelDisplay img={RS+"screen/PanelWin.webp"} w={246} h={88} x={1512} y={PANEL_Y+29}
            label="Win" value={lastWin > 0 ? lastWin.toLocaleString() : "—"} highlight={lastWin > 0} />

          {errMsg && (
            <div style={{ position: "absolute", left: "50%", top: 60, transform: "translateX(-50%)",
              background: "rgba(139,26,26,0.92)", border: "1px solid rgba(200,60,60,0.5)",
              borderRadius: 8, padding: "10px 22px", fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 16,
              color: "#fff", letterSpacing: "0.08em", zIndex: 30 }}>
              {errMsg}
            </div>
          )}

          {(timeUp || eliminated) && (
            <div style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", zIndex: 20,
              textAlign: "center", background: "rgba(0,0,0,0.88)", border: "2px solid rgba(220,38,38,0.4)",
              borderRadius: 18, padding: "36px 56px" }}>
              <div style={{ fontFamily: "Cinzel,serif", fontWeight: 900, fontSize: 36, letterSpacing: "0.08em",
                color: "#dc2626", textShadow: "0 0 24px rgba(220,38,38,0.5)" }}>
                {eliminated ? "Out of Chips" : "Time's Up!"}
              </div>
              <div style={{ fontFamily: "Oswald,sans-serif", fontSize: 22, color: "rgba(255,255,255,0.45)", marginTop: 10 }}>
                Final Score: <span style={{ color: "#fcd34d", fontWeight: 800 }}>{score.toLocaleString()}</span>
              </div>
            </div>
          )}

        </div>

        {/* Win popup */}
        {winPopup && (() => {
          if (winPopup === "small") {
            return (
              <div style={{ position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "none",
                display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: "7%" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  background: "linear-gradient(180deg, rgba(60,30,0,0.97) 0%, rgba(25,10,0,0.97) 100%)",
                  border: "2px solid #b8860b", borderRadius: 6, padding: "10px 40px 12px",
                  boxShadow: "0 0 24px rgba(180,130,0,0.5), 0 4px 20px rgba(0,0,0,0.8)" }}>
                  <span style={{ fontFamily: "Cinzel,serif", fontWeight: 400, fontSize: 11,
                    color: "rgba(252,211,77,0.8)", letterSpacing: "0.28em", textTransform: "uppercase" }}>You Win</span>
                  <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 38,
                    color: "#fcd34d", lineHeight: 1,
                    textShadow: "0 0 18px rgba(245,158,11,0.9), 0 2px 6px rgba(0,0,0,0.9)", letterSpacing: "0.04em" }}>
                    +{lastWin.toLocaleString()}
                  </span>
                  <span style={{ fontFamily: "Cinzel,serif", fontWeight: 400, fontSize: 10,
                    color: "rgba(220,180,80,0.65)", letterSpacing: "0.22em", textTransform: "uppercase" }}>BET Coins</span>
                </div>
              </div>
            );
          }
          const PP = RS + "popups/";
          const cfgs: Record<string, { img: string; glow: string; amtColor: string; textTop: string }> = {
            huge: { img: PP+"PopUp_HugeWin.webp", glow: "#f59e0b", amtColor: "#fde68a", textTop: "62%" },
            mega: { img: PP+"PopUp_MegaWin.webp", glow: "#fcd34d", amtColor: "#fef3c7", textTop: "62%" },
          };
          const cfg = cfgs[winPopup] ?? cfgs.huge;
          return (
            <div style={{ position: "fixed", inset: 0, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.7)" }} onClick={() => setWinPopup(null)}>
              <div style={{ position: "relative", width: 698, height: 742,
                transform: `scale(${popupScale})`, transformOrigin: "center center" }}>
                <img src={cfg.img} draggable={false}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                    filter: `drop-shadow(0 0 40px ${cfg.glow}66)`, userSelect: "none" }} />
                <div style={{ position: "absolute", left: 0, right: 0, top: cfg.textTop,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 80,
                    color: cfg.amtColor, lineHeight: 1,
                    textShadow: `0 0 40px ${cfg.glow}, 0 0 80px ${cfg.glow}88, 0 4px 12px rgba(0,0,0,0.9)`,
                    letterSpacing: "0.03em" }}>+{lastWin.toLocaleString()}</span>
                  <span style={{ fontFamily: "Cinzel,serif", fontWeight: 600, fontSize: 20,
                    color: "rgba(252,211,77,0.8)", letterSpacing: "0.18em", textTransform: "uppercase" }}>BET Coins</span>
                </div>
              </div>
            </div>
          );
        })()}

      </div>

      {/* Sound panel */}
      {showSfx && (
        <div onClick={e => e.stopPropagation()} style={{ position: "fixed", bottom: 72, left: 8, zIndex: 998,
          background: "linear-gradient(180deg,rgba(20,6,30,0.98) 0%,rgba(10,2,20,0.98) 100%)",
          border: "1px solid rgba(185,28,28,0.4)", borderRadius: 12, padding: "20px 24px",
          width: 220, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
          <div style={{ fontFamily: "Cinzel,serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.12em",
            color: "#dc2626", textTransform: "uppercase", textAlign: "center" }}>Sound</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 13, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>Mute</span>
            <button onClick={() => { const m = !sfxMuted; setSfxMuted(m); setRomeSfxMuted(m); }}
              style={{ background: sfxMuted ? "rgba(220,38,38,0.3)" : "rgba(220,38,38,0.7)", border: "1px solid rgba(220,38,38,0.5)",
                borderRadius: 4, color: sfxMuted ? "rgba(255,255,255,0.4)" : "#fff", cursor: "pointer",
                padding: "4px 12px", fontFamily: "Oswald,sans-serif", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em" }}>
              {sfxMuted ? "OFF" : "ON"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: "Oswald,sans-serif", fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>
              Volume: {sfxMuted ? "—" : Math.round(sfxVolume * 100) + "%"}
            </span>
            <input type="range" min={0} max={1} step={0.05} value={sfxVolume} disabled={sfxMuted}
              onChange={e => { const v = parseFloat(e.target.value); setSfxVolume(v); setRomeSfxVolume(v); }}
              style={{ accentColor: "#dc2626", opacity: sfxMuted ? 0.25 : 1, cursor: sfxMuted ? "not-allowed" : "pointer" }} />
          </div>
        </div>
      )}

      {/* Paytable */}
      {showInfo && (
        <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowInfo(false); }}>
          <div style={{ width: "min(1284px,96vw)", maxHeight: "96vh", overflowY: "auto",
            background: "rgba(10,3,15,0.98)", border: "2px solid rgba(185,28,28,0.5)", borderRadius: 16,
            padding: "40px 48px", position: "relative", transform: `scale(${infoScale})`, transformOrigin: "top center",
            boxShadow: "0 0 60px rgba(0,0,0,0.8)" }}>
            <div style={{ fontFamily: "Cinzel,serif", fontWeight: 900, fontSize: 32, letterSpacing: "0.14em",
              color: "#dc2626", textAlign: "center", textTransform: "uppercase", marginBottom: 16,
              textShadow: "0 0 20px rgba(220,38,38,0.45)" }}>
              Fortuna Roma — Paytable
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 18, marginBottom: 24 }}>
              {SYMBOL_IDS.map(sym => (
                <div key={sym} style={{ background: "rgba(30,10,40,0.85)", border: "1px solid rgba(185,28,28,0.3)",
                  borderRadius: 10, padding: "18px 10px", textAlign: "center" }}>
                  <img src={`${RS}symbols/${sym}.webp`} draggable={false}
                    style={{ width: 80, height: 80, objectFit: "contain", display: "block", margin: "0 auto 10px" }} />
                  <div style={{ fontFamily: "Cinzel,serif", fontSize: 12, fontWeight: 700, color: "#dc2626",
                    letterSpacing: "0.08em", marginBottom: 8, textTransform: "uppercase" }}>{SYMBOL_NAMES[sym]}</div>
                  {sym === "Scatter" ? (
                    <div style={{ fontFamily: "Oswald,sans-serif", color: "rgba(252,211,77,0.7)" }}>
                      <div style={{ fontSize: 11, color: "rgba(220,180,80,0.5)", marginBottom: 4 }}>anywhere on grid</div>
                      {[3,4,5].map(n => <div key={n} style={{ fontSize: 12, lineHeight: "1.7" }}>{n}+ = bonus!</div>)}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily: "Oswald,sans-serif", fontSize: 11, color: "rgba(220,180,80,0.5)", marginBottom: 4 }}>from left, in a row</div>
                      {[3,4,5].map(n => (
                        <div key={n} style={{ fontFamily: "Oswald,sans-serif", fontSize: 12, lineHeight: "1.7",
                          color: n===5 ? "#fcd34d" : n===4 ? "rgba(252,211,77,0.8)" : "rgba(220,180,80,0.6)" }}>
                          {n} = {SYMBOL_PAYTABLE[sym]?.[n] ?? 0}× bet
                        </div>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontFamily: "Cinzel,serif", fontSize: 13, color: "rgba(220,180,80,0.45)", textAlign: "center", letterSpacing: "0.06em" }}>
              WILD substitutes for all symbols &nbsp;·&nbsp; 25 paylines &nbsp;·&nbsp; Pays left to right only
            </div>
            <button onClick={() => setShowInfo(false)} style={{ position: "absolute", right: 20, top: 16, width: 44, height: 44,
              background: "rgba(0,0,0,0.55)", border: "1px solid rgba(185,28,28,0.45)", borderRadius: "50%",
              cursor: "pointer", color: "#dc2626", fontFamily: "Cinzel,serif", fontSize: 22, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
          </div>
        </div>
      )}

    </div>
  );
}
