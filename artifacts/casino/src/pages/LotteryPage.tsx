import { useState, useEffect, useRef } from "react";
import { PageWrapper } from "./shared";

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
  return `${m}m ${s % 60}s`;
}

interface LiveDraw {
  jackpot: number;
  consolation: number;
  totalTickets: number;
  drawTime: string;
  ticketCloseAt: string;
  status: string;
}
interface LiveSettings {
  ticketCost: number;
  maxTicketsPerPlayer: number;
}

interface CardData {
  id: number;
  name: string;
  schedule: string;
  ticketPrice: string;
  jackpot: string;
  ticketsSold: number;
  maxTickets: number;
  prizes: string[];
  neonColor: string;
  timeLeft: string;
  featured?: boolean;
  live?: boolean;
}

const staticCards: CardData[] = [
  {
    id: 2, name: "Weekly Mega Draw", schedule: "Every Friday at 10:00 PM",
    ticketPrice: "$20", jackpot: "$75,000", ticketsSold: 2847, maxTickets: 5000,
    prizes: ["$75,000", "$15,000", "$5,000", "$1,000 ×5"],
    neonColor: "#f5c518", timeLeft: "2d 14h", featured: true, live: true,
  },
];

function LotteryCard({ d }: { d: CardData }) {
  const [hov, setHov] = useState(false);
  const [qty, setQty] = useState(1);
  const pct = Math.round((d.ticketsSold / d.maxTickets) * 100);
  const ticketCostNum = parseInt(d.ticketPrice.replace(/[^0-9]/g, ""), 10) || 0;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#0c0a0a",
        border: `1px solid ${d.neonColor}33`,
        boxShadow: hov ? `0 0 24px ${d.neonColor}22` : "none",
        transition: "box-shadow 0.2s",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div className="px-5 py-4" style={{ background: `${d.neonColor}0d`, borderBottom: `1px solid ${d.neonColor}22` }}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-rajdhani font-black text-lg uppercase tracking-wider text-white">{d.name}</h3>
          <div className="flex items-center gap-1.5">
            {d.live && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase flex items-center gap-1" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
                LIVE
              </span>
            )}
            {d.featured && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase" style={{ background: "#e8400a", color: "#fff" }}>
                FEATURED
              </span>
            )}
          </div>
        </div>
        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.38)" }}>{d.schedule}</p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        <div className="text-center py-3 rounded-xl" style={{ background: `${d.neonColor}0d`, border: `1px solid ${d.neonColor}22` }}>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>Jackpot</p>
          <p className="text-3xl font-black" style={{ fontFamily: "'Orbitron', sans-serif", color: d.neonColor, textShadow: `0 0 20px ${d.neonColor}66` }}>
            {d.jackpot}
          </p>
          <p className="text-[11px] mt-1 font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>
            ⏱ Draw in {d.timeLeft}
          </p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.30)" }}>Prize Tiers</p>
          <div className="flex flex-col gap-1">
            {d.prizes.map((p, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {["🥇 1st", "🥈 2nd", "🥉 3rd", "🎁 Others"][i]}
                </span>
                <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.7)" }}>{p}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Tickets sold</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              {d.ticketsSold.toLocaleString()}{d.maxTickets > 0 ? ` / ${d.maxTickets.toLocaleString()}` : ""}
            </span>
          </div>
          <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: d.neonColor }} />
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <div className="flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}>
            <button className="w-8 h-8 font-bold text-white" onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
            <span className="px-3 text-sm font-bold text-white tabular-nums">{qty}</span>
            <button className="w-8 h-8 font-bold text-white" onClick={() => setQty(q => q + 1)}>+</button>
          </div>
          <button
            className="flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
            style={{
              background: hov ? d.neonColor : `${d.neonColor}22`,
              color: hov ? "#060404" : d.neonColor,
              border: `1px solid ${d.neonColor}55`,
            }}
          >
            Buy {qty} Ticket{qty > 1 ? "s" : ""} · {ticketCostNum > 0 ? `${fmt(ticketCostNum * qty)} chips` : d.ticketPrice}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LotteryPage() {
  const [draw, setDraw] = useState<LiveDraw | null>(null);
  const [settings, setSettings] = useState<LiveSettings | null>(null);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch(`${BASE}/api/lottery/active`);
        const d = await r.json();
        if (d.draw) setDraw(d.draw);
        if (d.settings) setSettings(d.settings);
      } catch {}
    }
    poll();
    const iv = setInterval(poll, 30000);
    timerRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(iv); if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const cards: CardData[] = staticCards.map(c => {
    if (!c.live || !draw || !settings) return c;
    const drawMs = new Date(draw.drawTime).getTime() - now;
    const timeLeft = fmtCountdown(drawMs);
    const jackpotStr = `${fmt(draw.jackpot)} chips`;
    const prizes = [
      `${fmt(draw.jackpot)} chips`,
      `${fmt(draw.consolation)} chips`,
    ];
    return {
      ...c,
      jackpot: jackpotStr,
      ticketPrice: `${fmt(settings.ticketCost)} chips`,
      ticketsSold: draw.totalTickets,
      maxTickets: 0,
      prizes,
      timeLeft,
      schedule: `Draw: ${new Date(draw.drawTime).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${new Date(draw.drawTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    };
  });

  return (
    <PageWrapper title="Lottery" breadcrumb="Events / Lottery" accentColor="#f5c518">
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 24,
        maxWidth: 1080,
        margin: "0 auto",
        width: "100%",
      }}>
        {cards.map((d) => (
          <LotteryCard key={d.id} d={d} />
        ))}
      </div>
    </PageWrapper>
  );
}
