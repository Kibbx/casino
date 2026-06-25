import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { RefreshCw, ChevronDown, ChevronUp, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

async function bankerApiFetch(path: string, opts?: RequestInit) {
  const { bankerToken, sessionToken } = useStore.getState();
  const authToken = bankerToken || sessionToken || "";
  return fetch(`${BASE_URL}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

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
  buying_open: "Buying Open",
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

interface BingoRound {
  id: number;
  status: string;
  dealerUsername: string;
  cardPrice: number;
  maxCardsPerPlayer: number;
  houseCutPercent: number;
  prizePoolPercent: number;
  winningPattern: string;
  drawnBalls: number[];
  totalCardsSold: number;
  totalCollected: number;
  prizePool: number;
  houseProfit: number;
  players?: { playerId: number; username: string; cardCount: number }[];
  createdAt: string;
  completedAt?: string;
}

interface BingoClaim {
  id: number;
  roundId: number;
  playerId: number;
  playerName: string;
  stateId: string;
  phoneNumber: string;
  claimedCardId: number;
  cardNumbers: number[][];
  markedNumbers: number[];
  drawnBallsAtClaim: number[];
  status: string;
  claimTime: string;
  reviewedBy?: string;
  rejectionReason?: string;
}

interface BingoCard {
  id: number;
  playerId: number;
  playerName: string;
  cardNumbers: number[][];
  markedNumbers: number[];
}

function CardGrid({ card, drawnBalls, compact = false }: { card: { cardNumbers: number[][], markedNumbers: number[] }, drawnBalls: number[], compact?: boolean }) {
  const marked = new Set(card.markedNumbers);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: compact ? 2 : 3, marginBottom: compact ? 2 : 4 }}>
        {["B","I","N","G","O"].map((l, ci) => {
          const colors = ["#3b82f6","#ef4444","#6b7280","#22c55e","#f97316"];
          return <div key={l} style={{ textAlign: "center", fontWeight: 700, fontSize: compact ? 11 : 13, color: colors[ci], fontFamily: "Oswald,sans-serif" }}>{l}</div>;
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: compact ? 2 : 3 }}>
        {card.cardNumbers.map((row, ri) =>
          row.map((cell, ci) => {
            const isFree = cell === 0;
            const isDrawn = isFree || drawnBalls.includes(cell);
            const isMarked = marked.has(cell) || (isFree && marked.has(0));
            let bg = "#1e1e2e";
            let textColor = "#6b7280";
            let border = "#374151";
            if (isFree) { bg = "#1d4ed8"; textColor = "#fff"; border = "#3b82f6"; }
            else if (isMarked && isDrawn) { bg = "#15803d"; textColor = "#fff"; border = "#22c55e"; }
            else if (isMarked && !isDrawn) { bg = "#991b1b"; textColor = "#fca5a5"; border = "#ef4444"; }
            else if (isDrawn && !isMarked) { bg = "#78350f"; textColor = "#fbbf24"; border = "#f59e0b"; }
            return (
              <div key={`${ri}-${ci}`} style={{
                height: compact ? 30 : 38, borderRadius: 4, background: bg, border: `1px solid ${border}`,
                color: textColor, fontWeight: isMarked ? 700 : 400, fontSize: compact ? 11 : 13,
                display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald,sans-serif",
              }}>
                {isFree ? "FREE" : cell}
              </div>
            );
          })
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.35)", flexWrap: "wrap" }}>
        <span style={{ color: "#86efac" }}>■</span> Marked+Drawn
        <span style={{ color: "rgba(251,191,36,0.9)" }}>■</span> Drawn
        <span style={{ color: "#fca5a5" }}>■</span> Marked (not drawn)
      </div>
    </div>
  );
}

function DealerPanel({ hasRole }: { hasRole: (...roles: string[]) => boolean }) {
  const [round, setRound] = useState<BingoRound | null>(null);
  const [claims, setClaims] = useState<BingoClaim[]>([]);
  const [players, setPlayers] = useState<{ playerId: number; username: string; cardCount: number }[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [playerCards, setPlayerCards] = useState<BingoCard[]>([]);
  const [selectedClaim, setSelectedClaim] = useState<BingoClaim | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [drawLoading, setDrawLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadRound = useCallback(async () => {
    try {
      const r = await bankerApiFetch("/bingo/active");
      const d = await r.json();
      if (d.round) {
        setRound(d.round);
      } else {
        setRound(null);
        setClaims([]);
        setPlayers([]);
      }
    } catch {}
  }, []);

  const loadDetail = useCallback(async (roundId: number) => {
    try {
      const [rDetail, rClaims] = await Promise.all([
        bankerApiFetch(`/bingo/rounds/${roundId}`),
        bankerApiFetch(`/bingo/rounds/${roundId}/claims`),
      ]);
      const detail = await rDetail.json();
      const claimsData = await rClaims.json();
      if (detail.players) setPlayers(detail.players);
      if (Array.isArray(claimsData)) setClaims(claimsData);
    } catch {}
  }, []);

  useEffect(() => {
    loadRound();
    const iv = setInterval(() => {
      loadRound();
    }, 4000);
    return () => clearInterval(iv);
  }, [loadRound]);

  useEffect(() => {
    if (round) loadDetail(round.id);
  }, [round?.id, round?.status, round?.totalCardsSold, loadDetail]);

  async function doAction(path: string, body?: any) {
    setActionLoading(true);
    setActionMsg(null);
    try {
      const r = await bankerApiFetch(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      const d = await r.json();
      if (!r.ok) { setActionMsg({ text: d.error || "Failed", ok: false }); return false; }
      setActionMsg({ text: "Done", ok: true });
      loadRound();
      return true;
    } catch {
      setActionMsg({ text: "Request failed", ok: false });
      return false;
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDraw() {
    if (!round) return;
    setDrawLoading(true);
    setActionMsg(null);
    try {
      const r = await bankerApiFetch(`/bingo/rounds/${round.id}/draw`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setActionMsg({ text: d.error || "Failed", ok: false }); }
      else { setActionMsg({ text: `Drew ${d.label}`, ok: true }); loadRound(); }
    } catch {
      setActionMsg({ text: "Failed", ok: false });
    } finally {
      setDrawLoading(false);
    }
  }

  async function loadPlayerCards(playerId: number) {
    if (!round) return;
    try {
      const r = await bankerApiFetch(`/bingo/rounds/${round.id}/all-cards?playerId=${playerId}`);
      const d = await r.json();
      if (Array.isArray(d)) setPlayerCards(d);
    } catch {}
  }

  async function handleApproveClaim(claim: BingoClaim) {
    const ok = await doAction(`/bingo/claims/${claim.id}/approve`);
    if (ok) { setSelectedClaim(null); loadDetail(claim.roundId); }
  }

  async function handleRejectClaim(claim: BingoClaim) {
    if (!rejectReason.trim()) { setActionMsg({ text: "Enter a rejection reason", ok: false }); return; }
    const ok = await doAction(`/bingo/claims/${claim.id}/reject`, { reason: rejectReason });
    if (ok) { setSelectedClaim(null); setRejectReason(""); loadDetail(claim.roundId); }
  }

  async function handleCreate() {
    setCreating(true);
    await doAction("/bingo/rounds");
    setCreating(false);
  }

  const pendingClaims = claims.filter(c => c.status === "pending");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Action message */}
      {actionMsg && (
        <div style={{ padding: "10px 16px", borderRadius: 8, background: actionMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${actionMsg.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`, color: actionMsg.ok ? "#86efac" : "#fca5a5", fontSize: 13 }}>
          {actionMsg.text}
        </div>
      )}

      {/* No round */}
      {!round && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "24px", textAlign: "center" }}>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 16 }}>No active Bingo round.</div>
          <button
            onClick={handleCreate}
            disabled={creating || actionLoading}
            style={{ padding: "12px 28px", borderRadius: 8, background: "rgba(34,197,94,0.8)", border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
          >
            {creating ? "Creating..." : "Create New Round"}
          </button>
        </div>
      )}

      {/* Active round controls */}
      {round && (
        <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "18px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.08em" }}>Round #{round.id}</span>
              <span style={{ marginLeft: 10, padding: "3px 10px", borderRadius: 20, background: STATUS_COLORS[round.status] + "22", border: `1px solid ${STATUS_COLORS[round.status]}55`, color: STATUS_COLORS[round.status], fontSize: 12, fontWeight: 700 }}>
                {STATUS_LABELS[round.status] || round.status}
              </span>
            </div>
            <button onClick={loadRound} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
              <RefreshCw size={16} />
            </button>
          </div>

          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px,1fr))", gap: 12, marginBottom: 16 }}>
            {[
              { label: "Card Price", value: fmt(round.cardPrice), color: "#fbbf24" },
              { label: "Cards Sold", value: String(round.totalCardsSold), color: "#fff" },
              { label: "Prize Pool", value: fmt(round.prizePool), color: "#22c55e" },
              { label: "House Profit", value: fmt(round.houseProfit), color: "#f97316" },
              { label: "Drawn Balls", value: `${round.drawnBalls.length}/75`, color: "#3b82f6" },
              { label: "Players", value: String(players.length), color: "#a855f7" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>{label}</div>
                <div style={{ fontWeight: 700, fontSize: 15, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Round lifecycle controls */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            {round.status === "waiting" && (
              <button onClick={() => doAction(`/bingo/rounds/${round.id}/open-buying`)} disabled={actionLoading}
                style={{ padding: "10px 18px", borderRadius: 8, background: "rgba(34,197,94,0.8)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Open Card Buying
              </button>
            )}
            {round.status === "buying_open" && (
              <button onClick={() => doAction(`/bingo/rounds/${round.id}/close-buying`)} disabled={actionLoading}
                style={{ padding: "10px 18px", borderRadius: 8, background: "rgba(251,191,36,0.8)", border: "none", color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Close Card Buying
              </button>
            )}
            {round.status === "buying_closed" && (
              <button onClick={() => doAction(`/bingo/rounds/${round.id}/start`)} disabled={actionLoading}
                style={{ padding: "10px 18px", borderRadius: 8, background: "rgba(59,130,246,0.8)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Start Round
              </button>
            )}
            {["in_progress", "claim_review"].includes(round.status) && (
              <>
                <button onClick={handleDraw} disabled={drawLoading || actionLoading}
                  style={{ padding: "10px 24px", borderRadius: 8, background: "rgba(59,130,246,0.9)", border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", letterSpacing: "0.05em" }}>
                  {drawLoading ? "Drawing..." : "Draw Next Ball"}
                </button>
                {round.drawnBalls.length > 0 && (
                  <button onClick={() => doAction(`/bingo/rounds/${round.id}/undo-draw`)} disabled={actionLoading}
                    style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(107,114,128,0.5)", border: "1px solid rgba(107,114,128,0.5)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                    Undo Last Draw
                  </button>
                )}
              </>
            )}
            {["in_progress","claim_review","buying_closed"].includes(round.status) && (
              <button onClick={() => doAction(`/bingo/rounds/${round.id}/complete`)} disabled={actionLoading}
                style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(34,197,94,0.6)", border: "1px solid rgba(34,197,94,0.4)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                End Round
              </button>
            )}
            {!["completed","cancelled"].includes(round.status) && (
              <button onClick={() => doAction(`/bingo/rounds/${round.id}/cancel`)} disabled={actionLoading}
                style={{ padding: "10px 16px", borderRadius: 8, background: "rgba(239,68,68,0.4)", border: "1px solid rgba(239,68,68,0.4)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                Cancel Round
              </button>
            )}
          </div>

          {/* Latest drawn ball */}
          {round.drawnBalls.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Oswald,sans-serif" }}>Drawn Balls</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {(() => {
                  const latest = round.drawnBalls[round.drawnBalls.length - 1];
                  const label = getBallLabel(latest);
                  const color = getBallColor(latest);
                  return (
                    <div style={{ width: 56, height: 56, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 16px ${color}55`, flexShrink: 0 }}>
                      <span style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 14, color: "#fff" }}>{label}</span>
                    </div>
                  );
                })()}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1 }}>
                  {[...round.drawnBalls].reverse().map(ball => {
                    const color = getBallColor(ball);
                    return (
                      <span key={ball} style={{ padding: "3px 8px", borderRadius: 20, background: color + "22", border: `1px solid ${color}55`, color, fontSize: 11, fontWeight: 700, fontFamily: "Oswald,sans-serif" }}>
                        {getBallLabel(ball)}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pending Claims */}
      {round && pendingClaims.length > 0 && (
        <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 12, padding: "18px 20px" }}>
          {(() => {
            const approvedClaims = claims.filter(c => c.status === "approved").length;
            const totalWinners = pendingClaims.length + approvedClaims;
            const splitAmount = Math.floor(round.prizePool / totalWinners);
            return (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.1em", textTransform: "uppercase", color: "#d8b4fe" }}>
                  Pending Claims ({pendingClaims.length})
                </div>
                {totalWinners > 1 && (
                  <div style={{ padding: "4px 12px", borderRadius: 20, background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", fontSize: 12, fontWeight: 700 }}>
                    {totalWinners} winners — each gets ~{fmt(splitAmount)} chips
                  </div>
                )}
              </div>
            );
          })()}

          {pendingClaims.map(claim => (
            <div key={claim.id} style={{ background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "14px", marginBottom: 10, border: "1px solid rgba(168,85,247,0.2)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{claim.playerName}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    Card #{claim.claimedCardId} · {claim.drawnBallsAtClaim.length} balls drawn at claim
                  </div>
                </div>
                <button onClick={() => setSelectedClaim(selectedClaim?.id === claim.id ? null : claim)}
                  style={{ padding: "6px 14px", borderRadius: 6, background: "rgba(168,85,247,0.3)", border: "1px solid rgba(168,85,247,0.4)", color: "#d8b4fe", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                  {selectedClaim?.id === claim.id ? "Hide" : "Review"}
                </button>
              </div>

              {selectedClaim?.id === claim.id && (
                <div>
                  <div style={{ marginBottom: 12 }}>
                    <CardGrid card={{ cardNumbers: claim.cardNumbers, markedNumbers: claim.markedNumbers }} drawnBalls={claim.drawnBallsAtClaim} />
                  </div>
                  {/* Suspicious check */}
                  {(() => {
                    const drawn = new Set(claim.drawnBallsAtClaim);
                    const suspicious = claim.markedNumbers.some(n => n !== 0 && !drawn.has(n));
                    return suspicious ? (
                      <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertTriangle size={14} /> Suspicious: player marked numbers that were not drawn
                      </div>
                    ) : (
                      <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#86efac", fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle size={14} /> No suspicious markings detected
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (required to reject)"
                      style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: 13, outline: "none" }}
                    />
                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => handleApproveClaim(claim)} disabled={actionLoading}
                        style={{ flex: 1, padding: "10px", borderRadius: 8, background: "rgba(34,197,94,0.8)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <CheckCircle size={16} /> Approve & Pay
                      </button>
                      <button onClick={() => handleRejectClaim(claim)} disabled={actionLoading}
                        style={{ flex: 1, padding: "10px", borderRadius: 8, background: "rgba(239,68,68,0.6)", border: "none", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <XCircle size={16} /> Reject
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* All Claims (reviewed) */}
      {round && claims.filter(c => c.status !== "pending").length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px 20px" }}>
          <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>Reviewed Claims</div>
          {claims.filter(c => c.status !== "pending").map(claim => (
            <div key={claim.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 6, background: "rgba(0,0,0,0.2)", marginBottom: 6 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{claim.playerName}</span>
                <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Card #{claim.claimedCardId}</span>
              </div>
              <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: claim.status === "approved" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.15)", border: `1px solid ${claim.status === "approved" ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)"}`, color: claim.status === "approved" ? "#86efac" : "#fca5a5" }}>
                {claim.status === "approved" ? "Approved" : `Rejected: ${claim.rejectionReason || ""}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Active Players */}
      {round && players.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px 20px" }}>
          <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>
            Active Players ({players.length})
          </div>
          {players.map(p => (
            <div key={p.playerId}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 6, background: "rgba(0,0,0,0.2)", marginBottom: 4, cursor: "pointer" }}
                onClick={() => {
                  if (selectedPlayer === p.playerId) { setSelectedPlayer(null); setPlayerCards([]); }
                  else { setSelectedPlayer(p.playerId); loadPlayerCards(p.playerId); }
                }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.username}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{p.cardCount} card{p.cardCount !== 1 ? "s" : ""}</span>
                </div>
                {selectedPlayer === p.playerId ? <ChevronUp size={14} color="rgba(255,255,255,0.4)" /> : <ChevronDown size={14} color="rgba(255,255,255,0.4)" />}
              </div>
              {selectedPlayer === p.playerId && playerCards.length > 0 && (
                <div style={{ padding: "12px", background: "rgba(0,0,0,0.15)", borderRadius: 8, marginBottom: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                    {playerCards.map(card => (
                      <div key={card.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6, fontFamily: "Oswald,sans-serif" }}>CARD #{card.id}</div>
                        <CardGrid card={card} drawnBalls={round.drawnBalls} compact />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BankerSettingsPanel() {
  const [settings, setSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ cardPrice: 1000, maxCardsPerPlayer: 5, houseCutPercent: 20, prizePoolPercent: 80, winningPattern: "single_line" });

  useEffect(() => {
    bankerApiFetch("/bingo/settings").then(r => r.json()).then(d => {
      setSettings(d);
      setForm({ cardPrice: d.cardPrice, maxCardsPerPlayer: d.maxCardsPerPlayer, houseCutPercent: d.houseCutPercent, prizePoolPercent: d.prizePoolPercent, winningPattern: d.winningPattern });
    }).catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    try {
      const r = await bankerApiFetch("/bingo/settings", { method: "POST", body: JSON.stringify({ ...form, cardPrice: Number(form.cardPrice), maxCardsPerPlayer: Number(form.maxCardsPerPlayer), houseCutPercent: Number(form.houseCutPercent), prizePoolPercent: Number(form.prizePoolPercent) }) });
      const d = await r.json();
      if (!r.ok) { setMsg({ text: d.error || "Failed", ok: false }); return; }
      setMsg({ text: "Settings saved!", ok: true });
    } catch {
      setMsg({ text: "Request failed", ok: false });
    } finally {
      setSaving(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const inputStyle = { padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", fontSize: 14, outline: "none", width: "100%" };
  const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6, display: "block", textTransform: "uppercase" as const, letterSpacing: "0.07em" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "20px 22px" }}>
        <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 16, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 20, color: "#fbbf24" }}>Bingo Settings</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 16 }}>
          <div>
            <label style={labelStyle}>Card Price (chips)</label>
            <input style={inputStyle} type="number" min={1} value={form.cardPrice} onChange={set("cardPrice")} />
          </div>
          <div>
            <label style={labelStyle}>Max Cards per Player</label>
            <input style={inputStyle} type="number" min={1} max={50} value={form.maxCardsPerPlayer} onChange={set("maxCardsPerPlayer")} />
          </div>
          <div>
            <label style={labelStyle}>Prize Pool %</label>
            <input style={inputStyle} type="number" min={0} max={100} value={form.prizePoolPercent} onChange={set("prizePoolPercent")} />
          </div>
          <div>
            <label style={labelStyle}>House Cut %</label>
            <input style={inputStyle} type="number" min={0} max={100} value={form.houseCutPercent} onChange={set("houseCutPercent")} />
          </div>
          <div>
            <label style={labelStyle}>Winning Pattern</label>
            <select style={{ ...inputStyle, cursor: "pointer" }} value={form.winningPattern} onChange={set("winningPattern")}>
              <option value="single_line">Single Line (row, column, diagonal)</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
          Example: {fmt(40)} cards × {fmt(Number(form.cardPrice))} chips = {fmt(40 * Number(form.cardPrice))} collected → {fmt(Math.floor(40 * Number(form.cardPrice) * Number(form.prizePoolPercent) / 100))} prize pool, {fmt(Math.floor(40 * Number(form.cardPrice) * Number(form.houseCutPercent) / 100))} house
        </div>
        {settings?.updatedBy && (
          <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>Last updated by {settings.updatedBy}</div>
        )}
        <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: "10px 24px", borderRadius: 8, background: "rgba(251,191,36,0.8)", border: "none", color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {msg && <span style={{ fontSize: 13, color: msg.ok ? "#86efac" : "#fca5a5" }}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}

function StatsPanel() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    bankerApiFetch("/bingo/stats").then(r => r.json()).then(setStats).catch(() => {});
    const iv = setInterval(() => {
      bankerApiFetch("/bingo/stats").then(r => r.json()).then(setStats).catch(() => {});
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  if (!stats) return <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Loading stats...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px,1fr))", gap: 12 }}>
        {[
          { label: "Rounds Completed", value: fmt(stats.totalRounds), color: "#fff" },
          { label: "Total Collected", value: fmt(stats.totalCollected), color: "#fbbf24" },
          { label: "House Profit", value: fmt(stats.totalHouseProfit), color: "#f97316" },
          { label: "Total Prize Pool", value: fmt(stats.totalPrizePool), color: "#22c55e" },
          { label: "Cards Sold", value: fmt(stats.totalCardsSold), color: "#3b82f6" },
          { label: "Best Round", value: fmt(stats.bestRound), color: "#a855f7" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
            <div style={{ fontWeight: 700, fontSize: 18, color }}>{value}</div>
          </div>
        ))}
      </div>
      {stats.recentRounds?.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "18px 20px" }}>
          <div style={{ fontFamily: "Oswald,sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>Recent Rounds</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "rgba(255,255,255,0.4)", textAlign: "left" }}>
                  {["#","Status","Dealer","Cards","Collected","Prize Pool","House"].map(h => (
                    <th key={h} style={{ padding: "6px 10px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.recentRounds.map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "8px 10px", color: "rgba(255,255,255,0.5)" }}>{r.id}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: STATUS_COLORS[r.status] + "22", color: STATUS_COLORS[r.status], border: `1px solid ${STATUS_COLORS[r.status]}44` }}>
                        {STATUS_LABELS[r.status] || r.status}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "rgba(255,255,255,0.7)" }}>{r.dealerUsername || "—"}</td>
                    <td style={{ padding: "8px 10px", color: "#fff" }}>{r.totalCardsSold}</td>
                    <td style={{ padding: "8px 10px", color: "#fbbf24" }}>{fmt(r.totalCollected)}</td>
                    <td style={{ padding: "8px 10px", color: "#22c55e" }}>{fmt(r.prizePool)}</td>
                    <td style={{ padding: "8px 10px", color: "#f97316" }}>{fmt(r.houseProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function BingoTab({ hasRole }: { hasRole: (...roles: string[]) => boolean }) {
  type SubTab = "dealer" | "settings" | "stats";
  const canDealer = hasRole("owner", "banker", "dealer");
  const canSettings = hasRole("owner", "banker");
  const defaultSub: SubTab = canDealer ? "dealer" : "settings";
  const [subTab, setSubTab] = useState<SubTab>(defaultSub);

  const subTabs: { key: SubTab; label: string }[] = [
    ...(canDealer ? [{ key: "dealer" as SubTab, label: "Dealer Panel" }] : []),
    ...(canSettings ? [{ key: "settings" as SubTab, label: "Settings" }, { key: "stats" as SubTab, label: "Stats & History" }] : []),
  ];

  return (
    <div style={{ background: "#0d0d18", borderRadius: 12, padding: "20px 22px", minHeight: 200, color: "#fff" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 24, borderBottom: "1px solid rgba(255,255,255,0.12)", paddingBottom: 0 }}>
        {subTabs.map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key)}
            style={{ padding: "8px 18px", background: "none", border: "none", borderBottom: subTab === key ? "2px solid #fbbf24" : "2px solid transparent", color: subTab === key ? "#fbbf24" : "rgba(255,255,255,0.5)", fontWeight: subTab === key ? 700 : 400, fontSize: 14, cursor: "pointer", marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>
      {subTab === "dealer" && canDealer && <DealerPanel hasRole={hasRole} />}
      {subTab === "settings" && canSettings && <BankerSettingsPanel />}
      {subTab === "stats" && canSettings && <StatsPanel />}
    </div>
  );
}
