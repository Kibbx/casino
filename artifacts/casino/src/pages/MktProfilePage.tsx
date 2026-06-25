import { PageWrapper, SubHeader } from "./shared";

const stats = [
  { label: "Total Listings",      value: "187",    color: "#06b6d4" },
  { label: "Items Sold",          value: "143",    color: "#22c55e" },
  { label: "Total Revenue",       value: "$28,400",color: "#f5c518" },
  { label: "Marketplace Rating",  value: "4.9★",   color: "#a855f7" },
  { label: "Active Listings",     value: "12",     color: "#f97316" },
  { label: "Followers / Watchers",value: "800",    color: "#ec4899" },
  { label: "Auctions Won",        value: "31",     color: "#06b6d4" },
  { label: "Trades Completed",    value: "58",     color: "#22c55e" },
];

type ActivityType = "Sold" | "Bid Placed" | "Purchased" | "Listed" | "Watching";

interface Activity {
  item: string;
  type: ActivityType;
  time: string;
  value: string;
  status: string;
}

const recentActivity: Activity[] = [
  { item: "BBS RS Wheel Set",              type: "Sold",       time: "12 min ago", value: "+$400",   status: "Completed" },
  { item: "Rolex Submariner",              type: "Bid Placed", time: "34 min ago", value: "$14,200", status: "Active"    },
  { item: "Off-White × Nike Tee",         type: "Purchased",  time: "1 hr ago",   value: "-$420",   status: "Completed" },
  { item: "OEM Brake Kit",                type: "Listed",     time: "2 hr ago",   value: "$1,250",  status: "Live"      },
  { item: "Pokémon Charizard 1st Edition",type: "Watching",   time: "Today",      value: "+18%",    status: "Tracking"  },
];

const typeColor: Record<ActivityType, string> = {
  "Sold":       "#22c55e",
  "Bid Placed": "#f97316",
  "Purchased":  "#06b6d4",
  "Listed":     "#3b82f6",
  "Watching":   "#a855f7",
};

const statusStyle: Record<string, { color: string; bg: string; border: string }> = {
  Completed: { color: "#22c55e", bg: "rgba(34,197,94,0.10)",  border: "rgba(34,197,94,0.30)"  },
  Active:    { color: "#f97316", bg: "rgba(249,115,22,0.10)", border: "rgba(249,115,22,0.30)" },
  Live:      { color: "#06b6d4", bg: "rgba(6,182,212,0.10)",  border: "rgba(6,182,212,0.30)"  },
  Tracking:  { color: "#a855f7", bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.30)" },
};

const sellerPerf = [
  { label: "Total Sales Volume",  value: "$28,400", color: "#f5c518" },
  { label: "Conversion Rate",     value: "76.5%",   color: "#22c55e" },
  { label: "Avg Sale Time",       value: "2.3 days", color: "#06b6d4" },
  { label: "Repeat Buyers",       value: "38",       color: "#a855f7" },
  { label: "Positive Feedback",   value: "98.2%",    color: "#ec4899" },
];

export function MktProfilePage() {
  return (
    <PageWrapper title="Marketplace Profile" breadcrumb="Account / Profile" accentColor="#f5c518">

      {/* ── Top section: identity card + stats grid ── */}
      <div className="flex flex-wrap justify-center gap-6 mb-8">

        {/* Identity card */}
        <div
          className="rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "#0c0a0a", border: "1px solid rgba(245,197,24,0.15)", minWidth: 280, width: 300, flexShrink: 0 }}
        >
          {/* Avatar + name + rank */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black"
              style={{ background: "linear-gradient(135deg,#1a1a0a,#2a2a10)", border: "2px solid rgba(245,197,24,0.5)", color: "#f5c518" }}
            >
              JH
            </div>
            <div>
              <h2 className="font-rajdhani font-black text-xl text-white">Jonah Hydell</h2>
              <span
                className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full"
                style={{ background: "rgba(245,197,24,0.12)", color: "#f5c518", border: "1px solid rgba(245,197,24,0.30)" }}
              >
                ⭐ Gold Seller
              </span>
            </div>
          </div>

          {/* Details */}
          {[
            ["Member Since",        "March 2024"],
            ["Account ID",          "#MKT-004421"],
            ["Email",               "jonah@example.com"],
            ["Seller Rating",       "4.9 / 5.0 ★"],
            ["Verification",        "✓ Verified"],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between items-center" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
              <span className="text-[11px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.30)" }}>{label}</span>
              <span
                className="text-[12px] font-semibold"
                style={{ color: label === "Verification" ? "#22c55e" : "rgba(255,255,255,0.70)" }}
              >
                {val}
              </span>
            </div>
          ))}

          <button
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider mt-2 transition-all duration-150"
            style={{ background: "rgba(245,197,24,0.12)", color: "#f5c518", border: "1px solid rgba(245,197,24,0.30)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,197,24,0.22)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(245,197,24,0.12)"; }}
          >
            Edit Profile
          </button>
        </div>

        {/* Stats grid — 4-col on wide, 2-col on narrow */}
        <div className="flex-1 grid grid-cols-2 xl:grid-cols-4 gap-4" style={{ minWidth: 280 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-4 py-4"
              style={{ background: "#0c0a0a", border: `1px solid ${s.color}22` }}
            >
              <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.30)" }}>{s.label}</p>
              <p
                className="text-2xl font-black tabular-nums"
                style={{ fontFamily: "'Orbitron', sans-serif", color: s.color, textShadow: `0 0 12px ${s.color}55` }}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Recent Marketplace Activity ── */}
      <SubHeader label="Recent Marketplace Activity" />
      <div className="rounded-2xl overflow-hidden mb-8" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {/* Header row */}
        <div
          className="grid px-5 py-2"
          style={{
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {["Item", "Type", "Time", "Value", "Status"].map(h => (
            <span key={h} className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.25)" }}>{h}</span>
          ))}
        </div>

        {recentActivity.map((a, i) => {
          const ss = statusStyle[a.status] ?? statusStyle.Tracking;
          return (
            <div
              key={i}
              className="grid items-center px-5 py-3 transition-colors duration-100 cursor-default"
              style={{
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                borderBottom: i < recentActivity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span className="font-rajdhani font-bold text-sm pr-4 truncate" style={{ color: "rgba(255,255,255,0.82)" }}>{a.item}</span>
              <span
                className="text-[11px] font-black uppercase tracking-wide"
                style={{ color: typeColor[a.type] }}
              >
                {a.type}
              </span>
              <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.32)" }}>{a.time}</span>
              <span
                className="text-sm font-black tabular-nums"
                style={{ color: a.value.startsWith("+") ? "#22c55e" : a.value.startsWith("-") ? "#ef4444" : "rgba(255,255,255,0.75)" }}
              >
                {a.value}
              </span>
              <span
                className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full w-fit"
                style={{ color: ss.color, background: ss.bg, border: `1px solid ${ss.border}` }}
              >
                {a.status}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Seller Performance ── */}
      <SubHeader label="Seller Performance" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {sellerPerf.map((s) => (
          <div
            key={s.label}
            className="rounded-xl px-4 py-4"
            style={{ background: "#0c0a0a", border: `1px solid ${s.color}22` }}
          >
            <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.30)" }}>{s.label}</p>
            <p
              className="text-xl font-black tabular-nums"
              style={{ fontFamily: "'Orbitron', sans-serif", color: s.color, textShadow: `0 0 10px ${s.color}55` }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </div>

    </PageWrapper>
  );
}
