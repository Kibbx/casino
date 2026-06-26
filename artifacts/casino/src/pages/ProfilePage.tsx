import { PageWrapper, SubHeader } from "./shared";

const stats = [
  { label: "Rounds Played", value: "3",        color: "#06b6d4" },
  { label: "Total Wagered", value: "514,200",   color: "#f97316", sub: "chips" },
  { label: "Total Won",     value: "+366,992",  color: "#f5c518", sub: "chips" },
  { label: "Largest Win",   value: "+320,892",  color: "#a855f7", sub: "chips" },
  { label: "Net Result",    value: "-147,208",  color: "#ef4444", sub: "chips" },
  { label: "Gems",          value: "0",         color: "#a855f7" },
];

const activity = [
  { label: "Bet",               count: "54x", value: "-514,200 chips", positive: false },
  { label: "Win",               count: "3x",  value: "+366,992 chips", positive: true  },
  { label: "Biggest Single Win",count: "—",   value: "+320,892 chips", positive: true  },
];

const cardDetails: [string, string, string?][] = [
  ["Member Since",  "Jun 25, 2026, 7:04 PM ET"],
  ["Stat ID",       "#1111"],
  ["Referral",      "1111"],
  ["Credit Score",  "300 — POOR", "red"],
  ["Chips",         "4,572,792",  "gold"],
  ["Gems",          "0",          "purple"],
];

export function ProfilePage() {
  return (
    <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">

      {/* ── Top row ─────────────────────────────────────────────────── */}
      <div className="flex gap-5 mb-6" style={{ alignItems: "stretch" }}>

        {/* User card */}
        <div
          className="flex flex-col gap-0 rounded-2xl overflow-hidden"
          style={{
            width: 240, flexShrink: 0,
            background: "#0c0a0a",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* Avatar + name */}
          <div className="flex items-center gap-3 p-5 pb-4">
            <div
              className="flex items-center justify-center rounded-full font-black text-xl shrink-0"
              style={{
                width: 60, height: 60,
                background: "linear-gradient(135deg,#1e0e06,#2c1506)",
                border: "2px solid rgba(232,64,10,0.55)",
                color: "#e8400a",
                letterSpacing: 1,
              }}
            >
              JH
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <span
                className="font-rajdhani font-black text-white leading-tight"
                style={{ fontSize: 17 }}
              >
                Jonah Hydell
              </span>
              <span
                className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full self-start leading-tight"
                style={{
                  background: "rgba(232,64,10,0.12)",
                  color: "#e8400a",
                  border: "1px solid rgba(232,64,10,0.28)",
                  letterSpacing: "0.06em",
                }}
              >
                Back Alley Bets Member
              </span>
            </div>
          </div>

          {/* Detail rows */}
          <div className="flex flex-col px-5 pb-4 gap-0 flex-1">
            {cardDetails.map(([label, val, accent]) => {
              const color =
                accent === "red"    ? "#ef4444" :
                accent === "gold"   ? "#f5c518" :
                accent === "purple" ? "#a855f7" :
                "rgba(255,255,255,0.68)";
              return (
                <div
                  key={label}
                  className="flex justify-between items-baseline py-2.5"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <span
                    className="text-[10px] uppercase tracking-widest shrink-0"
                    style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.1em" }}
                  >
                    {label}
                  </span>
                  <span
                    className="text-[11px] font-bold text-right ml-2"
                    style={{ color, maxWidth: 130 }}
                  >
                    {val}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Edit button */}
          <div className="px-5 pb-5">
            <button
              className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
              style={{
                background: "rgba(232,64,10,0.10)",
                color: "#e8400a",
                border: "1px solid rgba(232,64,10,0.40)",
                letterSpacing: "0.1em",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,64,10,0.18)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(232,64,10,0.10)")}
            >
              Edit Profile
            </button>
          </div>
        </div>

        {/* Stat cards grid */}
        <div className="flex-1 grid grid-cols-2 gap-3" style={{ minWidth: 0 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl flex flex-col justify-between"
              style={{
                background: "#0c0a0a",
                border: `1px solid ${s.color}20`,
                padding: "18px 20px 16px",
              }}
            >
              <p
                className="text-[10px] uppercase tracking-widest mb-2"
                style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.12em" }}
              >
                {s.label}
              </p>
              <p
                className="font-black tabular-nums leading-none"
                style={{
                  fontFamily: "'Orbitron', monospace",
                  fontSize: "clamp(18px, 2.2vw, 28px)",
                  color: s.color,
                  textShadow: `0 0 16px ${s.color}55`,
                }}
              >
                {s.value}
              </p>
              {s.sub && (
                <p
                  className="text-[10px] mt-1.5"
                  style={{ color: "rgba(255,255,255,0.22)" }}
                >
                  {s.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Activity ────────────────────────────────────────────────── */}
      <SubHeader label="Recent Activity" />
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {activity.map((row, i) => (
          <div
            key={i}
            className="flex items-center px-5 py-3.5 gap-4 transition-colors duration-100"
            style={{
              borderBottom: i < activity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            {/* Label */}
            <span
              className="font-rajdhani font-bold text-sm"
              style={{ color: "rgba(255,255,255,0.78)", minWidth: 150 }}
            >
              {row.label}
            </span>

            {/* Count pill */}
            <span
              className="text-[11px] font-black px-2.5 py-0.5 rounded-full"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.38)",
                border: "1px solid rgba(255,255,255,0.08)",
                minWidth: 32, textAlign: "center",
              }}
            >
              {row.count}
            </span>

            {/* Spacer */}
            <span className="flex-1" />

            {/* Value */}
            <span
              className="text-sm font-black tabular-nums"
              style={{ color: row.positive ? "#22c55e" : "#ef4444", minWidth: 140, textAlign: "right" }}
            >
              {row.value}
            </span>

            {/* Badge */}
            <span
              className="text-[9px] font-black uppercase px-2.5 py-1 rounded-full"
              style={{
                color: row.positive ? "#22c55e" : "#ef4444",
                background: row.positive ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${row.positive ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                letterSpacing: "0.08em",
                minWidth: 40, textAlign: "center",
              }}
            >
              {row.positive ? "WIN" : "LOSS"}
            </span>
          </div>
        ))}
      </div>

    </PageWrapper>
  );
}
