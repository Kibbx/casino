import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { useGetPlayer } from "@workspace/api-client-react";
import { ChevronLeft, Package, Lock, Zap, Coins } from "lucide-react";

function Chip({ size = 13 }: { size?: number }) {
  return <Coins size={size} style={{ display: "inline", verticalAlign: "middle", color: "#fbbf24", flexShrink: 0 }} />;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Sound System ──────────────────────────────────────────────────────────────

function useSounds() {
  const ctxRef = useRef<AudioContext | null>(null);
  const tickTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function ctx() {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (ctxRef.current.state === "suspended") ctxRef.current.resume();
    return ctxRef.current;
  }

  function playTick(speedFactor: number) {
    const ac = ctx();
    const now = ac.currentTime;
    const dur = 0.035;

    const bufSize = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, bufSize, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.15));
    }

    const src = ac.createBufferSource();
    src.buffer = buf;

    const flt = ac.createBiquadFilter();
    flt.type = "bandpass";
    flt.frequency.value = 1800 + speedFactor * 2800;
    flt.Q.value = 0.8;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.linearRampToValueAtTime(0, now + dur);

    src.connect(flt); flt.connect(gain); gain.connect(ac.destination);
    src.start(now); src.stop(now + dur);
  }

  function playWhoosh() {
    const ac = ctx();
    const now = ac.currentTime;
    const dur = 0.5;

    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.25);
    osc.frequency.exponentialRampToValueAtTime(1200, now + dur);

    const flt = ac.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(200, now);
    flt.frequency.exponentialRampToValueAtTime(2400, now + dur);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(flt); flt.connect(gain); gain.connect(ac.destination);
    osc.start(now); osc.stop(now + dur);
  }

  function playResult(tier: string) {
    const ac = ctx();
    const now = ac.currentTime;

    const presets: Record<string, { freqs: number[]; gap: number; vol: number }> = {
      common:    { freqs: [523, 659],                        gap: 0.13, vol: 0.09 },
      rare:      { freqs: [523, 659, 784],                   gap: 0.11, vol: 0.10 },
      epic:      { freqs: [523, 659, 784, 1047],             gap: 0.09, vol: 0.11 },
      legendary: { freqs: [523, 659, 784, 988, 1047, 1319],  gap: 0.08, vol: 0.12 },
      jackpot:   { freqs: [523, 659, 784, 988, 1047, 1319, 1568, 2093], gap: 0.07, vol: 0.13 },
    };
    const p = presets[tier] ?? presets.common;
    const noteDur = 0.45;

    p.freqs.forEach((freq, i) => {
      const t = now + i * p.gap;
      const osc = ac.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;

      const gain = ac.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(p.vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + noteDur);

      osc.connect(gain); gain.connect(ac.destination);
      osc.start(t); osc.stop(t + noteDur);

      // Harmonic overtone for richness on rare+
      if (i === p.freqs.length - 1 && tier !== "common") {
        const osc2 = ac.createOscillator();
        osc2.type = "triangle";
        osc2.frequency.value = freq * 2;
        const g2 = ac.createGain();
        g2.gain.setValueAtTime(0, t);
        g2.gain.linearRampToValueAtTime(p.vol * 0.35, t + 0.012);
        g2.gain.exponentialRampToValueAtTime(0.001, t + noteDur * 0.7);
        osc2.connect(g2); g2.connect(ac.destination);
        osc2.start(t); osc2.stop(t + noteDur);
      }
    });
  }

  function scheduleTicks(spinDuration: number, totalCards: number) {
    cancelTicks();
    const D = totalCards * CARD_TOTAL;
    for (let n = 1; n < totalCards; n++) {
      const progress = (n * CARD_TOTAL) / D;
      if (progress >= 1) break;
      // inverse of ease-out cubic: t = T * (1 - cbrt(1 - progress))
      const t = spinDuration * (1 - Math.cbrt(1 - progress));
      const speedFactor = Math.max(0, 1 - progress);
      const id = setTimeout(() => playTick(speedFactor), t);
      tickTimers.current.push(id);
    }
  }

  function cancelTicks() {
    tickTimers.current.forEach(clearTimeout);
    tickTimers.current = [];
  }

  return { playWhoosh, playTick, playResult, scheduleTicks, cancelTicks };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CaseItem {
  id: number;
  name: string;
  emoji: string;
  type: string;
  value: number;
  tier: string;
  stock?: number;
  image_url?: string | null;
}

interface Case {
  id: number;
  name: string;
  emoji: string;
  description: string;
  price: number;
  price_gems: number;
  enabled: boolean;
  tier_common: number;
  tier_rare: number;
  tier_epic: number;
  tier_legendary: number;
  tier_jackpot: number;
  image_url?: string | null;
  items?: CaseItem[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CARD_W = 156;
const CARD_GAP = 10;
const CARD_TOTAL = CARD_W + CARD_GAP;
const WINNER_POS = 48;
const REEL_SIZE = 62;
const SPIN_DURATION = 6000;

const TIER_CONFIG: Record<string, { label: string; color: string; glow: string; bg: string; order: number }> = {
  common:    { label: "Common",    color: "#9ca3af", glow: "rgba(156,163,175,0.6)", bg: "rgba(156,163,175,0.08)", order: 0 },
  rare:      { label: "Rare",      color: "#3b82f6", glow: "rgba(59,130,246,0.7)",  bg: "rgba(59,130,246,0.10)",  order: 1 },
  epic:      { label: "Epic",      color: "#a855f7", glow: "rgba(168,85,247,0.7)",  bg: "rgba(168,85,247,0.10)",  order: 2 },
  legendary: { label: "Legendary", color: "#f59e0b", glow: "rgba(245,158,11,0.8)",  bg: "rgba(245,158,11,0.10)",  order: 3 },
  jackpot:   { label: "JACKPOT",   color: "#ef4444", glow: "rgba(239,68,68,0.9)",   bg: "rgba(239,68,68,0.12)",   order: 4 },
};

function tierCfg(tier: string) {
  return TIER_CONFIG[tier] ?? TIER_CONFIG.common;
}

// ── Reel Item Card ────────────────────────────────────────────────────────────

function ReelCard({ item, isWinner }: { item: CaseItem; isWinner: boolean }) {
  const cfg = tierCfg(item.tier);
  return (
    <div
      style={{
        width: CARD_W,
        flexShrink: 0,
        background: isWinner ? cfg.bg : "rgba(15,15,30,0.95)",
        border: `2px solid ${isWinner ? cfg.color : "rgba(255,255,255,0.07)"}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 6px",
        boxShadow: isWinner ? `0 0 18px ${cfg.glow}` : "none",
        transition: "none",
        userSelect: "none",
      }}
    >
      {item.image_url
        ? <img src={`${BASE}/api/uploads${item.image_url}`} alt={item.name} style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 6, display: "block" }} />
        : <div style={{ fontSize: 38, lineHeight: 1.1 }}>{item.emoji || "🎁"}</div>
      }
      <div style={{ color: cfg.color, fontSize: 9, fontWeight: 700, marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>
        {cfg.label}
      </div>
      <div style={{ color: "#e5e7eb", fontSize: 11, fontWeight: 600, marginTop: 2, textAlign: "center", lineHeight: 1.2, maxWidth: "100%" }}>
        {item.name}
      </div>
    </div>
  );
}

// ── Item Pool Tile ─────────────────────────────────────────────────────────────

function ItemTile({ item }: { item: CaseItem }) {
  const cfg = tierCfg(item.tier);
  return (
    <div style={{
      background: cfg.bg,
      border: `1.5px solid ${cfg.color}33`,
      borderRadius: 8,
      padding: "10px 8px",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 4,
      minWidth: 100,
      flex: "1 1 100px",
    }}>
      {item.image_url
        ? <img src={`${BASE}/api/uploads${item.image_url}`} alt={item.name} style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 6 }} />
        : <div style={{ fontSize: 28 }}>{item.emoji || "🎁"}</div>
      }
      <div style={{ color: cfg.color, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {cfg.label}
      </div>
      <div style={{ color: "#d1d5db", fontSize: 11, fontWeight: 600, textAlign: "center", lineHeight: 1.2 }}>
        {item.name}
      </div>
      {item.stock != null && (
        <div style={{ color: item.stock > 0 ? "#4ade80" : "#ef4444", fontSize: 10 }}>
          {item.stock > 0 ? `${item.stock} in stock` : "Out of stock"}
        </div>
      )}
    </div>
  );
}

// ── Case Card ─────────────────────────────────────────────────────────────────

function CaseCard({ c, onClick }: { c: Case; onClick: () => void }) {
  const imgSrc = c.image_url ? `${BASE}/api/uploads${c.image_url}` : null;
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: "pointer",
        width: 320,
        gap: 8,
      }}
    >
      {/* Name above */}
      <div style={{ color: "#e5e7eb", fontWeight: 600, fontSize: 13, textAlign: "center", letterSpacing: "0.01em" }}>
        {c.name}
      </div>

      {/* Image — the button itself, hover scale */}
      <div
        style={{ width: "100%", transition: "transform 0.18s, filter 0.18s" }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.06)"; (e.currentTarget as HTMLElement).style.filter = "drop-shadow(0 6px 18px rgba(139,92,246,0.55))"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.filter = "none"; }}
      >
        {imgSrc ? (
          <img src={imgSrc} alt={c.name} style={{ width: "100%", height: "auto", display: "block" }} />
        ) : (
          <div style={{ fontSize: 80, lineHeight: 1, textAlign: "center" }}>{c.emoji}</div>
        )}
      </div>

      {/* Price below */}
      <div style={{ fontWeight: 700, fontSize: 13 }}>
        {Number(c.price_gems) > 0
          ? <span style={{ color: "#22d3ee" }}>💎 {Number(c.price_gems).toLocaleString()} gems</span>
          : c.price > 0
            ? <span style={{ color: "#fbbf24" }}><Chip /> {c.price.toLocaleString()}</span>
            : <span style={{ color: "#34d399" }}>FREE</span>
        }
      </div>
    </button>
  );
}

// ── Result Modal ──────────────────────────────────────────────────────────────

function ResultModal({ result, onClose }: { result: any; onClose: () => void }) {
  const [, setLocation] = useLocation();
  const cfg = tierCfg(result.tier);
  const isJackpot = result.tier === "jackpot";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 999,
        background: "rgba(0,0,0,0.85)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg, rgba(20,20,40,0.99), rgba(10,10,25,1))",
          border: `2px solid ${cfg.color}`,
          borderRadius: 20,
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          boxShadow: `0 0 60px ${cfg.glow}, 0 0 120px ${cfg.glow}40`,
          maxWidth: 360,
          width: "90%",
          animation: "pop-in 0.4s cubic-bezier(0.17,0.67,0.35,1.2)",
        }}
      >
        <div style={{ color: cfg.color, fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: 2 }}>
          {isJackpot ? "🎉 JACKPOT! 🎉" : `${cfg.label} Win`}
        </div>
        {result.item.image_url
          ? <img src={`${BASE}/api/uploads${result.item.image_url}`} alt={result.item.name} style={{ width: 120, height: 120, objectFit: "contain", filter: `drop-shadow(0 0 20px ${cfg.glow})` }} />
          : <div style={{ fontSize: 72, filter: `drop-shadow(0 0 20px ${cfg.glow})` }}>{result.item.emoji || "🎁"}</div>
        }
        <div style={{ color: "#f3f4f6", fontWeight: 800, fontSize: 22, textAlign: "center" }}>
          {result.item.name}
        </div>
        {result.item.type === "chips" && (
          <div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 16 }}>
            <Chip /> +{Number(result.item.value).toLocaleString()} chips
          </div>
        )}
        {result.item.type === "gems" && (
          <div style={{ color: "#c084fc", fontWeight: 700, fontSize: 16 }}>
            💎 +{Number(result.item.value).toLocaleString()} Gems added to your account
          </div>
        )}
        {result.item.type === "bet" && (
          <div style={{ color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
            Added to pending rewards — a staff member will pay your BET in-game
          </div>
        )}
        {result.item.type !== "chips" && result.item.type !== "gems" && result.item.type !== "bet" && (
          <div style={{ color: "#9ca3af", fontSize: 12, textAlign: "center" }}>
            Added to your inventory — go to <strong style={{ color: "#fbbf24" }}>Profile → Items</strong> and hit <strong style={{ color: "#fbbf24" }}>Request</strong> when you want it delivered
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {result.item.type !== "chips" && result.item.type !== "gems" && result.item.type !== "bet" && (
            <button
              onClick={() => { onClose(); setLocation("/profile?tab=inventory"); }}
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "#d1d5db",
                fontWeight: 600,
                fontSize: 13,
                padding: "9px 20px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.15)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Package size={14} /> View Inventory
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: cfg.color,
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              padding: "9px 28px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
            }}
          >
            {isJackpot ? "AMAZING!" : "Collect"}
          </button>
        </div>
      </div>
      <style>{`@keyframes pop-in { from { transform: scale(0.7); opacity: 0; } to { transform: scale(1); opacity: 1; } }`}</style>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CasesPage() {
  const [, setLocation] = useLocation();
  const { sessionToken, playerId } = useStore();
  const { data: playerData, refetch: refetchPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });

  const [cases, setCases] = useState<Case[]>([]);
  const [gameEnabled, setGameEnabled] = useState(true);
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [caseDetail, setCaseDetail] = useState<(Case & { items: CaseItem[] }) | null>(null);

  const [phase, setPhase] = useState<"idle" | "spinning" | "result">("idle");
  const [reelItems, setReelItems] = useState<CaseItem[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [gemsBalance, setGemsBalance] = useState<number>(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const sounds = useSounds();

  // Play result sound when reveal happens
  useEffect(() => {
    if (phase === "result" && result?.tier) {
      sounds.playResult(result.tier);
    }
  }, [phase, result]);

  // Cancel pending ticks on unmount
  useEffect(() => () => sounds.cancelTicks(), []);

  // Load cases
  useEffect(() => {
    fetch(`${BASE}/api/cases`)
      .then(r => r.json())
      .then(d => {
        const rawCases = Array.isArray(d) ? d : (Array.isArray(d?.cases) ? d.cases : []);
        const ge = d?.gameEnabled !== false;
        setGameEnabled(ge);
        const enabled = rawCases.filter((c: Case) => c.enabled);
        setCases(enabled);
        if (enabled.length === 1) loadCaseDetail(enabled[0]);
      })
      .catch(() => setCases([]));
  }, []);

  // Sync balance
  useEffect(() => {
    if (playerData) {
      setBalance(Number((playerData as any).chips) || 0);
      setGemsBalance(Number((playerData as any).gems) || 0);
    }
  }, [playerData]);

  async function loadCaseDetail(c: Case) {
    setSelectedCase(c);
    try {
      const r = await fetch(`${BASE}/api/cases/${c.id}`);
      const d = await r.json();
      setCaseDetail(d);
      // Preload all item images so the reel never flashes emoji during spin
      if (Array.isArray(d?.items)) {
        d.items.forEach((item: CaseItem) => {
          if (item.image_url) {
            const img = new Image();
            img.src = `${BASE}/api/uploads${item.image_url}`;
          }
        });
      }
    } catch {
      setCaseDetail({ ...c, items: [] });
    }
  }

  function buildReel(pool: CaseItem[], winner: CaseItem): CaseItem[] {
    if (!pool.length) return Array(REEL_SIZE).fill(winner);
    const tierRank: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3, jackpot: 4 };
    const winnerRank = tierRank[winner.tier] ?? 0;

    const reel: CaseItem[] = [];
    for (let i = 0; i < REEL_SIZE; i++) {
      if (i === WINNER_POS) {
        reel.push(winner);
        continue;
      }
      const dist = Math.abs(i - WINNER_POS);
      if (dist <= 2) {
        // Near-miss: prefer higher tier items for excitement
        const exciting = pool.filter(it => (tierRank[it.tier] ?? 0) >= winnerRank);
        const src = exciting.length > 0 ? exciting : pool;
        reel.push(src[Math.floor(Math.random() * src.length)]);
      } else {
        reel.push(pool[Math.floor(Math.random() * pool.length)]);
      }
    }
    return reel;
  }

  async function openCase() {
    if (!sessionToken) { setError("Please log in to open cases"); return; }
    if (!caseDetail) return;
    if (phase !== "idle") return;
    setError(null);

    try {
      const r = await fetch(`${BASE}/api/cases/${caseDetail.id}/open`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}`, "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (data.error) { setError(data.error); return; }

      // Build reel with actual result
      const pool = caseDetail.items.filter(it => !it.stock || it.stock > 0);
      const winner: CaseItem = {
        id: data.item.id,
        name: data.item.name,
        emoji: data.item.emoji,
        type: data.item.type,
        value: Number(data.item.value),
        tier: data.tier,
      };

      const reel = buildReel(pool.length ? pool : [winner], winner);
      setReelItems(reel);
      setResult(data);
      if (typeof data.playerChips === "number") {
        setBalance(data.playerChips);
      } else if (Number(caseDetail.price_gems) > 0) {
        setGemsBalance(prev => prev - Number(caseDetail.price_gems));
      } else {
        setBalance(prev => prev - caseDetail.price);
      }
      if (typeof data.playerGems === "number") {
        setGemsBalance(data.playerGems);
        refetchPlayer();
      }

      // Start animation — double RAF ensures DOM is mounted after phase change
      sounds.playWhoosh();
      sounds.scheduleTicks(SPIN_DURATION, WINNER_POS);
      setPhase("spinning");
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!reelRef.current || !containerRef.current) {
          // Fallback: refs still not ready, wait a tick then show result
          setTimeout(() => setPhase("result"), 100);
          return;
        }
        // Reset position (no transition)
        reelRef.current.style.transition = "none";
        reelRef.current.style.transform = "translateX(0px)";

        // Force reflow
        void reelRef.current.getBoundingClientRect();

        const containerW = containerRef.current.clientWidth || 800;
        // Add small random jitter so it doesn't land in exact same spot every time
        const jitter = (Math.random() - 0.5) * 60;
        const winnerCenter = WINNER_POS * CARD_TOTAL + CARD_W / 2;
        const finalTX = -(winnerCenter - containerW / 2) + jitter;

        reelRef.current.style.transition = `transform ${SPIN_DURATION}ms cubic-bezier(0.12, 0.8, 0.22, 1)`;
        reelRef.current.style.transform = `translateX(${finalTX}px)`;

        setTimeout(() => setPhase("result"), SPIN_DURATION + 200);
      }));
    } catch (e: any) {
      setError("Failed to open case. Please try again.");
    }
  }

  function handleCollect() {
    setPhase("idle");
    setResult(null);
    // Refresh case detail (stock may have changed)
    if (caseDetail) loadCaseDetail(caseDetail);
  }

  // ── Group items by tier for display ─────────────────────────────────────────
  const tierGroups = caseDetail
    ? (["jackpot","legendary","epic","rare","common"] as const).map(tier => ({
        tier,
        items: (caseDetail.items || []).filter((it: CaseItem) => it.tier === tier),
      })).filter(g => g.items.length > 0)
    : [];

  const canOpen = !!sessionToken && phase === "idle" && caseDetail && caseDetail.items.length > 0;
  const isGemCase = Number(caseDetail?.price_gems) > 0;
  const hasEnough = isGemCase
    ? gemsBalance >= Number(caseDetail?.price_gems ?? 0)
    : balance >= (caseDetail?.price ?? 0);

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "linear-gradient(180deg, #0a0a1a 0%, #0d0d22 60%, #0a0a18 100%)",
      color: "#f3f4f6",
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(0,0,0,0.3)",
      }}>
        <button
          onClick={() => setLocation("/minigames")}
          style={{ background: "none", border: "none", color: "#9ca3af", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}
        >
          <ChevronLeft size={16} /> Mini Games
        </button>
        <div style={{ fontWeight: 800, fontSize: 20, color: "#fff" }}>📦 Case Opening</div>
        {sessionToken && (
          <div style={{ marginLeft: "auto", color: "#fbbf24", fontWeight: 700, fontSize: 13 }}>
            <Chip /> {balance.toLocaleString()}
          </div>
        )}
      </div>

      {/* ── Global closed gate ── */}
      {!gameEnabled && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "80px 20px", gap: 16 }}>
          <div style={{ fontSize: 64 }}>🚫</div>
          <div style={{ fontWeight: 900, fontSize: 24, color: "#fff" }}>Case Opening is Closed</div>
          <div style={{ color: "#6b7280", fontSize: 14, maxWidth: 320 }}>The banker has closed case openings. Check back later.</div>
        </div>
      )}

      {/* ── Case selector (multiple cases) ── */}
      {gameEnabled && !selectedCase && (
        <div style={{ padding: "40px 20px", maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontWeight: 900, fontSize: 28, color: "#fff" }}>Choose a Case</div>
            <div style={{ color: "#6b7280", fontSize: 13, marginTop: 6 }}>
              Tier-based drops — tier rolls first, then a random item from that tier.
            </div>
          </div>
          {cases.length === 0 ? (
            <div style={{ textAlign: "center", color: "#4b5563", paddingTop: 60 }}>
              <Package size={48} style={{ opacity: 0.3, margin: "0 auto 12px" }} />
              <div>No cases available right now</div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
              {cases.map(c => (
                <CaseCard key={c.id} c={c} onClick={() => loadCaseDetail(c)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Case view ── */}
      {gameEnabled && selectedCase && (
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px" }}>

          {/* Back to cases — always visible */}
          <button
            onClick={() => { setSelectedCase(null); setCaseDetail(null); setPhase("idle"); setResult(null); }}
            style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}
          >
            <ChevronLeft size={14} /> All Cases
          </button>

          {/* Case header */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
            {selectedCase.image_url ? (
              <img
                src={`${BASE}/api/uploads${selectedCase.image_url}`}
                alt=""
                style={{ height: 90, width: "auto", display: "block", flexShrink: 0 }}
              />
            ) : (
              <div style={{ fontSize: 52 }}>{selectedCase.emoji}</div>
            )}
            <div>
              <div style={{ fontWeight: 900, fontSize: 22 }}>{selectedCase.name}</div>
              {selectedCase.description && (
                <div style={{ color: "#9ca3af", fontSize: 13, marginTop: 2 }}>{selectedCase.description}</div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                {(["common","rare","epic","legendary","jackpot"] as const).map(tier => {
                  const pct = selectedCase[`tier_${tier}` as keyof Case] as number;
                  if (!pct) return null;
                  const cfg = tierCfg(tier);
                  return (
                    <span key={tier} style={{ color: cfg.color, fontSize: 11, fontWeight: 600, background: cfg.bg, padding: "2px 8px", borderRadius: 999, border: `1px solid ${cfg.color}33` }}>
                      {cfg.label}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Reel area ── */}
          <div style={{
            background: "rgba(0,0,0,0.5)",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "0",
            marginBottom: 20,
            overflow: "hidden",
            position: "relative",
          }}>
            {/* Center indicator */}
            <div style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "50%",
              width: 3,
              background: "linear-gradient(180deg, transparent, #f59e0b, transparent)",
              zIndex: 10,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }} />
            {/* Top arrow */}
            <div style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: "12px solid #f59e0b",
              zIndex: 11,
            }} />
            {/* Bottom arrow */}
            <div style={{
              position: "absolute",
              bottom: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0, height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderBottom: "12px solid #f59e0b",
              zIndex: 11,
            }} />
            {/* Left fade */}
            <div style={{
              position: "absolute", top: 0, bottom: 0, left: 0, width: 80, zIndex: 9,
              background: "linear-gradient(90deg, rgba(0,0,0,0.8), transparent)",
              pointerEvents: "none",
            }} />
            {/* Right fade */}
            <div style={{
              position: "absolute", top: 0, bottom: 0, right: 0, width: 80, zIndex: 9,
              background: "linear-gradient(270deg, rgba(0,0,0,0.8), transparent)",
              pointerEvents: "none",
            }} />

            {/* Reel container */}
            <div ref={containerRef} style={{ overflow: "hidden", padding: "20px 0" }}>
              {phase === "idle" && !result ? (
                // Idle: show a sample from item pool
                <div style={{ display: "flex", gap: CARD_GAP, padding: "0 20px", overflowX: "hidden" }}>
                  {(caseDetail?.items || []).slice(0, 12).map((it, i) => (
                    <ReelCard key={i} item={it} isWinner={false} />
                  ))}
                  {(!caseDetail || !caseDetail.items.length) && (
                    <div style={{ color: "#4b5563", padding: "20px 40px", fontSize: 13 }}>Loading items…</div>
                  )}
                </div>
              ) : (
                // Spinning / result
                <div
                  ref={reelRef}
                  style={{ display: "flex", gap: CARD_GAP, padding: "0 20px", willChange: "transform" }}
                >
                  {reelItems.map((item, i) => (
                    <ReelCard key={i} item={item} isWinner={i === WINNER_POS} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Open button area ── */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            {error && (
              <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10, background: "rgba(239,68,68,0.1)", padding: "8px 16px", borderRadius: 8, display: "inline-block" }}>
                {error}
              </div>
            )}

            {!sessionToken ? (
              <div style={{ color: "#6b7280", fontSize: 13 }}>
                <Lock size={14} style={{ display: "inline", marginRight: 6 }} />
                <button onClick={() => setLocation("/login")} style={{ color: "#3b82f6", textDecoration: "underline", background: "none", border: "none", cursor: "pointer" }}>Log in</button> to open cases
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                {/* Mini case image + price */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {selectedCase?.image_url && (
                    <img
                      src={`${BASE}/api/uploads${selectedCase.image_url}`}
                      alt=""
                      style={{ height: 52, width: "auto", display: "block" }}
                    />
                  )}
                  {isGemCase ? (
                    <div style={{ color: hasEnough ? "#22d3ee" : "#ef4444", fontSize: 14, fontWeight: 700 }}>
                      {hasEnough
                        ? <>💎 {Number(caseDetail!.price_gems).toLocaleString()} gems</>
                        : `Not enough gems (need ${Number(caseDetail!.price_gems).toLocaleString()} 💎)`}
                    </div>
                  ) : caseDetail?.price > 0 ? (
                    <div style={{ color: hasEnough ? "#fbbf24" : "#ef4444", fontSize: 14, fontWeight: 700 }}>
                      {hasEnough ? <><Chip size={14} /> {caseDetail.price.toLocaleString()} chips</> : `Not enough chips (need ${caseDetail.price.toLocaleString()})`}
                    </div>
                  ) : null}
                </div>
                <button
                  onClick={openCase}
                  disabled={!canOpen || !hasEnough}
                  style={{
                    background: canOpen && hasEnough
                      ? "linear-gradient(135deg, #7c3aed, #4f46e5)"
                      : "rgba(100,100,120,0.3)",
                    color: canOpen && hasEnough ? "#fff" : "#6b7280",
                    fontWeight: 800,
                    fontSize: 17,
                    padding: "14px 56px",
                    borderRadius: 12,
                    border: "none",
                    cursor: canOpen && hasEnough ? "pointer" : "not-allowed",
                    letterSpacing: 1,
                    boxShadow: canOpen && hasEnough ? "0 4px 24px rgba(124,58,237,0.5)" : "none",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Zap size={18} /> {phase === "spinning" ? "Opening…" : "OPEN CASE"}
                </button>
              </div>
            )}
          </div>

          {/* ── Item Pool ── */}
          {caseDetail && tierGroups.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Contents
              </div>
              {tierGroups.map(({ tier, items }) => {
                const cfg = tierCfg(tier);
                return (
                  <div key={tier} style={{ marginBottom: 16 }}>
                    <div style={{ color: cfg.color, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                      {cfg.label}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {items.map((it: CaseItem) => <ItemTile key={it.id} item={it} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {caseDetail && !caseDetail.items.length && (
            <div style={{ textAlign: "center", color: "#4b5563", padding: "24px", fontSize: 13 }}>
              No items in this case yet
            </div>
          )}
        </div>
      )}

      {/* ── Result Modal ── */}
      {phase === "result" && result && (
        <ResultModal result={result} onClose={handleCollect} />
      )}
    </div>
  );
}
