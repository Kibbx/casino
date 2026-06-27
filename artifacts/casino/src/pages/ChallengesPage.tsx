import { useState, useEffect, useCallback, useRef } from "react";
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

// Custom event fired after a successful RP claim so the lobby header updates
export const RP_UPDATE_EVENT = "bab:rp:update";

type FullChallenge = ChallengeDefinition & ChallengeState;

// ── Toast notification ────────────────────────────────────────────────────────

interface ToastData {
  id:      number;
  ok:      boolean;
  title:   string;
  sub:     string;
}

function ClaimToast({ toast, onDone }: { toast: ToastData; onDone: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showT  = requestAnimationFrame(() => setVisible(true));
    const hideT  = setTimeout(() => setVisible(false), 3_200);
    const doneT  = setTimeout(onDone,                  3_800);
    return () => {
      cancelAnimationFrame(showT);
      clearTimeout(hideT);
      clearTimeout(doneT);
    };
  }, [onDone]);

  const borderColor = toast.ok ? "rgba(34,197,94,0.35)"  : "rgba(239,68,68,0.35)";
  const titleColor  = toast.ok ? "#4ade80"               : "#fca5a5";
  const bgColor     = toast.ok ? "rgba(34,197,94,0.10)"  : "rgba(239,68,68,0.10)";

  return (
    <div
      style={{
        position:   "fixed",
        bottom:     28,
        right:      28,
        zIndex:     9999,
        minWidth:   240,
        maxWidth:   340,
        padding:    "14px 18px",
        borderRadius: 12,
        background: bgColor,
        border:     `1px solid ${borderColor}`,
        backdropFilter: "blur(12px)",
        boxShadow:  "0 8px 32px rgba(0,0,0,0.55)",
        transform:  visible ? "translateX(0)"    : "translateX(calc(100% + 36px))",
        opacity:    visible ? 1                  : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease",
        pointerEvents: "none",
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18, lineHeight: 1 }}>
          {toast.ok ? "🎉" : "⚠️"}
        </span>
        <span
          style={{
            color:      titleColor,
            fontSize:   14,
            fontWeight: 900,
            fontFamily: "Rajdhani, sans-serif",
            letterSpacing: "0.03em",
            lineHeight: 1,
          }}
        >
          {toast.title}
        </span>
      </div>
      <p
        style={{
          color:      "rgba(255,255,255,0.55)",
          fontSize:   11,
          fontWeight: 600,
          margin:     0,
          paddingLeft: 26,
        }}
      >
        {toast.sub}
      </p>
    </div>
  );
}

// ── Reward pill ───────────────────────────────────────────────────────────────

function RewardDisplay({ reward, rewardPoints }: { reward: number; rewardPoints?: number }) {
  const hasRP = (rewardPoints ?? 0) > 0;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Chips */}
      <span
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 11, fontWeight: 800,
          color: "#f5c518",
        }}
      >
        🪙 {reward.toLocaleString()} Chips
      </span>

      {/* RP — only shown when present */}
      {hasRP && (
        <>
          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>+</span>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 800,
              color: "#a78bfa",
            }}
          >
            ⭐ {(rewardPoints!).toLocaleString()} RP
          </span>
        </>
      )}
    </div>
  );
}

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
  const hasRP    = (c.rewardPoints ?? 0) > 0;

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
        <div className="flex justify-between items-start mb-1 gap-2">
          <span className="text-[10px] shrink-0" style={{ color: "rgba(255,255,255,0.35)" }}>
            {done
              ? "COMPLETED ✓"
              : c.total >= 1000
              ? `${c.progress.toLocaleString()} / ${c.total.toLocaleString()}`
              : `${c.progress} / ${c.total}`}
          </span>
          <RewardDisplay reward={c.reward} rewardPoints={c.rewardPoints} />
        </div>
        <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-1.5 rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: hasRP
                ? `linear-gradient(90deg, ${c.color}, #a78bfa)`
                : c.color,
              boxShadow: done
                ? hasRP
                  ? `0 0 8px ${c.color}, 0 0 4px #a78bfa`
                  : `0 0 6px ${c.color}`
                : "none",
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
  const [toasts,     setToasts]     = useState<ToastData[]>([]);
  const toastId = useRef(0);

  const refresh = useCallback(() => {
    setChallenges(getChallengeStates(playerId));
  }, [playerId]);

  useEffect(() => {
    refresh();
    window.addEventListener(CHALLENGES_EVENT, refresh);
    return () => window.removeEventListener(CHALLENGES_EVENT, refresh);
  }, [refresh]);

  function pushToast(ok: boolean, title: string, sub: string) {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, ok, title, sub }]);
  }

  function removeToast(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

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
        body: JSON.stringify({
          amount:       c.reward,
          rewardPoints: c.rewardPoints ?? 0,
          challengeId:  c.id,
          label:        c.name,
        }),
      });
      const body = await res.json().catch(() => ({})) as any;

      if (res.ok) {
        markClaimed(c.id);

        // Notify lobby header to update RP balance
        if (body.newRewardPoints !== undefined) {
          window.dispatchEvent(
            new CustomEvent(RP_UPDATE_EVENT, { detail: { rp: body.newRewardPoints } })
          );
        }

        // Build toast message
        const rp = c.rewardPoints ?? 0;
        const chipsLabel = `🪙 +${c.reward.toLocaleString()} Chips`;
        const rpLabel    = rp > 0 ? `  ⭐ +${rp.toLocaleString()} RP` : "";
        pushToast(
          true,
          `${chipsLabel}${rpLabel}`,
          `${c.name} — Reward Claimed`,
        );
      } else if (res.status === 409) {
        markClaimed(c.id);
        pushToast(false, "Already Claimed", "This reward was already collected.");
      } else {
        pushToast(
          false,
          "Claim Failed",
          body.error ?? "Something went wrong — please try again.",
        );
      }
    } catch {
      pushToast(false, "Network Error", "Could not reach the server — try again.");
    }
    setClaiming(null);
  }

  const daily   = challenges.filter(c => c.category === "daily");
  const weekly  = challenges.filter(c => c.category === "weekly");
  const monthly = challenges.filter(c => c.category === "monthly");
  const special = challenges.filter(c => c.category === "special");

  return (
    <PageWrapper title="Challenges" breadcrumb="The Hub / Challenges" accentColor="#ec4899">

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

      {/* Fixed corner toasts — stacked bottom-right */}
      {toasts.map((t, i) => (
        <div
          key={t.id}
          style={{
            position: "fixed",
            bottom: 28 + i * 90,
            right: 28,
            zIndex: 9999 + i,
          }}
        >
          <ClaimToast toast={t} onDone={() => removeToast(t.id)} />
        </div>
      ))}

    </PageWrapper>
  );
}
