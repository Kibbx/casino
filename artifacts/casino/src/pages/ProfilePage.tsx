import { PageWrapper, SubHeader } from "./shared";

const stats = [
  { label: "Rounds Played",  value: "3",              color: "#06b6d4" },
  { label: "Total Wagered",  value: "514,200",        color: "#f97316", suffix: " chips" },
  { label: "Total Won",      value: "+366,992",       color: "#f5c518", suffix: " chips" },
  { label: "Largest Win",    value: "+320,892",       color: "#a855f7", suffix: " chips" },
  { label: "Net Result",     value: "-147,208",       color: "#ef4444", suffix: " chips" },
  { label: "Gems",           value: "0",              color: "#a855f7" },
];

const overview = [
  { label: "Bet",              count: "54x",  value: "-514,200 chips", positive: false },
  { label: "Win",              count: "3x",   value: "+366,992 chips", positive: true  },
  { label: "Biggest Single Win", count: "",   value: "+320,892 chips", positive: true  },
];

export function ProfilePage() {
  return (
    <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
      <div className="flex flex-wrap justify-center gap-6 mb-8">

        {/* ── User card ───────────────────────────────────────── */}
        <div
          className="rounded-2xl p-6 flex flex-col gap-4"
          style={{
            background: "#0c0a0a",
            border: "1px solid rgba(255,255,255,0.08)",
            minWidth: 280, width: 300, flexShrink: 0,
          }}
        >
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black"
              style={{
                background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)",
                border: "2px solid rgba(232,64,10,0.5)",
                color: "#e8400a",
              }}
            >
              J
            </div>
            <div>
              <h2 className="font-rajdhani font-black text-xl text-white">Jonah Hydell</h2>
              <span
                className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(232,64,10,0.12)",
                  color: "#e8400a",
                  border: "1px solid rgba(232,64,10,0.30)",
                }}
              >
                Back Alley Bets Member
              </span>
            </div>
          </div>

          {/* Detail rows */}
          {[
            ["Member Since",   "Jun 25, 2026, 7:04 PM ET"],
            ["Stat ID",        "#1111"],
            ["Referral",       "1111"],
            ["Credit Score",   "300 — POOR"],
          ].map(([label, val]) => (
            <div
              key={label}
              className="flex justify-between items-center"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 12 }}
            >
              <span
                className="text-[11px] uppercase tracking-wider"
                style={{ color: "rgba(255,255,255,0.30)" }}
              >
                {label}
              </span>
              <span
                className="text-[12px] font-semibold text-right"
                style={{
                  color: label === "Credit Score" ? "#ef4444" : "rgba(255,255,255,0.70)",
                  maxWidth: 160,
                }}
              >
                {val}
              </span>
            </div>
          ))}

          {/* Chips & Gems mini row */}
          <div
            className="flex justify-between items-center gap-3 pt-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="flex flex-col items-center flex-1 gap-0.5">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.28)" }}>Chips</span>
              <span className="text-sm font-black tabular-nums" style={{ color: "#f5c518", textShadow: "0 0 10px rgba(245,197,24,0.5)" }}>
                4,572,792
              </span>
            </div>
            <div style={{ width: 1, height: 32, background: "rgba(255,255,255,0.06)" }} />
            <div className="flex flex-col items-center flex-1 gap-0.5">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.28)" }}>Gems</span>
              <span className="text-sm font-black tabular-nums" style={{ color: "#a855f7", textShadow: "0 0 10px rgba(168,85,247,0.5)" }}>
                0
              </span>
            </div>
          </div>

          <button
            className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider mt-1 transition-all duration-150"
            style={{
              background: "rgba(232,64,10,0.15)",
              color: "#e8400a",
              border: "1px solid rgba(232,64,10,0.35)",
            }}
          >
            Edit Profile
          </button>
        </div>

        {/* ── Stats grid ──────────────────────────────────────── */}
        <div className="flex-1 grid grid-cols-2 gap-4" style={{ minWidth: 280 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-4 py-4"
              style={{ background: "#0c0a0a", border: `1px solid ${s.color}22` }}
            >
              <p
                className="text-[10px] uppercase tracking-widest mb-1"
                style={{ color: "rgba(255,255,255,0.30)" }}
              >
                {s.label}
              </p>
              <p
                className="text-2xl font-black tabular-nums"
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  color: s.color,
                  textShadow: `0 0 12px ${s.color}55`,
                }}
              >
                {s.value}
              </p>
              {s.suffix && (
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>
                  {s.suffix}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Overview ──────────────────────────────────────────── */}
      <SubHeader label="Overview" />
      <div
        className="rounded-2xl overflow-hidden mb-8"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {overview.map((row, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-5 py-3 transition-colors duration-100"
            style={{
              borderBottom: i < overview.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <span
              className="font-rajdhani font-bold text-sm w-40"
              style={{ color: "rgba(255,255,255,0.75)" }}
            >
              {row.label}
            </span>
            {row.count ? (
              <span
                className="text-[11px] font-black px-2 py-0.5 rounded-full"
                style={{
                  color: "rgba(255,255,255,0.45)",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {row.count}
              </span>
            ) : <span />}
            <span
              className="text-sm font-black tabular-nums"
              style={{ color: row.positive ? "#22c55e" : "#ef4444" }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </PageWrapper>
  );
}
