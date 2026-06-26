import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageWrapper } from "./shared";
import { useStore } from "../store";
import {
  ChevronDown, Trophy, Ticket, Coins, Users,
  Info, Clock, TrendingUp,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const fmt = (n: number) => n.toLocaleString();

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "NOW";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtDrawLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) +
    " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Draw {
  id: number; status: string; ticketCloseAt: string; drawTime: string;
  jackpot: number; consolation: number; totalTickets: number;
}
interface Settings {
  enabled: boolean; ticketCost: number; maxTicketsPerPlayer: number;
  numbersPerTicket: number; numberMin: number; numberMax: number;
}
interface LotteryTicket {
  id: number; draw_id: number; status: string; ticket_cost: number;
  purchased_at: string; result_tier: string | null;
}

/* ── Left card: Weekly Mega Draw ─────────────────────────────── */
function WeeklyMegaDraw({
  draw, settings, now, qty, setQty, onBuy, buying, buyMsg,
}: {
  draw: Draw | null; settings: Settings | null; now: number;
  qty: number; setQty: (q: number) => void;
  onBuy: () => void; buying: boolean; buyMsg: { text: string; ok: boolean } | null;
}) {
  const msToDraw = draw ? new Date(draw.drawTime).getTime() - now : 0;
  const msToClose = draw ? new Date(draw.ticketCloseAt).getTime() - now : 0;
  const salesOpen = draw?.status === "open" && msToClose > 0;
  const totalSlots = 1000;
  const pct = draw ? Math.min(100, (draw.totalTickets / totalSlots) * 100) : 0;

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{
        background: "linear-gradient(160deg,#0e0b06 0%,#0a0804 100%)",
        border: "1px solid rgba(245,197,24,0.2)",
        boxShadow: "0 0 40px rgba(245,197,24,0.04)",
      }}
    >
      {/* Header */}
      <div className="px-6 py-4 flex items-start justify-between"
        style={{ background: "rgba(245,197,24,0.05)", borderBottom: "1px solid rgba(245,197,24,0.12)" }}>
        <div>
          <h2 className="font-rajdhani font-black text-xl uppercase tracking-widest text-white mb-1">
            Weekly Mega Draw
          </h2>
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            {draw ? `Draw: ${fmtDrawLabel(draw.drawTime)}` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            LIVE
          </span>
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase"
            style={{ background: "#e8400a", color: "#fff" }}>
            FEATURED
          </span>
        </div>
      </div>

      <div className="px-6 py-5 flex flex-col gap-5 flex-1">
        {/* Jackpot hero */}
        <div className="rounded-xl py-5 text-center"
          style={{ background: "rgba(245,197,24,0.06)", border: "1px solid rgba(245,197,24,0.18)" }}>
          <p className="text-[10px] uppercase tracking-[0.22em] mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>Jackpot</p>
          <p className="font-black text-4xl leading-none mb-2"
            style={{ fontFamily: "'Orbitron','Rajdhani',sans-serif", color: "#f5c518", textShadow: "0 0 32px rgba(245,197,24,0.5)" }}>
            {draw ? `${fmt(draw.jackpot)} chips` : "—"}
          </p>
          <p className="text-xs font-bold flex items-center justify-center gap-1.5"
            style={{ color: "rgba(255,255,255,0.4)" }}>
            <Clock size={12} />
            {draw ? `Draw in ${fmtCountdown(msToDraw)}` : "Loading…"}
          </p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <Ticket size={18} />, label: "Tickets Sold", value: draw ? fmt(draw.totalTickets) : "—" },
            { icon: <Users size={18} />, label: "Total Tickets", value: fmt(totalSlots) },
          ].map(({ icon, label, value }) => (
            <div key={label} className="rounded-xl px-4 py-3 flex items-center gap-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ color: "#f5c518" }}>{icon}</span>
              <div>
                <p className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
                <p className="text-base font-black text-white">{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Sales progress</span>
            <span className="text-[10px] font-bold" style={{ color: "rgba(245,197,24,0.7)" }}>{pct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg,#f5c518,#e8a800)" }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
        </div>

        {/* Buy controls */}
        <div className="flex gap-3 items-center">
          <div className="flex items-center rounded-lg overflow-hidden shrink-0"
            style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
            <button
              className="w-9 h-10 font-bold text-white text-lg transition-colors hover:bg-white/10"
              onClick={() => setQty(Math.max(1, qty - 1))}
            >−</button>
            <span className="px-4 text-sm font-black text-white tabular-nums">{qty}</span>
            <button
              className="w-9 h-10 font-bold text-white text-lg transition-colors hover:bg-white/10"
              onClick={() => setQty(qty + 1)}
            >+</button>
          </div>
          <button
            onClick={onBuy}
            disabled={!salesOpen || buying || !settings}
            className="flex-1 py-2.5 rounded-lg text-sm font-black uppercase tracking-wider transition-all duration-150"
            style={{
              background: salesOpen ? "rgba(245,197,24,0.15)" : "rgba(255,255,255,0.04)",
              color: salesOpen ? "#f5c518" : "rgba(255,255,255,0.25)",
              border: `1px solid ${salesOpen ? "rgba(245,197,24,0.4)" : "rgba(255,255,255,0.08)"}`,
              cursor: salesOpen ? "pointer" : "not-allowed",
            }}
          >
            {buying ? "Buying…" : settings
              ? `Buy ${qty} Ticket${qty > 1 ? "s" : ""} · ${fmt(settings.ticketCost * qty)} chips`
              : "Loading…"}
          </button>
        </div>

        <AnimatePresence>
          {buyMsg && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="px-4 py-2.5 rounded-lg text-xs font-bold text-center"
              style={{
                background: buyMsg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                border: `1px solid ${buyMsg.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: buyMsg.ok ? "#22c55e" : "#f87171",
              }}
            >
              {buyMsg.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Right card: Your Tickets ─────────────────────────────────── */
function YourTickets({
  tickets, settings, loading,
}: {
  tickets: LotteryTicket[]; settings: Settings | null; loading: boolean;
}) {
  const [ticketsOpen, setTicketsOpen] = useState(true);

  const totalSpent = tickets.reduce((s, t) => s + (Number(t.ticket_cost) || 0), 0);
  const totalEntries = tickets.length;

  function statusBadge(t: LotteryTicket) {
    const tier = t.result_tier;
    if (tier === "jackpot") return { label: "WINNER", bg: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "rgba(251,191,36,0.3)" };
    if (tier === "consolation") return { label: "WIN", bg: "rgba(34,197,94,0.15)", color: "#22c55e", border: "rgba(34,197,94,0.3)" };
    if (tier === "no_win") return { label: "DRAWN", bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "rgba(255,255,255,0.1)" };
    if (t.status === "submitted" || t.status === "draft") return { label: "ACTIVE", bg: "rgba(34,197,94,0.1)", color: "#22c55e", border: "rgba(34,197,94,0.25)" };
    return { label: t.status.toUpperCase(), bg: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)", border: "rgba(255,255,255,0.1)" };
  }

  return (
    <div className="flex flex-col gap-3">
      {/* YOUR TICKETS accordion */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(160deg,#0e0b06 0%,#0a0804 100%)",
          border: "1px solid rgba(245,197,24,0.15)",
        }}
      >
        <button
          className="w-full px-6 py-4 flex items-center justify-between transition-colors hover:bg-white/[0.02]"
          style={{ borderBottom: ticketsOpen ? "1px solid rgba(245,197,24,0.1)" : "none" }}
          onClick={() => setTicketsOpen(o => !o)}
        >
          <span className="font-rajdhani font-black text-base uppercase tracking-widest text-white">Your Tickets</span>
          <motion.span animate={{ rotate: ticketsOpen ? 0 : -90 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {ticketsOpen && (
            <motion.div
              key="tickets-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
            >
              <div className="px-6 py-5 flex flex-col gap-5">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: <Ticket size={20} />, label: "Your Tickets", value: tickets.length },
                    { icon: <Coins size={20} />, label: "Total Spent", value: fmt(totalSpent) },
                    { icon: <Users size={20} />, label: "Total Entries", value: totalEntries },
                  ].map(({ icon, label, value }) => (
                    <div key={label} className="rounded-xl px-3 py-3 flex flex-col items-center gap-1.5 text-center"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <span style={{ color: "#f5c518" }}>{icon}</span>
                      <p className="text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.3)" }}>{label}</p>
                      <p className="text-lg font-black text-white leading-none">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Ticket table */}
                {loading ? (
                  <div className="text-center py-6" style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>Loading tickets…</div>
                ) : tickets.length === 0 ? (
                  <div className="text-center py-8 flex flex-col items-center gap-2">
                    <Ticket size={28} style={{ color: "rgba(255,255,255,0.12)" }} />
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No tickets yet for this draw</p>
                  </div>
                ) : (
                  <div>
                    {/* Table header */}
                    <div className="grid grid-cols-4 gap-2 px-3 pb-2 mb-1"
                      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {["Ticket #", "Entries", "Purchased", "Status"].map(h => (
                        <span key={h} className="text-[9px] uppercase tracking-wider font-bold"
                          style={{ color: "rgba(255,255,255,0.3)" }}>{h}</span>
                      ))}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {tickets.map(t => {
                        const badge = statusBadge(t);
                        return (
                          <div key={t.id}
                            className="grid grid-cols-4 gap-2 px-3 py-2.5 rounded-lg items-center transition-colors hover:bg-white/[0.03]"
                            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <span className="text-xs font-bold tabular-nums" style={{ color: "rgba(255,255,255,0.65)" }}>
                              #{String(1000000 + t.id).slice(1)}
                            </span>
                            <span className="text-xs font-semibold text-white">1</span>
                            <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                              {fmtShortDate(t.purchased_at)}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase inline-flex items-center gap-1 w-fit"
                              style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}` }}>
                              <span style={{ width: 4, height: 4, borderRadius: "50%", background: badge.color, display: "inline-block" }} />
                              {badge.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Info panel */}
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <Info size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0, marginTop: 1 }} />
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                    Each ticket gives you one entry into the current draw.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export function LotteryPage() {
  const { sessionToken } = useStore();
  const [draw, setDraw] = useState<Draw | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tickets, setTickets] = useState<LotteryTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [qty, setQty] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyMsg, setBuyMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const apiFetch = (path: string, opts?: RequestInit) =>
    fetch(`${BASE}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        ...(opts?.headers ?? {}),
      },
    });

  async function pollDraw() {
    try {
      const r = await fetch(`${BASE}/api/lottery/active`);
      const d = await r.json();
      if (d.draw) setDraw(d.draw);
      if (d.settings) setSettings(d.settings);
    } catch {}
  }

  async function loadTickets() {
    if (!sessionToken) return;
    setTicketsLoading(true);
    try {
      const r = await apiFetch("/lottery/my-tickets");
      const d = await r.json();
      if (Array.isArray(d)) setTickets(d);
    } catch {}
    finally { setTicketsLoading(false); }
  }

  useEffect(() => {
    pollDraw();
    loadTickets();
    const drawIv = setInterval(pollDraw, 30000);
    const tktIv = setInterval(loadTickets, 15000);
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(drawIv);
      clearInterval(tktIv);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionToken]);

  async function handleBuy() {
    if (!settings || buying) return;
    setBuying(true);
    setBuyMsg(null);
    try {
      const r = await apiFetch("/lottery/buy", { method: "POST", body: JSON.stringify({ quantity: qty }) });
      const d = await r.json();
      if (!r.ok) {
        setBuyMsg({ text: d.error || "Purchase failed", ok: false });
      } else {
        setBuyMsg({ text: `Bought ${d.qty} ticket${d.qty > 1 ? "s" : ""} — ${fmt(d.totalCost)} chips spent`, ok: true });
        await Promise.all([pollDraw(), loadTickets()]);
        setTimeout(() => setBuyMsg(null), 4000);
      }
    } catch {
      setBuyMsg({ text: "Network error — try again", ok: false });
    } finally {
      setBuying(false);
    }
  }

  return (
    <PageWrapper title="Lottery" breadcrumb="Events / Lottery" accentColor="#f5c518">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 24,
          maxWidth: 1100,
          margin: "0 auto",
          width: "100%",
          alignItems: "start",
        }}
      >
        <WeeklyMegaDraw
          draw={draw} settings={settings} now={now}
          qty={qty} setQty={setQty}
          onBuy={handleBuy} buying={buying} buyMsg={buyMsg}
        />
        <YourTickets tickets={tickets} settings={settings} loading={ticketsLoading} />
      </div>
    </PageWrapper>
  );
}
