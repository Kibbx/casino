import { useState, useEffect } from "react";
import {
  Star, Users, Package, Plus, ArrowLeft, Search,
  Heart, ExternalLink, Filter, ChevronDown, Gavel,
  Clock, TrendingUp, ShieldCheck, CheckCircle,
} from "lucide-react";
import { ITEMS, RARITY, CAT_COLOR, fmt, type Category } from "./mkt-shared";
import { getShops, consumePendingToast, type Shop } from "./shopStore";

/* ── Re-export Shop type so existing imports still work ───────── */
export type { Shop };

/* ── (SHOPS data and Shop interface now live in shopStore.ts) ─── */

/* ── Star rating display ──────────────────────────────────────── */
function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={10}
          fill={i <= Math.round(rating) ? "#f5c518" : "transparent"}
          stroke={i <= Math.round(rating) ? "#f5c518" : "rgba(255,255,255,0.2)"}
        />
      ))}
      <span className="text-[10px] ml-1" style={{ color: "#f5c518" }}>{rating.toFixed(1)}</span>
    </div>
  );
}

/* ── Shop Card ────────────────────────────────────────────────── */
function ShopCard({ shop, onVisit }: { shop: Shop; onVisit: () => void }) {
  const cc = CAT_COLOR[shop.category];
  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col cursor-pointer group"
      style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)", width: 260, transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s" }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = shop.accent + "55";
        el.style.boxShadow   = `0 4px 28px ${shop.accent}22`;
        el.style.transform   = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = "rgba(255,255,255,0.07)";
        el.style.boxShadow   = "none";
        el.style.transform   = "translateY(0)";
      }}
    >
      {/* Banner */}
      <div className="relative flex items-end px-4 pb-3" style={{ height: 72, background: shop.banner }}>
        {/* Avatar */}
        <div className="absolute left-4 bottom-0 translate-y-1/2 w-12 h-12 rounded-xl flex items-center justify-center text-2xl z-10"
          style={{ background: "#0c0a0a", border: `2px solid ${shop.accent}66`, boxShadow: `0 0 14px ${shop.accent}44` }}>
          {shop.avatar}
        </div>
        {/* Verified badge */}
        {shop.verified && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-[2px] rounded text-[8px] font-black uppercase tracking-wider"
            style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
            <ShieldCheck size={8} /> Verified
          </div>
        )}
        {/* Category badge */}
        <span className="absolute top-2 left-2 px-2 py-[2px] rounded text-[8px] font-bold uppercase tracking-wider"
          style={{ background: `${cc}18`, color: cc, border: `1px solid ${cc}44` }}>
          {shop.category}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 pt-8 pb-4 flex flex-col gap-3 flex-1">
        {/* Name + seller */}
        <div>
          <h3 className="font-rajdhani text-white text-sm font-black uppercase tracking-wide leading-tight">{shop.name}</h3>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.38)" }}>
            by <span style={{ color: shop.accent }}>{shop.seller}</span>
          </p>
        </div>

        {/* Description */}
        <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "rgba(255,255,255,0.45)" }}>
          {shop.desc}
        </p>

        {/* Stats row */}
        <div className="flex items-center justify-between">
          <StarRow rating={shop.rating} />
          <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            <Users size={10} />
            <span className="text-[10px]">{shop.followers.toLocaleString()}</span>
          </div>
        </div>

        {/* Listings + sales */}
        <div className="flex items-center gap-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            <Package size={10} />
            <span className="text-[10px]">{shop.listings} listings</span>
          </div>
          <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.35)" }}>
            <TrendingUp size={10} />
            <span className="text-[10px]">{shop.sales.toLocaleString()} sold</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mt-auto">
          <button
            className="flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide"
            style={{ color: shop.accent, background: `${shop.accent}12`, border: `1px solid ${shop.accent}35`, transition: "all 0.15s" }}
            onMouseEnter={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = `${shop.accent}22`;
              b.style.borderColor = `${shop.accent}70`;
            }}
            onMouseLeave={e => {
              const b = e.currentTarget as HTMLButtonElement;
              b.style.background = `${shop.accent}12`;
              b.style.borderColor = `${shop.accent}35`;
            }}
          >
            <Heart size={10} className="inline mr-1" />Follow
          </button>
          <button
            className="flex-1 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide flex items-center justify-center gap-1"
            style={{ color: "#fff", background: `linear-gradient(135deg,${shop.accent},${shop.accent}cc)`, boxShadow: `0 0 12px ${shop.accent}44`, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 20px ${shop.accent}66`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 12px ${shop.accent}44`; }}
            onClick={e => { e.stopPropagation(); onVisit(); }}
          >
            <ExternalLink size={10} />Visit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shop Detail Page ─────────────────────────────────────────── */
const MOCK_AUCTIONS = [
  { id: 1, itemId: 1,  currentBid: 310,  endsin: "2h 14m", bids: 7  },
  { id: 2, itemId: 11, currentBid: 9100, endsin: "45m",    bids: 14 },
];
const MOCK_HISTORY = [
  { itemId: 1,  price: 285, buyer: "KicksVault",    ago: "3h ago"  },
  { itemId: 3,  price: 120, buyer: "SneakerMate",   ago: "1d ago"  },
  { itemId: 5,  price: 520, buyer: "J4Collector",   ago: "2d ago"  },
  { itemId: 7,  price: 14500, buyer: "LuxuryWrists", ago: "3d ago" },
];

type Filter = { category: string; rarity: string; sort: string };

function ShopDetailPage({ shop, onBack }: { shop: Shop; onBack: () => void }) {
  const [filter, setFilter] = useState<Filter>({ category: "All", rarity: "All", sort: "Newest" });
  const cc = CAT_COLOR[shop.category];

  const shopItems = ITEMS.filter(i => i.seller === shop.seller);
  const featuredItems = shop.featured.map(id => ITEMS.find(i => i.id === id)).filter(Boolean) as typeof ITEMS;

  const filteredItems = shopItems.filter(i => {
    if (filter.category !== "All" && i.category !== filter.category) return false;
    if (filter.rarity   !== "All" && i.rarity   !== filter.rarity)   return false;
    return true;
  });

  const categories = ["All", ...Array.from(new Set(shopItems.map(i => i.category)))];
  const rarities   = ["All", "Common", "Rare", "Epic", "Legendary", "Mythic"];
  const sorts      = ["Newest", "Price: Low", "Price: High", "Most Viewed"];

  return (
    <div style={{ background: "#050303", minHeight: "100%" }}>
      {/* Banner */}
      <div className="relative" style={{ height: 180, background: shop.banner }}>
        <button
          onClick={onBack}
          className="absolute top-4 left-6 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide"
          style={{ background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", transition: "all 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; }}
        >
          <ArrowLeft size={12} /> All Shops
        </button>
        {/* Ambient glow */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 30% 50%, ${shop.accent}14 0%, transparent 70%)` }} />
      </div>

      <div className="w-full max-w-[1280px] mx-auto px-6 pb-12">
        {/* Shop header */}
        <div className="flex items-end gap-5 -mt-8 mb-8 relative z-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
            style={{ background: "#0c0a0a", border: `2px solid ${shop.accent}66`, boxShadow: `0 0 20px ${shop.accent}44` }}>
            {shop.avatar}
          </div>
          <div className="pb-1 flex-1">
            <div className="flex items-center gap-3">
              <h1 className="font-orbitron text-white text-xl font-black uppercase tracking-wider">{shop.name}</h1>
              {shop.verified && (
                <span className="flex items-center gap-1 px-2 py-[2px] rounded text-[9px] font-black uppercase"
                  style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)" }}>
                  <ShieldCheck size={9} /> Verified Seller
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
              by <span style={{ color: shop.accent }}>{shop.seller}</span>
              <span className="mx-2" style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
              {shop.sales.toLocaleString()} total sales
              <span className="mx-2" style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
              {shop.followers.toLocaleString()} followers
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <StarRow rating={shop.rating} />
            <button className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wide ml-4"
              style={{ color: shop.accent, background: `${shop.accent}12`, border: `1px solid ${shop.accent}35`, transition: "all 0.15s" }}>
              <Heart size={11} /> Follow
            </button>
          </div>
        </div>

        {/* Announcement banner */}
        {shop.announcement && (
          <div className="mb-8 px-4 py-3 rounded-xl text-[12px] font-bold"
            style={{ background: `${shop.accent}0d`, border: `1px solid ${shop.accent}30`, color: "rgba(255,255,255,0.75)" }}>
            {shop.announcement}
          </div>
        )}

        {/* Featured items */}
        {featuredItems.length > 0 && (
          <section className="mb-10">
            <h2 className="font-orbitron text-white text-sm font-black uppercase tracking-widest mb-4"
              style={{ color: shop.accent }}>⭐ Featured Items</h2>
            <div className="flex flex-wrap gap-4">
              {featuredItems.map(item => {
                const r = RARITY[item.rarity];
                const icc = CAT_COLOR[item.category];
                return (
                  <div key={item.id} className="rounded-xl overflow-hidden flex flex-col"
                    style={{ width: 200, background: "#0c0a0a", border: `1px solid ${r.border}` }}>
                    <div className="flex items-center justify-center relative"
                      style={{ height: 90, background: `linear-gradient(135deg,${r.bg},transparent)` }}>
                      <span style={{ fontSize: 36, filter: `drop-shadow(0 0 8px ${r.glow})` }}>{item.emoji}</span>
                      <span className="absolute top-2 left-2 px-1.5 py-[2px] rounded text-[8px] font-black uppercase"
                        style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}44` }}>{r.label}</span>
                    </div>
                    <div className="p-2.5">
                      <p className="text-white text-[12px] font-bold line-clamp-1">{item.name}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="font-black text-[14px]" style={{ color: "#f5c518" }}>{fmt(item.price)}</span>
                        <button className="text-[10px] font-black uppercase px-2 py-1 rounded"
                          style={{ color: shop.accent, background: `${shop.accent}12`, border: `1px solid ${shop.accent}30` }}>
                          Buy
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Active Auctions */}
        <section className="mb-10">
          <h2 className="font-orbitron text-sm font-black uppercase tracking-widest mb-4" style={{ color: "#f97316" }}>
            <Gavel size={14} className="inline mr-2" />Active Auctions
          </h2>
          {MOCK_AUCTIONS.length > 0 ? (
            <div className="flex flex-col gap-2">
              {MOCK_AUCTIONS.map(a => {
                const item = ITEMS.find(i => i.id === a.itemId);
                if (!item) return null;
                const r = RARITY[item.rarity];
                return (
                  <div key={a.id} className="flex items-center gap-4 px-4 py-3 rounded-xl"
                    style={{ background: "#0c0a0a", border: "1px solid rgba(249,115,22,0.15)" }}>
                    <span style={{ fontSize: 28 }}>{item.emoji}</span>
                    <div className="flex-1">
                      <p className="text-white text-[13px] font-bold">{item.name}</p>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                        <span style={{ color: r.color }}>{item.rarity}</span> · {a.bids} bids
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-[16px]" style={{ color: "#f5c518" }}>{fmt(a.currentBid)}</p>
                      <p className="text-[10px] flex items-center gap-1 justify-end" style={{ color: "#f97316" }}>
                        <Clock size={9} /> {a.endsin}
                      </p>
                    </div>
                    <button className="px-4 py-1.5 rounded-lg text-[11px] font-black uppercase"
                      style={{ color: "#f97316", background: "rgba(249,115,22,0.1)", border: "1px solid rgba(249,115,22,0.35)" }}>
                      Bid
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.25)" }}>No active auctions.</p>
          )}
        </section>

        {/* All Listings */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-orbitron text-sm font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.8)" }}>
              All Listings <span className="text-[11px] ml-2" style={{ color: "rgba(255,255,255,0.3)" }}>({filteredItems.length})</span>
            </h2>
            {/* Filters */}
            <div className="flex items-center gap-2">
              {[
                { label: "Category", key: "category" as keyof Filter, opts: categories },
                { label: "Rarity",   key: "rarity"   as keyof Filter, opts: rarities   },
                { label: "Sort",     key: "sort"      as keyof Filter, opts: sorts      },
              ].map(f => (
                <div key={f.key} className="relative">
                  <select
                    value={filter[f.key]}
                    onChange={e => setFilter(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="appearance-none pr-6 pl-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide cursor-pointer"
                    style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.1)", outline: "none" }}
                  >
                    {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "rgba(255,255,255,0.4)" }} />
                </div>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.25)" }}>No listings match your filters.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredItems.map(item => {
                const r  = RARITY[item.rarity];
                const ic = CAT_COLOR[item.category];
                return (
                  <div key={item.id} className="flex items-center gap-4 px-4 py-3 rounded-xl group"
                    style={{ background: "#0c0a0a", border: `1px solid ${r.border}`, transition: "border-color 0.15s, box-shadow 0.15s" }}
                    onMouseEnter={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = r.color + "50";
                      el.style.boxShadow   = `0 2px 14px ${r.glow}`;
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget as HTMLElement;
                      el.style.borderColor = r.border;
                      el.style.boxShadow   = "none";
                    }}
                  >
                    <span style={{ fontSize: 28, filter: `drop-shadow(0 0 6px ${r.glow})` }}>{item.emoji}</span>
                    <div className="flex-1">
                      <p className="text-white text-[13px] font-bold">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] px-1.5 py-[1px] rounded font-black uppercase"
                          style={{ background: r.bg, color: r.color, border: `1px solid ${r.color}44` }}>{r.label}</span>
                        <span className="text-[9px] px-1.5 py-[1px] rounded font-bold uppercase"
                          style={{ background: `${ic}14`, color: ic, border: `1px solid ${ic}44` }}>{item.category}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-black text-[16px]" style={{ color: "#f5c518" }}>{fmt(item.price)}</p>
                      <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Stock: {item.stock}</p>
                    </div>
                    <button className="px-4 py-1.5 rounded-lg text-[11px] font-black uppercase"
                      style={{ color: "#e8400a", background: "rgba(232,64,10,0.1)", border: "1px solid rgba(232,64,10,0.35)", transition: "all 0.15s" }}
                      onMouseEnter={e => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.background = "linear-gradient(135deg,#e8400a,#c43209)";
                        b.style.color = "#fff";
                        b.style.boxShadow = "0 0 14px rgba(232,64,10,0.5)";
                      }}
                      onMouseLeave={e => {
                        const b = e.currentTarget as HTMLButtonElement;
                        b.style.background = "rgba(232,64,10,0.1)";
                        b.style.color = "#e8400a";
                        b.style.boxShadow = "none";
                      }}
                    >Buy Now</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Sales History */}
        <section>
          <h2 className="font-orbitron text-sm font-black uppercase tracking-widest mb-4" style={{ color: "#22c55e" }}>
            Sales History
          </h2>
          <div className="flex flex-col gap-2">
            {MOCK_HISTORY.map((h, i) => {
              const item = ITEMS.find(it => it.id === h.itemId);
              if (!item) return null;
              const r = RARITY[item.rarity];
              return (
                <div key={i} className="flex items-center gap-4 px-4 py-2.5 rounded-xl"
                  style={{ background: "#0c0a0a", border: "1px solid rgba(34,197,94,0.1)" }}>
                  <span style={{ fontSize: 22 }}>{item.emoji}</span>
                  <div className="flex-1">
                    <p className="text-white text-[12px] font-bold">{item.name}</p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Bought by <span style={{ color: "rgba(255,255,255,0.6)" }}>{h.buyer}</span></p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-[14px]" style={{ color: "#22c55e" }}>+{fmt(h.price)}</p>
                    <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{h.ago}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Main Shops Page ──────────────────────────────────────────── */
type View = "list" | "detail";

export function MktShopsPage() {
  const [view, setView]           = useState<View>("list");
  const [selectedShop, setShop]   = useState<Shop | null>(null);
  const [query, setQuery]         = useState("");
  const [catFilter, setCat]       = useState("All");
  const [shops, setShops]         = useState<Shop[]>(() => getShops());
  const [toast, setToast]         = useState<string | null>(null);

  // Pick up the "stall deleted" toast left by shopStore after redirect
  useEffect(() => {
    const name = consumePendingToast();
    if (!name) return;
    console.info(`[MktShopsPage] consumed pending toast for "${name}"`);
    setToast(name);
    setShops(getShops());
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, []);

  const cats = ["All", "Sneakers", "Watches", "Trading Cards", "Electronics", "Apparel", "Car Parts"];

  const filtered = shops.filter(s => {
    const q = query.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.seller.toLowerCase().includes(q);
    const matchC = catFilter === "All" || s.category === catFilter;
    return matchQ && matchC;
  });

  if (view === "detail" && selectedShop) {
    return <ShopDetailPage shop={selectedShop} onBack={() => { setView("list"); setShop(null); }} />;
  }

  return (
    <div className="relative w-full min-h-full" style={{ background: "#050303" }}>
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div style={{ position: "absolute", top: 80, left: "20%", width: 400, height: 300, background: "radial-gradient(ellipse,rgba(249,115,22,0.04) 0%,transparent 70%)", filter: "blur(40px)" }} />
        <div style={{ position: "absolute", top: 200, right: "15%", width: 350, height: 280, background: "radial-gradient(ellipse,rgba(168,85,247,0.04) 0%,transparent 70%)", filter: "blur(50px)" }} />
      </div>

      {/* Deletion success toast */}
      {toast && (
        <div className="fixed bottom-8 right-8 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl text-[12px] font-black uppercase tracking-wide"
          style={{ background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.38)", color: "#22c55e", boxShadow: "0 0 22px rgba(34,197,94,0.28)", backdropFilter: "blur(8px)", animation: "fadeInUp 0.3s ease" }}>
          <CheckCircle size={15} />
          Your stall "{toast}" has been permanently deleted.
        </div>
      )}

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 pt-8 pb-12">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-orbitron text-white text-2xl font-black uppercase tracking-widest">Shops</h1>
            <p className="text-[12px] mt-1" style={{ color: "rgba(255,255,255,0.35)" }}>Browse seller-created stores in the Big House Market</p>
          </div>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-black uppercase tracking-wide"
            style={{ color: "#fff", background: "linear-gradient(135deg,#e8400a,#c43209)", boxShadow: "0 0 18px rgba(232,64,10,0.45)", transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 28px rgba(232,64,10,0.65)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 0 18px rgba(232,64,10,0.45)"; }}
          >
            <Plus size={14} /> Create Shop
          </button>
        </div>

        {/* Search + Category filters */}
        <div className="flex items-center gap-3 mb-8 flex-wrap">
          <div className="relative" style={{ width: 280 }}>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search shops or sellers..."
              className="w-full pl-9 pr-4 py-2 rounded-xl text-[12px]"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.8)", outline: "none" }}
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={12} style={{ color: "rgba(255,255,255,0.3)" }} />
            {cats.map(c => {
              const active = catFilter === c;
              const cc = c === "All" ? "#f97316" : CAT_COLOR[c as Category] ?? "#f97316";
              return (
                <button key={c}
                  onClick={() => setCat(c)}
                  className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide"
                  style={{
                    color:      active ? "#fff" : "rgba(255,255,255,0.45)",
                    background: active ? `${cc}22`  : "rgba(255,255,255,0.03)",
                    border:     active ? `1px solid ${cc}55` : "1px solid rgba(255,255,255,0.08)",
                    transition: "all 0.15s",
                  }}
                >{c}</button>
              );
            })}
          </div>
        </div>

        {/* Shop grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20" style={{ color: "rgba(255,255,255,0.25)" }}>
            <p className="text-lg font-black uppercase">No shops found</p>
            <p className="text-[12px] mt-2">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div className="flex flex-wrap justify-start gap-5">
            {filtered.map(shop => (
              <ShopCard
                key={shop.slug}
                shop={shop}
                onVisit={() => { setShop(shop); setView("detail"); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
