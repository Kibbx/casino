import { useState, useEffect } from "react";
import { PageWrapper } from "./shared";
import { useStore } from "../store";
import { Trophy, Coins, Hash, TrendingUp } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LeaderEntry = {
  id: number;
  username: string;
  chips: number;
  handsPlayed: number;
  lifetimeDeposits: number;
  avatarUrl: string | null;
  staffRole: string | null;
};

type Tab = "chips" | "hands" | "deposits";

const TABS: { id: Tab; label: string; icon: React.ElementType; color: string; accentColor: string }[] = [
  { id: "chips",    label: "Top Chips",         icon: Coins,     color: "#f5c518", accentColor: "rgba(245,197,24,0.18)"  },
  { id: "hands",    label: "Most Hands Played",  icon: Hash,      color: "#22c55e", accentColor: "rgba(34,197,94,0.18)"  },
  { id: "deposits", label: "Biggest Depositors", icon: TrendingUp, color: "#e8400a", accentColor: "rgba(232,64,10,0.18)" },
];

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return n.toLocaleString();
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function getRoleColor(role: string | null) {
  if (!role) return null;
  const r = role.toLowerCase();
  if (r === "owner")    return "#f5c518";
  if (r === "manager")  return "#a855f7";
  if (r === "security") return "#ef4444";
  if (r === "cashier" || r === "cage_clerk") return "#22c55e";
  return "#60a5fa";
}

export function LeaderboardsPage() {
  const { sessionToken, playerId } = useStore();
  const [activeTab, setActiveTab] = useState<Tab>("chips");
  const [data, setData] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    setLoading(true);
    setError(null);
    fetch(`${BASE}/api/players/leaderboard`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.ok ? r.json() : r.json().then((e: any) => Promise.reject(e?.error ?? "Failed to load")))
      .then((rows: LeaderEntry[]) => { setData(rows); setLoading(false); })
      .catch((e: any) => { setError(typeof e === "string" ? e : "Failed to load leaderboard"); setLoading(false); });
  }, [sessionToken]);

  const tab = TABS.find(t => t.id === activeTab)!;

  const sorted = [...data].sort((a, b) => {
    if (activeTab === "chips")    return b.chips - a.chips;
    if (activeTab === "hands")    return b.handsPlayed - a.handsPlayed;
    return b.lifetimeDeposits - a.lifetimeDeposits;
  });

  function getStatValue(entry: LeaderEntry) {
    if (activeTab === "chips")    return fmt(entry.chips) + " chips";
    if (activeTab === "hands")    return fmt(entry.handsPlayed) + " hands";
    return "$" + fmt(entry.lifetimeDeposits);
  }

  const myRank = sorted.findIndex(e => e.id === playerId) + 1;

  return (
    <PageWrapper title="Leaderboards" breadcrumb="The Hub / Leaderboards" accentColor={tab.color}>
      {/* Tab row */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
              style={{
                background: active ? t.accentColor : "rgba(255,255,255,0.04)",
                color:      active ? t.color : "rgba(255,255,255,0.40)",
                border:     `1px solid ${active ? t.color + "55" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Your rank badge */}
      {!loading && !error && myRank > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl mb-5"
          style={{ background: `${tab.color}10`, border: `1px solid ${tab.color}30` }}
        >
          <Trophy size={16} style={{ color: tab.color, flexShrink: 0 }} />
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.7)" }}>
            Your rank: <span className="font-black" style={{ color: tab.color }}>#{myRank}</span>
            {" "}of {sorted.length} players
          </span>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
        {/* Header */}
        <div
          className="grid px-5 py-3 text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.30)",
            gridTemplateColumns: "52px 1fr 140px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span>Rank</span>
          <span>Player</span>
          <span className="text-right">{tab.label}</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${tab.color} transparent transparent transparent` }} />
          </div>
        )}

        {error && (
          <div className="py-12 text-center text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            {error}
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
            No players yet
          </div>
        )}

        {!loading && !error && sorted.map((entry, i) => {
          const isMe = entry.id === playerId;
          const roleColor = getRoleColor(entry.staffRole);
          return (
            <div
              key={entry.id}
              className="grid px-5 py-4 items-center transition-colors duration-100"
              style={{
                gridTemplateColumns: "52px 1fr 140px",
                borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                background: isMe ? `${tab.color}0d` : "transparent",
              }}
              onMouseEnter={e => { if (!isMe) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
              onMouseLeave={e => { if (!isMe) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Rank */}
              <div className="flex items-center">
                {i < 3 ? (
                  <span className="text-xl leading-none">{RANK_MEDAL[i]}</span>
                ) : (
                  <span className="text-sm font-black tabular-nums" style={{ color: "rgba(255,255,255,0.30)" }}>#{i + 1}</span>
                )}
              </div>

              {/* Player */}
              <div className="flex items-center gap-3 min-w-0">
                {entry.avatarUrl ? (
                  <img src={entry.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0" style={{ border: `1px solid ${isMe ? tab.color : "rgba(255,255,255,0.1)"}44` }} />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
                    style={{
                      background: isMe ? `${tab.color}22` : "rgba(255,255,255,0.06)",
                      border:     `1px solid ${isMe ? tab.color + "44" : "rgba(255,255,255,0.10)"}`,
                      color:      isMe ? tab.color : "rgba(255,255,255,0.5)",
                    }}
                  >
                    {getInitials(entry.username)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="font-rajdhani font-bold text-sm truncate"
                      style={{ color: isMe ? tab.color : "rgba(255,255,255,0.85)" }}
                    >
                      {entry.username}
                    </span>
                    {isMe && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: `${tab.color}20`, color: tab.color, border: `1px solid ${tab.color}33` }}>
                        YOU
                      </span>
                    )}
                    {roleColor && (
                      <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full" style={{ background: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}33` }}>
                        {entry.staffRole}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Stat */}
              <div className="text-right">
                <span
                  className="text-sm font-black tabular-nums"
                  style={{ color: i === 0 ? tab.color : i === 1 ? "rgba(255,255,255,0.85)" : i === 2 ? "#cd7f32" : "rgba(255,255,255,0.65)" }}
                >
                  {getStatValue(entry)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] text-center" style={{ color: "rgba(255,255,255,0.22)" }}>
        Live data · Bots excluded · Updates on page load
      </p>
    </PageWrapper>
  );
}
