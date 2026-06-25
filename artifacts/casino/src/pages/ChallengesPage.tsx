import { PageWrapper, SubHeader, CardGrid } from "./shared";

const dailyChallenges = [
  { id: 1, icon: "🃏", name: "High Roller", desc: "Play 5 rounds of Blackjack", progress: 3, total: 5, reward: 50, color: "#22c55e" },
  { id: 2, icon: "🎡", name: "Spin Doctor",  desc: "Spin the Roulette wheel 3 times", progress: 3, total: 3, reward: 75, color: "#f97316", done: true },
  { id: 3, icon: "💰", name: "Big Bettor",   desc: "Place a single bet over $100", progress: 0, total: 1, reward: 100, color: "#f5c518" },
];

const weeklyChallenges = [
  { id: 4, icon: "🏆", name: "Tournament Regular", desc: "Enter 3 tournaments this week", progress: 1, total: 3, reward: 400, color: "#a855f7" },
  { id: 5, icon: "🎰", name: "Mini Game Marathon",  desc: "Play 20 rounds of any mini game", progress: 8, total: 20, reward: 250, color: "#ec4899" },
  { id: 6, icon: "🤝", name: "Social Butterfly",    desc: "Play at full tables 5 times", progress: 2, total: 5, reward: 300, color: "#06b6d4" },
];

const specialChallenges = [
  { id: 7, icon: "👑", name: "The Diamond Run", desc: "Win 10 consecutive bets — legendary streak", progress: 4, total: 10, reward: 2000, color: "#7dd3fc", limited: true },
  { id: 8, icon: "🔥", name: "On Fire",          desc: "Win $1,000 in a single session", progress: 620, total: 1000, reward: 500, color: "#f97316", limited: true },
];

function ChallengeCard({ c }: { c: { id: number; icon: string; name: string; desc: string; progress: number; total: number; reward: number; color: string; done?: boolean; limited?: boolean } }) {
  const pct = Math.min(100, Math.round((c.progress / c.total) * 100));
  const done = c.done || pct === 100;
  return (
    <div
      className="rounded-xl px-4 py-4 flex flex-col gap-3"
      style={{
        background: done ? `${c.color}0d` : "#0c0a0a",
        border: `1px solid ${done ? `${c.color}55` : `${c.color}22`}`,
        width: 260,
        minWidth: 240,
        flexShrink: 0,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0">{c.icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-rajdhani font-black text-sm uppercase tracking-wider" style={{ color: done ? c.color : "rgba(255,255,255,0.85)" }}>
              {c.name}
            </h3>
            {c.limited && (
              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase" style={{ background: "#7c3aed", color: "#fff" }}>LIMITED</span>
            )}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.40)" }}>{c.desc}</p>
        </div>
      </div>

      {/* Progress */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            {done ? "COMPLETED ✓" : `${c.progress} / ${c.total}`}
          </span>
          <span className="text-[10px] font-bold" style={{ color: "#f5c518" }}>🪙 {c.reward}</span>
        </div>
        <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{ width: `${pct}%`, background: c.color, boxShadow: done ? `0 0 6px ${c.color}` : "none" }}
          />
        </div>
      </div>

      <button
        className="w-full py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
        style={{
          background: done ? c.color : "transparent",
          color: done ? "#060404" : c.color,
          border: `1px solid ${c.color}44`,
        }}
      >
        {done ? "Claim Reward" : "In Progress"}
      </button>
    </div>
  );
}

export function ChallengesPage() {
  return (
    <PageWrapper title="Challenges" breadcrumb="The Hub / Challenges" accentColor="#ec4899">
      <SubHeader label="Daily Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16} className="mb-10">
        {dailyChallenges.map((c) => <ChallengeCard key={c.id} c={c} />)}
      </CardGrid>

      <SubHeader label="Weekly Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16} className="mb-10">
        {weeklyChallenges.map((c) => <ChallengeCard key={c.id} c={c} />)}
      </CardGrid>

      <SubHeader label="Special Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16}>
        {specialChallenges.map((c) => <ChallengeCard key={c.id} c={c} />)}
      </CardGrid>
    </PageWrapper>
  );
}
