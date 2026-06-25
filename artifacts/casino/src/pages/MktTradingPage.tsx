import { ArrowLeftRight, Clock, CheckCircle2, XCircle } from "lucide-react";
import { PageWrapper, ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

type TradeStatus = "pending" | "completed" | "declined";
type Direction   = "incoming" | "outgoing";

interface Trade {
  id: number; direction: Direction; counterparty: string;
  offerItemId: number; offerQty: number;
  wantItemId: number;  wantQty: number;
  cashDiff: number; status: TradeStatus; time: string;
}

const trades: Trade[] = [
  { id: 1, direction: "incoming", counterparty: "KicksVault",     offerItemId: 2,  offerQty: 1, wantItemId: 1,  wantQty: 1, cashDiff:  50,   status: "pending",   time: "5 min ago"  },
  { id: 2, direction: "outgoing", counterparty: "GradeKings",     offerItemId: 13, offerQty: 1, wantItemId: 12, wantQty: 1, cashDiff: -400,  status: "pending",   time: "12 min ago" },
  { id: 3, direction: "incoming", counterparty: "WatchDeals",     offerItemId: 8,  offerQty: 1, wantItemId: 21, wantQty: 1, cashDiff:  20,   status: "pending",   time: "28 min ago" },
  { id: 4, direction: "outgoing", counterparty: "NB_Resells",     offerItemId: 3,  offerQty: 2, wantItemId: 6,  wantQty: 2, cashDiff:  0,    status: "completed", time: "2 hrs ago"  },
  { id: 5, direction: "incoming", counterparty: "TurboKing92",    offerItemId: 23, offerQty: 1, wantItemId: 25, wantQty: 1, cashDiff: -200,  status: "declined",  time: "4 hrs ago"  },
];

const STATUS_CFG: Record<TradeStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "#f5c518", bg: "rgba(245,197,24,0.1)",  Icon: Clock         },
  completed: { label: "Completed", color: "#22c55e", bg: "rgba(34,197,94,0.1)",   Icon: CheckCircle2  },
  declined:  { label: "Declined",  color: "#ef4444", bg: "rgba(239,68,68,0.1)",   Icon: XCircle       },
};

function ItemChip({ itemId, qty }: { itemId: number; qty: number }) {
  const item = ITEMS.find(i => i.id === itemId)!;
  const r    = RARITY[item.rarity];
  const cc   = CAT_COLOR[item.category];
  return (
    <div className="flex-1 rounded-xl p-3 flex items-center gap-3"
      style={{ background: r.bg, border: `1px solid ${r.color}20` }}>
      <span style={{ fontSize: 26, flexShrink: 0 }}>{item.emoji}</span>
      <div className="min-w-0">
        <p className="text-white text-[11px] font-bold truncate">{item.name}{qty > 1 ? ` ×${qty}` : ""}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[8px] font-black uppercase" style={{ color: r.color }}>{r.label}</span>
          <span style={{ color: "rgba(255,255,255,0.18)", fontSize: 8 }}>·</span>
          <span className="text-[8px] font-bold" style={{ color: cc }}>{item.category}</span>
        </div>
        <p className="text-[10px] font-black mt-0.5" style={{ color: "#f5c518" }}>{fmt(item.price * qty)}</p>
      </div>
    </div>
  );
}

function TradeCard({ t }: { t: Trade }) {
  const sc      = STATUS_CFG[t.status];
  const inbound = t.direction === "incoming";
  const dirColor = inbound ? "#22c55e" : "#60a5fa";

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: "#0d0b0b", border: "1px solid rgba(255,255,255,0.07)" }}>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeftRight size={13} style={{ color: dirColor }} />
          <span className="text-[11px] font-bold" style={{ color: dirColor }}>
            {inbound ? "Incoming" : "Outgoing"} · <span style={{ color: "rgba(255,255,255,0.7)" }}>{t.counterparty}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider"
            style={{ color: sc.color, background: sc.bg, border: `1px solid ${sc.color}44` }}>
            {sc.label}
          </span>
          <span className="text-[9px] flex items-center gap-1" style={{ color: "rgba(255,255,255,0.3)" }}>
            <Clock size={9} /> {t.time}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.28)" }}>
            {inbound ? `${t.counterparty} offers` : "You offer"}
          </p>
          <ItemChip itemId={t.offerItemId} qty={t.offerQty} />
        </div>

        <div className="flex flex-col items-center gap-1 shrink-0">
          <ArrowLeftRight size={16} style={{ color: "rgba(255,255,255,0.16)" }} />
          {t.cashDiff !== 0 && (
            <span className="text-[9px] font-black"
              style={{ color: t.cashDiff > 0 ? "#22c55e" : "#ef4444" }}>
              {t.cashDiff > 0 ? `+${fmt(t.cashDiff)}` : `-${fmt(Math.abs(t.cashDiff))}`}
            </span>
          )}
        </div>

        <div className="flex-1">
          <p className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: "rgba(255,255,255,0.28)" }}>
            {inbound ? "They want" : `${t.counterparty} wants`}
          </p>
          <ItemChip itemId={t.wantItemId} qty={t.wantQty} />
        </div>
      </div>

      {t.status === "pending" && inbound && (
        <div className="flex gap-2 pt-1">
          <button className="flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide text-white"
            style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", boxShadow: "0 0 12px rgba(34,197,94,0.3)" }}>
            Accept Trade
          </button>
          <button className="flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wide"
            style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)" }}>
            Decline
          </button>
        </div>
      )}
      {t.status === "pending" && !inbound && (
        <button className="py-2 rounded-lg text-[11px] font-black uppercase tracking-wide"
          style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          Cancel Offer
        </button>
      )}
    </div>
  );
}

export function MktTradingPage() {
  const pending   = trades.filter(t => t.status === "pending");
  const history   = trades.filter(t => t.status !== "pending");

  return (
    <PageWrapper title="Trading Activity" breadcrumb="Market Alley / Trading Activity" accentColor="#60a5fa">

      <div className="flex gap-3 mb-6 flex-wrap">
        {[
          { label: "Active Offers",    value: pending.length,         color: "#f5c518" },
          { label: "Completed Trades", value: history.filter(t => t.status === "completed").length, color: "#22c55e" },
          { label: "Declined Offers",  value: history.filter(t => t.status === "declined").length,  color: "#ef4444" },
          { label: "Trade Volume",     value: "$12.8K",               color: "#60a5fa" },
        ].map(s => (
          <div key={s.label} className="flex-1 min-w-[110px] rounded-xl px-4 py-3"
            style={{ background: "#0d0b0b", border: "1px solid rgba(255,255,255,0.07)" }}>
            <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{s.label}</p>
            <p className="text-[17px] font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 max-w-[800px] mx-auto">
        {pending.length > 0 && (
          <>
            <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
              Active Offers ({pending.length})
            </p>
            {pending.map(t => <TradeCard key={t.id} t={t} />)}
          </>
        )}
        {history.length > 0 && (
          <>
            <p className="text-[10px] font-black uppercase tracking-widest mt-2 mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>
              History
            </p>
            {history.map(t => <TradeCard key={t.id} t={t} />)}
          </>
        )}
      </div>
    </PageWrapper>
  );
}
