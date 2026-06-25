import { PageWrapper, ITEMS, RARITY, CAT_COLOR, fmt } from "./mkt-shared";

interface Sale {
  id: number; itemId: number; seller: string; buyer: string; salePrice: number; date: string;
}

const sales: Sale[] = [
  { id: 1,  itemId: 12, seller: "GradeKings",     buyer: "BballFan",     salePrice: 2400,  date: "Jun 20, 2026 · 3:41 PM"  },
  { id: 2,  itemId: 4,  seller: "SneakerStash",   buyer: "KicksOnly",    salePrice: 145,   date: "Jun 20, 2026 · 2:18 PM"  },
  { id: 3,  itemId: 21, seller: "VintageFinds",   buyer: "DenimHead",    salePrice: 85,    date: "Jun 20, 2026 · 1:05 PM"  },
  { id: 4,  itemId: 17, seller: "AppleGrade",     buyer: "DevFlip",      salePrice: 1800,  date: "Jun 20, 2026 · 11:52 AM" },
  { id: 5,  itemId: 23, seller: "TurboKing92",    buyer: "TrackDay",     salePrice: 1250,  date: "Jun 20, 2026 · 10:30 AM" },
  { id: 6,  itemId: 8,  seller: "WatchDeals",     buyer: "CasioFan",     salePrice: 89,    date: "Jun 19, 2026 · 9:14 PM"  },
  { id: 7,  itemId: 19, seller: "HypeDrop",       buyer: "BoxLogoKid",   salePrice: 680,   date: "Jun 19, 2026 · 7:28 PM"  },
  { id: 8,  itemId: 15, seller: "TechResell",     buyer: "iPhoneFan",    salePrice: 980,   date: "Jun 19, 2026 · 5:55 PM"  },
  { id: 9,  itemId: 13, seller: "CardVault",      buyer: "PikaCollect",  salePrice: 480,   date: "Jun 19, 2026 · 3:22 PM"  },
  { id: 10, itemId: 22, seller: "UKStreetware",   buyer: "PalaceFan",    salePrice: 320,   date: "Jun 19, 2026 · 1:10 PM"  },
  { id: 11, itemId: 18, seller: "AudioResale",    buyer: "XM5User",      salePrice: 240,   date: "Jun 18, 2026 · 8:45 PM"  },
  { id: 12, itemId: 25, seller: "SuspensionKing", buyer: "Track_Guy",    salePrice: 980,   date: "Jun 18, 2026 · 4:02 PM"  },
];

export function MktRecentSalesPage() {
  return (
    <PageWrapper title="Recent Sales" breadcrumb="Market Alley / Recent Sales" accentColor="#06b6d4">

      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <div className="grid px-4 py-2.5"
          style={{ gridTemplateColumns: "2.2fr 1fr 1fr 1.8fr 1.8fr", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          {["Item", "Category", "Sale Price", "Seller → Buyer", "Date & Time"].map(h => (
            <span key={h} className="text-[9px] font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.32)" }}>{h}</span>
          ))}
        </div>

        {sales.map((s, i) => {
          const item = ITEMS.find(x => x.id === s.itemId)!;
          const r    = RARITY[item.rarity];
          const cc   = CAT_COLOR[item.category];
          return (
            <div key={s.id}
              className="grid px-4 py-3 items-center transition-colors duration-150"
              style={{
                gridTemplateColumns: "2.2fr 1fr 1fr 1.8fr 1.8fr",
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)",
                borderBottom: i < sales.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)"; }}
            >
              <div className="flex items-center gap-2.5">
                <span style={{ fontSize: 20 }}>{item.emoji}</span>
                <div>
                  <p className="text-white text-[12px] font-semibold">{item.name}</p>
                  <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: r.color }}>{r.label}</span>
                </div>
              </div>
              <span className="text-[10px] font-bold" style={{ color: cc }}>{item.category}</span>
              <span className="text-[13px] font-black" style={{ color: "#f5c518" }}>{fmt(s.salePrice)}</span>
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
                {s.seller} <span style={{ color: "rgba(255,255,255,0.2)" }}>→</span> {s.buyer}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{s.date}</span>
            </div>
          );
        })}
      </div>

    </PageWrapper>
  );
}
