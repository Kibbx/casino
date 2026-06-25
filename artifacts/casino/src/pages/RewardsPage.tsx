import { PageWrapper, SubHeader, CardGrid } from "./shared";

const tiers = [
  { name: "Bronze",   min: 0,      max: 500,   color: "#cd7f32", icon: "🥉" },
  { name: "Silver",   min: 500,    max: 1500,  color: "#9ca3af", icon: "🥈" },
  { name: "Gold",     min: 1500,   max: 5000,  color: "#f5c518", icon: "🥇" },
  { name: "Platinum", min: 5000,   max: 15000, color: "#e2e8f0", icon: "💎" },
  { name: "Diamond",  min: 15000,  max: null,  color: "#7dd3fc", icon: "👑" },
];

const currentPoints = 800;
const currentTierIdx = 1; // Silver

const availableRewards = [
  { id: 1, name: "Spin the Bonus Wheel",  cost: 200, icon: "🎡", color: "#f97316" },
  { id: 2, name: "10% Deposit Bonus",     cost: 500, icon: "💰", color: "#f5c518" },
  { id: 3, name: "Free Lottery Ticket",   cost: 300, icon: "🎫", color: "#22c55e" },
  { id: 4, name: "VIP Table Access (1hr)", cost: 1000, icon: "🃏", color: "#a855f7" },
  { id: 5, name: "Custom Avatar Border",  cost: 150,  icon: "🎨", color: "#ec4899" },
  { id: 6, name: "Double XP Weekend",     cost: 800,  icon: "⚡", color: "#06b6d4" },
];

export function RewardsPage() {
  const curTier = tiers[currentTierIdx];
  const nextTier = tiers[currentTierIdx + 1];
  const progress = nextTier
    ? ((currentPoints - curTier.min) / (nextTier.min - curTier.min)) * 100
    : 100;

  return (
    <PageWrapper title="Rewards" breadcrumb="The Hub / Rewards" accentColor="#f5c518">
      {/* Tier progress card */}
      <div
        className="rounded-2xl p-6 mb-8"
        style={{ background: "#0c0a0a", border: "1px solid rgba(245,197,24,0.2)", boxShadow: "0 0 30px rgba(245,197,24,0.06)" }}
      >
        <div className="flex items-center gap-4 mb-6">
          <div className="text-4xl">{curTier.icon}</div>
          <div>
            <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Current Tier</p>
            <h2 className="text-2xl font-black uppercase" style={{ fontFamily: "'Orbitron', sans-serif", color: curTier.color }}>
              {curTier.name} Member
            </h2>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Points</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: "#f5c518", fontFamily: "'Orbitron', sans-serif" }}>
              {currentPoints.toLocaleString()}
            </p>
          </div>
        </div>

        {nextTier && (
          <div>
            <div className="flex justify-between mb-2 text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <span>{curTier.name} — {currentPoints} pts</span>
              <span>{nextTier.name} — {nextTier.min} pts ({nextTier.min - currentPoints} to go)</span>
            </div>
            <div className="rounded-full h-2" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-2 rounded-full transition-all"
                style={{ width: `${progress}%`, background: `linear-gradient(90deg, ${curTier.color}, ${nextTier.color})`, boxShadow: `0 0 8px ${nextTier.color}88` }}
              />
            </div>
          </div>
        )}

        {/* Tier ladder */}
        <div className="flex items-center gap-2 mt-6 flex-wrap">
          {tiers.map((t, i) => (
            <div key={t.name} className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold"
                style={{
                  background: i === currentTierIdx ? `${t.color}22` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${i === currentTierIdx ? `${t.color}55` : "rgba(255,255,255,0.08)"}`,
                  color: i <= currentTierIdx ? t.color : "rgba(255,255,255,0.30)",
                }}
              >
                <span>{t.icon}</span>
                <span>{t.name}</span>
              </div>
              {i < tiers.length - 1 && <span style={{ color: "rgba(255,255,255,0.15)" }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      <SubHeader label="Available Rewards" />
      <CardGrid minItemWidth={180} maxItemWidth={220} gap={16}>
        {availableRewards.map((r) => {
          const canAfford = currentPoints >= r.cost;
          return (
            <div
              key={r.id}
              className="rounded-xl px-5 py-4 flex flex-col gap-3"
              style={{ background: "#0c0a0a", border: `1px solid ${r.color}22`, width: 200, minWidth: 180, flexShrink: 0 }}
            >
              <div className="text-3xl">{r.icon}</div>
              <p className="text-[13px] font-bold leading-snug" style={{ color: "rgba(255,255,255,0.80)" }}>{r.name}</p>
              <div className="flex items-center justify-between mt-auto">
                <span className="text-[12px] font-black" style={{ color: "#f5c518" }}>🪙 {r.cost}</span>
                <button
                  className="px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
                  style={{
                    background: canAfford ? r.color : "rgba(255,255,255,0.06)",
                    color: canAfford ? "#060404" : "rgba(255,255,255,0.25)",
                    cursor: canAfford ? "pointer" : "default",
                  }}
                  disabled={!canAfford}
                >
                  Claim
                </button>
              </div>
            </div>
          );
        })}
      </CardGrid>
    </PageWrapper>
  );
}
