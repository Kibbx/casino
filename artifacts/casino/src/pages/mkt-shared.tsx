export { PageWrapper, CardGrid } from "./shared";

export type Rarity   = "Common" | "Rare" | "Epic" | "Legendary" | "Mythic";
export type Category = "Sneakers" | "Watches" | "Trading Cards" | "Electronics" | "Apparel" | "Car Parts";

export interface MktItem {
  id:          number;
  name:        string;
  category:    Category;
  subcategory: string;
  rarity:      Rarity;
  emoji:       string;
  price:       number;
  seller:      string;
  stock:       number;
  sold:        number;
  views:       number;
  tags:        string[];
}

export const RARITY: Record<Rarity, { color: string; bg: string; glow: string; border: string; label: string }> = {
  Common:    { color: "#9ca3af", bg: "rgba(156,163,175,0.07)", glow: "rgba(156,163,175,0.18)", border: "rgba(156,163,175,0.18)", label: "Standard"   },
  Rare:      { color: "#60a5fa", bg: "rgba(96,165,250,0.07)",  glow: "rgba(96,165,250,0.28)",  border: "rgba(96,165,250,0.22)",  label: "Limited"     },
  Epic:      { color: "#a855f7", bg: "rgba(168,85,247,0.07)",  glow: "rgba(168,85,247,0.32)",  border: "rgba(168,85,247,0.25)",  label: "Exclusive"   },
  Legendary: { color: "#f5c518", bg: "rgba(245,197,24,0.07)",  glow: "rgba(245,197,24,0.38)",  border: "rgba(245,197,24,0.28)",  label: "Rare Find"   },
  Mythic:    { color: "#ef4444", bg: "rgba(239,68,68,0.07)",   glow: "rgba(239,68,68,0.45)",   border: "rgba(239,68,68,0.28)",   label: "1 of 1"      },
};

export const CAT_COLOR: Record<Category, string> = {
  "Sneakers":      "#f97316",
  "Watches":       "#f5c518",
  "Trading Cards": "#60a5fa",
  "Electronics":   "#06b6d4",
  "Apparel":       "#a855f7",
  "Car Parts":     "#ef4444",
};

export const ITEMS: MktItem[] = [
  /* ── Sneakers ── */
  { id: 1,  name: 'Nike Air Jordan 1 Retro "Bred"',   category: "Sneakers",      subcategory: "Basketball", rarity: "Rare",      emoji: "👟", price: 285,   seller: "SoleSupply_NYC",  stock: 1, sold: 142, views: 3210,  tags: ["Jordan","Nike","DS"]           },
  { id: 2,  name: 'Adidas Yeezy 700 V2 "Cream"',      category: "Sneakers",      subcategory: "Lifestyle",  rarity: "Rare",      emoji: "👟", price: 340,   seller: "KicksVault",     stock: 2, sold: 89,  views: 2780,  tags: ["Yeezy","Adidas","Lifestyle"]   },
  { id: 3,  name: "New Balance 550 White/Grey",        category: "Sneakers",      subcategory: "Lifestyle",  rarity: "Common",    emoji: "👟", price: 120,   seller: "NB_Resells",     stock: 4, sold: 312, views: 1890,  tags: ["NB","Lifestyle","Classic"]     },
  { id: 4,  name: 'Nike Dunk Low "Panda"',             category: "Sneakers",      subcategory: "Lifestyle",  rarity: "Common",    emoji: "👟", price: 145,   seller: "SneakerStash",   stock: 3, sold: 445, views: 2100,  tags: ["Dunk","Nike","Deadstock"]      },
  { id: 5,  name: 'Air Jordan 4 "Military Blue"',      category: "Sneakers",      subcategory: "Basketball", rarity: "Epic",      emoji: "👟", price: 520,   seller: "J4Collector",    stock: 1, sold: 41,  views: 5430,  tags: ["Jordan","Nike","Retro"]        },
  { id: 6,  name: "Nike Air Max 90 White/Black",       category: "Sneakers",      subcategory: "Lifestyle",  rarity: "Common",    emoji: "👟", price: 95,    seller: "SneakerMate",    stock: 5, sold: 203, views: 1200,  tags: ["AirMax","Nike","OG"]           },
  /* ── Watches ── */
  { id: 7,  name: "Rolex Submariner Date (2023)",      category: "Watches",       subcategory: "Luxury",     rarity: "Legendary", emoji: "⌚", price: 14500, seller: "PrecisionTime",  stock: 1, sold: 9,   views: 9870,  tags: ["Rolex","Swiss","Luxury"]       },
  { id: 8,  name: "Casio G-SHOCK DW-6900",             category: "Watches",       subcategory: "Sport",      rarity: "Common",    emoji: "⌚", price: 89,    seller: "WatchDeals",     stock: 6, sold: 234, views: 1560,  tags: ["Casio","GSHOCK","Digital"]     },
  { id: 9,  name: "TAG Heuer Formula 1 Chronograph",   category: "Watches",       subcategory: "Sport",      rarity: "Rare",      emoji: "⌚", price: 1200,  seller: "LuxuryWrists",   stock: 1, sold: 67,  views: 4120,  tags: ["TAG","Swiss","Chrono"]         },
  { id: 10, name: "Omega Speedmaster Moonwatch",       category: "Watches",       subcategory: "Luxury",     rarity: "Epic",      emoji: "⌚", price: 5800,  seller: "VintageHoro",    stock: 1, sold: 29,  views: 6340,  tags: ["Omega","Space","Swiss"]        },
  /* ── Trading Cards ── */
  { id: 11, name: "Pokémon Charizard 1st Ed. PSA 10",  category: "Trading Cards", subcategory: "Pokémon",    rarity: "Legendary", emoji: "🃏", price: 8200,  seller: "CardVault",      stock: 1, sold: 12,  views: 11200, tags: ["PSA10","Pokemon","1stEd"]      },
  { id: 12, name: "LeBron James 2003 Topps RC PSA 10", category: "Trading Cards", subcategory: "Basketball", rarity: "Epic",      emoji: "🃏", price: 2400,  seller: "GradeKings",     stock: 1, sold: 23,  views: 7890,  tags: ["PSA10","Basketball","RC"]      },
  { id: 13, name: "Pikachu Promo Holo 1999",           category: "Trading Cards", subcategory: "Pokémon",    rarity: "Rare",      emoji: "🃏", price: 480,   seller: "CardVault",      stock: 2, sold: 88,  views: 5600,  tags: ["Pokemon","Holo","Vintage"]     },
  { id: 14, name: "Michael Jordan 1986 Fleer PSA 9",   category: "Trading Cards", subcategory: "Basketball", rarity: "Legendary", emoji: "🃏", price: 9500,  seller: "SportCardPro",   stock: 1, sold: 8,   views: 12300, tags: ["PSA9","Basketball","MJ"]       },
  /* ── Electronics ── */
  { id: 15, name: "iPhone 15 Pro Max 256GB Unlocked",  category: "Electronics",   subcategory: "Phones",     rarity: "Common",    emoji: "📱", price: 980,   seller: "TechResell",     stock: 2, sold: 156, views: 7890,  tags: ["Apple","iPhone","Unlocked"]    },
  { id: 16, name: "PS5 Console + Controller Bundle",   category: "Electronics",   subcategory: "Gaming",     rarity: "Common",    emoji: "🎮", price: 520,   seller: "GameHaven",      stock: 2, sold: 432, views: 4230,  tags: ["Sony","PS5","Gaming"]          },
  { id: 17, name: 'MacBook Pro M3 14" Space Gray',     category: "Electronics",   subcategory: "Laptops",    rarity: "Rare",      emoji: "💻", price: 1800,  seller: "AppleGrade",     stock: 1, sold: 77,  views: 8400,  tags: ["Apple","M3","Laptop"]          },
  { id: 18, name: "Sony WH-1000XM5 Headphones",        category: "Electronics",   subcategory: "Audio",      rarity: "Common",    emoji: "🎧", price: 240,   seller: "AudioResale",    stock: 3, sold: 601, views: 2890,  tags: ["Sony","ANC","Audio"]           },
  /* ── Apparel ── */
  { id: 19, name: "Supreme Box Logo Hoodie FW23",      category: "Apparel",       subcategory: "Hoodies",    rarity: "Epic",      emoji: "👕", price: 680,   seller: "HypeDrop",       stock: 1, sold: 44,  views: 6700,  tags: ["Supreme","BoxLogo","DS"]       },
  { id: 20, name: "Off-White x Nike Collab Tee",       category: "Apparel",       subcategory: "T-Shirts",   rarity: "Rare",      emoji: "👕", price: 380,   seller: "StreetEdition",  stock: 2, sold: 63,  views: 5200,  tags: ["OffWhite","Nike","Collab"]     },
  { id: 21, name: "Vintage Levi's 501 (1990s)",        category: "Apparel",       subcategory: "Denim",      rarity: "Common",    emoji: "👖", price: 85,    seller: "VintageFinds",   stock: 4, sold: 178, views: 2100,  tags: ["Levis","Denim","Vintage"]      },
  { id: 22, name: "Palace Skateboards Tri-Ferg Hood",  category: "Apparel",       subcategory: "Hoodies",    rarity: "Rare",      emoji: "👕", price: 320,   seller: "UKStreetware",   stock: 2, sold: 112, views: 4880,  tags: ["Palace","Skate","UK"]          },
  /* ── Car Parts ── */
  { id: 23, name: "OEM Stage 5 Brake Kit",             category: "Car Parts",     subcategory: "Brakes",     rarity: "Rare",      emoji: "🔧", price: 1250,  seller: "TurboKing92",    stock: 1, sold: 87,  views: 3210,  tags: ["Brakes","OEM","Track"]         },
  { id: 24, name: "100mm Performance Turbocharger",    category: "Car Parts",     subcategory: "Engine",     rarity: "Epic",      emoji: "🌀", price: 2300,  seller: "ApexParts",      stock: 1, sold: 41,  views: 5430,  tags: ["Turbo","Performance","Engine"] },
  { id: 25, name: "Bilstein B8 Coilover Kit",          category: "Car Parts",     subcategory: "Suspension", rarity: "Rare",      emoji: "🛞", price: 980,   seller: "SuspensionKing", stock: 2, sold: 124, views: 2780,  tags: ["Bilstein","Suspension","B8"]   },
  { id: 26, name: 'BBS RS 18" Wheel Set (4pc)',        category: "Car Parts",     subcategory: "Wheels",     rarity: "Epic",      emoji: "⭕", price: 2800,  seller: "WheelVault",     stock: 1, sold: 29,  views: 6340,  tags: ["BBS","Wheels","Track"]         },
];

export function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000)    return `$${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000)     return `$${n.toLocaleString()}`;
  return `$${n}`;
}

export function MktItemCard({ item }: { item: MktItem }) {
  const r  = RARITY[item.rarity];
  const cc = CAT_COLOR[item.category];

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col group cursor-pointer"
      style={{ background: "#0d0b0b", border: `1px solid ${r.border}`, transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s" }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = r.color + "60";
        el.style.boxShadow   = `0 4px 24px ${r.glow}`;
        el.style.transform   = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = r.border;
        el.style.boxShadow   = "none";
        el.style.transform   = "translateY(0)";
      }}
    >
      {/* Image area */}
      <div className="relative flex items-center justify-center"
        style={{ height: 108, background: `linear-gradient(135deg, ${r.bg} 0%, rgba(0,0,0,0) 100%)` }}>
        <span className="transition-transform duration-300 group-hover:scale-110"
          style={{ fontSize: 44, filter: `drop-shadow(0 0 10px ${r.glow})`, display: "block" }}>
          {item.emoji}
        </span>
        {/* Condition badge — top left */}
        <span className="absolute top-2 left-2 px-2 py-[2px] rounded text-[8px] font-black uppercase tracking-wider"
          style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}44` }}>
          {r.label}
        </span>
        {/* Category badge — top right */}
        <span className="absolute top-2 right-2 px-2 py-[2px] rounded text-[8px] font-bold uppercase tracking-wider"
          style={{ background: `${cc}18`, color: cc, border: `1px solid ${cc}44` }}>
          {item.category}
        </span>
        {/* Stock warning */}
        {item.stock === 1 && (
          <span className="absolute bottom-2 right-2 px-2 py-[2px] rounded text-[8px] font-black"
            style={{ background: "rgba(239,68,68,0.14)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.35)" }}>
            Last 1
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <p className="text-white text-[13px] font-bold leading-snug">{item.name}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
            Sold by <span style={{ color: "rgba(255,255,255,0.58)" }}>{item.seller}</span>
          </p>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {item.tags.slice(0, 2).map(t => (
            <span key={t} className="text-[8px] px-1.5 py-[2px] rounded"
              style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.32)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {t}
            </span>
          ))}
        </div>

        {/* Price + Buy */}
        <div className="flex items-center justify-between mt-auto pt-2"
          style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div>
            <p className="text-[9px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.28)" }}>Price</p>
            <p className="text-[15px] font-black" style={{ color: "#f5c518", textShadow: "0 0 10px rgba(245,197,24,0.3)" }}>
              {fmt(item.price)}
            </p>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide"
            style={{ color: "#e8400a", background: "rgba(232,64,10,0.1)", border: "1px solid rgba(232,64,10,0.35)", transition: "all 0.15s" }}
            onMouseEnter={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "linear-gradient(135deg,#e8400a,#c43209)";
              b.style.color      = "#fff";
              b.style.boxShadow  = "0 0 14px rgba(232,64,10,0.5)";
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = "rgba(232,64,10,0.1)";
              b.style.color      = "#e8400a";
              b.style.boxShadow  = "none";
            }}
          >Buy Now</button>
        </div>
      </div>
    </div>
  );
}
