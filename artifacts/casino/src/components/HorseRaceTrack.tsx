import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SpriteRenderer } from "./horses/SpriteRenderer";
import { HorseEffectLayer, type EffectType } from "./horses/HorseEffectLayer";

// ── Background layer imports ──────────────────────────────────────────────────
import bgSky    from "@assets/Background_2-2_1774565548796.png";
import bgStands from "@assets/Background_2-3_1774565548796.png";
import bgTrees  from "@assets/Background_2-4_1774565562331.png";
import bgFence  from "@assets/Background_2-5_1774565562331.png";
import bgRail   from "@assets/Background_2-6_1774565562332.png";
import bgTrack  from "@assets/Background_2-7_1774565562332.png";
import bgFlag   from "@assets/Background_2-8_1774565562331.png";

// ── Track geometry ────────────────────────────────────────────────────────────
const TRACK_TOTAL_H = 460;  // total component height (px)
const TRACK_TOP     = 182;  // y where green lanes start
const LANE_H        = 44;   // px per horse lane
const NUM_LANES     = 6;
const SPRITE_SIZE   = 62;   // horse sprite height (px)

// Saddle-cloth colours — one per lane (red, orange, yellow, green, blue, purple)
const LANE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

// Leaderboard row height (px) — rows translateY() to their rank position
const LB_ROW_H = 27;

// Horse screen-x: maps race position 0–100 → 8%–80% of container width
const horseX = (pos: number, W: number) => W * 0.08 + (pos / 100) * W * 0.72;

// Finish-line screen-x: starts off the right edge, moves to ~84% as leader nears 100
// At leaderPos=0  → finishX = W*0.80 + W*0.55 = W*1.35  (off screen)
// At leaderPos=70 → finishX = W*0.80 + W*0.165 = W*0.965 (right edge)
// At leaderPos=100→ finishX = W*0.80               (on screen, visible)
const finishLineX = (leaderPos: number, W: number) =>
  W * 0.80 + ((100 - leaderPos) / 100) * W * 0.55;

// Background scroll speeds relative to track (parallax)
const PARALLAX = { sky: 0.12, stands: 0.30, trees: 0.58, track: 1.0 };

// ── Types ────────────────────────────────────────────────────────────────────
export interface TrackHorse {
  id: number;
  name: string;
  liveOdds?: number | null;
  variantId: number;
  visualBase: string;
  visualPattern: string;
  visualFlair: string;
  ownerId?: number | null;
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
}

type RaceStatus = "idle" | "scheduled" | "betting" | "running" | "finished";

interface Props {
  horses:                TrackHorse[];
  status:                RaceStatus;
  winnerId:              number | null;
  horsePositions?:       Record<number, number>;
  raceId:                number;
  hideInlineLeaderboard?: boolean;
}

// ── Podium slot ──────────────────────────────────────────────────────────────
function PodiumSlot({ horse, place, laneIdx }: { horse: TrackHorse; place: number; laneIdx: number }) {
  const medal   = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
  const isFirst = place === 1;
  const sc      = isFirst ? 72 : 52;
  const blockH  = isFirst ? 48 : place === 2 ? 32 : 20;
  const blockBg = isFirst ? "#f59e0b" : place === 2 ? "#94a3b8" : "#cd7f32";
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: isFirst ? 0.1 : place === 2 ? 0.35 : 0.55, type: "spring", stiffness: 200, damping: 20 }}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
    >
      <span style={{ fontSize: isFirst ? 28 : 22, lineHeight: 1 }}>{medal}</span>
      <div style={{ filter: isFirst ? "drop-shadow(0 0 12px rgba(245,158,11,0.8))" : undefined }}>
        <SpriteRenderer
          spriteKey={horse.baseSpriteKey}
          customFrames={horse.animFrames ? (() => { try { return JSON.parse(horse.animFrames!); } catch { return undefined; } })() : undefined}
          customFps={horse.animFps ?? undefined}
          fallbackBase={horse.visualBase}
          fallbackPattern={horse.visualPattern}
          fallbackFlair={horse.visualFlair}
          animation={isFirst ? "winner" : "idle"}
          size={sc}
          number={laneIdx + 1}
          tackColor={horse.tackColor}
        />
      </div>
      <span style={{ fontSize: isFirst ? 11 : 9, fontWeight: 800, color: isFirst ? "#fcd34d" : "rgba(255,255,255,0.7)", textTransform: "uppercase", letterSpacing: "0.06em", maxWidth: 90, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {horse.name}
      </span>
      {horse.liveOdds != null && (
        <span style={{ fontSize: 9, color: "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>{horse.liveOdds.toFixed(2)}×</span>
      )}
      <div style={{ width: isFirst ? 88 : 68, height: blockH, background: blockBg, borderRadius: "4px 4px 0 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: "#000" }}>{place}</span>
      </div>
    </motion.div>
  );
}

function Podium({ horses, winnerId, horsePositions }: { horses: TrackHorse[]; winnerId: number | null; horsePositions: Record<number, number> }) {
  const winner = horses.find((h) => h.id === winnerId);
  const ranked = horses
    .filter((h) => h.id !== winnerId)
    .map((horse) => ({ horse, laneIdx: horses.indexOf(horse), pos: horsePositions[horse.id] ?? 0 }))
    .sort((a, b) => b.pos - a.pos);
  const second = ranked[0];
  const third  = ranked[1];
  const winnerIdx = winner ? horses.indexOf(winner) : 0;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      style={{ position: "absolute", inset: 0, zIndex: 50, pointerEvents: "none", background: "rgba(0,0,0,0.88)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}
    >
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        style={{ fontSize: 11, fontWeight: 800, color: "#f59e0b", letterSpacing: "0.22em", textTransform: "uppercase" }}>
        RACE RESULTS
      </motion.div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20 }}>
        {second && <PodiumSlot horse={second.horse} place={2} laneIdx={second.laneIdx} />}
        {winner  && <PodiumSlot horse={winner}       place={1} laneIdx={winnerIdx} />}
        {third   && <PodiumSlot horse={third.horse}  place={3} laneIdx={third.laneIdx} />}
      </div>
    </motion.div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
export function HorseRaceTrack({ horses, status, winnerId, horsePositions = {}, raceId, hideInlineLeaderboard = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Parallax layer refs
  const skyRef    = useRef<HTMLDivElement>(null);
  const standsRef = useRef<HTMLDivElement>(null);
  const treesRef  = useRef<HTMLDivElement>(null);
  const fenceRef  = useRef<HTMLDivElement>(null);
  const railRef   = useRef<HTMLDivElement>(null);
  const trackRef  = useRef<HTMLDivElement>(null);
  const fenceBRef = useRef<HTMLDivElement>(null);

  // Horse element refs (keyed by horse id)
  const horseElsRef  = useRef<Record<number, HTMLDivElement | null>>({});
  const finishLineRef = useRef<HTMLDivElement>(null);
  const makeHorseRef = useCallback((id: number) => (el: HTMLDivElement | null) => {
    horseElsRef.current[id] = el;
  }, []);

  // Leaderboard refs — updated every RAF tick (no React re-renders)
  const lbRowRefs  = useRef<Record<number, HTMLDivElement | null>>({});
  const lbBarRefs  = useRef<Record<number, HTMLDivElement | null>>({});
  const lbRankRefs = useRef<Record<number, HTMLSpanElement | null>>({});
  const makeLbRowRef  = useCallback((id: number) => (el: HTMLDivElement   | null) => { lbRowRefs.current[id]  = el; }, []);
  const makeLbBarRef  = useCallback((id: number) => (el: HTMLDivElement   | null) => { lbBarRefs.current[id]  = el; }, []);
  const makeLbRankRef = useCallback((id: number) => (el: HTMLSpanElement  | null) => { lbRankRefs.current[id] = el; }, []);

  // Smooth rendered positions (interpolated in RAF)
  const renderedPos = useRef<Record<number, number>>({});

  // Keep refs to latest status + positions for use inside RAF
  const statusRef    = useRef(status);
  const positionsRef = useRef(horsePositions);
  const horsesRef    = useRef(horses);
  useEffect(() => { statusRef.current    = status;        }, [status]);
  useEffect(() => { positionsRef.current = horsePositions;}, [horsePositions]);
  useEffect(() => { horsesRef.current    = horses;        }, [horses]);

  // Visual finish — only triggers once the rendered leader actually crosses ~99
  const [visuallyFinished, setVisuallyFinished] = useState(false);
  const visualFinishFiredRef = useRef(false);
  useEffect(() => {
    if (status !== "finished") {
      setVisuallyFinished(false);
      visualFinishFiredRef.current = false;
    }
  }, [status, raceId]);

  // Reset rendered positions when race changes
  useEffect(() => {
    renderedPos.current = {};
  }, [raceId]);

  // ── RAF loop: scroll layers + move horses ──────────────────────────────────
  useEffect(() => {
    let offset    = 0;
    let lastTime  = performance.now();
    let rafId: number;

    const tick = (now: number) => {
      const dt  = Math.min(now - lastTime, 50);
      lastTime  = now;

      const s     = statusRef.current;
      const speed = s === "running" ? 2.8 : 0;
      offset += speed * (dt / 16.667);

      // Scroll background layers via backgroundPositionX
      const p = PARALLAX;
      if (skyRef.current)    skyRef.current.style.backgroundPositionX    = `${-(offset * p.sky)    % 4096}px`;
      if (standsRef.current) standsRef.current.style.backgroundPositionX = `${-(offset * p.stands) % 4096}px`;
      if (treesRef.current)  treesRef.current.style.backgroundPositionX  = `${-(offset * p.trees)  % 4096}px`;
      if (fenceRef.current)  fenceRef.current.style.backgroundPositionX  = `${-(offset * p.track)  % 4096}px`;
      if (railRef.current)   railRef.current.style.backgroundPositionX   = `${-(offset * p.track)  % 4096}px`;
      if (trackRef.current)  trackRef.current.style.backgroundPositionX  = `${-(offset * p.track)  % 4096}px`;
      if (fenceBRef.current) fenceBRef.current.style.backgroundPositionX = `${-(offset * p.track)  % 4096}px`;

      // Update horse x positions
      const W = containerRef.current?.offsetWidth ?? 600;
      const hlist = horsesRef.current;
      const pos   = positionsRef.current;

      // Use faster lerp once server says finished so horses snap to line quickly
      const lerpRate = s === "finished" ? 0.40 : 0.22;

      let leaderRendered = 0;
      for (const horse of hlist) {
        const el = horseElsRef.current[horse.id];
        if (!el) continue;
        const target  = pos[horse.id] ?? 0;
        const current = renderedPos.current[horse.id] ?? target;
        const next    = current + (target - current) * lerpRate;
        renderedPos.current[horse.id] = next;
        el.style.transform = `translateX(${horseX(next, W)}px)`;
        if (next > leaderRendered) leaderRendered = next;
      }

      // ── Live leaderboard DOM updates (no re-render) ──────────────────────────
      const sorted = [...hlist].sort(
        (a, b) => (renderedPos.current[b.id] ?? 0) - (renderedPos.current[a.id] ?? 0),
      );
      sorted.forEach((horse, rank) => {
        const rowEl  = lbRowRefs.current[horse.id];
        if (rowEl) rowEl.style.transform = `translateY(${rank * LB_ROW_H}px)`;
        const rankEl = lbRankRefs.current[horse.id];
        if (rankEl) rankEl.textContent = `${rank + 1}`;
        const barEl  = lbBarRefs.current[horse.id];
        if (barEl) barEl.style.width = `${Math.min(100, renderedPos.current[horse.id] ?? 0)}%`;
      });

      // Finish line: slides in from right during race, then freezes at the true
      // crossing point (horse center = SPRITE_SIZE/2 past horseX(100)) once the
      // race is over so horses don't visually overshoot it.
      if (finishLineRef.current) {
        const fx = s === "finished"
          ? W * 0.80 + SPRITE_SIZE / 2   // lock at the pixel where the horse centre lands at pos=100
          : finishLineX(leaderRendered, W);
        finishLineRef.current.style.left = `${fx}px`;
      }

      // Fire visual finish when the leader is close enough to the (now-frozen)
      // finish line that the crossing looks natural to the viewer.
      if (s === "finished" && leaderRendered >= 96 && !visualFinishFiredRef.current) {
        visualFinishFiredRef.current = true;
        setVisuallyFinished(true);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);  // intentionally empty deps — uses refs

  // ── Race message ──────────────────────────────────────────────────────────
  const [raceMessage, setRaceMessage] = useState<string | null>(null);
  const [showPodium,  setShowPodium]  = useState(false);

  const avgProgress = useMemo(() => {
    if (horses.length === 0) return 0;
    const sum = horses.reduce((s, h) => s + (horsePositions[h.id] ?? 0), 0);
    return sum / horses.length / 100;
  }, [horses, horsePositions]);

  const msgStage = avgProgress < 0.10 ? 0 : avgProgress < 0.30 ? 1 : avgProgress < 0.55 ? 2 : avgProgress < 0.65 ? 3 : avgProgress < 0.80 ? 4 : 5;

  useEffect(() => {
    if (status !== "running") return;
    const mid = ["CLOSE RACE!", "NECK AND NECK!", "PHOTO FINISH?", "THEY'RE FLYING!"];
    switch (msgStage) {
      case 0: setRaceMessage("AND THEY'RE OFF!"); break;
      case 1: setRaceMessage(null); break;
      case 2: setRaceMessage("EARLY LEAD!"); break;
      case 3: setRaceMessage(mid[Math.floor(Math.random() * mid.length)]); break;
      case 4: setRaceMessage("MID PACK BATTLE!"); break;
      case 5: setRaceMessage("FINAL STRETCH!"); break;
    }
  }, [msgStage, status]);

  useEffect(() => {
    if (visuallyFinished) {
      const winner = horses.find((h) => h.id === winnerId);
      if (winner) setRaceMessage(`🏆 ${winner.name.toUpperCase()} WINS!`);
      const t = setTimeout(() => setShowPodium(true), 2500);
      return () => clearTimeout(t);
    }
    setShowPodium(false);
    return;
  }, [visuallyFinished, winnerId, horses]);

  useEffect(() => {
    if (status === "idle" || status === "scheduled" || status === "betting") {
      setRaceMessage(null);
      setShowPodium(false);
    }
  }, [status]);

  const isFinished = visuallyFinished;

  if (horses.length === 0) return null;

  // ── Render ────────────────────────────────────────────────────────────────
  // Lane top positions (absolute within container)
  const laneTops = Array.from({ length: NUM_LANES }, (_, i) => TRACK_TOP + i * LANE_H);
  // Horse vertical center in lane (sprite bottom = lane bottom)
  const horseTops = laneTops.map((ly) => ly + LANE_H - SPRITE_SIZE);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        height: TRACK_TOTAL_H,
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        userSelect: "none",
      }}
    >
      {/* ── Layer 1: Night sky ── */}
      <div
        ref={skyRef}
        style={{
          position: "absolute", inset: 0,
          backgroundImage: `url(${bgSky})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 0",
        }}
      />

      {/* ── Layer 2: Grandstands (parallax slow) ── */}
      <div
        ref={standsRef}
        style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 180,
          backgroundImage: `url(${bgStands})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 bottom",
        }}
      />

      {/* ── Layer 3: Trees strip ── */}
      <div
        ref={treesRef}
        style={{
          position: "absolute", top: 148, left: 0, right: 0, height: 32,
          backgroundImage: `url(${bgTrees})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 0",
        }}
      />

      {/* ── Layer 4: Top fence ── */}
      <div
        ref={fenceRef}
        style={{
          position: "absolute", top: 174, left: 0, right: 0, height: 12,
          backgroundImage: `url(${bgFence})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 0",
        }}
      />

      {/* ── Layer 5: White rail ── */}
      <div
        ref={railRef}
        style={{
          position: "absolute", top: 183, left: 0, right: 0, height: 4,
          backgroundImage: `url(${bgRail})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 0",
          opacity: 0.7,
        }}
      />

      {/* ── Layer 6: Green striped track ── */}
      <div
        ref={trackRef}
        style={{
          position: "absolute",
          top: TRACK_TOP,
          left: 0, right: 0,
          height: NUM_LANES * LANE_H,
          backgroundImage: `url(${bgTrack})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: `auto ${NUM_LANES * LANE_H}px`,
          backgroundPosition: "0 0",
          filter: "hue-rotate(-88deg) saturate(0.55) brightness(0.52)",
        }}
      />

      {/* ── Layer 7: Bottom fence ── */}
      <div
        ref={fenceBRef}
        style={{
          position: "absolute", top: TRACK_TOP + NUM_LANES * LANE_H, left: 0, right: 0, height: 12,
          backgroundImage: `url(${bgFence})`,
          backgroundRepeat: "repeat-x",
          backgroundSize: "auto 100%",
          backgroundPosition: "0 0",
        }}
      />

      {/* ── Finish line — starts off-screen right, slides in as leader nears 100 ── */}
      <div
        ref={finishLineRef}
        style={{
          position: "absolute",
          left: "9999px",  // RAF immediately overrides this
          top: TRACK_TOP - 36,
          height: NUM_LANES * LANE_H + 50,
          zIndex: 25,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none",
          willChange: "left",
        }}
      >
        <img src={bgFlag} style={{ height: 42, imageRendering: "pixelated", marginBottom: 2 }} />
        <div style={{
          flex: 1,
          width: 3,
          background: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.85) 0px, rgba(255,255,255,0.85) 6px, rgba(0,0,0,0.5) 6px, rgba(0,0,0,0.5) 12px)",
        }} />
        <span style={{ fontSize: 8, fontWeight: 900, color: "#fff", letterSpacing: "0.14em", textTransform: "uppercase", writingMode: "vertical-rl", opacity: 0.8, marginTop: 2 }}>FINISH</span>
      </div>

      {/* ── Horses — each in their lane ── */}
      {horses.map((horse, laneIdx) => {
        const isWinner = horse.id === winnerId;
        const isLoser  = isFinished && !isWinner;
        const badgeColor = LANE_COLORS[laneIdx % LANE_COLORS.length];
        return (
          <div
            key={horse.id}
            ref={makeHorseRef(horse.id)}
            style={{
              position: "absolute",
              top: horseTops[Math.min(laneIdx, horseTops.length - 1)],
              left: 0,
              zIndex: 20 + laneIdx,
              transform: `translateX(${horseX(0, 600)}px)`,
              willChange: "transform",
              opacity: isLoser ? 0.45 : 1,
              transition: "opacity 0.8s",
              filter: isWinner && isFinished ? "drop-shadow(0 0 8px rgba(245,158,11,0.85))" : undefined,
            }}
          >
            {/* Saddle-cloth number badge — overlaid at top of sprite */}
            <div style={{
              position: "absolute",
              top: 3,
              left: "35%",
              transform: "translateX(-50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: badgeColor,
              border: "2px solid rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontWeight: 900,
              color: "#fff",
              zIndex: 5,
              pointerEvents: "none",
              boxShadow: "0 2px 6px rgba(0,0,0,0.8)",
            }}>
              {laneIdx + 1}
            </div>

            <HorseEffectLayer
              effect={(horse.effectType as EffectType) || "none"}
              glowColor={horse.glowColor ?? null}
              outlineColor={horse.outlineColor ?? null}
              rarity={horse.rarity ?? "common"}
              size={SPRITE_SIZE}
              spriteKey={horse.baseSpriteKey}
            >
              <SpriteRenderer
                spriteKey={horse.baseSpriteKey}
                customFrames={horse.animFrames ? (() => { try { return JSON.parse(horse.animFrames!); } catch { return undefined; } })() : undefined}
                customFps={horse.animFps ?? undefined}
                fallbackBase={horse.visualBase}
                fallbackPattern={horse.visualPattern}
                fallbackFlair={horse.visualFlair}
                animation={status === "running" ? "gallop" : isWinner && isFinished ? "winner" : "idle"}
                size={SPRITE_SIZE}
                number={laneIdx + 1}
                tackColor={horse.tackColor}
              />
            </HorseEffectLayer>
          </div>
        );
      })}

      {/* ── Live leaderboard (shown during race, can be moved outside via hideInlineLeaderboard) ── */}
      {!hideInlineLeaderboard && (status === "running" || (status === "finished" && !showPodium)) && (
        <div style={{
          position: "absolute",
          top: 8,
          left: 8,
          width: 210,
          zIndex: 36,
          pointerEvents: "none",
          background: "rgba(0,0,0,0.88)",
          backdropFilter: "blur(8px)",
          borderRadius: 10,
          border: "1px solid rgba(255,215,0,0.25)",
          overflow: "hidden",
          boxShadow: "0 4px 20px rgba(0,0,0,0.7)",
        }}>
          {/* Header */}
          <div style={{
            padding: "5px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            fontSize: 10,
            fontWeight: 900,
            color: "#f59e0b",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}>
            🏇 Live Standings
          </div>

          {/* Rows container — rows slide to their rank position via translateY */}
          <div style={{ position: "relative", height: horses.length * LB_ROW_H }}>
            {horses.map((horse, laneIdx) => {
              const badgeColor = LANE_COLORS[laneIdx % LANE_COLORS.length];
              return (
                <div
                  key={horse.id}
                  ref={makeLbRowRef(horse.id)}
                  style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0,
                    height: LB_ROW_H,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 9px",
                    transform: `translateY(${laneIdx * LB_ROW_H}px)`,
                    transition: "transform 0.25s ease",
                    willChange: "transform",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {/* Current rank */}
                  <span
                    ref={makeLbRankRef(horse.id)}
                    style={{
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#f59e0b",
                      minWidth: 13,
                      textAlign: "center",
                      fontFamily: "monospace",
                    }}
                  >
                    {laneIdx + 1}
                  </span>

                  {/* Saddle-cloth badge */}
                  <div style={{
                    width: 17,
                    height: 17,
                    borderRadius: "50%",
                    background: badgeColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    fontWeight: 900,
                    color: "#fff",
                    flexShrink: 0,
                    border: "1.5px solid rgba(255,255,255,0.7)",
                    boxShadow: `0 0 5px ${badgeColor}88`,
                  }}>
                    {laneIdx + 1}
                  </div>

                  {/* Horse name */}
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {horse.name}
                  </span>

                  {/* Progress bar */}
                  <div style={{
                    width: 36,
                    height: 4,
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 3,
                    flexShrink: 0,
                    overflow: "hidden",
                  }}>
                    <div
                      ref={makeLbBarRef(horse.id)}
                      style={{
                        height: "100%",
                        width: "0%",
                        background: badgeColor,
                        borderRadius: 2,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Progress bar (during race) ── */}
      {status === "running" && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "rgba(0,0,0,0.4)", zIndex: 30 }}>
          <div
            style={{
              height: "100%",
              width: `${avgProgress * 100}%`,
              background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
              transition: "width 0.4s linear",
              borderRadius: "0 2px 2px 0",
            }}
          />
        </div>
      )}

      {/* ── Race commentary overlay ── */}
      <AnimatePresence>
        {raceMessage && !showPodium && (
          <motion.div
            key={raceMessage}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
              zIndex: 35, pointerEvents: "none",
              background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)",
              border: "1px solid rgba(245,158,11,0.35)",
              borderRadius: 10, padding: "4px 16px",
              fontSize: 13, fontWeight: 900, color: "#fcd34d",
              letterSpacing: "0.12em", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {raceMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Podium overlay (after race) ── */}
      <AnimatePresence>
        {showPodium && (
          <Podium horses={horses} winnerId={winnerId} horsePositions={horsePositions} />
        )}
      </AnimatePresence>
    </div>
  );
}
