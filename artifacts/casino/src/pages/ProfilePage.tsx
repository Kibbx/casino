import { PageWrapper, SubHeader } from "./shared";

const stats = [
  { label: "Games Played", value: "187",    color: "#06b6d4" },
  { label: "Win Rate",     value: "55%",    color: "#22c55e" },
  { label: "Total Won",    value: "+$28,400", color: "#f5c518" },
  { label: "Largest Win",  value: "$6,500", color: "#a855f7" },
  { label: "Current Streak", value: "W3",   color: "#f97316" },
  { label: "Reward Points", value: "800",   color: "#ec4899" },
];

const recentActivity = [
  { game: "Blackjack",    result: "+$220",  date: "12 min ago",  won: true },
  { game: "Lucky Slots",  result: "-$80",   date: "34 min ago",  won: false },
  { game: "Roulette",     result: "+$650",  date: "1 hr ago",    won: true },
  { game: "Horse Racing", result: "-$200",  date: "2 hr ago",    won: false },
  { game: "Baccarat",     result: "+$1,200",date: "Yesterday",   won: true },
];

export function ProfilePage() {
  return (
    <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
      <div className="flex flex-wrap justify-center gap-6 mb-8">
        {/* User card */}
        <div
          className="rounded-2xl p-6 flex flex-col gap-4"
          style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.08)", minWidth: 280, width: 300, flexShrink: 0 }}
        >
          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black"
              style={{ background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "2px solid rgba(232,64,10,0.5)", color: "#e8400a" }}
            >
              JH
            </div>
            <div>
              <h2 className="font-rajdhani font-black text-xl text-white">Jonah Hydell</h2>
              <span
                className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full"
                style={{ background: "rgba(156,163,175,0.15)", color: "#9ca3af", border: "1px solid rgba(156,163,175,0.3)" }}
              >
                🥈 Silver Member
              </span>
            </div>
          </div>

          {/* Details */}
          {[
            ["Member Since", "March 2024"],
            ["Account ID", "#BAB-004421"],
            ["Email", "jonah@example.com"],
            ["Status", "Active"],
          ].map(([label, val]) => (
            <div key={label} className="flex justify-between items-center" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}>
              <span className="text-[11px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.30)" }}>{label}</span>
              <span className="text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.70)" }}>{val}</span>
            </div>
          ))}

          <button
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider mt-2 transition-all duration-150"
            style={{ background: "rgba(232,64,10,0.15)", color: "#e8400a", border: "1px solid rgba(232,64,10,0.35)" }}
          >
            Edit Profile
          </button>
        </div>

        {/* Stats grid */}
        <div className="flex-1 grid grid-cols-2 gap-4" style={{ minWidth: 280 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-4 py-4"
              style={{ background: "#0c0a0a", border: `1px solid ${s.color}22` }}
            >
              <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "rgba(255,255,255,0.30)" }}>{s.label}</p>
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

      <SubHeader label="Recent Activity" />
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {recentActivity.map((a, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-5 py-3 transition-colors duration-100"
            style={{ borderBottom: i < recentActivity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <span className="font-rajdhani font-bold text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>{a.game}</span>
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.30)" }}>{a.date}</span>
            <span className="text-sm font-black tabular-nums" style={{ color: a.won ? "#22c55e" : "#ef4444" }}>{a.result}</span>
            <span
              className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full"
              style={{
                color: a.won ? "#22c55e" : "#ef4444",
                background: a.won ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${a.won ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
              }}
            >
              {a.won ? "WON" : "LOST"}
            </span>
          </div>
        ))}
      </div>
    </PageWrapper>
  );
}
