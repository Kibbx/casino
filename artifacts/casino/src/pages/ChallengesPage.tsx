import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { PageWrapper, SubHeader, CardGrid } from "./shared";
import {
  getChallengeStates,
  markClaimed,
  CHALLENGES_EVENT,
  type ChallengeDefinition,
  type ChallengeState,
} from "../lib/challengeService";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type FullChallenge = ChallengeDefinition & ChallengeState;

// ── Challenge Card ─────────────────────────────────────────────────────────────

function ChallengeCard({
  c,
  onClaim,
  claiming,
}: {
  c: FullChallenge;
  onClaim: () => void;
  claiming: boolean;
}) {
  const pct      = Math.min(100, Math.round((c.progress / c.total) * 100));
  const done     = pct >= 100;
  const canClaim = done && !c.claimed && !claiming;

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
            <h3
              className="font-rajdhani font-black text-sm uppercase tracking-wider"
              style={{ color: done ? c.color : "rgba(255,255,255,0.85)" }}
            >
              {c.name}
            </h3>
            {c.limited && (
              <span
                className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase"
                style={{ background: "#7c3aed", color: "#fff" }}
              >
                LIMITED
              </span>
            )}
          </div>
          <p className="text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.40)" }}>
            {c.desc}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between mb-1">
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
            {done
              ? "COMPLETED ✓"
              : c.total >= 1000
              ? `${c.progress.toLocaleString()} / ${c.total.toLocaleString()}`
              : `${c.progress} / ${c.total}`}
          </span>
          <span className="text-[10px] font-bold" style={{ color: "#f5c518" }}>
            🪙 {c.reward.toLocaleString()}
          </span>
        </div>
        <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-1.5 rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: c.color,
              boxShadow: done ? `0 0 6px ${c.color}` : "none",
            }}
          />
        </div>
      </div>

      <button
        onClick={canClaim ? onClaim : undefined}
        disabled={!canClaim}
        className="w-full py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
        style={{
          background:  c.claimed ? "transparent" : done ? c.color : "transparent",
          color:       c.claimed ? "rgba(255,255,255,0.28)" : done ? "#060404" : c.color,
          border:      `1px solid ${c.claimed ? "rgba(255,255,255,0.1)" : `${c.color}44`}`,
          cursor:      canClaim ? "pointer" : "not-allowed",
          opacity:     claiming ? 0.6 : 1,
        }}
      >
        {claiming ? "Claiming…" : c.claimed ? "✓ Claimed" : done ? "Claim Reward" : "In Progress"}
      </button>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function ChallengesPage() {
  const { sessionToken, playerId } = useStore();

  const [challenges, setChallenges] = useState<FullChallenge[]>([]);
  const [claiming,   setClaiming]   = useState<string | null>(null);
  const [claimMsg,   setClaimMsg]   = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(() => {
    setChallenges(getChallengeStates(playerId));
  }, [playerId]);

  useEffect(() => {
    refresh();
    window.addEventListener(CHALLENGES_EVENT, refresh);
    return () => window.removeEventListener(CHALLENGES_EVENT, refresh);
  }, [refresh]);

  async function handleClaim(c: FullChallenge) {
    if (!sessionToken || claiming || c.claimed) return;
    setClaiming(c.id);
    try {
      const res = await fetch(`${BASE}/api/challenges/claim-reward`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ amount: c.reward, challengeId: c.id, label: c.name }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        markClaimed(c.id);
        setClaimMsg({ ok: true, text: `+${c.reward.toLocaleString()} chips added to your balance!` });
      } else {
        setClaimMsg({ ok: false, text: (body as any).error ?? "Claim failed — try again." });
      }
    } catch {
      setClaimMsg({ ok: false, text: "Network error — try again." });
    }
    setClaiming(null);
    setTimeout(() => setClaimMsg(null), 3500);
  }

  const daily   = challenges.filter(c => c.category === "daily");
  const weekly  = challenges.filter(c => c.category === "weekly");
  const monthly = challenges.filter(c => c.category === "monthly");
  const special = challenges.filter(c => c.category === "special");

  return (
    <PageWrapper title="Challenges" breadcrumb="The Hub / Challenges" accentColor="#ec4899">

      {/* Claim toast */}
      {claimMsg && (
        <div
          style={{
            background:   claimMsg.ok ? "rgba(34,197,94,0.10)"  : "rgba(239,68,68,0.10)",
            border:      `1px solid ${claimMsg.ok ? "rgba(34,197,94,0.30)" : "rgba(239,68,68,0.30)"}`,
            color:        claimMsg.ok ? "#4ade80" : "#fca5a5",
            borderRadius: 10,
            padding:      "10px 18px",
            fontSize:     13,
            fontWeight:   700,
            marginBottom: 20,
            textAlign:    "center",
          }}
        >
          {claimMsg.text}
        </div>
      )}

      <SubHeader label="Daily Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16} className="mb-10">
        {daily.map(c => (
          <ChallengeCard key={c.id} c={c} onClaim={() => handleClaim(c)} claiming={claiming === c.id} />
        ))}
      </CardGrid>

      <SubHeader label="Weekly Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16} className="mb-10">
        {weekly.map(c => (
          <ChallengeCard key={c.id} c={c} onClaim={() => handleClaim(c)} claiming={claiming === c.id} />
        ))}
      </CardGrid>

      <SubHeader label="Monthly Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16} className="mb-10">
        {monthly.map(c => (
          <ChallengeCard key={c.id} c={c} onClaim={() => handleClaim(c)} claiming={claiming === c.id} />
        ))}
      </CardGrid>

      <SubHeader label="Special Challenges" />
      <CardGrid minItemWidth={240} maxItemWidth={280} gap={16}>
        {special.map(c => (
          <ChallengeCard key={c.id} c={c} onClaim={() => handleClaim(c)} claiming={claiming === c.id} />
        ))}
      </CardGrid>

    </PageWrapper>
  );
}
