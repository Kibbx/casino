import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { awardXP } from "../lib/rewardsState";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { usePasswordGuard, isGameUnlocked } from "../lib/gamePasswordGuard";
import { motion } from "framer-motion";
import { ChevronLeft, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { PlayingCardImg } from "../components/PlayingCardImg";
import { playSound } from "../lib/sounds";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function parseCardLabel(label: string): { rank: string; suit: string } {
  return { rank: label.slice(0, -1), suit: label.slice(-1) };
}

const MULTIPLIER_STEPS = [1.0, 1.25, 1.55, 1.95, 2.50, 3.20, 4.10, 5.30, 6.80, 8.75, 11.25];

function getNextMultiplier(streak: number) {
  const next = streak + 1;
  if (next < MULTIPLIER_STEPS.length) return MULTIPLIER_STEPS[next];
  const last = MULTIPLIER_STEPS[MULTIPLIER_STEPS.length - 1];
  return parseFloat((last * Math.pow(1.30, next - (MULTIPLIER_STEPS.length - 1))).toFixed(2));
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

type Phase = "idle" | "playing" | "lost" | "cashed_out";
type FlipState = "none" | "out" | "in";

// ── Card component — uses the shared PlayingCardImg (same as blackjack/baccarat) ──
const CARD_W = 140, CARD_H = 196;

function PlayingCard({ cardLabel, faceDown = false, glow = "none", flipState = "none" }: {
  cardLabel: string | null;
  faceDown?: boolean;
  glow?: "win" | "lose" | "none";
  flipState?: FlipState;
}) {
  const rotateY = flipState === "out" ? 90 : flipState === "in" ? -90 : 0;

  const glowFilter =
    glow === "win"
      ? "drop-shadow(0 0 10px rgba(34,197,94,0.9)) drop-shadow(0 0 24px rgba(34,197,94,0.5))"
      : glow === "lose"
      ? "drop-shadow(0 0 10px rgba(239,68,68,0.9)) drop-shadow(0 0 24px rgba(239,68,68,0.5))"
      : "drop-shadow(0 8px 24px rgba(0,0,0,0.8))";

  const parsed = (!faceDown && cardLabel) ? parseCardLabel(cardLabel) : null;

  return (
    <motion.div
      animate={{ rotateY, scale: flipState !== "none" ? 0.88 : 1 }}
      transition={{ duration: 0.16, ease: "easeInOut" }}
      style={{ filter: glowFilter, flexShrink: 0, userSelect: "none" }}
    >
      <PlayingCardImg
        rank={parsed?.rank}
        suit={parsed?.suit}
        hidden={!parsed}
        width={CARD_W}
        height={CARD_H}
        animate={false}
      />
    </motion.div>
  );
}

const BET_PRESETS = [100, 500, 1000, 5000, 10000, 25000];

// ── Main page ───────────────────────────────────────────────────────────────
export default function HighLow() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("high-low", sessionToken);
  usePasswordGuard("highlow");
  useEffect(() => { if (!isGameUnlocked("highlow")) setLocation("/lobby"); }, []);

  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const [minBetLimit, setMinBetLimit] = useState(100);
  const [maxBetLimit, setMaxBetLimit] = useState(50000);

  useEffect(() => {
    if (!sessionToken) return;
    fetch(`${BASE}/api/high-low/status`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.json())
      .then(d => {
        if (d.minBet) setMinBetLimit(d.minBet);
        if (d.maxBet) setMaxBetLimit(d.maxBet);
      })
      .catch(() => {});
  }, [sessionToken]);

  const [phase, setPhase]             = useState<Phase>("idle");
  const [betInput, setBetInput]       = useState("500");
  const [bet, setBet]                 = useState(0);
  const [displayCard, setDisplayCard] = useState<string | null>(null);
  const [multiplier, setMultiplier]   = useState(1.0);
  const [streak, setStreak]           = useState(0);
  const [payout, setPayout]           = useState<number | null>(null);
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);
  const [isBusy, setIsBusy]           = useState(false);
  const [cardGlow, setCardGlow]       = useState<"win"|"lose"|"none">("none");
  const [flipState, setFlipState]     = useState<FlipState>("none");
  const [shakeScreen, setShakeScreen] = useState(false);
  const [multPulse, setMultPulse]     = useState(false);
  const [isTie, setIsTie]             = useState(false);

  // Restore active game on mount
  useEffect(() => {
    if (!sessionToken) { setLocation("/lobby"); return; }
    fetch(`${BASE}/api/high-low/active`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then(r => r.json()).then(d => {
        if (d.game) {
          setBet(d.game.bet); setDisplayCard(d.game.currentCard);
          setMultiplier(d.game.currentMultiplier); setStreak(d.game.streak);
          setPhase("playing");
        }
      }).catch(() => {});
  }, [sessionToken]);

  const balance = liveChips ?? 0;
  const isPlaying = phase === "playing";
  const nextMult = getNextMultiplier(streak);

  // ── Actions ──────────────────────────────────────────────────────────────
  async function startGame() {
    const betVal = parseInt(betInput.replace(/,/g, ""));
    if (!betVal || betVal < minBetLimit) { setErrorMsg(`Minimum bet is ${minBetLimit.toLocaleString()} chips`); return; }
    if (betVal > maxBetLimit)            { setErrorMsg(`Maximum bet is ${maxBetLimit.toLocaleString()} chips`); return; }
    if (betVal > balance)           { setErrorMsg("Insufficient chips"); return; }
    setErrorMsg(null); setIsBusy(true); setCardGlow("none");
    try {
      const res = await fetch(`${BASE}/api/high-low/start`, {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${sessionToken}`},
        body: JSON.stringify({ bet: betVal }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "active_game" && data.game) {
          setBet(data.game.bet); setDisplayCard(data.game.currentCard);
          setMultiplier(data.game.currentMultiplier); setStreak(data.game.streak);
          setPhase("playing");
        } else { setErrorMsg(data.error || "Failed to start game"); }
        return;
      }
      awardXP(betVal);
      setBet(data.bet); setDisplayCard(data.currentCard);
      setMultiplier(1.0); setStreak(0); setPhase("playing");
      playSound("chip");
    } catch { setErrorMsg("Network error — try again"); }
    finally  { setIsBusy(false); }
  }

  async function guess(direction: "higher"|"lower") {
    if (isBusy || phase !== "playing") return;
    setIsBusy(true); setErrorMsg(null); setCardGlow("none"); setIsTie(false);
    try {
      const res = await fetch(`${BASE}/api/high-low/guess`, {
        method:"POST", headers:{"Content-Type":"application/json", Authorization:`Bearer ${sessionToken}`},
        body: JSON.stringify({ direction }),
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Error"); return; }

      // Flip animation — sound fires as card starts turning away
      setFlipState("out");
      playSound("cardFlip");
      await sleep(175);
      // Card is now edge-on: swap the face and start flipping back
      setDisplayCard(data.nextCard);
      setFlipState("in");
      await sleep(175);
      // Card fully revealed — play result sound in sync with glow/shake
      setFlipState("none");

      if (data.result === "win") {
        setIsTie(!!data.isTie);
        setCardGlow("win"); setMultiplier(data.newMultiplier); setStreak(data.newStreak);
        setMultPulse(true); setTimeout(() => setMultPulse(false), 600);
        if (data.isTie) setTimeout(() => setIsTie(false), 1800);
        playSound("streakWin");
      } else {
        setCardGlow("lose");
        setShakeScreen(true); setTimeout(() => setShakeScreen(false), 450);
        setPhase("lost"); setPayout(0);
        playSound("lose");
      }
    } catch { setErrorMsg("Network error — try again"); }
    finally  { setIsBusy(false); }
  }

  async function cashOut() {
    if (isBusy || phase !== "playing" || streak === 0) return;
    setIsBusy(true); setErrorMsg(null);
    try {
      const res = await fetch(`${BASE}/api/high-low/cashout`, {
        method:"POST", headers:{ Authorization:`Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (!res.ok) { setErrorMsg(data.error || "Error"); return; }
      setPayout(data.payout); setMultiplier(data.multiplier);
      setCardGlow("win"); setPhase("cashed_out");
      playSound("cashOut");
    } catch { setErrorMsg("Network error — try again"); }
    finally  { setIsBusy(false); }
  }

  function reset() {
    setPhase("idle"); setBet(0); setDisplayCard(null); setMultiplier(1.0);
    setStreak(0); setPayout(null); setCardGlow("none"); setFlipState("none");
    setErrorMsg(null); setIsTie(false); setMultPulse(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100dvh", background:"#080409", display:"flex", flexDirection:"column", alignItems:"center", fontFamily:"'Oswald','Arial Narrow',sans-serif", position:"relative", overflow:"hidden" }}>
      {/* bg layers */}
      <div style={{ position:"fixed", inset:0, background:"radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.72) 100%)", pointerEvents:"none", zIndex:0 }} />
      <div style={{ position:"fixed", top:"28%", left:"50%", transform:"translateX(-50%)", width:560, height:380, borderRadius:"50%", background:"radial-gradient(ellipse,rgba(160,18,45,0.07) 0%,transparent 70%)", pointerEvents:"none", zIndex:0 }} />

      {/* HEADER — fixed height */}
      <div style={{ width:"100%", maxWidth:520, padding:"14px 18px 0", display:"flex", alignItems:"center", justifyContent:"space-between", position:"relative", zIndex:1, flexShrink:0 }}>
        <button onClick={() => setLocation("/tablegames")} style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, padding:"6px 12px", color:"rgba(255,255,255,0.55)", fontSize:13, cursor:"pointer", letterSpacing:"0.04em" }}>
          <ChevronLeft size={14} /> TABLE GAMES
        </button>
        <div style={{ textAlign:"center" }}>
          <div style={{ color:"rgba(180,130,60,0.55)", fontSize:10, letterSpacing:"0.2em", textTransform:"uppercase" }}>Big House Casino</div>
          <div style={{ color:"#fff", fontSize:16, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" }}>High · Low</div>
        </div>
        <div style={{ textAlign:"right" }}>
          <div style={{ color:"rgba(255,255,255,0.38)", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase" }}>Balance</div>
          <div style={{ color:"#f5c842", fontSize:15, fontWeight:700 }}>{fmt(balance)} <span style={{ fontSize:10, opacity:0.55 }}>BET</span></div>
        </div>
      </div>

      {/* BODY — fixed-width, no gap-based layout shifting */}
      <div style={{ width:"100%", maxWidth:520, padding:"12px 18px 40px", display:"flex", flexDirection:"column", alignItems:"center", position:"relative", zIndex:1 }}>

        {/* ── MULTIPLIER BLOCK — always 88px tall ── */}
        <div style={{ width:"100%", height:88, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3 }}>
          <div style={{ color:"rgba(255,255,255,0.32)", fontSize:10, letterSpacing:"0.18em", textTransform:"uppercase", height:14 }}>
            {isPlaying && streak > 0 ? "current multiplier" : phase !== "idle" && streak > 0 ? "final multiplier" : "multiplier"}
          </div>
          <motion.div
            animate={multPulse ? { scale:[1,1.28,0.96,1.04,1] } : { scale:1 }}
            transition={{ duration:0.45 }}
            style={{ fontSize:44, fontWeight:900, lineHeight:1, letterSpacing:"-0.01em", color: streak > 0 ? "#f5c842" : "rgba(255,255,255,0.22)", textShadow: streak > 0 ? "0 0 28px rgba(245,200,66,0.45)" : "none" }}
          >
            {multiplier.toFixed(2)}×
          </motion.div>
          {/* Sub-line: always rendered, just changes content — keeps height stable */}
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.28)", height:18, display:"flex", alignItems:"center" }}>
            {isPlaying && bet > 0 && streak === 0 && (
              <span>Bet: <span style={{ color:"rgba(245,200,66,0.7)" }}>{fmt(bet)}</span></span>
            )}
            {isPlaying && streak > 0 && (
              <span>Out: <span style={{ color:"#4ade80" }}>{fmt(Math.floor(bet * multiplier))}</span> · Next: <span style={{ color:"rgba(245,200,66,0.85)" }}>{fmt(Math.floor(bet * nextMult))}</span> ({nextMult.toFixed(2)}×)</span>
            )}
            {phase === "lost" && bet > 0 && (
              <span style={{ color:"rgba(248,113,113,0.7)" }}>{streak > 0 ? `${streak} correct — ` : ""}Lost {fmt(bet)} BET</span>
            )}
            {phase === "cashed_out" && payout !== null && (
              <span style={{ color:"#4ade80" }}>Won {fmt(payout)} BET · {streak} correct</span>
            )}
          </div>
        </div>

        {/* ── STREAK DOTS — always 24px tall ── */}
        <div style={{ width:"100%", height:24, display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:4 }}>
          {Array.from({ length: Math.max(5, streak + 2) }, (_, i) => (
            <div key={i} style={{
              width:8, height:8, borderRadius:"50%",
              background: i < streak ? "#22c55e" : i === streak && isPlaying ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
              boxShadow: i < streak ? "0 0 7px rgba(34,197,94,0.85)" : "none",
              transition:"background 0.25s, box-shadow 0.25s",
            }} />
          ))}
        </div>

        {/* ── CARD AREA — always exactly 228px tall ── */}
        <motion.div
          animate={shakeScreen ? { x:[0,-8,8,-6,6,-3,3,0] } : { x:0 }}
          transition={{ duration:0.4, ease:"easeInOut" }}
          style={{ width:"100%", height:228, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
        >
          <PlayingCard
            cardLabel={displayCard}
            faceDown={phase === "idle" && displayCard === null}
            glow={cardGlow}
            flipState={flipState}
          />
        </motion.div>

        {/* ── RESULT / STATUS LABEL — always 48px tall ── */}
        <div style={{ width:"100%", height:48, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {phase === "lost" && (
            <div style={{ color:"#ef4444", fontSize:26, fontWeight:900, letterSpacing:"0.06em", textShadow:"0 0 18px rgba(239,68,68,0.5)", lineHeight:1 }}>
              WRONG CALL
            </div>
          )}
          {phase === "cashed_out" && (
            <div style={{ color:"#f5c842", fontSize:26, fontWeight:900, letterSpacing:"0.06em", textShadow:"0 0 18px rgba(245,200,66,0.45)", lineHeight:1 }}>
              CASHED OUT  <span style={{ color:"#4ade80" }}>+{fmt(payout ?? 0)}</span>
            </div>
          )}
          {isPlaying && isTie && (
            <div style={{ color:"#f5c842", fontSize:15, fontWeight:700, letterSpacing:"0.1em", textShadow:"0 0 12px rgba(245,200,66,0.5)" }}>
              SAME RANK — STILL WINS
            </div>
          )}
          {isPlaying && !isTie && isBusy && (
            <div style={{ color:"rgba(255,255,255,0.22)", fontSize:13, letterSpacing:"0.1em" }}>…</div>
          )}
        </div>

        {/* ── ERROR MESSAGE — always 36px tall ── */}
        <div style={{ width:"100%", height:36, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {errorMsg && (
            <div style={{ color:"#f87171", fontSize:13, textAlign:"center", padding:"5px 14px", background:"rgba(239,68,68,0.09)", border:"1px solid rgba(239,68,68,0.22)", borderRadius:8 }}>
              {errorMsg}
            </div>
          )}
        </div>

        {/* ── ACTION AREA — fixed 268px, all panels position:absolute so height never changes ── */}
        <div style={{ width:"100%", height:268, position:"relative", flexShrink:0 }}>

          {/* IDLE: bet input panel */}
          <div style={{
            position:"absolute", top:0, left:0, right:0,
            opacity: phase === "idle" ? 1 : 0,
            pointerEvents: phase === "idle" ? "auto" : "none",
            transition:"opacity 0.18s",
            display:"flex", flexDirection:"column", gap:12,
          }}>
            <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:14, padding:"14px 16px" }}>
              <div style={{ color:"rgba(255,255,255,0.38)", fontSize:10, letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:8 }}>Place Your Bet</div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <input
                  type="number" value={betInput}
                  onChange={e => setBetInput(e.target.value)}
                  onFocus={() => setErrorMsg(null)}
                  min={minBetLimit} max={maxBetLimit}
                  style={{ flex:1, background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, padding:"9px 12px", color:"#fff", fontSize:18, fontWeight:700, fontFamily:"inherit", outline:"none", width:"100%" }}
                />
                <span style={{ color:"rgba(255,255,255,0.28)", fontSize:12 }}>BET</span>
              </div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                {BET_PRESETS.filter(p => p >= minBetLimit && p <= maxBetLimit).map(p => (
                  <button key={p} onClick={() => setBetInput(String(p))} style={{ background: parseInt(betInput)===p ? "rgba(180,130,60,0.25)" : "rgba(255,255,255,0.05)", border: parseInt(betInput)===p ? "1px solid rgba(180,130,60,0.5)" : "1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"5px 10px", color: parseInt(betInput)===p ? "#f5c842" : "rgba(255,255,255,0.5)", fontSize:12, fontFamily:"inherit", cursor:"pointer", fontWeight:600 }}>
                    {fmt(p)}
                  </button>
                ))}
                <button onClick={() => setBetInput(String(Math.min(balance, maxBetLimit)))} style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:6, padding:"5px 10px", color:"rgba(255,255,255,0.4)", fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>MAX</button>
              </div>
            </div>
            <motion.button whileHover={{ scale:1.02 }} whileTap={{ scale:0.97 }} onClick={startGame} disabled={isBusy} style={{ width:"100%", padding:"15px", background:"linear-gradient(135deg,#8b1a2e,#c0234a)", border:"1px solid rgba(220,50,90,0.4)", borderRadius:12, color:"#fff", fontSize:17, fontWeight:800, letterSpacing:"0.12em", textTransform:"uppercase", cursor: isBusy ? "wait":"pointer", boxShadow:"0 4px 24px rgba(180,20,50,0.35)", fontFamily:"inherit" }}>
              {isBusy ? "DEALING…" : "DEAL CARD"}
            </motion.button>
            <div style={{ display:"flex", justifyContent:"center", gap:5, flexWrap:"wrap" }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ textAlign:"center", padding:"5px 10px", background:"rgba(255,255,255,0.03)", borderRadius:8 }}>
                  <div style={{ color:"rgba(255,255,255,0.22)", fontSize:10 }}>#{i}</div>
                  <div style={{ color:"#f5c842", fontSize:13, fontWeight:700 }}>{MULTIPLIER_STEPS[i]}×</div>
                </div>
              ))}
            </div>
          </div>

          {/* PLAYING: higher / lower / cashout */}
          <div style={{
            position:"absolute", top:0, left:0, right:0,
            opacity: isPlaying ? 1 : 0,
            pointerEvents: isPlaying ? "auto" : "none",
            transition:"opacity 0.15s",
            display:"flex", flexDirection:"column", gap:10,
          }}>
            <div style={{ display:"flex", gap:10 }}>
              <motion.button whileHover={{ scale:1.04 }} whileTap={{ scale:0.95 }} onClick={() => guess("higher")} disabled={isBusy}
                style={{ flex:1, padding:"16px 8px", background:"linear-gradient(135deg,#064e2a,#0a6b38)", border:"1px solid rgba(34,197,94,0.35)", borderRadius:12, color:"#4ade80", fontSize:15, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", cursor: isBusy ? "wait":"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:4, boxShadow:"0 4px 18px rgba(34,197,94,0.18)", fontFamily:"inherit" }}>
                <TrendingUp size={22} /> HIGHER
              </motion.button>
              <motion.button whileHover={{ scale:1.04 }} whileTap={{ scale:0.95 }} onClick={() => guess("lower")} disabled={isBusy}
                style={{ flex:1, padding:"16px 8px", background:"linear-gradient(135deg,#500a10,#721018)", border:"1px solid rgba(239,68,68,0.35)", borderRadius:12, color:"#f87171", fontSize:15, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", cursor: isBusy ? "wait":"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:4, boxShadow:"0 4px 18px rgba(239,68,68,0.18)", fontFamily:"inherit" }}>
                <TrendingDown size={22} /> LOWER
              </motion.button>
            </div>
            <motion.button whileHover={streak > 0 ? { scale:1.02 } : {}} whileTap={streak > 0 ? { scale:0.97 } : {}} onClick={cashOut} disabled={isBusy || streak === 0}
              style={{ width:"100%", padding:"13px", background: streak > 0 ? "linear-gradient(135deg,#5a4500,#7a6000)" : "rgba(255,255,255,0.03)", border: streak > 0 ? "1px solid rgba(245,200,66,0.4)" : "1px solid rgba(255,255,255,0.06)", borderRadius:12, color: streak > 0 ? "#f5c842" : "rgba(255,255,255,0.2)", fontSize:14, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", cursor: streak > 0 && !isBusy ? "pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow: streak > 0 ? "0 4px 18px rgba(180,140,20,0.22)" : "none", fontFamily:"inherit", transition:"all 0.2s" }}>
              <DollarSign size={16} />
              {streak > 0 ? `CASH OUT — ${fmt(Math.floor(bet * multiplier))} BET` : "CASH OUT (1 CORRECT GUESS NEEDED)"}
            </motion.button>
            <div style={{ textAlign:"center", color:"rgba(255,255,255,0.22)", fontSize:12 }}>
              Bet: <span style={{ color:"rgba(245,200,66,0.6)" }}>{fmt(bet)} BET</span>
              {streak > 0 && <> · Streak: <span style={{ color:"#4ade80" }}>{streak}</span></>}
            </div>
          </div>

          {/* LOST / CASHED OUT: play again */}
          <div style={{
            position:"absolute", top:0, left:0, right:0,
            opacity: (phase === "lost" || phase === "cashed_out") ? 1 : 0,
            pointerEvents: (phase === "lost" || phase === "cashed_out") ? "auto" : "none",
            transition:"opacity 0.15s",
            display:"flex", gap:10,
          }}>
            <motion.button whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} onClick={reset} style={{ flex:1, padding:"14px", background:"linear-gradient(135deg,#8b1a2e,#c0234a)", border:"1px solid rgba(220,50,90,0.4)", borderRadius:12, color:"#fff", fontSize:15, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer", boxShadow:"0 4px 22px rgba(180,20,50,0.3)", fontFamily:"inherit" }}>
              PLAY AGAIN
            </motion.button>
            <motion.button whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }} onClick={() => setLocation("/lobby")} style={{ padding:"14px 20px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12, color:"rgba(255,255,255,0.5)", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              TABLE GAMES
            </motion.button>
          </div>
        </div>

        {/* Footer rules */}
        <div style={{ marginTop:16, display:"flex", gap:14, color:"rgba(255,255,255,0.16)", fontSize:11, textAlign:"center" }}>
          <span>Ace = Highest</span><span>·</span><span>Ties = Win</span><span>·</span><span>52-Card Deck</span>
        </div>
      </div>
    </div>
  );
}
