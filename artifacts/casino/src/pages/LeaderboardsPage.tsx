import { PageWrapper, SubHeader } from "./shared";

const leaders = [
  { rank: 1,  name: "ShadowAce",    games: 412, winRate: 68, winnings: "+$124,500", tier: "Diamond", tierColor: "#7dd3fc" },
  { rank: 2,  name: "NeonKing",     games: 387, winRate: 64, winnings: "+$98,200",  tier: "Diamond", tierColor: "#7dd3fc" },
  { rank: 3,  name: "VaultBreaker", games: 521, winRate: 61, winnings: "+$76,800",  tier: "Platinum", tierColor: "#e2e8f0" },
  { rank: 4,  name: "GhostBet",     games: 298, winRate: 72, winnings: "+$61,300",  tier: "Platinum", tierColor: "#e2e8f0" },
  { rank: 5,  name: "RedlineRoll",  games: 445, winRate: 59, winnings: "+$44,900",  tier: "Gold",    tierColor: "#f5c518" },
  { rank: 6,  name: "Jonah Hydell", games: 187, winRate: 55, winnings: "+$28,400",  tier: "Silver",  tierColor: "#9ca3af", isUser: true },
  { rank: 7,  name: "CardShark99",  games: 356, winRate: 53, winnings: "+$21,700",  tier: "Gold",    tierColor: "#f5c518" },
  { rank: 8,  name: "LuckyStrike",  games: 264, winRate: 50, winnings: "+$18,100",  tier: "Silver",  tierColor: "#9ca3af" },
  { rank: 9,  name: "BetMaster",    games: 198, winRate: 49, winnings: "+$12,600",  tier: "Silver",  tierColor: "#9ca3af" },
  { rank: 10, name: "AceHigh",      games: 143, winRate: 47, winnings: "+$8,900",   tier: "Bronze",  tierColor: "#cd7f32" },
];

const rankColors: Record<number, string> = { 1: "#f5c518", 2: "#9ca3af", 3: "#cd7f32" };

const tabs = ["Total Winnings", "Win Rate", "Games Played"];

export function LeaderboardsPage() {
  return (
    <PageWrapper title="Leaderboards" breadcrumb="The Hub / Leaderboards" accentColor="#a855f7">
      {/* Tab row */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
            style={{
              background: i === 0 ? "rgba(168,85,247,0.18)" : "rgba(255,255,255,0.04)",
              color: i === 0 ? "#a855f7" : "rgba(255,255,255,0.40)",
              border: `1px solid ${i === 0 ? "rgba(168,85,247,0.45)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Header */}
        <div
          className="grid px-6 py-3 text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.30)",
            gridTemplateColumns: "48px 1fr 80px 80px 120px 120px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span>Rank</span><span>Player</span><span>Games</span><span>Win %</span><span>Tier</span><span className="text-right">Total Won</span>
        </div>

        {leaders.map((p, i) => (
          <div
            key={p.rank}
            className="grid px-6 py-4 items-center transition-colors duration-100"
            style={{
              gridTemplateColumns: "48px 1fr 80px 80px 120px 120px",
              borderBottom: i < leaders.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              background: p.isUser ? "rgba(168,85,247,0.08)" : "transparent",
            }}
            onMouseEnter={e => { if (!p.isUser) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)"; }}
            onMouseLeave={e => { if (!p.isUser) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            {/* Rank */}
            <div className="flex items-center">
              {p.rank <= 3 ? (
                <span className="text-xl">{["🥇","🥈","🥉"][p.rank - 1]}</span>
              ) : (
                <span className="text-sm font-black tabular-nums" style={{ color: "rgba(255,255,255,0.35)" }}>#{p.rank}</span>
              )}
            </div>

            {/* Name */}
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black"
                style={{
                  background: `${rankColors[p.rank] ?? p.tierColor}22`,
                  border: `1px solid ${rankColors[p.rank] ?? p.tierColor}44`,
                  color: rankColors[p.rank] ?? p.tierColor,
                  flexShrink: 0,
                }}
              >
                {p.name[0]}
              </div>
              <span
                className="font-rajdhani font-bold text-sm"
                style={{ color: p.isUser ? "#a855f7" : "rgba(255,255,255,0.85)" }}
              >
                {p.name}{p.isUser && <span className="ml-1 text-[10px] opacity-60">(you)</span>}
              </span>
            </div>

            <span className="text-sm tabular-nums" style={{ color: "rgba(255,255,255,0.50)" }}>{p.games}</span>
            <span className="text-sm tabular-nums font-bold" style={{ color: p.winRate >= 60 ? "#22c55e" : "rgba(255,255,255,0.65)" }}>{p.winRate}%</span>

            {/* Tier */}
            <span
              className="text-[11px] font-black uppercase px-2 py-0.5 rounded-full w-fit"
              style={{ color: p.tierColor, background: `${p.tierColor}18`, border: `1px solid ${p.tierColor}33` }}
            >
              {p.tier}
            </span>

            <span className="text-sm font-black tabular-nums text-right" style={{ color: "#22c55e" }}>{p.winnings}</span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11px] text-center" style={{ color: "rgba(255,255,255,0.25)" }}>
        Rankings update every 24 hours · Season resets on Jul 1
      </p>
    </PageWrapper>
  );
}
