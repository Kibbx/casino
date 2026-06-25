import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { usePageTracker } from "../lib/usePageTracker";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { fmtETDateTimeFull } from "../utils/timezone";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (n: number) => n.toLocaleString();

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "NOW";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtDate(iso: string): string {
  return fmtETDateTimeFull(iso);
}

interface LotteryDraw {
  id: number; status: string; ticketCloseAt: string; drawTime: string;
  jackpot: number; consolation: number; totalTickets: number;
}
interface LotterySettings {
  enabled: boolean; ticketCost: number; maxTicketsPerPlayer: number;
  numbersPerTicket: number; numberMin: number; numberMax: number;
}
interface LotteryTicket {
  id: number; draw_id: number; player_id: number; numbers: string;
  status: string; ticket_cost: number; purchased_at: string;
  submitted_at: string | null; matched_count: number | null;
  result_tier: string | null; payout_amount: number;
}
interface HistoryDraw {
  id: number; drawTime: string; winningNumbers: number[];
  jackpot: number; consolation: number;
  jackpotRolledOver: boolean; consolationRolledIntoJackpot: boolean;
  myTickets: LotteryTicket[];
}

function ballColor(n: number, min: number, max: number): { bg: string; border: string; text: string } {
  const range = max - min || 1;
  const pct = (n - min) / range;
  if (pct < 0.2) return { bg: "rgba(251,191,36,0.25)", border: "#fbbf24", text: "#fbbf24" };
  if (pct < 0.4) return { bg: "rgba(249,115,22,0.25)", border: "#f97316", text: "#fb923c" };
  if (pct < 0.6) return { bg: "rgba(239,68,68,0.25)", border: "#ef4444", text: "#fca5a5" };
  if (pct < 0.8) return { bg: "rgba(139,92,246,0.25)", border: "#8b5cf6", text: "#c4b5fd" };
  return { bg: "rgba(34,211,238,0.2)", border: "#22d3ee", text: "#67e8f9" };
}

function LotteryBall({ n, size = 42, min = 1, max = 20, selected = false, dim = false, onClick }: {
  n: number; size?: number; min?: number; max?: number;
  selected?: boolean; dim?: boolean; onClick?: () => void;
}) {
  const c = ballColor(n, min, max);
  const fs = size < 36 ? 11 : size < 44 ? 14 : 16;
  return (
    <div onClick={onClick} style={{
      width: size, height: size, borderRadius: "50%",
      background: selected ? c.border : c.bg,
      border: `2px solid ${c.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: selected ? "#000" : c.text,
      fontWeight: 900, fontSize: fs,
      cursor: onClick ? "pointer" : "default",
      opacity: dim ? 0.3 : 1,
      boxShadow: selected ? `0 0 12px ${c.border}88` : `0 0 6px ${c.border}33`,
      transition: "all 0.15s",
      userSelect: "none",
      flexShrink: 0,
    }}>
      {n}
    </div>
  );
}

function EmptyBall({ size = 42 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "rgba(255,255,255,0.03)",
      border: "2px dashed rgba(255,255,255,0.15)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "rgba(255,255,255,0.15)", fontSize: size < 36 ? 14 : 18,
      flexShrink: 0,
    }}>
      ?
    </div>
  );
}

function TicketCard({
  ticket, numbersPerTicket, numberMin, numberMax, salesOpen,
  onSetNumbers, onSubmit, onQuickPick,
}: {
  ticket: LotteryTicket; numbersPerTicket: number; numberMin: number; numberMax: number;
  salesOpen: boolean; onSetNumbers: (id: number, nums: number[]) => void;
  onSubmit: (id: number) => void; onQuickPick: (id: number) => void;
}) {
  const nums: number[] = JSON.parse(ticket.numbers || "[]");
  const isDraft = ticket.status === "draft";
  const isSubmitted = ticket.status === "submitted";
  const tier = ticket.result_tier;

  const allRange: number[] = [];
  for (let i = numberMin; i <= numberMax; i++) allRange.push(i);

  function toggleNum(n: number) {
    if (!isDraft || !salesOpen) return;
    const current = [...nums];
    const idx = current.indexOf(n);
    if (idx >= 0) { current.splice(idx, 1); }
    else if (current.length < numbersPerTicket) { current.push(n); }
    onSetNumbers(ticket.id, current);
  }

  const isWin = tier === "jackpot" || tier === "consolation";
  const borderColor = tier === "jackpot" ? "#fbbf24" : tier === "consolation" ? "#22c55e" : isDraft ? "#6366f1" : isSubmitted ? "#3b82f6" : "#374151";

  return (
    <div style={{
      background: "linear-gradient(160deg, #0e0e1c 0%, #08080f 100%)",
      border: `1px solid ${borderColor}55`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: isWin ? `0 0 24px ${borderColor}33` : "none",
    }}>
      {/* Ticket header strip */}
      <div style={{
        background: `linear-gradient(90deg, ${borderColor}22 0%, transparent 100%)`,
        borderBottom: `1px solid ${borderColor}33`,
        padding: "8px 14px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", letterSpacing: "0.08em" }}>
          TKT-{String(ticket.id).padStart(6, "0")}
        </span>
        <span style={{
          padding: "2px 10px", borderRadius: 20,
          background: borderColor + "22", border: `1px solid ${borderColor}55`,
          color: borderColor, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
        }}>
          {tier === "jackpot" ? "JACKPOT" : tier === "consolation" ? "WIN" : tier === "no_win" ? "NO MATCH" : tier === "void" ? "VOID" : isDraft ? "DRAFT" : "LOCKED IN"}
        </span>
      </div>

      <div style={{ padding: "14px" }}>
        {/* Win banners */}
        {tier === "jackpot" && (
          <div style={{ textAlign: "center", marginBottom: 12, padding: "10px", background: "rgba(251,191,36,0.08)", borderRadius: 10, border: "1px solid rgba(251,191,36,0.2)" }}>
            <div style={{ color: "#fbbf24", fontWeight: 900, fontSize: 20, letterSpacing: "0.12em" }}>JACKPOT!</div>
            <div style={{ color: "#fbbf24", fontSize: 14, marginTop: 3, fontWeight: 700 }}>+{fmt(ticket.payout_amount)} chips</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 2 }}>{ticket.matched_count}/{numbersPerTicket} matched</div>
          </div>
        )}
        {tier === "consolation" && (
          <div style={{ textAlign: "center", marginBottom: 12, padding: "10px", background: "rgba(34,197,94,0.06)", borderRadius: 10, border: "1px solid rgba(34,197,94,0.2)" }}>
            <div style={{ color: "#22c55e", fontWeight: 900, fontSize: 18, letterSpacing: "0.08em" }}>WINNER!</div>
            <div style={{ color: "#22c55e", fontSize: 14, marginTop: 3, fontWeight: 700 }}>+{fmt(ticket.payout_amount)} chips</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginTop: 2 }}>{ticket.matched_count}/{numbersPerTicket} matched</div>
          </div>
        )}
        {tier === "no_win" && (
          <div style={{ textAlign: "center", marginBottom: 10, padding: "6px", color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
            {ticket.matched_count}/{numbersPerTicket} matched · no prize
          </div>
        )}
        {(ticket.status === "void" || tier === "void") && (
          <div style={{ textAlign: "center", marginBottom: 10, padding: "6px", color: "rgba(255,255,255,0.2)", fontSize: 11 }}>
            Void — not submitted before draw
          </div>
        )}

        {/* Picked numbers row */}
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12, minHeight: 44, alignItems: "center" }}>
          {nums.sort((a, b) => a - b).map(n => (
            <LotteryBall key={n} n={n} min={numberMin} max={numberMax} selected
              onClick={() => toggleNum(n)} />
          ))}
          {isDraft && Array.from({ length: numbersPerTicket - nums.length }).map((_, i) => (
            <EmptyBall key={i} />
          ))}
        </div>

        {/* Number picker */}
        {isDraft && salesOpen && (
          <>
            <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "0 0 12px" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {allRange.map(n => {
                const sel = nums.includes(n);
                const full = nums.length >= numbersPerTicket && !sel;
                return (
                  <LotteryBall key={n} n={n} size={36} min={numberMin} max={numberMax}
                    selected={sel} dim={full} onClick={() => toggleNum(n)} />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <button onClick={() => onQuickPick(ticket.id)} style={{
                padding: "7px 13px", borderRadius: 7,
                background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.4)",
                color: "#a5b4fc", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.05em",
              }}>
                QUICK PICK
              </button>
              {nums.length > 0 && (
                <button onClick={() => onSetNumbers(ticket.id, [])} style={{
                  padding: "7px 13px", borderRadius: 7,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                  color: "#fca5a5", fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}>
                  CLEAR
                </button>
              )}
              {nums.length === numbersPerTicket && (
                <button onClick={() => onSubmit(ticket.id)} style={{
                  flex: 1, padding: "7px 13px", borderRadius: 7,
                  background: "rgba(34,197,94,0.6)", border: "1px solid rgba(34,197,94,0.5)",
                  color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em",
                }}>
                  LOCK IN TICKET
                </button>
              )}
            </div>
          </>
        )}

        {isSubmitted && !tier && (
          <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.25)", textAlign: "center", letterSpacing: "0.06em" }}>
            LOCKED · AWAITING DRAW
          </div>
        )}
      </div>
    </div>
  );
}

function CountdownBox({ label, value, urgent }: { label: string; value: string; urgent?: boolean }) {
  return (
    <div style={{ textAlign: "center", minWidth: 80 }}>
      <div style={{
        background: urgent ? "rgba(239,68,68,0.12)" : "rgba(0,0,0,0.4)",
        border: `1px solid ${urgent ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 10, padding: "8px 14px", marginBottom: 5,
      }}>
        <div style={{ fontSize: 22, fontWeight: 900, color: urgent ? "#ef4444" : "#fbbf24", fontFamily: "monospace", letterSpacing: "0.05em" }}>
          {value}
        </div>
      </div>
      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

export default function LotteryPage() {
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  usePageTracker("lottery", sessionToken);
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken, () => setLocation("/lobby"));
  const { data: player } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const chips = liveChips ?? player?.chips ?? 0;

  if (!sessionToken) { setLocation("/login"); return null; }

  const [draw, setDraw] = useState<LotteryDraw | null>(null);
  const [settings, setSettings] = useState<LotterySettings | null>(null);
  const [myTickets, setMyTickets] = useState<LotteryTicket[]>([]);
  const [history, setHistory] = useState<HistoryDraw[]>([]);
  const [buyQty, setBuyQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showHistory, setShowHistory] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiFetch = useCallback(async (path: string, opts?: RequestInit) => {
    return fetch(`${BASE}/api${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}`, ...(opts?.headers ?? {}) },
    });
  }, [sessionToken]);

  const pollActive = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/lottery/active`);
      const d = await r.json();
      setDraw(d.draw ?? null);
      if (d.settings) setSettings(d.settings);
    } catch {}
  }, []);

  const loadMyTickets = useCallback(async () => {
    try {
      const r = await apiFetch("/lottery/my-tickets");
      const d = await r.json();
      if (Array.isArray(d)) setMyTickets(d);
    } catch {}
  }, [apiFetch]);

  const loadHistory = useCallback(async () => {
    try {
      const r = await apiFetch("/lottery/history");
      const d = await r.json();
      if (Array.isArray(d)) setHistory(d);
    } catch {}
  }, [apiFetch]);

  useEffect(() => {
    pollActive();
    loadMyTickets();
    const iv = setInterval(() => { pollActive(); loadMyTickets(); }, 5000);
    tickerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(iv); if (tickerRef.current) clearInterval(tickerRef.current); };
  }, [pollActive, loadMyTickets]);

  const salesOpen = draw?.status === "open" && new Date(draw.ticketCloseAt) > new Date(now);
  const drawTime = draw ? new Date(draw.drawTime) : null;
  const closeTime = draw ? new Date(draw.ticketCloseAt) : null;
  const msToClose = closeTime ? closeTime.getTime() - now : 0;
  const msToDraw = drawTime ? drawTime.getTime() - now : 0;

  async function handleBuy() {
    if (!salesOpen || buying) return;
    setBuying(true); setBuyMsg(null);
    try {
      const r = await apiFetch("/lottery/buy", { method: "POST", body: JSON.stringify({ quantity: buyQty }) });
      const d = await r.json();
      if (!r.ok) { setBuyMsg({ text: d.error || "Failed", ok: false }); return; }
      setBuyMsg({ text: `Bought ${d.qty} ticket${d.qty > 1 ? "s" : ""} — ${fmt(d.totalCost)} chips spent`, ok: true });
      await Promise.all([pollActive(), loadMyTickets()]);
    } catch { setBuyMsg({ text: "Network error", ok: false }); }
    finally { setBuying(false); }
  }

  async function handleSetNumbers(ticketId: number, nums: number[]) {
    try {
      await apiFetch(`/lottery/tickets/${ticketId}/numbers`, { method: "PUT", body: JSON.stringify({ numbers: nums }) });
      setMyTickets(prev => prev.map(t => t.id === ticketId ? { ...t, numbers: JSON.stringify(nums) } : t));
    } catch {}
  }

  async function handleSubmit(ticketId: number) {
    setSubmitting(true);
    try {
      const r = await apiFetch(`/lottery/tickets/${ticketId}/submit`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setSubmitMsg({ text: d.error || "Failed", ok: false }); }
      else { setSubmitMsg({ text: "Ticket locked in!", ok: true }); await loadMyTickets(); }
    } catch { setSubmitMsg({ text: "Network error", ok: false }); }
    finally { setSubmitting(false); }
  }

  async function handleSubmitAll() {
    setSubmitting(true);
    try {
      const r = await apiFetch("/lottery/tickets/submit-all", { method: "POST" });
      const d = await r.json();
      if (!r.ok) { setSubmitMsg({ text: d.error || "Failed", ok: false }); }
      else {
        setSubmitMsg({ text: `${d.submitted} ticket${d.submitted !== 1 ? "s" : ""} locked in${d.invalid > 0 ? ` · ${d.invalid} incomplete skipped` : ""}`, ok: true });
        await loadMyTickets();
      }
    } catch { setSubmitMsg({ text: "Network error", ok: false }); }
    finally { setSubmitting(false); }
  }

  function handleQuickPick(ticketId: number) {
    if (!settings) return;
    const pool: number[] = [];
    for (let i = settings.numberMin; i <= settings.numberMax; i++) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    handleSetNumbers(ticketId, pool.slice(0, settings.numbersPerTicket));
  }

  async function handleFillAllRandom() {
    if (!settings) return;
    for (const t of myTickets.filter(t => t.status === "draft")) { await handleQuickPick(t.id); }
  }

  const draftTickets = myTickets.filter(t => t.status === "draft");
  const submittedTickets = myTickets.filter(t => t.status === "submitted");
  const maxBuy = settings ? Math.max(0, settings.maxTicketsPerPlayer - myTickets.length) : 0;
  const hasFullDrafts = draftTickets.some(t => JSON.parse(t.numbers || "[]").length === (settings?.numbersPerTicket ?? 4));

  const urgent = msToClose > 0 && msToClose < 3600000;

  return (
    <div style={{ minHeight: "100vh", background: "#060610", color: "#fff", fontFamily: "Georgia, serif" }}>

      {/* ── Top bar ── */}
      <div style={{
        background: "rgba(6,6,16,0.95)",
        borderBottom: "1px solid rgba(251,191,36,0.15)",
        padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <button onClick={() => setLocation("/lobby")} style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8, padding: "6px 14px", color: "rgba(255,255,255,0.6)",
          fontSize: 12, cursor: "pointer", fontFamily: "Georgia, serif",
        }}>← Back</button>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.25em", color: "rgba(251,191,36,0.5)", textTransform: "uppercase", marginBottom: 1 }}>Back Alley Bets</div>
          <div style={{ fontWeight: 900, fontSize: 22, letterSpacing: "0.18em", textTransform: "uppercase", color: "#fbbf24", lineHeight: 1 }}>LOTTERY</div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em" }}>BALANCE</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#fbbf24" }}>{fmt(chips)}</div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px" }}>

        {/* ── No draw ── */}
        {!draw && (
          <div style={{
            background: "#0a0a18", border: "1px solid #1a1a2e",
            borderRadius: 16, padding: "48px 24px", textAlign: "center",
          }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>🎰</div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>No Active Draw</div>
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, marginTop: 8 }}>A new Sunday draw will open shortly.</div>
          </div>
        )}

        {settings && !settings.enabled && (
          <div style={{
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 10, padding: "10px 16px", marginBottom: 12,
            color: "#fca5a5", fontSize: 13, textAlign: "center",
          }}>
            Lottery is currently suspended by management.
          </div>
        )}

        {draw && settings && (
          <>
            {/* ── Jackpot hero ── */}
            <div style={{
              background: "linear-gradient(135deg, #120800 0%, #1e1000 50%, #120800 100%)",
              border: "1px solid rgba(251,191,36,0.3)",
              borderRadius: 18, padding: "28px 24px 22px",
              marginBottom: 14, textAlign: "center",
              boxShadow: "0 0 40px rgba(251,191,36,0.08)",
              position: "relative", overflow: "hidden",
            }}>
              {/* corner decorations */}
              <div style={{ position: "absolute", top: 10, left: 14, fontSize: 16, color: "rgba(251,191,36,0.2)" }}>✦</div>
              <div style={{ position: "absolute", top: 10, right: 14, fontSize: 16, color: "rgba(251,191,36,0.2)" }}>✦</div>
              <div style={{ position: "absolute", bottom: 10, left: 14, fontSize: 10, color: "rgba(251,191,36,0.15)" }}>✦</div>
              <div style={{ position: "absolute", bottom: 10, right: 14, fontSize: 10, color: "rgba(251,191,36,0.15)" }}>✦</div>

              <div style={{ fontSize: 10, color: "rgba(251,191,36,0.6)", letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 8 }}>
                Rolling Jackpot · Draw #{draw.id}
              </div>
              <div style={{ fontWeight: 900, fontSize: 48, color: "#fbbf24", letterSpacing: "0.04em", lineHeight: 1, marginBottom: 4 }}>
                {fmt(draw.jackpot)}
              </div>
              <div style={{ fontSize: 13, color: "rgba(251,191,36,0.5)", letterSpacing: "0.15em", marginBottom: 20 }}>CHIPS</div>

              <div style={{ display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 4 }}>CONSOLATION POOL</div>
                  <div style={{ color: "#22c55e", fontWeight: 700, fontSize: 17 }}>{fmt(draw.consolation)}</div>
                </div>
                <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 4 }}>TICKET PRICE</div>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{fmt(settings.ticketCost)}</div>
                </div>
                <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
                <div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", marginBottom: 4 }}>TICKETS SOLD</div>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 17 }}>{draw.totalTickets}</div>
                </div>
              </div>
            </div>

            {/* ── Countdown + status ── */}
            <div style={{
              background: "#0a0a18", border: "1px solid #1a1a2e",
              borderRadius: 14, padding: "16px 20px", marginBottom: 14,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 4 }}>Draw Date</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", fontWeight: 700 }}>{fmtDate(draw.drawTime)}</div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  {msToClose > 0 && salesOpen && (
                    <CountdownBox label="Sales Close" value={fmtCountdown(msToClose)} urgent={urgent} />
                  )}
                  <CountdownBox label="Draw In" value={fmtCountdown(msToDraw)} urgent={msToDraw < 3600000 && msToDraw > 0} />
                  <div style={{ textAlign: "center", minWidth: 80 }}>
                    <div style={{
                      background: draw.status === "open" ? "rgba(34,197,94,0.12)" : "rgba(249,115,22,0.12)",
                      border: `1px solid ${draw.status === "open" ? "rgba(34,197,94,0.4)" : "rgba(249,115,22,0.4)"}`,
                      borderRadius: 10, padding: "8px 14px", marginBottom: 5,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 900, color: draw.status === "open" ? "#22c55e" : "#f97316", letterSpacing: "0.06em" }}>
                        {draw.status === "open" ? "OPEN" : draw.status === "sales_closed" ? "CLOSED" : draw.status === "drawing" ? "LIVE" : draw.status.toUpperCase()}
                      </div>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Status</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Buy tickets ── */}
            {salesOpen && settings.enabled && maxBuy > 0 && (
              <div style={{
                background: "linear-gradient(135deg, rgba(251,191,36,0.04) 0%, rgba(0,0,0,0) 100%)",
                border: "1px solid rgba(251,191,36,0.2)",
                borderRadius: 14, padding: "20px", marginBottom: 14,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24" }}>Buy Tickets</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                    {myTickets.length}/{settings.maxTicketsPerPlayer} tickets · {maxBuy} remaining · pick {settings.numbersPerTicket} from 1–{settings.numberMax}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
                  {[1, 5, 10].filter(n => n <= maxBuy).map(n => (
                    <button key={n} onClick={() => setBuyQty(n)} style={{
                      padding: "10px 20px", borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: "pointer",
                      background: buyQty === n ? "#fbbf24" : "rgba(251,191,36,0.1)",
                      border: buyQty === n ? "none" : "1px solid rgba(251,191,36,0.25)",
                      color: buyQty === n ? "#000" : "#fbbf24",
                      letterSpacing: "0.06em",
                    }}>
                      {n}×
                    </button>
                  ))}
                  <input type="number" min={1} max={maxBuy} value={buyQty}
                    onChange={e => setBuyQty(Math.max(1, Math.min(maxBuy, parseInt(e.target.value) || 1)))}
                    style={{
                      width: 64, padding: "9px", borderRadius: 8,
                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "#fff", fontSize: 14, textAlign: "center", outline: "none", fontFamily: "monospace",
                    }} />
                  <button onClick={handleBuy} disabled={buying || buyQty < 1} style={{
                    padding: "10px 24px", borderRadius: 9,
                    background: buying ? "rgba(251,191,36,0.4)" : "#fbbf24",
                    border: "none", color: "#000", fontWeight: 900, fontSize: 13,
                    cursor: buying ? "default" : "pointer", letterSpacing: "0.08em",
                  }}>
                    {buying ? "BUYING..." : `BUY ${buyQty} — ${fmt(settings.ticketCost * buyQty)} CHIPS`}
                  </button>
                </div>

                {buyMsg && (
                  <div style={{
                    padding: "8px 14px", borderRadius: 8,
                    background: buyMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                    border: `1px solid ${buyMsg.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                    color: buyMsg.ok ? "#86efac" : "#fca5a5", fontSize: 12,
                  }}>
                    {buyMsg.text}
                  </div>
                )}
              </div>
            )}

            {salesOpen && maxBuy === 0 && (
              <div style={{
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 10, padding: "12px", marginBottom: 14,
                textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 12,
              }}>
                Max tickets reached ({settings.maxTicketsPerPlayer}) for this draw
              </div>
            )}

            {/* ── Draft tickets ── */}
            {draftTickets.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 3, height: 16, background: "#6366f1", borderRadius: 2 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#a5b4fc" }}>
                      Draft Tickets ({draftTickets.length})
                    </span>
                  </div>
                  {salesOpen && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={handleFillAllRandom} style={{
                        padding: "6px 14px", borderRadius: 7,
                        background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.35)",
                        color: "#a5b4fc", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em",
                      }}>
                        FILL ALL RANDOM
                      </button>
                      {hasFullDrafts && (
                        <button onClick={handleSubmitAll} disabled={submitting} style={{
                          padding: "6px 14px", borderRadius: 7,
                          background: "rgba(34,197,94,0.5)", border: "1px solid rgba(34,197,94,0.4)",
                          color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer", letterSpacing: "0.06em",
                        }}>
                          LOCK ALL IN
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {submitMsg && (
                  <div style={{
                    marginBottom: 10, padding: "8px 14px", borderRadius: 8,
                    background: submitMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                    border: `1px solid ${submitMsg.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                    color: submitMsg.ok ? "#86efac" : "#fca5a5", fontSize: 12,
                  }}>
                    {submitMsg.text}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 12 }}>
                  {draftTickets.map(t => (
                    <TicketCard key={t.id} ticket={t} numbersPerTicket={settings.numbersPerTicket}
                      numberMin={settings.numberMin} numberMax={settings.numberMax}
                      salesOpen={salesOpen}
                      onSetNumbers={handleSetNumbers} onSubmit={handleSubmit} onQuickPick={handleQuickPick} />
                  ))}
                </div>

                {!salesOpen && draftTickets.length > 0 && (
                  <div style={{
                    marginTop: 10, padding: "8px 14px", borderRadius: 8,
                    background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
                    color: "#fca5a5", fontSize: 12, textAlign: "center",
                  }}>
                    Sales closed — these drafts will be voided and cannot win.
                  </div>
                )}
              </div>
            )}

            {/* ── Submitted tickets ── */}
            {submittedTickets.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 3, height: 16, background: "#3b82f6", borderRadius: 2 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#60a5fa" }}>
                    Locked In ({submittedTickets.length})
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))", gap: 10 }}>
                  {submittedTickets.map(t => (
                    <TicketCard key={t.id} ticket={t} numbersPerTicket={settings.numbersPerTicket}
                      numberMin={settings.numberMin} numberMax={settings.numberMax}
                      salesOpen={false}
                      onSetNumbers={() => {}} onSubmit={() => {}} onQuickPick={() => {}} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── History ── */}
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => { setShowHistory(h => !h); if (!showHistory) loadHistory(); }} style={{
            width: "100%", padding: "12px", borderRadius: 10,
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: 700,
            cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            {showHistory ? "▲ Hide" : "▼ View"} Previous Results
          </button>

          {showHistory && (
            <div style={{ marginTop: 10 }}>
              {history.length === 0 ? (
                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13, padding: 24 }}>No completed draws yet.</div>
              ) : history.map(d => (
                <div key={d.id} style={{
                  background: "#0a0a18", border: "1px solid #1a1a2e",
                  borderRadius: 12, padding: "14px 16px", marginBottom: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 700, letterSpacing: "0.06em" }}>
                      DRAW #{d.id} · {fmtDate(d.drawTime)}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {d.jackpotRolledOver && (
                        <span style={{ padding: "2px 8px", borderRadius: 12, background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>JACKPOT ROLLED OVER</span>
                      )}
                      {d.consolationRolledIntoJackpot && (
                        <span style={{ padding: "2px 8px", borderRadius: 12, background: "rgba(139,92,246,0.12)", color: "#c4b5fd", fontSize: 9, fontWeight: 700, letterSpacing: "0.06em" }}>CONSOLATION → JACKPOT</span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>Winning Numbers</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {d.winningNumbers.map(n => (
                        <LotteryBall key={n} n={n} size={38} min={settings?.numberMin ?? 1} max={settings?.numberMax ?? 20} selected />
                      ))}
                    </div>
                  </div>

                  {d.myTickets.length > 0 && (
                    <div>
                      <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Your Tickets</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {d.myTickets.map(t => {
                          const nums: number[] = JSON.parse(t.numbers || "[]").sort((a: number, b: number) => a - b);
                          const tier = t.result_tier || t.status;
                          const tColor = tier === "jackpot" ? "#fbbf24" : tier === "consolation" ? "#22c55e" : "#374151";
                          const tLabel = tier === "jackpot" ? "JACKPOT" : tier === "consolation" ? "WIN" : tier === "no_win" ? "NO MATCH" : tier === "void" ? "VOID" : tier.toUpperCase();
                          return (
                            <div key={t.id} style={{
                              background: tColor + "0d", border: `1px solid ${tColor}30`,
                              borderRadius: 10, padding: "10px 12px", minWidth: 130,
                            }}>
                              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                                {nums.map(n => (
                                  <div key={n} style={{
                                    width: 28, height: 28, borderRadius: "50%",
                                    background: d.winningNumbers.includes(n) ? "rgba(251,191,36,0.25)" : "rgba(255,255,255,0.05)",
                                    border: `2px solid ${d.winningNumbers.includes(n) ? "#fbbf24" : "rgba(255,255,255,0.1)"}`,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    fontSize: 10, fontWeight: 700,
                                    color: d.winningNumbers.includes(n) ? "#fbbf24" : "rgba(255,255,255,0.3)",
                                  }}>{n}</div>
                                ))}
                              </div>
                              <div style={{ color: tColor || "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em" }}>
                                {tLabel}{Number(t.payout_amount) > 0 ? ` +${fmt(Number(t.payout_amount))}` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Rules ── */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setShowRules(r => !r)} style={{
            width: "100%", padding: "12px", borderRadius: 10,
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.3)", fontSize: 11, fontWeight: 700,
            cursor: "pointer", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            {showRules ? "▲ Hide" : "▼ How It Works"}
          </button>
          {showRules && (
            <div style={{
              marginTop: 8, background: "#0a0a18", border: "1px solid #1a1a2e",
              borderRadius: 10, padding: "16px 20px",
              color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 2,
            }}>
              {[
                `Buy tickets for this Sunday's draw.`,
                `Pick ${settings?.numbersPerTicket ?? 4} numbers from ${settings?.numberMin ?? 1}–${settings?.numberMax ?? 20}.`,
                `Match all ${settings?.numbersPerTicket ?? 4} to win the rolling jackpot.`,
                `Match ${(settings?.numbersPerTicket ?? 4) - 1} to split this week's consolation pool.`,
                `${(settings?.numbersPerTicket ?? 4) - 2} or fewer matches wins nothing.`,
                `Unsubmitted draft tickets are voided at draw time.`,
                `The jackpot rolls over each week until someone hits the full match.`,
              ].map((line, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span style={{ color: "rgba(251,191,36,0.4)", fontSize: 10 }}>✦</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
