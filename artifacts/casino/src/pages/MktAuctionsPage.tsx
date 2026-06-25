import { Gavel, Clock, Eye } from "lucide-react";
import { PageWrapper, CardGrid, ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

interface Auction {
  itemId:     number;
  currentBid: number;
  startBid:   number;
  endsIn:     string;
  bids:       number;
  topBidder:  string;
  urgent:     boolean;
}

const auctions: Auction[] = [
  { itemId: 7,  currentBid: 12800, startBid: 10000, endsIn: "2h 14m",  bids: 7,  topBidder: "TimePiece_Fan", urgent: false },
  { itemId: 11, currentBid: 7200,  startBid: 5000,  endsIn: "18m",     bids: 14, topBidder: "CardHunter",    urgent: true  },
  { itemId: 14, currentBid: 8800,  startBid: 7000,  endsIn: "6h 2m",   bids: 3,  topBidder: "MJ_Collector",  urgent: false },
  { itemId: 5,  currentBid: 440,   startBid: 350,   endsIn: "1h 33m",  bids: 9,  topBidder: "J4Kingdom",     urgent: false },
  { itemId: 26, currentBid: 2400,  startBid: 2000,  endsIn: "22m",     bids: 5,  topBidder: "WheelDealer",   urgent: true  },
  { itemId: 17, currentBid: 1650,  startBid: 1400,  endsIn: "4h 51m",  bids: 2,  topBidder: "AppleFlip",     urgent: false },
];

function AuctionCard({ a }: { a: Auction }) {
  const item = ITEMS.find(i => i.id === a.itemId)!;
  const r    = RARITY[item.rarity];
  const cc   = CAT_COLOR[item.category];

  return (
    <div className="rounded-xl overflow-hidden flex flex-col"
      style={{ background: "#0d0b0b", border: `1px solid ${r.border}`, transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s" }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = r.color + "55";
        el.style.boxShadow   = `0 4px 22px ${r.glow}`;
        el.style.transform   = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = r.border;
        el.style.boxShadow   = "none";
        el.style.transform   = "translateY(0)";
      }}
    >
      <div className="relative flex items-center justify-center"
        style={{ height: 100, background: `linear-gradient(135deg, ${r.bg}, transparent)` }}>
        <span style={{ fontSize: 40, filter: `drop-shadow(0 0 12px ${r.glow})` }}>{item.emoji}</span>
        <span className="absolute top-2 left-2 px-2 py-[2px] rounded text-[8px] font-black uppercase tracking-wider"
          style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}44` }}>{r.label}</span>
        <span className="absolute top-2 right-2 px-2 py-[2px] rounded text-[8px] font-bold"
          style={{ background: `${cc}18`, color: cc, border: `1px solid ${cc}44` }}>{item.category}</span>
        {a.urgent && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1 px-2 py-[2px] rounded text-[8px] font-black"
            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>
            <Clock size={8} /> Ending Soon
          </span>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2">
        <p className="text-white text-[12px] font-bold">{item.name}</p>
        <div className="flex items-center gap-2 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          <Eye size={10} /> {item.views.toLocaleString()} views
          <span style={{ color: "rgba(255,255,255,0.18)" }}>·</span>
          Seller: <span style={{ color: "rgba(255,255,255,0.6)" }}>{item.seller}</span>
        </div>

        <div className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>Current Bid</span>
            <span className="flex items-center gap-1 text-[9px]" style={{ color: a.urgent ? "#ef4444" : "rgba(255,255,255,0.38)" }}>
              <Clock size={8} /> {a.endsIn}
            </span>
          </div>
          <p className="text-[18px] font-black" style={{ color: "#f5c518" }}>{fmt(a.currentBid)}</p>
          <p className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
            {a.bids} bids · Top bidder: <span style={{ color: "#60a5fa" }}>{a.topBidder}</span>
          </p>
        </div>

        <button
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide"
          style={{ color: "#a855f7", background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.35)", transition: "all 0.15s" }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "linear-gradient(135deg,#a855f7,#7c3aed)";
            b.style.color      = "#fff";
            b.style.boxShadow  = "0 0 16px rgba(168,85,247,0.5)";
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement;
            b.style.background = "rgba(168,85,247,0.1)";
            b.style.color      = "#a855f7";
            b.style.boxShadow  = "none";
          }}
        >
          <Gavel size={13} /> Place Bid
        </button>
      </div>
    </div>
  );
}

export function MktAuctionsPage() {
  return (
    <PageWrapper title="Auctions" breadcrumb="Market Alley / Auctions" accentColor="#a855f7">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.4)" }}>
          {auctions.length} active auctions —{" "}
          <span style={{ color: "#ef4444" }}>{auctions.filter(a => a.urgent).length} ending in under 30 minutes</span>
        </p>
      </div>
      <CardGrid minItemWidth={200} maxItemWidth={260} gap={16}>
        {auctions.map(a => <AuctionCard key={a.itemId} a={a} />)}
      </CardGrid>
    </PageWrapper>
  );
}
