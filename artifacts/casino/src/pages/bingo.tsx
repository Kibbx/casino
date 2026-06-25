import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { usePageTracker } from "../lib/usePageTracker";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmt(n: number) { return n.toLocaleString(); }

function getBallLabel(n: number): string {
  if (n <= 15) return `B-${n}`;
  if (n <= 30) return `I-${n}`;
  if (n <= 45) return `N-${n}`;
  if (n <= 60) return `G-${n}`;
  return `O-${n}`;
}

function getBallColor(n: number): string {
  if (n <= 15) return "#3b82f6";
  if (n <= 30) return "#ef4444";
  if (n <= 45) return "#6b7280";
  if (n <= 60) return "#22c55e";
  return "#f97316";
}

const STATUS_LABELS: Record<string, string> = {
  waiting: "Waiting",
  buying_open: "Card Buying Open",
  buying_closed: "Buying Closed",
  in_progress: "In Progress",
  claim_review: "Claim Review",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  waiting: "#6b7280",
  buying_open: "#22c55e",
  buying_closed: "#f59e0b",
  in_progress: "#3b82f6",
  claim_review: "#a855f7",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

interface BingoCard {
  id: number;
  roundId: number;
  cardNumbers: number[][];
  markedNumbers: number[];
  createdAt: string;
}

interface BingoRound {
  id: number;
  status: string;
  cardPrice: number;
  maxCardsPerPlayer: number;
  prizePoolPercent: number;
  houseCutPercent: number;
  winningPattern: string;
  drawnBalls: number[];
  totalCardsSold: number;
  totalCollected: number;
  prizePool: number;
  houseProfit: number;
  rolloverApplied: number;
  buyingOpenedAt: string | null;
  startedAt: string | null;
}

export default function BingoPage() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("bingo", sessionToken);
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));

  const { data: player } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const chips = liveChips ?? player?.chips ?? 0;

  const [round, setRound] = useState<BingoRound | null>(null);
  const [myCards, setMyCards] = useState<BingoCard[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [claimMsgs, setClaimMsgs] = useState<Record<number, { text: string; ok: boolean }>>({});
  const [markLoading, setMarkLoading] = useState<Record<string, boolean>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (!sessionToken) {
    setLocation("/login");
    return null;
  }

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    return fetch(`${BASE}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
        ...(opts?.headers ?? {}),
      },
    });
  }, [sessionToken]);

  const pollActive = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/bingo/active`);
      const d = await r.json();
      setRound(d.round ?? null);
    } catch {}
  }, []);

  const fetchMyCards = useCallback(async (roundId: number) => {
    try {
      const r = await apiFetch(`/bingo/rounds/${roundId}/my-cards`);
      const d = await r.json();
      if (Array.isArray(d)) setMyCards(d);
    } catch {}
  }, [apiFetch]);

  useEffect(() => {
    pollActive();
    pollRef.current = setInterval(pollActive, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollActive]);

  useEffect(() => {
    if (round && ["in_progress", "claim_review", "buying_open", "completed"].includes(round.status)) {
      fetchMyCards(round.id);
    }
    if (!round || ["completed", "cancelled"].includes(round.status)) {
      setMyCards([]);
    }
  }, [round?.id, round?.status, fetchMyCards]);

  async function handleBuyCards() {
    if (!round) return;
    setBuying(true);
    setBuyMsg(null);
    try {
      const r = await apiFetch(`/bingo/rounds/${round.id}/buy-cards`, {
        method: "POST",
        body: JSON.stringify({ quantity }),
      });
      const d = await r.json();
      if (!r.ok) { setBuyMsg({ text: d.error || "Failed", ok: false }); return; }
      setBuyMsg({ text: `Bought ${quantity} card${quantity > 1 ? "s" : ""} for ${fmt(d.totalCost)} chips!`, ok: true });
      fetchMyCards(round.id);
    } catch {
      setBuyMsg({ text: "Request failed", ok: false });
    } finally {
      setBuying(false);
    }
  }

  async function handleMark(cardId: number, number: number, isMarked: boolean) {
    const key = `${cardId}-${number}`;
    setMarkLoading(prev => ({ ...prev, [key]: true }));
    try {
      const endpoint = isMarked ? "unmark" : "mark";
      const r = await apiFetch(`/bingo/cards/${cardId}/${endpoint}`, {
        method: "POST",
        body: JSON.stringify({ number }),
      });
      const d = await r.json();
      if (r.ok && d.markedNumbers) {
        setMyCards(prev => prev.map(c => c.id === cardId ? { ...c, markedNumbers: d.markedNumbers } : c));
      }
    } catch {}
    setMarkLoading(prev => ({ ...prev, [key]: false }));
  }

  async function handleClaim(cardId: number) {
    const r = await apiFetch(`/bingo/cards/${cardId}/claim`, { method: "POST" });
    const d = await r.json();
    if (r.ok) {
      setClaimMsgs(prev => ({ ...prev, [cardId]: { text: "Bingo claimed! Waiting for dealer review.", ok: true } }));
    } else {
      setClaimMsgs(prev => ({ ...prev, [cardId]: { text: d.error || "Failed", ok: false } }));
    }
  }

  const canMark = round && ["in_progress", "claim_review"].includes(round.status);
  const canClaim = round && ["in_progress", "claim_review"].includes(round.status);
  const canBuy = round && round.status === "buying_open";

  const existingCardCount = myCards.length;
  const maxBuy = round ? Math.max(0, round.maxCardsPerPlayer - existingCardCount) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0005", color: "#fff", fontFamily: "Georgia, serif" }}>
      {/* Header */}
      <div style={{ background: "rgba(0,0,0,0.85)", borderBottom: "1px solid rgba(180,30,60,0.3)", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={() => setLocation("/live-events")} style={{ display: "flex", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
          <ChevronLeft size={18} /> Live Events
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "Oswald, Georgia, serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff" }}>BINGO</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em" }}>BACK ALLEY BETS</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Chips</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#fbbf24" }}>{fmt(chips)}</div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "12px 16px" }}>
        {/* Round Status — compact single bar */}
        <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 8, padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!round ? (
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>No active Bingo round right now. Check back later.</div>
          ) : (
            <>
              <span style={{ fontFamily: "Oswald, sans-serif", fontSize: 12, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Round #{round.id}</span>
              <span style={{ padding: "2px 8px", borderRadius: 20, background: STATUS_COLORS[round.status] + "33", border: `1px solid ${STATUS_COLORS[round.status]}66`, color: STATUS_COLORS[round.status], fontSize: 11, fontWeight: 700 }}>
                {STATUS_LABELS[round.status] || round.status}
              </span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 16, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Price <b style={{ color: "#fbbf24" }}>{fmt(round.cardPrice)}</b></span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Pool <b style={{ color: "#22c55e" }}>{fmt(round.prizePool)}</b></span>
                {round.rolloverApplied > 0 && (
                  <span style={{ padding: "2px 8px", borderRadius: 20, background: "rgba(251,191,36,0.18)", border: "1px solid rgba(251,191,36,0.5)", color: "#fbbf24", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>
                    JACKPOT +{fmt(round.rolloverApplied)}
                  </span>
                )}
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Sold <b style={{ color: "#fff" }}>{round.totalCardsSold}</b></span>
              </span>
            </>
          )}
        </div>

        {/* Buy Cards */}
        {canBuy && maxBuy > 0 && (
          <div style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 12, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, color: "#22c55e" }}>Buy Bingo Cards</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 14 }}>
              You have {existingCardCount} of {round!.maxCardsPerPlayer} cards. You can buy up to {maxBuy} more.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  style={{ width: 38, height: 38, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >−</button>
                <span style={{ fontSize: 22, fontWeight: 700, minWidth: 28, textAlign: "center" }}>{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(maxBuy, q + 1))}
                  style={{ width: 38, height: 38, borderRadius: 8, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                >+</button>
              </div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                Total: <span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(quantity * (round?.cardPrice ?? 0))} chips</span>
              </div>
              <button
                onClick={handleBuyCards}
                disabled={buying || quantity < 1}
                style={{ padding: "10px 24px", borderRadius: 8, background: buying ? "rgba(34,197,94,0.3)" : "rgba(34,197,94,0.85)", border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: buying ? "default" : "pointer", letterSpacing: "0.05em" }}
              >
                {buying ? "Buying..." : `Buy ${quantity} Card${quantity > 1 ? "s" : ""}`}
              </button>
            </div>
            {buyMsg && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: buyMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${buyMsg.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, color: buyMsg.ok ? "#86efac" : "#fca5a5", fontSize: 13 }}>
                {buyMsg.text}
              </div>
            )}
          </div>
        )}

        {canBuy && maxBuy === 0 && existingCardCount > 0 && (
          <div style={{ background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 12, padding: "14px 20px", marginBottom: 20, fontSize: 13, color: "rgba(251,191,36,0.85)" }}>
            You have the maximum {round!.maxCardsPerPlayer} cards for this round.
          </div>
        )}

        {/* Drawn Balls — compact */}
        {round && round.drawnBalls.length > 0 && (() => {
          const latest = round.drawnBalls[round.drawnBalls.length - 1];
          const latestLabel = getBallLabel(latest);
          const latestColor = getBallColor(latest);
          const cols = [
            { letter: "B", color: "#3b82f6", balls: round.drawnBalls.filter(b => b <= 15) },
            { letter: "I", color: "#ef4444", balls: round.drawnBalls.filter(b => b > 15 && b <= 30) },
            { letter: "N", color: "#9ca3af", balls: round.drawnBalls.filter(b => b > 30 && b <= 45) },
            { letter: "G", color: "#22c55e", balls: round.drawnBalls.filter(b => b > 45 && b <= 60) },
            { letter: "O", color: "#f97316", balls: round.drawnBalls.filter(b => b > 60) },
          ];
          return (
            <div style={{ background: "#111120", border: "1px solid #2a2a3a", borderRadius: 8, padding: "10px 14px", marginBottom: 10 }}>
              {/* Top row: latest ball + column counts + total */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: latestColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 12, color: "#fff" }}>{latestLabel}</span>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.3 }}>
                  <div style={{ fontWeight: 700, color: latestColor, fontSize: 13 }}>{latestLabel}</div>
                  <div>Latest Ball</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  {cols.map(({ letter, color, balls }) => (
                    <span key={letter} style={{ fontFamily: "Oswald, sans-serif", fontSize: 12, fontWeight: 700, color, background: color + "22", border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 7px" }}>
                      {letter}<span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}> {balls.length}</span>
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginLeft: 4 }}>{round.drawnBalls.length}/75</span>
                </div>
              </div>
              {/* All drawn balls as small pills */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {[...round.drawnBalls].reverse().map((ball) => {
                  const color = getBallColor(ball);
                  const isLatest = ball === latest;
                  return (
                    <span key={ball} style={{ padding: "2px 7px", borderRadius: 4, background: isLatest ? color : color + "33", border: `1px solid ${color}55`, color: isLatest ? "#fff" : color, fontSize: 11, fontWeight: 700, fontFamily: "Oswald, sans-serif" }}>
                      {getBallLabel(ball)}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* My Cards */}
        {myCards.length > 0 && round && (
          <div>
            <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14, color: "rgba(255,255,255,0.7)" }}>
              Your Cards ({myCards.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {myCards.map((card) => {
                const drawnBalls = round.drawnBalls;
                const marked = new Set(card.markedNumbers);
                const claimMsg = claimMsgs[card.id];
                const hasPendingClaim = claimMsg?.ok;

                return (
                  <div key={card.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontFamily: "Oswald, sans-serif", letterSpacing: "0.06em" }}>CARD #{card.id}</span>
                      {hasPendingClaim && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.4)", color: "#d8b4fe" }}>CLAIMED</span>}
                    </div>

                    {/* BINGO header */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
                      {["B", "I", "N", "G", "O"].map((letter, ci) => {
                        const colors = ["#3b82f6", "#ef4444", "#6b7280", "#22c55e", "#f97316"];
                        return (
                          <div key={letter} style={{ textAlign: "center", fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 16, color: colors[ci], paddingBottom: 4 }}>
                            {letter}
                          </div>
                        );
                      })}
                    </div>

                    {/* 5×5 grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
                      {card.cardNumbers.map((row, ri) =>
                        row.map((cell, ci) => {
                          const isFree = cell === 0;
                          const isMarked = marked.has(cell) || (isFree && marked.has(0));
                          const canMark2 = canMark && !isFree;

                          let bg = "#1e1e2e";
                          let textColor = "#6b7280";
                          let borderColor = "#374151";
                          let fontWeight = 400;

                          if (isFree) {
                            bg = "#1d4ed8";
                            textColor = "#fff";
                            borderColor = "#3b82f6";
                            fontWeight = 700;
                          } else if (isMarked) {
                            bg = "#15803d";
                            textColor = "#fff";
                            borderColor = "#22c55e";
                            fontWeight = 700;
                          }

                          const key2 = `${card.id}-${cell}`;
                          const loading = markLoading[key2];

                          return (
                            <button
                              key={`${ri}-${ci}`}
                              disabled={!canMark2 || loading || isFree}
                              onClick={() => canMark2 && !loading && handleMark(card.id, cell, isMarked)}
                              style={{
                                height: 46,
                                borderRadius: 6,
                                background: bg,
                                border: `1px solid ${borderColor}`,
                                color: textColor,
                                fontWeight,
                                fontSize: 14,
                                cursor: (canMark2 && !isFree) ? "pointer" : "default",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: "Oswald, sans-serif",
                                transition: "all 0.1s",
                              }}
                            >
                              {isFree ? "FREE" : loading ? "..." : cell}
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Color legend */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                      <span style={{ color: "#86efac" }}>■</span> Marked+Drawn
                      <span style={{ color: "rgba(251,191,36,0.9)", marginLeft: 4 }}>■</span> Drawn
                      <span style={{ color: "#fca5a5", marginLeft: 4 }}>■</span> Marked (not drawn)
                      <span style={{ color: "#93c5fd", marginLeft: 4 }}>■</span> FREE
                    </div>

                    {/* Call Bingo */}
                    {canClaim && !hasPendingClaim && (
                      <button
                        onClick={() => handleClaim(card.id)}
                        style={{ padding: "12px", borderRadius: 8, background: "rgba(168,85,247,0.8)", border: "1px solid rgba(168,85,247,0.5)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "Oswald, sans-serif", letterSpacing: "0.1em", textTransform: "uppercase" }}
                      >
                        CALL BINGO
                      </button>
                    )}
                    {claimMsg && (
                      <div style={{ padding: "8px 12px", borderRadius: 6, background: claimMsg.ok ? "rgba(168,85,247,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${claimMsg.ok ? "rgba(168,85,247,0.3)" : "rgba(239,68,68,0.3)"}`, color: claimMsg.ok ? "#d8b4fe" : "#fca5a5", fontSize: 12 }}>
                        {claimMsg.text}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* No cards yet, buying open */}
        {canBuy && myCards.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
            Card buying is open! Purchase cards above to play.
          </div>
        )}

        {/* Waiting for round */}
        {round && round.status === "waiting" && (
          <div style={{ textAlign: "center", padding: "40px 20px" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎱</div>
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 14 }}>The dealer is setting up this round. Card buying will open soon.</div>
          </div>
        )}

        {/* Buying closed, waiting for start */}
        {round && round.status === "buying_closed" && myCards.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
            Card buying is closed. The round is about to begin.
          </div>
        )}

        {/* How to play */}
        {!round && (
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 24px", marginTop: 10 }}>
            <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 14, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>How to Play</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.8 }}>
              <div>1. Wait for a Dealer to open a Bingo round.</div>
              <div>2. When buying opens, purchase up to the max cards allowed.</div>
              <div>3. Watch the drawn numbers and manually tap to mark them on your cards.</div>
              <div>4. When you have a line (row, column, or diagonal), press CALL BINGO.</div>
              <div>5. The Dealer reviews your claim and pays out if valid.</div>
            </div>
          </div>
        )}

        {/* Completed / Cancelled state */}
        {round && ["completed", "cancelled"].includes(round.status) && (
          <div style={{ textAlign: "center", padding: "30px 20px" }}>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)" }}>
              {round.status === "completed" ? "This round has ended." : "This round was cancelled."}
              {" "}A new round will begin soon.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
