import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePageTracker } from "../lib/usePageTracker";
import { awardXP } from "../lib/rewardsState";
import { fireChallengeEvent } from "../lib/challengeEventService";
import { WesternPaylineOverlay, type PaylineWin } from "./western-payline-overlay";
import { playCustomSound, stopCustomSound, startWinCountSound, stopWinCountSound, updateWinCountPitch, startLoop, stopLoop, setCustomSoundsVolume, setCustomSoundsMuted } from "../lib/customSounds";

import { usePlayerSocket } from "../lib/usePlayerSocket";
import { isGameUnlocked, usePasswordGuard } from "../lib/gamePasswordGuard";
import buttonClickUrl  from "@assets/buttonclick_1777322204907.mp3";
import { useGameClosedRedirect } from "../lib/useGameClosedRedirect";

const WS   = import.meta.env.BASE_URL + "western-slots/";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const SLOTS_MAINTENANCE = false;

// ── Canvas ─────────────────────────────────────────────────────────────────────
const CW = 1920;
const CH = 1080;
const HEADER_H = 72;

// ── Reel grid ──────────────────────────────────────────────────────────────────
// REEL_COL / ROW_TOP confirmed from reference image (592×335 → scale 3.24× → 1920×1080)
const REEL_COL  = [423, 638, 853, 1068, 1283]; // left-X of each column window
const REEL_TOP  = 238;                          // top-Y of reel window (all 3 rows)
const CELL_W    = 215;
const CELL_H    = 215;
const N_REELS   = 5;
const N_ROWS    = 3;
// Reels Up (1543×211): left=188, top=27
// Reels.png (1075×645): left=423, top=238  ← this is the dark bg panel
// Reels Bottom (1535×228): left=193, top=883  ← control bar shelf

// ── Reel animation (mirrors rome-slots exactly) ────────────────────────────────
// Money counters use elapsed-time animation so skipped/throttled frames never
// change the final payout or the animation's effective speed.
// Each reel has a longer prefix so they stop LEFT → RIGHT naturally.
const REEL_PREFIXES = [12, 15, 18, 21, 24]; // random-symbols before the result
const TEASE_STEP    = 30;                    // extra-symbols/column after 2nd scatter
const SPIN_SPEED    = 75;                    // px per 16ms tick
const DECEL_ZONE    = CELL_H * 2.75;        // decelerate over last ~2.75 rows

// ── Symbols ────────────────────────────────────────────────────────────────────
type SymId = "Bag"|"Spades"|"Hearts"|"Crosses"|"Diamonds"|"Flask"|"Hat"|"Gun"|"Wild"|"Scatter";

// ── Symbol animation (spritesheet-based, same approach as rome-slots) ──────────
// Spritesheet layout: 12 cols × 2 rows of SPRITE_CELL×SPRITE_CELL frames = 24 frames
const ANIM_FRAMES  = 24;
const ANIM_FPS     = 20;            // 50ms per frame
const SPRITE_COLS  = 12;
const SPRITE_CELL  = 215;           // px per frame in the spritesheet
const ANIM_SYMBOLS = new Set<SymId>([
  "Bag","Spades","Hearts","Crosses","Diamonds","Flask","Hat","Gun","Wild","Scatter",
]);

// Rome-style weights tuned to ~70% RTP.
const WEIGHTS: Record<SymId, number> = {
  Bag:32, Spades:34, Hearts:30, Crosses:26, Diamonds:22,
  Flask:18, Hat:14, Gun:10, Wild:7, Scatter:6,
};
const POOL: SymId[] = [];
(Object.entries(WEIGHTS) as [SymId,number][]).forEach(([id,w])=>{
  for(let i=0;i<w;i++) POOL.push(id);
});
const randSym = (): SymId => POOL[Math.floor(Math.random()*POOL.length)];

// Build initial strips with a random result pre-loaded
function buildInitialStrips(visible: SymId[]): SymId[][] {
  return REEL_PREFIXES.map((pfx, col) => [
    ...Array.from({length: pfx}, randSym),
    visible[col*N_ROWS + 0],
    visible[col*N_ROWS + 1],
    visible[col*N_ROWS + 2],
  ]);
}

// ── Paylines & payout ──────────────────────────────────────────────────────────
const PAYLINES: number[][] = [
  [1,1,1,1,1], // 1  middle straight
  [0,0,0,0,0], // 2  top straight
  [2,2,2,2,2], // 3  bottom straight
  [0,1,2,1,0], // 4  V
  [2,1,0,1,2], // 5  inverted V
  [0,0,1,2,2], // 6  slope down
  [2,2,1,0,0], // 7  slope up
  [1,0,0,0,1], // 8  middle-top-middle
  [1,2,2,2,1], // 9  middle-bottom-middle
  [0,1,1,1,0], // 10 top-middle-top
  [2,1,1,1,2], // 11 bottom-middle-bottom
  [1,0,1,2,1], // 12 zigzag down
  [1,2,1,0,1], // 13 zigzag up
  [0,1,0,1,0], // 14 top wave
  [2,1,2,1,2], // 15 bottom wave
  [0,1,2,2,1], // 16 drop then rise
  [2,1,0,0,1], // 17 rise then drop
  [1,1,0,1,1], // 18 middle with top bump
  [1,1,2,1,1], // 19 middle with bottom dip
  [1,0,1,1,2], // 20 connected custom
];
// Paytable values = multiplier on betPerLine (totalBet / 20).
// Matches Roman Slots payout values exactly.
// Symbol order (low → high): Bag, Crosses, Diamonds, Hearts, Spades, Flask, Hat, Gun, Wild
const PAYTABLE: Record<SymId, Partial<Record<number,number>>> = {
  Bag:     {3:5,   4:20,  5:60  },
  Crosses: {3:5,   4:25,  5:80  },
  Diamonds:{3:10,  4:30,  5:100 },
  Hearts:  {3:10,  4:35,  5:120 },
  Spades:  {3:10,  4:40,  5:150 },
  Flask:   {3:15,  4:60,  5:200 },
  Hat:     {3:20,  4:80,  5:300 },
  Gun:     {3:30,  4:125, 5:750 },
  Wild:    {3:100, 4:500, 5:2000},
  Scatter: {},
};
// Scatter pays TOTAL BET × multiplier: 3=2×, 4=10×, 5=50×
const SCATTER_PAY: Record<number,number> = {3:2, 4:10, 5:50};
const FREE_SPINS:  Record<number,number> = {3:8,4:12,5:18};

// PAYTABLE values = multiplier on bet at minimum stake (BET_STEPS[0]=20).
// evalResult scales proportionally: win × (bet / BET_STEPS[0])
// Returns win amount AND the set of winning cell indices (col*N_ROWS+row).
function evalResult(cols: SymId[][], bet: number): {win:number; cells:Set<number>; scatters:number} {
  const scale = bet / DEFAULT_BET_STEPS[0];
  let total = 0;
  const cells = new Set<number>();

  for(let li = 0; li < PAYLINES.length; li++){
    const line = PAYLINES[li];
    let sym: SymId|null = cols[0][line[0]]==="Wild"?null:cols[0][line[0]];
    let count = 1;
    for(let c=1;c<N_REELS;c++){
      const s=cols[c][line[c]];
      if(s==="Wild"){count++;continue;}
      if(sym===null){sym=s;count++;continue;}
      if(s===sym){count++;continue;}
      break;
    }
    const key = sym??"Wild";
    const lineWin = (PAYTABLE[key]?.[count]??0) * scale;
    if(lineWin>0){
      total += lineWin;
      for(let c=0;c<count;c++) cells.add(c*N_ROWS+line[c]);
    }
  }

  let sc=0;
  for(let c=0;c<N_REELS;c++) for(let r=0;r<N_ROWS;r++) if(cols[c][r]==="Scatter") sc++;
  if(sc>=3){
    total += (SCATTER_PAY[sc]??0) * bet;
  }
  // Always highlight scatter cells so players can see them land
  if(sc>=1){
    for(let c=0;c<N_REELS;c++) for(let r=0;r<N_ROWS;r++)
      if(cols[c][r]==="Scatter") cells.add(c*N_ROWS+r);
  }

  return {win:Math.round(total), cells, scatters:sc};
}

const DEFAULT_BET_STEPS = [20,40,100,200,400,1000,2000,5000];
const WIN_COUNT_CURVE_EXPONENT = 1.35;
const WIN_COUNT_DURATION_TIERS = [
  { maxMultiplier: 2, durationMs: 500 },
  { maxMultiplier: 10, durationMs: 900 },
  { maxMultiplier: 25, durationMs: 1500 },
  { maxMultiplier: 50, durationMs: 2200 },
  { maxMultiplier: 100, durationMs: 3200 },
] as const;
const WIN_COUNT_MAX_DURATION_MS = 4500;
// Bonus-exit totals are a calmer presentation than popup wins. Keep the
// multiplier tiers shared, but give the full congratulations count-up more
// time to read.
const BONUS_EXIT_DURATION_MULTIPLIER = 4;

function getWinCountDuration(winCents: number, betCents: number): number {
  const multiplier = betCents > 0 ? winCents / betCents : 1;
  for (const tier of WIN_COUNT_DURATION_TIERS) {
    if (multiplier < tier.maxMultiplier) return tier.durationMs;
  }
  return WIN_COUNT_MAX_DURATION_MS;
}
const delay = (ms:number) => new Promise(r=>setTimeout(r,ms));

// ── Web Audio sound system ─────────────────────────────────────────────────────
function useWesternSounds() {
  const acRef = useRef<AudioContext|null>(null);
  const mgRef = useRef<GainNode|null>(null); // master GainNode — 0.3 of full scale
  const volRef   = useRef<number>(parseFloat(localStorage.getItem("deadwood-sfx-volume") ?? "1"));
  const mutedRef = useRef<boolean>(localStorage.getItem("deadwood-sfx-muted") === "true");
  const clickBufRef = useRef<AudioBuffer|null>(null);
  // Raw MP3 bytes fetched eagerly on mount — no AudioContext required
  const rawBytesRef = useRef<ArrayBuffer|null>(null);
  // Decoded buffer for win_bet.webm — played on every non-zero win
  const winBufRef   = useRef<AudioBuffer|null>(null);
  const winBytesRef = useRef<ArrayBuffer|null>(null);

  // Pre-fetch click + win audio as soon as the component mounts
  useEffect(() => {
    fetch(buttonClickUrl)
      .then(r => r.arrayBuffer())
      .then(arr => { rawBytesRef.current = arr; })
      .catch(() => {});
    fetch(WS + "win_bet.webm")
      .then(r => r.arrayBuffer())
      .then(arr => { winBytesRef.current = arr; })
      .catch(() => {});
  }, []);

  function ac(): AudioContext {
    if (!acRef.current || acRef.current.state === "closed") {
      acRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      mgRef.current = null; // reset master when context is recreated
      // Bytes already fetched — decoding is ~1ms, so buffer is ready by next spin
      if (rawBytesRef.current && !clickBufRef.current) {
        acRef.current.decodeAudioData(rawBytesRef.current.slice(0))
          .then(buf => { clickBufRef.current = buf; })
          .catch(() => {});
      }
      if (winBytesRef.current && !winBufRef.current) {
        acRef.current.decodeAudioData(winBytesRef.current.slice(0))
          .then(buf => { winBufRef.current = buf; })
          .catch(() => {});
      }
    }
    if (acRef.current.state === "suspended") acRef.current.resume();
    return acRef.current;
  }

  function mg(): GainNode {
    const a = ac();
    if (!mgRef.current || mgRef.current.context !== a) {
      mgRef.current = a.createGain();
      mgRef.current.gain.value = 0.3;
      mgRef.current.connect(a.destination);
    }
    return mgRef.current;
  }

  function setVolume(v: number) {
    volRef.current = Math.max(0, Math.min(1, v));
    localStorage.setItem("deadwood-sfx-volume", String(volRef.current));
  }
  function setMuted(m: boolean) {
    mutedRef.current = m;
    localStorage.setItem("deadwood-sfx-muted", String(m));
  }

  // Noise burst helper
  function noiseBurst(ctx: AudioContext, startAt: number, dur: number, decay: number, vol: number, lowFreq = 0) {
    if (mutedRef.current || volRef.current === 0) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-t * decay);
      if (lowFreq) d[i] += Math.sin(2 * Math.PI * lowFreq * t) * Math.exp(-t * decay * 0.8) * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * volRef.current, startAt);
    src.connect(g).connect(mg());
    src.start(startAt);
    src.stop(startAt + dur);
  }

  // Tone helper
  function tone(ctx: AudioContext, startAt: number, freq: number, dur: number, vol: number, type: OscillatorType = "sine", freqEnd?: number) {
    if (mutedRef.current || volRef.current === 0) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, startAt + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * volRef.current, startAt);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(g).connect(mg());
    osc.start(startAt);
    osc.stop(startAt + dur + 0.01);
  }

  // Spin start: play MP3 button click
  function playSpinStart() {
    if (mutedRef.current || volRef.current === 0) return;
    const ctx = ac();

    const doPlay = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = 0.55 * volRef.current;
      src.connect(gain).connect(mg());
      src.start(ctx.currentTime);
    };

    if (clickBufRef.current) {
      doPlay(clickBufRef.current);
    } else if (rawBytesRef.current) {
      // Bytes pre-fetched — decode on-demand (~1ms) then play immediately
      ctx.decodeAudioData(rawBytesRef.current.slice(0))
        .then(buf => { clickBufRef.current = buf; doPlay(buf); })
        .catch(() => {});
    }
    // If neither ready: silent click (no synth fallback — avoids double-sound)
  }

  // Reel stop: synthesized to match reel_stop_1.webm
  //   212 ms · 12 ms pre-onset · 18 ms attack · core 70-130 Hz · sub 88→42 Hz · 67 Hz ring · 480 Hz click
  function playReelStop(_reelIndex: number) {
    if (mutedRef.current || volRef.current === 0) return;
    const ctx = ac();
    const now = ctx.currentTime;
    const vol = volRef.current;

    // Layer A — primary impact: bandpass noise 70-130 Hz, 18 ms attack, multi-stage decay
    {
      const n = Math.ceil(ctx.sampleRate * 0.190);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass"; filt.frequency.value = 95; filt.Q.value = 1.0;
      const gain = ctx.createGain();
      const t0 = now + 0.012;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.90 * vol, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.28 * vol, t0 + 0.033);
      gain.gain.exponentialRampToValueAtTime(0.06 * vol, t0 + 0.100);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.155);
      src.connect(filt); filt.connect(gain); gain.connect(mg());
      src.start(t0); src.stop(t0 + 0.190);
    }

    // Layer B — sub-bass pitch drop: sine sweep 88 → 42 Hz
    {
      const osc = ctx.createOscillator(); osc.type = "sine";
      const t0 = now + 0.015;
      osc.frequency.setValueAtTime(88, t0);
      osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.100);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.55 * vol, t0 + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.120);
      osc.connect(gain); gain.connect(mg());
      osc.start(t0); osc.stop(t0 + 0.125);
    }

    // Layer C — resonance ring: 67 Hz damped sine (bumpy body at 45-115 ms)
    {
      const osc = ctx.createOscillator(); osc.type = "sine";
      osc.frequency.value = 67;
      const t0 = now + 0.040;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(0.38 * vol, t0 + 0.020);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.100);
      osc.connect(gain); gain.connect(mg());
      osc.start(t0); osc.stop(t0 + 0.110);
    }

    // Layer D — definition click: bandpass noise ~480 Hz, 35 ms
    {
      const n = Math.ceil(ctx.sampleRate * 0.040);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const filt = ctx.createBiquadFilter();
      filt.type = "bandpass"; filt.frequency.value = 480; filt.Q.value = 3.0;
      const gain = ctx.createGain();
      const t0 = now + 0.018;
      gain.gain.setValueAtTime(0.28 * vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035);
      src.connect(filt); filt.connect(gain); gain.connect(mg());
      src.start(t0); src.stop(t0 + 0.042);
    }
  }

  // Win: play uploaded win_bet.webm (decoded through AudioContext
  // so it shares the same mute/volume as the synthesized reel-stop sfx)
  function playWin(_amount: number, _bet: number) {
    if (mutedRef.current || volRef.current === 0) return;
    const ctx = ac();
    const doPlay = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gp = ctx.createGain();
      gp.gain.value = 0.85 * volRef.current;
      src.connect(gp).connect(mg());
      src.start(ctx.currentTime);
    };
    if (winBufRef.current) {
      doPlay(winBufRef.current);
    } else if (winBytesRef.current) {
      ctx.decodeAudioData(winBytesRef.current.slice(0))
        .then(buf => { winBufRef.current = buf; doPlay(buf); })
        .catch(() => {});
    }
  }

  // Free spin trigger: gunshot crack + rising fanfare
  function playFreeSpinTrigger() {
    const ctx = ac();
    const now = ctx.currentTime;
    // Crack
    noiseBurst(ctx, now, 0.14, 55, 0.65);
    // Low body thud
    tone(ctx, now, 60, 0.18, 0.35, "sine", 30);
    // Rising fanfare: G4-C5-E5-G5-C6
    [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      tone(ctx, now + 0.22 + i * 0.1, f, 0.3, 0.3, "triangle");
    });
  }

  return { playSpinStart, playReelStop, playWin, playFreeSpinTrigger, setVolume, setMuted, volRef, mutedRef };
}

// ── Hover button ──────────────────────────────────────────────────────────────
function HoverBtn({normal,hover,x,y,w,h,onClick,disabled=false,active=false,label}:{
  normal:string; hover:string; x:number; y:number; w:number; h:number;
  onClick?:()=>void; disabled?:boolean; active?:boolean; label?:string;
}){
  const [hov,setHov] = useState(false);
  return (
    <div style={{
      position:"absolute",left:x,top:y,width:w,height:h,zIndex:10,
      cursor:disabled?"default":"pointer",
      opacity:disabled?0.45:1,userSelect:"none",
      outline:active?"2px solid rgba(255,210,60,0.8)":"none",
      borderRadius:4,boxSizing:"border-box",
    }}
      onClick={disabled?undefined:onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
    >
      <img src={hov&&!disabled?hover:normal} draggable={false}
        style={{width:"100%",height:"100%",objectFit:"contain"}}/>
      {label&&(
        <div style={{
          position:"absolute",inset:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          fontFamily:"Oswald,sans-serif",fontWeight:700,
          fontSize:Math.round(h*0.2),letterSpacing:"0.06em",
          color:active?"#FFD060":"rgba(255,220,140,0.95)",
          textShadow:"0 1px 4px rgba(0,0,0,0.8)",
          textTransform:"uppercase",pointerEvents:"none",
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ── Stat panel ────────────────────────────────────────────────────────────────
function Panel({img,x,y,w,h,label,value,zIndex=10}:{
  img:string;x:number;y:number;w:number;h:number;label:string;value:string|number;zIndex?:number;
}){
  return (
    <div style={{position:"absolute",left:x,top:y-h/2,width:w,height:h,
      userSelect:"none",zIndex}}>
      {/* Label sits above the box */}
      <div style={{
        position:"absolute",bottom:"100%",left:0,width:"100%",
        textAlign:"center",paddingBottom:6,pointerEvents:"none",
      }}>
        <span style={{fontFamily:"Oswald,sans-serif",fontSize:20,fontWeight:700,
          color:"rgba(255,210,110,0.98)",letterSpacing:"0.14em",
          textTransform:"uppercase",
          textShadow:"0 0 12px rgba(180,120,0,0.8), 0 1px 4px rgba(0,0,0,0.9)"}}>
          {label}
        </span>
      </div>
      {/* Box image */}
      <img src={img} draggable={false}
        style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
      {/* Value inside box */}
      <div style={{position:"absolute",inset:0,display:"flex",
        alignItems:"center",justifyContent:"center"}}>
        <span style={{fontFamily:"Oswald,sans-serif",fontSize:26,fontWeight:800,
          color:"#FFE070",letterSpacing:"0.04em",lineHeight:1,
          textShadow:"0 0 10px rgba(255,200,30,0.5)"}}>
          {typeof value==="number"?value.toLocaleString():value}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function WesternSlots() {
  useGameClosedRedirect("deadwood-dollars", "/slots");
  const [,navigate] = useLocation();
  const {sessionToken, playerId} = useStore();
  usePageTracker("western-slots");
  usePasswordGuard("slots");
  useEffect(()=>{ if(!isGameUnlocked("slots")) navigate("/lobby"); },[]);
  useEffect(()=>{ if(SLOTS_MAINTENANCE) navigate("/slots-hub"); },[]);

  const {chips: liveChips} = usePlayerSocket(
    playerId??null, sessionToken, ()=>navigate("/lobby"),
  );
  const [displayChips, setDisplayChips] = useState<number>(0);

  // ── Sounds ─────────────────────────────────────────────────────────────────
  const sounds = useWesternSounds();
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; });
  const [showSfx, setShowSfx] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(() => sounds.mutedRef.current);
  const [sfxVolume, setSfxVolume] = useState(() => sounds.volRef.current);

  // ── Scale — use ResizeObserver on the wrapper so FiveM CEF tablet sizes work ──
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale,setScale] = useState(1);
  const [popupScale,setPopupScale] = useState(1);
  useEffect(()=>{
    const el = wrapperRef.current;
    if(!el) return;
    const obs = new ResizeObserver(entries=>{
      const {width,height} = entries[0].contentRect;
      const availH = height - HEADER_H;
      setScale(Math.min(width/CW, availH/CH));
      // Popup base size 520×580 — keep popup at ~60% of available screen
      setPopupScale(Math.min(width * 0.6 / 520, availH * 0.6 / 580));
    });
    obs.observe(el);
    return ()=>obs.disconnect();
  },[]);

  // ── Bet steps (fetched from server, fall back to defaults) ─────────────────
  const [betSteps, setBetSteps] = useState<number[]>(DEFAULT_BET_STEPS);
  useEffect(() => {
    fetch(`${BASE}/api/slot-bet-limits`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.westernSlots) && d.westernSlots.length) {
          setBetSteps(d.westernSlots);
          setBet(d.westernSlots[0]);
        }
      })
      .catch(() => {});
  }, []);

  // ── Game state ─────────────────────────────────────────────────────────────
  const [bet,setBet]           = useState(DEFAULT_BET_STEPS[0]);
  const [spinning,setSpinning] = useState(false);
  const spinningRef = useRef(false);
  useEffect(() => { if (!spinning) setDisplayChips(liveChips ?? 0); }, [liveChips, spinning]);
  const [lastWin,setLastWin]   = useState(0);
  const [winCells,setWinCells] = useState<Set<number>>(new Set());
  const [autoSpin,setAutoSpin] = useState(false);
  const [freeLeft,setFreeLeft] = useState(0);
  const [freeTotal,setFreeTotal] = useState(0);
  const [showFreeSpinsBanner,setShowFreeSpinsBanner] = useState(false);
  const [bonusWinTotal,setBonusWinTotal] = useState(0);
  const bonusWinRef = useRef(0);
  const [showBonusEnd,setShowBonusEnd] = useState(false);
  const [bonusEndCountComplete,setBonusEndCountComplete] = useState(false);
  const bonusEndCountCompleteRef = useRef(false);
  const bonusEndResolveRef = useRef<(()=>void)|null>(null);
  // Resolved when the win popup overlay is dismissed (its onClick
  // handler). Used by spinOnce when the LAST free spin had any lines —
  // it must wait for the popup + payline animation to land before
  // showing the bonus-complete splash, otherwise the splash covers
  // the still-running mega/huge win card.
  const winPopupDismissResolveRef = useRef<(()=>void)|null>(null);
  // Animated value for bonus-end "TOTAL WON", stored internally as cents.
  const [bonusEndDisplayed,setBonusEndDisplayed] = useState(0);
  const bonusEndFrameRef = useRef<number|null>(null);
  const bonusEndAnimRef = useRef<{startCents:number; finalCents:number; startTime:number; durationMs:number}|null>(null);
  const lastWinRef = useRef(0);
  const [showInfo,setShowInfo]   = useState(false);
  const [errMsg,setErrMsg]       = useState<string|null>(null);
  const [winPopup,setWinPopup]   = useState<{amount:number;bet:number;isJackpot:boolean;lineWins:any[];isFree:boolean;grid:SymId[][]}|null>(null);
  // Mega wins get a two-step reveal: start on the Huge Win artwork, then
  // replace it with the final Mega Win artwork after the first beat lands.
  const [megaPopupStage,setMegaPopupStage] = useState<"huge"|"mega">("mega");
  const megaPopupTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  // Rolling counter value drawn on the jackpot / huge / mega popup webp.
  // Animates 0 → winPopup.amount each time winPopup is set to a big-win tier
  // (handled in the [winPopup] useEffect below).
  const [popCounterValue, setPopCounterValue] = useState<number>(0);
  // Reveal gate for the win popup. winPopup carries the data as soon as
  // the spin result is in, but the popup itself (and the win_end_bet audio)
  // must NOT show until every distinct payline in the sequence has been
  // shown on screen at least once. Flipped true inside onLineActive when
  // the last new payline shape is fired; cleared on overlayWins flip.
  const [popupRevealed, setPopupRevealed] = useState<boolean>(false);
  const [overlayWins, setOverlayWins] = useState<PaylineWin[]>([]);
  const autoRef = useRef(autoSpin);
  useEffect(()=>{ autoRef.current=autoSpin; },[autoSpin]);
  // betRef / freeLeftRef avoid stale closures in spinOnce without adding those values to deps
  const betRef = useRef(bet);
  useEffect(()=>{ betRef.current=bet; },[bet]);
  const freeLeftRef = useRef(freeLeft);
  useEffect(()=>{ freeLeftRef.current=freeLeft; },[freeLeft]);
  const chips = displayChips;

  // ── Reel strip refs (DOM mutation, same as rome-slots) ─────────────────────
  // visibleSymsRef[col*N_ROWS+row] = symbol currently displayed
  const visibleSymsRef = useRef<SymId[]>(
    Array.from({length:N_REELS*N_ROWS}, randSym)
  );

  const [strips, setStrips] = useState<SymId[][]>(() =>
    buildInitialStrips(visibleSymsRef.current)
  );

  const stripRefs      = useRef<(HTMLDivElement|null)[]>(Array(N_REELS).fill(null));
  const containerRefs  = useRef<(HTMLDivElement|null)[]>(Array(N_REELS).fill(null));
  // Lift-filler: cloned bottom symbol rendered below each reel window. Hidden
  // by Reels Bottom.webp (z:3) at rest; rises into the lifted-cut gap on lift.
  const fillerRefs     = useRef<(HTMLDivElement|null)[]>(Array(N_REELS).fill(null));
  const animRef        = useRef<ReturnType<typeof setInterval>|null>(null);
  // Canvas overlays for winning cell animations (15 cells: col*N_ROWS+row)
  const animCanvasRefs = useRef<(HTMLCanvasElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  // Static <img> elements in each result row cell (same 15-cell indexing)
  const cellImgRefs    = useRef<(HTMLImageElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  // Pre-loaded spritesheet images: sym → single HTMLImageElement (2580×430)
  const frameImgsRef   = useRef<Map<SymId,HTMLImageElement>>(new Map());
  // setInterval handle for symbol animation loop
  const symAnimRef     = useRef<ReturnType<typeof setInterval>|null>(null);
  // setInterval handle for the jackpot / huge / mega popup counter animation.
  // Driven by the [winPopup] useEffect below; ramps popCounterValue
  // 0 → winPopup.amount over ~1.8 s with easeOutCubic.
  const popCounterFrameRef  = useRef<number|null>(null);
  const popCounterAnimRef = useRef<{startCents:number; finalCents:number; startTime:number; durationMs:number}|null>(null);

  // On mount: position strips + preload spritesheets + sync free-spins from server
  useEffect(()=>{
    for(let i=0;i<N_REELS;i++){
      const el = stripRefs.current[i];
      if(el){
        el.style.transition = "none";
        el.style.transform = `translateY(${-(REEL_PREFIXES[i]*CELL_H)}px)`;
      }
    }
    for(const sym of ANIM_SYMBOLS){
      const img = new Image();
      img.src = `${WS}animations/${sym}/Spritesheet.webp`;
      frameImgsRef.current.set(sym, img);
    }
    // Sync free-spins count from server (handles page reload mid-session)
    if(sessionToken){
      fetch(`${BASE}/api/western-slots/free-spins-status`,{
        headers:{ Authorization:`Bearer ${sessionToken}` },
      }).then(r=>r.json()).then(d=>{
        if(d.remaining>0) setFreeLeft(d.remaining);
      }).catch(()=>{});
    }
    return ()=>{
      if(animRef.current)    clearInterval(animRef.current);
      if(symAnimRef.current) clearInterval(symAnimRef.current);
    };
  },[]);

  // ── Symbol animation helpers ────────────────────────────────────────────────
  const stopSymbolAnims = useCallback(()=>{
    if(symAnimRef.current){ clearInterval(symAnimRef.current); symAnimRef.current=null; }
    for(const cv of animCanvasRefs.current){
      if(!cv) continue;
      cv.style.visibility="hidden";
      cv.getContext("2d")?.clearRect(0,0,cv.width,cv.height);
    }
    for(const img of cellImgRefs.current){
      if(img){
        img.style.visibility="";
        img.style.display="";
      }
    }
    // Symbol anims and the per-payline "multi" cue share a lifecycle —
    // spin-start or sequence-cancellation tears them down together so
    // the sound never lingers into the next spin.
    stopCustomSound("multi");
  },[]);

  const startSymbolAnims = useCallback((winIndices: Set<number>)=>{
    if(symAnimRef.current){ clearInterval(symAnimRef.current); symAnimRef.current=null; }
    for(const cv of animCanvasRefs.current){
      if(!cv) continue;
      cv.style.visibility="hidden";
      cv.getContext("2d")?.clearRect(0,0,cv.width,cv.height);
    }
    if(winIndices.size===0) return;

    const drawFrame=(frame:number)=>{
      animCanvasRefs.current.forEach((cv,idx)=>{
        if(!cv||!winIndices.has(idx)) return;
        const sym = visibleSymsRef.current[idx];
        const sheet = frameImgsRef.current.get(sym);
        if(!sheet||!sheet.complete||sheet.naturalWidth===0) return;
        const fc = frame % SPRITE_COLS;
        const fr = Math.floor(frame / SPRITE_COLS);
        const ctx = cv.getContext("2d");
        if(!ctx) return;
        // Clear the canvas backbuffer (transparent) before drawing each sprite
        // frame. Canvas stays alpha-transparent; transparent pixels in the
        // source frame composite with the layers below.
        ctx.clearRect(0,0,cv.width,cv.height);
        ctx.drawImage(sheet, fc*SPRITE_CELL, fr*SPRITE_CELL, SPRITE_CELL, SPRITE_CELL,
                      0, 0, cv.width, cv.height);
        cv.style.visibility="visible";
        const staticImg = cellImgRefs.current[idx];
        if(staticImg){
          // Both visibility AND display must be toggled — CSS has been seen
          // overriding `visibility:hidden`, so use `display:none` to take the
          // static symbol fully out of the layer below the canvas.
          staticImg.style.visibility="hidden";
          staticImg.style.display="none";
        }
      });
    };

    drawFrame(0);
    let frame=1;
    const MS = Math.round(1000/ANIM_FPS);
    symAnimRef.current = setInterval(()=>{ drawFrame(frame); frame=(frame+1)%ANIM_FRAMES; }, MS);
  },[]);

  // Stop symbol animations when there are no wins; wins are animated
  // per-payline via the onLineActive callback passed to WesternPaylineOverlay.
  useEffect(()=>{
    if(!spinning && winCells.size===0) stopSymbolAnims();
  },[spinning, winCells]);

  // ── Big-win popup counter ──────────────────────────────────────────────────
  // The counter is time-based: skipped/throttled frames jump to the amount
  // implied by elapsed time instead of adding a fixed amount per frame.
  useEffect(()=>{
    if (popCounterFrameRef.current !== null) {
      cancelAnimationFrame(popCounterFrameRef.current);
      popCounterFrameRef.current = null;
    }
    popCounterAnimRef.current = null;
    // Gate on popupRevealed (not just winPopup) so the count-up doesn't
    // start the moment winPopup is set. winPopup gets created at
    // spin-result time — hundreds of ms before the popup JSX renders,
    // which is gated on popupRevealed. Without this gate, by the time
    // the popup mounts, popCounterValue has already reached the target
    // and the user sees a static number. Now: the roll-up starts on the
    // same frame the popup image becomes visible.
    if(!popupRevealed || !winPopup){ setPopCounterValue(0); return; }
    // Only 10×+ wins get a popup. Smaller wins remain represented by
    // the payline animation on the reels and must not start a hidden
    // counter animation.
    const counterMult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;
    if (!winPopup.isJackpot && counterMult < 10) {
      setPopCounterValue(0);
      return;
    }
    // Every popup tier (jackpot / huge / mega / small) animates the
    // count-up — the previous `mult < 5` early-exit left small wins
    // rendering the popup image with `+0` because the roll-up never
    // fired (bug shown in `image_1785190616734.png`). Now that all
    // tiers render the same overlay, the count-up applies to all of
    // them. If the spin paid nothing, we bail out above via the
    // winPopup.amount === 0 check below.
    if (!winPopup.amount || winPopup.amount <= 0) { setPopCounterValue(0); return; }
    const startCents = 0;
    const finalCents = Math.round(winPopup.amount * 100);
    const durationMs = getWinCountDuration(finalCents, Math.round(winPopup.bet * 100));
    const startTime = performance.now();
    popCounterAnimRef.current = { startCents, finalCents, startTime, durationMs };
    const frame = (now: number) => {
      const anim = popCounterAnimRef.current;
      if (!anim) return;
      const progress = Math.min(Math.max((now - anim.startTime) / anim.durationMs, 0), 1);
      const curvedProgress = Math.pow(progress, WIN_COUNT_CURVE_EXPONENT);
      const displayedCents = progress >= 1
        ? anim.finalCents
        : Math.round(anim.startCents + (anim.finalCents - anim.startCents) * curvedProgress);
      setPopCounterValue(displayedCents / 100);
      updateWinCountPitch(displayedCents, anim.finalCents);
      if (progress >= 1) {
        popCounterAnimRef.current = null;
        popCounterFrameRef.current = null;
        stopWinCountSound();
        return;
      }
      popCounterFrameRef.current = requestAnimationFrame(frame);
    };
    popCounterFrameRef.current = requestAnimationFrame(frame);
    return ()=>{
      if (popCounterFrameRef.current !== null) {
        cancelAnimationFrame(popCounterFrameRef.current);
        popCounterFrameRef.current = null;
      }
      popCounterAnimRef.current = null;
    };
  }, [popupRevealed, winPopup]);

  // Huge/Mega/Jackpot popups share a looping count-up bed. Start it only
  // after the popup is revealed, and stop it as soon as the displayed amount
  // reaches the exact final payout. This also covers the Mega popup's Huge
  // intro because the loop is tied to the amount counter, not the artwork
  // stage.
  useEffect(() => {
    if (popupRevealed && winPopup && !showBonusEnd) {
      const mult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;
      const eligible = winPopup.isJackpot || mult >= 10;
      const countFinished = popCounterValue >= winPopup.amount;
      if (eligible && !countFinished) {
        startWinCountSound();
        updateWinCountPitch(Math.round(popCounterValue * 100), Math.round(winPopup.amount * 100));
      }
      else stopWinCountSound();
    } else {
      stopWinCountSound();
    }
  }, [popupRevealed, winPopup, showBonusEnd, popCounterValue]);

  // Reuse the win-count bed for the bonus exit summary. It starts with the
  // total-win counter and ends only when the displayed amount reaches the
  // exact cumulative bonus payout, so tapping the scene cannot cut off the
  // audio/count-up pairing.
  useEffect(() => {
    if (showBonusEnd && bonusWinTotal > 0 && !bonusEndCountComplete) {
      startWinCountSound();
      updateWinCountPitch(
        Math.round(bonusEndDisplayed * 100),
        Math.round(bonusWinTotal * 100),
      );
    } else if (showBonusEnd && bonusEndCountComplete) {
      stopWinCountSound();
    }
  }, [showBonusEnd, bonusWinTotal, bonusEndDisplayed, bonusEndCountComplete]);

  useEffect(() => () => stopWinCountSound(), []);

  // Give the Mega Win popup its own reveal beat. This is intentionally
  // separate from the amount counter: the number keeps rolling while the
  // artwork transitions from Huge Win to Mega Win.
  useEffect(() => {
    if (megaPopupTimerRef.current !== null) {
      clearTimeout(megaPopupTimerRef.current);
      megaPopupTimerRef.current = null;
    }
    setMegaPopupStage("mega");
    if (!popupRevealed || !winPopup || winPopup.isJackpot) return;
    const mult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;
    // Match the Rome tier thresholds: 10×+ is Huge, 20×+ is Mega.
    // Only the 10×–19.99× range gets the Huge → Mega reveal. Lower
    // wins stay on the Huge-style artwork and must never flash Mega.
    if (mult < 10 || mult >= 20) return;

    setMegaPopupStage("huge");
    megaPopupTimerRef.current = setTimeout(() => {
      setMegaPopupStage("mega");
      megaPopupTimerRef.current = null;
    }, 900);
    return () => {
      if (megaPopupTimerRef.current !== null) {
        clearTimeout(megaPopupTimerRef.current);
        megaPopupTimerRef.current = null;
      }
    };
  }, [popupRevealed, winPopup]);

  // Fire win_end_bet exactly once when popupRevealed flips true (i.e. the
  // last distinct payline has been shown for the first time in this
  // sequence). The static total money text and the sting land together,
  // AFTER every multi/payline has been played. Latched via
  // winEndBetPlayedRef (cleared on overlayWins flip) so loop cycles and
  // re-renders cannot replay the cue.
  useEffect(()=>{
    if(!popupRevealed) return;
    if(winEndBetPlayedRef.current) return;
    winEndBetPlayedRef.current = true;
    // 500ms gap so the win_bet sting sits clearly after the final multi tail
    // — long enough to read as its own celebratory beat, short enough not
    // to feel like two separate events.
    setTimeout(() => soundsRef.current.playWin(0, 0), 500);
  }, [popupRevealed]);

  // Tracks payline shapes that already fired the "multi" cue in the current
  // sequence, plus a latch so win_end_bet fires exactly once at the very
  // end — only after every distinct payline has been shown at least once.
  const playedPaylineKeysRef = useRef<Set<string>>(new Set());
  const winEndBetPlayedRef    = useRef(false);

  // Reset both on every new win sequence (overlayWins flips).
  useEffect(() => {
    playedPaylineKeysRef.current.clear();
    winEndBetPlayedRef.current = false;
    setPopupRevealed(false);
  }, [overlayWins]);

  // Per-payline symbol animation — called by WesternPaylineOverlay each time
  // the active payline changes. Stops any current canvas anims, then starts
  // fresh ones only for the cells that belong to the newly active payline.
  // On every UNIQUE payline shape, fires the "multi" cue (loop cycles reuse
  // the same positions-array, so the dedup blocks replay). Once every
  // distinct payline has been shown at least once, fires the win_end_bet
  // sting via a small 350ms delay so it is audibly separated from the
  // last "multi" cue — exactly one sting per sequence.
  const onLineActive = useCallback(
    (positions: Array<{ reel: number; row: number; symbol: string }>) => {
      stopSymbolAnims();
      const indices = new Set(positions.map(p => p.reel * N_ROWS + p.row));
      if (indices.size > 0) startSymbolAnims(indices);
      const key = positions.map(p => `${p.reel},${p.row}`).join("|");
      if (!playedPaylineKeysRef.current.has(key)) {
        playedPaylineKeysRef.current.add(key);
        playCustomSound("multi");
        // All distinct paylines in this sequence have now been seen at
        // least once. Reveal the popup + fire win_end_bet on this frame
        // (via the [popupRevealed] useEffect) so the static total money
        // text and the sting land AFTER every multi cue and payline
        // trace, never before.
        if (playedPaylineKeysRef.current.size >= overlayWins.length) {
          setPopupRevealed(true);
        }
      }
    },
    [stopSymbolAnims, startSymbolAnims, overlayWins],
  );

  // ── Spin ───────────────────────────────────────────────────────────────────
  const spinOnce = useCallback(async()=>{
    if(spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    setWinCells(new Set());
    setWinPopup(null);
    setOverlayWins([]);
    stopSymbolAnims();
    soundsRef.current.playSpinStart();

    // ── Call backend: deduct bet, generate result, credit win ──────────────
    let data: any = null;
    const isFree = freeLeftRef.current > 0;
    let awardedFreeSpins = 0;
    try {
      const url = isFree
        ? `${BASE}/api/western-slots/free-spin`
        : `${BASE}/api/western-slots/spin`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${sessionToken}` },
        body: isFree ? undefined : JSON.stringify({ bet: betRef.current }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Spin failed");
      if (isFree) setFreeLeft(data.freeSpinsRemaining ?? 0);
      else {
        awardXP(betRef.current);
        if (data.freeSpinsAwarded > 0) awardedFreeSpins = data.freeSpinsAwarded;
      }
      // Challenge tracking — fires after confirmed server transaction
      fireChallengeEvent("any_game_round_played");
      if (!isFree) {
        fireChallengeEvent("bet_wagered", { amount: betRef.current });
        fireChallengeEvent("single_bet_placed", { amount: betRef.current });
      }
      if ((data.totalWin ?? 0) > 0) fireChallengeEvent("bet_won");
      else fireChallengeEvent("bet_lost");
    } catch(e: any) {
      spinningRef.current = false;
      setSpinning(false);
      setErrMsg(e.message);
      return;
    }

    // cols[col][row] — column-major grid returned by server
    const result: SymId[][] = data.cols as SymId[][];

    // ── SCATTER tease setup (mirrors rome-slots) ────────────────────────────
    // Detect which columns hold a Scatter in the resolved result. The moment
    // the 2nd Scatter lands, every column from the next reel onward is given
    // additional random padding (TEASE_STEP * step where step=1,2,3…), so
    // each successive reel is still visibly spinning when the previous
    // teaser stops. The animate loop below pulses a yellow boxShadow on
    // the next unpaid reel and dims already-stopped reels.
    const scatterInCol: boolean[] = Array(N_REELS).fill(false);
    for (let c = 0; c < N_REELS; c++) {
      for (let r = 0; r < N_ROWS; r++) {
        if (result[c][r] === "Scatter") { scatterInCol[c] = true; break; }
      }
    }
    const teaseExtraSyms: number[] = Array(N_REELS).fill(0);
    let scsSoFar      = 0;
    let firstTeaseCol = -1;
    for (let c = 0; c < N_REELS; c++) {
      if (scatterInCol[c]) {
        scsSoFar++;
        if (scsSoFar === 2 && firstTeaseCol < 0) firstTeaseCol = c + 1;
      }
    }
    if (firstTeaseCol >= 0 && firstTeaseCol < N_REELS) {
      for (let c = firstTeaseCol; c < N_REELS; c++) {
        const step    = c - firstTeaseCol + 1; // 1, 2, 3 …
        const passLast = Math.max(0, REEL_PREFIXES[N_REELS - 1] - REEL_PREFIXES[c]);
        teaseExtraSyms[c] = passLast + TEASE_STEP * step;
      }
    }

    // Build strips top-to-bottom as [result_3, random_padding, prev_3].
    // Animation translates the strip DOWNWARD through the viewport, so symbols
    // enter from the top and exit at the bottom. Initial translateY is
    // -(length-3)*CELL_H (prev at viewport top) → target 0 (result at top).
    const newStrips = REEL_PREFIXES.map((pfx,col)=>{
      const prev = [0,1,2].map(r=>
        visibleSymsRef.current[col*N_ROWS+r] as SymId || "Bag"
      );
      return [
        result[col][0], result[col][1], result[col][2],
        ...Array.from({length:pfx},randSym),
        ...Array.from({length:teaseExtraSyms[col]},randSym),
        ...prev,
      ] as SymId[];
    });
    setStrips(newStrips);

    // Reset each strip to start with prev visible at viewport top:
    // translateY = -(strip.length - N_ROWS) * CELL_H (no CSS transition)
    for(let i=0;i<N_REELS;i++){
      const el = stripRefs.current[i];
      if(el){
        el.style.transition="none";
        el.style.transform=`translateY(${-(newStrips[i].length-N_ROWS)*CELL_H}px)`;
      }
    }

    // Wait 2 frames so React renders new strips + browser paints
    await delay(32);

    // Targets: slide DOWNWARD to 0 — strip's result rows (at head) align
    // with viewport top once translateY reaches 0.
    const targets = newStrips.map(()=>0);
    const yPos    = newStrips.map(strip=>-(strip.length-N_ROWS)*CELL_H);
    const stopped = Array(N_REELS).fill(false);

    // ── Sequential lift-before-spin: each reel lifts 8 px upward over 80 ms,
    //    returns to 0 over 80 ms, then enters the spin loop. ──────────────────
    const reelStarted = Array(N_REELS).fill(false);
    const LIFT_PX = 40, LIFT_MS = 90, STAGGER_MS = 85;
    for(let i=0;i<N_REELS;i++){
      ((col)=>{
        setTimeout(()=>{
          const cEl = containerRefs.current[col];
          const fEl = fillerRefs.current[col];
          if(!cEl){ reelStarted[col]=true; return; }
          const liftEls = [cEl, fEl].filter(Boolean) as HTMLElement[];
          liftEls.forEach(el=>{
            el.style.transition = `transform ${LIFT_MS}ms ease-out`;
            el.style.transform  = `translateY(-${LIFT_PX}px)`;
          });
          setTimeout(()=>{
            liftEls.forEach(el=>{
              el.style.transition = `transform ${LIFT_MS}ms ease-in`;
              el.style.transform  = "translateY(0)";
            });
            setTimeout(()=>{
              liftEls.forEach(el=>{ el.style.transition = "none"; });
              reelStarted[col] = true;
            }, LIFT_MS);
          }, LIFT_MS);
        }, col * STAGGER_MS);
      })(i);
    }

    if(animRef.current) clearInterval(animRef.current);

    // SCATTER cells accumulate across reels so all scatters — whether
    // they land early or late — animate together the moment each reel
    // settles. startSymbolAnims replaces the active canvas indices with
    // the union passed in, so calling it after each reel-stop correctly
    // unions scatter cells across all settled columns.
    const settledScatterCells = new Set<number>();

    // ── SCATTER tease helpers (closure-local; reset every spin) ───────────
    // Direct DOM writes to containerRefs, so React never re-renders the
    // pulse frames. The focus shifts reel-to-reel as the teaser lands;
    // resolution wipes all glow + dim styles.
    const applyTeaseDim = (idx: number) => {
      const el = containerRefs.current[idx];
      if (el) {
        el.style.transition = "filter 0.25s";
        el.style.filter     = "brightness(0.42)";
        el.style.boxShadow  = "";
      }
    };
    const clearTeaseEffects = () => {
      for (let j = 0; j < N_REELS; j++) {
        const el = containerRefs.current[j];
        if (el) {
          el.style.transition = "filter 0.3s, box-shadow 0.3s";
          el.style.filter     = "";
          el.style.boxShadow  = "";
        }
      }
    };
    let teaseScatterCount = 0;
    let teaseReelIdx      = -1;
    let pulsePhase        = 0;

    await Promise.race([
      new Promise<void>(resolve=>{
        animRef.current = setInterval(()=>{
          let anyMoving = false;
          // SCATTER tease pulse — sinusoidal brightness + yellow boxShadow
          // on the focused unstopped reel. Phase modulo 40 ≈ two full
          // breath cycles per ~640ms — matches rome-slots exactly.
          if (teaseReelIdx >= 0 && !stopped[teaseReelIdx]) {
            pulsePhase = (pulsePhase + 1) % 40;
            const bright  = 1.08 + 0.10 * Math.sin(pulsePhase * Math.PI / 20);
            const spread  = 18  + 8    * Math.sin(pulsePhase * Math.PI / 20);
            const glowEl  = containerRefs.current[teaseReelIdx];
            if (glowEl) {
              glowEl.style.transition = "";
              glowEl.style.filter     = `brightness(${bright.toFixed(3)})`;
              glowEl.style.boxShadow  = `0 0 ${spread.toFixed(0)}px 6px rgba(255,195,50,0.72)`;
            }
          }
          for(let i=0;i<N_REELS;i++){
            if(stopped[i]) continue;
            if(!reelStarted[i]){ anyMoving=true; continue; } // still lifting
            const remaining = targets[i]-yPos[i]; // positive, shrinking (translateY climbing toward 0)
            const speed = remaining>DECEL_ZONE
              ? SPIN_SPEED
              : Math.max(1.5, SPIN_SPEED*(remaining/DECEL_ZONE));
            yPos[i] += speed;
            const el = stripRefs.current[i];
            if(yPos[i]>=targets[i] || remaining<CELL_H*0.12){
              yPos[i]=targets[i];
              stopped[i]=true;
              soundsRef.current.playReelStop(i);
              if(el){ el.style.transition="none"; el.style.transform=`translateY(${targets[i]}px)`; }
              // Sync visibleSymsRef for the just-settled column so startSymbolAnims
              // looks up the correct sprite sheet on its very first frame.
              // visibleSymsRef is otherwise only refreshed after the
              // await Promise.race block, which fires AFTER every reel
              // settles — without this sync the canvas would draw the
              // previous spin's icon for ~50ms per frame before catching
              // up to SCATTER.
              // SCATTER landing punch — fires once per reel that resolves with at
              // least one Scatter on it (NOT per Scatter cell, so a column
              // with two Scatters hits the cue clean instead of double-
              // triggering). Latches via hasScatterInReel so the sound
              // doesn't accumulate as the loop iterates rows.
              let hasScatterInReel = false;
              for (let r = 0; r < N_ROWS; r++) {
                visibleSymsRef.current[i * N_ROWS + r] = result[i][r];
                if (result[i][r] === "Scatter") {
                  settledScatterCells.add(i * N_ROWS + r);
                  hasScatterInReel = true;
                }
              }
              if (hasScatterInReel) playCustomSound("scatter_land");
              if (settledScatterCells.size > 0) startSymbolAnims(settledScatterCells);

              // ── SCATTER tease orchestration (mirrors rome-slots) ────────
              // 1) When the focused tease reel stops: shift focus forward if
              //    it had no scatter & count < 3, otherwise wipe visuals.
              if (i === teaseReelIdx) {
                teaseReelIdx = -1;
                if (!scatterInCol[i] && teaseScatterCount < 3) {
                  let nextReel = -1;
                  for (let j = i + 1; j < N_REELS; j++) { if (!stopped[j]) { nextReel = j; break; } }
                  if (nextReel >= 0) {
                    teaseReelIdx = nextReel;
                    pulsePhase   = 0;
                    applyTeaseDim(i); // the just-stopped teaser dims like the others
                  } else {
                    clearTeaseEffects(); // ran out of reels — clean up
                  }
                } else {
                  clearTeaseEffects(); // 3rd scatter or already 3 — resolve
                }
              }
              // 2) Bump scatter count; arm the pulse exactly on the 2nd.
              if (scatterInCol[i]) {
                teaseScatterCount++;
                if (teaseScatterCount === 2) {
                  let nextReel = -1;
                  for (let j = i + 1; j < N_REELS; j++) { if (!stopped[j]) { nextReel = j; break; } }
                  if (nextReel >= 0) {
                    teaseReelIdx = nextReel;
                    pulsePhase   = 0;
                    for (let j = 0; j < N_REELS; j++) { if (stopped[j]) applyTeaseDim(j); }
                  }
                }
              }
              // 3) Dim any reel that stops after the tease is already live
              //    (running dim — re-applying keeps brightness override active).
              if (teaseReelIdx >= 0 && i !== teaseReelIdx) applyTeaseDim(i);
            } else {
              anyMoving=true;
              if(el) el.style.transform=`translateY(${yPos[i]}px)`;
            }
          }
          if(!anyMoving){
            clearInterval(animRef.current!);
            animRef.current=null;
            resolve();
          }
        },16);
      }),
      new Promise<void>(r=>setTimeout(r,10000)),
    ]);
    // Belt-and-braces: wipe any leftover tease glow/dim. The loop's
    // own focus-forward already cleared on every resolution; this is
    // a no-op safety net for the abrupt timeout path.
    clearTeaseEffects();
    // Force-snap all reels to their targets (safety — no-op if already snapped)
    if(animRef.current){ clearInterval(animRef.current); animRef.current=null; }
    for(let i=0;i<N_REELS;i++){
      const el=stripRefs.current[i];
      if(el){ el.style.transition="none"; el.style.transform=`translateY(${targets[i]}px)`; }
    }

    // Update visible symbol ref from result
    for(let col=0;col<N_REELS;col++){
      for(let row=0;row<N_ROWS;row++){
        visibleSymsRef.current[col*N_ROWS+row] = result[col][row];
      }
    }

    // One source of truth: backend lineWins for both display and cell highlighting.
    const lws: any[] = Array.isArray(data.lineWins) ? data.lineWins : [];
    setOverlayWins(lws);
    const totalWin = data.totalWin ?? 0;
    lastWinRef.current = totalWin;
    setLastWin(totalWin);

    // Build winning cells from backend positions — no independent re-evaluation.
    const winningCells = new Set<number>();
    for (const lw of lws) {
      if (Array.isArray(lw.positions)) {
        for (const pos of lw.positions) {
          winningCells.add((pos.reel as number) * N_ROWS + (pos.row as number));
        }
      }
    }
    // Always highlight any scatter cells that landed.
    const { scatters: scatterCount } = evalResult(result, betRef.current);
    for (let c = 0; c < N_REELS; c++) {
      for (let r = 0; r < N_ROWS; r++) {
        if (result[c][r] === "Scatter") winningCells.add(c * N_ROWS + r);
      }
    }
    setWinCells(winningCells);

    if (process.env.NODE_ENV !== "production") {
      console.log("[Western] FINAL GRID", result);
      console.log("[Western] LINE WINS", lws);
      console.log("[Western] TOTAL WIN", totalWin);
    }

    if (totalWin > 0) {
      // Keep popup tiers wager-relative. Paid spins use the current bet;
      // free spins use the persisted bonus bet returned by the server
      // (the same wager used to calculate the payout), never a fixed
      // coin threshold.
      const resultBet = isFree
        ? (Number(data.bonusBet) > 0 ? Number(data.bonusBet) : betRef.current)
        : betRef.current;
      const isJackpot = lws.some((lw: any) =>
        lw.symbol === "Wild" && lw.matchCount === 5
      );
      // "multi" cue + win_end_bet sting are fired from onLineActive at the
      // payline-animation level: multi on each unique payline shape, and
      // win_end_bet exactly once after every distinct payline in the
      // sequence has been shown. Spin-result site is cue-free.
      setWinPopup({ amount: totalWin, bet: resultBet, isJackpot, lineWins: lws, isFree, grid: result });
    }

    // Track cumulative bonus winnings
    if (isFree && totalWin > 0) {
      bonusWinRef.current += totalWin;
      setBonusWinTotal(bonusWinRef.current);
    }

    // Free spins triggered — show banner NOW (after reels land)
    if (awardedFreeSpins > 0) {
      setBonusWinTotal(0); bonusWinRef.current = 0;
      // Stop auto-spin so free spins are played manually (prevents race conditions)
      setAutoSpin(false); autoRef.current = false;
      setFreeLeft(f => f + awardedFreeSpins);
      freeLeftRef.current += awardedFreeSpins;
      setFreeTotal(awardedFreeSpins);
      // Celebratory sting that lands at the same instant the bonus
      // entry scene appears — distinct from the per-reel scatter /
      // background loop, so the event reads as a one-shot punch
      // rather than a machine-gun retrigger. (The old playFreeSpinTrigger
      // engine pulse was deliberately retired here so the sting reads
      // as the single bonus-arrival cue, not a stack of two.)
      playCustomSound("bonus_entry");
      // Bonus entry scene stays up until the user clicks to continue —
      // no auto-dismiss timer. Mirrors rome-slots behavior so the player
      // can read the count + tap at their own pace.
      setShowFreeSpinsBanner(true);
    }

    // Bonus round complete — show end summary (dismissed by player tap)
    if (isFree && (data.freeSpinsRemaining ?? 0) === 0) {
      spinningRef.current = false;
      setSpinning(false);
      // Cancel auto-spin — player must re-enable it after the bonus round
      setAutoSpin(false); autoRef.current = false;
      await new Promise(r => setTimeout(r, 700));
      stopLoop("western_bonus");
      // If the LAST free spin paid out any paylines, let every distinct
      // payline sequence complete one full presentation cycle before
      // switching to the bonus-complete scene. The overlay intentionally
      // cycles while a win is active, so waiting for a user click (or a
      // fixed safety timeout) can leave the win popup mounted underneath
      // the Congratulations card. Clear both layers explicitly after the
      // cycle so the end scene always starts on a clean canvas.
      if (totalWin > 0 && lws.length > 0) {
        const PAYLINE_CYCLE_MS = 1100;
        await delay(lws.length * PAYLINE_CYCLE_MS + 500);
        setWinPopup(null);
        setOverlayWins([]);
        winPopupDismissResolveRef.current = null;
        await delay(80);
      }
      // Hard-stop every win presentation before mounting the final bonus
      // scene. The explicit render gate below prevents a stale React commit
      // from showing the mega/huge popup underneath Congratulations.
      setWinPopup(null);
      setOverlayWins([]);
      setPopupRevealed(false);
      setWinCells(new Set());
      stopSymbolAnims();
       // Continue from the already-earned bonus total instead of restarting
       // the visual total from zero.
       const endValue = bonusWinRef.current;
       const startValue = bonusEndDisplayed;
       const startCents = Math.round(startValue * 100);
       const finalCents = Math.round(endValue * 100);
        const durationMs = getWinCountDuration(
         Math.max(0, finalCents - startCents),
         Math.round((Number(data.bonusBet) > 0 ? Number(data.bonusBet) : betRef.current) * 100),
        ) * BONUS_EXIT_DURATION_MULTIPLIER;
       if (bonusEndFrameRef.current !== null) {
         cancelAnimationFrame(bonusEndFrameRef.current);
         bonusEndFrameRef.current = null;
       }
       bonusEndAnimRef.current = null;
       setBonusEndDisplayed(startValue);
       bonusEndCountCompleteRef.current = finalCents <= startCents;
      setBonusEndCountComplete(bonusEndCountCompleteRef.current);
      setShowBonusEnd(true);
      if (endValue > 0 && !(typeof window !== "undefined"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
         const startTime = performance.now();
         bonusEndAnimRef.current = { startCents, finalCents, startTime, durationMs };
         const frame = (now: number) => {
           const anim = bonusEndAnimRef.current;
           if (!anim) return;
           const progress = Math.min(Math.max((now - anim.startTime) / anim.durationMs, 0), 1);
           const curvedProgress = Math.pow(progress, WIN_COUNT_CURVE_EXPONENT);
           const displayedCents = progress >= 1
             ? anim.finalCents
             : Math.round(anim.startCents + (anim.finalCents - anim.startCents) * curvedProgress);
           setBonusEndDisplayed(displayedCents / 100);
           updateWinCountPitch(displayedCents, anim.finalCents);
           if (progress >= 1) {
             bonusEndAnimRef.current = null;
             bonusEndFrameRef.current = null;
             bonusEndCountCompleteRef.current = true;
             setBonusEndCountComplete(true);
             stopWinCountSound();
             return;
           }
           bonusEndFrameRef.current = requestAnimationFrame(frame);
         };
         bonusEndFrameRef.current = requestAnimationFrame(frame);
      } else if (endValue > 0) {
        setBonusEndDisplayed(endValue);
        bonusEndCountCompleteRef.current = true;
        setBonusEndCountComplete(true);
         stopWinCountSound();
      }
      await new Promise<void>(r => {
        bonusEndResolveRef.current = () => {
          // Clicking skips the remaining animation and shows the exact total.
          if (!bonusEndCountCompleteRef.current) {
            const finalCents = Math.round(bonusWinRef.current * 100);
            setBonusEndDisplayed(finalCents / 100);
            bonusEndAnimRef.current = null;
            if (bonusEndFrameRef.current !== null) {
              cancelAnimationFrame(bonusEndFrameRef.current);
              bonusEndFrameRef.current = null;
            }
            bonusEndCountCompleteRef.current = true;
            setBonusEndCountComplete(true);
            stopWinCountSound();
            return;
          }
          r();
        };
      });
      setShowBonusEnd(false);
      bonusWinRef.current = 0;
      setBonusWinTotal(0);
      setBonusEndDisplayed(0);
      bonusEndCountCompleteRef.current = false;
      setBonusEndCountComplete(false);
      setFreeTotal(0);
       if (bonusEndFrameRef.current !== null) {
         cancelAnimationFrame(bonusEndFrameRef.current);
         bonusEndFrameRef.current = null;
       }
       bonusEndAnimRef.current = null;
      return;
    }

    spinningRef.current = false;
    setSpinning(false);
  },[stopSymbolAnims, sessionToken]);

  // Auto spin — pause on wins so popup is visible, then auto-dismiss
  useEffect(()=>{
    if(!autoSpin) return;
    let alive=true;
    (async()=>{
      while(alive&&autoRef.current){
        lastWinRef.current = 0;
        await spinOnce();
        const win = lastWinRef.current;
        // Big win (>= 5× bet): 3 s; any win: 2 s; no win: 400 ms
        const pause = win >= betRef.current * 5 ? 3000 : win > 0 ? 2000 : 400;
        await delay(pause);
        if(alive) setWinPopup(null);
        await delay(80);
      }
    })();
    return ()=>{ alive=false; };
  },[autoSpin,spinOnce]);

  const handleSpin = ()=>{
    if(spinning||autoSpin) return;
    spinOnce();
  };

  // ── Control bar centred on SPIN at x=960 ──────────────────────────────────
  const BAR_Y = 960;
  // Left of SPIN:  [Menu]60  [Info]164  [Lines]268  [−]452  [Bet]502  [+]676  [Max]726
  // SPIN centre x=960, w=196 → left=862
  // Right of SPIN: [Auto]1078  [Bal]1214  [Win]1438  [Set]1622

  return (
    <div ref={wrapperRef} style={{width:"100%",height:"100%",background:"#0D0804",
      display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Header */}
      <div style={{flexShrink:0,height:HEADER_H,
        background:"rgba(10,5,2,0.97)",
        borderBottom:"1px solid rgba(200,160,40,0.25)",
        display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"0 20px",zIndex:50}}>
        <button onClick={()=>navigate("/slots")} style={{
          background:"none",border:"none",cursor:"pointer",
          fontFamily:"Oswald,sans-serif",fontSize:13,letterSpacing:"0.06em",
          textTransform:"uppercase",color:"rgba(200,160,40,0.6)",padding:"4px 8px",
          borderRadius:6,
        }}
          onMouseEnter={e=>(e.currentTarget.style.color="#FFD060")}
          onMouseLeave={e=>(e.currentTarget.style.color="rgba(200,160,40,0.6)")}
        >← Slots</button>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",
          fontFamily:"Oswald,sans-serif",fontWeight:700,fontSize:20,
          letterSpacing:"0.12em",textTransform:"uppercase",
          color:"#8B2500",textShadow:"0 0 18px rgba(139,37,0,0.5)"}}>
          Big House Casino
        </div>
      </div>

      {/* Backdrop — sibling to game viewport so overflow:hidden can't trap it */}
      {showSfx&&<div onClick={()=>setShowSfx(false)}
        style={{position:"fixed",inset:0,zIndex:997}}/>}

      {/* Game viewport */}
      <div style={{flex:1,display:"flex",alignItems:"center",
        justifyContent:"center",overflow:"hidden",background:"#0D0804"}}>

        {/* ── 1920×1080 design canvas ── */}
        <div style={{width:CW,height:CH,flexShrink:0,position:"relative",
          transform:`scale(${scale})`,transformOrigin:"center center"}}>

          {/* z:0 — Background (2880×1620 PNG, CSS-fills canvas at 1.5× retina) */}
          <img src={WS+"screen/Background.webp"} draggable={false}
            style={{position:"absolute",inset:0,width:"100%",height:"100%",
              objectFit:"cover",zIndex:0,userSelect:"none"}}/>

          {/* z:1 — Reels.png dark panel (symbol cell backgrounds) */}
          <img src={WS+"screen/Reels.webp"} draggable={false}
            style={{position:"absolute",left:423,top:238,width:1075,height:645,
              zIndex:1,userSelect:"none"}}/>

          {/* z:2 — Reel strip windows — one per column ─────────────────────── */}
          {Array.from({length:N_REELS},(_,col)=>(
            <div key={col} ref={el=>{ containerRefs.current[col]=el; }} style={{
              position:"absolute",
              left:REEL_COL[col],
              top:REEL_TOP,
              width:CELL_W,
              height:CELL_H*N_ROWS,
              overflow:"hidden",
              zIndex:2,
            }}>
              {/* Inner scrolling strip — driven directly via DOM ref */}
              <div ref={el=>{ stripRefs.current[col]=el; }}
                style={{position:"absolute",top:0,width:"100%",willChange:"transform"}}>
                {strips[col]?.map((sym,idx)=>{
                  // Result cells are always the last N_ROWS entries in the strip
                  const resultStart = strips[col].length - N_ROWS;
                  const isResult    = idx >= resultStart;
                  const resultRow   = idx - resultStart;
                  const cellIdx     = col * N_ROWS + resultRow;
                  return (
                    <div
                      key={idx}
                      data-cell={isResult ? cellIdx : undefined}
                      style={{
                        width:CELL_W,height:CELL_H,flexShrink:0,
                        display:"flex",alignItems:"center",justifyContent:"center",
                      }}>
                      <img
                        ref={isResult ? el=>{ cellImgRefs.current[cellIdx]=el; } : undefined}
                        src={WS+"symbols/"+sym+".webp"} draggable={false}
                        style={{width:"100%",height:"100%",objectFit:"contain",
                          userSelect:"none"}}/>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Lift-filler: clone of each reel's bottom symbol, rendered directly
              beneath the reel window. Sits behind Reels Bottom.webp (z:3) at
              rest; rises into the 40 px gap exposed when the container lifts. */}
          {Array.from({length:N_REELS},(_,col)=>(
            strips[col]?.[N_ROWS-1] && (
              <div key={`fill-${col}`} ref={el=>{ fillerRefs.current[col]=el; }} style={{
                position:"absolute",
                left:REEL_COL[col],
                top:REEL_TOP+CELL_H*N_ROWS,
                width:CELL_W,height:CELL_H,
                display:"flex",alignItems:"center",justifyContent:"center",
                pointerEvents:"none",overflow:"hidden",zIndex:2,
              }}>
                <img src={WS+"symbols/"+strips[col][N_ROWS-1]+".webp"} draggable={false}
                  style={{width:"100%",height:"100%",objectFit:"contain",
                    userSelect:"none"}}/>
              </div>
            )
          ))}

          {/* z:27 — Canvas animation overlays — above the payline SVG (z:25) so
                    winning-symbol sprites render in front of the glow line.
                    Visibility is toggled per-payline via the onLineActive callback. */}
          {Array.from({length:N_REELS},(_,col)=>
            Array.from({length:N_ROWS},(_,row)=>{
              const idx = col*N_ROWS+row;
              return (
                <div key={`sa-${col}-${row}`} style={{
                  position:"absolute",
                  left:REEL_COL[col],
                  top:REEL_TOP+row*CELL_H,
                  width:CELL_W,height:CELL_H,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  pointerEvents:"none",
                  zIndex:27,
                }}>
                  <canvas
                    ref={el=>{ animCanvasRefs.current[idx]=el; }}
                    width={SPRITE_CELL} height={SPRITE_CELL}
                    style={{width:CELL_W,height:CELL_H,
                      imageRendering:"pixelated",visibility:"hidden"}}
                  />
                </div>
              );
            })
          )}


          {/* Dim overlay removed — handled inside WesternPaylineOverlay SVG */}

          {/* ── Payline glow overlay — pointer-events:none, z-index:20 ── */}
          <WesternPaylineOverlay
            wins={overlayWins}
            showTotalWin={!winPopup?.isFree}
            onLineActive={onLineActive}
          />

          {/* z:3 — Reels Up top beam */}
          <img src={WS+"screen/Reels Up.webp"} draggable={false}
            style={{position:"absolute",left:188,top:27,width:1543,height:211,
              zIndex:3,userSelect:"none"}}/>


          {/* z:3 — Reels Bottom shelf (control bar platform) */}
          <img src={WS+"screen/Reels Bottom.webp"} draggable={false}
            style={{position:"absolute",left:193,top:883,width:1535,height:228,
              zIndex:3,userSelect:"none"}}/>

          {/* z:6 — Left column pillar: ~40px overlap, raised to connect with top bar */}
          <img src={WS+"screen/Left Column.webp"} draggable={false}
            style={{position:"absolute",left:284,top:227,width:190,height:658,
              zIndex:6,userSelect:"none"}}/>

          {/* z:6 — Right column pillar: more overlap + raised to match left */}
          <img src={WS+"screen/Right Column.webp"} draggable={false}
            style={{position:"absolute",left:1464,top:235,width:211,height:650,
              zIndex:6,userSelect:"none"}}/>

          {/* z:4 — Lamps */}
          <img src={WS+"screen/Right Lamp.webp"} draggable={false}
            style={{position:"absolute",left:1700,top:130,width:190,height:529,
              zIndex:4,userSelect:"none"}}/>

          {/* z:4 — Horseshoe */}
          <img src={WS+"screen/Horseshoe.webp"} draggable={false}
            style={{position:"absolute",left:916,top:0,width:88,height:80,
              zIndex:4,userSelect:"none"}}/>

          {/* win popup rendered OUTSIDE scaled canvas — see below */}

          {/* Free spins counter — now rendered outside canvas as fixed overlay */}

          {/* ════════════════════════════════ CONTROL BAR (z:10) ═══════════════
              All centred on SPIN at x=960
              [Menu]60 [Set]164 [Lines]268 [−]452 [Bet]502 [+]676 [Max]726
              [SPIN] x=862,y=861,w=196,h=198
              [Auto]1078 [Bal]1214 [Win]1438 [Info]1622
          ═══════════════════════════════════════════════════════════════════════ */}

          {/* Settings button — far left (where Info was) */}
          <HoverBtn normal={WS+"screen/Settings Button Normal.webp"}
            hover={WS+"screen/Settings Button Hover.webp"}
            x={164} y={BAR_Y-42} w={84} h={84}
            onClick={()=>setShowSfx(v=>!v)}
            active={showSfx}/>

          {/* Info/paytable — far right (was far left) */}
          <HoverBtn normal={WS+"screen/Info Button Normal.webp"}
            hover={WS+"screen/Info Button Hover.webp"}
            x={1622} y={BAR_Y-42} w={84} h={84}
            onClick={()=>setShowInfo(true)}/>

          <Panel img={WS+"screen/Lines Button.webp"}
            x={268} y={BAR_Y} w={164} h={55} label="Lines" value="20"/>

          <HoverBtn normal={WS+"screen/Minus Button Normal.webp"}
            hover={WS+"screen/Minus Button Hover.webp"}
            x={452} y={BAR_Y-28} w={40} h={56} disabled={spinning}
            onClick={()=>setBet(b=>{
              const i=betSteps.indexOf(b);
              return i>0?betSteps[i-1]:betSteps[0];
            })}/>

          <Panel img={WS+"screen/Total Bet Button.webp"}
            x={502} y={BAR_Y} w={164} h={55} label="Total Bet" value={bet}/>

          <HoverBtn normal={WS+"screen/Plus Button Normal.webp"}
            hover={WS+"screen/Plus Button Hover.webp"}
            x={676} y={BAR_Y-28} w={40} h={56} disabled={spinning}
            onClick={()=>setBet(b=>{
              const i=betSteps.indexOf(b);
              return i<betSteps.length-1?betSteps[i+1]:betSteps[betSteps.length-1];
            })}/>

          <HoverBtn normal={WS+"screen/Max Bet Button Normal.webp"}
            hover={WS+"screen/Max Bet Button Hover.webp"}
            x={726} y={BAR_Y-47} w={116} h={95} disabled={spinning}
            label="Max Bet"
            onClick={()=>setBet(betSteps[betSteps.length-1])}/>

          {/* SPIN — centre at x=960 */}
          <HoverBtn normal={WS+"screen/Spin Button Normal.webp"}
            hover={WS+"screen/Spin Button Hover.webp"}
            x={862} y={BAR_Y-99} w={196} h={198}
            disabled={spinning}
            onClick={handleSpin}/>

          {/* Error toast */}
          {errMsg&&(
            <div onClick={()=>setErrMsg(null)} style={{
              position:"absolute",left:"50%",top:BAR_Y-160,zIndex:30,
              transform:"translateX(-50%)",cursor:"pointer",
              background:"rgba(100,10,10,0.97)",
              border:"2px solid rgba(220,60,60,0.7)",borderRadius:10,
              padding:"10px 28px",whiteSpace:"nowrap",
              fontFamily:"Oswald,sans-serif",fontSize:18,fontWeight:700,
              color:"#FF8080",letterSpacing:"0.08em",
            }}>{errMsg} — tap to dismiss</div>
          )}

          <HoverBtn normal={WS+"screen/Auto Spin Button Normal.webp"}
            hover={WS+"screen/Auto Spin Button Hover.webp"}
            x={1078} y={BAR_Y-47} w={116} h={95}
            active={autoSpin}
            label={autoSpin?"Auto ON":"Auto"}
            onClick={()=>setAutoSpin(a=>!a)}/>

          <Panel img={WS+"screen/Balance Button.webp"}
            x={1214} y={BAR_Y} w={204} h={55} label="Balance" value={chips}/>

          <Panel img={WS+"screen/Win Button.webp"}
            x={1438} y={BAR_Y} w={164} h={55} label="Win" value={lastWin||"—"} zIndex={25}/>


        </div>{/* end canvas */}

        {/* ── Win popup — rendered OUTSIDE scaled canvas (same pattern as Rome slots) ── */}
         {winPopup && popupRevealed && !showBonusEnd && (() => {
          const PP = WS + "popups/";
          const mult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;

           // Suppress sub-10× wins; the reel payline animation already
           // communicates those smaller payouts.
           if (!winPopup.isJackpot && mult < 10) return null;

           // 10×+ wins render through the full tiered popup pipeline.
           // Lock the tier before applying the Mega reveal sequence.
           // Huge wins must remain Huge throughout; only the lower Mega
           // tier is allowed to start on Huge artwork and then swap to
           // Mega artwork.
           // Match Rome: 10×+ is Huge, 20×+ is Mega. The Mega reveal
           // applies only to the 10×–19.99× range; lower wins also
           // remain on Huge-style artwork rather than falling through
           // to Mega.
           const isMegaWin = !winPopup.isJackpot && mult >= 20;
           const isHugeWin = !winPopup.isJackpot && mult >= 10 && !isMegaWin;
           const showingMegaIntro = isMegaWin && megaPopupStage === "huge";
           const cfg = winPopup.isJackpot
            ? { img: PP+"PopUp Jackpot.webp",  glow:"#ffe000", amtColor:"#fff8a0", textTop:"70%" }
             : isMegaWin
             ? showingMegaIntro
               ? { img: PP+"PopUp Huge Win.webp", glow:"#ff8800", amtColor:"#ffd580", textTop:"71%" }
               : { img: PP+"PopUp Mega Win.webp", glow:"#ffcc00", amtColor:"#ffe880", textTop:"71%" }
             : isHugeWin
            ? { img: PP+"PopUp Huge Win.webp",  glow:"#ff8800", amtColor:"#ffd580", textTop:"71%" }
              : { img: PP+"PopUp Huge Win.webp",  glow:"#ff8800", amtColor:"#ffd580", textTop:"71%" };

          return (
            <div style={{
              position:"fixed",inset:0,zIndex:9998,
              display:"flex",alignItems:"center",justifyContent:"center",
              background:"rgba(0,0,0,0.65)",
            }} onClick={()=>{
               if (popCounterAnimRef.current) {
                 setPopCounterValue(winPopup.amount);
                 popCounterAnimRef.current = null;
                 if (popCounterFrameRef.current !== null) {
                   cancelAnimationFrame(popCounterFrameRef.current);
                   popCounterFrameRef.current = null;
                 }
               }
              setWinPopup(null);
              stopWinCountSound();
              // Unblock the bonus-complete scene if it was waiting on
              // the win popup to clear during the last free spin.
              winPopupDismissResolveRef.current?.();
              winPopupDismissResolveRef.current = null;
            }}>
              <div style={{
                position:"relative",width:520,height:580,
                transform:`scale(${popupScale})`,transformOrigin:"center center",
              }}>
                <img src={cfg.img} draggable={false}
                  style={{position:"absolute",inset:0,width:"100%",height:"100%",
                    userSelect:"none",filter:`drop-shadow(0 0 30px ${cfg.glow}88)`}}/>
                <div style={{
                  position:"absolute",left:0,right:0,top:cfg.textTop,
                  display:"flex",flexDirection:"column",alignItems:"center",gap:6,
                }}>
                   {/* Animated total — popCounterValue ramps 0 → winPopup.amount
                           over ~5.5 s with easeOutCubic, gated on popupRevealed
                          so the roll coincides with the popup becoming visible
                          (not with winPopup being set). Final value lands on
                          winPopup.amount as a snap in the last frame. */}
                   <span style={{
                    fontFamily:"Oswald,sans-serif",fontWeight:900,
                    fontSize:72,color:cfg.amtColor,lineHeight:1,
                    textShadow:`0 0 30px ${cfg.glow},0 0 60px ${cfg.glow}88,0 3px 8px rgba(0,0,0,0.9)`,
                    letterSpacing:"0.03em",
                   }}>{Math.min(popCounterValue, winPopup.amount).toLocaleString()}</span>
                  {/* "BET Coins" subtitle + per-payline win strip removed —
                       only the rolling total amount renders inside the win
                       popup now. */}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Bonus round ENTRY scene — shown when 3+ Scatters award free spins.
            State is gated by `showFreeSpinsBanner` (set true in spinOnce after the
            `bonus_entry` custom sting is fired). Stays up until the user clicks
            to continue; the `startLoop("western_bonus")` music fires on that
            same click. */}
        {showFreeSpinsBanner && (
        <div
          onClick={() => { setShowFreeSpinsBanner(false); startLoop("western_bonus"); }}
          style={{
            position:"fixed",inset:0,zIndex:10000,cursor:"pointer",
            background:"radial-gradient(ellipse at 50% 48%, rgba(70,24,0,0.97) 0%, rgba(6,2,0,0.99) 72%)",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            overflow:"hidden",
          }}
        >
          {/* Rotating conic rays */}
          <div style={{
            position:"absolute",inset:"-50%",
            backgroundImage:[
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
            animation:"bonusRayRotate 12s linear infinite",
            pointerEvents:"none",
          }} />

          {/* Expanding rings */}
          {[0, 0.9, 1.8].map((delayS, i) => (
            <div key={i} style={{
              position:"absolute",
              width:320, height:320, borderRadius:"50%",
              border:`${i === 0 ? 2 : 1}px solid rgba(255,190,0,0.35)`,
              animation:`bonusRingExpand 2.4s ease-out ${delayS}s infinite`,
              pointerEvents:"none",
            }} />
          ))}

          {/* BONUS ROUND title */}
          <div style={{
            fontFamily:"'Cinzel',serif", fontWeight:900, fontSize:52,
            color:"#fcd34d", letterSpacing:"0.12em",
            textShadow:"0 0 40px rgba(255,200,0,0.9), 0 0 80px rgba(255,140,0,0.4), 0 4px 10px rgba(0,0,0,0.9)",
            animation:"bonusTitleCrash 0.65s cubic-bezier(0.34,1.56,0.64,1) both, bonusShimmer 2.2s ease-in-out 0.65s infinite",
          }}>⚡ BONUS ROUND ⚡</div>

          {/* Subtitle */}
          <div style={{
            fontFamily:"'Cinzel',serif", fontWeight:400, fontSize:15,
            color:"rgba(252,211,77,0.55)", letterSpacing:"0.45em",
            textTransform:"uppercase", marginTop:10, marginBottom:28,
            animation:"bonusSubtitleSlide 0.45s ease-out 0.5s both",
          }}>Free Spins Awarded</div>

          {/* Count */}
          <div style={{
            fontFamily:"'Oswald',sans-serif", fontWeight:900, fontSize:130,
            color:"#fff", lineHeight:1,
            textShadow:"0 0 60px rgba(255,180,0,1), 0 0 120px rgba(255,120,0,0.5), 0 4px 12px rgba(0,0,0,0.9)",
            animation:"bonusCountPop 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.85s both",
          }}>{freeTotal}</div>

          {/* "FREE SPINS" label */}
          <div style={{
            fontFamily:"'Cinzel',serif", fontWeight:700, fontSize:24,
            color:"rgba(252,211,77,0.85)", letterSpacing:"0.28em",
            textShadow:"0 2px 8px rgba(0,0,0,0.8)",
            animation:"bonusSubtitleSlide 0.45s ease-out 1.1s both",
            marginTop:6,
          }}>FREE SPINS</div>

          {/* Tap hint */}
          <div style={{
            position:"absolute", bottom:"7%",
            fontFamily:"'Cinzel',serif", fontSize:12,
            color:"rgba(255,210,80,0.35)", letterSpacing:"0.32em",
            textTransform:"uppercase",
            animation:"bonusSubtitleSlide 0.4s ease-out 1.6s both",
          }}>Tap anywhere to continue</div>
        </div>
      )}

        {/* ── Bonus active: screen edge glow ── */}
        {freeTotal>0&&!showFreeSpinsBanner&&!showBonusEnd&&(
          <div style={{position:"fixed",inset:0,zIndex:9990,pointerEvents:"none",
            border:"3px solid rgba(255,180,0,0.4)",borderRadius:2,
            animation:"bonusEdgePulse 1.8s ease-in-out infinite"}} />
        )}

        {/* ── Free spins counter (enhanced) ── */}
        {freeTotal>0&&!showFreeSpinsBanner&&!showBonusEnd&&(
          <div style={{
            position:"fixed",top:"3%",left:"50%",transform:"translateX(-50%)",
            zIndex:9996,pointerEvents:"none",
            background:"linear-gradient(135deg,rgba(40,15,0,0.97),rgba(80,30,0,0.97))",
            border:"2px solid rgba(255,180,40,0.65)",borderRadius:50,
            padding:"8px 24px",display:"flex",alignItems:"center",gap:18,
            animation:"freeSpinPulse 1.8s ease-in-out infinite",
          }}>
            <span style={{fontFamily:"Oswald,sans-serif",fontWeight:700,fontSize:13,
              color:"rgba(255,200,100,0.75)",letterSpacing:"0.18em",textTransform:"uppercase"}}>
              🤠 BONUS ROUND
            </span>
            <div style={{width:1,height:28,background:"rgba(255,180,0,0.3)"}}/>
            <div style={{display:"flex",alignItems:"baseline",gap:6}}>
              <span style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:38,
                color:"#fff",textShadow:"0 0 16px rgba(255,200,60,0.6)"}}>
                {freeLeft}
              </span>
              <span style={{fontFamily:"Oswald,sans-serif",fontSize:16,
                color:"rgba(255,200,80,0.5)"}}>
                / {freeTotal}
              </span>
            </div>
          </div>
        )}

        {/* ── Bonus round end screen ── */}
        {showBonusEnd&&(
          <>
            {/* Layer 1 — dark backdrop; click anywhere to dismiss */}
            <div
              style={{position:"fixed",inset:0,zIndex:9996,pointerEvents:"all",
                background:"rgba(0,0,0,0.88)"}}
              onClick={()=>{
                if (bonusEndCountCompleteRef.current) {
                  soundsRef.current.playWin(bonusEndDisplayed, betRef.current);
                }
                bonusEndResolveRef.current?.();
                bonusEndResolveRef.current=null;
              }}
            />

            {/* Card content; entire layer is clickable to dismiss */}
            <div
              style={{position:"fixed",inset:0,zIndex:9999,
                pointerEvents:"all",
                display:"flex",flexDirection:"column",
                alignItems:"center",justifyContent:"center",
                cursor:"pointer"}}
              onClick={()=>{
                if (bonusEndCountCompleteRef.current) {
                  soundsRef.current.playWin(bonusEndDisplayed, betRef.current);
                }
                bonusEndResolveRef.current?.();
                bonusEndResolveRef.current=null;
              }}
            >
              <div style={{
                display:"flex",flexDirection:"column",alignItems:"center",gap:16,
                animation:"bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both",
                background:"rgba(0,0,0,0.55)",
                borderRadius:22,
                padding:"40px 72px 36px",
                boxShadow:"0 0 90px rgba(255,180,40,0.20)",
              }}>
                <div style={{
                  fontFamily:"'Cinzel',serif", fontWeight:700, fontSize:36,
                  color:"#FFD060", letterSpacing:"0.18em",
                  textShadow:"0 0 30px rgba(255,200,60,0.55),0 2px 6px rgba(0,0,0,0.85)",
                }}>
                  Congratulations
                </div>

                {/* thin divider */}
                <div style={{width:160,height:1,marginTop:-2,
                  background:"linear-gradient(90deg,transparent,rgba(255,200,80,0.55),transparent)"}}/>

                <div style={{fontFamily:"Oswald,sans-serif",fontWeight:700,fontSize:22,
                  color:"rgba(255,210,120,0.75)",letterSpacing:"0.40em",
                  textTransform:"uppercase",marginTop:-2}}>
                  You Have Won
                </div>

                <div style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:110,
                  color:"#fff",lineHeight:1,
                  textShadow:"0 0 70px rgba(255,200,60,0.75),0 4px 14px rgba(0,0,0,0.9)"}}>
                  ${bonusEndDisplayed.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>

                <div style={{fontFamily:"Oswald,sans-serif",fontSize:20,
                  color:"rgba(255,210,100,0.75)",letterSpacing:"0.12em",
                  textTransform:"uppercase"}}>
                  In
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:700,
                    fontSize:30,letterSpacing:0,
                    color:"#FFD060",margin:"0 12px",lineHeight:1,
                    textShadow:"0 0 22px rgba(255,200,60,0.7),0 2px 6px rgba(0,0,0,0.85)",
                    verticalAlign:"-2px"}}>{freeTotal}</span>
                  Free Spins
                </div>

                <div style={{
                  marginTop:8,
                  fontFamily:"Oswald,sans-serif",fontWeight:600,fontSize:14,
                  letterSpacing:"0.30em",textTransform:"uppercase",
                  color:"rgba(255,210,120,0.45)",
                  animation:"bonusClickPulse 1.8s ease-in-out infinite",
                  userSelect:"none",
                }}>
                  Tap to Continue
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Sound settings panel — western Settings Pop Up image ── */}
        {showSfx&&(
          <>
            {/* Panel: 589×588 image rendered at 250×250 */}
            <div onClick={e=>e.stopPropagation()}
              style={{position:"fixed", bottom:72, left:8, zIndex:998,
                width:250, height:250, userSelect:"none"}}>
              <img src={WS+"popups/Settings Pop Up.webp"} draggable={false}
                style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>

              {/* Exit button — top-right corner of the parchment frame */}
              <img
                src={WS+"popups/Exit Button Normal.webp"} draggable={false}
                onClick={()=>setShowSfx(false)}
                style={{position:"absolute",top:"17%",right:"5%",width:28,height:28,
                  cursor:"pointer",zIndex:2}}
                onMouseEnter={e=>(e.currentTarget.src=WS+"popups/Exit Button Hover.webp")}
                onMouseLeave={e=>(e.currentTarget.src=WS+"popups/Exit Button Normal.webp")}
              />

              {/* Content area: parchment starts at ~21% top, ~8% sides, ~7% bottom */}
              <div style={{
                position:"absolute",
                top:"23%", bottom:"7%", left:"11%", right:"11%",
                display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"flex-start",
                paddingTop:10, gap:10, fontFamily:"Oswald,sans-serif",
              }}>
                {/* Sound label */}
                <span style={{color:"#4A1E00",fontSize:20,fontWeight:700,
                  letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:2}}>
                  Sound
                </span>

                {/* Mute — ON/OFF button image */}
                <div style={{display:"flex",alignItems:"center",
                  justifyContent:"space-between",width:"100%"}}>
                  <span style={{color:"#3D1500",fontSize:13,fontWeight:600,
                    letterSpacing:"0.05em"}}>Mute</span>
                  <img
                    src={WS+(sfxMuted?"popups/Radio Button Off.webp":"popups/Radio Button On.webp")}
                    draggable={false}
                    onClick={()=>{ const m=!sfxMuted; setSfxMuted(m); sounds.setMuted(m); setCustomSoundsMuted(m); }}
                    style={{width:76,height:36,cursor:"pointer",
                      opacity:1,transition:"opacity 0.15s"}}
                  />
                </div>

                {/* Volume row */}
                <div style={{display:"flex",alignItems:"center",gap:6,width:"100%"}}>
                  <span style={{color:sfxMuted?"rgba(61,21,0,0.35)":"#3D1500",
                    fontSize:12,fontWeight:600,letterSpacing:"0.05em",minWidth:30,
                    flexShrink:0}}>Vol</span>
                  <input type="range" min={0} max={1} step={0.05} value={sfxVolume}
                    disabled={sfxMuted}
                    onChange={e=>{const v=parseFloat(e.target.value);setSfxVolume(v);sounds.setVolume(v);setCustomSoundsVolume(v);}}
                    style={{flex:1,accentColor:"#7B3500",opacity:sfxMuted?0.25:1}}/>
                  <span style={{color:sfxMuted?"rgba(61,21,0,0.3)":"#5D2800",
                    fontSize:11,minWidth:30,textAlign:"right",flexShrink:0}}>
                    {sfxMuted?"—":Math.round(sfxVolume*100)+"%"}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Paytable overlay — outside scaled canvas so position:fixed works at true viewport res ── */}
        {showInfo&&(
          <div style={{position:"fixed",inset:0,zIndex:999,
            background:"rgba(8,4,2,0.92)",backdropFilter:"blur(8px)",
            display:"flex",alignItems:"center",justifyContent:"center"}}
            onClick={e=>{ if(e.target===e.currentTarget) setShowInfo(false); }}>
            <div style={{
              width:"min(960px,90vw)",
              maxHeight:"90vh",
              overflowY:"auto",
              background:"rgba(20,10,4,0.98)",
              border:"2px solid rgba(200,160,40,0.6)",
              borderRadius:16,padding:"40px 48px",position:"relative",
              boxShadow:"0 0 60px rgba(0,0,0,0.8)",
            }}>
              <div style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:32,
                letterSpacing:"0.14em",color:"#FFD060",textAlign:"center",
                textTransform:"uppercase",marginBottom:16,
                textShadow:"0 0 20px rgba(255,200,40,0.45)"}}>
                Deadwood Dollars — Paytable
              </div>

              {/* Rule banner */}
              <div style={{
                background:"rgba(139,37,0,0.25)",
                border:"1px solid rgba(200,100,40,0.5)",
                borderRadius:8,padding:"10px 18px",marginBottom:24,
                textAlign:"center",
              }}>
                <span style={{fontFamily:"Oswald,sans-serif",fontSize:15,fontWeight:700,
                  color:"rgba(255,190,100,0.95)",letterSpacing:"0.1em"}}>
                  ← Wins must run <em style={{color:"#FFD060"}}>consecutively from Reel 1</em> (left).&nbsp;
                  Gaps or different symbols in between = no win.
                </span>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:18,
                marginBottom:24}}>
                {(["Bag","Spades","Hearts","Crosses","Diamonds","Flask","Hat","Gun","Wild","Scatter"] as SymId[]).map(sym=>(
                  <div key={sym} style={{
                    background:"rgba(40,20,8,0.85)",
                    border:"1px solid rgba(200,160,40,0.3)",
                    borderRadius:10,padding:"18px 10px",textAlign:"center",
                  }}>
                    <img src={WS+"symbols/"+sym+".webp"} draggable={false}
                      style={{width:80,height:80,objectFit:"contain",
                        display:"block",margin:"0 auto 10px"}}/>
                    <div style={{fontFamily:"Oswald,sans-serif",fontSize:14,
                      fontWeight:700,color:"#FFD060",letterSpacing:"0.1em",
                      marginBottom:8,textTransform:"uppercase"}}>{sym}</div>
                    {sym==="Scatter"?(
                      <div style={{fontFamily:"Oswald,sans-serif",
                        color:"rgba(210,170,80,0.8)"}}>
                        <div style={{fontSize:11,color:"rgba(255,180,80,0.6)",marginBottom:4}}>
                          anywhere on grid
                        </div>
                        {([3,4,5] as const).map(n=>{
                          const mult = n===3?2:n===4?10:50;
                          return (
                            <div key={n} style={{fontSize:12,lineHeight:"1.8"}}>
                              {n} = {mult}× bet + {FREE_SPINS[n]} spins
                            </div>
                          );
                        })}
                      </div>
                    ):(
                      <>
                        <div style={{fontFamily:"Oswald,sans-serif",fontSize:11,
                          color:"rgba(255,180,80,0.6)",marginBottom:4}}>
                          in a row from reel 1
                        </div>
                        {[3,4,5].map(n=>(
                          <div key={n} style={{fontFamily:"Oswald,sans-serif",
                            fontSize:13,lineHeight:"1.7",
                            color: n===5?"#FFD060":n===4?"rgba(255,208,96,0.85)":"rgba(210,170,80,0.7)"}}>
                            {n} = {PAYTABLE[sym]?.[n]??0}× bet
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div style={{fontFamily:"Oswald,sans-serif",fontSize:13,
                color:"rgba(210,170,80,0.5)",textAlign:"center",
                letterSpacing:"0.06em"}}>
                WILD substitutes for all symbols &nbsp;·&nbsp; 20 paylines &nbsp;·&nbsp; Pays left to right only
              </div>

              <button onClick={()=>setShowInfo(false)} style={{
                position:"absolute",right:20,top:16,width:44,height:44,
                background:"rgba(0,0,0,0.55)",
                border:"1px solid rgba(200,160,40,0.45)",
                borderRadius:"50%",cursor:"pointer",color:"#FFD060",
                fontFamily:"Oswald,sans-serif",fontSize:22,fontWeight:900,
                display:"flex",alignItems:"center",justifyContent:"center",
                lineHeight:1}}>×</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
