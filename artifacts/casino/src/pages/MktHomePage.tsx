import { Clock, Eye, Users } from "lucide-react";
import { ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

/* ── SectionHeader — mirrors casino exactly ──────────────── */
function SectionHeader({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <div className="flex items-center w-full mb-8">
      <div className="divider-line dl-left" style={{ "--d-c": dotColor } as React.CSSProperties} />
      <span className="divider-dot" style={{ background: dotColor, boxShadow: `0 0 8px 3px ${dotColor}99` }} />
      <h2 className="section-title shrink-0 mx-4">{label}</h2>
      <span className="divider-dot" style={{ background: dotColor, boxShadow: `0 0 8px 3px ${dotColor}99` }} />
      <div className="divider-line dl-right" style={{ "--d-c": dotColor } as React.CSSProperties} />
    </div>
  );
}

/* ── Status configs ──────────────────────────────────────── */
const TRADE_STATUS: Record<string, { label: string; color: string; bg: string; neon: string }> = {
  SOLD:     { label: "SOLD",     color: "#22c55e", bg: "rgba(34,197,94,0.15)",   neon: "neon-green"  },
  BOUGHT:   { label: "BOUGHT",   color: "#f97316", bg: "rgba(249,115,22,0.15)",  neon: "neon-orange" },
  VIEWED:   { label: "VIEWED",   color: "#60a5fa", bg: "rgba(96,165,250,0.15)",  neon: "neon-blue"   },
  WATCHING: { label: "WATCHING", color: "#a855f7", bg: "rgba(168,85,247,0.15)",  neon: "neon-pink"   },
};

const LIVE_STATUS: Record<string, { label: string; color: string; bg: string; neon: string; pulse?: boolean }> = {
  "LIVE":        { label: "LIVE",        color: "#ef4444", bg: "rgba(239,68,68,0.18)",  neon: "neon-red",    pulse: true },
  "ENDING SOON": { label: "ENDING SOON", color: "#f97316", bg: "rgba(249,115,22,0.15)", neon: "neon-orange", pulse: true },
  "TRENDING":    { label: "TRENDING",    color: "#a855f7", bg: "rgba(168,85,247,0.15)", neon: "neon-pink"               },
  "ACTIVE":      { label: "ACTIVE",      color: "#f5c518", bg: "rgba(245,197,24,0.15)", neon: "neon-yellow"             },
};

/* ── Data ────────────────────────────────────────────────── */
interface RecentTrade {
  itemId: number; status: keyof typeof TRADE_STATUS;
  delta: string; deltaUp: boolean; timeAgo: string; counterparty: string;
}
const RECENT_TRADES: RecentTrade[] = [
  { itemId: 26, status: "SOLD",     delta: "+$400", deltaUp: true,  timeAgo: "12 min ago", counterparty: "WheelDealer"    },
  { itemId: 25, status: "VIEWED",   delta: "$980",  deltaUp: true,  timeAgo: "34 min ago", counterparty: "SuspensionKing" },
  { itemId: 19, status: "BOUGHT",   delta: "-$680", deltaUp: false, timeAgo: "1 hr ago",   counterparty: "HypeDrop"       },
  { itemId: 11, status: "WATCHING", delta: "+18%",  deltaUp: true,  timeAgo: "2 hrs ago",  counterparty: "CardVault"      },
];

interface LiveListing {
  itemId: number; status: keyof typeof LIVE_STATUS;
  watchers: number; bids: number; currentPrice: number; ctaLabel: string;
}
const LIVE_LISTINGS: LiveListing[] = [
  { itemId: 24, status: "LIVE",        watchers: 24, bids: 6, currentPrice: 2300,  ctaLabel: "Join Auction" },
  { itemId: 7,  status: "ACTIVE",      watchers: 8,  bids: 8, currentPrice: 14200, ctaLabel: "Join Auction" },
  { itemId: 20, status: "TRENDING",    watchers: 12, bids: 0, currentPrice: 420,   ctaLabel: "View Listing" },
  { itemId: 23, status: "ENDING SOON", watchers: 5,  bids: 5, currentPrice: 1250,  ctaLabel: "Buy Now"      },
];

const PULSE_DELAYS = ["0s", "-1s", "-2s", "-3s"];

/* ── Recently Traded Card ────────────────────────────────── */
function RecentTradeCard({ trade, delay }: { trade: RecentTrade; delay: string }) {
  const item = ITEMS.find(i => i.id === trade.itemId)!;
  const r    = RARITY[item.rarity];
  const cc   = CAT_COLOR[item.category];
  const ts   = TRADE_STATUS[trade.status];

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${ts.neon}`}
      style={{ width: "220px", background: "rgba(10,7,7,0.92)", backdropFilter: "blur(8px)", animationDelay: delay, flexShrink: 0 }}
    >
      <div className="relative h-32 overflow-hidden flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${r.bg} 0%, rgba(0,0,0,0.4) 100%)` }}>
        <span className="transition-transform duration-500 group-hover:scale-110 select-none"
          style={{ fontSize: 52, filter: `drop-shadow(0 0 14px ${r.glow})`, lineHeight: 1 }}>
          {item.emoji}
        </span>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,5,5,0.9) 0%, rgba(8,5,5,0.1) 60%, transparent 100%)" }} />
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
            style={{ background: `${cc}22`, color: cc, border: `1px solid ${cc}44` }}>
            {item.category}
          </span>
        </div>
        <div className="absolute top-2.5 right-2.5">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
            style={{ color: ts.color, background: ts.bg, border: `1px solid ${ts.color}55` }}>
            {ts.label}
          </span>
        </div>
      </div>

      <div className="px-4 py-3">
        <h3 className="font-rajdhani text-white text-base font-black uppercase tracking-wide mb-2 leading-tight line-clamp-1">
          {item.name}
        </h3>
        <div className="flex items-center mb-3" style={{ minHeight: 20 }}>
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
            {trade.status === "SOLD" ? "Sold to" : trade.status === "BOUGHT" ? "Bought from" : "Seller:"}{" "}
            <span style={{ color: "rgba(255,255,255,0.7)" }}>{trade.counterparty}</span>
          </p>
        </div>
        <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.42)" }}>
              <Clock size={9} /> {trade.timeAgo}
            </p>
            <p className="text-xl font-black"
              style={{ color: trade.deltaUp ? "#22c55e" : "#ef4444", textShadow: `0 0 8px ${trade.deltaUp ? "#22c55e55" : "#ef444455"}` }}>
              {trade.delta}
            </p>
          </div>
          <button
            className="text-xs font-bold uppercase tracking-wide px-3.5 py-2 rounded-lg transition-all duration-200"
            style={{ color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)" }}
            onMouseEnter={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.color = "#fff"; b.style.borderColor = "rgba(255,255,255,0.38)";
              b.style.background = "rgba(255,255,255,0.12)"; b.style.boxShadow = "0 0 10px rgba(255,255,255,0.1)";
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.color = "rgba(255,255,255,0.65)"; b.style.borderColor = "rgba(255,255,255,0.18)";
              b.style.background = "rgba(255,255,255,0.06)"; b.style.boxShadow = "none";
            }}
          >View Again</button>
        </div>
      </div>
    </div>
  );
}

/* ── Live Listing Card ───────────────────────────────────── */
function LiveListingCard({ listing, delay }: { listing: LiveListing; delay: string }) {
  const item = ITEMS.find(i => i.id === listing.itemId)!;
  const r    = RARITY[item.rarity];
  const cc   = CAT_COLOR[item.category];
  const ls   = LIVE_STATUS[listing.status];

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${ls.neon}`}
      style={{ width: "220px", background: "rgba(10,7,7,0.92)", backdropFilter: "blur(8px)", animationDelay: delay, flexShrink: 0 }}
    >
      <div className="relative h-32 overflow-hidden flex items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${r.bg} 0%, rgba(0,0,0,0.4) 100%)` }}>
        <span className="transition-transform duration-500 group-hover:scale-110 select-none"
          style={{ fontSize: 52, filter: `drop-shadow(0 0 14px ${r.glow})`, lineHeight: 1 }}>
          {item.emoji}
        </span>
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,5,5,0.9) 0%, rgba(8,5,5,0.1) 60%, transparent 100%)" }} />
        {ls.pulse
          ? (
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-full"
              style={{ background: `${ls.color}1e`, border: `1px solid ${ls.color}55` }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: ls.color, boxShadow: `0 0 6px ${ls.color}` }} />
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: ls.color }}>{ls.label}</span>
            </div>
          ) : (
            <div className="absolute top-2.5 left-2.5">
              <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider"
                style={{ background: `${cc}22`, color: cc, border: `1px solid ${cc}44` }}>
                {item.category}
              </span>
            </div>
          )
        }
        {!ls.pulse && (
          <div className="absolute top-2.5 right-2.5">
            <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
              style={{ color: ls.color, background: ls.bg, border: `1px solid ${ls.color}55` }}>
              {ls.label}
            </span>
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <h3 className="font-rajdhani text-white text-base font-black uppercase tracking-wide mb-2 leading-tight line-clamp-1">
          {item.name}
        </h3>
        <div className="flex items-center justify-between mb-3" style={{ minHeight: 20 }}>
          <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.45)" }}>
            <Eye size={10} />
            <span className="text-[11px]">{listing.watchers} watching</span>
          </div>
          {listing.bids > 0 && (
            <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.45)" }}>
              <Users size={10} />
              <span className="text-[11px]">{listing.bids} bids</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.42)" }}>Current Price</p>
            <p className="text-lg font-black" style={{ color: "#f5c518", textShadow: "0 0 8px rgba(245,197,24,0.35)" }}>
              {fmt(listing.currentPrice)}
            </p>
          </div>
          <button
            className="text-xs font-black uppercase tracking-wider px-4 py-2 rounded-lg transition-all duration-200"
            style={{ color: "#e8400a", background: "rgba(232,64,10,0.1)", border: "1px solid rgba(232,64,10,0.45)" }}
            onMouseEnter={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "linear-gradient(135deg,#e8400a,#c43209)";
              b.style.color = "#fff"; b.style.boxShadow = "0 0 18px rgba(232,64,10,0.55)";
              b.style.borderColor = "#e8400a";
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(232,64,10,0.1)";
              b.style.color = "#e8400a"; b.style.boxShadow = "none";
              b.style.borderColor = "rgba(232,64,10,0.45)";
            }}
          >{listing.ctaLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export function MktHomePage() {
  return (
    <div className="relative" style={{ minHeight: "100%" }}>
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 left-1/3 w-[700px] h-[350px] rounded-full"
          style={{ background: "radial-gradient(ellipse, #f5c518 0%, transparent 70%)", filter: "blur(60px)", opacity: 0.04 }} />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[300px] rounded-full"
          style={{ background: "radial-gradient(ellipse, #e8400a 0%, transparent 70%)", filter: "blur(70px)", opacity: 0.03 }} />
      </div>

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 pt-8 pb-12 flex flex-col gap-8">

        {/* ── Recently Traded ── */}
        <section>
          <SectionHeader label="Recently Viewed" dotColor="#22c55e" />
          <div className="flex flex-wrap justify-center gap-5">
            {RECENT_TRADES.map((t, i) => <RecentTradeCard key={t.itemId} trade={t} delay={PULSE_DELAYS[i]} />)}
          </div>
        </section>

        {/* ── Live Marketplace Activity ── */}
        <section>
          <SectionHeader label="Marketplace Activity" dotColor="#ef4444" />
          <div className="flex flex-wrap justify-center gap-5">
            {LIVE_LISTINGS.map((l, i) => <LiveListingCard key={l.itemId} listing={l} delay={PULSE_DELAYS[i]} />)}
          </div>
        </section>

      </div>
    </div>
  );
}
