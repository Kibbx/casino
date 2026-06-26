import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageWrapper } from "./shared";
import { useStore } from "../store";
import {
  ChevronDown, ChevronLeft, ChevronRight,
  Trophy, Ticket, Coins, Users,
  Info, Clock, TrendingUp, Calendar, Award,
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
  purchased_at: string; result_tier: string | null; numbers: string;
}

/* ── Left card: Weekly Mega Draw ─────────────────────────────── */
function WeeklyMegaDraw({
  draw, settings, now, onOpenPicker, pickerOpen,
}: {
  draw: Draw | null; settings: Settings | null; now: number;
  onOpenPicker: () => void; pickerOpen: boolean;
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

        {/* Buy button */}
        <button
          onClick={onOpenPicker}
          disabled={!salesOpen}
          className="w-full py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all duration-150"
          style={{
            background: pickerOpen ? "rgba(139,92,246,0.2)" : salesOpen ? "rgba(245,197,24,0.12)" : "rgba(255,255,255,0.04)",
            color: pickerOpen ? "#a78bfa" : salesOpen ? "#f5c518" : "rgba(255,255,255,0.2)",
            border: `1px solid ${pickerOpen ? "rgba(139,92,246,0.45)" : salesOpen ? "rgba(245,197,24,0.35)" : "rgba(255,255,255,0.08)"}`,
            cursor: salesOpen ? "pointer" : "not-allowed",
            boxShadow: pickerOpen ? "0 0 20px rgba(139,92,246,0.15)" : "none",
          }}
        >
          {pickerOpen ? "▲ Close Number Picker" : salesOpen ? "🎟 Select Numbers & Buy" : "Sales Closed"}
        </button>
      </div>
    </div>
  );
}

/* ── Right card: Your Tickets ─────────────────────────────────── */
function NumbersPopup({ ticket, onClose }: { ticket: LotteryTicket; onClose: () => void }) {
  const nums: number[] = (() => { try { return JSON.parse(ticket.numbers || "[]"); } catch { return []; } })();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: "absolute", zIndex: 50, left: 0, top: "calc(100% + 4px)",
      background: "linear-gradient(135deg,#1a1200 0%,#110d00 100%)",
      border: "1px solid rgba(245,197,24,0.35)",
      borderRadius: 10, padding: "10px 14px",
      boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(245,197,24,0.08)",
      minWidth: 160,
    }}>
      <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "rgba(245,197,24,0.55)", marginBottom: 8 }}>
        Ticket #{String(1000000 + ticket.id).slice(1)} · Numbers
      </p>
      {nums.length === 0 ? (
        <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>No numbers picked yet</p>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {nums.map((n, i) => (
            <span key={i} style={{
              width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.4)",
              color: "#f5c518", fontSize: 12, fontWeight: 800,
            }}>{n}</span>
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 8;

function YourTickets({
  tickets, settings, loading,
}: {
  tickets: LotteryTicket[]; settings: Settings | null; loading: boolean;
}) {
  const [ticketsOpen, setTicketsOpen] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const closePopup = useCallback(() => setActiveId(null), []);

  const totalSpent = tickets.reduce((s, t) => s + (Number(t.ticket_cost) || 0), 0);
  const totalPages = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageTickets = tickets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
              <div className="px-6 py-5 flex flex-col gap-4">
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: <Ticket size={20} />, label: "Your Tickets", value: tickets.length },
                    { icon: <Coins size={20} />, label: "Total Spent", value: fmt(totalSpent) },
                    { icon: <Users size={20} />, label: "Total Entries", value: tickets.length },
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
                      {pageTickets.map(t => {
                        const badge = statusBadge(t);
                        const isOpen = activeId === t.id;
                        return (
                          <div key={t.id}
                            className="grid grid-cols-4 gap-2 px-3 py-2.5 rounded-lg items-center transition-colors hover:bg-white/[0.03]"
                            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <button
                              onClick={() => setActiveId(isOpen ? null : t.id)}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", position: "relative" }}
                            >
                              <span
                                className="text-xs font-bold tabular-nums"
                                style={{
                                  color: isOpen ? "#f5c518" : "rgba(255,255,255,0.65)",
                                  textDecoration: "underline", textDecorationStyle: "dotted",
                                  textDecorationColor: "rgba(245,197,24,0.4)",
                                  transition: "color 0.15s",
                                }}
                              >
                                #{String(1000000 + t.id).slice(1)}
                              </span>
                              {isOpen && <NumbersPopup ticket={t} onClose={closePopup} />}
                            </button>
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

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between mt-3 pt-3"
                        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={safePage === 1}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
                          style={{
                            background: safePage === 1 ? "transparent" : "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: safePage === 1 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.5)",
                            cursor: safePage === 1 ? "default" : "pointer",
                          }}
                        >
                          <ChevronLeft size={12} /> Prev
                        </button>

                        <div className="flex items-center gap-1">
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                            <button
                              key={p}
                              onClick={() => setPage(p)}
                              className="w-6 h-6 rounded text-[10px] font-black transition-all"
                              style={{
                                background: p === safePage ? "rgba(245,197,24,0.18)" : "transparent",
                                border: `1px solid ${p === safePage ? "rgba(245,197,24,0.45)" : "rgba(255,255,255,0.08)"}`,
                                color: p === safePage ? "#f5c518" : "rgba(255,255,255,0.35)",
                                cursor: "pointer",
                              }}
                            >{p}</button>
                          ))}
                        </div>

                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={safePage === totalPages}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
                          style={{
                            background: safePage === totalPages ? "transparent" : "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: safePage === totalPages ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.5)",
                            cursor: safePage === totalPages ? "default" : "pointer",
                          }}
                        >
                          Next <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Info panel */}
                <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <Info size={14} style={{ color: "rgba(255,255,255,0.35)", flexShrink: 0, marginTop: 1 }} />
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                    Click a ticket number to view its selected numbers.
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

/* ── Previous Results ────────────────────────────────────────── */
interface PastDraw {
  id: number; drawTime: string;
  winningNumbers: number[];
  jackpot: number; consolation: number;
  jackpotRolledOver: boolean; consolationRolledIntoJackpot: boolean;
  myTickets: Array<{ id: number; result_tier: string | null; numbers: string }>;
}

function WinBall({ n, size = 36 }: { n: number; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(245,197,24,0.14)",
      border: "2px solid rgba(245,197,24,0.55)",
      color: "#f5c518", fontWeight: 900,
      fontSize: size * 0.38,
      boxShadow: "0 0 14px rgba(245,197,24,0.28)",
      flexShrink: 0,
    }}>{n}</div>
  );
}

function PreviousResults({ sessionToken }: { sessionToken: string | null }) {
  const [open, setOpen] = useState(false);
  const [draws, setDraws] = useState<PastDraw[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    if (loaded || !sessionToken) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/lottery/history`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (r.ok) {
        const d = await r.json();
        setDraws(Array.isArray(d) ? d : []);
        setLoaded(true);
      }
    } catch {}
    setLoading(false);
  }

  function handleToggle() {
    setOpen(o => {
      if (!o) load();
      return !o;
    });
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(160deg,#0e0b06 0%,#0a0804 100%)",
        border: "1px solid rgba(245,197,24,0.15)",
      }}
    >
      {/* Toggle header — same height/style as YourTickets */}
      <button
        className="w-full px-6 py-4 flex items-center justify-between transition-colors hover:bg-white/[0.02]"
        style={{ borderBottom: open ? "1px solid rgba(245,197,24,0.1)" : "none" }}
        onClick={handleToggle}
      >
        <span className="font-rajdhani font-black text-base uppercase tracking-widest text-white">
          Previous Results
        </span>
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={18} style={{ color: "rgba(255,255,255,0.4)" }} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="prev-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-6 py-4">
              {loading && (
                <div className="text-center py-6" style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>
                  Loading results…
                </div>
              )}
              {!loading && draws.length === 0 && (
                <div className="text-center py-6 flex flex-col items-center gap-2">
                  <Calendar size={24} style={{ color: "rgba(255,255,255,0.1)" }} />
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>No completed draws yet</p>
                </div>
              )}
              {!loading && draws.length > 0 && (
                <div className="flex flex-col gap-3">
                  {draws.map(d => {
                    const hasWin = d.myTickets.some(t => t.result_tier === "jackpot" || t.result_tier === "consolation");
                    const hasJackpotWin = d.myTickets.some(t => t.result_tier === "jackpot");
                    return (
                      <div key={d.id}
                        className="rounded-xl p-3"
                        style={{
                          background: hasWin ? "rgba(245,197,24,0.04)" : "rgba(255,255,255,0.02)",
                          border: `1px solid ${hasWin ? "rgba(245,197,24,0.18)" : "rgba(255,255,255,0.06)"}`,
                        }}
                      >
                        {/* Draw header row */}
                        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black uppercase tracking-widest"
                              style={{ color: "rgba(245,197,24,0.7)" }}>
                              Draw #{d.id}
                            </span>
                            <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                              <Calendar size={10} />
                              <span className="text-[10px]">{fmtShortDate(d.drawTime)}</span>
                            </div>
                          </div>

                          {/* Result badges */}
                          <div className="flex flex-wrap gap-1">
                            {d.jackpotRolledOver && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase"
                                style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
                                Rolled Over
                              </span>
                            )}
                            {d.consolationRolledIntoJackpot && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase"
                                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
                                Con→Jack
                              </span>
                            )}
                            {hasJackpotWin && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase"
                                style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.25)" }}>
                                🏆 Won
                              </span>
                            )}
                            {!hasJackpotWin && hasWin && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase"
                                style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                                🎉 Win
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Winning number balls + prizes on one row */}
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex gap-1.5">
                            {d.winningNumbers.length === 0
                              ? <span className="text-[10px] italic" style={{ color: "rgba(255,255,255,0.2)" }}>Not drawn</span>
                              : d.winningNumbers.map((n, i) => <WinBall key={i} n={n} size={28} />)
                            }
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <div className="rounded px-2 py-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                              <p className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>Jackpot</p>
                              <p className="text-[10px] font-black" style={{ color: "#f5c518" }}>{fmt(d.jackpot)}</p>
                            </div>
                            <div className="rounded px-2 py-1" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                              <p className="text-[8px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>Tickets</p>
                              <p className="text-[10px] font-black text-white">{d.myTickets.length}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Number Picker Panel ─────────────────────────────────────── */
function NumberPickerPanel({
  settings, salesOpen, onConfirm, onCancel, buying, buyMsg,
}: {
  settings: Settings | null; salesOpen: boolean;
  onConfirm: (numbers: number[]) => void; onCancel: () => void;
  buying: boolean; buyMsg: { text: string; ok: boolean } | null;
}) {
  const required = settings?.numbersPerTicket ?? 4;
  const min = settings?.numberMin ?? 1;
  const max = settings?.numberMax ?? 20;
  const cost = settings?.ticketCost ?? 0;
  const [picked, setPicked] = useState<number[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const allNums = Array.from({ length: max - min + 1 }, (_, i) => i + min);

  function quickPick() {
    const pool = [...allNums];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setPicked(pool.slice(0, required).sort((a, b) => a - b));
  }

  function toggle(n: number) {
    setPicked(prev =>
      prev.includes(n)
        ? prev.filter(x => x !== n)
        : prev.length < required ? [...prev, n].sort((a, b) => a - b) : prev
    );
  }

  const ready = picked.length === required;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        background: "linear-gradient(160deg,#0e0b06 0%,#0a0804 100%)",
        border: "1px solid rgba(245,197,24,0.2)",
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 0 40px rgba(245,197,24,0.04)",
      }}
    >
      {/* Header — matches WeeklyMegaDraw */}
      <div style={{
        background: "rgba(245,197,24,0.05)",
        borderBottom: "1px solid rgba(245,197,24,0.1)",
        padding: "10px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{
            fontFamily: "Rajdhani,sans-serif", fontWeight: 900, fontSize: 13,
            letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
          }}>
            Your Numbers
          </span>
          <span style={{ fontSize: 10, color: "rgba(245,197,24,0.5)", fontWeight: 700, letterSpacing: "0.06em" }}>
            {picked.length} / {required}
          </span>
        </div>
        <button
          onClick={onCancel}
          style={{
            background: "none", border: "none", color: "rgba(255,255,255,0.2)",
            cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 4px",
            transition: "color 0.15s",
          }}
        >✕</button>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Compact flex-wrap chip grid */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-start" }}>
          {allNums.map(n => {
            const sel = picked.includes(n);
            const disabled = !sel && picked.length >= required;
            const isHov = hovered === n && !disabled && !sel;
            // colour band per number range
            const chipColor =
              n <= 5  ? "#f5c518" :   // gold
              n <= 10 ? "#f97316" :   // orange
              n <= 15 ? "#a78bfa" :   // purple
                        "#2dd4bf";    // teal
            const chipRgb =
              n <= 5  ? "245,197,24" :
              n <= 10 ? "249,115,22" :
              n <= 15 ? "167,139,250" :
                        "45,212,191";
            return (
              <button
                key={n}
                onClick={() => toggle(n)}
                disabled={disabled}
                onMouseEnter={() => !disabled && setHovered(n)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  width: 36, height: 36,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: sel
                    ? `linear-gradient(145deg,${chipColor} 0%,${chipColor}cc 100%)`
                    : isHov
                      ? `rgba(${chipRgb},0.1)`
                      : "rgba(255,255,255,0.03)",
                  border: sel
                    ? `2px solid ${chipColor}`
                    : isHov
                      ? `2px solid rgba(${chipRgb},0.7)`
                      : `2px solid rgba(${chipRgb},0.28)`,
                  color: sel
                    ? "#0a0804"
                    : disabled
                      ? "rgba(255,255,255,0.12)"
                      : isHov
                        ? chipColor
                        : `rgba(${chipRgb},0.75)`,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: disabled ? "not-allowed" : "pointer",
                  boxShadow: sel
                    ? `0 0 12px rgba(${chipRgb},0.5), inset 0 1px 0 rgba(255,255,255,0.25)`
                    : isHov
                      ? `0 0 8px rgba(${chipRgb},0.3)`
                      : "none",
                  transition: "all 0.15s ease",
                  userSelect: "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  lineHeight: 1,
                }}
              >{n}</button>
            );
          })}
        </div>

        {/* Selected numbers preview row */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 5, padding: "6px 0",
          borderTop: "1px solid rgba(255,255,255,0.05)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          {Array.from({ length: required }).map((_, i) => {
            const n = picked[i];
            return (
              <div key={i} style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: n !== undefined
                  ? "linear-gradient(145deg,#f5c518 0%,#d4a800 100%)"
                  : "rgba(255,255,255,0.03)",
                border: `1.5px solid ${n !== undefined ? "rgba(245,197,24,0.75)" : "rgba(255,255,255,0.08)"}`,
                color: n !== undefined ? "#0a0804" : "rgba(255,255,255,0.1)",
                fontWeight: 900, fontSize: 10,
                boxShadow: n !== undefined ? "0 0 8px rgba(245,197,24,0.3)" : "none",
                transition: "all 0.18s ease",
              }}>
                {n !== undefined ? n : "·"}
              </div>
            );
          })}
          {picked.length > 0 && picked.length < required && (
            <span style={{
              fontSize: 9, color: "rgba(255,255,255,0.22)",
              letterSpacing: "0.1em", textTransform: "uppercase", marginLeft: 4,
            }}>
              {required - picked.length} more
            </span>
          )}
        </div>

        {/* Buy message */}
        <AnimatePresence>
          {buyMsg && (
            <motion.div
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                padding: "6px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, textAlign: "center",
                background: buyMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                border: `1px solid ${buyMsg.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                color: buyMsg.ok ? "#22c55e" : "#f87171",
              }}
            >{buyMsg.text}</motion.div>
          )}
        </AnimatePresence>

        {/* Action row: Quick Pick | Clear | Purchase */}
        <div style={{ display: "flex", gap: 5 }}>
          <button
            onClick={quickPick}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,197,24,0.3)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.09)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)"; }}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 10,
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.35)", letterSpacing: "0.05em", textTransform: "uppercase",
              transition: "all 0.15s",
            }}
          >⚡ Quick</button>
          <button
            onClick={() => setPicked([])}
            disabled={picked.length === 0}
            onMouseEnter={e => { if (picked.length > 0) { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.18)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.45)"; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLButtonElement).style.color = picked.length === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.28)"; }}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 8,
              cursor: picked.length === 0 ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 10,
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
              color: picked.length === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.28)",
              letterSpacing: "0.05em", textTransform: "uppercase",
              transition: "all 0.15s",
            }}
          >Clear</button>
          <button
            onClick={() => ready && !buying && salesOpen && onConfirm(picked)}
            disabled={!ready || buying || !salesOpen}
            onMouseEnter={e => { if (ready && salesOpen) { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 20px rgba(245,197,24,0.15)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(245,197,24,0.55)"; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = ready && salesOpen ? "0 0 12px rgba(245,197,24,0.07)" : "none"; (e.currentTarget as HTMLButtonElement).style.borderColor = ready && salesOpen ? "rgba(245,197,24,0.38)" : "rgba(255,255,255,0.07)"; }}
            style={{
              flex: 2, padding: "7px 0", borderRadius: 8, fontWeight: 800, fontSize: 10,
              letterSpacing: "0.07em", textTransform: "uppercase",
              background: ready && salesOpen
                ? "rgba(245,197,24,0.1)"
                : "rgba(255,255,255,0.02)",
              border: `1px solid ${ready && salesOpen ? "rgba(245,197,24,0.38)" : "rgba(255,255,255,0.07)"}`,
              color: ready && salesOpen ? "#f5c518" : "rgba(255,255,255,0.15)",
              cursor: ready && !buying && salesOpen ? "pointer" : "not-allowed",
              transition: "all 0.15s",
              boxShadow: ready && salesOpen ? "0 0 12px rgba(245,197,24,0.07)" : "none",
            }}
          >
            {buying ? "Buying…" : ready ? `Buy · ${fmt(cost)}` : `${required - picked.length} to go`}
          </button>
        </div>
      </div>
    </motion.div>
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
  const [showPicker, setShowPicker] = useState(false);
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

  const salesOpen = draw?.status === "open" && draw ? new Date(draw.ticketCloseAt).getTime() > Date.now() : false;

  async function handleBuy(numbers: number[]) {
    if (!settings || buying) return;
    setBuying(true);
    setBuyMsg(null);
    try {
      const r = await apiFetch("/lottery/buy", { method: "POST", body: JSON.stringify({ quantity: 1, numbers }) });
      const d = await r.json();
      if (!r.ok) {
        setBuyMsg({ text: d.error || "Purchase failed", ok: false });
      } else {
        setBuyMsg({ text: `Ticket purchased — ${fmt(d.totalCost)} chips spent`, ok: true });
        setShowPicker(false);
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
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
        {/* Main 2-col: draw + tickets */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <WeeklyMegaDraw
              draw={draw} settings={settings} now={now}
              onOpenPicker={() => setShowPicker(o => !o)}
              pickerOpen={showPicker}
            />
            <AnimatePresence>
              {showPicker && (
                <NumberPickerPanel
                  key="picker"
                  settings={settings}
                  salesOpen={salesOpen}
                  onConfirm={handleBuy}
                  onCancel={() => setShowPicker(false)}
                  buying={buying}
                  buyMsg={buyMsg}
                />
              )}
            </AnimatePresence>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <YourTickets tickets={tickets} settings={settings} loading={ticketsLoading} />
            <PreviousResults sessionToken={sessionToken} />
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
