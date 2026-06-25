import { TrendingUp, Eye, Flame, Gavel } from "lucide-react";
import { PageWrapper, ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

const priceChanges = [
  { id: 14, change: +38.4 },
  { id: 7,  change: +24.1 },
  { id: 5,  change: +19.6 },
  { id: 11, change: +14.3 },
  { id: 19, change: +11.8 },
];

function MiniRow({ rank, emoji, name, category, rarity, stat, statColor }:
  { rank: number; emoji: string; name: string; category: string; rarity: string; stat: string; statColor: string }
) {
  const rc = RARITY[rarity as keyof typeof RARITY];
  const cc = CAT_COLOR[category as keyof typeof CAT_COLOR];
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150"
      style={{ background: "#0d0b0b", border: "1px solid rgba(255,255,255,0.06)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.12)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
    >
      <span className="text-[12px] font-black w-5 text-center shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>#{rank}</span>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-white text-[12px] font-bold truncate">{name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: rc.color }}>{rc.label}</span>
          <span className="text-[8px] font-bold" style={{ color: cc }}>{category}</span>
        </div>
      </div>
      <span className="text-[13px] font-black shrink-0" style={{ color: statColor }}>{stat}</span>
    </div>
  );
}

export function MktTrendingPage() {
  const bySold   = [...ITEMS].sort((a, b) => b.sold - a.sold).slice(0, 5);
  const byViews  = [...ITEMS].sort((a, b) => b.views - a.views).slice(0, 5);
  const byChange = priceChanges.map(pc => ({ ...ITEMS.find(i => i.id === pc.id)!, change: pc.change }));
  const hotAuctions = [...ITEMS].filter(i => i.stock === 1).sort((a,b) => b.price - a.price).slice(0, 5);

  return (
    <PageWrapper title="Trending" breadcrumb="Market Alley / Trending" accentColor="#f97316">
      <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Flame size={14} style={{ color: "#f97316" }} />
            <h3 className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#f97316" }}>Top Sellers</h3>
          </div>
          <div className="flex flex-col gap-2">
            {bySold.map((item, i) => (
              <MiniRow key={item.id} rank={i + 1} emoji={item.emoji} name={item.name}
                category={item.category} rarity={item.rarity} stat={`${item.sold} sold`} statColor="rgba(255,255,255,0.5)" />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} style={{ color: "#22c55e" }} />
            <h3 className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#22c55e" }}>Biggest Price Increases (7d)</h3>
          </div>
          <div className="flex flex-col gap-2">
            {byChange.map((item, i) => (
              <MiniRow key={item.id} rank={i + 1} emoji={item.emoji} name={item.name}
                category={item.category} rarity={item.rarity} stat={`+${item.change}%`} statColor="#22c55e" />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Eye size={14} style={{ color: "#60a5fa" }} />
            <h3 className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#60a5fa" }}>Most Viewed Listings</h3>
          </div>
          <div className="flex flex-col gap-2">
            {byViews.map((item, i) => (
              <MiniRow key={item.id} rank={i + 1} emoji={item.emoji} name={item.name}
                category={item.category} rarity={item.rarity} stat={`${(item.views / 1000).toFixed(1)}K views`} statColor="#60a5fa" />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <Gavel size={14} style={{ color: "#a855f7" }} />
            <h3 className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#a855f7" }}>Hottest Auctions</h3>
          </div>
          <div className="flex flex-col gap-2">
            {hotAuctions.map((item, i) => (
              <MiniRow key={item.id} rank={i + 1} emoji={item.emoji} name={item.name}
                category={item.category} rarity={item.rarity} stat={fmt(item.price)} statColor="#f5c518" />
            ))}
          </div>
        </div>

      </div>
    </PageWrapper>
  );
}
