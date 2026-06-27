import { useState, useEffect, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { ChevronLeft, Volume2, VolumeX } from "lucide-react";
import { awardXP } from "../lib/rewardsState";
import { soundSafe, soundBust, soundCashout, setMasterVolume, preloadSounds } from "../sounds";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const FLOORS = 8;
const TILES = 3;

const MULTS = [1.0, 1.46, 2.18, 3.27, 4.91, 7.37, 11.05, 16.57, 24.86];

type TileState = "hidden" | "safe" | "bust" | "other-bust";

interface FloorResult {
  pick: number;
  bustIndex: number;
  result: "safe" | "bust";
}

export default function MobTower() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));
  const chips = liveChips ?? currentPlayer?.chips ?? 0;

  const [phase, setPhase] = useState<"betting" | "playing" | "lost" | "won">("betting");
  const [bet, setBet] = useState("500");
  const [currentFloor, setCurrentFloor] = useState(0);
  const [floorResults, setFloorResults] = useState<(FloorResult | null)[]>(
    Array.from({ length: FLOORS }, () => null)
  );
  const [allBustTiles, setAllBustTiles] = useState<number[] | null>(null);
  const [payout, setPayout] = useState(0);
  const [multiplier, setMultiplier] = useState(1.0);
  const [error, setError] = useState<string | null>(null);
  const [minBet, setMinBet] = useState(100);
  const [maxBet, setMaxBet] = useState(50000);
  const [enabled, setEnabled] = useState(true);
  const [picking, setPicking] = useState(false);
  const [animatingTile, setAnimatingTile] = useState<{ floor: number; tile: number } | null>(null);
  const animLock = useRef(false);
  const [volume, setVolume] = useState(1.0);
  const [showVolSlider, setShowVolSlider] = useState(false);

  const authHeader = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};

  const [betSteps, setBetSteps] = useState<number[]>([]);

  const betPresets = useMemo(() => {
    if (betSteps.length > 0) {
      return betSteps.filter(v => v >= minBet && v <= maxBet);
    }
    if (minBet >= maxBet) return [minBet];
    const logMin = Math.log(minBet);
    const logMax = Math.log(maxBet);
    const raw = Array.from({ length: 5 }, (_, i) =>
      Math.round(Math.exp(logMin + (i / 4) * (logMax - logMin)) / 100) * 100
    ).map(v => Math.max(minBet, Math.min(maxBet, v)));
    return [...new Set(raw)];
  }, [minBet, maxBet, betSteps]);

  useEffect(() => {
    preloadSounds();
    for (const path of ["/mob-tower-safe.png", "/mob-tower-bust.png"]) {
      const img = new Image();
      img.src = `${BASE}${path}`;
    }

    fetch(`${BASE}/api/mob-tower/status`)
      .then((r) => r.json())
      .then((d) => {
        const mn = d.minBet ?? 100;
        const mx = d.maxBet ?? 50000;
        setEnabled(d.enabled);
        setMinBet(mn);
        setMaxBet(mx);
        if (Array.isArray(d.betSteps) && d.betSteps.length > 0) setBetSteps(d.betSteps);
        setBet(b => {
          const cur = parseInt(b);
          if (!cur || cur < mn) return String(mn);
          if (cur > mx) return String(mx);
          return b;
        });
      })
      .catch(() => {});

    if (!sessionToken) return;
    fetch(`${BASE}/api/mob-tower/active`, { headers: authHeader })
      .then((r) => r.json())
      .then((d) => {
        if (d.game) {
          setCurrentFloor(d.game.currentFloor);
          setMultiplier(MULTS[d.game.currentFloor]);
          setBet(String(d.game.bet));
          setPhase("playing");
        }
      })
      .catch(() => {});
  }, [sessionToken]);

  function resetGame() {
    setPhase("betting");
    setCurrentFloor(0);
    setMultiplier(1.0);
    setFloorResults(Array.from({ length: FLOORS }, () => null));
    setAllBustTiles(null);
    setPayout(0);
    setError(null);
    setPicking(false);
    animLock.current = false;
  }

  async function startGame() {
    const betAmount = parseInt(bet);
    if (!betAmount || betAmount < minBet || betAmount > maxBet) {
      setError(`Bet: ${minBet.toLocaleString()}–${maxBet.toLocaleString()} chips`);
      return;
    }
    setError(null);
    setPicking(true);
    try {
      const r = await fetch(`${BASE}/api/mob-tower/start`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ bet: betAmount }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      awardXP(betAmount);
      setCurrentFloor(0);
      setMultiplier(1.0);
      setFloorResults(Array.from({ length: FLOORS }, () => null));
      setAllBustTiles(null);
      setPhase("playing");
    } catch (e: any) {
      setError(e.message || "Failed to start");
    } finally {
      setPicking(false);
    }
  }

  async function pickTile(tileIndex: number) {
    if (phase !== "playing" || picking || animLock.current) return;
    setPicking(true);
    animLock.current = true;
    setAnimatingTile({ floor: currentFloor, tile: tileIndex });

    try {
      const r = await fetch(`${BASE}/api/mob-tower/pick`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ tileIndex }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      await new Promise((res) => setTimeout(res, 500));

      setFloorResults((prev) => {
        const next = [...prev];
        next[d.floor] = { pick: tileIndex, bustIndex: d.bustIndex, result: d.result };
        return next;
      });

      if (d.result === "bust") {
        soundBust();
        setAllBustTiles(d.allBustTiles);
        setPhase("lost");
      } else if (d.complete) {
        setAllBustTiles(d.allBustTiles);
        setPayout(d.payout);
        setMultiplier(d.multiplier);
        setCurrentFloor(d.newFloor);
        setPhase("won");
      } else {
        soundSafe();
        setCurrentFloor(d.newFloor);
        setMultiplier(d.multiplier);
      }
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setPicking(false);
      animLock.current = false;
      setAnimatingTile(null);
    }
  }

  async function cashOut() {
    if (picking || currentFloor === 0) return;
    soundCashout();
    setPicking(true);
    try {
      const r = await fetch(`${BASE}/api/mob-tower/cashout`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAllBustTiles(d.allBustTiles);
      setPayout(d.payout);
      setMultiplier(d.multiplier);
      setPhase("won");
    } catch (e: any) {
      setError(e.message || "Cashout failed");
    } finally {
      setPicking(false);
    }
  }

  function getTileState(floor: number, tile: number): TileState {
    const result = floorResults[floor];
    if (result) {
      if (result.pick === tile) return result.result === "safe" ? "safe" : "bust";
      if (allBustTiles && allBustTiles[floor] === tile) return "other-bust";
      return "hidden";
    }
    if (allBustTiles && !floorResults[floor] && (phase === "lost" || phase === "won")) {
      if (allBustTiles[floor] === tile) return "other-bust";
    }
    return "hidden";
  }

  // floors displayed bottom-to-top: displayFloors[0] = floor 7 (top row), displayFloors[7] = floor 0 (bottom row)
  const displayFloors = Array.from({ length: FLOORS }, (_, i) => FLOORS - 1 - i);

  const betInt = parseInt(bet) || 0;

  return (
    <div style={{
      position: "fixed", inset: 0,
      backgroundImage: `url(${BASE}/mob-tower-bg.png)`,
      backgroundSize: "cover",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      overflow: "hidden",
    }}>
      {/* ── Board frame + tile grid ──────────────────────────────────────────
          The board img and tile grid live in the same container so every
          percentage position is relative to the rendered board image.
          board.png is 1920×1080. The dark slot grid inside it sits at:
            top ≈ 20%   bottom ≈ 3%   left ≈ 34%   right ≈ 33%
      ──────────────────────────────────────────────────────────────────── */}
      <div style={{
        position: "absolute",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        height: "100%",
        aspectRatio: "1920 / 1080",
        maxWidth: "none",
      }}>
        {/* Board frame image */}
        <img
          src={`${BASE}/mob-tower-board.png`}
          alt=""
          style={{ width: "100%", height: "100%", display: "block", pointerEvents: "none", userSelect: "none" }}
        />

        {/* Each tile is absolutely positioned at its exact pixel-measured location
            from board.png (1920×1080). Rows and columns are 100% independent —
            adjusting one row/column never shifts any other.
            Row separators measured at y≈389,468,546,625,704,783,861.
            Column separators at x≈910, x≈1092. */}
        {(() => {
          // Each entry: [top%, height%] measured from board.png y coords / 1080
          const ROW_POS: [string, string][] = [
            ["28.9%", "7.5%"], // displayRow 0 = floor 7 (top)
            ["36.5%", "7.2%"], // displayRow 1 = floor 6
            ["43.8%", "7.2%"], // displayRow 2 = floor 5
            ["51.1%", "7.3%"], // displayRow 3 = floor 4
            ["58.4%", "7.3%"], // displayRow 4 = floor 3
            ["65.7%", "7.3%"], // displayRow 5 = floor 2
            ["73.0%", "7.2%"], // displayRow 6 = floor 1
            ["80.2%", "7.5%"], // displayRow 7 = floor 0 (bottom)
          ];
          // Each entry: [left%, width%] measured from board.png x coords / 1920
          const COL_POS: [string, string][] = [
            ["37.8%", "9.0%"], // col 0 (left)
            ["47.1%", "9.2%"], // col 1 (center)
            ["56.5%", "8.9%"], // col 2 (right)
          ];

          return displayFloors.flatMap((floor, rowIdx) =>
            Array.from({ length: TILES }, (_, tile) => {
              const isActive = phase === "playing" && floor === currentFloor;
              const isFuture = phase === "playing" && floor > currentFloor;
              const isAnimating = animatingTile?.floor === floor && animatingTile?.tile === tile;
              const state = getTileState(floor, tile);

              let bg = "rgba(0,0,0,0.45)";
              let cursor = "default";
              if (isActive)    { bg = "rgba(212,160,23,0.25)"; cursor = "pointer"; }
              if (isFuture)    { bg = "rgba(0,0,0,0.55)"; }
              if (isAnimating) { bg = "rgba(212,160,23,0.45)"; }

              const isSafe      = state === "safe";
              const isBust      = state === "bust";
              const isOtherBust = state === "other-bust";

              const [top, height] = ROW_POS[rowIdx];
              const [left, width] = COL_POS[tile];

              return (
                <div key={`${floor}-${tile}`} style={{ position: "absolute", top, height, left, width }}>
                  <button
                    disabled={!isActive || picking}
                    onClick={() => isActive && pickTile(tile)}
                    style={{
                      position: "absolute",
                      inset: "7px",
                      overflow: "hidden",
                      background: bg,
                      border: "none",
                      borderRadius: 6,
                      cursor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                      transition: "background 0.18s",
                    }}
                    onMouseEnter={(e) => {
                      if (isActive && !picking)
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,160,23,0.35)";
                    }}
                    onMouseLeave={(e) => {
                      if (isActive && !picking && state === "hidden")
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(212,160,23,0.15)";
                    }}
                  >
                    {isSafe && (
                      <img src={`${BASE}/mob-tower-safe.png`} alt="safe"
                        style={{ position: "absolute", width: "97%", height: "auto",
                          top: "55%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    )}
                    {(isBust || isOtherBust) && (
                      <img src={`${BASE}/mob-tower-bust.png`} alt="bust"
                        style={{ position: "absolute", width: "100%", height: "auto",
                          top: "50%", transform: "translateY(-50%)",
                          opacity: isOtherBust ? 0.55 : 1, pointerEvents: "none" }} />
                    )}
                  </button>
                </div>
              );
            })
          );
        })()}
      </div>

      {/* ── Header ── */}
      <div style={{ borderBottom: "1px solid rgba(212,160,23,0.2)", background: "rgba(6,2,10,0.97)", position: "absolute", top: 0, left: 0, right: 0, zIndex: 50, boxShadow: "0 2px 20px rgba(0,0,0,0.8)" }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "0 20px", height: "54px", display: "flex", alignItems: "center", gap: "14px" }}>
          {/* Back */}
          <button onClick={() => setLocation("/minigames")} style={{ display: "flex", alignItems: "center", gap: 5, color: "#64748b", background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "6px 10px", borderRadius: 8 }}
            onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")} onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}>
            <ChevronLeft size={15} /> Mini Games
          </button>
          <div style={{ width: 1, height: 20, background: "rgba(212,160,23,0.3)" }} />
          {/* Title */}
          <h1 style={{ fontFamily: "'Oswald', sans-serif", fontSize: 20, fontWeight: 700, color: "#e8d5a3", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>Mob Tower</h1>
          {/* Right side: volume + chips */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>

            {/* Volume control */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowVolSlider(v => !v)}
                style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", color: volume === 0 ? "#ef4444" : "#9ca3af", padding: "6px 8px", borderRadius: 8 }}
                onMouseEnter={e => (e.currentTarget.style.color = "#e8d5a3")}
                onMouseLeave={e => (e.currentTarget.style.color = volume === 0 ? "#ef4444" : "#9ca3af")}
                title="Volume"
              >
                {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              {showVolSlider && (
                <div style={{
                  position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 100,
                  background: "rgba(10,8,3,0.97)", border: "1px solid rgba(212,160,23,0.3)",
                  borderRadius: 10, padding: "10px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
                }}>
                  <span style={{ fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Volume</span>
                  <input
                    type="range" min={0} max={1} step={0.01} value={volume}
                    onChange={e => { const v = parseFloat(e.target.value); setVolume(v); setMasterVolume(v); }}
                    style={{ width: 90, accentColor: "#f5c842", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#f5c842" }}>{Math.round(volume * 100)}%</span>
                  <button
                    onClick={() => { const v = volume === 0 ? 1 : 0; setVolume(v); setMasterVolume(v); }}
                    style={{ fontSize: 10, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
                  >
                    {volume === 0 ? "Unmute" : "Mute"}
                  </button>
                </div>
              )}
            </div>

            {/* Chips pill */}
            <div style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(212,160,23,0.25)", padding: "6px 14px", display: "flex", alignItems: "center", gap: 7, borderRadius: 10 }}>
              <span style={{ fontSize: 14 }}>🪙</span>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 700, color: "#fcd34d", fontSize: 15 }}>{chips.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Betting bar — centered under the board ── */}
      {phase === "betting" && (
        <div style={{
          position: "absolute",
          bottom: "1%",
          left: "52%",
          transform: "translateX(-50%)",
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: "linear-gradient(180deg, rgba(22,15,5,0.97) 0%, rgba(10,8,3,0.97) 100%)",
          border: "1px solid rgba(212,160,23,0.28)",
          borderTop: "2px solid rgba(200,151,58,0.8)",
          borderRadius: 14,
          padding: "12px 20px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.75), 0 0 0 1px rgba(0,0,0,0.4)",
          whiteSpace: "nowrap",
        }}>
          {/* Quick chips */}
          <div style={{ display: "flex", gap: 5 }}>
            {betPresets.map((v) => {
              const active = parseInt(bet) === v;
              const label = v >= 1000000 ? `${v / 1000000}m` : v >= 1000 ? `${v / 1000}k` : String(v);
              return (
                <button key={v} onClick={() => setBet(String(v))} style={{
                  fontSize: 11, fontWeight: 700,
                  padding: "6px 11px",
                  background: active ? "rgba(212,160,23,0.2)" : "rgba(255,255,255,0.05)",
                  border: active ? "1px solid rgba(212,160,23,0.8)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: active ? "#f5c842" : "#9ca3af",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Amount input */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <input
              type="number" value={bet} onChange={(e) => setBet(e.target.value)}
              min={minBet} max={maxBet}
              style={{
                width: 130,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(212,160,23,0.3)",
                borderRadius: 8, color: "#fff",
                padding: "8px 38px 8px 12px",
                fontSize: 16, fontWeight: 700,
                outline: "none", textAlign: "center",
              }}
            />
            <span style={{
              position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
              color: "#6b7280", fontSize: 10, pointerEvents: "none",
            }}>chips</span>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />

          {/* Place Bet button */}
          <button
            onClick={startGame} disabled={!enabled || picking}
            style={{
              padding: "9px 28px",
              background: enabled
                ? "linear-gradient(135deg, #92650a 0%, #f5c842 55%, #a8750c 100%)"
                : "rgba(75,85,99,0.4)",
              border: "none", borderRadius: 9,
              color: enabled ? "#1a0800" : "#6b7280",
              fontWeight: 900, fontSize: 13,
              cursor: enabled ? "pointer" : "default",
              textTransform: "uppercase", letterSpacing: 2,
              boxShadow: enabled ? "0 3px 14px rgba(212,160,23,0.35)" : "none",
              flexShrink: 0,
            }}
          >
            {picking ? "Starting…" : "Place Bet"}
          </button>

          {/* Error / disabled notice inline */}
          {(error || !enabled) && (
            <span style={{ color: "#ef4444", fontSize: 11, marginLeft: 4 }}>
              {error || "Currently closed"}
            </span>
          )}
        </div>
      )}

      {/* ── Bottom action bar (replaces betting bar during play) ── */}
      {phase === "playing" && (
        <div style={{
          position: "absolute", bottom: "1%", left: "52%", transform: "translateX(-50%)",
          zIndex: 30, display: "flex", alignItems: "center", gap: 14,
          background: "linear-gradient(180deg, rgba(22,15,5,0.97) 0%, rgba(10,8,3,0.97) 100%)",
          border: "1px solid rgba(212,160,23,0.28)",
          borderTop: "2px solid rgba(200,151,58,0.8)",
          borderRadius: 14, padding: "12px 28px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.75)",
          whiteSpace: "nowrap",
        }}>
          {currentFloor === 0 ? (
            <span style={{ fontSize: 14, fontWeight: 700, color: "#9ca3af", letterSpacing: 1, textTransform: "uppercase" }}>
              Pick a tile to begin
            </span>
          ) : (
            <>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Payout</span>
              <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 900, color: "#4ade80", fontSize: 18 }}>
                {Math.floor(betInt * multiplier).toLocaleString()}
              </span>
              <span style={{ fontSize: 11, color: "#6b7280" }}>chips</span>
              <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.1)" }} />
              <button
                onClick={cashOut} disabled={picking}
                style={{
                  padding: "9px 28px",
                  background: "linear-gradient(135deg, #15803d 0%, #22c55e 55%, #16a34a 100%)",
                  border: "none", borderRadius: 9,
                  color: "#fff", fontWeight: 900, fontSize: 13,
                  cursor: picking ? "default" : "pointer",
                  textTransform: "uppercase", letterSpacing: 2,
                  boxShadow: "0 3px 14px rgba(34,197,94,0.35)",
                }}
              >
                Cash Out
              </button>
            </>
          )}
          {error && <span style={{ color: "#ef4444", fontSize: 11 }}>{error}</span>}
        </div>
      )}

      {/* ── Multiplier ladder (left side) — always visible ── */}
      <div style={{
        position: "absolute", right: "69%", top: "50%", transform: "translateY(-50%)",
        zIndex: 30, background: "rgba(0,0,0,0.78)",
        border: "1px solid rgba(212,160,23,0.25)", borderRadius: 10,
        padding: "8px 0", minWidth: 110,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1, padding: "0 10px 6px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          Multipliers
        </div>
        {displayFloors.map((floor) => {
          const mult = MULTS[floor + 1];
          const isDone = floorResults[floor]?.result === "safe";
          const isCurrent = phase === "playing" && currentFloor === floor;
          const isBusted = floorResults[floor]?.result === "bust";
          return (
            <div key={floor} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 10px",
              background: isCurrent ? "rgba(212,160,23,0.12)" : isDone ? "rgba(34,197,94,0.07)" : isBusted ? "rgba(239,68,68,0.1)" : "transparent",
              borderLeft: isCurrent ? "3px solid #f5c842" : isDone ? "3px solid #4ade80" : isBusted ? "3px solid #ef4444" : "3px solid transparent",
            }}>
              <span style={{ fontSize: 10, color: "#6b7280" }}>F{floor + 1}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isCurrent ? "#f5c842" : isDone ? "#4ade80" : isBusted ? "#ef4444" : "#9ca3af" }}>
                {mult.toFixed(2)}×
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Win overlay ── */}
      {phase === "won" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.65)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: "#f5c842", textShadow: "0 0 40px rgba(245,200,66,0.6)" }}>
            💰 YOU WIN!
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, color: "#4ade80" }}>
            +{payout.toLocaleString()} chips
          </div>
          <div style={{ fontSize: 18, color: "#9ca3af" }}>{multiplier.toFixed(2)}× multiplier</div>
          <button onClick={resetGame} style={{
            marginTop: 8, padding: "14px 48px",
            background: "linear-gradient(135deg, #b8860b, #f5c842)",
            border: "none", borderRadius: 10, color: "#1a0f00",
            fontWeight: 900, fontSize: 16, cursor: "pointer",
            textTransform: "uppercase", letterSpacing: 2,
          }}>
            Play Again
          </button>
        </div>
      )}

      {/* ── Bust overlay ── */}
      {phase === "lost" && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.65)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16,
        }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: "#ef4444", textShadow: "0 0 40px rgba(239,68,68,0.5)" }}>
            🚔 BUSTED!
          </div>
          <div style={{ fontSize: 18, color: "#9ca3af" }}>The cops were waiting for you.</div>
          <button onClick={resetGame} style={{
            marginTop: 8, padding: "14px 48px",
            background: "rgba(239,68,68,0.18)",
            border: "1px solid rgba(239,68,68,0.5)",
            borderRadius: 10, color: "#ef4444",
            fontWeight: 900, fontSize: 16, cursor: "pointer",
            textTransform: "uppercase", letterSpacing: 2,
          }}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
