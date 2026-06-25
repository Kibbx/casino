import { useState } from "react";
import { PageWrapper, SubHeader, CardGrid } from "./shared";

const categories = ["All", "Avatar Borders", "Card Backs", "Table Themes", "Emotes"];

const items = [
  { id: 1, name: "Neon Serpent Border", cat: "Avatar Borders", rarity: "Rare",   price: 1200, color: "#22c55e", icon: "🐍" },
  { id: 2, name: "Gold Filigree Border", cat: "Avatar Borders", rarity: "Epic",   price: 2800, color: "#f5c518", icon: "✨" },
  { id: 3, name: "Inferno Frame",        cat: "Avatar Borders", rarity: "Legendary", price: 7500, color: "#f97316", icon: "🔥", limited: true },
  { id: 4, name: "Shadow Card Back",     cat: "Card Backs",     rarity: "Common",  price: 400,  color: "#9ca3af", icon: "🃏" },
  { id: 5, name: "Crimson Velvet Back",  cat: "Card Backs",     rarity: "Rare",    price: 950,  color: "#ef4444", icon: "♦️" },
  { id: 6, name: "Holographic Back",     cat: "Card Backs",     rarity: "Epic",    price: 3200, color: "#06b6d4", icon: "🌈", limited: true },
  { id: 7, name: "Neon Club Theme",      cat: "Table Themes",   rarity: "Rare",    price: 1800, color: "#ec4899", icon: "🎰" },
  { id: 8, name: "Casino Royale Theme",  cat: "Table Themes",   rarity: "Epic",    price: 4500, color: "#a855f7", icon: "👑" },
  { id: 9, name: "GG Emote",            cat: "Emotes",         rarity: "Common",  price: 200,  color: "#22c55e", icon: "🤝" },
  { id: 10, name: "Big Win Emote",       cat: "Emotes",         rarity: "Rare",    price: 600,  color: "#f5c518", icon: "🎉" },
];

const rarityColors: Record<string, string> = {
  Common: "#9ca3af", Rare: "#06b6d4", Epic: "#a855f7", Legendary: "#f5c518",
};

function ItemCard({ item }: { item: typeof items[0] }) {
  const [hov, setHov] = useState(false);
  const rc = rarityColors[item.rarity];
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#0c0a0a",
        border: `1px solid ${item.color}28`,
        boxShadow: hov ? `0 0 20px ${item.color}20` : "none",
        transition: "box-shadow 0.2s",
        width: 180,
        minWidth: 160,
        flexShrink: 0,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Item preview area */}
      <div
        className="flex items-center justify-center"
        style={{
          height: 120,
          background: `linear-gradient(135deg, ${item.color}12 0%, ${item.color}06 100%)`,
          fontSize: 48,
          borderBottom: `1px solid ${item.color}18`,
        }}
      >
        {item.icon}
      </div>

      <div className="px-3 py-3">
        <div className="flex items-start justify-between gap-1 mb-2">
          <h3 className="font-rajdhani font-black text-[13px] leading-tight" style={{ color: "rgba(255,255,255,0.85)" }}>
            {item.name}
          </h3>
          {item.limited && (
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black uppercase" style={{ background: "#e8400a", color: "#fff" }}>
              LTD
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mb-3">
          <span
            className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full"
            style={{ color: rc, background: `${rc}18`, border: `1px solid ${rc}33` }}
          >
            {item.rarity}
          </span>
          <span className="text-[12px] font-black" style={{ color: "#f5c518" }}>🪙 {item.price.toLocaleString()}</span>
        </div>

        <button
          className="w-full py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
          style={{
            background: hov ? item.color : "transparent",
            color: hov ? "#060404" : item.color,
            border: `1px solid ${item.color}44`,
          }}
        >
          Purchase
        </button>
      </div>
    </div>
  );
}

export function MarketplacePage() {
  const [activeTab, setActiveTab] = useState("All");
  const filtered = activeTab === "All" ? items : items.filter(i => i.cat === activeTab);

  return (
    <PageWrapper title="Marketplace" breadcrumb="The Hub / Marketplace" accentColor="#a855f7">
      {/* Category tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
            style={{
              background: activeTab === cat ? "rgba(168,85,247,0.18)" : "rgba(255,255,255,0.04)",
              color: activeTab === cat ? "#a855f7" : "rgba(255,255,255,0.40)",
              border: `1px solid ${activeTab === cat ? "rgba(168,85,247,0.45)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      <CardGrid minItemWidth={160} maxItemWidth={200} gap={16}>
        {filtered.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
