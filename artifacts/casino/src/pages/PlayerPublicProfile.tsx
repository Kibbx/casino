import { useState, useEffect } from "react";
import {
  User, Coins, Trophy, Layers, Activity,
  Clock, Target, Zap, ArrowLeft, Wifi, WifiOff,
} from "lucide-react";
import { useStore } from "../store";
import { fetchPublicProfile, PublicProfile } from "../lib/playerSearchService";
import { TIERS } from "../lib/rewardsState";

/* ─── Tier logic (mirrors rewardsState.getSubRank) ────────────── */
function computeXpFromStats(totalWon: number, handsPlayed: number): number {
  return Math.floor(totalWon * 0.003) + Math.floor(handsPlayed * 3);
}

function getTierForXp(xp: number) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (xp >= t.minXP) tier = t;
    else break;
  }
  return tier;
}

function getTierProgress(xp: number): { tier: typeof TIERS[0]; next: typeof TIERS[0] | null; progress: number } {
  const tierIdx = TIERS.reduce((best, _, i) => (xp >= TIERS[i].minXP ? i : best), 0);
  const cur = TIERS[tierIdx];
  const next = TIERS[tierIdx + 1] ?? null;
  if (!next) return { tier: cur, next: null, progress: 100 };
  const progress = Math.floor(((xp - cur.minXP) / (next.minXP - cur.minXP)) * 100);
  return { tier: cur, next, progress };
}

/* ─── Badges ────────────────────────────────────────────────────── */
function computeBadges(p: PublicProfile) {
  const badges: { label: string; color: string; icon: string }[] = [];
  const xp = computeXpFromStats(p.totalWon, p.handsPlayed);
  const { tier } = getTierProgress(xp);
  badges.push({ label: tier.name, color: tier.color, icon: tier.icon });
  if (p.wins >= 500)      badges.push({ label: "Legend",      color: "#a855f7", icon: "🏆" });
  else if (p.wins >= 100) badges.push({ label: "Winner",      color: "#f5c518", icon: "🥇" });
  if (p.handsPlayed >= 1000) badges.push({ label: "Veteran",  color: "#60a5fa", icon: "⚡" });
  else if (p.handsPlayed >= 200) badges.push({ label: "Regular", color: "#34d399", icon: "🎲" });
  if (p.challengeStats.completed >= 25) badges.push({ label: "Grinder",  color: "#f97316", icon: "🔥" });
  else if (p.challengeStats.completed >= 5) badges.push({ label: "Challenger", color: "#fb7185", icon: "🎯" });
  if (p.chips >= 500_000) badges.push({ label: "High Roller", color: "#fbbf24", icon: "💰" });
  return badges;
}

/* ─── Stat card ────────────────────────────────────────────────── */
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 10,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 800, color: color ?? "rgba(255,255,255,0.92)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{sub}</span>}
    </div>
  );
}

/* ─── Main component ────────────────────────────────────────────── */
interface Props {
  playerId: number;
  onBack: () => void;
}

export function PlayerPublicProfile({ playerId, onBack }: Props) {
  const { sessionToken } = useStore();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setProfile(null);
    if (!sessionToken) { setError("Not authenticated"); setLoading(false); return; }
    fetchPublicProfile(playerId, sessionToken).then(data => {
      if (!data) setError("Player not found");
      else setProfile(data);
      setLoading(false);
    });
  }, [playerId, sessionToken]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "rgba(255,255,255,0.3)", fontSize: 14 }}>
        Loading profile…
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, height: 300 }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>{error ?? "Player not found"}</span>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: "rgba(232,64,10,0.15)", border: "1px solid rgba(232,64,10,0.35)", color: "#e8400a", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          <ArrowLeft size={12} /> Go Back
        </button>
      </div>
    );
  }

  const xp = computeXpFromStats(profile.totalWon, profile.handsPlayed);
  const { tier, next, progress } = getTierProgress(xp);
  const badges = computeBadges(profile);
  const winRate = profile.handsPlayed > 0 ? ((profile.wins / profile.handsPlayed) * 100).toFixed(1) : "0.0";
  const joinDate = new Date(profile.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const initials = profile.username.charAt(0).toUpperCase();

  const fmtChips = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
    n >= 1_000    ? `${(n / 1_000).toFixed(1)}K` :
    n.toLocaleString();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Back button */}
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 600, cursor: "pointer", alignSelf: "flex-start", padding: "4px 0" }}
        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
      >
        <ArrowLeft size={14} /> Back
      </button>

      {/* ── Hero card ─────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 14,
        padding: "24px 24px 20px",
        display: "flex",
        gap: 20,
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}>
        {/* Avatar */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.username}
              style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: `2px solid ${tier.color}` }}
            />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: "50%",
              background: `linear-gradient(135deg, ${tier.color}33, ${tier.color}11)`,
              border: `2px solid ${tier.color}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, fontWeight: 800, color: tier.color,
            }}>
              {initials}
            </div>
          )}
          {/* Online dot */}
          <div style={{
            position: "absolute", bottom: 2, right: 2,
            width: 14, height: 14, borderRadius: "50%",
            background: profile.isOnline ? "#22c55e" : "rgba(255,255,255,0.2)",
            border: "2px solid #0a0a0a",
            boxShadow: profile.isOnline ? "0 0 6px rgba(34,197,94,0.7)" : "none",
          }} />
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "rgba(255,255,255,0.95)" }}>{profile.username}</span>
            {profile.stateId && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums" }}>#{profile.stateId}</span>
            )}
            <span style={{
              display: "flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20,
              background: profile.isOnline ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.07)",
              border: `1px solid ${profile.isOnline ? "rgba(34,197,94,0.3)" : "rgba(255,255,255,0.1)"}`,
              color: profile.isOnline ? "#22c55e" : "rgba(255,255,255,0.3)",
            }}>
              {profile.isOnline ? <Wifi size={9} /> : <WifiOff size={9} />}
              {profile.isOnline ? (profile.currentGame ? profile.currentGame : "Online") : "Offline"}
            </span>
          </div>

          {/* Tier + progress */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: tier.color }}>{tier.icon} {tier.name}</span>
            {next && (
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>→ {next.name}</span>
            )}
          </div>

          {/* XP bar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden", maxWidth: 280 }}>
              <div style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${tier.color}aa, ${tier.color})`, width: `${progress}%`, transition: "width 0.6s ease" }} />
            </div>
            {next ? (
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", fontWeight: 600 }}>
                {progress}% to {next.name} · {(xp).toLocaleString()} XP
              </span>
            ) : (
              <span style={{ fontSize: 10, color: `${tier.color}99`, fontWeight: 700, textTransform: "uppercase" }}>Max Rank</span>
            )}
          </div>

          {/* Meta */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 2 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
              <Clock size={11} /> Joined {joinDate}
            </span>
          </div>
        </div>
      </div>

      {/* ── Stats grid ──────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        <StatCard label="Chip Balance"  value={fmtChips(profile.chips)}     color="#f5c518" />
        <StatCard label="Total Wins"    value={profile.wins.toLocaleString()} />
        <StatCard label="Hands Played"  value={profile.handsPlayed.toLocaleString()} />
        <StatCard label="Win Rate"      value={`${winRate}%`} />
        <StatCard label="Total Won"     value={fmtChips(profile.totalWon)} sub="all time" color="#22c55e" />
        <StatCard label="Challenges"    value={profile.challengeStats.completed.toLocaleString()} sub="completed" color="#a855f7" />
      </div>

      {/* ── Challenge earnings ──────────────────────────────────────── */}
      {profile.challengeStats.completed > 0 && (
        <div style={{
          background: "rgba(168,85,247,0.05)",
          border: "1px solid rgba(168,85,247,0.15)",
          borderRadius: 12,
          padding: "16px 20px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(168,85,247,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Target size={16} style={{ color: "#a855f7" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
              {profile.challengeStats.completed} Challenge{profile.challengeStats.completed !== 1 ? "s" : ""} Completed
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
              Earned {fmtChips(profile.challengeStats.chipsEarned)} chips from challenges
            </div>
          </div>
          <div style={{ marginLeft: "auto", fontSize: 22, fontWeight: 800, color: "#a855f7" }}>
            +{fmtChips(profile.challengeStats.chipsEarned)}
          </div>
        </div>
      )}

      {/* ── Currently playing ──────────────────────────────────────── */}
      {profile.isOnline && profile.currentGame && profile.currentGame.toLowerCase() !== "lobby" && (
        <div style={{
          background: "rgba(34,197,94,0.05)",
          border: "1px solid rgba(34,197,94,0.15)",
          borderRadius: 12,
          padding: "14px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          <Activity size={15} style={{ color: "#22c55e", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
            Currently playing <span style={{ color: "#22c55e", fontWeight: 700 }}>{profile.currentGame}</span>
          </span>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.8)", animation: "pulse 2s ease infinite", flexShrink: 0, marginLeft: "auto" }} />
        </div>
      )}

      {/* ── Badges ─────────────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderRadius: 12,
        padding: "16px 20px",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>Badges &amp; Achievements</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {badges.map((b, i) => (
            <span
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 11px", borderRadius: 20,
                background: `${b.color}18`,
                border: `1px solid ${b.color}40`,
                color: b.color,
                fontSize: 12, fontWeight: 700,
              }}
            >
              {b.icon} {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Stats summary ─────────────────────────────────────────── */}
      <div style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 12,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Performance</div>
        {[
          { label: "Win / Loss Ratio",    value: profile.handsPlayed > 0 ? `${winRate}%` : "—" },
          { label: "Avg. Win per Hand",   value: profile.wins > 0 ? `${fmtChips(Math.floor(profile.totalWon / profile.wins))} chips` : "—" },
          { label: "Total XP",            value: xp.toLocaleString() },
        ].map((row, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: i < 2 ? 10 : 0, borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.8)", fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

export default PlayerPublicProfile;
