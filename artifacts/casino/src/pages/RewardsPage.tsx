import { useState, useEffect } from "react";
import { PageWrapper, SubHeader, CardGrid } from "./shared";
import { useStore } from "../store";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import {
  getRewardsState,
  claimReward,
  subscribeRewards,
  TIERS,
  type RewardsState,
} from "../lib/rewardsState";

const AVAILABLE_REWARDS = [
  { id: 2, name: "10% Deposit Bonus",      cost: 500,  icon: "💰", color: "#f5c518" },
  { id: 3, name: "Free Lottery Ticket",    cost: 300,  icon: "🎫", color: "#22c55e" },
  { id: 4, name: "VIP Table Access (1hr)", cost: 1000, icon: "🃏", color: "#a855f7" },
  { id: 6, name: "Double XP Weekend",      cost: 800,  icon: "⚡", color: "#06b6d4" },
];

interface Toast { msg: string; ok: boolean; key: number }

export function RewardsPage() {
  const { playerId, sessionToken } = useStore();
  const { chips: liveChips } = usePlayerSocket(playerId ?? null, sessionToken);

  const [state, setState]   = useState<RewardsState>(getRewardsState);
  const [toast, setToast]   = useState<Toast | null>(null);

  useEffect(() => {
    setState(getRewardsState());
    return subscribeRewards(setState);
  }, []);

  function showToast(msg: string, ok: boolean) {
    const key = Date.now();
    setToast({ msg, ok, key });
    setTimeout(() => setToast(t => t?.key === key ? null : t), 3000);
  }

  function handleClaim(id: number, cost: number) {
    const result = claimReward(id, cost, liveChips ?? 0);
    if (result.ok) {
      showToast("Reward claimed!", true);
    } else if (result.reason === "already_claimed") {
      showToast("Reward already claimed", false);
    } else {
      showToast("Not enough reward points", false);
    }
  }

  const tierIdx = TIERS.findIndex((t) => t.name === state.tier);
  const curTier = TIERS[tierIdx] ?? TIERS[0];
  const nextTier = TIERS[tierIdx + 1] ?? null;

  const progress = nextTier
    ? Math.min(100, ((state.xp - curTier.minXP) / (nextTier.minXP - curTier.minXP)) * 100)
    : 100;

  return (
    <PageWrapper title="Rewards" breadcrumb="The Hub / Rewards" accentColor="#f5c518">

      {/* Toast */}
      {toast && (
        <div
          key={toast.key}
          className="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl text-[13px] font-bold shadow-xl pointer-events-none"
          style={{
            background: toast.ok ? "rgba(21,128,61,0.95)" : "rgba(153,27,27,0.95)",
            border: `1px solid ${toast.ok ? "#4ade80" : "#f87171"}44`,
            color: toast.ok ? "#4ade80" : "#fca5a5",
            animation: "fadeInDown 0.18s ease",
          }}
        >
          {toast.msg}
        </div>
      )}

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
            <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Reward Points</p>
            <p className="text-2xl font-black tabular-nums" style={{ color: "#f5c518", fontFamily: "'Orbitron', sans-serif" }}>
              {state.points.toLocaleString()}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Total XP</p>
            <p className="text-xl font-black tabular-nums" style={{ color: "rgba(255,255,255,0.55)", fontFamily: "'Orbitron', sans-serif" }}>
              {state.xp.toLocaleString()}
            </p>
          </div>
        </div>

        {nextTier ? (
          <div>
            <div className="flex justify-between mb-2 text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <span>{curTier.name} — {state.xp.toLocaleString()} XP</span>
              <span>{nextTier.name} — {nextTier.minXP.toLocaleString()} XP ({(nextTier.minXP - state.xp).toLocaleString()} to go)</span>
            </div>
            <div className="rounded-full h-2" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${curTier.color}, ${nextTier.color})`,
                  boxShadow: `0 0 8px ${nextTier.color}88`,
                }}
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between mb-2 text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              <span>Max tier reached — {state.xp.toLocaleString()} XP</span>
            </div>
            <div className="rounded-full h-2" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: "100%", background: `linear-gradient(90deg, ${curTier.color}, #fff)`, boxShadow: `0 0 8px ${curTier.color}88` }}
              />
            </div>
          </div>
        )}

        {/* Tier ladder */}
        <div className="flex items-center gap-2 mt-6 flex-wrap">
          {TIERS.map((t, i) => (
            <div key={t.name} className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold"
                style={{
                  background: i === tierIdx ? `${t.color}22` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${i === tierIdx ? `${t.color}55` : "rgba(255,255,255,0.08)"}`,
                  color: i <= tierIdx ? t.color : "rgba(255,255,255,0.30)",
                }}
              >
                <span>{t.icon}</span>
                <span>{t.name}</span>
                <span style={{ color: "rgba(255,255,255,0.25)", fontWeight: 400, fontSize: 10 }}>{t.minXP.toLocaleString()} XP</span>
              </div>
              {i < TIERS.length - 1 && <span style={{ color: "rgba(255,255,255,0.15)" }}>›</span>}
            </div>
          ))}
        </div>
      </div>

      <SubHeader label="Reward Shop" />
      <div
        className="rounded-2xl flex flex-col items-center justify-center gap-4 py-16"
        style={{ background: "#0c0a0a", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div style={{ fontSize: 48, lineHeight: 1 }}>🛒</div>
        <h3
          className="text-xl font-black uppercase tracking-widest"
          style={{ fontFamily: "'Orbitron', sans-serif", color: "rgba(255,255,255,0.35)" }}
        >
          Coming Soon
        </h3>
        <p className="text-[13px] text-center max-w-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
          The reward shop is under construction. Check back soon to spend your points.
        </p>
      </div>

    </PageWrapper>
  );
}
