import { TrendingUp, TrendingDown, Package } from "lucide-react";
import { PageWrapper, ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

interface OwnedItem { itemId: number; qty: number; purchasePrice: number; currentValue: number; acquiredDate: string }

const owned: OwnedItem[] = [
  { itemId: 1,  qty: 1, purchasePrice: 185,  currentValue: 285,  acquiredDate: "Jun 12, 2026" },
  { itemId: 11, qty: 1, purchasePrice: 6500, currentValue: 8200, acquiredDate: "Jun 8,  2026" },
  { itemId: 9,  qty: 1, purchasePrice: 950,  currentValue: 1200, acquiredDate: "Jun 1,  2026" },
  { itemId: 19, qty: 2, purchasePrice: 480,  currentValue: 680,  acquiredDate: "May 28, 2026" },
  { itemId: 16, qty: 1, purchasePrice: 430,  currentValue: 520,  acquiredDate: "May 15, 2026" },
  { itemId: 21, qty: 3, purchasePrice: 55,   currentValue: 85,   acquiredDate: "May 10, 2026" },
];

export function MktInventoryPage() {
  const totalPurchase = owned.reduce((s, o) => s + o.purchasePrice * o.qty, 0);
  const totalCurrent  = owned.reduce((s, o) => s + o.currentValue  * o.qty, 0);
  const totalPnL      = totalCurrent - totalPurchase;

  return (
    <PageWrapper title="My Inventory" breadcrumb="Market Alley / Inventory" accentColor="#22c55e">

      <div className="flex gap-3 mb-6 flex-wrap">
        {[
          { label: "Items Owned",     value: owned.reduce((s, o) => s + o.qty, 0), color: "#22c55e" },
          { label: "Total Cost",      value: fmt(totalPurchase),                    color: "#60a5fa" },
          { label: "Est. Value",      value: fmt(totalCurrent),                     color: "#f5c518" },
          { label: "Unrealised P&L",  value: `${totalPnL > 0 ? "+" : ""}${fmt(Math.abs(totalPnL))}`, color: totalPnL >= 0 ? "#22c55e" : "#ef4444" },
        ].map(s => (
          <div key={s.label} className="flex-1 min-w-[130px] rounded-xl px-4 py-3"
            style={{ background: "#0d0b0b", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{s.label}</p>
            <p className="text-[17px] font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {owned.length === 0
        ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Package size={36} style={{ color: "rgba(255,255,255,0.12)" }} />
            <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>Your inventory is empty.</p>
          </div>
        )
        : (
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="grid px-4 py-2.5"
              style={{ gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              {["Item", "Category", "Qty", "Purchase Cost", "Est. Value", "P&L"].map(h => (
                <span key={h} className="text-[9px] font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.32)" }}>{h}</span>
              ))}
            </div>

            {owned.map((o, i) => {
              const item   = ITEMS.find(x => x.id === o.itemId)!;
              const r      = RARITY[item.rarity];
              const cc     = CAT_COLOR[item.category];
              const pnl    = (o.currentValue - o.purchasePrice) * o.qty;
              const pnlPct = ((o.currentValue - o.purchasePrice) / o.purchasePrice * 100).toFixed(1);
              const up     = pnl >= 0;
              return (
                <div key={o.itemId}
                  className="grid px-4 py-3 items-center transition-colors duration-150"
                  style={{ gridTemplateColumns: "2.5fr 1fr 1fr 1fr 1fr 1fr", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)", borderBottom: i < owned.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)"; }}
                >
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 22 }}>{item.emoji}</span>
                    <div>
                      <p className="text-white text-[12px] font-semibold">{item.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: r.color }}>{r.label}</span>
                        <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 8 }}>·</span>
                        <span className="text-[8px]" style={{ color: "rgba(255,255,255,0.35)" }}>Acquired {o.acquiredDate}</span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold" style={{ color: cc }}>{item.category}</span>
                  <span className="text-[12px] font-bold text-white">×{o.qty}</span>
                  <span className="text-[12px] font-bold" style={{ color: "rgba(255,255,255,0.55)" }}>{fmt(o.purchasePrice * o.qty)}</span>
                  <span className="text-[12px] font-black" style={{ color: "#f5c518" }}>{fmt(o.currentValue * o.qty)}</span>
                  <span className="flex items-center gap-1 text-[11px] font-black" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                    {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {up ? "+" : "-"}{fmt(Math.abs(pnl))} ({up ? "+" : "-"}{Math.abs(parseFloat(pnlPct))}%)
                  </span>
                </div>
              );
            })}
          </div>
        )
      }
    </PageWrapper>
  );
}
