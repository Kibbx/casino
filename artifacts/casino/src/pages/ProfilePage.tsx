import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { PageWrapper, SubHeader } from "./shared";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlayerData {
  id: number;
  username: string;
  stateId: string | null;
  chips: number | string;
  gems?: number;
  creditScore?: number;
  handsPlayed?: number;
  createdAt: string;
  avatarUrl?: string | null;
  referralCode?: string | null;
}

interface Transaction {
  id: number;
  type: string;
  amount: number;
  description: string | null;
  createdAt: string;
}

const WAGER_TYPES = new Set([
  "loss", "fortuna-bet", "fortuna-bonus-buy", "rome-slots-bet",
  "western-slots-bet", "highlow_bet", "baccarat", "sport_bet",
]);
const WIN_TYPES = new Set([
  "win", "tournament_win", "fortuna-win", "rome-slots-win",
  "western-slots-win", "rakeback",
]);
function isPokerTx(t: { type: string; description?: string | null }) {
  const d = (t.description || "").toLowerCase();
  return t.type === "buyin" || t.type === "poker_win" || t.type === "cashout" ||
    d.startsWith("poker") || d.startsWith("won pot") || d.startsWith("rake collected at") ||
    d.startsWith("buy-in to table") || d.startsWith("left table");
}

function fmt(n: number) { return n.toLocaleString(); }
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}
function creditLabel(score: number) {
  if (score >= 750) return { label: "EXCELLENT", color: "#22c55e" };
  if (score >= 600) return { label: "GOOD",      color: "#f5c518" };
  return { label: "POOR", color: "#ef4444" };
}

export function ProfilePage() {
  const { sessionToken, playerId } = useStore();
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [txs,    setTxs]    = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken || !playerId) return;
    try {
      const headers = { Authorization: `Bearer ${sessionToken}` };
      const [pRes, tRes] = await Promise.all([
        fetch(`${BASE}/api/players/${playerId}`, { headers }),
        fetch(`${BASE}/api/players/${playerId}/transactions`, { headers }),
      ]);
      const [pData, tData] = await Promise.all([pRes.json(), tRes.json()]);
      if (!pRes.ok) throw new Error(pData.error ?? "Failed to load profile");
      setPlayer(pData);
      setTxs(Array.isArray(tData) ? tData : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, playerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
        <div className="flex items-center justify-center py-24">
          <span className="text-sm animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>Loading profile…</span>
        </div>
      </PageWrapper>
    );
  }

  if (error || !player) {
    return (
      <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
        <div className="flex items-center justify-center py-24">
          <span className="text-sm" style={{ color: "#ef4444" }}>{error ?? "Profile not found"}</span>
        </div>
      </PageWrapper>
    );
  }

  const chips        = Number(player.chips ?? 0);
  const gems         = Number(player.gems  ?? 0);
  const roundsPlayed = player.handsPlayed ?? 0;
  const totalWagered = txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const totalWon     = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const biggestWin   = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).reduce((max, t) => t.amount > max ? t.amount : max, 0);
  const netResult    = totalWon - totalWagered;
  const betCount     = txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).length;
  const winCount     = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).length;

  const initials = (player.username ?? "?").slice(0, 2).toUpperCase();
  const cs       = player.creditScore;
  const csInfo   = cs !== undefined ? creditLabel(cs) : null;

  const details: [string, string, string?][] = [
    ["Member Since", fmtDate(player.createdAt)],
    ["Stat ID",      player.stateId ? `#${player.stateId}` : "—"],
    ...(player.referralCode ? [["Referral", player.referralCode] as [string, string]] : []),
    ...(cs !== undefined   ? [["Credit Score", `${cs} — ${csInfo!.label}`, "credit"] as [string, string, string]] : []),
    ["Chips", fmt(chips),  "gold"],
  ];

  const stats = [
    { label: "Rounds Played", value: fmt(roundsPlayed),                           color: "#06b6d4" },
    { label: "Total Wagered", value: fmt(totalWagered),  sub: "chips",            color: "#f97316" },
    { label: "Total Won",     value: fmt(totalWon),      sub: "chips",            color: "#f5c518" },
    { label: "Largest Win",   value: "+" + fmt(biggestWin), sub: "chips",         color: "#a855f7" },
    { label: "Net Result",    value: (netResult >= 0 ? "+" : "") + fmt(netResult), sub: "chips",
                              color: netResult >= 0 ? "#22c55e" : "#ef4444" },
    { label: "Gems",          value: fmt(gems),                                   color: "#a855f7" },
  ];

  const activity = [
    { label: "Bet",                count: `${betCount}x`, value: `-${fmt(totalWagered)} chips`, positive: false },
    { label: "Win",                count: `${winCount}x`, value: `+${fmt(totalWon)} chips`,     positive: true  },
    { label: "Biggest Single Win", count: "—",            value: `+${fmt(biggestWin)} chips`,   positive: true  },
  ];

  return (
    <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">

      {/* ── Top row ─────────────────────────────────────────────── */}
      <div className="flex gap-5 mb-6" style={{ alignItems: "stretch" }}>

        {/* User card */}
        <div
          className="flex flex-col rounded-2xl overflow-hidden"
          style={{
            width: 240, flexShrink: 0,
            background: "#0c0a0a",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* Avatar + name */}
          <div className="flex items-center gap-3 p-5 pb-4">
            <div
              className="flex items-center justify-center rounded-full font-black shrink-0"
              style={{
                width: 56, height: 56, fontSize: 18,
                background: "linear-gradient(135deg,#1e0e06,#2c1506)",
                border: "2px solid rgba(232,64,10,0.55)",
                color: "#e8400a",
                letterSpacing: 1,
              }}
            >
              {initials}
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-rajdhani font-black text-white leading-tight" style={{ fontSize: 16 }}>
                {player.username}
              </span>
              <span
                className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full self-start"
                style={{
                  background: "rgba(232,64,10,0.12)",
                  color: "#e8400a",
                  border: "1px solid rgba(232,64,10,0.28)",
                  letterSpacing: "0.05em",
                }}
              >
                Member
              </span>
            </div>
          </div>

          {/* Detail rows */}
          <div className="flex flex-col px-5 pb-4 flex-1">
            {details.map(([label, val, accent]) => {
              const color =
                accent === "credit" ? csInfo!.color :
                accent === "gold"   ? "#f5c518" :
                accent === "purple" ? "#a855f7" :
                "rgba(255,255,255,0.68)";
              return (
                <div
                  key={label}
                  className="flex justify-between items-baseline py-2"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <span className="text-[10px] uppercase tracking-widest shrink-0"
                    style={{ color: "rgba(255,255,255,0.28)" }}>
                    {label}
                  </span>
                  <span className="text-[11px] font-bold text-right ml-2 truncate"
                    style={{ color, maxWidth: 130 }}>
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

        {/* Stat cards — 2 × 3 */}
        <div className="flex-1 grid grid-cols-2 gap-3" style={{ minWidth: 0 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl flex flex-col justify-between"
              style={{
                background: "#0c0a0a",
                border: `1px solid ${s.color}20`,
                padding: "18px 20px 14px",
              }}
            >
              <p className="text-[10px] uppercase tracking-widest mb-2"
                style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.12em" }}>
                {s.label}
              </p>
              <p className="font-black tabular-nums leading-none"
                style={{
                  fontFamily: "'Orbitron', monospace",
                  fontSize: "clamp(16px, 2vw, 26px)",
                  color: s.color,
                  textShadow: `0 0 16px ${s.color}55`,
                }}>
                {s.value}
              </p>
              {s.sub && (
                <p className="text-[10px] mt-1.5" style={{ color: "rgba(255,255,255,0.22)" }}>
                  {s.sub}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Recent Activity ──────────────────────────────────────── */}
      <SubHeader label="Recent Activity" />
      <div className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {activity.map((row, i) => (
          <div
            key={i}
            className="flex items-center px-5 py-3.5 gap-4 transition-colors duration-100"
            style={{ borderBottom: i < activity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
          >
            <span className="font-rajdhani font-bold text-sm"
              style={{ color: "rgba(255,255,255,0.78)", minWidth: 150 }}>
              {row.label}
            </span>
            <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full"
              style={{
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.38)",
                border: "1px solid rgba(255,255,255,0.08)",
                minWidth: 32, textAlign: "center",
              }}>
              {row.count}
            </span>
            <span className="flex-1" />
            <span className="text-sm font-black tabular-nums"
              style={{ color: row.positive ? "#22c55e" : "#ef4444", minWidth: 140, textAlign: "right" }}>
              {row.value}
            </span>
            <span className="text-[9px] font-black uppercase px-2.5 py-1 rounded-full"
              style={{
                color: row.positive ? "#22c55e" : "#ef4444",
                background: row.positive ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${row.positive ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                letterSpacing: "0.08em",
                minWidth: 40, textAlign: "center",
              }}>
              {row.positive ? "WIN" : "LOSS"}
            </span>
          </div>
        ))}
      </div>

    </PageWrapper>
  );
}
