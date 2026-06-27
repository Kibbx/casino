import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { fmtETDateTimeFull, fmtETDateTime } from "../utils/timezone";
import {
  ChevronLeft, Coins, Package, TrendingUp, Calendar,
  Hash, Star, Clock, CheckCircle2, Hourglass, ArrowDownLeft, ArrowUpRight,
  Gem, BarChart3, User, Shield, Eye, EyeOff, Percent,
} from "lucide-react";
import { AvatarUpload } from "../components/AvatarUpload";

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

interface InventoryItem {
  id: number;
  prize_item_id: number;
  prize_name: string;
  prize_emoji: string;
  prize_type: string;
  quantity: number;
  image_url: string | null;
  tier: string | null;
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

// Types that represent money the player SPENT (bet/wagered)
const WAGER_TYPES = new Set([
  "loss",                              // blackjack, roulette, crash, horse racing, mines, generic slots
  "fortuna-bet", "fortuna-bonus-buy",  // Fortuna slots
  "rome-slots-bet",                    // Rome slots
  "western-slots-bet",                 // Western slots
  "highlow_bet",                       // High-Low
  "baccarat",                          // Baccarat (single type covers bet)
  "sport_bet",                         // Sports betting
]);
// Types that represent money the player RECEIVED (winnings)
const WIN_TYPES   = new Set([
  "win", "tournament_win", "fortuna-win", "rome-slots-win",
  "western-slots-win", "rakeback",
]);
// Poker is player-to-player — exclude all poker transactions from stats/history
function isPokerTx(t: { type: string; description?: string | null }): boolean {
  const d = (t.description || "").toLowerCase();
  return t.type === "buyin" || t.type === "poker_win" || t.type === "cashout" ||
    d.startsWith("poker") || d.startsWith("won pot") || d.startsWith("rake collected at") ||
    d.startsWith("buy-in to table") || d.startsWith("left table") || d.startsWith("afk kicked from table");
}
// All game-related types for stats filtering
const GAME_TYPES  = new Set([...WAGER_TYPES, ...WIN_TYPES]);

const TIER_COLORS: Record<string, string> = {
  jackpot: "#f59e0b", legendary: "#a855f7", epic: "#ec4899", rare: "#3b82f6", common: "#6b7280",
};
const TIER_LABELS: Record<string, string> = {
  jackpot: "JACKPOT", legendary: "LEGENDARY", epic: "EPIC", rare: "RARE", common: "COMMON",
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

function fmtDate(iso: string) {
  try { return fmtETDateTimeFull(iso); } catch { return iso; }
}

function fmtShort(iso: string) {
  try { return fmtETDateTime(iso); } catch { return iso; }
}

function fmt(n: number) { return n.toLocaleString(); }

type Tab = "overview" | "inventory" | "prizes" | "history" | "security" | "rakeback";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { sessionToken, playerId } = useStore();
  const initialTab = (): Tab => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p === "inventory" || p === "prizes" || p === "history") return p;
    return "overview";
  };
  const [tab, setTab] = useState<Tab>(initialTab);

  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<number | null>(null);
  const [requestMsg, setRequestMsg] = useState<{ id: number; ok: boolean; text: string } | null>(null);
  const [confirmState, setConfirmState] = useState<Record<number, "trash" | "sell">>({});
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [prizePage, setPrizePage] = useState(0);
  const PRIZE_PAGE_SIZE = 10;
  const [itemTierFilter, setItemTierFilter] = useState<string>("all");
  const [prizeStatusFilter, setPrizeStatusFilter] = useState<"all" | "pending" | "delivered">("all");
  const [prizeGameFilter, setPrizeGameFilter] = useState<string>("all");

  const [pinCurrent, setPinCurrent] = useState("");
  const [pinNew, setPinNew] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinLoading, setPinLoading] = useState(false);
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPinCurrent, setShowPinCurrent] = useState(false);
  const [showPinNew, setShowPinNew] = useState(false);

  interface RakebackStatus {
    claimable: number;
    wageredReal: number;
    wonReal: number;
    lastClaimed: string | null;
    onCooldown: boolean;
    nextClaimAt: string | null;
  }
  const [rakebackStatus, setRakebackStatus] = useState<RakebackStatus | null>(null);
  const [rakebackLoading, setRakebackLoading] = useState(false);
  const [rakebackClaiming, setRakebackClaiming] = useState(false);
  const [rakebackMsg, setRakebackMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadRakeback() {
    if (!sessionToken) return;
    setRakebackLoading(true);
    try {
      const r = await fetch(`${BASE}/api/rakeback/status`, { headers: { Authorization: `Bearer ${sessionToken}` } });
      const d = await r.json();
      if (r.ok) setRakebackStatus(d);
    } catch {}
    setRakebackLoading(false);
  }

  async function claimRakeback() {
    if (!sessionToken || rakebackClaiming) return;
    setRakebackClaiming(true);
    setRakebackMsg(null);
    try {
      const r = await fetch(`${BASE}/api/rakeback/claim`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } });
      const d = await r.json();
      if (r.ok) {
        setRakebackMsg({ ok: true, text: `Claimed ${d.claimed.toLocaleString()} BET chips!` });
        setPlayer(p => p ? { ...p, chips: d.newBalance } : p);
        await loadRakeback();
      } else {
        setRakebackMsg({ ok: false, text: d.error ?? "Claim failed" });
      }
    } catch {
      setRakebackMsg({ ok: false, text: "Network error" });
    }
    setRakebackClaiming(false);
    setTimeout(() => setRakebackMsg(null), 5000);
  }

  useEffect(() => {
    if (tab === "rakeback") loadRakeback();
  }, [tab]);

  async function handleChangePin() {
    if (!sessionToken || !player) return;
    if (pinNew !== pinConfirm) { setPinMsg({ ok: false, text: "New PINs do not match." }); return; }
    if (pinNew.length < 4) { setPinMsg({ ok: false, text: "New PIN must be at least 4 characters." }); return; }
    setPinLoading(true);
    setPinMsg(null);
    try {
      const res = await fetch(`${BASE}/api/players/change-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ currentPin: pinCurrent, newPin: pinNew }),
      });
      const data = await res.json();
      if (!res.ok) { setPinMsg({ ok: false, text: data.error ?? "Failed to change PIN." }); }
      else { setPinMsg({ ok: true, text: "PIN updated successfully!" }); setPinCurrent(""); setPinNew(""); setPinConfirm(""); }
    } catch { setPinMsg({ ok: false, text: "Network error." }); }
    setPinLoading(false);
  }

  const requestItem = useCallback(async (inventoryId: number) => {
    if (!sessionToken) return;
    setRequestingId(inventoryId);
    setRequestMsg(null);
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${inventoryId}/request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setRequestMsg({ id: inventoryId, ok: false, text: data.error ?? "Request failed" });
      } else {
        setRequestMsg({ id: inventoryId, ok: true, text: "Requested! Check your Prizes tab." });
        setTimeout(() => setRequestMsg(m => m?.id === inventoryId ? null : m), 2500);
        const headers = { Authorization: `Bearer ${sessionToken}` };
        Promise.allSettled([
          fetch(`${BASE}/api/cases/my-inventory`, { headers })
            .then(r => r.ok ? r.json() : []).then(d => setInventory(Array.isArray(d) ? d : [])),
          fetch(`${BASE}/api/prizes/my-rewards`, { headers })
            .then(r => r.ok ? r.json() : []).then(d => setRewards(Array.isArray(d) ? d : [])),
        ]);
      }
    } catch {
      setRequestMsg({ id: inventoryId, ok: false, text: "Network error" });
    } finally {
      setRequestingId(null);
    }
  }, [sessionToken]);

  function removeOrDecrement(id: number) {
    setInventory(prev =>
      prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity > 0)
    );
  }

  const trashItem = useCallback(async (item: InventoryItem) => {
    if (!sessionToken) return;
    if (confirmState[item.id] !== "trash") {
      setConfirmState(s => ({ ...s, [item.id]: "trash" }));
      return;
    }
    setActionLoading(item.id);
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${item.id}/trash`, {
        method: "POST", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      removeOrDecrement(item.id);
      setActionMsg({ ok: true, text: `Trashed ${item.prize_name}.` });
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message });
    } finally {
      setActionLoading(null);
      setConfirmState(s => { const n = { ...s }; delete n[item.id]; return n; });
      setTimeout(() => setActionMsg(null), 3500);
    }
  }, [sessionToken, confirmState]);

  const sellItem = useCallback(async (item: InventoryItem) => {
    if (!sessionToken) return;
    if (confirmState[item.id] !== "sell") {
      setConfirmState(s => ({ ...s, [item.id]: "sell" }));
      return;
    }
    setActionLoading(item.id);
    try {
      const res = await fetch(`${BASE}/api/cases/my-inventory/${item.id}/sell`, {
        method: "POST", headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      removeOrDecrement(item.id);
      setActionMsg({ ok: true, text: `Sold ${item.prize_name} for ${data.chipsAwarded?.toLocaleString()} chips!` });
    } catch (e: any) {
      setActionMsg({ ok: false, text: e.message });
    } finally {
      setActionLoading(null);
      setConfirmState(s => { const n = { ...s }; delete n[item.id]; return n; });
      setTimeout(() => setActionMsg(null), 3500);
    }
  }, [sessionToken, confirmState]);

  const load = useCallback(async () => {
    if (!sessionToken || !playerId) { setLocation("/login"); return; }
    try {
      const headers = { Authorization: `Bearer ${sessionToken}` };

      // Core data — errors shown to user
      const [pRes, tRes] = await Promise.all([
        fetch(`${BASE}/api/players/${playerId}`, { headers }),
        fetch(`${BASE}/api/players/${playerId}/transactions`, { headers }),
      ]);
      const [pData, tData] = await Promise.all([pRes.json(), tRes.json()]);
      if (!pRes.ok) throw new Error(pData.error ?? "Failed to load profile");
      setPlayer(pData);
      setTxs(Array.isArray(tData) ? tData : []);

      // Supplementary data — silently ignored if unavailable
      await Promise.allSettled([
        fetch(`${BASE}/api/cases/my-inventory`, { headers })
          .then(r => r.ok ? r.json() : [])
          .then(d => setInventory(Array.isArray(d) ? d : []))
          .catch(() => {}),
        fetch(`${BASE}/api/prizes/my-rewards`, { headers })
          .then(r => r.ok ? r.json() : [])
          .then(d => setRewards(Array.isArray(d) ? d : []))
          .catch(() => {}),
      ]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionToken, playerId]);

  useEffect(() => { load(); }, [load]);

  // ── Computed stats from transactions ──────────────────────────────────────
  // handsPlayed is tracked server-side for every game (all slots, blackjack, roulette,
  // crash, baccarat, horse racing, high-low, cases, sports betting, tournaments).
  // Use it directly so no game is missed.
  const roundsPlayed = player?.handsPlayed ?? 0;
  const totalWagered = txs.filter(t => WAGER_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const totalWon     = txs.filter(t => WIN_TYPES.has(t.type) && !isPokerTx(t)).reduce((s, t) => s + t.amount, 0);
  const biggestWin   = txs.filter(t => WIN_TYPES.has(t.type) && !isPokerTx(t)).reduce((max, t) => t.amount > max ? t.amount : max, 0);
  const netResult    = totalWon - totalWagered;

  const chips = Number(player?.chips ?? 0);
  const gems  = Number(player?.gems ?? 0);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",  label: "Overview",      icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "inventory", label: `Items (${inventory.length})`, icon: <Package className="w-3.5 h-3.5" /> },
    { id: "prizes",    label: `Prizes (${rewards.length})`,  icon: <Star className="w-3.5 h-3.5" /> },
    { id: "history",   label: "Bet History",   icon: <Clock className="w-3.5 h-3.5" /> },
    { id: "rakeback",  label: "Rakeback",      icon: <Percent className="w-3.5 h-3.5" /> },
    { id: "security",  label: "Security",      icon: <Shield className="w-3.5 h-3.5" /> },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-sm animate-pulse">Loading profile…</div>
      </div>
    );
  }

  if (error || !player) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-red-400 text-sm">{error ?? "Profile not found"}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-10 border-b border-border bg-card/80">
        <div className="max-w-4xl mx-auto px-4 h-12 flex items-center gap-3">
          <button
            onClick={() => setLocation("/lobby")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">My Profile</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

        {/* ── Profile hero card ── */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <AvatarUpload
                playerId={player.id}
                currentAvatarUrl={player.avatarUrl ?? null}
                username={player.username}
                size="lg"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground leading-none">{player.username}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Big House Casino Member</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {player.stateId && (
                  <span className="flex items-center gap-1">
                    <Hash className="w-3 h-3" /> State ID: <span className="text-foreground font-mono font-semibold">{player.stateId}</span>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Member since {fmtDate(player.createdAt)}
                </span>
                {player.referralCode && (
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Referral:</span>
                    <span className="font-mono font-semibold text-primary">{player.referralCode}</span>
                  </span>
                )}
              </div>
              {/* Credit score */}
              {player.creditScore !== undefined && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">Credit Score</span>
                  <div className="flex items-center gap-1">
                    <div className={`text-sm font-bold tabular-nums ${player.creditScore >= 750 ? "text-emerald-400" : player.creditScore >= 600 ? "text-amber-400" : "text-red-400"}`}>
                      {player.creditScore}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${player.creditScore >= 750 ? "bg-emerald-950 text-emerald-400" : player.creditScore >= 600 ? "bg-amber-950 text-amber-400" : "bg-red-950 text-red-400"}`}>
                      {player.creditScore >= 750 ? "EXCELLENT" : player.creditScore >= 600 ? "GOOD" : "POOR"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Wallet */}
            <div className="flex-shrink-0 flex flex-col gap-2">
              <div className="flex items-center gap-2 bg-amber-950 border border-amber-800 rounded-xl px-4 py-2.5">
                <Coins className="w-4 h-4 text-amber-400" />
                <div>
                  <div className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Chips</div>
                  <div className="font-display font-bold text-amber-300 text-base tabular-nums leading-none">{fmt(chips)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-purple-950 border border-purple-800 rounded-xl px-4 py-2.5">
                <Gem className="w-4 h-4 text-purple-400" />
                <div>
                  <div className="text-[10px] text-purple-400 font-semibold uppercase tracking-wider">Gems</div>
                  <div className="font-display font-bold text-purple-300 text-base tabular-nums leading-none">{fmt(gems)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Stats row ── */}
        <div className="grid grid-cols-2 grid-cols-4 gap-3">
          <StatCard label="Rounds Played" value={fmt(roundsPlayed)} icon={<TrendingUp className="w-4 h-4" />} color="text-blue-400" />
          <StatCard label="Total Wagered" value={fmt(totalWagered)} icon={<Coins className="w-4 h-4" />} color="text-red-400" sub="chips" />
          <StatCard label="Total Won" value={fmt(totalWon)} icon={<Star className="w-4 h-4" />} color="text-emerald-400" sub="chips" />
          <StatCard
            label="Net Result"
            value={(netResult >= 0 ? "+" : "") + fmt(netResult)}
            icon={netResult >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
            color={netResult >= 0 ? "text-emerald-400" : "text-red-400"}
            sub="chips"
          />
        </div>

        {/* ── Tabs ── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex border-b border-border">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? "text-primary border-b-2 border-primary bg-primary/5"
                    : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {/* OVERVIEW */}
            {tab === "overview" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-3">Activity Breakdown</p>
                {txs.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">No game history yet. Hit the tables!</div>
                ) : (() => {
                  const byType: Record<string, { spent: number; received: number; count: number }> = {};
                  for (const t of txs) {
                    if (!byType[t.type]) byType[t.type] = { spent: 0, received: 0, count: 0 };
                    byType[t.type].count++;
                    if (WIN_TYPES.has(t.type)) byType[t.type].received += t.amount;
                    else byType[t.type].spent += t.amount;
                  }
                  const entries = Object.entries(byType).sort((a, b) => (b[1].spent + b[1].received) - (a[1].spent + a[1].received));
                  return (
                    <div className="space-y-1">
                      {entries.map(([type, s]) => {
                        const net = s.received - s.spent;
                        return (
                          <div key={type} className="flex items-center gap-3 py-1.5 border-b border-border/40 last:border-0">
                            <div className="w-32 text-sm font-semibold">{TX_LABELS[type] ?? type}</div>
                            <div className="flex-1 text-xs text-muted-foreground">{s.count}×</div>
                            {s.spent > 0 && <div className="text-xs text-muted-foreground">−{fmt(s.spent)}</div>}
                            {s.received > 0 && <div className="text-xs text-muted-foreground">+{fmt(s.received)}</div>}
                            <div className={`text-xs font-bold font-mono w-20 text-right ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {net >= 0 ? "+" : ""}{fmt(net)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {biggestWin > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950 px-4 py-3 flex items-center gap-3">
                    <Star className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Biggest Single Win</div>
                      <div className="text-lg font-display font-bold text-amber-300 tabular-nums">+{fmt(biggestWin)} chips</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* INVENTORY */}
            {tab === "inventory" && (
              <>
                {inventory.length === 0 ? (
                  <div className="text-center py-14">
                    <Package className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">No items yet. Open a case to start collecting!</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground mb-2">Click <span className="text-amber-400 font-semibold">Request</span> to send an item to staff for delivery.</p>
                    {/* Tier filter */}
                    <div className="flex items-center gap-1 flex-wrap mb-3">
                      {["all", "jackpot", "legendary", "epic", "rare", "common"].map(tier => {
                        const active = itemTierFilter === tier;
                        const color = tier === "all" ? "#6b7280" : (TIER_COLORS[tier] ?? "#6b7280");
                        return (
                          <button key={tier} onClick={() => setItemTierFilter(tier)}
                            className="px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all"
                            style={{
                              background: active ? color + "33" : "transparent",
                              borderColor: active ? color + "88" : "rgba(255,255,255,0.1)",
                              color: active ? color : "#6b7280",
                            }}>
                            {tier === "all" ? "All" : (TIER_LABELS[tier] ?? tier)}
                            {tier !== "all" && ` (${inventory.filter(i => i.tier === tier).length})`}
                          </button>
                        );
                      })}
                    </div>
                    {/* Global action toast */}
                    {actionMsg && (
                      <div className={`mb-3 px-3 py-2 rounded-lg text-[11px] font-semibold text-center border ${actionMsg.ok ? "text-emerald-400 border-emerald-700 bg-emerald-950" : "text-red-400 border-red-700 bg-red-950"}`}>
                        {actionMsg.text}
                      </div>
                    )}
                    {(() => {
                      const filtered = itemTierFilter === "all" ? inventory : inventory.filter(i => i.tier === itemTierFilter);
                      if (filtered.length === 0) return (
                        <div className="text-center py-8 text-muted-foreground text-sm">No {itemTierFilter} items.</div>
                      );
                      return (
                    <div className="grid grid-cols-2 grid-cols-3 grid-cols-4 gap-3">
                      {filtered.map(item => {
                        const tc = TIER_COLORS[item.tier ?? "common"] ?? TIER_COLORS.common;
                        const isRequesting = requestingId === item.id;
                        const isActing = actionLoading === item.id;
                        const confirm = confirmState[item.id];
                        const sellAmt = Math.floor((item.prize_value ?? 0) * 0.5);
                        const canSell = sellAmt > 0;
                        return (
                          <div key={item.id} className="rounded-xl overflow-hidden border relative flex flex-col" style={{ borderColor: tc + "40", background: "rgba(255,255,255,0.03)" }}>
                            <div className="absolute top-1.5 left-1.5 z-10 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: tc + "22", border: `1px solid ${tc}55`, color: tc }}>
                              {TIER_LABELS[item.tier ?? "common"] ?? "ITEM"}
                            </div>
                            <div className="absolute top-1.5 right-1.5 z-10 text-[11px] font-bold px-1.5 py-0.5 rounded bg-black/70 border border-white/20 text-white">
                              ×{item.quantity}
                            </div>
                            <div className="h-24 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${tc}12, transparent)` }}>
                              {item.image_url
                                ? <img src={`${BASE}/api/uploads${item.image_url}`} alt={item.prize_name} className="max-w-[80%] max-h-20 object-contain" />
                                : <span className="text-4xl">{item.prize_emoji}</span>
                              }
                            </div>
                            <div className="p-2 flex-1 flex flex-col gap-1">
                              <p className="text-xs font-semibold text-foreground leading-tight">{item.prize_name}</p>
                              {item.source && <p className="text-[10px] text-muted-foreground">From: {item.source}</p>}
                              {canSell && (
                                <p className="text-[10px] text-amber-400">Sell: {sellAmt.toLocaleString()} chips</p>
                              )}
                              {requestMsg?.id === item.id && (
                                <p className={`text-[10px] font-semibold mt-1 ${requestMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                                  {requestMsg.text}
                                </p>
                              )}
                              {/* Request button */}
                              <button
                                disabled={isRequesting || (requestMsg?.id === item.id && requestMsg.ok)}
                                onClick={() => requestItem(item.id)}
                                className="mt-1 w-full text-[10px] font-bold py-1.5 rounded-lg transition-all disabled:opacity-40"
                                style={{ background: tc + "22", border: `1px solid ${tc}55`, color: tc, cursor: isRequesting ? "not-allowed" : "pointer" }}
                              >
                                {isRequesting ? "Requesting…" : "Request"}
                              </button>
                              {/* Trash / Sell row */}
                              {confirm ? (
                                <div className="flex flex-col gap-1 mt-0.5">
                                  <p className="text-[9px] text-muted-foreground text-center">
                                    {confirm === "sell" ? `Sell for ${sellAmt.toLocaleString()} chips?` : "Trash this item?"}
                                  </p>
                                  <div className="flex gap-1">
                                    <button
                                      disabled={isActing}
                                      onClick={() => confirm === "sell" ? sellItem(item) : trashItem(item)}
                                      className="flex-1 text-[10px] font-bold py-1 rounded-lg disabled:opacity-40"
                                      style={{
                                        background: confirm === "sell" ? "rgba(74,222,128,0.15)" : "rgba(239,68,68,0.15)",
                                        border: `1px solid ${confirm === "sell" ? "rgba(74,222,128,0.4)" : "rgba(239,68,68,0.4)"}`,
                                        color: confirm === "sell" ? "#4ade80" : "#f87171",
                                        cursor: isActing ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      {isActing ? "…" : "Confirm"}
                                    </button>
                                    <button
                                      disabled={isActing}
                                      onClick={() => setConfirmState(s => { const n = { ...s }; delete n[item.id]; return n; })}
                                      className="text-[10px] font-bold px-2 py-1 rounded-lg"
                                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-1 mt-0.5">
                                  {canSell && (
                                    <button
                                      onClick={() => sellItem(item)}
                                      className="flex-1 text-[10px] font-bold py-1 rounded-lg"
                                      style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", color: "#fbbf24", cursor: "pointer" }}
                                    >
                                      Sell
                                    </button>
                                  )}
                                  <button
                                    onClick={() => trashItem(item)}
                                    className="text-[10px] font-bold py-1 rounded-lg"
                                    style={{
                                      flex: canSell ? "0 0 auto" : 1,
                                      padding: canSell ? "4px 8px" : "4px 0",
                                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "rgba(239,68,68,0.7)", cursor: "pointer"
                                    }}
                                  >
                                    🗑
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                      );
                    })()}
                  </>
                )}
              </>
            )}

            {/* PRIZES */}
            {tab === "prizes" && (
              <>
                {rewards.length === 0 ? (
                  <div className="text-center py-14">
                    <Star className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">No prize history yet.</p>
                  </div>
                ) : (() => {
                  const games = ["all", ...Array.from(new Set(rewards.map(r => r.game)))];
                  const filtered = rewards
                    .filter(r => prizeGameFilter === "all" || r.game === prizeGameFilter)
                    .filter(r => prizeStatusFilter === "all" || (prizeStatusFilter === "pending" ? !r.delivered_at : !!r.delivered_at));
                  const pending = filtered.filter(r => !r.delivered_at);
                  const delivered = filtered.filter(r => r.delivered_at);
                  const totalPages = Math.ceil(delivered.length / PRIZE_PAGE_SIZE);
                  const pageDelivered = delivered.slice(prizePage * PRIZE_PAGE_SIZE, (prizePage + 1) * PRIZE_PAGE_SIZE);
                  const GAME_LABEL: Record<string, string> = { all: "All", case: "Case" };
                  return (
                    <div className="space-y-1">
                      {/* Filters */}
                      <div className="flex items-center gap-2 flex-wrap pb-2 border-b border-border/40 mb-2">
                        <div className="flex gap-1">
                          {(["all", "pending", "delivered"] as const).map(s => (
                            <button key={s} onClick={() => { setPrizeStatusFilter(s); setPrizePage(0); }}
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${prizeStatusFilter === s ? "bg-violet-950 border-violet-600 text-violet-300" : "border-border/50 text-muted-foreground hover:text-foreground"}`}>
                              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                          ))}
                        </div>
                        {games.length > 2 && (
                          <div className="flex gap-1 ml-auto">
                            {games.map(g => (
                              <button key={g} onClick={() => { setPrizeGameFilter(g); setPrizePage(0); }}
                                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${prizeGameFilter === g ? "bg-blue-950 border-blue-600 text-blue-300" : "border-border/50 text-muted-foreground hover:text-foreground"}`}>
                                {GAME_LABEL[g] ?? g}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {filtered.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">No prizes match this filter.</div>
                      ) : (
                        <>
                          {/* Pending section */}
                          {pending.length > 0 && prizeStatusFilter !== "delivered" && (
                            <>
                              <div className="flex items-center gap-1.5 py-1">
                                <Hourglass className="w-3 h-3 text-amber-400" />
                                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Awaiting Delivery ({pending.length})</span>
                              </div>
                              {pending.map(r => <PrizeRow key={r.id} r={r} />)}
                              {delivered.length > 0 && <div className="border-t border-border/50 my-2" />}
                            </>
                          )}

                          {/* Delivered section — paginated */}
                          {delivered.length > 0 && prizeStatusFilter !== "pending" && (
                            <>
                              <div className="flex items-center justify-between py-1">
                                <div className="flex items-center gap-1.5">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Delivered ({delivered.length})</span>
                                </div>
                                {totalPages > 1 && (
                                  <div className="flex items-center gap-1">
                                    <button disabled={prizePage === 0} onClick={() => setPrizePage(p => p - 1)}
                                      className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed">‹</button>
                                    <span className="text-[10px] text-muted-foreground">{prizePage + 1} / {totalPages}</span>
                                    <button disabled={prizePage >= totalPages - 1} onClick={() => setPrizePage(p => p + 1)}
                                      className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed">›</button>
                                  </div>
                                )}
                              </div>
                              {pageDelivered.map(r => <PrizeRow key={r.id} r={r} />)}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  );
                })()}
              </>
            )}

            {/* RAKEBACK */}
            {tab === "rakeback" && (
              <div className="max-w-sm mx-auto space-y-4 py-2">
                {/* Header */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-amber-400" />
                    <span className="text-sm font-semibold text-foreground">Rakeback — 3% Back</span>
                  </div>
                  <button
                    onClick={loadRakeback}
                    disabled={rakebackLoading}
                    className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
                  >
                    {rakebackLoading ? "Refreshing…" : "↻ Refresh"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground -mt-2">
                  Earn 3% back on your net real-chip losses. Play blackjack, baccarat, roulette, slots, mines, high-low and more — your rakeback builds up until you're ready to claim it. No timer, no expiry.
                </p>

                {rakebackLoading && !rakebackStatus && (
                  <div className="text-center py-8 text-muted-foreground text-sm animate-pulse">Loading…</div>
                )}

                {rakebackStatus && (() => {
                  const rb = rakebackStatus;
                  const netLoss = Math.max(0, rb.wageredReal - rb.wonReal);
                  const canClaim = rb.claimable > 0 && !rb.onCooldown;

                  // Cooldown countdown
                  const cooldownRemainMs = rb.nextClaimAt ? Math.max(0, new Date(rb.nextClaimAt).getTime() - Date.now()) : 0;
                  const cooldownHrs  = Math.floor(cooldownRemainMs / 3_600_000);
                  const cooldownMins = Math.floor((cooldownRemainMs % 3_600_000) / 60_000);

                  return (
                    <div className="space-y-3">
                      {/* Stats grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Rate</p>
                          <p className="text-xl font-display font-bold text-amber-400">3%</p>
                        </div>
                        <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Net Real Loss</p>
                          <p className="text-xl font-display font-bold text-red-400">{fmt(netLoss)}</p>
                          <p className="text-[10px] text-muted-foreground">chips</p>
                        </div>
                        <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Wagered</p>
                          <p className="text-base font-display font-bold text-foreground">{fmt(rb.wageredReal)}</p>
                          <p className="text-[10px] text-muted-foreground">real chips</p>
                        </div>
                        <div className="bg-muted/30 border border-border rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Won Back</p>
                          <p className="text-base font-display font-bold text-emerald-400">{fmt(rb.wonReal)}</p>
                          <p className="text-[10px] text-muted-foreground">real chips</p>
                        </div>
                      </div>

                      {/* Claimable highlight */}
                      <div className={`rounded-xl border p-4 text-center ${canClaim ? "border-amber-700 bg-amber-950" : "border-border bg-muted/20"}`}>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Claimable Now</p>
                        <p className={`text-3xl font-display font-bold tabular-nums ${canClaim ? "text-amber-300" : "text-muted-foreground"}`}>
                          {fmt(rb.claimable)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">BET chips</p>
                      </div>

                      {/* Cooldown notice */}
                      {rb.onCooldown && (
                        <div className="rounded-xl border border-border bg-muted/20 p-3 text-center space-y-1">
                          <p className="text-xs text-muted-foreground font-semibold">Claim cooldown active</p>
                          <p className="text-lg font-display font-bold text-foreground tabular-nums">
                            {cooldownHrs}h {cooldownMins}m
                          </p>
                          <p className="text-[10px] text-muted-foreground">until next claim</p>
                        </div>
                      )}

                      {/* Claim button */}
                      <button
                        onClick={claimRakeback}
                        disabled={!canClaim || rakebackClaiming}
                        className="w-full rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{
                          background: canClaim ? "linear-gradient(135deg, #b45309, #d97706)" : undefined,
                          backgroundColor: canClaim ? undefined : "rgba(255,255,255,0.05)",
                          color: canClaim ? "#fff" : "rgba(255,255,255,0.3)",
                          border: canClaim ? "1px solid #d9770680" : "1px solid rgba(255,255,255,0.1)",
                        }}
                      >
                        {rakebackClaiming ? "Claiming…" : rb.onCooldown ? "On Cooldown" : canClaim ? `Claim ${fmt(rb.claimable)} BET` : "Nothing to Claim"}
                      </button>

                      {rakebackMsg && (
                        <p className={`text-xs font-semibold text-center ${rakebackMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                          {rakebackMsg.text}
                        </p>
                      )}

                      {rb.lastClaimed && (
                        <p className="text-[10px] text-muted-foreground text-center">
                          Last claimed: {fmtShort(rb.lastClaimed)}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* SECURITY */}
            {tab === "security" && (
              <div className="max-w-sm mx-auto space-y-5 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold">Change PIN</span>
                </div>
                <p className="text-xs text-muted-foreground -mt-3">Your PIN is used to log in. Keep it private.</p>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Current PIN</label>
                    <div className="relative">
                      <input
                        type={showPinCurrent ? "text" : "password"}
                        value={pinCurrent}
                        onChange={e => { setPinCurrent(e.target.value); setPinMsg(null); }}
                        placeholder="Enter current PIN"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button type="button" onClick={() => setShowPinCurrent(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showPinCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">New PIN</label>
                    <div className="relative">
                      <input
                        type={showPinNew ? "text" : "password"}
                        value={pinNew}
                        onChange={e => { setPinNew(e.target.value); setPinMsg(null); }}
                        placeholder="Min. 4 characters"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button type="button" onClick={() => setShowPinNew(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showPinNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Confirm New PIN</label>
                    <input
                      type="password"
                      value={pinConfirm}
                      onChange={e => { setPinConfirm(e.target.value); setPinMsg(null); }}
                      placeholder="Repeat new PIN"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {pinMsg && (
                    <p className={`text-xs font-medium ${pinMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{pinMsg.text}</p>
                  )}

                  <button
                    onClick={handleChangePin}
                    disabled={pinLoading || !pinCurrent || !pinNew || !pinConfirm}
                    className="w-full rounded-lg bg-primary text-primary-foreground text-sm font-semibold py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pinLoading ? "Updating…" : "Update PIN"}
                  </button>
                </div>
              </div>
            )}

            {/* BET HISTORY */}
            {tab === "history" && (
              <>
                {txs.length === 0 ? (
                  <div className="text-center py-14">
                    <Clock className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">No transactions yet.</p>
                  </div>
                ) : (
                  <div className="overflow-y-auto max-h-80 divide-y divide-border/40">
                    {[...txs].reverse().filter(t => !isPokerTx(t)).slice(0, 100).map(t => {
                      const isWin = WIN_TYPES.has(t.type) || t.type === "deposit" || t.type === "bonus" || t.type === "gift" || t.type === "transfer_received" || t.type === "loan_issued";
                      return (
                        <div key={t.id} className="flex items-center gap-2 py-1 px-1 hover:bg-muted/20 transition-colors">
                          <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full mt-0.5 ${isWin ? "bg-emerald-400" : "bg-red-400"}`} />
                          <span className="text-xs font-medium text-foreground w-28 flex-shrink-0 truncate capitalize">{TX_LABELS[t.type] ?? t.type}</span>
                          {t.description
                            ? <span className="text-[10px] text-muted-foreground flex-1 truncate">{t.description}</span>
                            : <span className="flex-1" />
                          }
                          <span className={`text-xs font-bold tabular-nums flex-shrink-0 w-24 text-right ${isWin ? "text-emerald-400" : "text-red-400"}`}>
                            {isWin ? "+" : "-"}{fmt(t.amount)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 w-28 text-right">{fmtShort(t.createdAt)}</span>
                        </div>
                      );
                    })}
                    {txs.length > 100 && (
                      <p className="text-center text-[10px] text-muted-foreground pt-2">Showing last 100 transactions</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, sub }: { label: string; value: string; icon: React.ReactNode; color: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`flex items-center gap-1.5 ${color} mb-2`}>{icon}<span className="text-xs font-semibold">{label}</span></div>
      <div className="font-display font-bold text-xl text-foreground tabular-nums leading-none">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function PrizeRow({ r }: { r: Reward }) {
  const delivered = !!r.delivered_at;
  const GAME_LABEL: Record<string, string> = { case: "Case" };
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${delivered ? "border-emerald-800 bg-emerald-950" : "border-amber-800 bg-amber-950"}`}>
      <span className="text-base flex-shrink-0 w-5 text-center">{r.prize_emoji}</span>
      <span className="font-semibold text-foreground flex-1 min-w-0 truncate">{r.prize_name}</span>
      {r.prize_type === "chips" && r.chips_amount > 0 && (
        <span className="text-amber-400 font-bold tabular-nums flex-shrink-0">+{fmt(r.chips_amount)}</span>
      )}
      <span className="text-muted-foreground/60 flex-shrink-0 text-[10px]">{GAME_LABEL[r.game] ?? r.game}</span>
      <span className="text-muted-foreground/50 flex-shrink-0 text-[10px] w-24 text-right">{fmtShort(r.won_at)}</span>
      <span className="flex-shrink-0 w-4">
        {delivered
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          : <Hourglass className="w-3.5 h-3.5 text-amber-400" />}
      </span>
    </div>
  );
}
