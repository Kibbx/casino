import { useState } from "react";
import { PageWrapper, CardGrid } from "./shared";

const draws = [
  {
    id: 1, name: "Daily Draw", schedule: "Every day at 8:00 PM",
    ticketPrice: "$5", jackpot: "$10,000", ticketsSold: 1240, maxTickets: 2000,
    prizes: ["$10,000", "$2,000", "$500", "$100 ×10"],
    neonColor: "#22c55e", timeLeft: "3h 42m",
  },
  {
    id: 2, name: "Weekly Mega Draw", schedule: "Every Friday at 10:00 PM",
    ticketPrice: "$20", jackpot: "$75,000", ticketsSold: 2847, maxTickets: 5000,
    prizes: ["$75,000", "$15,000", "$5,000", "$1,000 ×5"],
    neonColor: "#f5c518", timeLeft: "2d 14h", featured: true,
  },
  {
    id: 3, name: "Monthly Jackpot", schedule: "Last day of the month",
    ticketPrice: "$50", jackpot: "$500,000", ticketsSold: 4122, maxTickets: 10000,
    prizes: ["$500,000", "$100,000", "$25,000", "$5,000 ×10"],
    neonColor: "#a855f7", timeLeft: "11d 8h",
  },
];

function LotteryCard({ d }: { d: typeof draws[0] }) {
  const [hov, setHov] = useState(false);
  const [qty, setQty] = useState(1);
  const pct = Math.round((d.ticketsSold / d.maxTickets) * 100);

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
      {/* Header */}
      <div className="px-5 py-4" style={{ background: `${d.neonColor}0d`, borderBottom: `1px solid ${d.neonColor}22` }}>
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-rajdhani font-black text-lg uppercase tracking-wider text-white">{d.name}</h3>
          {d.featured && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase" style={{ background: "#e8400a", color: "#fff" }}>
              FEATURED
            </span>
          )}
        </div>
        <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.38)" }}>{d.schedule}</p>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Jackpot */}
        <div className="text-center py-3 rounded-xl" style={{ background: `${d.neonColor}0d`, border: `1px solid ${d.neonColor}22` }}>
          <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.35)" }}>Jackpot</p>
          <p className="text-3xl font-black" style={{ fontFamily: "'Orbitron', sans-serif", color: d.neonColor, textShadow: `0 0 20px ${d.neonColor}66` }}>
            {d.jackpot}
          </p>
          <p className="text-[11px] mt-1 font-bold" style={{ color: "rgba(255,255,255,0.4)" }}>
            ⏱ Draw in {d.timeLeft}
          </p>
        </div>

        {/* Prizes */}
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

        {/* Tickets sold */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Tickets sold</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>{d.ticketsSold.toLocaleString()} / {d.maxTickets.toLocaleString()}</span>
          </div>
          <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: d.neonColor }} />
          </div>
        </div>

        {/* Buy tickets */}
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
            Buy {qty} Ticket{qty > 1 ? "s" : ""} · {`$${(parseInt(d.ticketPrice.replace("$","")) * qty)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LotteryPage() {
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
        {draws.map((d) => (
          <LotteryCard key={d.id} d={d} />
        ))}
      </div>
    </PageWrapper>
  );
}
