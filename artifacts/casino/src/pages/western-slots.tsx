import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePageTracker } from "../lib/usePageTracker";
import { awardXP } from "../lib/rewardsState";

import { usePlayerSocket } from "../lib/usePlayerSocket";
import { isGameUnlocked, usePasswordGuard } from "../lib/gamePasswordGuard";
import buttonClickUrl from "@assets/buttonclick_1777322204907.mp3";
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
// setInterval (not RAF) because FiveM CEF throttles requestAnimationFrame.
// Each reel has a longer prefix so they stop LEFT → RIGHT naturally.
const REEL_PREFIXES = [16, 20, 24, 28, 32]; // random-symbols before the result
const SPIN_SPEED    = 38;                    // px per 16ms tick
const DECEL_ZONE    = CELL_H * 3.5;         // decelerate over last ~3.5 rows

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
const delay = (ms:number) => new Promise(r=>setTimeout(r,ms));

// ── Web Audio sound system ─────────────────────────────────────────────────────
function useWesternSounds() {
  const acRef = useRef<AudioContext|null>(null);
  const volRef   = useRef<number>(parseFloat(localStorage.getItem("deadwood-sfx-volume") ?? "1"));
  const mutedRef = useRef<boolean>(localStorage.getItem("deadwood-sfx-muted") === "true");
  const clickBufRef = useRef<AudioBuffer|null>(null);
  // Raw MP3 bytes fetched eagerly on mount — no AudioContext required
  const rawBytesRef = useRef<ArrayBuffer|null>(null);

  // Pre-fetch the click MP3 as soon as the component mounts
  useEffect(() => {
    fetch(buttonClickUrl)
      .then(r => r.arrayBuffer())
      .then(arr => { rawBytesRef.current = arr; })
      .catch(() => {});
  }, []);

  function ac(): AudioContext {
    if (!acRef.current || acRef.current.state === "closed") {
      acRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Bytes already fetched — decoding is ~1ms, so buffer is ready by next spin
      if (rawBytesRef.current && !clickBufRef.current) {
        acRef.current.decodeAudioData(rawBytesRef.current.slice(0))
          .then(buf => { clickBufRef.current = buf; })
          .catch(() => {});
      }
    }
    if (acRef.current.state === "suspended") acRef.current.resume();
    return acRef.current;
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
    src.connect(g).connect(ctx.destination);
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
    osc.connect(g).connect(ctx.destination);
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
      src.connect(gain).connect(ctx.destination);
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

  // Reel stop: firm clack + warm bronze chink — ~250 ms
  function playReelStop(_reelIndex: number) {
    const ctx = ac();
    const now = ctx.currentTime;
    // Mechanical clack: low-mid noise
    noiseBurst(ctx, now,         0.070, 32, 0.22, 175);
    // Body: low square sweep
    tone(ctx, now,         100,  0.10, 0.11, "square",    60);
    // Bronze chink: warm fundamental
    tone(ctx, now + 0.032, 660,  0.20, 0.10, "sine",     480);
    // Chink shimmer: soft overtone
    tone(ctx, now + 0.040, 1320, 0.12, 0.04, "triangle", 960);
  }

  // Win: coin tinks (more for bigger wins)
  function playWin(amount: number, bet: number) {
    if (amount <= 0) return;
    const ctx = ac();
    const now = ctx.currentTime;
    const mult = bet > 0 ? amount / bet : 1;
    const isBig = mult >= 8;
    const count = isBig ? 7 : Math.min(4, Math.ceil(mult));

    for (let i = 0; i < count; i++) {
      const t = now + i * (isBig ? 0.07 : 0.11);
      const baseFreq = 900 + Math.random() * 500;
      tone(ctx, t, baseFreq, 0.22, 0.28, "sine", baseFreq * 0.72);
    }

    if (isBig) {
      // Western fanfare: G-C-E-G-C ascending
      [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => {
        tone(ctx, now + 0.55 + i * 0.11, f, 0.28, 0.22, "triangle");
      });
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
function Panel({img,x,y,w,h,label,value}:{
  img:string;x:number;y:number;w:number;h:number;label:string;value:string|number;
}){
  return (
    <div style={{position:"absolute",left:x,top:y-h/2,width:w,height:h,
      userSelect:"none",zIndex:10}}>
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
  const lastWinRef = useRef(0);
  const [showInfo,setShowInfo]   = useState(false);
  const [errMsg,setErrMsg]       = useState<string|null>(null);
  const [winPopup,setWinPopup]   = useState<{amount:number;bet:number;isJackpot:boolean;lineWins:any[];isFree:boolean;grid:SymId[][]}|null>(null);
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
  const animRef        = useRef<ReturnType<typeof setInterval>|null>(null);
  // Canvas overlays for winning cell animations (15 cells: col*N_ROWS+row)
  const animCanvasRefs = useRef<(HTMLCanvasElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  // Static <img> elements in each result row cell (same 15-cell indexing)
  const cellImgRefs    = useRef<(HTMLImageElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  // Pre-loaded spritesheet images: sym → single HTMLImageElement (2580×430)
  const frameImgsRef   = useRef<Map<SymId,HTMLImageElement>>(new Map());
  // setInterval handle for symbol animation loop
  const symAnimRef     = useRef<ReturnType<typeof setInterval>|null>(null);

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
    for(const img of cellImgRefs.current){ if(img) img.style.visibility=""; }
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
        ctx.clearRect(0,0,cv.width,cv.height);
        ctx.drawImage(sheet, fc*SPRITE_CELL, fr*SPRITE_CELL, SPRITE_CELL, SPRITE_CELL,
                      0, 0, cv.width, cv.height);
        cv.style.visibility="visible";
        const staticImg = cellImgRefs.current[idx];
        if(staticImg) staticImg.style.visibility="hidden";
      });
    };

    drawFrame(0);
    let frame=1;
    const MS = Math.round(1000/ANIM_FPS);
    symAnimRef.current = setInterval(()=>{ drawFrame(frame); frame=(frame+1)%ANIM_FRAMES; }, MS);
  },[]);

  // Trigger / stop symbol animations whenever spin completes
  useEffect(()=>{
    if(!spinning){
      if(winCells.size>0) startSymbolAnims(winCells);
      else stopSymbolAnims();
    }
  },[spinning, winCells]);

  // ── Spin ───────────────────────────────────────────────────────────────────
  const spinOnce = useCallback(async()=>{
    if(spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    setWinCells(new Set());
    setWinPopup(null);
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
    } catch(e: any) {
      spinningRef.current = false;
      setSpinning(false);
      setErrMsg(e.message);
      return;
    }

    // cols[col][row] — column-major grid returned by server
    const result: SymId[][] = data.cols as SymId[][];

    // Build strips: [prev visible 3 rows, random padding, new result 3 rows]
    // y=0 shows the prev visible (seamless, no snap)
    const newStrips = REEL_PREFIXES.map((pfx,col)=>{
      const prev = [0,1,2].map(r=>
        visibleSymsRef.current[col*N_ROWS+r] as SymId || "Bag"
      );
      return [
        ...prev,
        ...Array.from({length:pfx},randSym),
        result[col][0], result[col][1], result[col][2],
      ] as SymId[];
    });
    setStrips(newStrips);

    // Reset all strips to y=0 (no CSS transition — direct DOM)
    for(const el of stripRefs.current){
      if(el){ el.style.transition="none"; el.style.transform="translateY(0)"; }
    }

    // Wait 2 frames so React renders new strips + browser paints
    await delay(32);

    // Targets: slide to show the result rows at the tail of each strip
    // target = -(strip.length - N_ROWS) * CELL_H
    const targets = newStrips.map(strip=>-(strip.length-N_ROWS)*CELL_H);
    const yPos    = Array(N_REELS).fill(0);
    const stopped = Array(N_REELS).fill(false);

    if(animRef.current) clearInterval(animRef.current);

    await Promise.race([
      new Promise<void>(resolve=>{
        animRef.current = setInterval(()=>{
          let anyMoving = false;
          for(let i=0;i<N_REELS;i++){
            if(stopped[i]) continue;
            const remaining = yPos[i]-targets[i]; // positive, shrinking
            const speed = remaining>DECEL_ZONE
              ? SPIN_SPEED
              : Math.max(1.5, SPIN_SPEED*(remaining/DECEL_ZONE));
            yPos[i] -= speed;
            const el = stripRefs.current[i];
            if(yPos[i]<=targets[i] || remaining<CELL_H*0.12){
              yPos[i]=targets[i];
              stopped[i]=true;
              soundsRef.current.playReelStop(i);
              if(el){ el.style.transition="none"; el.style.transform=`translateY(${targets[i]}px)`; }
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
      const isJackpot = lws.some((lw: any) => lw.symbol === "Wild" && lw.matchCount === 5);
      soundsRef.current.playWin(totalWin, betRef.current);
      setWinPopup({ amount: totalWin, bet: betRef.current, isJackpot, lineWins: lws, isFree, grid: result });
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
      soundsRef.current.playFreeSpinTrigger();
      setShowFreeSpinsBanner(true);
      await new Promise(r => setTimeout(r, 4500));
      setShowFreeSpinsBanner(false);
    }

    // Bonus round complete — show end summary
    if (isFree && (data.freeSpinsRemaining ?? 0) === 0) {
      spinningRef.current = false;
      setSpinning(false);
      await new Promise(r => setTimeout(r, 700));
      setShowBonusEnd(true);
      await new Promise(r => setTimeout(r, 3500));
      setShowBonusEnd(false);
      bonusWinRef.current = 0;
      setBonusWinTotal(0);
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
            <div key={col} style={{
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
                    <div key={idx} style={{
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

          {/* z:8 — Canvas animation overlays (always in DOM, visibility toggled by JS) */}
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
                  zIndex:8,
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
            x={1438} y={BAR_Y} w={164} h={55} label="Win" value={lastWin||"—"}/>


        </div>{/* end canvas */}

        {/* ── Win popup — rendered OUTSIDE scaled canvas (same pattern as Rome slots) ── */}
        {winPopup && (() => {
          const PP = WS + "popups/";
          const mult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;

          // Small win: compact banner at bottom, no image
          if (!winPopup.isJackpot && mult < 5) {
            return (
              <div style={{
                position:"fixed",inset:0,zIndex:9998,pointerEvents:"none",
                display:"flex",alignItems:"flex-end",justifyContent:"center",
                paddingBottom:"7%",
              }}>
                <div style={{
                  display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                  background:"linear-gradient(180deg,rgba(40,15,0,0.97) 0%,rgba(15,5,0,0.97) 100%)",
                  border:"2px solid #8B4500",borderRadius:6,padding:"10px 40px 12px",
                  boxShadow:"0 0 24px rgba(200,100,0,0.5),0 4px 20px rgba(0,0,0,0.8)",
                }}>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:400,fontSize:11,
                    color:"rgba(255,200,100,0.8)",letterSpacing:"0.28em",textTransform:"uppercase"}}>
                    {winPopup.isFree ? "Bonus Win" : "You Win"}
                  </span>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:38,
                    color:"#ffd700",lineHeight:1,
                    textShadow:"0 0 18px rgba(255,180,0,0.9),0 2px 6px rgba(0,0,0,0.9)",
                    letterSpacing:"0.04em"}}>
                    +{winPopup.amount.toLocaleString()}
                  </span>
                  {winPopup.lineWins.length > 0 && (
                    <div style={{marginTop:6,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:3,
                      background:"rgba(0,0,0,0.35)",borderRadius:4,padding:"6px 12px"}}>
                      {winPopup.lineWins.map((lw:any,i:number)=>{
                        const ROW_LABEL=["Top","Mid","Bot"];
                        const pl=PAYLINES[lw.lineIndex];
                        const cells=Array.from({length:lw.count},(_,c)=>{
                          const row=pl[c];
                          const sym=winPopup.grid[c]?.[row]??"?";
                          return `R${c+1}:${ROW_LABEL[row]}=${sym}`;
                        });
                        return (
                          <div key={i} style={{fontFamily:"Oswald,sans-serif",fontSize:10,
                            color:"rgba(255,210,100,0.85)",letterSpacing:"0.05em",lineHeight:1.5}}>
                            <span style={{color:"rgba(255,230,130,0.6)"}}>Line {lw.lineIndex+1} </span>
                            {cells.join("  ")}
                            <span style={{color:"rgba(255,200,80,0.5)"}}> → </span>
                            <span style={{color:"#ffd700"}}>+{lw.win.toLocaleString()}{winPopup.isFree?" ×2":""}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:500,fontSize:10,
                    color:"rgba(200,160,60,0.75)",letterSpacing:"0.22em",textTransform:"uppercase",marginTop:2}}>
                    BET Coins
                  </span>
                </div>
              </div>
            );
          }

          // Big / jackpot wins: full overlay with asset image + popupScale
          const cfg = winPopup.isJackpot
            ? { img: PP+"PopUp Jackpot.webp",  glow:"#ffe000", amtColor:"#fff8a0", textTop:"62%" }
            : mult >= 15
            ? { img: PP+"PopUp Huge Win.webp",  glow:"#ff8800", amtColor:"#ffd580", textTop:"63%" }
            : { img: PP+"PopUp Mega Win.webp",  glow:"#ffcc00", amtColor:"#ffe880", textTop:"63%" };

          return (
            <div style={{
              position:"fixed",inset:0,zIndex:9998,
              display:"flex",alignItems:"center",justifyContent:"center",
              background:"rgba(0,0,0,0.65)",
            }} onClick={()=>setWinPopup(null)}>
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
                  <span style={{
                    fontFamily:"Oswald,sans-serif",fontWeight:900,
                    fontSize:72,color:cfg.amtColor,lineHeight:1,
                    textShadow:`0 0 30px ${cfg.glow},0 0 60px ${cfg.glow}88,0 3px 8px rgba(0,0,0,0.9)`,
                    letterSpacing:"0.03em",
                  }}>+{winPopup.amount.toLocaleString()}</span>
                  <span style={{
                    fontFamily:"Oswald,sans-serif",fontWeight:600,
                    fontSize:20,color:"rgba(255,220,100,0.85)",
                    textShadow:"0 2px 6px rgba(0,0,0,0.8)",
                    letterSpacing:"0.18em",textTransform:"uppercase",
                  }}>BET Coins</span>
                  {winPopup.lineWins.length > 0 && (
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",gap:4,marginTop:8,
                      background:"rgba(0,0,0,0.45)",borderRadius:6,padding:"8px 16px",maxHeight:180,overflowY:"auto"}}>
                      {winPopup.lineWins.map((lw:any,i:number)=>{
                        const lineNum  = lw.lineNumber ?? (lw.lineIndex + 1);
                        const count    = lw.matchCount ?? lw.count;
                        const sym      = lw.symbol;
                        const payVal   = lw.paytableValue ?? "?";
                        const payout   = lw.payout ?? lw.win;
                        const wild     = lw.usedWild;
                        return (
                          <div key={i} style={{fontFamily:"Oswald,sans-serif",fontSize:12,
                            color:"rgba(255,215,100,0.9)",letterSpacing:"0.04em",lineHeight:1.6}}>
                            <span style={{color:"rgba(255,230,140,0.5)",marginRight:6}}>L{lineNum}</span>
                            <span style={{fontWeight:700}}>{count}× {sym}</span>
                            <span style={{color:"rgba(255,200,80,0.55)",margin:"0 6px"}}>—</span>
                            <span>{payVal}× bet</span>
                            <span style={{color:"rgba(255,200,80,0.55)",margin:"0 6px"}}>—</span>
                            <span style={{color:"#ffd700",fontWeight:700}}>+{payout.toLocaleString()}{winPopup.isFree?" ×2":""}</span>
                            {wild&&<span style={{color:"rgba(200,180,255,0.6)",fontSize:10,marginLeft:6}}>· Wild</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Bonus active: screen edge glow ── */}
        {freeLeft>0&&!showFreeSpinsBanner&&!showBonusEnd&&(
          <div style={{position:"fixed",inset:0,zIndex:9990,pointerEvents:"none",
            border:"3px solid rgba(255,180,0,0.4)",borderRadius:2,
            animation:"bonusEdgePulse 1.8s ease-in-out infinite"}} />
        )}

        {/* ── Free spins counter (enhanced) ── */}
        {freeLeft>0&&!showFreeSpinsBanner&&!showBonusEnd&&(
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
            {bonusWinTotal>0&&(
              <>
                <div style={{width:1,height:28,background:"rgba(255,180,0,0.3)"}}/>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                  <span style={{fontFamily:"Oswald,sans-serif",fontSize:10,
                    color:"rgba(255,200,100,0.55)",letterSpacing:"0.15em"}}>WON</span>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:22,
                    color:"#FFD060",textShadow:"0 0 12px rgba(255,200,0,0.5)"}}>
                    +{bonusWinTotal.toLocaleString()}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Bonus round end screen ── */}
        {showBonusEnd&&(
          <div style={{position:"fixed",inset:0,zIndex:9997,pointerEvents:"none",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
            background:"rgba(0,0,0,0.85)"}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:16,
              animation:"bonusEndPop 0.65s cubic-bezier(0.34,1.56,0.64,1) both"}}>
              <div style={{fontFamily:"Oswald,sans-serif",fontWeight:400,fontSize:18,
                color:"rgba(255,210,120,0.65)",letterSpacing:"0.5em",textTransform:"uppercase"}}>
                BONUS ROUND COMPLETE
              </div>
              <div style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:52,
                color:"#FFD060",letterSpacing:"0.08em",
                animation:"bonusShimmer 1.4s ease-in-out infinite"}}>
                TOTAL WON
              </div>
              <div style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:96,
                color:"#fff",lineHeight:1,
                textShadow:"0 0 60px rgba(255,200,60,0.7),0 4px 12px rgba(0,0,0,0.9)"}}>
                +{bonusWinTotal.toLocaleString()}
              </div>
              <div style={{fontFamily:"Oswald,sans-serif",fontSize:20,
                color:"rgba(255,210,100,0.45)",letterSpacing:"0.18em"}}>
                BET COINS
              </div>
            </div>
          </div>
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
                    onClick={()=>{ const m=!sfxMuted; setSfxMuted(m); sounds.setMuted(m); }}
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
                    onChange={e=>{const v=parseFloat(e.target.value);setSfxVolume(v);sounds.setVolume(v);}}
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
