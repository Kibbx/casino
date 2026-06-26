import { useState, useEffect, useCallback } from "react";
import { useStore } from "../store";
import { PageWrapper, SubHeader } from "./shared";
import { AvatarUpload } from "../components/AvatarUpload";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PlayerData {
  id: number;
  username: string;
  stateId: string | null;
  chips: number | string;
  creditScore?: number;
  handsPlayed?: number;
  createdAt: string;
  avatarUrl?: string | null;
  referralCode?: string | null;
}

interface RakebackStatus {
  claimable: number;
  wageredReal: number;
  wonReal: number;
  lastClaimed: string | null;
  onCooldown: boolean;
  nextClaimAt: string | null;
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
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
      timeZoneName: "short",
    });
  } catch { return iso; }
}
function creditLabel(score: number) {
  if (score >= 750) return { label: "EXCELLENT", color: "#22c55e" };
  if (score >= 600) return { label: "GOOD",      color: "#f5c518" };
  return { label: "POOR", color: "#ef4444" };
}

export function ProfilePage() {
  const { sessionToken, playerId } = useStore();
  const [player,    setPlayer]    = useState<PlayerData | null>(null);
  const [txs,       setTxs]       = useState<Transaction[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(null);
  const [rakeback,     setRakeback]     = useState<RakebackStatus | null>(null);
  const [rbClaiming,   setRbClaiming]   = useState(false);
  const [rbClaimMsg,   setRbClaimMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [showSecurity, setShowSecurity] = useState(false);
  const [curPin,       setCurPin]       = useState("");
  const [newPin,       setNewPin]       = useState("");
  const [confirmPin,   setConfirmPin]   = useState("");
  const [pinSaving,    setPinSaving]    = useState(false);
  const [pinMsg,       setPinMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!sessionToken || !playerId) return;
    try {
      const headers = { Authorization: `Bearer ${sessionToken}` };
      const [pRes, tRes, rbRes] = await Promise.all([
        fetch(`${BASE}/api/players/${playerId}`, { headers }),
        fetch(`${BASE}/api/players/${playerId}/transactions`, { headers }),
        fetch(`${BASE}/api/rakeback/status`, { headers }),
      ]);
      const [pData, tData, rbData] = await Promise.all([pRes.json(), tRes.json(), rbRes.json()]);
      if (!pRes.ok) throw new Error(pData.error ?? "Failed to load profile");
      setPlayer(pData);
      setTxs(Array.isArray(tData) ? tData : []);
      if (rbRes.ok) setRakeback(rbData);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, playerId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (player) setAvatarUrl(player.avatarUrl ?? null); }, [player]);

  async function handleClaimRakeback() {
    if (!sessionToken) return;
    setRbClaiming(true); setRbClaimMsg(null);
    try {
      const res = await fetch(`${BASE}/api/rakeback/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any).error ?? "Claim failed");
      setRbClaimMsg({ ok: true, text: `+${fmt(body.claimed ?? 0)} chips claimed!` });
      const rbRes = await fetch(`${BASE}/api/rakeback/status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (rbRes.ok) setRakeback(await rbRes.json());
      setTimeout(() => setRbClaimMsg(null), 4000);
    } catch (e: any) {
      setRbClaimMsg({ ok: false, text: e.message ?? "Claim failed" });
    } finally {
      setRbClaiming(false);
    }
  }

  function fmtCooldown(nextClaimAt: string | null) {
    if (!nextClaimAt) return "";
    const ms = new Date(nextClaimAt).getTime() - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function handleChangePin() {
    if (!curPin || !newPin) { setPinMsg({ ok: false, text: "Fill in all fields." }); return; }
    if (newPin.length < 4)  { setPinMsg({ ok: false, text: "New PIN must be at least 4 characters." }); return; }
    if (newPin !== confirmPin) { setPinMsg({ ok: false, text: "New PINs don't match." }); return; }
    setPinSaving(true); setPinMsg(null);
    try {
      const res = await fetch(`${BASE}/api/players/change-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ currentPin: curPin, newPin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any).error ?? "Failed to change PIN");
      setPinMsg({ ok: true, text: "PIN changed successfully." });
      setCurPin(""); setNewPin(""); setConfirmPin("");
      setTimeout(() => { setShowSecurity(false); setPinMsg(null); }, 2000);
    } catch (e: any) {
      setPinMsg({ ok: false, text: e.message ?? "Failed to change PIN" });
    } finally {
      setPinSaving(false);
    }
  }

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
  const roundsPlayed = player.handsPlayed ?? 0;
  const totalWagered = txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const totalWon     = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const biggestWin   = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).reduce((max, t) => t.amount > max ? t.amount : max, 0);
  const netResult    = totalWon - totalWagered;
  const betCount     = txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).length;
  const winCount     = txs.filter(t => WIN_TYPES.has(t.type)   && !isPokerTx(t)).length;

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
            <AvatarUpload
              playerId={player.id}
              currentAvatarUrl={avatarUrl}
              username={player.username}
              size="lg"
              onUpdate={url => setAvatarUrl(url)}
            />
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

          {/* Security — change PIN */}
          <div className="px-5 pb-5">
            <button
              onClick={() => { setShowSecurity(true); setPinMsg(null); setCurPin(""); setNewPin(""); setConfirmPin(""); }}
              className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
              style={{
                background: "rgba(232,64,10,0.10)",
                color: "#e8400a",
                border: "1px solid rgba(232,64,10,0.40)",
                letterSpacing: "0.1em",
              }}
            >
              Security
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

          {/* Rakeback card */}
          {(() => {
            const rb = rakeback;
            const claimable  = rb?.claimable ?? 0;
            const wagered    = rb?.wageredReal ?? 0;
            const wonBack    = rb?.wonReal ?? 0;
            const onCooldown = rb?.onCooldown ?? false;
            const cdLabel    = fmtCooldown(rb?.nextClaimAt ?? null);
            const rows: [string, string][] = [
              ["Wagered",      fmt(wagered) + " chips"],
              ["Won Back",     fmt(wonBack) + " chips"],
              ["Last Claimed", fmtDateTime(rb?.lastClaimed ?? null)],
            ];
            return (
              <div
                className="rounded-xl flex flex-col"
                style={{
                  background: "#0c0a0a",
                  border: "1px solid rgba(34,197,94,0.2)",
                  padding: "18px 20px 14px",
                }}
              >
                <p className="text-[10px] uppercase tracking-widest mb-2"
                  style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.12em" }}>
                  Rakeback
                </p>
                <p className="font-black tabular-nums leading-none"
                  style={{
                    fontFamily: "'Orbitron', monospace",
                    fontSize: "clamp(16px, 2vw, 26px)",
                    color: "#22c55e",
                    textShadow: "0 0 16px rgba(34,197,94,0.55)",
                  }}>
                  {fmt(claimable)}
                </p>
                <p className="text-[10px] mt-1.5" style={{ color: "rgba(255,255,255,0.22)" }}>
                  claimable now · 3% back
                </p>

                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</span>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.48)", fontWeight: 700, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>

                {rbClaimMsg && (
                  <p style={{ fontSize: 10, marginTop: 6, color: rbClaimMsg.ok ? "#22c55e" : "#ef4444" }}>
                    {rbClaimMsg.text}
                  </p>
                )}

                <button
                  onClick={handleClaimRakeback}
                  disabled={rbClaiming || onCooldown || claimable === 0}
                  style={{
                    marginTop: 10, padding: "7px 0", borderRadius: 7,
                    background: (onCooldown || claimable === 0)
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(34,197,94,0.15)",
                    border: `1px solid ${(onCooldown || claimable === 0) ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.35)"}`,
                    color: (onCooldown || claimable === 0) ? "rgba(255,255,255,0.25)" : "#22c55e",
                    fontWeight: 700, fontSize: 10,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                    cursor: (rbClaiming || onCooldown || claimable === 0) ? "not-allowed" : "pointer",
                    fontFamily: "Rajdhani, sans-serif",
                    width: "100%",
                  }}
                >
                  {rbClaiming
                    ? "Claiming…"
                    : onCooldown && cdLabel
                    ? `Cooldown · ${cdLabel}`
                    : "Collect Rakeback"}
                </button>
              </div>
            );
          })()}
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

      {/* ── Security / Change PIN modal ─────────────────────────── */}
      {showSecurity && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.72)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowSecurity(false); setPinMsg(null); } }}
        >
          <div style={{
            background: "#0e0b06",
            border: "1px solid rgba(245,197,24,0.18)",
            borderRadius: 18,
            padding: "22px 24px 24px",
            width: "100%", maxWidth: 300,
            boxShadow: "0 0 80px rgba(0,0,0,0.85), 0 0 40px rgba(245,197,24,0.04)",
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{
                fontFamily: "Rajdhani, sans-serif", fontWeight: 900, fontSize: 13,
                letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
              }}>
                Change PIN
              </span>
              <button
                onClick={() => { setShowSecurity(false); setPinMsg(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2, lineHeight: 1, fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {/* Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {([
                ["Current PIN", curPin, setCurPin],
                ["New PIN",     newPin, setNewPin],
                ["Confirm PIN", confirmPin, setConfirmPin],
              ] as [string, string, (v: string) => void][]).map(([label, val, setFn]) => (
                <div key={label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.3)" }}>
                    {label}
                  </span>
                  <input
                    type="password"
                    value={val}
                    onChange={e => setFn(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleChangePin()}
                    placeholder="••••"
                    style={{
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 8, padding: "8px 12px",
                      color: "#fff", fontSize: 14, outline: "none",
                      width: "100%", boxSizing: "border-box",
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Message */}
            {pinMsg && (
              <p style={{ fontSize: 12, margin: 0, color: pinMsg.ok ? "#22c55e" : "#ef4444", textAlign: "center" }}>
                {pinMsg.text}
              </p>
            )}

            {/* Submit */}
            <button
              onClick={handleChangePin}
              disabled={pinSaving}
              style={{
                padding: "10px 0", borderRadius: 8,
                background: "rgba(245,197,24,0.16)",
                border: "1px solid rgba(245,197,24,0.38)",
                color: "#f5c518", fontWeight: 700, fontSize: 12,
                letterSpacing: "0.08em", textTransform: "uppercase",
                cursor: pinSaving ? "not-allowed" : "pointer",
                opacity: pinSaving ? 0.7 : 1,
                fontFamily: "Rajdhani, sans-serif",
              }}
            >
              {pinSaving ? "Saving…" : "Change PIN"}
            </button>
          </div>
        </div>
      )}

    </PageWrapper>
  );
}
