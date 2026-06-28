import { useState, useEffect, useCallback } from "react";
import { Activity, Coins, Trophy, Star, TrendingUp, TrendingDown, Percent, X, Package, Trash2, Clock, CheckCircle2, Hourglass, ArrowRightLeft } from "lucide-react";
import { useLocation } from "wouter";
import { fmtETDateTime } from "../utils/timezone";
import { useStore } from "../store";
import { PageWrapper, SubHeader } from "./shared";
import { AvatarUpload } from "../components/AvatarUpload";
import { useGetPlayer } from "@workspace/api-client-react";
import { usePlayerSocket } from "../lib/usePlayerSocket";

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

interface InventoryItem {
  id: number;
  prize_item_id: number;
  prize_name: string;
  prize_emoji: string | null;
  prize_type: string;
  quantity: number;
  image_url: string | null;
  tier: string;
  source: string | null;
  first_won_at: string;
  last_won_at: string;
  prize_value: number;
}

interface Reward {
  id: number;
  game: string;
  prize_type: "chips" | "item" | "bet" | "gems";
  prize_name: string;
  prize_emoji: string;
  chips_amount: number;
  won_at: string;
  delivered_at: string | null;
  delivered_by: string | null;
  notes: string | null;
}

const ITEM_TIER: Record<string, { label: string; color: string }> = {
  common:    { label: "Common",    color: "#9ca3af" },
  rare:      { label: "Rare",      color: "#3b82f6" },
  epic:      { label: "Epic",      color: "#a855f7" },
  legendary: { label: "Legendary", color: "#f59e0b" },
  jackpot:   { label: "Jackpot",   color: "#ef4444" },
};

const TX_LABELS: Record<string, string> = {
  deposit: "Chip Deposit", withdrawal: "Withdrawal", bonus: "Bonus Gift", gift: "Staff Gift",
  loss: "Bet", win: "Win", poker_win: "Poker Win", rake: "Rake", buyin: "Buy-in",
  cashout: "Cash Out", tournament_win: "Tournament Win",
  slots: "Slots", blackjack: "Blackjack", roulette: "Roulette", crash: "Crash",
  horse_race: "Horse Racing", poker: "Poker", sport_bet: "Sports Bet", baccarat: "Baccarat",
  tournament_slots: "Slots Tournament", transfer_sent: "Transfer Sent", transfer_received: "Transfer Received",
  loan_issued: "Loan Issued", loan_repayment: "Loan Repayment",
  "fortuna-bet": "Fortuna Bet", "fortuna-win": "Fortuna Win", "fortuna-bonus-buy": "Fortuna Bonus",
  "rome-slots-bet": "Rome Slots Bet", "rome-slots-win": "Rome Slots Win",
  "western-slots-bet": "Western Slots Bet", "western-slots-win": "Western Slots Win",
  highlow_bet: "High-Low Bet", rakeback: "Rakeback",
};

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

interface PublicProfileData {
  id: number; username: string; stateId: string | null; avatarUrl: string | null;
  createdAt: string; referralCode: string | null; creditScore: number | null;
  wins: number; totalWon: number; handsPlayed: number; isOnline: boolean; currentGame: string | null;
  challengeStats: { completed: number; chipsEarned: number };
  statWagered: number; statWon: number; statBiggestWin: number; statNetResult: number;
  statRtp: number; statBetCount: number; statWinCount: number;
  activityBreakdown: { type: string; spent: number; received: number; count: number }[];
}
interface ProfilePageProps { viewedPlayerId?: number | null; onBack?: () => void; }

export function ProfilePage({ viewedPlayerId = null, onBack }: ProfilePageProps = {}) {
  const [, setLocation] = useLocation();
  const { sessionToken, playerId } = useStore();

  // When viewedPlayerId differs from the logged-in player we're in "view other player" mode
  const isViewing = !!viewedPlayerId && viewedPlayerId !== playerId;

  // Shared player data — same react-query cache as the lobby (own profile only)
  const { data: player, isLoading: playerLoading } = useGetPlayer(
    playerId!, { query: { enabled: !!playerId && !isViewing } },
  );
  // Live chip balance via socket — own profile only
  const { chips: liveChips } = usePlayerSocket(isViewing ? null : (playerId ?? null), sessionToken);

  const [txs,          setTxs]          = useState<Transaction[]>([]);
  const [txsLoading,   setTxsLoading]   = useState(true);
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(null);
  const [rakeback,     setRakeback]     = useState<RakebackStatus | null>(null);
  const [rbClaiming,   setRbClaiming]   = useState(false);
  const [rbClaimMsg,   setRbClaimMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [, setTick]                     = useState(0);
  const [showSecurity, setShowSecurity] = useState(false);
  const [curPin,       setCurPin]       = useState("");
  const [newPin,       setNewPin]       = useState("");
  const [confirmPin,   setConfirmPin]   = useState("");
  const [pinSaving,    setPinSaving]    = useState(false);
  const [pinMsg,       setPinMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const [showItems,    setShowItems]    = useState(false);
  const [items,        setItems]        = useState<InventoryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemMsg,      setItemMsg]      = useState<{ id: number; text: string; ok: boolean } | null>(null);

  const [showPrizes,    setShowPrizes]    = useState(false);
  const [prizes,        setPrizes]        = useState<Reward[]>([]);
  const [prizesLoading, setPrizesLoading] = useState(false);
  const [prizeFilter,   setPrizeFilter]   = useState<"all" | "pending" | "delivered">("all");

  const [pubData,    setPubData]    = useState<PublicProfileData | null>(null);
  const [pubLoading, setPubLoading] = useState(false);

  const [showTransfer,    setShowTransfer]    = useState(false);
  const [transferAmt,     setTransferAmt]     = useState("");
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferResult,  setTransferResult]  = useState<{ ok: boolean; text: string } | null>(null);

  const loadPrizes = useCallback(async () => {
    if (!sessionToken) return;
    setPrizesLoading(true);
    try {
      const res = await fetch(`${BASE}/api/prizes/my-rewards`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      setPrizes(Array.isArray(data) ? data : []);
    } catch { setPrizes([]); }
    finally { setPrizesLoading(false); }
  }, [sessionToken]);

  const loadInventory = useCallback(async () => {
    if (!sessionToken) return;
    setItemsLoading(true);
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch { setItems([]); }
    finally { setItemsLoading(false); }
  }, [sessionToken]);

  async function handleItemRequest(id: number) {
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${id}/request`, {
        method: "POST", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setItemMsg({ id, text: "Requested! Staff will deliver it in-game.", ok: true }); loadInventory(); }
      else setItemMsg({ id, text: (body as any).error ?? "Request failed", ok: false });
    } catch { setItemMsg({ id, text: "Request failed", ok: false }); }
    setTimeout(() => setItemMsg(null), 3500);
  }

  async function handleItemSell(id: number) {
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${id}/sell`, {
        method: "POST", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setItemMsg({ id, text: `Sold for +${((body as any).chipsAwarded ?? 0).toLocaleString()} chips!`, ok: true }); loadInventory(); }
      else setItemMsg({ id, text: (body as any).error ?? "Sell failed", ok: false });
    } catch { setItemMsg({ id, text: "Sell failed", ok: false }); }
    setTimeout(() => setItemMsg(null), 3500);
  }

  async function handleItemTrash(id: number) {
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${id}/trash`, {
        method: "POST", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setItemMsg({ id, text: (body as any).error ?? "Failed", ok: false });
      else loadInventory();
    } catch { setItemMsg({ id, text: "Failed", ok: false }); }
  }

  const load = useCallback(async () => {
    if (!sessionToken || !playerId || isViewing) return;
    try {
      const headers = { Authorization: `Bearer ${sessionToken}` };
      const [tRes, rbRes] = await Promise.all([
        fetch(`${BASE}/api/players/${playerId}/transactions`, { headers }),
        fetch(`${BASE}/api/rakeback/status`, { headers }),
      ]);
      const [tData, rbData] = await Promise.all([tRes.json(), rbRes.json()]);
      setTxs(Array.isArray(tData) ? tData : []);
      if (rbRes.ok) setRakeback(rbData);
    } catch {
      // silent — player data errors are handled by useGetPlayer
    } finally {
      setTxsLoading(false);
    }
  }, [sessionToken, playerId, isViewing]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (player) setAvatarUrl(player.avatarUrl ?? null); }, [player]);

  // Load public profile data when viewing another player
  useEffect(() => {
    if (!isViewing || !viewedPlayerId || !sessionToken) return;
    setPubLoading(true);
    setPubData(null);
    fetch(`${BASE}/api/players/${viewedPlayerId}/public-profile`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { setPubData(data); setPubLoading(false); })
      .catch(() => { setPubLoading(false); });
  }, [viewedPlayerId, isViewing, sessionToken]);

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

  useEffect(() => {
    if (!rakeback?.onCooldown) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [rakeback?.onCooldown]);

  function fmtCooldown(nextClaimAt: string | null) {
    if (!nextClaimAt) return "";
    const ms = new Date(nextClaimAt).getTime() - Date.now();
    if (ms <= 0) return "";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
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

  async function doTransfer() {
    if (!sessionToken || !pubData) return;
    const amt = parseInt(transferAmt);
    if (!amt || amt < 1) return;
    setTransferLoading(true);
    setTransferResult(null);
    try {
      const r = await fetch(`${BASE}/api/players/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ toUsername: pubData.username, amount: amt }),
      });
      const d = await r.json();
      if (!r.ok) {
        setTransferResult({ ok: false, text: d.error ?? "Transfer failed" });
      } else {
        setTransferResult({ ok: true, text: `Sent ${amt.toLocaleString()} chips to ${pubData.username}.` });
        setTransferAmt("");
      }
    } catch {
      setTransferResult({ ok: false, text: "Network error. Please try again." });
    } finally {
      setTransferLoading(false);
    }
  }

  if (isViewing ? pubLoading : (playerLoading || txsLoading)) {
    return (
      <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
        <div className="flex items-center justify-center py-24">
          <span className="text-sm animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>Loading profile…</span>
        </div>
      </PageWrapper>
    );
  }

  if (isViewing ? !pubData : !player) {
    return (
      <PageWrapper title="Profile" breadcrumb="Account / Profile" accentColor="#9ca3af">
        <div className="flex items-center justify-center py-24">
          <span className="text-sm" style={{ color: "#ef4444" }}>Profile not found</span>
        </div>
      </PageWrapper>
    );
  }

  // Resolve display values — viewed player (public API) or own profile
  const displayUsername  = isViewing ? (pubData!.username ?? "Unknown Player") : player!.username;
  const displayAvatarUrl = isViewing ? (pubData!.avatarUrl ?? null) : avatarUrl;

  // Live chips from socket — own profile only; never read from public API (not returned)
  const chips = isViewing ? null : (liveChips ?? Number(player!.chips ?? 0));
  const roundsPlayed = isViewing ? Number(pubData!.handsPlayed ?? 0) : (player!.handsPlayed ?? 0);

  // Transaction-derived stats
  const totalWagered = isViewing
    ? (pubData!.statWagered ?? 0)
    : txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const totalWon = isViewing
    ? (pubData!.statWon ?? 0)
    : txs.filter(t => WIN_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const biggestWin = isViewing
    ? (pubData!.statBiggestWin ?? 0)
    : txs.filter(t => WIN_TYPES.has(t.type) && !isPokerTx(t)).reduce((max, t) => t.amount > max ? t.amount : max, 0);
  const netResult = isViewing ? (pubData!.statNetResult ?? 0) : (totalWon - totalWagered);
  const betCount  = isViewing ? (pubData!.statBetCount  ?? 0) : txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).length;
  const winCount  = isViewing ? (pubData!.statWinCount  ?? 0) : txs.filter(t => WIN_TYPES.has(t.type) && !isPokerTx(t)).length;

  const cs = isViewing
    ? (typeof pubData!.creditScore === "number" ? pubData!.creditScore : undefined)
    : player!.creditScore;
  const csInfo = cs !== undefined ? creditLabel(cs) : null;

  const pCreatedAt = isViewing ? pubData!.createdAt    : player!.createdAt;
  const pStateId   = isViewing ? pubData!.stateId      : player!.stateId;
  const pReferral  = isViewing ? pubData!.referralCode : player!.referralCode;

  const details: [string, string, string?][] = [
    ["Member Since", fmtDate(pCreatedAt)],
    ["Stat ID",      pStateId ? `#${pStateId}` : "—"],
    ...(pReferral ? [["Referral", pReferral] as [string, string]] : []),
    ...(cs !== undefined ? [["Credit Score", `${cs} — ${csInfo!.label}`, "credit"] as [string, string, string]] : []),
    ...(chips !== null ? [["Chips", fmt(chips), "gold"] as [string, string, string]] : []),
  ];

  const currentRtp = isViewing
    ? (pubData!.statRtp ?? 0)
    : (totalWagered > 0 ? (totalWon / totalWagered * 100) : 0);

  const stats: { label: string; value: string; sub?: string; icon: React.ReactNode; color: string }[] = [
    { label: "RTP",           value: currentRtp.toFixed(2) + "%",                         icon: <Activity size={22} />,   color: "#06b6d4" },
    { label: "Total Wagered", value: fmt(totalWagered),  sub: "chips",                    icon: <Coins size={22} />,      color: "#f97316" },
    { label: "Total Won",     value: fmt(totalWon),      sub: "chips",                    icon: <Trophy size={22} />,     color: "#f5c518" },
    { label: "Largest Win",   value: "+" + fmt(biggestWin), sub: "chips",                 icon: <Star size={22} />,       color: "#a855f7" },
    { label: "Net Result",    value: (netResult >= 0 ? "+" : "") + fmt(netResult), sub: "chips",
                              icon: netResult >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />, color: netResult >= 0 ? "#22c55e" : "#ef4444" },
  ];

  // Per-type activity breakdown
  const byType: Record<string, { spent: number; received: number; count: number }> = {};
  for (const t of txs) {
    if (!byType[t.type]) byType[t.type] = { spent: 0, received: 0, count: 0 };
    byType[t.type].count++;
    if (WIN_TYPES.has(t.type)) byType[t.type].received += t.amount;
    else byType[t.type].spent += t.amount;
  }
  const activityEntries: [string, { spent: number; received: number; count: number }][] = isViewing
    ? (pubData!.activityBreakdown ?? []).map(e => [e.type, { spent: e.spent, received: e.received, count: e.count }])
    : Object.entries(byType).sort((a, b) => (b[1].spent + b[1].received) - (a[1].spent + a[1].received));

  return (
    <PageWrapper
      title={isViewing ? displayUsername : "Profile"}
      breadcrumb={isViewing ? `Players / ${displayUsername}` : "Account / Profile"}
      accentColor="#9ca3af"
    >

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
            {isViewing ? (
              <div style={{ position: "relative", flexShrink: 0 }}>
                {displayAvatarUrl ? (
                  <img src={displayAvatarUrl} alt={displayUsername}
                    style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(232,64,10,0.4)" }} />
                ) : (
                  <div style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(232,64,10,0.15)", border: "2px solid rgba(232,64,10,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#e8400a" }}>
                    {displayUsername.charAt(0).toUpperCase()}
                  </div>
                )}
                {pubData?.isOnline && (
                  <div style={{ position: "absolute", bottom: 2, right: 2, width: 10, height: 10, borderRadius: "50%", background: "#22c55e", border: "2px solid #0c0a0a", boxShadow: "0 0 5px rgba(34,197,94,0.7)" }} />
                )}
              </div>
            ) : (
              <AvatarUpload
                playerId={player!.id}
                currentAvatarUrl={avatarUrl}
                username={player!.username}
                size="lg"
                onUpdate={url => setAvatarUrl(url)}
              />
            )}
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-rajdhani font-black text-white leading-tight" style={{ fontSize: 16 }}>
                {displayUsername}
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

          {/* Buttons: Transfer + Back (viewed player) / Security + Items + Prizes (own profile) */}
          {isViewing ? (
            <div className="px-5 pt-1 pb-5 flex flex-col gap-2">
              <button
                onClick={() => { setShowTransfer(true); setTransferResult(null); setTransferAmt(""); }}
                className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
                style={{
                  background: "rgba(232,64,10,0.08)",
                  color: "#e8400a",
                  border: "1px solid rgba(232,64,10,0.45)",
                  letterSpacing: "0.1em",
                  boxShadow: "0 0 10px rgba(232,64,10,0.12)",
                  cursor: "pointer",
                }}
              >
                Transfer
              </button>
              <button
                onClick={onBack}
                className="w-full py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.5)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  letterSpacing: "0.1em",
                  cursor: onBack ? "pointer" : "default",
                }}
              >
                ← Back
              </button>
            </div>
          ) : (
            <>
              <div className="px-5 pt-1 pb-2">
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
              <div className="px-5 pb-5 flex gap-2">
                <button
                  onClick={() => { setShowItems(true); loadInventory(); }}
                  className="flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
                  style={{
                    background: "rgba(6,182,212,0.10)",
                    color: "#06b6d4",
                    border: "1px solid rgba(6,182,212,0.35)",
                    letterSpacing: "0.08em",
                  }}
                >
                  🎁 Items
                </button>
                <button
                  onClick={() => { setShowPrizes(true); loadPrizes(); }}
                  className="flex-1 py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all duration-150"
                  style={{
                    background: "rgba(168,85,247,0.10)",
                    color: "#a855f7",
                    border: "1px solid rgba(168,85,247,0.35)",
                    letterSpacing: "0.08em",
                  }}
                >
                  🏅 Prizes
                </button>
              </div>
            </>
          )}

        </div>

        {/* Stat cards — 3 × 2 uniform grid */}
        <div
          className="flex-1"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gridAutoRows: "1fr",
            gap: 10,
            minWidth: 0,
          }}
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl flex flex-col items-center justify-center gap-2"
              style={{
                background: "#0c0a0a",
                border: `1px solid ${s.color}22`,
                padding: "18px 14px",
                boxShadow: `inset 0 0 28px ${s.color}07`,
                textAlign: "center",
              }}
            >
              {/* Neon icon */}
              <div style={{
                width: 54, height: 54, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `radial-gradient(circle, ${s.color}20 0%, transparent 70%)`,
                border: `1px solid ${s.color}33`,
                boxShadow: `0 0 14px ${s.color}22`,
                color: s.color,
              }}>
                {s.icon}
              </div>
              {/* Content */}
              <div className="flex flex-col items-center">
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                  {s.label}
                </p>
                <p className="font-black tabular-nums leading-none"
                  style={{
                    fontFamily: "'Orbitron', monospace",
                    fontSize: "clamp(16px, 1.8vw, 26px)",
                    color: s.color,
                    textShadow: `0 0 12px ${s.color}55`,
                  }}>
                  {s.value}
                </p>
                {s.sub && (
                  <p style={{ fontSize: 11, marginTop: 3, color: "rgba(255,255,255,0.22)" }}>{s.sub}</p>
                )}
              </div>
            </div>
          ))}

          {/* Rakeback card — own profile only */}
          {!isViewing && (() => {
            const rb = rakeback;
            const claimable  = rb?.claimable ?? 0;
            const onCooldown = rb?.onCooldown ?? false;
            const cdLabel    = fmtCooldown(rb?.nextClaimAt ?? null);
            return (
              <div
                className="rounded-xl flex flex-col items-center justify-center gap-2"
                style={{
                  background: "#0c0a0a",
                  border: "1px solid rgba(34,197,94,0.22)",
                  padding: "18px 14px",
                  boxShadow: "inset 0 0 28px rgba(34,197,94,0.04)",
                  textAlign: "center",
                }}
              >
                {/* Neon icon */}
                <div style={{
                  width: 54, height: 54, borderRadius: "50%", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "radial-gradient(circle, rgba(34,197,94,0.2) 0%, transparent 70%)",
                  border: "1px solid rgba(34,197,94,0.33)",
                  boxShadow: "0 0 14px rgba(34,197,94,0.22)",
                  color: "#22c55e",
                }}>
                  <Percent size={22} />
                </div>
                {/* Content */}
                <div className="flex flex-col items-center">
                  <p style={{ fontSize: 11, color: "rgba(255,255,255,0.32)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>
                    Rakeback
                  </p>
                  <p className="font-black tabular-nums leading-none"
                    style={{
                      fontFamily: "'Orbitron', monospace",
                      fontSize: "clamp(16px, 1.8vw, 26px)",
                      color: "#22c55e",
                      textShadow: "0 0 12px rgba(34,197,94,0.55)",
                    }}>
                    {fmt(claimable)}
                  </p>
                </div>

                {rbClaimMsg && (
                  <p style={{ fontSize: 9, marginTop: 5, color: rbClaimMsg.ok ? "#22c55e" : "#ef4444" }}>
                    {rbClaimMsg.text}
                  </p>
                )}

                <button
                  onClick={handleClaimRakeback}
                  disabled={rbClaiming || onCooldown || claimable === 0}
                  style={{
                    marginTop: 8, padding: onCooldown && cdLabel ? "4px 0 5px" : "5px 0",
                    borderRadius: 6,
                    background: (onCooldown || claimable === 0)
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(34,197,94,0.14)",
                    border: `1px solid ${(onCooldown || claimable === 0) ? "rgba(255,255,255,0.08)" : "rgba(34,197,94,0.32)"}`,
                    cursor: (rbClaiming || onCooldown || claimable === 0) ? "not-allowed" : "pointer",
                    fontFamily: "Rajdhani, sans-serif",
                    width: "100%",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 1,
                  }}
                >
                  {rbClaiming ? (
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(255,255,255,0.22)" }}>
                      Claiming…
                    </span>
                  ) : onCooldown && cdLabel ? (
                    <>
                      <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.28)", lineHeight: 1 }}>
                        Cooldown
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "rgba(255,255,255,0.55)", lineHeight: 1, fontFamily: "'Orbitron', monospace" }}>
                        {cdLabel}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: claimable === 0 ? "rgba(255,255,255,0.22)" : "#22c55e" }}>
                      Collect Rakeback
                    </span>
                  )}
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Recent Activity ──────────────────────────────────────── */}
      <SubHeader label="Activity Breakdown" />
      <div className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {activityEntries.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>
              No game history yet. Hit the tables!
            </span>
          </div>
        ) : activityEntries.map(([type, s], i) => {
          const net = s.received - s.spent;
          return (
            <div
              key={type}
              className="flex items-center px-5 py-3 gap-4 transition-colors duration-100"
              style={{ borderBottom: i < activityEntries.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.025)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {/* Type label */}
              <span className="font-rajdhani font-bold text-sm shrink-0"
                style={{ color: "rgba(255,255,255,0.78)", minWidth: 140 }}>
                {TX_LABELS[type] ?? type}
              </span>
              {/* Count pill */}
              <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full shrink-0"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  color: "rgba(255,255,255,0.38)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  minWidth: 32, textAlign: "center",
                }}>
                {s.count}×
              </span>
              <span className="flex-1" />
              {/* Spent */}
              {s.spent > 0 && (
                <span className="text-[11px] font-bold tabular-nums shrink-0"
                  style={{ color: "rgba(239,68,68,0.7)", minWidth: 90, textAlign: "right" }}>
                  −{fmt(s.spent)}
                </span>
              )}
              {/* Received */}
              {s.received > 0 && (
                <span className="text-[11px] font-bold tabular-nums shrink-0"
                  style={{ color: "rgba(34,197,94,0.7)", minWidth: 90, textAlign: "right" }}>
                  +{fmt(s.received)}
                </span>
              )}
              {/* Net */}
              <span className="text-sm font-black tabular-nums shrink-0"
                style={{ color: net >= 0 ? "#22c55e" : "#ef4444", minWidth: 100, textAlign: "right" }}>
                {net >= 0 ? "+" : ""}{fmt(net)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Biggest single win highlight */}
      {biggestWin > 0 && (
        <div className="mt-3 rounded-xl flex items-center gap-3 px-5 py-4"
          style={{
            background: "rgba(245,197,24,0.06)",
            border: "1px solid rgba(245,197,24,0.22)",
          }}>
          <span style={{ fontSize: 18 }}>⭐</span>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-widest font-bold"
              style={{ color: "#f5c518", letterSpacing: "0.12em" }}>
              Biggest Single Win
            </span>
            <span className="font-black tabular-nums"
              style={{
                fontFamily: "'Orbitron', monospace",
                fontSize: "clamp(14px, 2vw, 22px)",
                color: "#f5c518",
                textShadow: "0 0 14px rgba(245,197,24,0.5)",
              }}>
              +{fmt(biggestWin)} chips
            </span>
          </div>
        </div>
      )}

      {/* ── Items Inventory modal ───────────────────────────────── */}
      {showItems && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowItems(false); }}
        >
          <div style={{
            background: "#0e0b0b",
            border: "1px solid rgba(6,182,212,0.18)",
            borderRadius: 18,
            width: "100%", maxWidth: 600,
            maxHeight: "82vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 0 80px rgba(0,0,0,0.9), 0 0 40px rgba(6,182,212,0.05)",
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "18px 22px 16px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Package size={15} style={{ color: "#06b6d4" }} />
                <span style={{
                  fontFamily: "Rajdhani, sans-serif", fontWeight: 900, fontSize: 13,
                  letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
                }}>Item Inventory</span>
                {items.length > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: "rgba(6,182,212,0.14)", border: "1px solid rgba(6,182,212,0.28)",
                    color: "#06b6d4", borderRadius: 20, padding: "2px 8px",
                  }}>{items.length} item{items.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <button
                onClick={() => setShowItems(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4, lineHeight: 1 }}
              ><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ overflowY: "auto", flex: 1, padding: "14px 22px 22px" }}>
              {itemsLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading items…</span>
                </div>
              ) : items.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 0" }}>
                  <Package size={32} style={{ color: "rgba(255,255,255,0.1)" }} />
                  <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 13, textAlign: "center" }}>
                    No items in your inventory.<br />Open some cases to win prizes!
                  </span>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {items.map(item => {
                    const tc = ITEM_TIER[item.tier] ?? ITEM_TIER.common;
                    const sellVal = Math.floor((item.prize_value ?? 0) * 0.5);
                    const msg = itemMsg?.id === item.id ? itemMsg : null;
                    return (
                      <div key={item.id} style={{
                        background: "#0c0a0a",
                        border: `1px solid ${tc.color}22`,
                        borderRadius: 12,
                        padding: "11px 14px",
                        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                      }}>
                        {/* Emoji / image */}
                        <div style={{
                          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: `${tc.color}12`, border: `1px solid ${tc.color}28`,
                          fontSize: 20, overflow: "hidden",
                        }}>
                          {item.image_url
                            ? <img src={`${BASE}/api/uploads${item.image_url}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : (item.prize_emoji || "🎁")}
                        </div>

                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "Rajdhani, sans-serif" }}>
                              {item.prize_name}
                            </span>
                            <span style={{
                              fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em",
                              color: tc.color, background: `${tc.color}18`, border: `1px solid ${tc.color}2a`,
                              borderRadius: 10, padding: "1px 6px",
                            }}>{tc.label}</span>
                            {item.quantity > 1 && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.45)",
                                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                                borderRadius: 10, padding: "1px 6px",
                              }}>×{item.quantity}</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                            {item.source && (
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)" }}>From: {item.source}</span>
                            )}
                            {sellVal > 0 && (
                              <span style={{ fontSize: 10, color: "#f5c518" }}>Sell: {sellVal.toLocaleString()} chips</span>
                            )}
                          </div>
                          {msg && (
                            <p style={{ fontSize: 10, margin: "4px 0 0", color: msg.ok ? "#22c55e" : "#ef4444" }}>{msg.text}</p>
                          )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            onClick={() => handleItemRequest(item.id)}
                            style={{
                              padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700,
                              background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.28)",
                              color: "#22c55e", cursor: "pointer", textTransform: "uppercase",
                              letterSpacing: "0.06em", fontFamily: "Rajdhani, sans-serif",
                            }}
                          >Request</button>
                          {sellVal > 0 && (
                            <button
                              onClick={() => handleItemSell(item.id)}
                              style={{
                                padding: "5px 10px", borderRadius: 7, fontSize: 10, fontWeight: 700,
                                background: "rgba(245,197,24,0.12)", border: "1px solid rgba(245,197,24,0.28)",
                                color: "#f5c518", cursor: "pointer", textTransform: "uppercase",
                                letterSpacing: "0.06em", fontFamily: "Rajdhani, sans-serif",
                              }}
                            >Sell</button>
                          )}
                          <button
                            onClick={() => handleItemTrash(item.id)}
                            style={{
                              padding: "5px 8px", borderRadius: 7,
                              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)",
                              color: "rgba(239,68,68,0.5)", cursor: "pointer", display: "flex", alignItems: "center",
                            }}
                          ><Trash2 size={12} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Prizes modal ────────────────────────────────────────── */}
      {showPrizes && (() => {
        const pending   = prizes.filter(r => !r.delivered_at);
        const delivered = prizes.filter(r =>  r.delivered_at);
        const visible   = prizeFilter === "pending"   ? pending
                        : prizeFilter === "delivered" ? delivered
                        : prizes;
        return (
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 9999,
              background: "rgba(0,0,0,0.78)",
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: 16,
            }}
            onClick={e => { if (e.target === e.currentTarget) setShowPrizes(false); }}
          >
            <div style={{
              background: "#0e0b0b",
              border: "1px solid rgba(168,85,247,0.18)",
              borderRadius: 18,
              width: "100%", maxWidth: 600,
              maxHeight: "82vh",
              display: "flex", flexDirection: "column",
              boxShadow: "0 0 80px rgba(0,0,0,0.9), 0 0 40px rgba(168,85,247,0.05)",
            }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "18px 22px 14px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Trophy size={15} style={{ color: "#a855f7" }} />
                  <span style={{
                    fontFamily: "Rajdhani, sans-serif", fontWeight: 900, fontSize: 13,
                    letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
                  }}>Prize History</span>
                  {pending.length > 0 && (
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.28)",
                      color: "#fbbf24", borderRadius: 20, padding: "2px 8px",
                    }}>{pending.length} pending</span>
                  )}
                </div>
                <button
                  onClick={() => setShowPrizes(false)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 4, lineHeight: 1 }}
                ><X size={16} /></button>
              </div>

              {/* Filter tabs */}
              <div style={{
                display: "flex", gap: 6, padding: "10px 22px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}>
                {(["all", "pending", "delivered"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setPrizeFilter(f)}
                    style={{
                      padding: "4px 12px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                      textTransform: "capitalize", letterSpacing: "0.06em", cursor: "pointer",
                      fontFamily: "Rajdhani, sans-serif",
                      background: prizeFilter === f ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.05)",
                      border: prizeFilter === f ? "1px solid rgba(168,85,247,0.45)" : "1px solid rgba(255,255,255,0.1)",
                      color: prizeFilter === f ? "#a855f7" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {f === "all"       ? `All (${prizes.length})`
                    : f === "pending"  ? `Pending (${pending.length})`
                    :                   `Delivered (${delivered.length})`}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div style={{ overflowY: "auto", flex: 1, padding: "14px 22px 22px" }}>
                {prizesLoading ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading prizes…</span>
                  </div>
                ) : prizes.length === 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "48px 0" }}>
                    <Trophy size={32} style={{ color: "rgba(255,255,255,0.1)" }} />
                    <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 13, textAlign: "center" }}>
                      No prizes yet.<br />Play games and open cases to win rewards!
                    </span>
                  </div>
                ) : visible.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
                    <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 13 }}>
                      No {prizeFilter} prizes.
                    </span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {visible.map(r => {
                      const isDelivered = !!r.delivered_at;
                      const gameLabel = r.game === "wheel" ? "Prize Wheel" : r.game;
                      return (
                        <div
                          key={r.id}
                          style={{
                            background: "#0c0a0a",
                            border: `1px solid ${isDelivered ? "rgba(74,222,128,0.15)" : "rgba(251,191,36,0.15)"}`,
                            borderRadius: 12, padding: "12px 14px",
                            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
                          }}
                        >
                          {/* Emoji */}
                          <span style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}>{r.prize_emoji}</span>

                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "Rajdhani, sans-serif" }}>
                                {r.prize_name}
                              </span>
                              {r.prize_type === "chips" && r.chips_amount > 0 && (
                                <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#fbbf24", fontWeight: 700 }}>
                                  <Coins size={10} /> {r.chips_amount.toLocaleString()}
                                </span>
                              )}
                              {r.prize_type === "gems" && r.chips_amount > 0 && (
                                <span style={{ fontSize: 11, color: "#c084fc", fontWeight: 700 }}>
                                  💎 {r.chips_amount.toLocaleString()}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "capitalize" }}>{gameLabel}</span>
                              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)" }}>·</span>
                              <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                                <Clock size={9} />
                                {(() => { try { return fmtETDateTime(r.won_at); } catch { return r.won_at; } })()}
                              </span>
                            </div>
                            {isDelivered && (
                              <div style={{ fontSize: 10, color: "#4ade80", marginTop: 4, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                <CheckCircle2 size={10} />
                                {r.delivered_by ? `Delivered by ${r.delivered_by}` : "Delivered"}
                                {r.delivered_at && (
                                  <span style={{ color: "rgba(255,255,255,0.3)" }}>
                                    · {(() => { try { return fmtETDateTime(r.delivered_at!); } catch { return r.delivered_at; } })()}
                                  </span>
                                )}
                              </div>
                            )}
                            {r.notes && (
                              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{r.notes}</p>
                            )}
                          </div>

                          {/* Status icon */}
                          <div style={{ flexShrink: 0 }}>
                            {isDelivered
                              ? <CheckCircle2 size={16} style={{ color: "#4ade80" }} />
                              : <Hourglass   size={16} style={{ color: "#fbbf24" }} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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

      {/* ── Transfer Chips modal ─────────────────────────────────── */}
      {isViewing && showTransfer && pubData && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.78)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) { setShowTransfer(false); setTransferResult(null); } }}
        >
          <div style={{
            background: "#0e0b06",
            border: "1px solid rgba(232,64,10,0.22)",
            borderRadius: 18,
            padding: "22px 24px 24px",
            width: "100%", maxWidth: 320,
            boxShadow: "0 0 80px rgba(0,0,0,0.9), 0 0 40px rgba(232,64,10,0.05)",
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ArrowRightLeft size={14} style={{ color: "#e8400a" }} />
                <span style={{
                  fontFamily: "Rajdhani, sans-serif", fontWeight: 900, fontSize: 13,
                  letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
                }}>
                  Transfer Chips
                </span>
              </div>
              <button
                onClick={() => { setShowTransfer(false); setTransferResult(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2, lineHeight: 1, fontSize: 18 }}
              >
                ×
              </button>
            </div>

            {/* Recipient chip */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(232,64,10,0.07)",
              border: "1px solid rgba(232,64,10,0.18)",
              borderRadius: 8, padding: "7px 12px",
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.35)", fontFamily: "Rajdhani, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", flexShrink: 0 }}>To</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", fontFamily: "Rajdhani, sans-serif", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pubData.username}</span>
              {pubData.stateId && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", flexShrink: 0 }}>#{pubData.stateId}</span>}
            </div>

            {/* Amount input */}
            <input
              type="number"
              min={1}
              value={transferAmt}
              onChange={e => { setTransferAmt(e.target.value); setTransferResult(null); }}
              onKeyDown={e => { if (e.key === "Enter" && !transferLoading) doTransfer(); }}
              placeholder="Amount"
              disabled={transferLoading}
              style={{
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 8, padding: "8px 12px",
                color: "#fff", fontSize: 14, outline: "none",
                width: "100%", boxSizing: "border-box",
                fontFamily: "'Orbitron', monospace",
              }}
            />

            {/* Result message */}
            {transferResult && (
              <p style={{ fontSize: 12, margin: 0, color: transferResult.ok ? "#22c55e" : "#ef4444", textAlign: "center" }}>
                {transferResult.text}
              </p>
            )}

            {/* Confirm button */}
            <button
              onClick={doTransfer}
              disabled={!parseInt(transferAmt) || parseInt(transferAmt) < 1 || transferLoading}
              style={{
                padding: "10px 0", borderRadius: 8,
                background: "rgba(232,64,10,0.16)",
                border: "1px solid rgba(232,64,10,0.45)",
                color: "#e8400a", fontWeight: 700, fontSize: 12,
                letterSpacing: "0.08em", textTransform: "uppercase",
                cursor: (!parseInt(transferAmt) || parseInt(transferAmt) < 1 || transferLoading) ? "not-allowed" : "pointer",
                opacity: (!parseInt(transferAmt) || parseInt(transferAmt) < 1 || transferLoading) ? 0.5 : 1,
                fontFamily: "Rajdhani, sans-serif",
                boxShadow: "0 0 16px rgba(232,64,10,0.08)",
              }}
            >
              {transferLoading ? "Sending…" : "Confirm Transfer"}
            </button>
          </div>
        </div>
      )}

    </PageWrapper>
  );
}
