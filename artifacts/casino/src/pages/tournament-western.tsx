// Tournament-aware Western Slots — literal copy of western-slots.tsx with only:
// 1. Header changed (tournament name, countdown, leaderboard button, back to lobby)
// 2. Spin endpoint → /api/tournaments/:id/spin
// 3. Balance label → "T-Chips", value → tChips (from server responses)
// 4. No free spins (tournament mode)
// All reel animation, sound, image layout = unchanged from western-slots.tsx

import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../store";
import buttonClickUrl from "@assets/buttonclick_1777322204907.mp3";

const WS   = import.meta.env.BASE_URL + "western-slots/";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CW = 1920;
const CH = 1080;
const HEADER_H = 72;

const REEL_COL  = [423, 638, 853, 1068, 1283];
const REEL_TOP  = 238;
const CELL_W    = 215;
const CELL_H    = 215;
const N_REELS   = 5;
const N_ROWS    = 3;

const REEL_PREFIXES = [12, 15, 18, 21, 24];
const SPIN_SPEED    = 22;
const DECEL_ZONE    = CELL_H * 3.5;

const ANIM_FRAMES  = 24;
const ANIM_FPS     = 20;
const SPRITE_COLS  = 12;
const SPRITE_CELL  = 215;

type SymId = "Bag"|"Spades"|"Hearts"|"Crosses"|"Diamonds"|"Flask"|"Hat"|"Gun"|"Wild"|"Scatter";
const ANIM_SYMBOLS = new Set<SymId>(["Bag","Spades","Hearts","Crosses","Diamonds","Flask","Hat","Gun","Wild","Scatter"]);

const WEIGHTS: Record<SymId, number> = {
  Bag:32, Spades:34, Hearts:30, Crosses:26, Diamonds:22,
  Flask:18, Hat:14, Gun:10, Wild:7, Scatter:6,
};
const POOL: SymId[] = [];
(Object.entries(WEIGHTS) as [SymId,number][]).forEach(([id,w])=>{ for(let i=0;i<w;i++) POOL.push(id); });
const randSym = (): SymId => POOL[Math.floor(Math.random()*POOL.length)];

const PAYTABLE: Record<SymId, Partial<Record<number,number>>> = {
  Bag:     {3:7,   4:23,  5:70  },
  Spades:  {3:7,   4:30,  5:93  },
  Hearts:  {3:12,  4:35,  5:116 },
  Crosses: {3:12,  4:47,  5:175 },
  Diamonds:{3:18,  4:70,  5:233 },
  Flask:   {3:23,  4:93,  5:349 },
  Hat:     {3:26,  4:106, 5:529 },
  Gun:     {3:53,  4:212, 5:1059},
  Wild:    {3:106, 4:529, 5:2118},
  Scatter: {},
};
const FREE_SPINS: Record<number,number> = {3:8,4:12,5:18};
const DEFAULT_BET_STEPS = [20,40,100,200,400,1000,2000,5000];
const delay = (ms:number) => new Promise(r=>setTimeout(r,ms));

const PAYLINES: number[][] = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
  [1,0,0,0,1],[1,2,2,2,1],[0,0,1,2,2],[2,2,1,0,0],[1,0,1,2,1],
  [1,2,1,0,1],[0,1,1,1,2],[2,1,1,1,0],[0,1,2,2,2],[2,1,0,0,0],
  [0,0,1,0,0],[2,2,1,2,2],[1,1,0,1,1],[1,1,2,1,1],[0,1,0,1,0],
];

function evalScatters(cols: SymId[][]): number {
  let sc=0;
  for(let c=0;c<N_REELS;c++) for(let r=0;r<N_ROWS;r++) if(cols[c][r]==="Scatter") sc++;
  return sc;
}

function buildInitialStrips(visible: SymId[]): SymId[][] {
  return REEL_PREFIXES.map((pfx, col) => [
    ...Array.from({length: pfx}, randSym),
    visible[col*N_ROWS + 0], visible[col*N_ROWS + 1], visible[col*N_ROWS + 2],
  ]);
}

function useWesternSounds() {
  const acRef = useRef<AudioContext|null>(null);
  const volRef   = useRef<number>(parseFloat(localStorage.getItem("deadwood-sfx-volume") ?? "1"));
  const mutedRef = useRef<boolean>(localStorage.getItem("deadwood-sfx-muted") === "true");
  const clickBufRef = useRef<AudioBuffer|null>(null);
  const rawBytesRef = useRef<ArrayBuffer|null>(null);
  useEffect(() => {
    fetch(buttonClickUrl).then(r => r.arrayBuffer()).then(arr => { rawBytesRef.current = arr; }).catch(() => {});
  }, []);
  function ac(): AudioContext {
    if (!acRef.current || acRef.current.state === "closed") {
      acRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (rawBytesRef.current && !clickBufRef.current) {
        acRef.current.decodeAudioData(rawBytesRef.current.slice(0)).then(buf => { clickBufRef.current = buf; }).catch(() => {});
      }
    }
    if (acRef.current.state === "suspended") acRef.current.resume();
    return acRef.current;
  }
  function setVolume(v: number) { volRef.current = Math.max(0, Math.min(1, v)); localStorage.setItem("deadwood-sfx-volume", String(volRef.current)); }
  function setMuted(m: boolean) { mutedRef.current = m; localStorage.setItem("deadwood-sfx-muted", String(m)); }
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
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * volRef.current, startAt);
    src.connect(g).connect(ctx.destination); src.start(startAt); src.stop(startAt + dur);
  }
  function tone(ctx: AudioContext, startAt: number, freq: number, dur: number, vol: number, type: OscillatorType = "sine", freqEnd?: number) {
    if (mutedRef.current || volRef.current === 0) return;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, startAt + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol * volRef.current, startAt);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(g).connect(ctx.destination); osc.start(startAt); osc.stop(startAt + dur + 0.01);
  }
  function playSpinStart() {
    if (mutedRef.current || volRef.current === 0) return;
    const ctx = ac();
    const doPlay = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      const gain = ctx.createGain(); gain.gain.value = 0.275 * volRef.current;
      src.connect(gain).connect(ctx.destination); src.start(ctx.currentTime);
    };
    if (clickBufRef.current) doPlay(clickBufRef.current);
    else if (rawBytesRef.current) ctx.decodeAudioData(rawBytesRef.current.slice(0)).then(buf => { clickBufRef.current = buf; doPlay(buf); }).catch(() => {});
  }
  function playReelStop(reelIndex: number) {
    const ctx = ac(); const now = ctx.currentTime;
    noiseBurst(ctx, now, 0.11, 40, 0.38 - reelIndex * 0.02, 95 + reelIndex * 8);
    tone(ctx, now + 0.03, 1400 + reelIndex * 120, 0.18, 0.08, "sine");
  }
  function playWin(amount: number, bet: number) {
    if (amount <= 0) return;
    const ctx = ac(); const now = ctx.currentTime;
    const mult = bet > 0 ? amount / bet : 1;
    const isBig = mult >= 8; const count = isBig ? 7 : Math.min(4, Math.ceil(mult));
    for (let i = 0; i < count; i++) {
      const t = now + i * (isBig ? 0.07 : 0.11);
      const baseFreq = 900 + Math.random() * 500;
      tone(ctx, t, baseFreq, 0.22, 0.28, "sine", baseFreq * 0.72);
    }
    if (isBig) [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => { tone(ctx, now + 0.55 + i * 0.11, f, 0.28, 0.22, "triangle"); });
  }
  return { playSpinStart, playReelStop, playWin, setVolume, setMuted, volRef, mutedRef };
}

function HoverBtn({normal,hover,x,y,w,h,onClick,disabled=false,active=false,label}:{
  normal:string; hover:string; x:number; y:number; w:number; h:number;
  onClick?:()=>void; disabled?:boolean; active?:boolean; label?:string;
}){
  const [hov,setHov] = useState(false);
  return (
    <div style={{ position:"absolute",left:x,top:y,width:w,height:h,zIndex:10,
      cursor:disabled?"default":"pointer",opacity:disabled?0.45:1,userSelect:"none",
      outline:active?"2px solid rgba(255,210,60,0.8)":"none",borderRadius:4,boxSizing:"border-box" }}
      onClick={disabled?undefined:onClick}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <img src={hov&&!disabled?hover:normal} draggable={false} style={{width:"100%",height:"100%",objectFit:"contain"}}/>
      {label&&(<div style={{ position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
        fontFamily:"Oswald,sans-serif",fontWeight:700,fontSize:Math.round(h*0.2),letterSpacing:"0.06em",
        color:active?"#FFD060":"rgba(255,220,140,0.95)",textShadow:"0 1px 4px rgba(0,0,0,0.8)",
        textTransform:"uppercase",pointerEvents:"none"}}>{label}</div>)}
    </div>
  );
}

function Panel({img,x,y,w,h,label,value}:{img:string;x:number;y:number;w:number;h:number;label:string;value:string|number;}){
  return (
    <div style={{position:"absolute",left:x,top:y-h/2,width:w,height:h,userSelect:"none",zIndex:10}}>
      <div style={{position:"absolute",bottom:"100%",left:0,width:"100%",textAlign:"center",paddingBottom:6,pointerEvents:"none"}}>
        <span style={{fontFamily:"Oswald,sans-serif",fontSize:20,fontWeight:700,color:"rgba(255,210,110,0.98)",
          letterSpacing:"0.14em",textTransform:"uppercase",textShadow:"0 0 12px rgba(180,120,0,0.8), 0 1px 4px rgba(0,0,0,0.9)"}}>{label}</span>
      </div>
      <img src={img} draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%"}}/>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <span style={{fontFamily:"Oswald,sans-serif",fontSize:26,fontWeight:800,color:"#FFE070",
          letterSpacing:"0.04em",lineHeight:1,textShadow:"0 0 10px rgba(255,200,30,0.5)"}}>
          {typeof value==="number"?value.toLocaleString():value}
        </span>
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

export default function TournamentWestern({ tournamentId, tournamentName, initialChips, initialScore, endTime, minBet, maxBet, onBack, onLeaderboard }: Props) {
  const { sessionToken } = useStore();

  const [tChips, setTChips] = useState(initialChips);
  const [score, setScore]   = useState(initialScore);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (!endTime) { setCountdown(null); return; }
    const tick = () => setCountdown(Math.max(0, new Date(endTime).getTime() - Date.now()));
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [endTime]);

  const sounds = useWesternSounds();
  const soundsRef = useRef(sounds);
  useEffect(() => { soundsRef.current = sounds; });
  const [showSfx, setShowSfx] = useState(false);
  const [sfxMuted, setSfxMuted] = useState(() => sounds.mutedRef.current);
  const [sfxVolume, setSfxVolume] = useState(() => sounds.volRef.current);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale,setScale] = useState(1);
  const [popupScale,setPopupScale] = useState(1);
  useEffect(()=>{
    const el = wrapperRef.current; if(!el) return;
    const obs = new ResizeObserver(entries=>{
      const {width,height} = entries[0].contentRect;
      const availH = height - HEADER_H;
      setScale(Math.min(width/CW, availH/CH));
      setPopupScale(Math.min(width * 0.6 / 520, availH * 0.6 / 580));
    });
    obs.observe(el); return ()=>obs.disconnect();
  },[]);

  const betSteps = (() => {
    const steps = DEFAULT_BET_STEPS.filter(s => s >= minBet && s <= maxBet);
    if (steps.length === 0) return [minBet];
    if (!steps.includes(minBet)) steps.unshift(minBet);
    if (!steps.includes(maxBet)) steps.push(maxBet);
    return [...new Set(steps)].sort((a,b)=>a-b);
  })();

  const [bet,setBet] = useState(betSteps[0]);
  const betRef = useRef(bet);
  useEffect(()=>{ betRef.current=bet; },[bet]);
  const [spinning,setSpinning] = useState(false);
  const spinningRef = useRef(false);
  const [lastWin,setLastWin] = useState(0);
  const [autoSpin,setAutoSpin] = useState(false);
  const [showInfo,setShowInfo] = useState(false);
  const [errMsg,setErrMsg] = useState<string|null>(null);
  const [scatterMsg,setScatterMsg] = useState<string|null>(null);
  const [winPopup,setWinPopup] = useState<{amount:number;bet:number;isJackpot:boolean}|null>(null);
  const lastWinRef = useRef(0);
  const autoRef = useRef(autoSpin);
  useEffect(()=>{ autoRef.current=autoSpin; },[autoSpin]);

  const visibleSymsRef = useRef<SymId[]>(Array.from({length:N_REELS*N_ROWS}, randSym));
  const [strips, setStrips] = useState<SymId[][]>(() => buildInitialStrips(visibleSymsRef.current));
  const stripRefs      = useRef<(HTMLDivElement|null)[]>(Array(N_REELS).fill(null));
  const animRef        = useRef<ReturnType<typeof setInterval>|null>(null);
  const animCanvasRefs = useRef<(HTMLCanvasElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  const cellImgRefs    = useRef<(HTMLImageElement|null)[]>(Array(N_REELS*N_ROWS).fill(null));
  const frameImgsRef   = useRef<Map<SymId,HTMLImageElement>>(new Map());
  const symAnimRef     = useRef<ReturnType<typeof setInterval>|null>(null);

  useEffect(()=>{
    for(let i=0;i<N_REELS;i++){
      const el = stripRefs.current[i];
      if(el){ el.style.transition="none"; el.style.transform=`translateY(${-(REEL_PREFIXES[i]*CELL_H)}px)`; }
    }
    for(const sym of ANIM_SYMBOLS){
      const img = new Image(); img.src = `${WS}animations/${sym}/Spritesheet.webp`;
      frameImgsRef.current.set(sym, img);
    }
    return ()=>{ if(animRef.current) clearInterval(animRef.current); if(symAnimRef.current) clearInterval(symAnimRef.current); };
  },[]);

  const stopSymbolAnims = useCallback(()=>{
    if(symAnimRef.current){ clearInterval(symAnimRef.current); symAnimRef.current=null; }
    for(const cv of animCanvasRefs.current){ if(!cv) continue; cv.style.visibility="hidden"; cv.getContext("2d")?.clearRect(0,0,cv.width,cv.height); }
    for(const img of cellImgRefs.current){ if(img) img.style.visibility=""; }
  },[]);

  const startSymbolAnims = useCallback((winIndices: Set<number>)=>{
    if(symAnimRef.current){ clearInterval(symAnimRef.current); symAnimRef.current=null; }
    for(const cv of animCanvasRefs.current){ if(!cv) continue; cv.style.visibility="hidden"; cv.getContext("2d")?.clearRect(0,0,cv.width,cv.height); }
    if(winIndices.size===0) return;
    const drawFrame=(frame:number)=>{
      animCanvasRefs.current.forEach((cv,idx)=>{
        if(!cv||!winIndices.has(idx)) return;
        const sym = visibleSymsRef.current[idx];
        const sheet = frameImgsRef.current.get(sym);
        if(!sheet||!sheet.complete||sheet.naturalWidth===0) return;
        const fc = frame % SPRITE_COLS; const fr = Math.floor(frame / SPRITE_COLS);
        const ctx = cv.getContext("2d"); if(!ctx) return;
        ctx.clearRect(0,0,cv.width,cv.height);
        ctx.drawImage(sheet, fc*SPRITE_CELL, fr*SPRITE_CELL, SPRITE_CELL, SPRITE_CELL, 0, 0, cv.width, cv.height);
        cv.style.visibility="visible";
        const staticImg = cellImgRefs.current[idx]; if(staticImg) staticImg.style.visibility="hidden";
      });
    };
    drawFrame(0); let frame=1;
    const MS = Math.round(1000/ANIM_FPS);
    symAnimRef.current = setInterval(()=>{ drawFrame(frame); frame=(frame+1)%ANIM_FRAMES; }, MS);
  },[]);

  useEffect(()=>{
    if(!spinning){ if(winCells.size>0) startSymbolAnims(winCells); else stopSymbolAnims(); }
  },[spinning]);

  const [winCells, setWinCells] = useState<Set<number>>(new Set());

  const timeUp = countdown !== null && countdown <= 0;
  const eliminated = tChips <= 0;

  function fmtCountdown(ms: number) {
    if (ms <= 0) return "Time's up!";
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}:${s.toString().padStart(2,"0")}`;
  }

  const spinOnce = useCallback(async()=>{
    if(spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    setLastWin(0);
    setWinCells(new Set());
    setWinPopup(null);
    setScatterMsg(null);
    stopSymbolAnims();
    soundsRef.current.playSpinStart();

    let data: any = null;
    try {
      const r = await fetch(`${BASE}/api/tournaments/${tournamentId}/spin`, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${sessionToken}` },
        body: JSON.stringify({ betAmount: betRef.current }),
      });
      data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Spin failed");
    } catch(e: any) {
      spinningRef.current = false; setSpinning(false); setErrMsg(e.message); return;
    }

    const result: SymId[][] = data.grid as SymId[][];
    const newStrips = REEL_PREFIXES.map((pfx,col)=>{
      const prev = [0,1,2].map(r=> visibleSymsRef.current[col*N_ROWS+r] as SymId || "Bag");
      return [...prev, ...Array.from({length:pfx},randSym), result[col][0], result[col][1], result[col][2]] as SymId[];
    });
    setStrips(newStrips);
    for(const el of stripRefs.current){ if(el){ el.style.transition="none"; el.style.transform="translateY(0)"; } }
    await delay(32);

    const targets = newStrips.map(strip=>-(strip.length-N_ROWS)*CELL_H);
    const yPos = Array(N_REELS).fill(0);
    const stopped = Array(N_REELS).fill(false);
    if(animRef.current) clearInterval(animRef.current);

    await new Promise<void>(resolve=>{
      animRef.current = setInterval(()=>{
        let anyMoving = false;
        for(let i=0;i<N_REELS;i++){
          if(stopped[i]) continue;
          const remaining = yPos[i]-targets[i];
          const speed = remaining>DECEL_ZONE ? SPIN_SPEED : Math.max(1.5, SPIN_SPEED*(remaining/DECEL_ZONE));
          yPos[i] -= speed;
          const el = stripRefs.current[i];
          if(yPos[i]<=targets[i] || remaining<CELL_H*0.12){
            yPos[i]=targets[i]; stopped[i]=true;
            soundsRef.current.playReelStop(i);
            if(el){ el.style.transition="none"; el.style.transform=`translateY(${targets[i]}px)`; }
          } else { anyMoving=true; if(el) el.style.transform=`translateY(${yPos[i]}px)`; }
        }
        if(!anyMoving){ clearInterval(animRef.current!); animRef.current=null; resolve(); }
      },16);
    });

    for(let col=0;col<N_REELS;col++) for(let row=0;row<N_ROWS;row++) visibleSymsRef.current[col*N_ROWS+row] = result[col][row];

    const scatterCount = evalScatters(result);
    const cells = new Set<number>();
    // Highlight winning cells from server wins array
    for (const w of (data.wins ?? [])) {
      const line = PAYLINES[w.lineIndex]; if (!line) continue;
      for (let c = 0; c < w.count; c++) cells.add(c * N_ROWS + line[c]);
    }
    if (scatterCount >= 1) for(let c=0;c<N_REELS;c++) for(let r=0;r<N_ROWS;r++) if(result[c][r]==="Scatter") cells.add(c*N_ROWS+r);

    const totalWin = data.payout ?? 0;
    lastWinRef.current = totalWin;
    setLastWin(totalWin);
    setWinCells(cells);
    if (totalWin > 0) {
      const isJackpot = (data.wins??[]).some((w: any) => w.symbol === "Wild" && w.count === 5);
      soundsRef.current.playWin(totalWin, betRef.current);
      setWinPopup({ amount: totalWin, bet: betRef.current, isJackpot });
    }
    if (scatterCount > 0 && scatterCount < 3) {
      setScatterMsg(`${scatterCount} SCATTER — need ${3-scatterCount} more for free spins!`);
      setTimeout(() => setScatterMsg(null), 2500);
    }

    setTChips(data.tournamentChips ?? 0);
    setScore(data.score ?? 0);

    spinningRef.current = false; setSpinning(false);
  },[stopSymbolAnims, sessionToken, tournamentId]);

  useEffect(()=>{
    if(!autoSpin) return;
    let alive=true;
    (async()=>{
      while(alive&&autoRef.current){
        lastWinRef.current = 0;
        if (timeUp || tChips <= 0) { setAutoSpin(false); break; }
        await spinOnce();
        const win = lastWinRef.current;
        const pause = win >= betRef.current * 5 ? 3000 : win > 0 ? 2000 : 400;
        await delay(pause);
        if(alive) setWinPopup(null);
        await delay(80);
      }
    })();
    return ()=>{ alive=false; };
  },[autoSpin,spinOnce]);

  const handleSpin = ()=>{
    if(spinning||autoSpin||timeUp||eliminated) return;
    if(tChips < bet) { setErrMsg("Not enough tournament chips"); return; }
    spinOnce();
  };

  const BAR_Y = 960;

  return (
    <div ref={wrapperRef} style={{width:"100%",height:"100%",background:"#0D0804",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Header */}
      <div style={{flexShrink:0,height:HEADER_H,background:"rgba(10,5,2,0.97)",borderBottom:"1px solid rgba(200,160,40,0.25)",
        display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 20px",zIndex:50}}>
        <button onClick={onBack} style={{background:"none",border:"none",cursor:"pointer",fontFamily:"Oswald,sans-serif",
          fontSize:13,letterSpacing:"0.06em",textTransform:"uppercase",color:"rgba(200,160,40,0.6)",padding:"4px 8px",borderRadius:6}}
          onMouseEnter={e=>(e.currentTarget.style.color="#FFD060")} onMouseLeave={e=>(e.currentTarget.style.color="rgba(200,160,40,0.6)")}>
          ← Lobby
        </button>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
          <span style={{fontFamily:"Oswald,sans-serif",fontWeight:700,fontSize:18,letterSpacing:"0.12em",textTransform:"uppercase",color:"#8B2500",textShadow:"0 0 18px rgba(139,37,0,0.5)"}}>
            {tournamentName}
          </span>
          {countdown !== null && (
            <span style={{fontFamily:"Oswald,sans-serif",fontSize:12,fontWeight:700,letterSpacing:"0.1em",
              color: countdown<120000?"#f87171":countdown<3600000?"#fbbf24":"rgba(200,160,40,0.6)"}}>
              ⏱ {fmtCountdown(countdown)}
            </span>
          )}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontFamily:"Oswald,sans-serif",fontSize:12,color:"rgba(255,255,255,0.35)",letterSpacing:"0.06em"}}>
            Score: {score.toLocaleString()}
          </span>
          <button onClick={onLeaderboard} style={{background:"rgba(139,37,0,0.35)",border:"1px solid rgba(200,80,40,0.5)",
            borderRadius:6,cursor:"pointer",fontFamily:"Oswald,sans-serif",fontSize:12,fontWeight:700,
            color:"#FFD060",letterSpacing:"0.1em",textTransform:"uppercase",padding:"5px 14px"}}
            onMouseEnter={e=>(e.currentTarget.style.background="rgba(139,37,0,0.6)")}
            onMouseLeave={e=>(e.currentTarget.style.background="rgba(139,37,0,0.35)")}>
            🏆 Leaderboard
          </button>
        </div>
      </div>

      {showSfx&&<div onClick={()=>setShowSfx(false)} style={{position:"fixed",inset:0,zIndex:997}}/>}

      {/* Game viewport */}
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:"#0D0804"}}>

        <div style={{width:CW,height:CH,flexShrink:0,position:"relative",transform:`scale(${scale})`,transformOrigin:"center center"}}>

          <img src={WS+"screen/Background.webp"} draggable={false}
            style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover",zIndex:0,userSelect:"none"}}/>

          <img src={WS+"screen/Reels.webp"} draggable={false}
            style={{position:"absolute",left:423,top:238,width:1075,height:645,zIndex:1,userSelect:"none"}}/>

          {Array.from({length:N_REELS},(_,col)=>(
            <div key={col} style={{position:"absolute",left:REEL_COL[col],top:REEL_TOP,width:CELL_W,height:CELL_H*N_ROWS,overflow:"hidden",zIndex:2}}>
              <div ref={el=>{ stripRefs.current[col]=el; }} style={{position:"absolute",top:0,width:"100%",willChange:"transform"}}>
                {strips[col]?.map((sym,idx)=>{
                  const resultStart = strips[col].length - N_ROWS;
                  const isResult    = idx >= resultStart;
                  const resultRow   = idx - resultStart;
                  const cellIdx     = col * N_ROWS + resultRow;
                  return (
                    <div key={idx} style={{width:CELL_W,height:CELL_H,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <img ref={isResult ? el=>{ cellImgRefs.current[cellIdx]=el; } : undefined}
                        src={WS+"symbols/"+sym+".webp"} draggable={false}
                        style={{width:"100%",height:"100%",objectFit:"contain",userSelect:"none"}}/>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {Array.from({length:N_REELS},(_,col)=>Array.from({length:N_ROWS},(_,row)=>{
            const idx = col*N_ROWS+row;
            return (
              <div key={`sa-${col}-${row}`} style={{position:"absolute",left:REEL_COL[col],top:REEL_TOP+row*CELL_H,width:CELL_W,height:CELL_H,
                display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",zIndex:8}}>
                <canvas ref={el=>{ animCanvasRefs.current[idx]=el; }} width={SPRITE_CELL} height={SPRITE_CELL}
                  style={{width:CELL_W,height:CELL_H,imageRendering:"pixelated",visibility:"hidden"}}/>
              </div>
            );
          }))}

          <img src={WS+"screen/Reels Up.webp"} draggable={false} style={{position:"absolute",left:188,top:27,width:1543,height:211,zIndex:3,userSelect:"none"}}/>
          <img src={WS+"screen/Reels Bottom.webp"} draggable={false} style={{position:"absolute",left:193,top:883,width:1535,height:228,zIndex:3,userSelect:"none"}}/>
          <img src={WS+"screen/Left Column.webp"} draggable={false} style={{position:"absolute",left:284,top:227,width:190,height:658,zIndex:6,userSelect:"none"}}/>
          <img src={WS+"screen/Right Column.webp"} draggable={false} style={{position:"absolute",left:1464,top:235,width:211,height:650,zIndex:6,userSelect:"none"}}/>
          <img src={WS+"screen/Right Lamp.webp"} draggable={false} style={{position:"absolute",left:1700,top:130,width:190,height:529,zIndex:4,userSelect:"none"}}/>
          <img src={WS+"screen/Horseshoe.webp"} draggable={false} style={{position:"absolute",left:916,top:0,width:88,height:80,zIndex:4,userSelect:"none"}}/>

          {scatterMsg&&!spinning&&(
            <div style={{position:"absolute",left:"50%",top:lastWin>0?270:150,transform:"translateX(-50%)",zIndex:19,
              background:"rgba(20,0,40,0.88)",border:"1px solid rgba(180,80,255,0.5)",borderRadius:8,padding:"8px 22px",
              fontFamily:"Oswald,sans-serif",fontSize:16,fontWeight:700,color:"#d080ff",letterSpacing:"0.12em",
              textTransform:"uppercase",textShadow:"0 0 12px rgba(180,80,255,0.8)",whiteSpace:"nowrap"}}>{scatterMsg}</div>
          )}

          {(timeUp || eliminated) && (
            <div style={{position:"absolute",left:"50%",top:"42%",transform:"translate(-50%,-50%)",zIndex:20,textAlign:"center",
              background:"rgba(0,0,0,0.88)",border:"2px solid rgba(201,162,39,0.6)",borderRadius:18,padding:"36px 56px"}}>
              <div style={{fontFamily:"Oswald,sans-serif",fontSize:36,fontWeight:900,letterSpacing:"0.15em",textTransform:"uppercase",
                color:"#C9A227",textShadow:"0 0 24px rgba(201,162,39,0.7)"}}>
                {eliminated ? "Out of Chips" : "Time's Up!"}
              </div>
              <div style={{fontFamily:"Oswald,sans-serif",fontSize:22,color:"rgba(255,255,255,0.45)",marginTop:10}}>
                Final Score: <span style={{color:"#C9A227",fontWeight:800}}>{score.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Settings */}
          <HoverBtn normal={WS+"screen/Settings Button Normal.webp"} hover={WS+"screen/Settings Button Hover.webp"}
            x={164} y={BAR_Y-42} w={84} h={84} onClick={()=>setShowSfx(v=>!v)} active={showSfx}/>

          {/* Info/paytable */}
          <HoverBtn normal={WS+"screen/Info Button Normal.webp"} hover={WS+"screen/Info Button Hover.webp"}
            x={1622} y={BAR_Y-42} w={84} h={84} onClick={()=>setShowInfo(true)}/>

          <Panel img={WS+"screen/Lines Button.webp"} x={268} y={BAR_Y} w={164} h={55} label="Lines" value="20"/>

          <HoverBtn normal={WS+"screen/Minus Button Normal.webp"} hover={WS+"screen/Minus Button Hover.webp"}
            x={452} y={BAR_Y-28} w={40} h={56} disabled={spinning}
            onClick={()=>setBet(b=>{ const i=betSteps.indexOf(b); return i>0?betSteps[i-1]:betSteps[0]; })}/>

          <Panel img={WS+"screen/Total Bet Button.webp"} x={502} y={BAR_Y} w={164} h={55} label="Total Bet" value={bet}/>

          <HoverBtn normal={WS+"screen/Plus Button Normal.webp"} hover={WS+"screen/Plus Button Hover.webp"}
            x={676} y={BAR_Y-28} w={40} h={56} disabled={spinning}
            onClick={()=>setBet(b=>{ const i=betSteps.indexOf(b); return i<betSteps.length-1?betSteps[i+1]:betSteps[betSteps.length-1]; })}/>

          <HoverBtn normal={WS+"screen/Max Bet Button Normal.webp"} hover={WS+"screen/Max Bet Button Hover.webp"}
            x={726} y={BAR_Y-47} w={116} h={95} disabled={spinning} label="Max Bet"
            onClick={()=>setBet(betSteps[betSteps.length-1])}/>

          <HoverBtn normal={WS+"screen/Spin Button Normal.webp"} hover={WS+"screen/Spin Button Hover.webp"}
            x={862} y={BAR_Y-99} w={196} h={198} disabled={spinning||timeUp||eliminated||tChips<bet}
            onClick={handleSpin}/>

          {errMsg&&(
            <div onClick={()=>setErrMsg(null)} style={{position:"absolute",left:"50%",top:BAR_Y-160,zIndex:30,
              transform:"translateX(-50%)",cursor:"pointer",background:"rgba(100,10,10,0.97)",
              border:"2px solid rgba(220,60,60,0.7)",borderRadius:10,padding:"10px 28px",whiteSpace:"nowrap",
              fontFamily:"Oswald,sans-serif",fontSize:18,fontWeight:700,color:"#FF8080",letterSpacing:"0.08em"}}>
              {errMsg} — tap to dismiss
            </div>
          )}

          <HoverBtn normal={WS+"screen/Auto Spin Button Normal.webp"} hover={WS+"screen/Auto Spin Button Hover.webp"}
            x={1078} y={BAR_Y-47} w={116} h={95} active={autoSpin} label={autoSpin?"Auto ON":"Auto"}
            onClick={()=>setAutoSpin(a=>!a)}/>

          {/* T-Chips (replaces Balance) */}
          <Panel img={WS+"screen/Balance Button.webp"} x={1214} y={BAR_Y} w={204} h={55} label="T-Chips" value={tChips}/>

          <Panel img={WS+"screen/Win Button.webp"} x={1438} y={BAR_Y} w={164} h={55} label="Win" value={lastWin||"—"}/>

        </div>{/* end canvas */}

        {/* Win popup — outside scaled canvas */}
        {winPopup && (() => {
          const PP = WS + "popups/";
          const mult = winPopup.bet > 0 ? winPopup.amount / winPopup.bet : 0;
          if (!winPopup.isJackpot && mult < 5) {
            return (
              <div style={{position:"fixed",inset:0,zIndex:9998,pointerEvents:"none",
                display:"flex",alignItems:"flex-end",justifyContent:"center",paddingBottom:"7%"}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,
                  background:"linear-gradient(180deg,rgba(40,15,0,0.97) 0%,rgba(15,5,0,0.97) 100%)",
                  border:"2px solid #8B4500",borderRadius:6,padding:"10px 40px 12px",
                  boxShadow:"0 0 24px rgba(200,100,0,0.5),0 4px 20px rgba(0,0,0,0.8)"}}>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:400,fontSize:11,color:"rgba(255,200,100,0.8)",letterSpacing:"0.28em",textTransform:"uppercase"}}>You Win</span>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:38,color:"#ffd700",lineHeight:1,
                    textShadow:"0 0 18px rgba(255,180,0,0.9),0 2px 6px rgba(0,0,0,0.9)",letterSpacing:"0.04em"}}>
                    +{winPopup.amount.toLocaleString()}
                  </span>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:500,fontSize:10,color:"rgba(200,160,60,0.75)",letterSpacing:"0.22em",textTransform:"uppercase"}}>BET Coins</span>
                </div>
              </div>
            );
          }
          const cfg = winPopup.isJackpot
            ? { img: PP+"PopUp Jackpot.webp",  glow:"#ffe000", amtColor:"#fff8a0", textTop:"62%" }
            : mult >= 15
            ? { img: PP+"PopUp Huge Win.webp",  glow:"#ff8800", amtColor:"#ffd580", textTop:"63%" }
            : { img: PP+"PopUp Mega Win.webp",  glow:"#ffcc00", amtColor:"#ffe880", textTop:"63%" };
          return (
            <div style={{position:"fixed",inset:0,zIndex:9998,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.65)"}}
              onClick={()=>setWinPopup(null)}>
              <div style={{position:"relative",width:520,height:580,transform:`scale(${popupScale})`,transformOrigin:"center center"}}>
                <img src={cfg.img} draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",userSelect:"none",filter:`drop-shadow(0 0 30px ${cfg.glow}88)`}}/>
                <div style={{position:"absolute",left:0,right:0,top:cfg.textTop,display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:72,color:cfg.amtColor,lineHeight:1,
                    textShadow:`0 0 30px ${cfg.glow},0 0 60px ${cfg.glow}88,0 3px 8px rgba(0,0,0,0.9)`,letterSpacing:"0.03em"}}>
                    +{winPopup.amount.toLocaleString()}
                  </span>
                  <span style={{fontFamily:"Oswald,sans-serif",fontWeight:600,fontSize:20,color:"rgba(255,220,100,0.85)",
                    textShadow:"0 2px 6px rgba(0,0,0,0.8)",letterSpacing:"0.18em",textTransform:"uppercase"}}>BET Coins</span>
                </div>
              </div>
            </div>
          );
        })()}

      </div>

      {/* Sound panel */}
      {showSfx&&(
        <div onClick={e=>e.stopPropagation()} style={{position:"fixed",bottom:72,left:8,zIndex:998,width:250,height:250,userSelect:"none"}}>
          <img src={WS+"popups/Settings Pop Up.webp"} draggable={false} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
          <img src={WS+"popups/Exit Button Normal.webp"} draggable={false} onClick={()=>setShowSfx(false)}
            style={{position:"absolute",top:"17%",right:"5%",width:28,height:28,cursor:"pointer",zIndex:2}}
            onMouseEnter={e=>(e.currentTarget.src=WS+"popups/Exit Button Hover.webp")}
            onMouseLeave={e=>(e.currentTarget.src=WS+"popups/Exit Button Normal.webp")}/>
          <div style={{position:"absolute",top:"23%",bottom:"7%",left:"11%",right:"11%",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",paddingTop:10,gap:10,fontFamily:"Oswald,sans-serif"}}>
            <span style={{color:"#4A1E00",fontSize:20,fontWeight:700,letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:2}}>Sound</span>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%"}}>
              <span style={{color:"#3D1500",fontSize:13,fontWeight:600,letterSpacing:"0.05em"}}>Mute</span>
              <img src={WS+(sfxMuted?"popups/Radio Button Off.webp":"popups/Radio Button On.webp")} draggable={false}
                onClick={()=>{ const m=!sfxMuted; setSfxMuted(m); sounds.setMuted(m); }}
                style={{width:76,height:36,cursor:"pointer"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6,width:"100%"}}>
              <span style={{color:sfxMuted?"rgba(61,21,0,0.35)":"#3D1500",fontSize:12,fontWeight:600,letterSpacing:"0.05em",minWidth:30,flexShrink:0}}>Vol</span>
              <input type="range" min={0} max={1} step={0.05} value={sfxVolume} disabled={sfxMuted}
                onChange={e=>{const v=parseFloat(e.target.value);setSfxVolume(v);sounds.setVolume(v);}}
                style={{flex:1,accentColor:"#7B3500",opacity:sfxMuted?0.25:1}}/>
              <span style={{color:sfxMuted?"rgba(61,21,0,0.3)":"#5D2800",fontSize:11,minWidth:30,textAlign:"right",flexShrink:0}}>
                {sfxMuted?"—":Math.round(sfxVolume*100)+"%"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Paytable */}
      {showInfo&&(
        <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(8,4,2,0.92)",backdropFilter:"blur(8px)",
          display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={e=>{ if(e.target===e.currentTarget) setShowInfo(false); }}>
          <div style={{width:"min(960px,90vw)",maxHeight:"90vh",overflowY:"auto",background:"rgba(20,10,4,0.98)",
            border:"2px solid rgba(200,160,40,0.6)",borderRadius:16,padding:"40px 48px",position:"relative",
            boxShadow:"0 0 60px rgba(0,0,0,0.8)"}}>
            <div style={{fontFamily:"Oswald,sans-serif",fontWeight:900,fontSize:32,letterSpacing:"0.14em",color:"#FFD060",
              textAlign:"center",textTransform:"uppercase",marginBottom:16,textShadow:"0 0 20px rgba(255,200,40,0.45)"}}>
              Deadwood Dollars — Paytable
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:18,marginBottom:24}}>
              {(["Bag","Spades","Hearts","Crosses","Diamonds","Flask","Hat","Gun","Wild","Scatter"] as SymId[]).map(sym=>(
                <div key={sym} style={{background:"rgba(40,20,8,0.85)",border:"1px solid rgba(200,160,40,0.3)",borderRadius:10,padding:"18px 10px",textAlign:"center"}}>
                  <img src={WS+"symbols/"+sym+".webp"} draggable={false} style={{width:80,height:80,objectFit:"contain",display:"block",margin:"0 auto 10px"}}/>
                  <div style={{fontFamily:"Oswald,sans-serif",fontSize:14,fontWeight:700,color:"#FFD060",letterSpacing:"0.1em",marginBottom:8,textTransform:"uppercase"}}>{sym}</div>
                  {sym==="Scatter"?(
                    <div style={{fontFamily:"Oswald,sans-serif",color:"rgba(210,170,80,0.8)"}}>
                      <div style={{fontSize:11,color:"rgba(255,180,80,0.6)",marginBottom:4}}>anywhere on grid</div>
                      {[3,4,5].map(n=>(<div key={n} style={{fontSize:13,lineHeight:"1.7"}}>{n} = +{FREE_SPINS[n]} free spins</div>))}
                    </div>
                  ):(
                    <>
                      <div style={{fontFamily:"Oswald,sans-serif",fontSize:11,color:"rgba(255,180,80,0.6)",marginBottom:4}}>in a row from reel 1</div>
                      {[3,4,5].map(n=>(<div key={n} style={{fontFamily:"Oswald,sans-serif",fontSize:13,lineHeight:"1.7",
                        color:n===5?"#FFD060":n===4?"rgba(255,208,96,0.85)":"rgba(210,170,80,0.7)"}}>
                        {n} = {PAYTABLE[sym]?.[n]??0}× bet
                      </div>))}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{fontFamily:"Oswald,sans-serif",fontSize:13,color:"rgba(210,170,80,0.5)",textAlign:"center",letterSpacing:"0.06em"}}>
              WILD substitutes for all symbols &nbsp;·&nbsp; 20 paylines &nbsp;·&nbsp; Pays left to right only
            </div>
            <button onClick={()=>setShowInfo(false)} style={{position:"absolute",right:20,top:16,width:44,height:44,
              background:"rgba(0,0,0,0.55)",border:"1px solid rgba(200,160,40,0.45)",borderRadius:"50%",cursor:"pointer",
              color:"#FFD060",fontFamily:"Oswald,sans-serif",fontSize:22,fontWeight:900,
              display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>×</button>
          </div>
        </div>
      )}

    </div>
  );
}
