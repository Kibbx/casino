import { Fragment, useState, useEffect, useRef, useCallback, Component, type ReactNode } from "react";
import { BingoTab } from "../components/BingoTab";
import { LotteryTab } from "../components/LotteryTab";
import { showToast } from "../lib/toast";
import { showConfirm } from "../lib/confirm";

class ErrorBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="p-4 text-sm text-red-400 bg-red-900 rounded-xl border border-red-800">
          Something went wrong loading this section. Please refresh.
        </div>
      );
    }
    return this.props.children;
  }
}
import DOMPurify from "dompurify";
import { todayEST, daysAgoEST, startOfWeekEST, startOfMonthEST, fmtETDateTimeShort, fmtETDateShort, fmtETDateTimeFull, fmtETFull, fmtETTimeSec, fmtETDateTime } from "../utils/timezone";
import { HorseRacingAdmin } from "../components/HorseRacingAdmin";
import RichTextEditor from "../components/RichTextEditor";
import { VisualRegionEditor, type Region as VRERegion } from "../components/VisualRegionEditor";
import { useLobbySocket } from "../lib/useLobbySocket";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { Button, Input, NumberInput } from "../components/ui-elements";
import {
  useListPlayers,
  useDeletePlayer,
  useAdjustChips,
  useListTables,
  useCreateTable,
  useDeleteTable,
  useGetBankerStats,
  useResetStats,
  useGetRakeSettings,
  useUpdateRakeSettings,
  useGetBlackjackSettings,
  useUpdateBlackjackSettings,
  useGetSlotsSettings,
  useUpdateSlotsSettings,
  useGetRouletteSettings,
  useUpdateRouletteSettings,
  useListBankerAccounts,
  useCreateBankerAccount,
  useUpdateBankerAccount,
  useDeleteBankerAccount,
  type Player,
  type RakeSettings,
  type CasinoStats,
  type GameStats,
} from "@workspace/api-client-react";

import { motion } from "framer-motion";
import { Users, DollarSign, Table, BarChart3, Plus, Trash2, LogOut, ChevronDown, ChevronUp, Search, Gamepad2, ShieldCheck, UserX, UserCheck, KeyRound, Trophy, Lock, Unlock, ExternalLink, Pencil, RefreshCw, Flag, AlertTriangle, Eye, FileText, Ban, ChevronRight, Radio, X, Megaphone, Upload, Calendar, Link, ImageIcon, ToggleLeft, ToggleRight, Tag, ArrowLeft, UserPlus, Percent, Gift, ClipboardList, TrendingUp, TrendingDown, Activity, Zap, MapPin, Shield, Clock, Camera, StickyNote, Loader2, Star, Landmark, CreditCard, CheckCircle, AlertCircle, XCircle, Settings, Timer, Thermometer, Copy, ScrollText, Hash, Ticket } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

type ExtendedRakeSettings = RakeSettings & { tournamentsEnabled?: boolean; oddsMode?: string };
type ExtendedPokerStats = GameStats & { tournamentHouseRake?: number };
type HorseStats = GameStats & { totalRaces?: number; totalBets?: number; totalWagered?: number };
type SlotsTournamentStats = { count: number; players: number; buyInsCollected: number; refunded: number; houseRake: number; prizeDistributed: number };
type ExtendedCasinoStats = Omit<CasinoStats, "poker"> & { poker: ExtendedPokerStats; baccarat?: GameStats; horse?: HorseStats; slotsTournaments?: SlotsTournamentStats };

type Tab = "players" | "tables" | "games" | "rake" | "stats" | "staff" | "security" | "promos";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  banker: "Banker",
  dealer: "Dealer",
  sportbets: "Sport Bets",
  security_guard: "Security Guard",
  pit_boss: "Pit Boss",
  cage_clerk: "Cage Clerk",
  junior_banker: "Junior Banker",
};

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

function ConfirmModal({ message, onConfirm, onCancel, confirmLabel = "Delete", isLoading = false }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  isLoading?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4">
      <div className="bg-card border border-zinc-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
        <p className="text-sm text-foreground mb-6 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} isLoading={isLoading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BankerDashboard() {
  const [, setLocation] = useLocation();
  const { bankerToken, bankerUsername, bankerIsAdmin, bankerRole, bankerRole2, bankerRoles, logoutBanker, playerStaffRole, playerStaffRole2, playerStaffRoles, playerUsername, logoutPlayer, setBankerStateId } = useStore();

  const isPlayerStaff = !bankerToken && !!playerStaffRole;
  const role = bankerRole || playerStaffRole || "banker";
  const role2 = bankerRole2 ?? playerStaffRole2 ?? null;
  const effectiveUsername = bankerUsername || playerUsername;
  const effectiveIsAdmin = bankerIsAdmin || playerStaffRole === "owner";

  // Use the full roles array so a user with e.g. ["cage_clerk","security_guard"] never
  // loses tabs just because one field is stale or null.
  const allEffectiveRoles: string[] = bankerToken
    ? (bankerRoles.length > 0 ? bankerRoles : [bankerRole, bankerRole2].filter(Boolean) as string[])
    : (playerStaffRoles.length > 0 ? playerStaffRoles : [role, role2].filter(Boolean) as string[]);

  const hasRole = (...roles: string[]) => allEffectiveRoles.some(r => roles.includes(r));

  // Effective role for limit enforcement — picks the most restrictive role that applies.
  // Owner/banker override all limits. Otherwise cage_clerk or junior_banker limits apply
  // even when they're a secondary role (role2).
  const limitRole: string = (() => {
    if (hasRole("owner", "banker")) return role; // no limits
    if (hasRole("cage_clerk")) return "cage_clerk";
    if (hasRole("junior_banker")) return "junior_banker";
    return role;
  })();

  const defaultTab: Tab = hasRole("owner", "banker") ? "players" : hasRole("dealer") ? "players" : hasRole("sportbets") ? "games" : hasRole("security_guard", "pit_boss") ? "security" : "players";
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  useEffect(() => {
    if (!bankerToken && !playerStaffRole) setLocation("/login");
  }, [bankerToken, playerStaffRole]);

  // Sync banker's stateId from DB on mount.
  // If DB has no stateId, check localStorage for the legacy saved value and migrate it to DB.
  useEffect(() => {
    if (!bankerToken) return;
    fetch(`${BASE_URL}/api/banker/me`, { headers: { Authorization: `Bearer ${bankerToken}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        if (d.stateId) {
          setBankerStateId(d.stateId);
        } else {
          // Migrate from old localStorage format: { name, stateId }
          try {
            const saved = JSON.parse(localStorage.getItem(`bab_contract_lender_${d.username || ""}`) || "{}");
            if (saved.stateId) {
              setBankerStateId(saved.stateId);
              fetch(`${BASE_URL}/api/banker/accounts/${d.id}`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${bankerToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ stateId: saved.stateId }),
              }).catch(() => {});
            } else {
              setBankerStateId(null);
            }
          } catch {
            setBankerStateId(null);
          }
        }
      })
      .catch(() => {});
  }, [bankerToken]);

  if (!bankerToken && !playerStaffRole) return null;

  const allTabs: { key: Tab; label: string; icon: any; roles: string[] }[] = [
    { key: "players", label: "Players", icon: Users, roles: ["owner", "banker", "dealer", "sportbets", "cage_clerk", "junior_banker"] },
    { key: "security", label: "Security", icon: Eye, roles: ["owner", "banker", "security_guard", "pit_boss"] },
    { key: "tables", label: "Tables", icon: Table, roles: ["owner", "banker", "dealer", "security_guard", "pit_boss"] },
    { key: "games", label: "Games", icon: Gamepad2, roles: ["owner", "banker", "dealer", "sportbets"] },
    { key: "stats", label: "Stats", icon: BarChart3, roles: ["owner", "banker", "junior_banker"] },
    { key: "staff", label: "Staff", icon: ShieldCheck, roles: ["owner", "banker"] },
    { key: "promos", label: "Promos", icon: Megaphone, roles: ["owner", "banker"] },
  ];

  const tabs = allTabs.filter((t) => hasRole(...t.roles));

  return (
    <div className="bab-dashboard min-h-screen bg-transparent">
      <div className="border-b border-zinc-700 bg-card/50 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-primary tracking-wider uppercase">Big House Casino</h1>
            <p className="text-xs text-muted-foreground font-typewriter tracking-wider">
              Staff Dashboard{effectiveUsername ? ` — ${effectiveUsername}` : ""}
              {allEffectiveRoles[0] && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-950 text-red-300 text-[10px] font-bold uppercase tracking-wider">{ROLE_LABELS[allEffectiveRoles[0]] || allEffectiveRoles[0]}</span>}
              {allEffectiveRoles.slice(1).map((r) => <span key={r} className="ml-1 px-1.5 py-0.5 rounded bg-secondary/30 text-muted-foreground text-[10px] font-bold uppercase tracking-wider">+{ROLE_LABELS[r] || r}</span>)}
              {isPlayerStaff && <span className="ml-2 px-1.5 py-0.5 rounded bg-blue-900 text-blue-400 text-[10px] font-bold uppercase tracking-wider">Player Account</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isPlayerStaff ? (
              <Button variant="ghost" size="sm" onClick={() => setLocation("/lobby")}>
                <LogOut className="w-4 h-4 mr-2" /> Back to Lobby
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => { logoutBanker(); setLocation("/"); }}>
                <LogOut className="w-4 h-4 mr-2" /> Logout
              </Button>
            )}
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-0 flex gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === "players" && <PlayersTab isOwner={hasRole("owner")} canEdit={hasRole("owner", "banker", "cage_clerk", "junior_banker")} currentRole={limitRole} />}
        {activeTab === "security" && <SecurityTab currentRole={role} />}
        {activeTab === "tables" && <TablesTab role={role} role2={role2} roles={allEffectiveRoles} />}
        {activeTab === "games" && <GamesTab canManageBets={hasRole("owner", "banker")} isOwner={hasRole("owner")} staffUsername={effectiveUsername || "staff"} defaultView={hasRole("sportbets") && !hasRole("owner", "banker", "dealer") ? "sportbets" : "games"} />}
        {activeTab === "stats" && <StatsTab isOwner={hasRole("owner")} isBanker={hasRole("banker")} isJuniorBanker={hasRole("junior_banker")} staffUsername={effectiveUsername || "staff"} />}
        {activeTab === "staff" && hasRole("owner", "banker") && <StaffTab isOwner={hasRole("owner")} />}
        {activeTab === "promos" && <PromoTab isOwner={hasRole("owner")} />}
      </div>
    </div>
  );
}

function PlayersTab({ isOwner = false, canEdit = true, currentRole = "banker" }: { isOwner?: boolean; canEdit?: boolean; currentRole?: string }) {
  const { data: players = [], refetch, isFetching } = useListPlayers({ query: { staleTime: Infinity } });
  const deleteMutation = useDeletePlayer();
  const adjustMutation = useAdjustChips();

  const [search, setSearch] = useState("");
  const [playerPage, setPlayerPage] = useState(1);
  // Unified action panel: one state covers deposit/withdraw/gift/loans tabs
  const [activePanel, setActivePanel] = useState<{ id: number; tab: "deposit" | "withdrawal" | "gift" | "loans" | "bet" | "babalari" } | null>(null);
  // BET deposit state
  const [betAmount, setBetAmount] = useState("");
  const [betNotes, setBetNotes] = useState("");
  const [betRate, setBetRate] = useState<number>(250);
  const [betLoading, setBetLoading] = useState(false);
  const [betMsg, setBetMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Babalari deposit state
  const [babalariAmount, setBabalariAmount] = useState("");
  const [babalariNotes, setBabalariNotes] = useState("");
  const [babalariRate, setBabalariRate] = useState<number>(1000);
  const [babalariLoading, setBabalariLoading] = useState(false);
  const [babalariMsg, setBabalariMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const [playerTagsMap, setPlayerTagsMap] = useState<Map<number, {id:number;label:string;color:string;flagged:boolean}[]>>(new Map());
  useEffect(() => {
    bankerApiFetch("/banker/bet-rate").then(r => r.json()).then(d => { if (d.ratePerBet) setBetRate(d.ratePerBet); }).catch(() => {});
    bankerApiFetch("/banker/babalari-stats").then(r => r.json()).then(d => { if (typeof d.rate === "number") setBabalariRate(d.rate); }).catch(() => {});
    bankerApiFetch("/security/player-tags").then(r => r.json()).then(d => {
      if (!Array.isArray(d.tags)) return;
      const map = new Map<number, {id:number;label:string;color:string;flagged:boolean}[]>();
      for (const t of d.tags) {
        if (!map.has(t.playerId)) map.set(t.playerId, []);
        map.get(t.playerId)!.push(t);
      }
      setPlayerTagsMap(map);
    }).catch(() => {});
  }, []);

  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [expandedPlayer, setExpandedPlayer] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null);
  const [resetPin, setResetPin] = useState<{ id: number; name: string } | null>(null);
  const [newPin, setNewPin] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [renamePlayer, setRenamePlayer] = useState<{ id: number; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameMsg, setRenameMsg] = useState<string | null>(null);
  // Loan badge summary: loaded once on mount so all cards show debt indicators immediately
  const [loanSummary, setLoanSummary] = useState<Record<number, { count: number; total: number }>>({});

  useEffect(() => {
    if (currentRole === "cage_clerk") return;
    bankerApiFetch("/loans/active-summary")
      .then(r => r.ok ? r.json() : {})
      .then(d => setLoanSummary(d))
      .catch(() => {});
  }, [currentRole]);

  const PLAYERS_PER_PAGE = 15;

  const filteredPlayers = players.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    if (p.username.toLowerCase().includes(q)) return true;
    if (p.stateId && p.stateId.toLowerCase().includes(q)) return true;
    if (p.phoneNumber && p.phoneNumber.toLowerCase().includes(q)) return true;
    const tags = playerTagsMap.get(p.id) || [];
    if (tags.some(t => t.label.toLowerCase().includes(q))) return true;
    return false;
  }).sort((a, b) => b.chips - a.chips);

  const totalPlayerPages = Math.max(1, Math.ceil(filteredPlayers.length / PLAYERS_PER_PAGE));
  const clampedPlayerPage = Math.min(playerPage, totalPlayerPages);
  const pagedPlayers = filteredPlayers.slice((clampedPlayerPage - 1) * PLAYERS_PER_PAGE, clampedPlayerPage * PLAYERS_PER_PAGE);

  async function handleAdjust(playerId: number) {
    const amt = parseInt(adjustAmount);
    const tab = activePanel?.tab as "deposit" | "withdrawal" | "gift";
    if (isNaN(amt) || amt <= 0) return;
    if (currentRole === "cage_clerk") {
      if (tab === "withdrawal") { showToast("Cage Clerk cannot process withdrawals."); return; }
      if (amt > 100_000) { showToast("Cage Clerk limit: max 100,000 chips per transaction."); return; }
    }
    if (currentRole === "junior_banker" && amt > 250_000) {
      showToast("Junior Banker limit: max 250,000 chips per transaction."); return;
    }
    try {
      await adjustMutation.mutateAsync({ playerId, data: { amount: amt, action: tab, reason: adjustReason || undefined } });
      setActivePanel(null);
      setAdjustAmount("");
      setAdjustReason("");
      refetch();
    } catch (err: any) {
      showToast(err?.message || "Failed to adjust chips");
    }
  }

  async function handleDelete(id: number, name: string) {
    setConfirmDel({ id, name });
  }

  async function confirmDeletePlayer() {
    if (!confirmDel) return;
    try {
      await deleteMutation.mutateAsync({ playerId: confirmDel.id });
      setConfirmDel(null);
      refetch();
    } catch (err: any) {
      setConfirmDel(null);
      showToast(err?.message || "Failed to delete player");
    }
  }

  async function handleResetPin() {
    if (!resetPin || !newPin) return;
    setResetLoading(true);
    setResetMsg(null);
    try {
      const res = await bankerApiFetch(`/banker/players/${resetPin.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResetMsg(`PIN reset for "${resetPin.name}".`);
      setNewPin("");
      setTimeout(() => { setResetPin(null); setResetMsg(null); }, 2000);
    } catch (err: any) {
      setResetMsg(err.message || "Failed to reset PIN");
    }
    setResetLoading(false);
  }

  async function handleRenamePlayer() {
    if (!renamePlayer || !renameTo.trim()) return;
    setRenameLoading(true);
    setRenameMsg(null);
    try {
      const res = await bankerApiFetch(`/players/${renamePlayer.id}/username`, {
        method: "PATCH",
        body: JSON.stringify({ username: renameTo.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setRenameMsg(`Renamed to "${renameTo.trim()}".`);
      setRenameTo("");
      refetch();
      setTimeout(() => { setRenamePlayer(null); setRenameMsg(null); }, 1800);
    } catch (err: any) {
      setRenameMsg(err.message || "Failed to rename player");
    }
    setRenameLoading(false);
  }

  async function handleBetDeposit(playerId: number) {
    const bet = parseFloat(betAmount);
    if (isNaN(bet) || bet <= 0) return;
    setBetLoading(true);
    setBetMsg(null);
    try {
      const res = await bankerApiFetch("/banker/bet-deposits", {
        method: "POST",
        body: JSON.stringify({ playerId, betAmount: bet, notes: betNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setBetMsg({ text: `✓ Logged ${bet} BET → +${data.chipsAmount.toLocaleString()} chips for ${data.player}`, ok: true });
      setBetAmount("");
      setBetNotes("");
      refetch();
    } catch (err: any) {
      setBetMsg({ text: err.message || "Failed", ok: false });
    }
    setBetLoading(false);
  }

  async function handleBabalariDeposit(playerId: number) {
    const amt = parseInt(babalariAmount);
    if (isNaN(amt) || amt <= 0) return;
    setBabalariLoading(true);
    setBabalariMsg(null);
    try {
      const res = await bankerApiFetch("/banker/babalari-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, babalariAmount: amt, notes: babalariNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setBabalariMsg({ text: `✓ Logged ${amt.toLocaleString()} Babalari from ${data.player} → +${data.chipsAmount.toLocaleString()} chips credited`, ok: true });
      setBabalariAmount("");
      setBabalariNotes("");
      refetch();
    } catch (err: any) {
      setBabalariMsg({ text: err.message || "Failed", ok: false });
    }
    setBabalariLoading(false);
  }

  function openTab(playerId: number, tab: "deposit" | "withdrawal" | "gift" | "loans" | "bet" | "babalari") {
    if (activePanel?.id === playerId && activePanel.tab === tab) {
      setActivePanel(null);
    } else {
      setActivePanel({ id: playerId, tab });
      setAdjustAmount("");
      setAdjustReason("");
    }
  }

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search players by name, state ID, phone, or tag…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPlayerPage(1); }}
            className="w-full bg-input border border-zinc-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          />
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-700 bg-card hover:bg-zinc-800 text-muted-foreground hover:text-foreground text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
        <div className="text-xs text-muted-foreground shrink-0 tabular-nums">
          {filteredPlayers.length} player{filteredPlayers.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Players List */}
      <div className="space-y-2">
        {players.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No registered players yet.</div>
        )}
        {search && filteredPlayers.length === 0 && players.length > 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">No players match "{search}".</div>
        )}

        {pagedPlayers.map((player) => {
          const panel = activePanel?.id === player.id ? activePanel.tab : null;
          const debt = loanSummary[player.id];
          const hasDebt = debt && debt.count > 0;
          const cs = (player as any).creditScore as number | undefined;
          const csTier = cs == null ? null : cs >= 850 ? "Excellent" : cs >= 700 ? "Good" : cs >= 550 ? "Fair" : cs >= 400 ? "Poor" : cs >= 100 ? "Very Poor" : "Shit Credit";
          const csColor = cs == null ? "" : cs >= 700 ? "text-green-400 border-green-700 bg-green-950" : cs >= 400 ? "text-yellow-400 border-yellow-700 bg-yellow-950" : "text-red-400 border-red-700 bg-red-950";

          return (
            <motion.div
              key={player.id}
              layout
              className={`bg-zinc-900 rounded-lg overflow-hidden border transition-all ${hasDebt ? "border-amber-700" : "border-zinc-700"}`}
            >
              {/* Compact card body */}
              <div className="px-2.5 py-1.5 flex items-center gap-2">
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div className={`w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs select-none ${hasDebt ? "bg-amber-900 text-amber-300" : "bg-red-950 text-red-300"}`}>
                    {player.username[0].toUpperCase()}
                  </div>
                  {hasDebt && (
                    <div className="absolute -top-1 -right-1 bg-amber-500 text-black text-[8px] font-black rounded-full min-w-[13px] h-[13px] flex items-center justify-center px-0.5">
                      {debt.count}
                    </div>
                  )}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-semibold text-foreground text-xs leading-tight truncate">{player.username}</span>
                    {(player as any).flagged && (
                      <span className="inline-flex items-center gap-0.5 px-1 py-px rounded bg-red-900 text-red-400 text-[8px] font-bold uppercase border border-red-700">
                        <Flag className="w-2 h-2" /> FLAGGED
                      </span>
                    )}
                    {(playerTagsMap.get(player.id) || []).map((t) => (
                      <span key={t.id} style={{backgroundColor: t.color, color: "#fff", borderColor: t.color}} className="inline-flex items-center gap-0.5 px-1 py-px rounded text-[8px] font-bold uppercase border leading-none">
                        {t.flagged && <Flag className="w-2 h-2 shrink-0" />}
                        {t.label}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-primary text-[11px] font-semibold tabular-nums">{player.chips.toLocaleString()} chips</span>
                    {player.stateId && <span className="text-muted-foreground text-[10px] font-mono">#{player.stateId}</span>}
                    {player.phoneNumber && <span className="text-muted-foreground text-[10px]">{player.phoneNumber}</span>}
                    {((player as any).lifetimeDeposits ?? 0) > 0 && (
                      <span className="text-green-400 text-[10px]">${((player as any).lifetimeDeposits).toLocaleString()} dep</span>
                    )}
                    {hasDebt && (
                      <span className="inline-flex items-center gap-0.5 text-amber-400 text-[10px] font-semibold">
                        <Landmark className="w-2 h-2" />{debt.total.toLocaleString()} owed
                      </span>
                    )}
                    {cs != null && (
                      <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded border text-[8px] font-bold ${csColor}`}>
                        <ShieldCheck className="w-2 h-2" />{cs} · {csTier}
                      </span>
                    )}
                  </div>
                </div>

                {/* Action buttons — icon + label */}
                {canEdit && (
                  <div className="bab-action-row flex items-center gap-1.5 flex-wrap shrink-0">
                    <button onClick={() => openTab(player.id, "deposit")}
                      className={`bab-action-btn flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "deposit" ? "bg-green-700 border-green-600 text-white" : "bg-green-950 border-green-800 text-green-400 hover:bg-green-900"}`}>
                      <TrendingUp className="w-3 h-3" /> Deposit
                    </button>
                    <button onClick={() => { openTab(player.id, "bet"); setBetMsg(null); setBetAmount(""); setBetNotes(""); }}
                      className={`bab-action-btn flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "bet" ? "bg-cyan-600 border-cyan-500 text-white" : "bg-cyan-950 border-cyan-800 text-cyan-400 hover:bg-cyan-900"}`}>
                      <CreditCard className="w-3 h-3" /> Bet
                    </button>
                    <button onClick={() => { openTab(player.id, "babalari"); setBabalariMsg(null); setBabalariAmount(""); setBabalariNotes(""); }}
                      className={`bab-action-btn flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "babalari" ? "bg-violet-600 border-violet-500 text-white" : "bg-violet-950 border-violet-800 text-violet-400 hover:bg-violet-900"}`}>
                      <img src={`${BASE_URL}/babalari-coin.png`} alt="" className="w-3 h-3 object-contain" /> Babalari
                    </button>
                    {currentRole !== "cage_clerk" && (
                      <button onClick={() => openTab(player.id, "withdrawal")}
                        className={`bab-action-btn flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "withdrawal" ? "bg-red-700 border-red-600 text-white" : "bg-red-950 border-red-800 text-red-400 hover:bg-red-900"}`}>
                        <TrendingDown className="w-3 h-3" /> Withdraw
                      </button>
                    )}
                    <button onClick={() => openTab(player.id, "gift")}
                      className={`bab-action-btn flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "gift" ? "bg-purple-700 border-purple-600 text-white" : "bg-purple-950 border-purple-800 text-purple-400 hover:bg-purple-900"}`}>
                      <Gift className="w-3 h-3" /> Gift
                    </button>
                    {currentRole !== "cage_clerk" && (
                      <button onClick={() => openTab(player.id, "loans")}
                        className={`bab-action-btn relative flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition-all ${panel === "loans" ? "bg-amber-600 border-amber-500 text-white" : hasDebt ? "bg-amber-950 border-amber-600 text-amber-400 hover:bg-amber-900" : "bg-amber-950 border-amber-800 text-amber-600 hover:bg-amber-900"}`}>
                        <Landmark className="w-3 h-3" /> Loans
                        {hasDebt && (
                          <span className="ml-0.5 bg-amber-500 text-black text-[8px] font-black rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5 leading-none">
                            {debt.count}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                )}

                {/* Utility icons */}
                <div className="flex items-center gap-0.5 shrink-0 border-l border-zinc-700 pl-1 ml-0.5">
                  {isOwner && canEdit && (
                    <button onClick={() => { setRenamePlayer({ id: player.id, name: player.username }); setRenameTo(player.username); setRenameMsg(null); }} title="Rename player"
                      className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  {isOwner && canEdit && (
                    <button onClick={() => { setResetPin({ id: player.id, name: player.username }); setNewPin(""); setResetMsg(null); }} title="Reset PIN"
                      className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                      <KeyRound className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => setExpandedPlayer(expandedPlayer === player.id ? null : player.id)} title="Transaction history"
                    className={`p-1 rounded-md transition-colors ${expandedPlayer === player.id ? "text-foreground bg-zinc-700" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"}`}>
                    <ClipboardList className="w-3 h-3" />
                  </button>
                  {(isOwner || currentRole === "banker") && (
                    <button onClick={() => handleDelete(player.id, player.username)} title="Delete player"
                      className="p-1 rounded-md text-red-600 hover:text-red-400 hover:bg-red-950 transition-colors">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* BET deposit panel */}
              {panel === "bet" && (
                <div className="border-t border-cyan-800 bg-cyan-950 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-cyan-400" />
                    <span className="text-sm font-semibold text-cyan-300">Log BET Currency Deposit</span>
                    <span className="text-xs text-muted-foreground">· 1 BET = {betRate.toLocaleString()} chips</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Player is depositing BET currency. Enter the BET amount — chips will be automatically calculated and credited.
                  </p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">BET Amount</label>
                      <Input
                        type="number"
                        min={0.01}
                        step={0.01}
                        placeholder="e.g. 2.5"
                        value={betAmount}
                        onChange={(e) => { setBetAmount(e.target.value); setBetMsg(null); }}
                        className="w-36"
                      />
                    </div>
                    {betAmount && parseFloat(betAmount) > 0 && (
                      <div className="text-xs text-cyan-300 bg-cyan-950 border border-cyan-800 rounded-lg px-3 py-2">
                        = <span className="font-bold text-cyan-200">{Math.round(parseFloat(betAmount) * betRate).toLocaleString()} chips</span>
                      </div>
                    )}
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Notes (optional)</label>
                      <Input
                        placeholder='e.g. "Verified by manager"'
                        value={betNotes}
                        onChange={(e) => setBetNotes(e.target.value)}
                      />
                    </div>
                  </div>
                  {betMsg && (
                    <p className={`text-xs px-3 py-2 rounded-lg border ${betMsg.ok ? "text-cyan-300 bg-cyan-950 border-cyan-800" : "text-red-400 bg-red-950 border-red-800"}`}>
                      {betMsg.text}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleBetDeposit(player.id)}
                      disabled={betLoading || !betAmount || parseFloat(betAmount) <= 0}
                      isLoading={betLoading}
                      className="bg-cyan-700 hover:bg-cyan-600 text-white"
                    >
                      Log BET Deposit
                    </Button>
                    <Button variant="ghost" onClick={() => { setActivePanel(null); setBetMsg(null); }}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Babalari deposit panel */}
              {panel === "babalari" && (
                <div className="border-t border-violet-800 bg-violet-950 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <img src={`${BASE_URL}/babalari-coin.png`} alt="Babalari" className="w-5 h-5 object-contain" />
                    <span className="text-sm font-semibold text-violet-300">Log Babalari Accepted</span>
                    <span className="text-xs text-muted-foreground">· 1 Babalari = {babalariRate.toLocaleString()} chips</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Player is paying Babalari. Enter the amount received — chips will be automatically credited and the deposit logged.
                  </p>
                  <div className="flex flex-wrap gap-2 items-end">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Babalari Amount</label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="e.g. 10"
                        value={babalariAmount}
                        onChange={(e) => { setBabalariAmount(e.target.value); setBabalariMsg(null); }}
                        className="w-36"
                      />
                    </div>
                    {babalariAmount && parseInt(babalariAmount) > 0 && (
                      <div className="text-xs text-violet-300 bg-violet-950 border border-violet-800 rounded-lg px-3 py-2">
                        → <span className="font-bold text-violet-200">{(parseInt(babalariAmount) * babalariRate).toLocaleString()} chips</span>{" "}
                        <span className="text-violet-500">credited</span>
                      </div>
                    )}
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Notes (optional)</label>
                      <Input
                        placeholder='e.g. "Event reward"'
                        value={babalariNotes}
                        onChange={(e) => setBabalariNotes(e.target.value)}
                      />
                    </div>
                  </div>
                  {babalariMsg && (
                    <p className={`text-xs px-3 py-2 rounded-lg border ${babalariMsg.ok ? "text-violet-300 bg-violet-950 border-violet-800" : "text-red-400 bg-red-950 border-red-800"}`}>
                      {babalariMsg.text}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleBabalariDeposit(player.id)}
                      disabled={babalariLoading || !babalariAmount || parseInt(babalariAmount) <= 0}
                      isLoading={babalariLoading}
                      className="bg-violet-700 hover:bg-violet-600 text-white"
                    >
                      Log Babalari Deposit
                    </Button>
                    <Button variant="ghost" onClick={() => { setActivePanel(null); setBabalariMsg(null); }}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Chip adjustment panel (deposit / withdraw / gift) */}
              {panel && panel !== "loans" && panel !== "bet" && panel !== "babalari" && (
                <div className="border-t border-zinc-700 bg-zinc-900 p-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {panel === "deposit" && "Deposit — player handed in cash. Adds chips and counts toward cash on hand."}
                    {panel === "withdrawal" && "Withdraw — player cashing out. Removes chips and counts toward cash on hand."}
                    {panel === "gift" && "Gift — house bonus. Adds chips but never counted as cash on hand."}
                  </p>
                  {currentRole === "cage_clerk" && (
                    <p className="text-xs text-teal-400 bg-teal-950 border border-teal-800 rounded-lg px-3 py-1.5">
                      Cage Clerk limits: deposits &amp; gifts only · max 100,000 chips per transaction
                    </p>
                  )}
                  {currentRole === "junior_banker" && (
                    <p className="text-xs text-cyan-400 bg-cyan-950 border border-cyan-800 rounded-lg px-3 py-1.5">
                      Junior Banker limits: max 250,000 chips per transaction
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <NumberInput
                      min={1}
                      maxValue={currentRole === "cage_clerk" ? 100000 : currentRole === "junior_banker" ? 250000 : undefined}
                      placeholder={currentRole === "cage_clerk" ? "Amount (max 100,000)" : currentRole === "junior_banker" ? "Amount (max 250,000)" : "Amount"}
                      value={adjustAmount}
                      onChange={setAdjustAmount}
                      className="w-44"
                    />
                    <Input
                      placeholder={panel === "deposit" ? 'Reason (e.g. "Player paid $500k")' : panel === "withdrawal" ? 'Reason (e.g. "Cashing out")' : 'Reason (e.g. "Welcome bonus")'}
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      onClick={() => handleAdjust(player.id)}
                      isLoading={adjustMutation.isPending}
                      disabled={!adjustAmount || parseInt(adjustAmount) <= 0}
                      className={panel === "deposit" ? "bg-green-700 hover:bg-green-600 text-white" : panel === "withdrawal" ? "bg-red-700 hover:bg-red-600 text-white" : "bg-purple-700 hover:bg-purple-600 text-white"}
                    >
                      {panel === "deposit" ? "Deposit" : panel === "withdrawal" ? "Withdraw" : "Gift"}
                    </Button>
                    <Button variant="ghost" onClick={() => setActivePanel(null)}>Cancel</Button>
                  </div>
                </div>
              )}

              {/* Loans panel */}
              {panel === "loans" && (
                <PlayerLoansPanel
                  playerId={player.id}
                  playerName={player.username}
                  playerStateId={player.stateId}
                  onChipsChanged={() => {
                    refetch();
                    // Refresh loan badges
                    bankerApiFetch("/loans/active-summary")
                      .then(r => r.ok ? r.json() : {})
                      .then(d => setLoanSummary(d))
                      .catch(() => {});
                  }}
                />
              )}

              {/* Transaction history */}
              {expandedPlayer === player.id && <PlayerExpandedPanel playerId={player.id} />}
            </motion.div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPlayerPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <button
            onClick={() => setPlayerPage((p) => Math.max(1, p - 1))}
            disabled={clampedPlayerPage === 1}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-card hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-foreground"
          >
            Prev
          </button>
          <span className="tabular-nums">Page {clampedPlayerPage} / {totalPlayerPages} · {filteredPlayers.length} players</span>
          <button
            onClick={() => setPlayerPage((p) => Math.min(totalPlayerPages, p + 1))}
            disabled={clampedPlayerPage === totalPlayerPages}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-card hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-foreground"
          >
            Next
          </button>
        </div>
      )}

      {confirmDel && (
        <ConfirmModal
          message={`Delete player "${confirmDel.name}"? This cannot be undone.`}
          confirmLabel="Delete Player"
          isLoading={deleteMutation.isPending}
          onConfirm={confirmDeletePlayer}
          onCancel={() => setConfirmDel(null)}
        />
      )}

      {resetPin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-card border border-zinc-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="font-display font-bold text-foreground mb-1">Reset PIN</h3>
            <p className="text-sm text-muted-foreground mb-4">Set a new PIN for <span className="text-foreground font-semibold">{resetPin.name}</span>.</p>
            <Input
              type="password"
              placeholder="New PIN (min 4 characters)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="mb-3"
              autoComplete="new-password"
            />
            {resetMsg && (
              <p className={`text-sm mb-3 ${resetMsg.startsWith("PIN reset") ? "text-green-400" : "text-destructive"}`}>{resetMsg}</p>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setResetPin(null); setResetMsg(null); }} disabled={resetLoading}>Cancel</Button>
              <Button size="sm" onClick={handleResetPin} isLoading={resetLoading} disabled={newPin.length < 4}>Reset PIN</Button>
            </div>
          </div>
        </div>
      )}

      {renamePlayer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4">
          <div className="bg-card border border-zinc-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="font-display font-bold text-foreground mb-1">Rename Player</h3>
            <p className="text-sm text-muted-foreground mb-4">Change account name for <span className="text-foreground font-semibold">{renamePlayer.name}</span>.</p>
            <Input
              placeholder="New account name"
              value={renameTo}
              onChange={(e) => { setRenameTo(e.target.value); setRenameMsg(null); }}
              className="mb-3"
              autoFocus
            />
            {renameMsg && (
              <p className={`text-sm mb-3 ${renameMsg.startsWith("Renamed") ? "text-green-400" : "text-destructive"}`}>{renameMsg}</p>
            )}
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setRenamePlayer(null); setRenameMsg(null); }} disabled={renameLoading}>Cancel</Button>
              <Button size="sm" onClick={handleRenamePlayer} isLoading={renameLoading} disabled={!renameTo.trim() || renameTo.trim() === renamePlayer.name}>Save Name</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerLoansPanel({ playerId, playerName, playerStateId, onChipsChanged }: { playerId: number; playerName: string; playerStateId?: string | null; onChipsChanged: () => void }) {
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createAmount, setCreateAmount] = useState("");
  const [createRate, setCreateRate] = useState("");
  const [createDueDate, setCreateDueDate] = useState("");
  const [createNotes, setCreateNotes] = useState("");
  const [createDisbursement, setCreateDisbursement] = useState<"chips"|"cash">("chips");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showPaidLoans, setShowPaidLoans] = useState(false);
  const [payingLoanId, setPayingLoanId] = useState<number | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payType, setPayType] = useState<"chips"|"cash">("chips");
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ loanId: number; action: "defaulted" | "paid" } | null>(null);
  const [creditInfo, setCreditInfo] = useState<{
    creditScore: number; tier: string; maxLoan: number; interestRate: number; blocked: boolean;
    trustedVolume?: number; loanTierName?: string; loanTierCap?: number;
    loanNextTierName?: string | null; loanNextTierRequired?: number | null; loanProgressPct?: number;
    progressionBlocked?: boolean; progressionBlockReason?: string | null;
    activeDays?: number; totalWagered?: number; reason?: string | null;
  } | null>(null);
  const { bankerUsername: storeUsername, bankerStateId: storeStateId, playerUsername } = useStore();
  const [lenderInfo, setLenderInfo] = useState<{ id?: number; name: string | null; stateId: string | null } | null>(null);
  const [contractSidInput, setContractSidInput] = useState("");
  const [contractSidSaving, setContractSidSaving] = useState(false);
  const [loanSettings, setLoanSettings] = useState({ overdueDays: 3, delinquentDays: 7, collectionsDays: 14 });
  const [contractModal, setContractModal] = useState<{
    loanId: number | null; amount: number; totalOwed: number; interestRate: number;
    dueDate: string | null; notes: string | null;
    pending?: boolean; // true = not yet created, waiting for confirmation
    pendingDisbursement?: "chips" | "cash";
  } | null>(null);
  const [contractConfirmLoading, setContractConfirmLoading] = useState(false);
  const [contractConfirmError, setContractConfirmError] = useState<string | null>(null);
  const [contractCopied, setContractCopied] = useState(false);

  function openContractModal(loan: { loanId: number | null; amount: number; totalOwed: number; interestRate: number; dueDate: string | null; notes: string | null; pending?: boolean; pendingDisbursement?: "chips" | "cash" }) {
    setContractModal(loan);
    setContractCopied(false);
    setContractSidInput("");
    // Always fetch fresh lender info from the server when the contract opens.
    // Try banker account first; if that fails or has no stateId, fall back to the player account.
    (async () => {
      try {
        const bankerRes = await bankerApiFetch("/banker/me");
        const banker = bankerRes.ok ? await bankerRes.json() : null;
        if (banker && banker.stateId) {
          // Banker account with stateId — perfect
          setLenderInfo({ id: banker.id, name: banker.username ?? null, stateId: banker.stateId });
          return;
        }
        // Banker account exists but no stateId, OR not a banker — try player account
        const playerRes = await bankerApiFetch("/players/me");
        const player = playerRes.ok ? await playerRes.json() : null;
        if (banker) {
          // Use banker name, but player stateId as fallback
          setLenderInfo({ id: banker.id, name: banker.username ?? null, stateId: player?.stateId ?? null });
        } else {
          // Player-staff: use player name + player stateId
          setLenderInfo({ name: player?.username ?? storeUsername ?? playerUsername, stateId: player?.stateId ?? null });
        }
      } catch {
        setLenderInfo({ name: storeUsername ?? playerUsername, stateId: storeStateId });
      }
    })();
  }

  function formatContractDate(iso: string | null): string {
    if (!iso) return "TBD";
    const d = new Date(iso + "T12:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }

  function formatEffectiveDate(): string {
    const d = new Date();
    const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const day = d.getDate();
    const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
    return `${months[d.getMonth()]} ${day}${suffix}, ${d.getFullYear()}`;
  }

  function generateContractText(): string {
    if (!contractModal) return "";
    const m = contractModal;
    const today = formatEffectiveDate();
    const finalDue = formatContractDate(m.dueDate);
    // Use freshly fetched lender info (set when modal opens), fall back to store/localStorage
    const resolvedName = lenderInfo?.name || storeUsername || playerUsername;
    const lenderName = resolvedName || "______";
    const resolvedSid = contractSidInput.trim() || lenderInfo?.stateId || storeStateId || (() => {
      try {
        const saved = JSON.parse(localStorage.getItem(`bab_contract_lender_${resolvedName || ""}`) || "{}");
        return saved.stateId || null;
      } catch { return null; }
    })();
    const lenderSid = resolvedSid || "______";
    const borrowerSid = playerStateId || "______";
    const principal = `$${m.amount.toLocaleString()}`;
    const total = `$${m.totalOwed.toLocaleString()}`;
    return `Loan Agreement

This Loan Agreement ("Agreement") is made and entered into on this ${today} ("Effective Date") by and between:

Lender:

Name: ${lenderName}, on behalf of Big House Casino
State ID: ${lenderSid}

Borrower:

Name: ${playerName}
State ID: ${borrowerSid}

Loan Amount and Disbursement

The Lender agrees to lend the Borrower the principal sum of ${principal} ("Loan Amount"). The Loan Amount will be transferred to the Borrower upon execution of this Agreement.

Repayment Terms

The Borrower agrees to repay the full amount of ${total} in its entirety by ${finalDue}.

Interest

${m.interestRate > 0 ? `${m.interestRate}% of principal amount` : "To be agreed upon"}

Special Circumstances

Overdue: ${loanSettings.overdueDays} days past due date
Delinquent: ${loanSettings.delinquentDays} days past due date
Collections: ${loanSettings.collectionsDays} days past due date

Default

If the Borrower fails to make payments after the grace period, the Lender reserves the right to pursue:

Repossession of assets via Judicial Order through the Department of Justice

Early Repayment

The Borrower may repay the loan in full at any time without penalty.

Miscellaneous

Any modifications to this Agreement must be in writing and signed by both parties.

Both parties acknowledge that this Agreement is binding and enforceable in the State of San Andreas and that this agreement is entered into voluntarily.

Parties Involved:

Casino Owner:

Name: Salvatore Ditacchio, Big House Casino
State ID: 23372

Lender:

Name: ${lenderName}, on behalf of Big House Casino
State ID: ${lenderSid}

Borrower:

Name: ${playerName}
State ID: ${borrowerSid}

Footnote:

Written by Bailey Harvey, BAR certified attorney in accordance with APCPA.`;
  }

  async function loadLoans() {
    setLoading(true);
    setError(null);
    try {
      const [loanRes, creditRes, settingsRes] = await Promise.all([
        bankerApiFetch(`/loans/player/${playerId}`),
        bankerApiFetch(`/loans/credit/${playerId}`),
        bankerApiFetch(`/loans/settings`),
      ]);
      const data = await loanRes.json();
      if (!loanRes.ok) throw new Error(data.error || "Failed to load loans");
      setLoans(data);
      if (creditRes.ok) {
        const cData = await creditRes.json();
        setCreditInfo(cData);
        setCreateRate(String(cData.interestRate));
      }
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        setLoanSettings({
          overdueDays: parseInt(s.overdueDays ?? "3"),
          delinquentDays: parseInt(s.delinquentDays ?? "7"),
          collectionsDays: parseInt(s.collectionsDays ?? "14"),
        });
      }
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }

  useEffect(() => { loadLoans(); }, [playerId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseInt(createAmount);
    if (!amt || amt <= 0) { setCreateError("Invalid amount"); return; }
    if (creditInfo?.blocked) { setCreateError(creditInfo.reason ?? "Player is credit-blocked. Cannot issue loans."); return; }
    if (creditInfo && amt > creditInfo.maxLoan) { setCreateError(`Exceeds max loan limit of ${creditInfo.maxLoan.toLocaleString()} chips (Tier: ${creditInfo.loanTierName ?? "New"}, Cap: ${(creditInfo.loanTierCap ?? creditInfo.maxLoan).toLocaleString()}).`); return; }
    // Show contract preview first — loan is NOT created yet
    const rate = parseFloat(createRate || "0");
    const totalOwed = Math.round(amt * (1 + rate / 100));
    openContractModal({
      loanId: null,
      amount: amt,
      totalOwed,
      interestRate: rate,
      dueDate: createDueDate || null,
      notes: createNotes || null,
      pending: true,
      pendingDisbursement: createDisbursement,
    });
  }

  async function handleConfirmLoan() {
    if (!contractModal?.pending) return;
    setContractConfirmLoading(true);
    setContractConfirmError(null);
    try {
      const res = await bankerApiFetch(`/loans/player/${playerId}`, {
        method: "POST",
        body: JSON.stringify({
          amount: contractModal.amount,
          interestRate: String(contractModal.interestRate),
          dueDate: contractModal.dueDate || null,
          notes: contractModal.notes || null,
          disbursementType: contractModal.pendingDisbursement ?? "chips",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create loan");
      // Upgrade the modal to issued state with real loan ID
      setContractModal(prev => prev ? { ...prev, loanId: data.id, pending: false } : prev);
      setShowCreate(false);
      setCreateAmount(""); setCreateDueDate(""); setCreateNotes(""); setCreateDisbursement("chips");
      await loadLoans();
      onChipsChanged();
    } catch (e: any) { setContractConfirmError(e.message); }
    setContractConfirmLoading(false);
  }

  async function handlePayment(loanId: number) {
    const amt = parseInt(payAmount);
    if (!amt || amt <= 0) { setPayError("Invalid amount"); return; }
    setPayLoading(true);
    setPayError(null);
    try {
      const res = await bankerApiFetch(`/loans/${loanId}/payment`, {
        method: "POST",
        body: JSON.stringify({ amount: amt, paymentType: payType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPayingLoanId(null);
      setPayAmount("");
      setPayType("chips");
      await loadLoans();
      onChipsChanged();
    } catch (e: any) { setPayError(e.message); }
    setPayLoading(false);
  }

  async function handleStatusChange(loanId: number, status: "defaulted" | "paid" | "active") {
    setActionLoading(loanId);
    try {
      const res = await bankerApiFetch(`/loans/${loanId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Failed"); }
      await loadLoans();
    } catch (_e) {}
    setActionLoading(null);
    setConfirmAction(null);
  }

  const openStatuses = ["active", "overdue", "delinquent", "collections"];
  const totalOutstanding = loans.filter(l => openStatuses.includes(l.effectiveStatus)).reduce((s: number, l: any) => s + l.remainingBalance, 0);
  const activeCount = loans.filter(l => openStatuses.includes(l.effectiveStatus)).length;
  const openLoans = loans.filter(l => openStatuses.includes(l.effectiveStatus));
  const closedLoans = loans.filter(l => !openStatuses.includes(l.effectiveStatus));

  function statusBadge(status: string) {
    if (status === "active") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-900 text-blue-400 border border-blue-700"><CheckCircle className="w-3 h-3" /> Active</span>;
    if (status === "overdue") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900 text-amber-400 border border-amber-700"><AlertCircle className="w-3 h-3" /> Overdue</span>;
    if (status === "delinquent") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-900 text-orange-400 border border-orange-700"><AlertTriangle className="w-3 h-3" /> Delinquent</span>;
    if (status === "collections") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-950 text-red-300 border border-red-700"><Ban className="w-3 h-3" /> Collections</span>;
    if (status === "defaulted") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900 text-red-400 border border-red-700"><XCircle className="w-3 h-3" /> Defaulted</span>;
    if (status === "paid") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900 text-green-400 border border-green-700"><CheckCircle className="w-3 h-3" /> Paid</span>;
    return null;
  }

  const scoreColor = creditInfo
    ? creditInfo.creditScore >= 700 ? "text-green-400" : creditInfo.creditScore >= 400 ? "text-yellow-400" : "text-red-400"
    : "text-muted-foreground";
  const scoreBorder = creditInfo
    ? creditInfo.creditScore >= 700 ? "border-green-700 bg-green-950" : creditInfo.creditScore >= 400 ? "border-yellow-700 bg-yellow-950" : "border-red-700 bg-red-950"
    : "border-zinc-700 bg-zinc-900";

  return (
    <div className="border-t border-amber-700 bg-amber-950 px-3 py-1.5 space-y-1.5">
      {/* Single header row with all credit info inline */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 shrink-0">
          <Landmark className="w-3 h-3 text-amber-400" />
          <span className="text-[11px] font-semibold text-amber-400">Loans</span>
        </div>
        {creditInfo && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-0.5 rounded border flex-wrap ${scoreBorder}`}>
            <span className={`font-bold ${scoreColor}`}>{creditInfo.creditScore}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">Max <span className="text-foreground font-medium">{creditInfo.maxLoan.toLocaleString()}</span></span>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground">{creditInfo.interestRate}% rate</span>
            {creditInfo.loanTierName && <><span className="text-muted-foreground/60">·</span><span className="text-muted-foreground">{creditInfo.loanTierName}</span></>}
            {creditInfo.trustedVolume != null && creditInfo.loanNextTierRequired != null && (
              <><span className="text-muted-foreground/60">·</span><span className="text-muted-foreground">{creditInfo.trustedVolume.toLocaleString()}/{creditInfo.loanNextTierRequired.toLocaleString()} vol</span></>
            )}
            {creditInfo.blocked && <span className="font-bold text-red-400">BLOCKED</span>}
          </div>
        )}
        {!loading && loans.length > 0 && (
          <span className="text-[10px] text-amber-400 font-medium">{totalOutstanding.toLocaleString()} owed</span>
        )}
        {/* Tier progress bar inline */}
        {creditInfo?.loanNextTierName != null && creditInfo.loanProgressPct != null && (
          <div className="flex items-center gap-1 flex-1 min-w-[80px]">
            <div className="flex-1 h-0.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${creditInfo.loanProgressPct}%` }} />
            </div>
            <span className="text-[9px] text-muted-foreground shrink-0">{creditInfo.loanProgressPct}%→{creditInfo.loanNextTierName}</span>
          </div>
        )}
        <Button size="sm" onClick={() => { setShowCreate(!showCreate); setCreateError(null); }} className="ml-auto bg-amber-600 hover:bg-amber-500 text-white text-[10px] h-5 px-2 shrink-0">
          <Plus className="w-2.5 h-2.5 mr-0.5" /> Loan
        </Button>
      </div>
      {creditInfo?.blocked && creditInfo.reason && <p className="text-[10px] text-red-400">{creditInfo.reason}</p>}
      {creditInfo?.progressionBlocked && creditInfo.progressionBlockReason && <p className="text-[10px] text-orange-400">{creditInfo.progressionBlockReason}</p>}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-card border border-amber-700 rounded-lg p-2.5 space-y-2">
          {creditInfo && creditInfo.creditScore >= 250 && creditInfo.creditScore < 400 && (
            <div className="flex items-center gap-1.5 text-yellow-400 text-[10px] font-semibold">
              <AlertTriangle className="w-3 h-3 shrink-0" /> High-risk borrower (score {creditInfo.creditScore})
            </div>
          )}
          {creditInfo?.blocked && (
            <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-semibold">
              <XCircle className="w-3 h-3 shrink-0" /> {creditInfo.reason ?? "Credit-blocked — cannot issue loans"}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Amount{creditInfo ? <span className="ml-1 opacity-60">max {creditInfo.maxLoan.toLocaleString()}</span> : null}</label>
              <Input type="number" min={1} max={creditInfo?.maxLoan} placeholder="e.g. 50000" value={createAmount} onChange={e => setCreateAmount(e.target.value)} required className="h-7 text-xs" />
              <div className="flex gap-1">
                <button type="button" onClick={() => setCreateDisbursement("chips")}
                  className={`flex-1 py-0.5 px-1.5 rounded text-[10px] font-semibold border transition-all ${createDisbursement === "chips" ? "bg-amber-600 border-amber-500 text-white" : "bg-card border-zinc-700 text-muted-foreground"}`}>
                  🪙 Chips
                </button>
                <button type="button" onClick={() => setCreateDisbursement("cash")}
                  className={`flex-1 py-0.5 px-1.5 rounded text-[10px] font-semibold border transition-all ${createDisbursement === "cash" ? "bg-emerald-700 border-emerald-600 text-white" : "bg-card border-zinc-700 text-muted-foreground"}`}>
                  💵 Cash
                </button>
              </div>
              {createDisbursement === "cash" && <p className="text-[10px] text-emerald-400">No chips added — cash IRL</p>}
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Rate (%) {creditInfo ? <span className="opacity-60">sugg. {creditInfo.interestRate}%</span> : null}</label>
              <Input type="number" min={0} step="0.1" placeholder="e.g. 10" value={createRate} onChange={e => setCreateRate(e.target.value)} className="h-7 text-xs" />
              <label className="text-[10px] text-muted-foreground block pt-0.5">Due Date</label>
              <input type="date" value={createDueDate} min={todayEST()} onChange={e => setCreateDueDate(e.target.value)}
                className="w-full bg-input border border-zinc-700 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 [color-scheme:dark]" />
            </div>
            <div className="col-span-2">
              <Input placeholder="Notes (optional)" value={createNotes} onChange={e => setCreateNotes(e.target.value)} className="h-7 text-xs" />
            </div>
          </div>
          {createAmount && parseInt(createAmount) > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Total owed: <span className="text-amber-400 font-semibold">{Math.round(parseInt(createAmount) * (1 + parseFloat(createRate || "0") / 100)).toLocaleString()} BET</span>
            </p>
          )}
          {createError && <p className="text-[10px] text-red-400">{createError}</p>}
          <div className="flex gap-1.5">
            <Button type="submit" className="bg-amber-600 hover:bg-amber-500 text-white text-xs h-6 px-3"><ScrollText className="w-3 h-3 mr-1" />Preview Contract</Button>
            <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setShowCreate(false); setCreateError(null); }}>Cancel</Button>
          </div>
        </form>
      )}

      {loading && <p className="text-xs text-muted-foreground py-1">Loading...</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && loans.length === 0 && <p className="text-xs text-muted-foreground">No loans on record.</p>}

      {/* Active / open loans — always visible */}
      {!loading && openLoans.map((loan: any) => (
        <div key={loan.id} className={`border rounded px-2 py-1 ${loan.effectiveStatus === "overdue" ? "border-amber-700 bg-amber-950" : loan.effectiveStatus === "defaulted" ? "border-red-700 bg-red-950" : loan.effectiveStatus === "paid" ? "border-green-800 bg-green-950" : "border-zinc-700 bg-card/60"}`}>
          {/* Single info row */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {statusBadge(loan.effectiveStatus)}
            <span className="text-muted-foreground">#{loan.id} · {loan.bankerUsername}</span>
            {loan.dueDate && <span className="text-muted-foreground">Due {new Date(loan.dueDate + "T12:00:00").toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</span>}
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">{loan.principalAmount.toLocaleString()} principal · {loan.totalOwed.toLocaleString()} total ({loan.interestRate}%)</span>
            <span className="text-muted-foreground/50">·</span>
            <span className={`font-semibold ${loan.remainingBalance > 0 ? "text-red-400" : "text-green-400"}`}>{loan.remainingBalance.toLocaleString()} left</span>
            {loan.notes && <span className="text-muted-foreground/70 italic">· "{loan.notes}"</span>}
          </div>
          {/* Payment history — single line */}
          {JSON.parse(loan.paymentHistory || "[]").length > 0 && (
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              Paid: {JSON.parse(loan.paymentHistory).slice(-4).map((p: { amount: number; date: string; type?: string }, i: number) => (
                <span key={i}>{i > 0 ? " · " : ""}<span className="text-green-400">{p.amount.toLocaleString()}</span>{p.type === "cash" ? "💵" : "🪙"} {new Date(p.date).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</span>
              ))}
            </p>
          )}
          {(loan.effectiveStatus === "active" || loan.effectiveStatus === "overdue") && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {payingLoanId === loan.id ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Input type="number" min={1} max={loan.remainingBalance} placeholder={`Max ${loan.remainingBalance.toLocaleString()}`} value={payAmount} onChange={e => setPayAmount(e.target.value)} className="w-32 h-6 text-xs" />
                  <div className="flex h-6">
                    <button type="button" onClick={() => setPayType("chips")} className={`px-2 rounded-l text-xs font-semibold border transition-all ${payType === "chips" ? "bg-amber-600 border-amber-500 text-white" : "bg-card border-zinc-700 text-muted-foreground"}`}>🪙 Chips</button>
                    <button type="button" onClick={() => setPayType("cash")} className={`px-2 rounded-r text-xs font-semibold border-t border-b border-r transition-all ${payType === "cash" ? "bg-emerald-700 border-emerald-600 text-white" : "bg-card border-zinc-700 text-muted-foreground"}`}>💵 Cash</button>
                  </div>
                  <Button size="sm" isLoading={payLoading} onClick={() => handlePayment(loan.id)} className="text-xs bg-green-700 hover:bg-green-600 text-white h-6 px-2">Record</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => { setPayingLoanId(null); setPayAmount(""); setPayType("chips"); setPayError(null); }}>Cancel</Button>
                  {payError && <span className="text-xs text-red-400">{payError}</span>}
                </div>
              ) : confirmAction?.loanId === loan.id ? (
                <div className="flex gap-1.5 items-center">
                  <span className={`text-xs ${confirmAction.action === "defaulted" ? "text-red-400" : "text-green-400"}`}>{confirmAction.action === "defaulted" ? "Mark as defaulted?" : "Mark as fully paid?"}</span>
                  <Button size="sm" isLoading={actionLoading === loan.id} className={`text-xs h-6 px-2 ${confirmAction.action === "defaulted" ? "bg-red-700 hover:bg-red-600 text-white" : "bg-green-700 hover:bg-green-600 text-white"}`} onClick={() => handleStatusChange(loan.id, confirmAction.action)}>Confirm</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2" onClick={() => setConfirmAction(null)}>Cancel</Button>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2 text-muted-foreground hover:text-foreground hover:bg-zinc-900" onClick={() => { setPayingLoanId(loan.id); setPayAmount(""); setPayError(null); }}>+ Payment</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2 text-red-400 hover:text-red-400 hover:bg-red-950" onClick={() => setConfirmAction({ loanId: loan.id, action: "defaulted" })}>Default</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2 text-green-400 hover:text-green-400 hover:bg-green-950" onClick={() => setConfirmAction({ loanId: loan.id, action: "paid" })}>Close</Button>
                  <Button size="sm" variant="ghost" className="text-xs h-6 px-2 text-amber-400 hover:text-amber-400 hover:bg-amber-950" onClick={() => openContractModal({ loanId: loan.id, amount: loan.principalAmount, totalOwed: loan.totalOwed, interestRate: loan.interestRate, dueDate: loan.dueDate, notes: loan.notes })}><ScrollText className="w-3 h-3 mr-0.5" />Contract</Button>
                </>
              )}
            </div>
          )}
        </div>
      ))}

      {/* Paid / closed loans — collapsed by default */}
      {!loading && closedLoans.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPaidLoans(v => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
          >
            <span className="text-[10px] border border-zinc-700 rounded px-1.5 py-px font-mono">{closedLoans.length}</span>
            {showPaidLoans ? "Hide" : "Show"} paid / closed loans
            <span className="text-[10px]">{showPaidLoans ? "▲" : "▼"}</span>
          </button>
          {showPaidLoans && closedLoans.map((loan: any) => (
            <div key={loan.id} className={`border rounded px-2 py-1 mt-1 ${loan.effectiveStatus === "defaulted" ? "border-red-700 bg-red-950" : "border-green-800 bg-green-950"}`}>
              <div className="flex items-center gap-2 flex-wrap text-xs">
                {statusBadge(loan.effectiveStatus)}
                <span className="text-muted-foreground">#{loan.id} · {loan.bankerUsername}</span>
                {loan.dueDate && <span className="text-muted-foreground">Due {new Date(loan.dueDate + "T12:00:00").toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</span>}
                <span className="text-muted-foreground/50">·</span>
                <span className="text-muted-foreground">{loan.principalAmount.toLocaleString()} principal · {loan.totalOwed.toLocaleString()} total ({loan.interestRate}%)</span>
                {loan.notes && <span className="text-muted-foreground/70 italic">· "{loan.notes}"</span>}
              </div>
              {JSON.parse(loan.paymentHistory || "[]").length > 0 && (
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Paid: {JSON.parse(loan.paymentHistory).slice(-4).map((p: { amount: number; date: string; type?: string }, i: number) => (
                    <span key={i}>{i > 0 ? " · " : ""}<span className="text-green-400">{p.amount.toLocaleString()}</span>{p.type === "cash" ? "💵" : "🪙"} {new Date(p.date).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</span>
                  ))}
                </p>
              )}
              <div className="flex gap-1 mt-0.5">
                {loan.effectiveStatus === "defaulted" && (
                  <Button size="sm" variant="ghost" className="text-[10px] h-5 px-1.5 text-muted-foreground hover:text-foreground" isLoading={actionLoading === loan.id} onClick={() => handleStatusChange(loan.id, "active")}>
                    Reopen as Active
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="text-[10px] h-5 px-1.5 text-amber-500 hover:text-amber-400 hover:bg-amber-950" onClick={() => openContractModal({ loanId: loan.id, amount: loan.principalAmount, totalOwed: loan.totalOwed, interestRate: loan.interestRate, dueDate: loan.dueDate, notes: loan.notes })}><ScrollText className="w-3 h-3 mr-0.5" />Contract</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contract Modal ── */}
      {contractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
          <div className="bg-[#0f0f0f] border border-amber-700 rounded-xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-800">
              <div className="flex items-center gap-2">
                <ScrollText className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-amber-400 text-sm tracking-wide">Loan Agreement</span>
                {contractModal.pending
                  ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-900 text-yellow-400 border border-yellow-700">PENDING SIGNATURE</span>
                  : <span className="text-[10px] text-muted-foreground font-mono">#{contractModal.loanId}</span>
                }
              </div>
              <button onClick={() => setContractModal(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Contract text */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <pre className="text-xs text-foreground/90 font-mono whitespace-pre-wrap leading-relaxed select-all bg-black/30 border border-zinc-700 rounded-lg p-3">
                {generateContractText()}
              </pre>
            </div>

            {/* Inline State ID setter — shown when lender SID is missing */}
            {lenderInfo !== null && !lenderInfo.stateId && (
              <div className="px-4 py-2.5 border-t border-amber-800 bg-amber-950 flex items-center gap-2">
                <span className="text-[11px] text-amber-400 font-semibold shrink-0">Your State ID missing —</span>
                <input
                  type="text"
                  placeholder="Enter your State ID"
                  value={contractSidInput}
                  onChange={e => setContractSidInput(e.target.value)}
                  className="flex-1 bg-black/40 border border-amber-700 rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-amber-400 min-w-0"
                />
                {lenderInfo.id && contractSidInput.trim() && (
                  <button
                    disabled={contractSidSaving}
                    onClick={async () => {
                      if (!contractSidInput.trim() || !lenderInfo.id) return;
                      setContractSidSaving(true);
                      try {
                        const r = await bankerApiFetch(`/banker/accounts/${lenderInfo.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ stateId: contractSidInput.trim() }),
                        });
                        if (r.ok) {
                          setLenderInfo(prev => prev ? { ...prev, stateId: contractSidInput.trim() } : prev);
                          useStore.getState().setBankerStateId(contractSidInput.trim());
                        }
                      } finally {
                        setContractSidSaving(false);
                      }
                    }}
                    className="shrink-0 bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold px-2 py-1 rounded transition-colors disabled:opacity-50"
                  >
                    {contractSidSaving ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            )}

            {/* Footer */}
            {contractModal.pending ? (
              <div className="px-4 py-3 border-t border-yellow-700 bg-yellow-950 flex flex-col gap-2">
                <p className="text-[10px] text-yellow-300">Have the player sign the contract in-game, then click <strong>Confirm & Issue Loan</strong> to apply it.</p>
                {contractConfirmError && <p className="text-[10px] text-red-400">{contractConfirmError}</p>}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-3" onClick={() => setContractModal(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={contractConfirmLoading}
                    onClick={handleConfirmLoan}
                    className="text-xs h-7 px-3 bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
                  >
                    {contractConfirmLoading ? "Issuing…" : <><CheckCircle className="w-3 h-3 mr-1" />Confirm & Issue Loan</>}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 border-t border-zinc-700 flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">Copy and paste into the in-game contract system.</p>
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(generateContractText());
                    setContractCopied(true);
                    setTimeout(() => setContractCopied(false), 2500);
                  }}
                  className={`shrink-0 ml-3 text-xs h-7 px-3 transition-all ${contractCopied ? "bg-green-700 hover:bg-green-600 text-white" : "bg-amber-600 hover:bg-amber-500 text-white"}`}
                >
                  {contractCopied ? <><CheckCircle className="w-3 h-3 mr-1" />Copied!</> : <><Copy className="w-3 h-3 mr-1" />Copy Contract</>}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transaction grouping helpers ────────────────────────────────────────────
const GAME_PREFIXES: [string, string][] = [
  ["roulette",        "Roulette"],
  ["slots",           "Slots"],
  ["crash",           "Crash"],
  ["blackjack",       "Blackjack"],
  ["baccarat",        "Baccarat"],
  ["poker",           "Poker"],
  ["mines",           "Mines"],
  ["back alley",      "Alley Slots"],
  ["horse race",      "Horse Racing"],
  ["horse racing",    "Horse Racing"],
  ["case opening",    "Cases"],
  ["deadwood dollars","Deadwood $"],
  ["fortuna",         "Fortuna"],
];

function detectTxGame(desc: string, type?: string): string | null {
  const d = (desc || "").toLowerCase();

  // Slot types — grouped by game name
  if (type === "fortuna-bet" || type === "fortuna-win" || type === "rome-slots-bet" || type === "rome-slots-win") return "Fortuna";
  if (type === "western-slots-bet" || type === "western-slots-win") return "Deadwood $";

  // Type-based: catch legacy poker_win/rake entries already in the DB
  if (type === "poker_win") return "Poker";
  if (type === "buyin" && (d.includes("table") || d.startsWith("poker"))) return "Poker";
  if (type === "cashout" && d.startsWith("poker")) return "Poker";
  if (type === "rake" && d.includes("table")) return "Poker";

  // Description prefix-based (new entries all start with the game name)
  for (const [prefix, label] of GAME_PREFIXES) {
    if (d.startsWith(prefix)) return label;
  }

  // Legacy description patterns for old poker entries
  if (d.startsWith("won pot at table") || d.startsWith("rake collected at") ||
      d.startsWith("buy-in to table") || d.startsWith("left table") ||
      d.startsWith("afk kicked from table")) return "Poker";

  // ── Auto-fallback: any win/loss not matched above ─────────────────────────
  // All game transactions use "<GameName> action…" convention.
  // Extract the leading capitalised word(s) so future games group automatically
  // without requiring a GAME_PREFIXES entry.
  if (type === "win" || type === "loss") {
    const raw = (desc || "").trim();
    // Skip emoji-only / special entries (e.g. 🎰 PROGRESSIVE JACKPOT)
    if (raw && /^[A-Z]/.test(raw)) {
      // Take words while they look like a proper noun / game name component
      const words = raw.split(/\s+/);
      const label: string[] = [];
      for (const w of words) {
        // Stop at lowercase connectors or punctuation-only words
        if (/^[a-z]/.test(w) || /^[^A-Za-z]/.test(w)) break;
        label.push(w.replace(/[^A-Za-z]/g, ""));
        // One capitalised word is usually enough (e.g. "Crash", "Mines")
        // Keep going for multi-word names like "Back Alley", "Horse Racing"
        if (label.length >= 2) break;
      }
      const name = label.join(" ").trim();
      if (name.length >= 2) return name;
    }
  }

  return null;
}

type SingleTxGroup = { kind: "single"; tx: any };
type MultiTxGroup  = { kind: "group";  game: string; txs: any[]; gid: string };
type TxGroup = SingleTxGroup | MultiTxGroup;

function buildTxGroups(txs: any[]): TxGroup[] {
  const raw: TxGroup[] = [];
  for (const tx of txs) {
    const game = detectTxGame(tx.description, tx.type);
    if (!game) { raw.push({ kind: "single", tx }); continue; }
    const last = raw[raw.length - 1];
    if (last && last.kind === "group" && last.game === game) {
      last.txs.push(tx);
    } else {
      raw.push({ kind: "group", game, txs: [tx], gid: `g-${tx.id}` });
    }
  }
  return raw.map(g =>
    g.kind === "group" && g.txs.length === 1 ? { kind: "single", tx: g.txs[0] } : g
  );
}

const GAME_BADGE_COLOR: Record<string, string> = {
  Roulette:         "bg-purple-900 text-purple-300 border-purple-700",
  Slots:            "bg-yellow-900 text-yellow-300 border-yellow-700",
  Crash:            "bg-orange-900 text-orange-300 border-orange-700",
  Blackjack:        "bg-emerald-900 text-emerald-300 border-emerald-700",
  Baccarat:         "bg-cyan-900 text-cyan-300 border-cyan-700",
  Poker:            "bg-blue-900 text-blue-300 border-blue-700",
  Fortuna:          "bg-amber-900 text-amber-300 border-amber-700",
  "Deadwood $":     "bg-orange-900 text-orange-300 border-orange-700",
  Mines:            "bg-red-900 text-red-300 border-red-700",
  "Alley Slots":    "bg-zinc-900 text-zinc-300 border-zinc-700",
  "Horse Racing":   "bg-yellow-900 text-yellow-600 border-yellow-700",
  Cases:            "bg-violet-900 text-violet-300 border-violet-700",
};

const TX_TYPE_BADGE: Record<string, string> = {
  deposit:             "bg-green-900 text-green-400 border-green-700",
  withdrawal:          "bg-orange-900 text-orange-400 border-orange-700",
  bonus:               "bg-purple-900 text-purple-300 border-purple-700",
  win:                 "bg-blue-900 text-blue-400 border-blue-700",
  loss:                "bg-red-900 text-red-400 border-red-700",
  rake:                "bg-yellow-900 text-yellow-400 border-yellow-700",
  buyin:               "bg-purple-900 text-purple-300 border-purple-700",
  cashout:             "bg-teal-900 text-teal-300 border-teal-700",
  poker_win:           "bg-blue-900 text-blue-400 border-blue-700",
  transfer_sent:       "bg-orange-900 text-orange-400 border-orange-700",
  transfer_received:   "bg-green-900 text-green-400 border-green-700",
  "fortuna-bet":       "bg-amber-900 text-amber-400 border-amber-700",
  "fortuna-win":       "bg-amber-900 text-amber-400 border-amber-700",
  "rome-slots-bet":    "bg-amber-900 text-amber-400 border-amber-700",
  "rome-slots-win":    "bg-amber-900 text-amber-400 border-amber-700",
  "western-slots-bet": "bg-orange-900 text-orange-400 border-orange-700",
  "western-slots-win": "bg-orange-900 text-orange-400 border-orange-700",
};
const TX_TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit", withdrawal: "Withdrawal", bonus: "Gift", win: "Win", loss: "Loss",
  rake: "Rake", buyin: "Buy-in", cashout: "Cash-out", poker_win: "Win",
  transfer_sent: "Transfer Out", transfer_received: "Transfer In",
  "fortuna-bet":       "Fortuna",  "fortuna-win":       "Fortuna",
  "rome-slots-bet":    "Fortuna",  "rome-slots-win":    "Fortuna",
  "western-slots-bet": "Deadwood", "western-slots-win": "Deadwood",
};
const TX_TYPE_SIGN: Record<string, string> = {
  deposit: "+", win: "+", bonus: "+", poker_win: "+", transfer_received: "+",
  withdrawal: "−", loss: "−", rake: "−", buyin: "−", cashout: "+", transfer_sent: "−",
  // Slot bet amounts are already negative in the DB — no prefix needed
  // Slot win amounts are positive — show + for clarity
  "fortuna-win": "+", "rome-slots-win": "+", "western-slots-win": "+",
};
const TX_TYPE_COLOR: Record<string, string> = {
  deposit: "text-green-400", win: "text-blue-400", bonus: "text-purple-300", poker_win: "text-blue-400",
  withdrawal: "text-orange-400", loss: "text-red-400", rake: "text-yellow-400",
  buyin: "text-purple-300", cashout: "text-teal-300",
  transfer_sent: "text-orange-400", transfer_received: "text-green-400",
  "fortuna-bet": "text-red-400",    "rome-slots-bet": "text-red-400",    "western-slots-bet": "text-red-400",
  "fortuna-win": "text-amber-400",  "rome-slots-win": "text-amber-400",  "western-slots-win": "text-amber-400",
};

const CREDIT_TYPES = new Set([
  "win", "deposit", "bonus", "poker_win", "cashout", "transfer_received",
  // Slot amounts already carry their sign (bets are negative, wins are positive)
  // so ALL slot types go here to prevent txNetAmount from double-flipping
  "fortuna-bet", "fortuna-win",
  "rome-slots-bet", "rome-slots-win",
  "western-slots-bet", "western-slots-win",
]);

function txNetAmount(txs: any[]): number {
  return txs.reduce((sum, tx) => {
    const isCredit = CREDIT_TYPES.has(tx.type);
    return sum + (isCredit ? tx.amount : -tx.amount);
  }, 0);
}

function fmtTsShort(val: string | number | null | undefined) {
  if (!val) return "";
  return fmtETDateTimeShort(val as string);
}

function GroupedTransactionList({ txs }: { txs: any[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = buildTxGroups(txs);

  function toggle(gid: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });
  }

  function SingleRow({ tx, indent = false }: { tx: any; indent?: boolean }) {
    const game = !indent ? detectTxGame(tx.description, tx.type) : null;
    return (
      <div className={`flex items-center gap-2 py-1.5 text-xs ${indent ? "pl-4" : ""}`}>
        {game ? (
          <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${GAME_BADGE_COLOR[game] || "bg-zinc-800 text-muted-foreground border-zinc-700"}`}>
            {game}
          </span>
        ) : (
          <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${TX_TYPE_BADGE[tx.type] || "bg-zinc-800 text-muted-foreground border-zinc-700"}`}>
            {TX_TYPE_LABEL[tx.type] || tx.type}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-foreground/80 truncate leading-tight">{tx.description || "—"}</p>
          <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1.5 leading-tight mt-px flex-wrap">
            {tx.createdAt && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5 shrink-0" />
                {fmtTsShort(tx.createdAt)}
              </span>
            )}
            {tx.staffUsername && tx.staffUsername !== "auto" && (
              <span className="text-muted-foreground/40">· by {tx.staffUsername}</span>
            )}
          </p>
        </div>
        <span className={`shrink-0 font-bold tabular-nums ${TX_TYPE_COLOR[tx.type] || "text-foreground"}`}>
          {TX_TYPE_SIGN[tx.type] || ""}{tx.amount.toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-0 divide-y divide-zinc-700/30">
      {groups.map((group, i) => {
        if (group.kind === "single") {
          return <SingleRow key={group.tx.id ?? i} tx={group.tx} />;
        }
        const net = txNetAmount(group.txs);
        const isOpen = expanded.has(group.gid);
        return (
          <div key={group.gid}>
            {/* Group summary row */}
            <button
              onClick={() => toggle(group.gid)}
              className="w-full flex items-center gap-2 py-1.5 text-xs text-left hover:bg-white/5 rounded transition-colors group"
            >
              <ChevronRight className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
              <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide ${GAME_BADGE_COLOR[group.game] || "bg-zinc-800 text-muted-foreground border-zinc-700"}`}>
                {group.game}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-foreground/80">{group.txs.length} entries</span>
                <span className="text-[10px] text-muted-foreground/50 ml-1.5">
                  {fmtTsShort(group.txs[group.txs.length - 1]?.createdAt)}
                </span>
              </div>
              <span className={`shrink-0 font-bold tabular-nums ${net >= 0 ? "text-blue-400" : "text-red-400"}`}>
                {net >= 0 ? "+" : ""}{net.toLocaleString()}
              </span>
            </button>
            {/* Expanded individual entries */}
            {isOpen && (
              <div className="border-l-2 border-zinc-700 ml-3 pl-1 divide-y divide-zinc-700/20">
                {group.txs.map((tx, j) => <SingleRow key={tx.id ?? j} tx={tx} indent />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlayerExpandedPanel({ playerId }: { playerId: number }) {
  const [tab, setTab] = useState<"chips" | "bets">("chips");

  const [txs, setTxs] = useState<any[]>([]);
  const [txsLoading, setTxsLoading] = useState(false);
  const [txsRefreshing, setTxsRefreshing] = useState(false);
  const [txsError, setTxsError] = useState<string | null>(null);
  const [txSearch, setTxSearch] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState<string>("all");

  const [bets, setBets] = useState<any[]>([]);
  const [betsLoading, setBetsLoading] = useState(false);
  const [betsLoaded, setBetsLoaded] = useState(false);
  const [betSearch, setBetSearch] = useState("");
  const [betStatusFilter, setBetStatusFilter] = useState<string>("all");

  // Auto-poll chip transactions every 5 s while the chips tab is open
  useEffect(() => {
    if (tab !== "chips") return;
    let first = true;
    async function fetchTxs() {
      if (first) { setTxsLoading(true); setTxsError(null); }
      try {
        const r = await bankerApiFetch(`/players/${playerId}/transactions`);
        const d = await r.json();
        if (!r.ok) { if (first) setTxsError(d?.error ?? `Error ${r.status}`); return; }
        if (Array.isArray(d)) setTxs(d);
      } catch (e: any) { if (first) setTxsError(e?.message ?? "Failed to load"); }
      finally { if (first) { setTxsLoading(false); first = false; } }
    }
    fetchTxs();
    const iv = setInterval(fetchTxs, 5000);
    return () => clearInterval(iv);
  }, [tab, playerId]);

  async function refreshTxs() {
    setTxsRefreshing(true);
    try {
      const r = await bankerApiFetch(`/players/${playerId}/transactions`);
      const d = await r.json();
      if (r.ok && Array.isArray(d)) setTxs(d);
    } catch { /* silent */ }
    finally { setTxsRefreshing(false); }
  }

  useEffect(() => {
    if (tab !== "bets" || betsLoaded) return;
    setBetsLoading(true);
    bankerApiFetch(`/sportbets/players/${playerId}/bets`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBets(d); setBetsLoaded(true); })
      .catch(() => {})
      .finally(() => setBetsLoading(false));
  }, [tab, playerId, betsLoaded]);

  const RESULT_BADGE: Record<string, string> = {
    won:     "bg-green-900 text-green-400 border-green-700",
    lost:    "bg-red-900 text-red-400 border-red-700",
    pending: "bg-amber-900 text-amber-400 border-amber-700",
  };

  function fmtTs(val: string | number | null | undefined) {
    if (!val) return "";
    return fmtETDateTimeShort(val as string);
  }

  const SLOT_TX_TYPES = new Set(["fortuna-bet","fortuna-win","rome-slots-bet","rome-slots-win","western-slots-bet","western-slots-win"]);
  const filteredTxs = [...txs].filter(tx => {
    if (detectTxGame(tx.description, tx.type) === "Poker" && tx.type !== "rake") return false;
    if (txTypeFilter === "slots") { if (!SLOT_TX_TYPES.has(tx.type)) return false; }
    else if (txTypeFilter !== "all" && tx.type !== txTypeFilter) return false;
    if (txSearch && !tx.description?.toLowerCase().includes(txSearch.toLowerCase())) return false;
    return true;
  });

  const filteredBets = bets.filter(bet => {
    if (betStatusFilter !== "all" && bet.result !== betStatusFilter) return false;
    if (betSearch && !bet.eventTitle?.toLowerCase().includes(betSearch.toLowerCase()) && !bet.optionLabel?.toLowerCase().includes(betSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="border-t border-zinc-700 bg-zinc-900">
      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setTab("chips")}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${tab === "chips" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Chip Transactions {txs.length > 0 && <span className="ml-1 text-[10px] opacity-60">({txs.length})</span>}
        </button>
        <button
          onClick={() => setTab("bets")}
          className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors border-b-2 ${tab === "bets" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Sport Bets {betsLoaded && <span className="ml-1 text-[10px] opacity-60">({bets.length})</span>}
        </button>
      </div>

      {/* ── Chip Transactions ───────────────────────────────────────────────── */}
      {tab === "chips" && (
        <div className="p-3 space-y-2">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <div className="relative flex-1 min-w-[120px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={txSearch}
                onChange={e => setTxSearch(e.target.value)}
                placeholder="Search description…"
                className="w-full bg-black/30 border border-zinc-700 rounded-lg pl-6 pr-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            {(["all","deposit","withdrawal","bonus","win","loss","rake","slots"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTxTypeFilter(t)}
                className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                  txTypeFilter === t
                    ? t === "all" ? "bg-red-950 text-red-300 border-red-800" : t === "slots" ? "bg-amber-900 text-amber-400 border-amber-700" : TX_TYPE_BADGE[t] + " border"
                    : "border-zinc-700 text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "all" ? "All" : t === "slots" ? "Slots" : TX_TYPE_LABEL[t] || t}
              </button>
            ))}
            {(txSearch || txTypeFilter !== "all") && (
              <button onClick={() => { setTxSearch(""); setTxTypeFilter("all"); }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1">✕</button>
            )}
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{filteredTxs.length}/{txs.length}</span>
            <button
              onClick={refreshTxs}
              disabled={txsRefreshing}
              className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              title="Refresh now"
            >
              <RefreshCw className={`w-3 h-3 ${txsRefreshing ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* List */}
          {txsLoading ? (
            <p className="text-xs text-muted-foreground py-2">Loading…</p>
          ) : txsError ? (
            <p className="text-xs text-red-400 py-2">Failed to load: {txsError}</p>
          ) : txs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No transactions yet.</p>
          ) : filteredTxs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No matches — try adjusting filters.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto pr-0.5">
              <GroupedTransactionList txs={filteredTxs} />
            </div>
          )}
        </div>
      )}

      {/* ── Sport Bets ──────────────────────────────────────────────────────── */}
      {tab === "bets" && (
        <div className="p-3 space-y-2">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <div className="relative flex-1 min-w-[120px]">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                value={betSearch}
                onChange={e => setBetSearch(e.target.value)}
                placeholder="Search event or pick…"
                className="w-full bg-black/30 border border-zinc-700 rounded-lg pl-6 pr-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </div>
            {(["all","won","lost","pending"] as const).map(s => (
              <button
                key={s}
                onClick={() => setBetStatusFilter(s)}
                className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                  betStatusFilter === s
                    ? s === "all" ? "bg-red-950 text-red-300 border-red-800" : RESULT_BADGE[s] + " border"
                    : "border-zinc-700 text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
            {(betSearch || betStatusFilter !== "all") && (
              <button onClick={() => { setBetSearch(""); setBetStatusFilter("all"); }} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1">✕</button>
            )}
            <span className="text-[10px] text-muted-foreground/60 ml-auto">{filteredBets.length}/{bets.length}</span>
          </div>

          {/* List */}
          {betsLoading ? (
            <p className="text-xs text-muted-foreground py-2">Loading…</p>
          ) : bets.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No sport bets on record.</p>
          ) : filteredBets.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No matches — try adjusting filters.</p>
          ) : (
            <div className="space-y-0 max-h-64 overflow-y-auto divide-y divide-zinc-700/30">
              {filteredBets.map((bet) => (
                <div key={bet.id} className="flex items-start gap-2 py-2 text-xs">
                  <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide mt-px ${RESULT_BADGE[bet.result] || "bg-zinc-800 text-muted-foreground border-zinc-700"}`}>
                    {bet.result || "?"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate leading-tight">{bet.eventTitle}</p>
                    <p className="text-muted-foreground/70 truncate text-[10px]">
                      {bet.optionLabel}{bet.odds ? ` @ ${bet.odds}` : ""}{bet.league ? ` · ${bet.league}` : ""}
                    </p>
                    {bet.createdAt && (
                      <p className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5 mt-px">
                        <Clock className="w-2.5 h-2.5 shrink-0" />
                        {fmtTs(bet.createdAt)}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold text-foreground tabular-nums">${bet.amount.toLocaleString()}</p>
                    {bet.result === "won" && (
                      <p className="text-green-400 text-[10px] font-semibold">
                        +${bet.netPayout?.toLocaleString()} {bet.paidAt ? "paid" : "unpaid"}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Blackjack Hand History ────────────────────────────────────────────────────

type BJHand = {
  id: number; tableId: number; tableName: string; roundId: number;
  playerId: number; playerName: string; seatIndex: number;
  playerCards: string; playerValue: number;
  splitCards: string | null; splitValue: number | null;
  dealerCards: string; dealerValue: number;
  result: string; splitResult: string | null;
  bet: number; splitBet: number; payout: number;
  oddsMode: string; playedAt: string;
};

const BJ_RESULT_LABELS: Record<string, { label: string; color: string }> = {
  player_blackjack: { label: "Blackjack", color: "bg-amber-900 text-amber-300 border-amber-700" },
  player_win:       { label: "Win",       color: "bg-emerald-900 text-emerald-300 border-emerald-700" },
  dealer_win:       { label: "Loss",      color: "bg-red-900 text-red-300 border-red-700" },
  push:             { label: "Push",      color: "bg-blue-900 text-blue-300 border-blue-700" },
  player_bust:      { label: "Bust",      color: "bg-red-950 text-red-400 border-red-700" },
  dealer_bust:      { label: "Dlr Bust",  color: "bg-emerald-950 text-emerald-300 border-emerald-700" },
};

function BlackjackHandHistory({ bjTables }: { bjTables: any[] }) {
  const [hands, setHands] = useState<BJHand[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [playerSearch, setPlayerSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const [tableFilter, setTableFilter] = useState("all");
  const [limit, setLimit] = useState(50);

  const fetchHands = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (playerSearch) params.set("player", playerSearch);
      if (resultFilter !== "all") params.set("result", resultFilter);
      if (tableFilter !== "all") params.set("tableId", tableFilter);
      const res = await bankerApiFetch(`/blackjack/hands?${params}`);
      if (res.ok) { const d = await res.json(); setHands(d.hands ?? []); setTotal(d.total ?? 0); }
    } finally { setLoading(false); setRefreshing(false); }
  }, [playerSearch, resultFilter, tableFilter, limit]);

  useEffect(() => { fetchHands(); }, [fetchHands]);

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(() => fetchHands(true), 15000);
    return () => clearInterval(id);
  }, [fetchHands]);

  const fmt = (n: number) => n.toLocaleString();
  const fmtTime = (s: string) => fmtETFull(s);

  const ResultBadge = ({ r }: { r: string }) => {
    const m = BJ_RESULT_LABELS[r] ?? { label: r, color: "bg-zinc-800 text-muted-foreground border-zinc-700" };
    return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${m.color}`}>{m.label}</span>;
  };

  return (
    <div className="rounded-xl border border-zinc-700 bg-card/40 overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-700 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold">Hand History</span>
        <span className="text-xs text-muted-foreground">{total > 0 ? `${total.toLocaleString()} hands recorded` : ""}</span>
        <button
          onClick={() => fetchHands(true)}
          disabled={refreshing}
          className="ml-auto p-1 rounded hover:bg-zinc-900 text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-zinc-700 flex flex-wrap gap-2 items-center bg-zinc-900">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={playerSearch}
            onChange={e => setPlayerSearch(e.target.value)}
            placeholder="Search player…"
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-input border border-zinc-700 rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <select
          value={resultFilter}
          onChange={e => setResultFilter(e.target.value)}
          className="bg-input border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="all">All Results</option>
          <option value="player_blackjack">Blackjack</option>
          <option value="player_win">Win</option>
          <option value="dealer_win">Loss</option>
          <option value="push">Push</option>
          <option value="player_bust">Player Bust</option>
          <option value="dealer_bust">Dealer Bust</option>
        </select>
        <select
          value={tableFilter}
          onChange={e => setTableFilter(e.target.value)}
          className="bg-input border border-zinc-700 rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-none"
        >
          <option value="all">All Tables</option>
          {bjTables.map(t => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : hands.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">
          No hands recorded yet — they'll appear here as games are played.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-700 bg-zinc-900 text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Time</th>
                <th className="px-3 py-2.5 text-left font-medium">Table · Round</th>
                <th className="px-3 py-2.5 text-left font-medium">Player</th>
                <th className="px-3 py-2.5 text-left font-medium">Player Hand</th>
                <th className="px-3 py-2.5 text-left font-medium">Dealer Hand</th>
                <th className="px-3 py-2.5 text-left font-medium">Result</th>
                <th className="px-3 py-2.5 text-right font-medium">Bet</th>
                <th className="px-3 py-2.5 text-right font-medium">Payout</th>
              </tr>
            </thead>
            <tbody className="bg-zinc-950">
              {hands.map((h, i) => (
                <tr key={h.id} className={`border-b border-zinc-700 hover:bg-zinc-900 transition-colors ${i % 2 === 0 ? "" : "bg-zinc-900"}`}>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtTime(h.playedAt)}</td>
                  <td className="px-3 py-2 text-xs">
                    <span className="text-foreground/80">{h.tableName}</span>
                    <span className="text-muted-foreground ml-1">#{h.roundId}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-xs">{h.playerName}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span className="text-foreground">{h.playerCards}</span>
                    <span className="text-muted-foreground ml-1">({h.playerValue})</span>
                    {h.splitCards && (
                      <div className="text-muted-foreground/70">
                        +split: {h.splitCards} ({h.splitValue})
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <span className="text-foreground">{h.dealerCards}</span>
                    <span className="text-muted-foreground ml-1">({h.dealerValue})</span>
                  </td>
                  <td className="px-3 py-2">
                    <ResultBadge r={h.result} />
                    {h.splitResult && <div className="mt-0.5"><ResultBadge r={h.splitResult} /></div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    {fmt(h.bet)}{h.splitBet > 0 && <span className="text-muted-foreground/60">+{fmt(h.splitBet)}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${h.payout > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {h.payout > 0 ? `+${fmt(h.payout)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hands.length < total && (
            <div className="p-4 text-center">
              <button
                onClick={() => setLimit(l => l + 50)}
                className="text-xs text-primary hover:underline"
              >
                Load more (showing {hands.length} of {total})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TablesTab({ role = "banker", role2 = null, roles = [] }: { role?: string; role2?: string | null; roles?: string[] }) {
  const { data: restTables = [] } = useListTables({});
  const { tables: liveTables } = useLobbySocket();
  const tables = liveTables ?? restTables;
  const createMutation = useCreateTable();
  const deleteMutation = useDeleteTable();
  const [confirmDelTableId, setConfirmDelTableId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [seatKickId, setSeatKickId] = useState<number | null>(null);
  const [kickingSeats, setKickingSeats] = useState<Record<string, boolean>>({});

  async function handleKickSeat(tableId: number, seatIndex: number) {
    const key = `${tableId}-${seatIndex}`;
    setKickingSeats(prev => ({ ...prev, [key]: true }));
    try {
      const r = await bankerApiFetch(`/tables/${tableId}/seats/${seatIndex}/kick`, { method: "POST" });
      if (!r.ok) { const d = await r.json(); showToast(d?.error || "Failed to kick player"); }
    } catch { showToast("Network error"); }
    finally { setKickingSeats(prev => ({ ...prev, [key]: false })); }
  }
  const effectiveRoles = roles.length > 0 ? roles : [role, role2].filter(Boolean) as string[];
  const tabHasRole = (...check: string[]) => effectiveRoles.some(r => check.includes(r));
  const canCreate = tabHasRole("owner", "banker", "dealer");
  const canDelete = tabHasRole("owner", "banker", "dealer");
  const canToggle = tabHasRole("owner", "banker", "dealer");
  const canManageRake = tabHasRole("owner", "banker");
  const canKickSeat = tabHasRole("owner", "banker", "dealer", "security_guard", "pit_boss");
  const [subTab, setSubTab] = useState<"poker" | "horses" | "blackjack" | "tournaments" | "bingo" | "lottery">("poker");

  // ── Blackjack table management ─────────────────────────────────────────────
  const [bjTables, setBjTables] = useState<any[]>([]);
  const [bjLoading, setBjLoading] = useState(false);
  const [bjCreating, setBjCreating] = useState(false);
  const [bjTogglingId, setBjTogglingId] = useState<number | null>(null);
  const [bjDeletingId, setBjDeletingId] = useState<number | null>(null);
  const [bjConfirmDelId, setBjConfirmDelId] = useState<number | null>(null);
  const [bjForm, setBjForm] = useState({ name: "", minBet: "100", maxBet: "10000", numSeats: "6", theme: "velvet", password: "" });

  async function fetchBjTables() {
    setBjLoading(true);
    try {
      const r = await bankerApiFetch("/blackjack/tables");
      if (r.ok) { const d = await r.json(); setBjTables(Array.isArray(d) ? d : []); }
    } finally { setBjLoading(false); }
  }

  useEffect(() => { if (subTab === "blackjack") fetchBjTables(); }, [subTab]);

  async function handleBjCreate(e: React.FormEvent) {
    e.preventDefault();
    setBjCreating(true);
    try {
      const r = await bankerApiFetch("/blackjack/tables", {
        method: "POST",
        body: JSON.stringify({
          name: bjForm.name, minBet: parseInt(bjForm.minBet), maxBet: parseInt(bjForm.maxBet),
          numSeats: parseInt(bjForm.numSeats), theme: bjForm.theme,
          ...(bjForm.password.trim() ? { password: bjForm.password.trim() } : {}),
        }),
      });
      if (!r.ok) { const d = await r.json(); showToast(d?.error || "Failed"); return; }
      setBjForm({ name: "", minBet: "100", maxBet: "10000", numSeats: "6", theme: "velvet", password: "" });
      await fetchBjTables();
    } catch (err: any) { showToast(err?.message || "Failed"); }
    finally { setBjCreating(false); }
  }

  async function handleBjToggle(id: number) {
    setBjTogglingId(id);
    try {
      await bankerApiFetch(`/blackjack/tables/${id}/toggle`, { method: "POST" });
      await fetchBjTables();
    } finally { setBjTogglingId(null); }
  }

  async function handleBjDelete(id: number) {
    setBjDeletingId(id);
    try {
      await bankerApiFetch(`/blackjack/tables/${id}`, { method: "DELETE" });
      await fetchBjTables();
    } finally { setBjDeletingId(null); setBjConfirmDelId(null); }
  }

  const [bjPwEditId, setBjPwEditId] = useState<number | null>(null);
  const [bjPwInput, setBjPwInput] = useState("");
  const [bjPwSaving, setBjPwSaving] = useState(false);

  async function handleBjSetPassword(id: number, hasPassword: boolean) {
    setBjPwSaving(true);
    try {
      const body = bjPwInput.trim()
        ? { password: bjPwInput.trim() }
        : { clearPassword: true };
      const r = await bankerApiFetch(`/blackjack/tables/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!r.ok) { const d = await r.json(); showToast(d?.error || "Failed to update password"); return; }
      setBjPwEditId(null); setBjPwInput("");
      await fetchBjTables();
    } finally { setBjPwSaving(false); }
  }


  // Table password editing
  const [pwEditId, setPwEditId] = useState<number | null>(null);
  const [pwInput, setPwInput] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  async function handleSetTablePassword(tableId: number) {
    setPwSaving(true);
    try {
      await bankerApiFetch(`/tables/${tableId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password: pwInput.trim() || null }),
      });
      setPwEditId(null); setPwInput("");
    } catch (err: any) {
      showToast(err?.message || "Failed to update password");
    } finally {
      setPwSaving(false);
    }
  }

  // Rake editing
  const [rakeEditId, setRakeEditId] = useState<number | null>(null);
  const [rakeEditPct, setRakeEditPct] = useState("");
  const [rakeEditCap, setRakeEditCap] = useState("");
  const [rakeSaving, setRakeSaving] = useState(false);

  // Blind escalation config
  const [blindEditId, setBlindEditId] = useState<number | null>(null);
  const [blindCfg, setBlindCfg] = useState<{ enabled: boolean; resetDelay: number; levels: { small: number; big: number; duration: number }[] }>({
    enabled: false, resetDelay: 30, levels: [{ small: 25, big: 50, duration: 600 }],
  });
  const [blindSaving, setBlindSaving] = useState(false);
  const [blindLoading, setBlindLoading] = useState(false);

  async function openBlindEdit(tableId: number) {
    setBlindLoading(true);
    setRakeEditId(null); setPwEditId(null);
    try {
      const r = await bankerApiFetch(`/tables/${tableId}/blind-config`);
      if (r.ok) {
        const d = await r.json();
        setBlindCfg({
          enabled: d.escalationEnabled ?? false,
          resetDelay: d.resetDelay ?? 30,
          levels: Array.isArray(d.blindLevels) && d.blindLevels.length > 0
            ? d.blindLevels
            : [{ small: 25, big: 50, duration: 600 }],
        });
        setBlindEditId(tableId);
      }
    } finally { setBlindLoading(false); }
  }

  function updateBlindLevel(idx: number, field: "small" | "big" | "duration", val: string) {
    setBlindCfg(prev => {
      const levels = prev.levels.map((l, i) => i === idx ? { ...l, [field]: parseInt(val) || 0 } : l);
      return { ...prev, levels };
    });
  }

  function addBlindLevel() {
    setBlindCfg(prev => {
      const last = prev.levels[prev.levels.length - 1];
      return { ...prev, levels: [...prev.levels, { small: (last?.small ?? 25) * 2, big: (last?.big ?? 50) * 2, duration: last?.duration ?? 600 }] };
    });
  }

  function removeBlindLevel(idx: number) {
    setBlindCfg(prev => ({ ...prev, levels: prev.levels.filter((_, i) => i !== idx) }));
  }

  async function handleSaveBlindConfig(tableId: number) {
    setBlindSaving(true);
    try {
      const r = await bankerApiFetch(`/tables/${tableId}/blind-config`, {
        method: "POST",
        body: JSON.stringify({ escalationEnabled: blindCfg.enabled, resetDelay: blindCfg.resetDelay, blindLevels: blindCfg.levels }),
      });
      if (!r.ok) { const d = await r.json(); showToast(d?.error || "Failed to save"); return; }
      setBlindEditId(null);
    } catch (err: any) { showToast(err?.message || "Failed"); }
    finally { setBlindSaving(false); }
  }

  function openRakeEdit(table: any) {
    setRakeEditId(table.id);
    setRakeEditPct(String(table.rakePercent));
    setRakeEditCap(String(table.rakeCap));
    setPwEditId(null);
  }

  async function handleSaveRake(tableId: number) {
    setRakeSaving(true);
    try {
      await bankerApiFetch(`/tables/${tableId}/rake`, {
        method: "PATCH",
        body: JSON.stringify({ rakePercent: parseFloat(rakeEditPct), rakeCap: parseInt(rakeEditCap) }),
      });
      setRakeEditId(null);
    } catch (err: any) {
      showToast(err?.message || "Failed to update rake");
    } finally {
      setRakeSaving(false);
    }
  }

  async function handleToggleTable(tableId: number) {
    setTogglingId(tableId);
    try {
      await bankerApiFetch(`/banker/tables/${tableId}/toggle`, { method: "POST" });
    } catch {}
    setTogglingId(null);
  }

  const TABLE_THEMES = [
    {
      id: "velvet",
      label: "Classic",
      desc: "Standard stakes",
      icon: "♠",
      bg: "from-[#7b1a1a] via-[#9e2020] to-[#5c1010]",
      ring: "ring-red-600",
    },
    {
      id: "gold",
      label: "High Roller",
      desc: "Premium stakes",
      icon: "👑",
      bg: "from-[#7a5c00] via-[#b8860b] to-[#5a4000]",
      ring: "ring-yellow-500",
    },
    {
      id: "diamond",
      label: "VIP",
      desc: "Exclusive table",
      icon: "💎",
      bg: "from-[#2d1a5c] via-[#4a2d8a] to-[#1a0d40]",
      ring: "ring-purple-500",
    },
  ] as const;

  const [form, setForm] = useState({
    name: "", smallBlind: "25", bigBlind: "50",
    minBuyIn: "500", maxBuyIn: "5000", rakePercent: "5", rakeCap: "500", password: "",
    theme: "velvet",
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: {
          name: form.name,
          smallBlind: parseInt(form.smallBlind),
          bigBlind: parseInt(form.bigBlind),
          minBuyIn: parseInt(form.minBuyIn),
          maxBuyIn: parseInt(form.maxBuyIn),
          rakePercent: parseFloat(form.rakePercent),
          rakeCap: parseInt(form.rakeCap),
          theme: form.theme,
          ...(form.password.trim() ? { password: form.password.trim() } : {}),
        } as any,
      });
      setForm({ name: "", smallBlind: "25", bigBlind: "50", minBuyIn: "500", maxBuyIn: "5000", rakePercent: "5", rakeCap: "500", password: "", theme: "velvet" });
    } catch (err: any) {
      showToast(err?.message || "Failed to create table");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-zinc-700 pb-3">
        {([
          { key: "poker", label: "♠ Poker Tables" },
          { key: "blackjack", label: "♣ Blackjack" },
          { key: "horses", label: "🏇 Horse Racing" },
          { key: "tournaments", label: "🏆 Tournaments" },
          { key: "bingo", label: "🎱 Bingo" },
          { key: "lottery", label: "🎫 Lottery" },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${subTab === key ? "bg-red-950 text-red-300 border border-red-800" : "text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === "poker" && <>
      {canCreate && <div className="bg-card border border-zinc-700 rounded-2xl p-6">
        <h2 className="text-lg font-display font-semibold text-foreground mb-4">Create New Table</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-2 grid-cols-3 gap-3">
          <div className="col-span-3">
            <label className="text-xs text-muted-foreground block mb-1">Table Name</label>
            <Input placeholder='e.g. "High Rollers Table"' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          {[
            { key: "smallBlind", label: "Small Blind" },
            { key: "bigBlind", label: "Big Blind" },
            { key: "minBuyIn", label: "Min Buy-in" },
            { key: "maxBuyIn", label: "Max Buy-in" },
            ...(canManageRake ? [{ key: "rakePercent", label: "Rake %" }, { key: "rakeCap", label: "Rake Cap" }] : []),
          ].map(({ key, label }) => (
            <div key={key}>
              <label className="text-xs text-muted-foreground block mb-1">{label}</label>
              <Input type="number" value={form[key as keyof typeof form]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </div>
          ))}
          <div className="col-span-3">
            <label className="text-xs text-muted-foreground block mb-1">Table Password (optional — leave blank for public)</label>
            <Input
              type="password"
              placeholder="Leave empty for open table"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div className="col-span-3">
            <label className="text-xs text-muted-foreground block mb-2">Table Theme</label>
            <div className="flex gap-3">
              {TABLE_THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setForm({ ...form, theme: t.id })}
                  className={`relative flex-1 rounded-xl overflow-hidden cursor-pointer transition-all border-2 ${
                    form.theme === t.id ? `border-white/50 ${t.ring} ring-2 scale-105` : "border-white/10 hover:border-white/30"
                  }`}
                  style={{ height: 110 }}
                >
                  <div className={`absolute inset-0 bg-gradient-to-b ${t.bg}`} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <span className="text-3xl drop-shadow-lg">{t.icon}</span>
                    <span className="text-white font-bold text-xs tracking-wide uppercase">{t.label}</span>
                    <span className="text-white/50 text-[10px]">{t.desc}</span>
                  </div>
                  {form.theme === t.id && (
                    <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-white flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-3">
            <Button type="submit" isLoading={createMutation.isPending} disabled={!form.name}>
              <Plus className="w-4 h-4 mr-2" /> Create Table
            </Button>
          </div>
        </form>
      </div>}

      <div className="space-y-3">
        {tables.map((table) => (
          <div key={table.id} className="bg-card border border-zinc-700 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-foreground">{table.name}</p>
                {(table as any).hasPassword && (
                  <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-900 text-amber-400">
                    <Lock className="w-2.5 h-2.5" /> Private
                  </span>
                )}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${table.status !== "closed" ? "bg-green-900 text-green-400" : "bg-red-900 text-red-400"}`}>
                  {table.status !== "closed" ? "Open" : "Closed"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Blinds: {table.smallBlind}/{table.bigBlind} · Buy-in: {table.minBuyIn}–{table.maxBuyIn} · Rake: {table.rakePercent}% (cap {table.rakeCap})
                · Seats: {table.seats.filter((s: any) => s.playerId).length}/8
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                {canKickSeat && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSeatKickId(seatKickId === table.id ? null : table.id)}
                    title="View seats / kick stuck players"
                    className={seatKickId === table.id ? "text-red-400" : ""}
                  >
                    <Users className="w-4 h-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setPwEditId(pwEditId === table.id ? null : table.id); setPwInput(""); setRakeEditId(null); }}
                  title={`${(table as any).hasPassword ? "Change/remove" : "Set"} room password`}
                >
                  <KeyRound className={`w-4 h-4 ${(table as any).hasPassword ? "text-amber-400" : ""}`} />
                </Button>
                {canManageRake && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { rakeEditId === table.id ? setRakeEditId(null) : openRakeEdit(table); setPwEditId(null); setBlindEditId(null); }}
                    title="Edit rake settings"
                  >
                    <Pencil className={`w-4 h-4 ${rakeEditId === table.id ? "text-primary" : ""}`} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  isLoading={blindLoading && blindEditId !== table.id}
                  onClick={() => { blindEditId === table.id ? setBlindEditId(null) : openBlindEdit(table.id); }}
                  title="Blind escalation settings"
                >
                  <Timer className={`w-4 h-4 ${blindEditId === table.id ? "text-primary" : (table as any).escalationEnabled ? "text-amber-400" : ""}`} />
                </Button>
                {canToggle && (
                  <button
                    onClick={() => handleToggleTable(table.id)}
                    disabled={togglingId === table.id}
                    title={table.status !== "closed" ? "Close table" : "Open table"}
                    className="flex items-center gap-2 disabled:opacity-50"
                  >
                    <span className={`text-xs font-bold ${table.status !== "closed" ? "text-green-400" : "text-muted-foreground"}`}>
                      {table.status !== "closed" ? "ON" : "OFF"}
                    </span>
                    <span className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors focus:outline-none ${table.status !== "closed" ? "bg-green-500" : "bg-zinc-800"}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-md transform transition-transform ${table.status !== "closed" ? "translate-x-5" : "translate-x-1"}`} />
                    </span>
                  </button>
                )}
                {canDelete && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmDelTableId(table.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
              {pwEditId === table.id && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
                  <Input
                    type="password"
                    value={pwInput}
                    onChange={(e) => setPwInput(e.target.value)}
                    placeholder={(table as any).hasPassword ? "New password (blank to remove)" : "Set room password"}
                    className="w-48 text-sm"
                    autoComplete="new-password"
                  />
                  <Button size="sm" onClick={() => handleSetTablePassword(table.id)} isLoading={pwSaving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setPwEditId(null); setPwInput(""); }}>Cancel</Button>
                </motion.div>
              )}
              {rakeEditId === table.id && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 flex-wrap justify-end">
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Rake %</label>
                    <Input type="number" step="0.5" min="0" value={rakeEditPct} onChange={(e) => setRakeEditPct(e.target.value)} className="w-20 text-sm" />
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Cap</label>
                    <Input type="number" min="0" value={rakeEditCap} onChange={(e) => setRakeEditCap(e.target.value)} className="w-24 text-sm" />
                  </div>
                  <Button size="sm" onClick={() => handleSaveRake(table.id)} isLoading={rakeSaving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRakeEditId(null)}>Cancel</Button>
                </motion.div>
              )}
              {blindEditId === table.id && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 w-full space-y-3 bg-black/30 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      <Timer className="w-4 h-4 text-amber-400" /> Blind Escalation
                    </p>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <span className="text-xs text-muted-foreground">{blindCfg.enabled ? "Enabled" : "Disabled"}</span>
                      <button
                        type="button"
                        onClick={() => setBlindCfg(prev => ({ ...prev, enabled: !prev.enabled }))}
                        className={`relative w-9 h-5 rounded-full transition-colors ${blindCfg.enabled ? "bg-amber-500" : "bg-white/10"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${blindCfg.enabled ? "translate-x-4" : ""}`} />
                      </button>
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Inactivity reset (s)</label>
                    <Input
                      type="number" min="0" step="5"
                      value={blindCfg.resetDelay}
                      onChange={e => setBlindCfg(prev => ({ ...prev, resetDelay: parseInt(e.target.value) || 0 }))}
                      className="w-24 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">sec with no players → reset to level 1</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Blind Levels</p>
                    <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-x-2 gap-y-1 items-center text-xs text-muted-foreground">
                      <span className="text-center">#</span>
                      <span>Small Blind</span>
                      <span>Big Blind</span>
                      <span>Duration (s)</span>
                      <span />
                    </div>
                    {blindCfg.levels.map((lvl, idx) => (
                      <div key={idx} className="grid grid-cols-[auto_1fr_1fr_1fr_auto] gap-x-2 gap-y-1 items-center">
                        <span className="text-xs text-muted-foreground text-center w-5">{idx + 1}</span>
                        <Input type="number" min="1" value={lvl.small} onChange={e => updateBlindLevel(idx, "small", e.target.value)} className="text-sm" />
                        <Input type="number" min="1" value={lvl.big} onChange={e => updateBlindLevel(idx, "big", e.target.value)} className="text-sm" />
                        <Input type="number" min="30" step="30" value={lvl.duration} onChange={e => updateBlindLevel(idx, "duration", e.target.value)} className="text-sm" />
                        <button type="button" onClick={() => removeBlindLevel(idx)} disabled={blindCfg.levels.length <= 1} className="text-red-400 hover:text-red-300 disabled:opacity-30 px-1">✕</button>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="ghost" onClick={addBlindLevel} className="text-xs">+ Add Level</Button>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button size="sm" onClick={() => handleSaveBlindConfig(table.id)} isLoading={blindSaving}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setBlindEditId(null)}>Cancel</Button>
                  </div>
                </motion.div>
              )}
              {seatKickId === table.id && (() => {
                const occupied = (table.seats as any[]).filter((s: any) => s.playerId);
                return (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                    className="w-72 mt-1 bg-black/40 border border-white/10 rounded-xl p-3 space-y-1.5">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Occupied Seats — click to force-remove
                    </p>
                    {occupied.length === 0 && (
                      <p className="text-xs text-white/30 italic">No players seated</p>
                    )}
                    {occupied.map((s: any) => (
                      <div key={s.seatIndex} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-white/70 truncate">
                          <span className="text-white/35 mr-1">#{s.seatIndex + 1}</span>
                          {s.playerName ?? `Player ${s.playerId}`}
                          <span className="text-white/35 ml-1">({(s.chips ?? 0).toLocaleString()} chips)</span>
                        </span>
                        <button
                          onClick={() => handleKickSeat(table.id, s.seatIndex)}
                          disabled={kickingSeats[`${table.id}-${s.seatIndex}`]}
                          className="text-[10px] font-bold text-red-400 hover:text-red-300 border border-red-700 hover:border-red-600 rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {kickingSeats[`${table.id}-${s.seatIndex}`] ? "…" : "Kick"}
                        </button>
                      </div>
                    ))}
                  </motion.div>
                );
              })()}
            </div>
          </div>
        ))}
        {tables.length === 0 && <div className="text-center py-12 text-muted-foreground">No tables yet.</div>}
      </div>

      {confirmDelTableId !== null && (
        <ConfirmModal
          message="Delete this table? Any players still seated will lose their table chips."
          confirmLabel="Delete Table"
          isLoading={deleteMutation.isPending}
          onConfirm={async () => {
            await deleteMutation.mutateAsync({ tableId: confirmDelTableId });
            setConfirmDelTableId(null);
          }}
          onCancel={() => setConfirmDelTableId(null)}
        />
      )}
      </>}
      {subTab === "blackjack" && <>
        {canCreate && (
          <div className="bg-card border border-zinc-700 rounded-2xl p-6">
            <h2 className="text-lg font-display font-semibold text-foreground mb-4">Create Blackjack Table</h2>
            <form onSubmit={handleBjCreate} className="grid grid-cols-2 grid-cols-3 gap-3">
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground block mb-1">Table Name</label>
                <Input placeholder='e.g. "High Roller BJ"' value={bjForm.name} onChange={e => setBjForm({ ...bjForm, name: e.target.value })} />
              </div>
              {[
                { key: "minBet", label: "Min Bet" },
                { key: "maxBet", label: "Max Bet" },
                { key: "numSeats", label: "Seats (1–7)" },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <Input type="number" min={key === "numSeats" ? 1 : 0} max={key === "numSeats" ? 7 : undefined}
                    step="1"
                    value={bjForm[key as keyof typeof bjForm]}
                    onChange={e => setBjForm({ ...bjForm, [key]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Theme</label>
                <select
                  value={bjForm.theme}
                  onChange={e => setBjForm({ ...bjForm, theme: e.target.value })}
                  className="w-full h-10 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-foreground"
                >
                  <option value="velvet">♠ Velvet (Classic)</option>
                  <option value="gold">👑 Gold (High Roller)</option>
                  <option value="diamond">💎 Diamond (VIP)</option>
                </select>
              </div>
              <div className="col-span-3">
                <label className="text-xs text-muted-foreground block mb-1">Password (optional — leave blank for public)</label>
                <Input type="password" placeholder="Leave empty for open table" value={bjForm.password} onChange={e => setBjForm({ ...bjForm, password: e.target.value })} autoComplete="new-password" />
              </div>
              <div className="col-span-3">
                <Button type="submit" isLoading={bjCreating} disabled={!bjForm.name}>
                  <Plus className="w-4 h-4 mr-2" /> Create Blackjack Table
                </Button>
              </div>
            </form>
          </div>
        )}

        <div className="space-y-3">
          {bjLoading && <div className="text-center py-8 text-muted-foreground">Loading tables…</div>}
          {!bjLoading && bjTables.map(t => (
            <div key={t.id} className="bg-card border border-zinc-700 rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-foreground">{t.name}</p>
                    {t.hasPassword && (
                      <span className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-full bg-amber-900 text-amber-400">
                        <Lock className="w-2.5 h-2.5" /> Private
                      </span>
                    )}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${t.isOpen ? "bg-green-900 text-green-400" : "bg-red-900 text-red-400"}`}>
                      {t.isOpen ? "Open" : "Closed"}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-800 text-muted-foreground capitalize">{t.theme}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Bets: {t.minBet?.toLocaleString()}–{t.maxBet?.toLocaleString()} chips · {t.numSeats} seats · {t.seatedCount ?? 0} seated · Phase: {t.phase ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setBjPwEditId(bjPwEditId === t.id ? null : t.id); setBjPwInput(""); }}
                    title={t.hasPassword ? "Change/remove password" : "Set password"}
                  >
                    <KeyRound className={`w-4 h-4 ${t.hasPassword ? "text-amber-400" : ""}`} />
                  </Button>
                  {canToggle && (
                    <button
                      onClick={() => handleBjToggle(t.id)}
                      disabled={bjTogglingId === t.id}
                      title={t.isOpen ? "Close table" : "Open table"}
                      className="flex items-center gap-2 disabled:opacity-50"
                    >
                      <span className={`text-xs font-bold ${t.isOpen ? "text-green-400" : "text-muted-foreground"}`}>{t.isOpen ? "ON" : "OFF"}</span>
                      <span className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${t.isOpen ? "bg-green-500" : "bg-zinc-800"}`}>
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-md transform transition-transform ${t.isOpen ? "translate-x-5" : "translate-x-1"}`} />
                      </span>
                    </button>
                  )}
                  {canDelete && (
                    <Button variant="destructive" size="sm" onClick={() => setBjConfirmDelId(t.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              {bjPwEditId === t.id && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="password"
                    value={bjPwInput}
                    onChange={e => setBjPwInput(e.target.value)}
                    placeholder={t.hasPassword ? "New password (leave blank to remove)" : "Set room password"}
                    className="w-56 text-sm"
                    autoComplete="new-password"
                  />
                  <Button size="sm" onClick={() => handleBjSetPassword(t.id, t.hasPassword)} isLoading={bjPwSaving}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setBjPwEditId(null); setBjPwInput(""); }}>Cancel</Button>
                </motion.div>
              )}
            </div>
          ))}
          {!bjLoading && bjTables.length === 0 && <div className="text-center py-12 text-muted-foreground">No blackjack tables yet.</div>}
        </div>

        <BlackjackHandHistory bjTables={bjTables} />

        {bjConfirmDelId !== null && (
          <ConfirmModal
            message="Delete this blackjack table? Players will be returned to their regular balance."
            confirmLabel="Delete Table"
            isLoading={bjDeletingId !== null}
            onConfirm={() => handleBjDelete(bjConfirmDelId!)}
            onCancel={() => setBjConfirmDelId(null)}
          />
        )}
      </>}

      {subTab === "horses" && <HorseRacingAdmin canManageHorses={tabHasRole("owner", "banker")} />}
      {subTab === "tournaments" && <TournamentsTab />}
      {subTab === "bingo" && <BingoTab hasRole={tabHasRole} />}
      {subTab === "lottery" && <LotteryTab />}
    </div>
  );
}

async function bankerApiFetch(path: string, opts?: RequestInit) {
  const { bankerToken, sessionToken } = useStore.getState();
  const authToken = bankerToken || sessionToken || "";
  return fetch(`${BASE_URL}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

function TournamentsTab() {
  const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
  const { data: tournRakeSettings, refetch: refetchTournRake } = useGetRakeSettings();
  const tournRakeMutation = useUpdateRakeSettings();
  const [tournamentsEnabled, setTournamentsEnabled] = useState(false);
  useEffect(() => {
    if (tournRakeSettings) setTournamentsEnabled(!!(tournRakeSettings as ExtendedRakeSettings).tournamentsEnabled);
  }, [tournRakeSettings]);
  async function toggleTournaments(v: boolean) {
    setTournamentsEnabled(v);
    try {
      await tournRakeMutation.mutateAsync({
        data: {
          pokerRakePercent: tournRakeSettings!.pokerRakePercent,
          pokerRakeCap: tournRakeSettings!.pokerRakeCap,
          tournamentsEnabled: v,
        } as any,
      });
      refetchTournRake();
    } catch (err: any) { showToast(err?.message || "Failed"); }
  }

  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editTournId, setEditTournId] = useState<number | null>(null);
  const [editTournForm, setEditTournForm] = useState({ name: "", description: "", addToPrizePool: "", buyIn: "", startingChips: "", maxPlayers: "", smallBlind: "", bigBlind: "", buyInPrizePercent: "" });
  const [editTournSaving, setEditTournSaving] = useState(false);
  const [editTournErr, setEditTournErr] = useState("");
  const [manualWinnerPicker, setManualWinnerPicker] = useState<Record<number, string>>({}); // tournId → selected playerId string
  const [form, setForm] = useState({
    type: "poker" as "poker" | "slots",
    name: "",
    description: "",
    buyIn: "",
    startingChips: "",
    maxPlayers: "200",
    smallBlind: "",
    bigBlind: "",
    minBet: "",
    maxBet: "",
    slotGame: "fortuna" as "fortuna" | "western",
    durationMinutes: "1440",
    basePrizePool: "0",
    buyInPrizePercent: "100",
    rebuysEnabled: false,
    maxRebuys: "1",
  });

  useEffect(() => {
    fetchTournaments();
    const iv = setInterval(fetchTournaments, 8000);
    return () => clearInterval(iv);
  }, []);

  async function fetchTournaments() {
    try {
      const res = await bankerApiFetch("/tournaments");
      if (res.ok) setTournaments(await res.json());
    } catch {}
    setLoading(false);
  }

  async function handleCreate() {
    if (!form.name || !form.buyIn || !form.startingChips) return;
    if (form.type === "poker" && (!form.smallBlind || !form.bigBlind)) return;
    if (form.type === "slots" && !form.minBet) return;
    setCreating(true);
    try {
      const body: Record<string, any> = {
        type: form.type,
        name: form.name,
        description: form.description || null,
        buyIn: parseInt(form.buyIn),
        startingChips: parseInt(form.startingChips),
        maxPlayers: parseInt(form.maxPlayers),
        basePrizePool: parseInt(form.basePrizePool) || 0,
        buyInPrizePercent: Math.min(100, Math.max(0, form.buyInPrizePercent === "" ? 100 : parseInt(form.buyInPrizePercent))),
      };
      if (form.type === "poker") {
        body.smallBlind = parseInt(form.smallBlind);
        body.bigBlind = parseInt(form.bigBlind);
        body.rebuysEnabled = form.rebuysEnabled;
        body.maxRebuys = parseInt(form.maxRebuys) || 1;
      } else {
        body.minBet = parseInt(form.minBet);
        body.maxBet = form.maxBet ? parseInt(form.maxBet) : undefined;
        body.durationMinutes = parseInt(form.durationMinutes) || 30;
        body.slotGame = form.slotGame;
      }
      const res = await bankerApiFetch("/tournaments", { method: "POST", body: JSON.stringify(body) });
      if (res.ok) {
        setForm({ type: "poker", name: "", description: "", buyIn: "", startingChips: "", maxPlayers: "200", smallBlind: "", bigBlind: "", minBet: "", maxBet: "", slotGame: "fortuna", durationMinutes: "1440", basePrizePool: "0", buyInPrizePercent: "100", rebuysEnabled: false, maxRebuys: "1" });
        setShowCreate(false);
        fetchTournaments();
      } else {
        const d = await res.json();
        showToast(d.error ?? "Failed to create tournament");
      }
    } catch {}
    setCreating(false);
  }

  async function handleStart(id: number) {
    try {
      const res = await bankerApiFetch(`/tournaments/${id}/start`, { method: "POST" });
      if (res.ok) fetchTournaments();
      else {
        const d = await res.json();
        showToast(d.error ?? "Failed to start tournament");
      }
    } catch {}
  }

  async function handleFinish(id: number) {
    try {
      const res = await bankerApiFetch(`/tournaments/${id}/finish`, { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        fetchTournaments();
        if (d.paidTo && d.prizePool > 0) {
          showToast(`Tournament finished! Winner: ${d.paidTo} — Prize: ${fmt(d.prizePool)} chips`, "success");
        } else if (d.paidTo) {
          showToast(`Tournament finished! Winner: ${d.paidTo}`, "success");
        } else {
          showToast("Tournament finished. No winner recorded.", "info");
        }
      } else {
        showToast(d.error ?? "Failed to finish tournament");
      }
    } catch {}
  }

  async function handlePayoutWinner(id: number, winnerName: string, prizePool: number, manualWinnerId?: string) {
    showConfirm(`Pay out ${fmt(prizePool)} chips to ${winnerName}? This credits their account and marks the tournament prize as awarded.`, async () => {
      try {
        const body: Record<string, any> = {};
        if (manualWinnerId) body.manualWinnerId = parseInt(manualWinnerId);
        const res = await bankerApiFetch(`/tournaments/${id}/payout-winner`, { method: "POST", body: JSON.stringify(body) });
        const d = await res.json();
        if (res.ok) {
          fetchTournaments();
          setManualWinnerPicker(prev => { const n = { ...prev }; delete n[id]; return n; });
          showToast(`Done! ${fmt(d.amount)} chips awarded to ${d.paidTo}.`, "success");
        } else {
          showToast(d.error ?? "Payout failed");
        }
      } catch {}
    });
  }

  async function handleConsolidate(id: number) {
    try {
      const res = await bankerApiFetch(`/tournaments/${id}/consolidate`, { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        fetchTournaments();
        if (d.finished) showToast("Tournament has ended — a winner has been determined.", "info");
        else if (d.merged > 0) showToast(`Consolidated ${d.merged} table(s) successfully.`, "success");
        else showToast("No tables needed consolidation right now.", "info");
      }
    } catch {}
  }

  async function handleDelete(id: number) {
    showConfirm("Delete this tournament? Registered players will be refunded.", async () => {
      try {
        const res = await bankerApiFetch(`/tournaments/${id}`, { method: "DELETE" });
        if (res.ok) fetchTournaments();
        else {
          const d = await res.json();
          showToast(d.error ?? "Cannot delete");
        }
      } catch {}
    });
  }

  function openEditTourn(t: any) {
    setEditTournId(t.id);
    setEditTournErr("");
    setEditTournForm({
      name: t.name,
      description: t.description ?? "",
      addToPrizePool: "",
      buyIn: String(t.buyIn),
      startingChips: String(t.startingChips),
      maxPlayers: String(t.maxPlayers),
      smallBlind: String(t.smallBlind),
      bigBlind: String(t.bigBlind),
      buyInPrizePercent: String(t.buyInPrizePercent),
    });
    // Make sure the row is expanded so the form is visible
    setExpandedId(t.id);
  }

  async function saveEditTourn(t: any) {
    setEditTournSaving(true);
    setEditTournErr("");
    try {
      const body: Record<string, any> = { name: editTournForm.name, description: editTournForm.description || null };
      if (editTournForm.addToPrizePool && parseInt(editTournForm.addToPrizePool) > 0) {
        body.addToPrizePool = parseInt(editTournForm.addToPrizePool);
      }
      if (t.status === "registering") {
        body.buyIn = parseInt(editTournForm.buyIn);
        body.startingChips = parseInt(editTournForm.startingChips);
        body.maxPlayers = parseInt(editTournForm.maxPlayers);
        body.smallBlind = parseInt(editTournForm.smallBlind);
        body.bigBlind = parseInt(editTournForm.bigBlind);
        body.buyInPrizePercent = parseInt(editTournForm.buyInPrizePercent);
      }
      const res = await bankerApiFetch(`/tournaments/${t.id}`, { method: "PATCH", body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setEditTournErr(d.error ?? "Failed to save."); setEditTournSaving(false); return; }
      setEditTournId(null);
      fetchTournaments();
    } catch { setEditTournErr("Network error."); }
    setEditTournSaving(false);
  }

  const [lockingTableId, setLockingTableId] = useState<number | null>(null);

  async function handleToggleLock(tableId: number) {
    setLockingTableId(tableId);
    try {
      const res = await bankerApiFetch(`/tables/${tableId}/lock`, { method: "PATCH" });
      if (res.ok) fetchTournaments();
    } catch {}
    setLockingTableId(null);
  }

  const statusColor = (s: string) =>
    s === "registering" ? "bg-green-900 text-green-400" :
    s === "running" ? "bg-yellow-900 text-yellow-400" :
    "bg-zinc-800 text-muted-foreground";

  const statusLabel = (s: string) =>
    s === "registering" ? "Open" : s === "running" ? "Running" : "Finished";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" /> Tournaments
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Create and manage poker tournaments with isolated tournament chips.</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex items-center gap-2 bg-card border border-zinc-700 rounded-xl px-3 py-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Show in lobby</span>
            <button
              onClick={() => toggleTournaments(!tournamentsEnabled)}
              disabled={tournRakeMutation.isPending}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${tournamentsEnabled ? "bg-green-500" : "bg-zinc-800"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${tournamentsEnabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </button>
          </div>
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            <Plus className="w-4 h-4 mr-1.5" /> New Tournament
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold text-foreground">Create Tournament</h3>

          {/* Type selector */}
          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Tournament Type *</label>
            <div className="flex gap-2">
              {[{ key: "poker", label: "♠️ Poker", desc: "Texas Hold'em tables" }, { key: "slots", label: "🎰 Slots", desc: "Score-based spinning" }].map(({ key, label, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm({ ...form, type: key as "poker" | "slots" })}
                  className={`flex-1 rounded-xl border p-3 text-left transition-colors ${form.type === key ? "border-red-800 bg-red-950 text-red-300" : "border-zinc-700 text-muted-foreground"}`}
                >
                  <div className="font-semibold text-sm">{label}</div>
                  <div className="text-xs mt-0.5 opacity-70">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Tournament Name *</label>
              <Input
                placeholder={form.type === "slots" ? "e.g. Slots Showdown #1" : "e.g. Friday Night Tourney"}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Description (optional)</label>
              <RichTextEditor
                value={form.description}
                onChange={(html) => setForm({ ...form, description: html })}
                placeholder="Tournament details, rules, prize structure…"
                minHeight={120}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Buy-in (regular chips) *</label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                value={form.buyIn}
                onChange={(e) => setForm({ ...form, buyIn: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {form.type === "slots" ? "Starting Tournament Chips *" : "Starting T-chips per player *"}
              </label>
              <Input
                type="number"
                placeholder={form.type === "slots" ? "e.g. 50000" : "e.g. 10000"}
                value={form.startingChips}
                onChange={(e) => setForm({ ...form, startingChips: e.target.value })}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Max Players</label>
              <Input
                type="number"
                placeholder="200"
                value={form.maxPlayers}
                onChange={(e) => setForm({ ...form, maxPlayers: e.target.value })}
              />
            </div>
            <div />

            {/* Poker-specific */}
            {form.type === "poker" && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Small Blind *</label>
                  <Input
                    type="number"
                    placeholder="e.g. 100"
                    value={form.smallBlind}
                    onChange={(e) => setForm({ ...form, smallBlind: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Big Blind *</label>
                  <Input
                    type="number"
                    placeholder="e.g. 200"
                    value={form.bigBlind}
                    onChange={(e) => setForm({ ...form, bigBlind: e.target.value })}
                  />
                </div>
              </>
            )}

            {/* Slots-specific */}
            {form.type === "slots" && (
              <>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-2 block">Slot Machine *</label>
                  <div className="flex gap-2">
                    {(["fortuna", "western"] as const).map((game) => (
                      <button
                        key={game}
                        type="button"
                        onClick={() => setForm(prev => ({ ...prev, slotGame: game }))}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                          form.slotGame === game
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-zinc-900 text-muted-foreground border-zinc-700 hover:bg-zinc-800"
                        }`}
                      >
                        {game === "fortuna" ? "Fortuna Slots" : "Deadwood (Western)"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Min Bet per Spin *</label>
                  <Input
                    type="number"
                    placeholder="e.g. 500"
                    value={form.minBet}
                    onChange={(e) => setForm({ ...form, minBet: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Recommended: 1–5% of starting chips</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Bet per Spin (optional)</label>
                  <Input
                    type="number"
                    placeholder={form.startingChips ? `e.g. ${Math.floor(parseInt(form.startingChips || "0") * 0.25)}` : "e.g. 12500"}
                    value={form.maxBet}
                    onChange={(e) => setForm({ ...form, maxBet: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground mt-1">Recommended: 20–30% of starting chips</p>
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground mb-1 block">Tournament Duration *</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "1 day",  value: String(1440) },
                      { label: "2 days", value: String(2880) },
                      { label: "3 days", value: String(4320) },
                      { label: "5 days", value: String(7200) },
                      { label: "7 days", value: String(10080) },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm({ ...form, durationMinutes: opt.value })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                          form.durationMinutes === opt.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-zinc-900 text-muted-foreground border-zinc-700 hover:bg-zinc-800"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      type="number"
                      min="1"
                      placeholder="Custom days"
                      value={[1440, 2880, 4320, 7200, 10080].includes(parseInt(form.durationMinutes)) ? "" : Math.round(parseInt(form.durationMinutes || "0") / 1440) || ""}
                      onChange={(e) => setForm({ ...form, durationMinutes: String(parseInt(e.target.value || "0") * 1440) })}
                      className="w-28 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">days custom</span>
                    <span className="text-xs text-muted-foreground/50">
                      {parseInt(form.durationMinutes) > 0 ? `(${(parseInt(form.durationMinutes) / 1440).toFixed(1)}d)` : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Tournament goes live immediately and ends after this time. Players can join any time during the window.</p>
                </div>
              </>
            )}

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Sponsor / Base Prize Pool</label>
              <Input
                type="number"
                placeholder="0"
                value={form.basePrizePool}
                onChange={(e) => setForm({ ...form, basePrizePool: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">Chips added by house/sponsors (never refunded)</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Buy-in → Prize Pool %</label>
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="100"
                value={form.buyInPrizePercent}
                onChange={(e) => setForm({ ...form, buyInPrizePercent: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">% of each buy-in that goes to prize pool</p>
            </div>
          </div>

          {/* Rebuys — poker only */}
          {form.type === "poker" && (
            <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Allow Rebuys</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Eliminated players can pay the buy-in again to re-enter</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, rebuysEnabled: !form.rebuysEnabled })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.rebuysEnabled ? "bg-primary" : "bg-zinc-800"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.rebuysEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              {form.rebuysEnabled && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Rebuys Per Player</label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="1"
                    value={form.maxRebuys}
                    onChange={(e) => setForm({ ...form, maxRebuys: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}

          {form.type === "slots" && (
            <div className="bg-amber-950 border border-amber-800 rounded-xl p-3 text-xs text-amber-400 space-y-1">
              <p className="font-semibold">Rolling-Entry Slots Tournament Rules</p>
              <p>• Goes live immediately — no registration wait</p>
              <p>• Players can join anytime while the tournament is running</p>
              <p>• Each spin deducts betAmount from tournament chips</p>
              <p>• Winnings add to score only — never back to chips</p>
              <p>• Winner = highest score when time expires</p>
              <p>• Tournament auto-ends when the timer runs out</p>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleCreate}
              isLoading={creating}
              disabled={
                !form.name || !form.buyIn || !form.startingChips ||
                (form.type === "poker" && (!form.smallBlind || !form.bigBlind)) ||
                (form.type === "slots" && !form.minBet)
              }
            >
              Create Tournament
            </Button>
          </div>
        </div>
      )}

      {/* Tournament list */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : tournaments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No tournaments yet. Create one above.
        </div>
      ) : (
        <div className="space-y-4">
          {tournaments.map((t) => {
            const expanded = expandedId === t.id;
            const activeEntries = (t.entries ?? []).filter((e: any) => e.status === "registered" || e.status === "active");
            const eliminated = (t.entries ?? []).filter((e: any) => e.status === "eliminated");
            return (
              <div key={t.id} className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
                <div
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-zinc-900 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                >
                  <div className="flex items-center gap-3">
                    <Trophy className="w-5 h-5 text-yellow-400" />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{t.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(t.status)}`}>
                          {statusLabel(t.status)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t.type === "slots" ? "🎰 Slots" : "♠️ Poker"} · Buy-in: {fmt(t.buyIn)} · Start: {fmt(t.startingChips)}
                        {t.type === "slots" ? ` · ${t.slotGame === "western" ? "Deadwood" : "Fortuna"} · Bet: ${t.minBet ?? "?"}-${t.maxBet ?? t.startingChips}` : ` · Blinds: ${t.smallBlind ?? "?"}/${t.bigBlind ?? "?"}`}
                        {` · ${activeEntries.length}/${t.maxPlayers ?? "?"} players · Prize: ${fmt(t.prizePool)}`}
                        {t.status === "running" && (t.tables ?? []).length > 0 && ` · ${(t.tables ?? []).length} active table${(t.tables ?? []).length > 1 ? "s" : ""}`}
                        {t.type === "slots" && t.endTime && t.status === "running" && (() => {
                          const remaining = Math.max(0, new Date(t.endTime).getTime() - Date.now());
                          const m = Math.floor(remaining / 60000);
                          const s = Math.floor((remaining % 60000) / 1000);
                          return remaining > 0 ? ` · ⏱ ${m}:${s.toString().padStart(2, "0")} left` : " · ⏰ Time up";
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.status === "registering" && (
                      <>
                        <Button size="sm" onClick={(e) => { e.stopPropagation(); handleStart(t.id); }}>
                          Start Tournament
                        </Button>
                      </>
                    )}
                    {t.status === "running" && (
                      <>
                        {(t.tables ?? []).length > 1 && (
                          <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); handleConsolidate(t.id); }}>
                            Consolidate Tables
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); handleFinish(t.id); }}>
                          Force Finish
                        </Button>
                      </>
                    )}
                    {/* Edit button — always available */}
                    <button
                      className={`transition-colors p-1.5 ${editTournId === t.id ? "text-amber-400" : "text-muted-foreground hover:text-foreground"}`}
                      title="Edit tournament"
                      onClick={(e) => { e.stopPropagation(); editTournId === t.id ? setEditTournId(null) : openEditTourn(t); }}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {t.status !== "running" && (
                      <button
                        className="text-destructive/70 hover:text-destructive transition-colors p-1.5"
                        onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-zinc-700 p-4 space-y-4">

                    {/* ── Inline Edit Form ─────────────────────────────── */}
                    {editTournId === t.id && (
                      <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4 space-y-4">
                        <p className="text-sm font-bold text-foreground">Edit Tournament</p>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                            <Input value={editTournForm.name} onChange={(e) => setEditTournForm({ ...editTournForm, name: e.target.value })} />
                          </div>
                          <div className="col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                            <RichTextEditor
                              value={editTournForm.description}
                              onChange={(html) => setEditTournForm({ ...editTournForm, description: html })}
                              placeholder="Tournament details, rules, prize structure…"
                              minHeight={120}
                            />
                          </div>

                          {/* Add to prize pool — available at any status */}
                          <div className="col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">
                              Add to Prize Pool <span className="text-amber-400">(sponsored chips — current: {fmt(t.prizePool)})</span>
                            </label>
                            <Input
                              type="number"
                              value={editTournForm.addToPrizePool}
                              onChange={(e) => setEditTournForm({ ...editTournForm, addToPrizePool: e.target.value })}
                              placeholder="e.g. 50000 — leave blank for no change"
                            />
                          </div>

                          {/* Structural fields — registering only */}
                          {t.status === "registering" && (
                            <>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Buy-in</label>
                                <Input type="number" value={editTournForm.buyIn} onChange={(e) => setEditTournForm({ ...editTournForm, buyIn: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Starting Chips</label>
                                <Input type="number" value={editTournForm.startingChips} onChange={(e) => setEditTournForm({ ...editTournForm, startingChips: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Max Players</label>
                                <Input type="number" value={editTournForm.maxPlayers} onChange={(e) => setEditTournForm({ ...editTournForm, maxPlayers: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Buy-in → Prize Pool %</label>
                                <Input type="number" value={editTournForm.buyInPrizePercent} onChange={(e) => setEditTournForm({ ...editTournForm, buyInPrizePercent: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Small Blind</label>
                                <Input type="number" value={editTournForm.smallBlind} onChange={(e) => setEditTournForm({ ...editTournForm, smallBlind: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Big Blind</label>
                                <Input type="number" value={editTournForm.bigBlind} onChange={(e) => setEditTournForm({ ...editTournForm, bigBlind: e.target.value })} />
                              </div>
                            </>
                          )}
                        </div>

                        {editTournErr && <p className="text-xs text-red-400">{editTournErr}</p>}

                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setEditTournId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => saveEditTourn(t)} isLoading={editTournSaving} disabled={editTournSaving || !editTournForm.name.trim()}>
                            Save Changes
                          </Button>
                        </div>
                      </div>
                    )}

                    {t.description && (
                      <div
                        className="rte-display text-sm text-muted-foreground"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.description) }}
                      />
                    )}
                    {t.status === "finished" && t.winnerName && (
                      <div className="flex items-center gap-2 bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2">
                        <Trophy className="w-4 h-4 text-yellow-400" />
                        <span className="text-yellow-400 font-semibold text-sm">Winner: {t.winnerName}</span>
                        {t.prizePool > 0 && !t.prizeAwarded && (
                          <Button
                            size="sm"
                            className="ml-auto bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-xs px-3"
                            onClick={(e) => { e.stopPropagation(); handlePayoutWinner(t.id, t.winnerName, t.prizePool); }}
                          >
                            Pay Out {fmt(t.prizePool)} chips
                          </Button>
                        )}
                        {t.prizeAwarded && (
                          <span className="ml-auto text-xs text-green-400 font-medium">✓ Prize paid</span>
                        )}
                      </div>
                    )}
                    {t.status === "finished" && !t.winnerName && t.prizePool > 0 && !t.prizeAwarded && (() => {
                      const eligibleEntries = (t.entries ?? []).filter((e: any) => e.status !== "registered");
                      const selectedId = manualWinnerPicker[t.id] ?? "";
                      const selectedEntry = eligibleEntries.find((e: any) => String(e.playerId) === selectedId);
                      return (
                        <div className="bg-amber-950 border border-amber-800 rounded-lg px-3 py-3 space-y-2">
                          <p className="text-amber-400 text-xs font-medium">No winner recorded — prize pool of {fmt(t.prizePool)} chips unpaid. Select the winner to pay out:</p>
                          <div className="flex items-center gap-2">
                            <select
                              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-foreground"
                              value={selectedId}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => { e.stopPropagation(); setManualWinnerPicker(prev => ({ ...prev, [t.id]: e.target.value })); }}
                            >
                              <option value="">— Select player —</option>
                              {eligibleEntries.map((e: any) => (
                                <option key={e.id} value={String(e.playerId)}>{e.playerName} ({e.status})</option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              className="bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 shrink-0"
                              disabled={!selectedId}
                              onClick={(e) => { e.stopPropagation(); if (selectedEntry) handlePayoutWinner(t.id, selectedEntry.playerName, t.prizePool, selectedId); }}
                            >
                              Pay Out {fmt(t.prizePool)}
                            </Button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Active tables for running tournaments */}
                    {t.status === "running" && (t.tables ?? []).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Active Tables</p>
                        <div className="space-y-1">
                          {(t.tables ?? []).map((table: any) => {
                            const activeSeats = (table.seats ?? []).filter((s: any) => s.playerId && (s.chips ?? 0) > 0);
                            const chipLeader = activeSeats.reduce((best: any, s: any) => (!best || s.chips > best.chips ? s : best), null);
                            const isLocked = !!table.locked;
                            const isLocking = lockingTableId === table.id;
                            return (
                              <div key={table.id} className="flex items-center justify-between text-sm py-2 border-b border-zinc-700 last:border-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-foreground font-medium">{table.name}</span>
                                  {isLocked && (
                                    <span className="flex items-center gap-0.5 text-xs text-red-400 bg-red-950 px-1.5 py-0.5 rounded-full">
                                      <Lock className="w-2.5 h-2.5" /> Locked
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-muted-foreground text-xs">
                                    {activeSeats.length} players
                                    {chipLeader && ` · Leader: ${chipLeader.playerName} (${chipLeader.chips?.toLocaleString()})`}
                                  </span>
                                  <a
                                    href={`${BASE_URL}/table/${table.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors px-2 py-0.5 rounded-lg bg-primary/10 hover:bg-primary/20"
                                    onClick={(e) => e.stopPropagation()}
                                    title="Open poker room"
                                  >
                                    <ExternalLink className="w-3 h-3" /> View Room
                                  </a>
                                  <button
                                    className={`p-1 rounded transition-colors ${isLocked ? "text-red-400 hover:text-red-300" : "text-muted-foreground hover:text-foreground"}`}
                                    onClick={(e) => { e.stopPropagation(); handleToggleLock(table.id); }}
                                    disabled={isLocking}
                                    title={isLocked ? "Unlock table" : "Lock table (prevent new joins)"}
                                  >
                                    {isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Players list */}
                    {t.entries?.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No registrations yet.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Players</p>
                        {(t.entries ?? [])
                          .slice()
                          .sort((a: any, b: any) => {
                            const order: Record<string, number> = { winner: 0, active: 1, registered: 2, eliminated: 3 };
                            const statusDiff = (order[a.status] ?? 9) - (order[b.status] ?? 9);
                            if (statusDiff !== 0) return statusDiff;
                            // For slots: rank by score. For poker: rank by chips.
                            if (t.type === "slots") return (b.score ?? 0) - (a.score ?? 0);
                            return (b.tournamentChips ?? 0) - (a.tournamentChips ?? 0);
                          })
                          .map((entry: any) => (
                            <div key={entry.id} className="flex items-center justify-between text-sm py-1 border-b border-zinc-700 last:border-0">
                              <div className="flex items-center gap-2">
                                <div className={`w-1.5 h-1.5 rounded-full ${
                                  entry.status === "winner" ? "bg-yellow-400" :
                                  entry.status === "active" ? "bg-green-400" :
                                  entry.status === "registered" ? "bg-blue-400" :
                                  "bg-zinc-600"
                                }`} />
                                <span className={entry.status === "eliminated" ? "text-muted-foreground" : "text-foreground"}>
                                  {entry.playerName}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-xs font-mono">
                                {entry.status === "active" || entry.status === "winner"
                                  ? t.type === "slots"
                                    ? <span className="text-yellow-400">★ {(entry.score ?? 0).toLocaleString()}</span>
                                    : `${(entry.tournamentChips ?? 0).toLocaleString()} T-chips`
                                  : entry.status === "registered"
                                  ? "Registered"
                                  : t.type === "slots"
                                  ? <span className="text-zinc-600">Done · ★ {(entry.score ?? 0).toLocaleString()}</span>
                                  : "Eliminated"}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GameCard({
  accentColor, icon, title, subtitle, enabled, onToggle, toggling, hasPassword, betRange, settingsContent,
}: {
  accentColor: string; icon: string; title: string; subtitle: string; enabled: boolean;
  onToggle: (v: boolean) => void; toggling: boolean; hasPassword?: boolean; betRange?: string; settingsContent?: React.ReactNode;
  gradient?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "rgba(10,10,14,0.98)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* ── Header row ── */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="text-lg w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 select-none"
          style={{ background: `${accentColor}1a`, border: `1px solid ${accentColor}33` }}
        >{icon}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 leading-none">
            <span className="text-xs font-bold text-white uppercase tracking-wide">{title}</span>
            {hasPassword && enabled && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded" style={{ background: "rgba(251,191,36,0.15)", color: "#f59e0b" }}>🔒</span>
            )}
          </div>
          {betRange && (
            <span className="text-[10px] font-mono" style={{ color: enabled ? "rgba(251,191,36,0.7)" : "rgba(255,255,255,0.22)" }}>{betRange}</span>
          )}
        </div>

        {/* Toggle */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[9px] font-bold tracking-wider" style={{ color: enabled ? "#22c55e" : "rgba(255,255,255,0.28)" }}>
            {toggling ? "…" : enabled ? "OPEN" : "CLOSED"}
          </span>
          <button
            onClick={() => onToggle(!enabled)}
            disabled={toggling}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-all focus:outline-none flex-shrink-0"
            style={{
              background: enabled ? "#22c55e" : "rgba(255,255,255,0.12)",
              opacity: toggling ? 0.5 : 1,
            }}
          >
            <span
              className="inline-block rounded-full bg-white transition-transform"
              style={{ width: 14, height: 14, transform: enabled ? "translateX(19px)" : "translateX(2px)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }}
            />
          </button>
          {settingsContent && (
            <button
              onClick={() => setOpen(o => !o)}
              className="w-6 h-6 flex items-center justify-center rounded transition-colors"
              style={{ color: open ? "#fff" : "rgba(255,255,255,0.3)", background: open ? "rgba(255,255,255,0.1)" : "transparent" }}
              title="Settings"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded settings ── */}
      {open && settingsContent && (
        <div className="px-3 pb-3 pt-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="pt-2">
            {settingsContent}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Prizes Management Panel (inside GamesTab) ─────────────────────────────────
function PrizesManagementPanel({ isOwner = false, staffUsername = "staff" }: { isOwner?: boolean; staffUsername?: string }) {
  const { bankerToken, sessionToken } = useStore();
  const authToken = bankerToken || sessionToken || "";
  const [subTab, setSubTab] = useState<"items" | "cases" | "stats" | "rewards">("items");
  const [allStats, setAllStats] = useState<{ cases: any[]; totals: any } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Cases ──
  const [cases, setCases] = useState<any[]>([]);
  const [caseMsg, setCaseMsg] = useState<string | null>(null);
  const [expandedCaseId, setExpandedCaseId] = useState<number | null>(null);
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [caseForm, setCaseForm] = useState({ name: "", emoji: "📦", description: "", price: "0", price_gems: "0", currency: "chips", image_url: "", tier_common: "7992", tier_rare: "1598", tier_epic: "320", tier_legendary: "64", tier_jackpot: "26" });
  const [caseImageUploading, setCaseImageUploading] = useState(false);
  const [editCaseId, setEditCaseId] = useState<number | null>(null);
  const [caseDetail, setCaseDetail] = useState<Record<number, any>>({});
  const [addItemCaseId, setAddItemCaseId] = useState<number | null>(null);
  const [addItemForm, setAddItemForm] = useState({ prize_item_id: "", tier: "common" });
  const [caseStats, setCaseStats] = useState<Record<number, any>>({});

  // ── Items ──
  const [items, setItems] = useState<any[]>([]);
  const [itemForm, setItemForm] = useState({ name: "", emoji: "🎁", description: "", category: "misc", type: "item", value: "", stock: "", image_url: "" });
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [itemMsg, setItemMsg] = useState<string | null>(null);
  const [prizeImageUploading, setPrizeImageUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [itemSort, setItemSort] = useState<"name-asc" | "name-desc" | "type" | "category" | "stock-low" | "value-high">("name-asc");
  const [itemTypeFilter, setItemTypeFilter] = useState<string>("all");
  const [itemGroupByCategory, setItemGroupByCategory] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [caseItemSearch, setCaseItemSearch] = useState("");
  const EMOJI_GROUPS = [
    { label: "Vehicles", emojis: ["🚗","🚙","🏎️","🛻","🚕","🚐","🚌","🚑","🚒","🏍️","🛵","🚲","🛺","🚁","✈️","⛵","🚤","🛥️","🛩️","🚂"] },
    { label: "Money & Chips", emojis: ["🪙","💰","💵","💴","💶","💷","💸","💳","🏦","💎","👑","🏅","🥇","🎖️","⭐","🌟","✨","🤑","💹","🏧"] },
    { label: "Prizes & Gifts", emojis: ["🎁","🎀","🎊","🎉","🎈","🎯","🏆","🥈","🥉","🎟️","🎪","🎠","🎡","🎢","🔑","🗝️","📦","🧧","🎗️","🪄"] },
    { label: "Luxury", emojis: ["💍","👜","👛","🕶️","⌚","💄","👠","🥂","🍾","🍷","🍸","🎩","🪭","🛍️","🏡","🏠","🛋️","🪞","🛁","🛏️"] },
    { label: "Weapons & Parts", emojis: ["🔫","🗡️","⚔️","🛡️","🔧","🔩","⚙️","🪛","🪝","🪜","🧲","🔋","💡","🔦","🪓","🔨","⛏️","🪚","🧱","📡"] },
    { label: "Food & Vices", emojis: ["🍕","🍔","🌮","🌯","🍜","🍣","🎂","🍦","☕","🧋","🍺","🍻","🥃","🚬","🎰","🃏","🎲","🎮","🕹️","🎸"] },
    { label: "Nature & Animals", emojis: ["🐎","🦁","🐆","🦅","🐊","🐍","🦊","🐺","🌵","🌴","🌊","🔥","⚡","❄️","🌈","☀️","🌙","🪐","💫","🌺"] },
  ] as const;

  useEffect(() => {
    if (!showEmojiPicker) return;
    function handleOutside(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showEmojiPicker]);

  async function loadItems() {
    try {
      const r = await fetch(`${BASE_URL}/api/prizes/items`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      setItems(Array.isArray(d) ? d : []);
    } catch { setItems([]); }
  }
  useEffect(() => { loadItems(); }, [authToken]);

  async function saveItem(e: React.FormEvent) {
    e.preventDefault();
    const method = editItemId ? "PUT" : "POST";
    const url = editItemId ? `${BASE_URL}/api/prizes/items/${editItemId}` : `${BASE_URL}/api/prizes/items`;
    const r = await fetch(url, { method, headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify(itemForm) });
    const d = await r.json();
    if (d.error) { setItemMsg("Error: " + d.error); return; }
    setItemMsg(editItemId ? "Item updated" : "Item added");
    setItemForm({ name: "", emoji: "🎁", description: "", category: "misc", type: "item", value: "", stock: "", image_url: "" });
    setEditItemId(null);
    loadItems();
  }

  async function deleteItem(id: number) {
    showConfirm("Delete this item?", async () => {
      await fetch(`${BASE_URL}/api/prizes/items/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      loadItems();
    });
  }

  // ── Cases functions ──
  async function loadCases() {
    try {
      const r = await fetch(`${BASE_URL}/api/cases`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      // API returns { gameEnabled, cases: [...] }
      setCases(Array.isArray(d.cases) ? d.cases : Array.isArray(d) ? d : []);
    } catch { setCases([]); }
  }
  useEffect(() => { if (subTab === "cases") loadCases(); }, [subTab, authToken]);

  async function loadAllStats() {
    setStatsLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/cases/stats/all`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      setAllStats(d.error ? null : d);
    } catch { setAllStats(null); }
    finally { setStatsLoading(false); }
  }
  useEffect(() => { if (subTab === "stats") loadAllStats(); }, [subTab, authToken]);

  async function loadCaseItems(caseId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/cases/${caseId}`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      setCaseDetail(prev => ({ ...prev, [caseId]: d.items ?? [] }));
    } catch {}
  }

  async function loadCaseStats(caseId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/cases/${caseId}/stats`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      setCaseStats(prev => ({ ...prev, [caseId]: d }));
    } catch {}
  }

  async function saveCase(e: React.FormEvent) {
    e.preventDefault();
    setCaseMsg(null);
    const method = editCaseId ? "PUT" : "POST";
    const url = editCaseId ? `${BASE_URL}/api/cases/${editCaseId}` : `${BASE_URL}/api/cases`;
    try {
      const payload = {
        ...caseForm,
        price: caseForm.currency === "chips" ? caseForm.price : "0",
        price_gems: caseForm.currency === "gems" ? caseForm.price : "0",
      };
      const r = await fetch(url, { method, headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (d.error) { setCaseMsg("Error: " + d.error); return; }
      setCaseMsg(editCaseId ? "Case updated" : "Case created!");
      setCaseForm({ name: "", emoji: "📦", description: "", price: "0", price_gems: "0", currency: "chips", tier_common: "7992", tier_rare: "1598", tier_epic: "320", tier_legendary: "64", tier_jackpot: "26" });
      setEditCaseId(null);
      setShowCreateCase(false);
      loadCases();
    } catch { setCaseMsg("Network error"); }
  }

  async function toggleCaseEnabled(id: number, enabled: boolean) {
    await fetch(`${BASE_URL}/api/cases/${id}`, { method: "PUT", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    loadCases();
  }

  async function deleteCase(id: number) {
    showConfirm("Delete this case? All item assignments will be removed.", async () => {
      await fetch(`${BASE_URL}/api/cases/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      loadCases();
    });
  }

  async function addItemToCase(e: React.FormEvent) {
    e.preventDefault();
    if (!addItemCaseId || !addItemForm.prize_item_id) return;
    try {
      const r = await fetch(`${BASE_URL}/api/cases/${addItemCaseId}/items`, { method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify(addItemForm) });
      const d = await r.json();
      if (d.error) { setCaseMsg("Error: " + d.error); return; }
      setAddItemForm({ prize_item_id: "", tier: "common" });
      setAddItemCaseId(null);
      loadCaseItems(addItemCaseId);
    } catch {}
  }

  async function removeItemFromCase(caseId: number, itemId: number) {
    await fetch(`${BASE_URL}/api/cases/${caseId}/items/${itemId}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
    loadCaseItems(caseId);
  }

  async function updateItemTierInCase(caseId: number, itemId: number, tier: string) {
    await fetch(`${BASE_URL}/api/cases/${caseId}/items/${itemId}`, { method: "PATCH", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ tier }) });
    loadCaseItems(caseId);
  }

  function startEditCase(c: any) {
    setEditCaseId(c.id);
    const isGem = Number(c.price_gems) > 0;
    setCaseForm({ name: c.name, emoji: c.emoji || "📦", description: c.description || "", price: isGem ? String(c.price_gems ?? 0) : String(c.price ?? 0), price_gems: String(c.price_gems ?? 0), currency: isGem ? "gems" : "chips", image_url: c.image_url || "", tier_common: String(c.tier_common ?? 7992), tier_rare: String(c.tier_rare ?? 1598), tier_epic: String(c.tier_epic ?? 320), tier_legendary: String(c.tier_legendary ?? 64), tier_jackpot: String(c.tier_jackpot ?? 26) });
    setShowCreateCase(true);
  }

  async function uploadCaseImage(file: File) {
    setCaseImageUploading(true);
    setCaseMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/api/cases/upload-image`, {
        method: "POST",
        headers: { "Content-Type": file.type, Authorization: `Bearer ${authToken}` },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { image_url } = await res.json();
      setCaseForm(p => ({ ...p, image_url }));
      setCaseMsg("Image uploaded ✓");
    } catch {
      setCaseMsg("Error: image upload failed");
    } finally {
      setCaseImageUploading(false);
    }
  }

  async function uploadPrizeImage(file: File) {
    setPrizeImageUploading(true);
    setItemMsg(null);
    try {
      const res = await fetch(`${BASE_URL}/api/prizes/items/upload-image`, {
        method: "POST",
        headers: { "Content-Type": file.type, Authorization: `Bearer ${authToken}` },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { image_url } = await res.json();
      setItemForm(p => ({ ...p, image_url }));
      setItemMsg("Image uploaded ✓");
    } catch {
      setItemMsg("Error: image upload failed");
    } finally {
      setPrizeImageUploading(false);
    }
  }

  const TIER_COLORS: Record<string, string> = { common: "#9ca3af", rare: "#3b82f6", epic: "#a855f7", legendary: "#f59e0b", jackpot: "#ef4444" };
  const TIER_LABELS: Record<string, string> = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", jackpot: "Jackpot" };

  const inCls = "w-full text-xs bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-foreground focus:outline-none focus:border-primary/50";
  const labelCls = "text-xs text-muted-foreground block mb-1";

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-zinc-700 pb-3">
        {[{ key: "items", label: "📦 Item Inventory" }, { key: "cases", label: "🎁 Case System" }, { key: "stats", label: "📊 Case Stats" }, { key: "rewards", label: "🏆 Rewards" }].map(({ key, label }) => (
          <button key={key} onClick={() => setSubTab(key as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${subTab === key ? "bg-violet-600 text-white border-violet-500" : "bg-card text-muted-foreground border-zinc-700 hover:border-foreground/30"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Items ── */}
      {subTab === "items" && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">Items are physical prizes that players can win from the Case Opening system. Staff must deliver them in-game.</p>

          {/* Item list */}
          {(() => {
            const typeColors: Record<string, string> = {
              vehicle: "bg-blue-950 border-blue-800 text-blue-400",
              chips:   "bg-yellow-950 border-yellow-800 text-yellow-400",
              bet:     "bg-cyan-950 border-cyan-800 text-cyan-400",
              cash:    "bg-green-950 border-green-800 text-green-400",
              gems:    "bg-purple-950 border-purple-800 text-purple-400",
              item:    "bg-zinc-800 border-zinc-700 text-muted-foreground",
            };
            const typeEmojis: Record<string, string> = { vehicle: "🚗", chips: "🪙", bet: "◈", cash: "💵", gems: "💎", item: "📦" };
            const TYPE_OPTS = ["all","vehicle","chips","bet","gems","cash","item"] as const;

            // Filter + sort
            let filtered = [...items];
            if (itemSearch.trim()) {
              const q = itemSearch.toLowerCase();
              filtered = filtered.filter((it: any) =>
                it.name.toLowerCase().includes(q) ||
                (it.description ?? "").toLowerCase().includes(q) ||
                (it.category ?? "").toLowerCase().includes(q)
              );
            }
            if (itemTypeFilter !== "all") filtered = filtered.filter((it: any) => (it.type ?? "item") === itemTypeFilter);
            filtered.sort((a: any, b: any) => {
              if (itemSort === "name-asc")    return (a.name ?? "").localeCompare(b.name ?? "");
              if (itemSort === "name-desc")   return (b.name ?? "").localeCompare(a.name ?? "");
              if (itemSort === "type")        return (a.type ?? "").localeCompare(b.type ?? "");
              if (itemSort === "category")    return (a.category ?? "misc").localeCompare(b.category ?? "misc");
              if (itemSort === "stock-low")   return (a.stock ?? 9999) - (b.stock ?? 9999);
              if (itemSort === "value-high")  return (b.value ?? 0) - (a.value ?? 0);
              return 0;
            });

            // Group by category if toggle is on
            const groups: Array<[string, any[]]> | null = itemGroupByCategory
              ? Object.entries(filtered.reduce((acc: Record<string, any[]>, it: any) => {
                  const cat = it.category || "misc";
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(it);
                  return acc;
                }, {})).sort(([a], [b]) => a.localeCompare(b))
              : null;

            function renderRow(item: any, i: number, arr: any[]) {
              const itemType = item.type ?? "item";
              const typeColor = typeColors[itemType] ?? typeColors.item;
              const hasValue = item.value != null && item.value > 0;
              return (
                <div key={item.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-zinc-700" : ""} hover:bg-zinc-900 transition-colors`}>
                  <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center text-lg shrink-0 overflow-hidden">
                    {item.image_url ? <img src={`${BASE_URL}/api/uploads${item.image_url}`} alt={item.name} className="w-full h-full object-contain" /> : <span>{item.emoji || "🎁"}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.category && item.category !== "misc" && <span className="text-violet-400 mr-1">[{item.category}]</span>}
                      {item.description || <span className="italic opacity-50">No description</span>}
                      {hasValue && <span className="ml-1.5 font-semibold text-foreground">· {itemType === "bet" ? `${Number(item.value).toLocaleString()} BET` : itemType === "cash" ? `$${Number(item.value).toLocaleString()}` : itemType === "gems" ? `${Number(item.value).toLocaleString()} Gems` : `${Number(item.value).toLocaleString()} chips`}</span>}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize shrink-0 ${typeColor}`}>{typeEmojis[itemType] ?? "📦"} {itemType}</span>
                  {item.stock != null ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${Number(item.stock) === 0 ? "bg-red-950 border-red-800 text-red-400" : Number(item.stock) <= 3 ? "bg-orange-950 border-orange-800 text-orange-400" : "bg-emerald-950 border-emerald-800 text-emerald-400"}`}>
                      {Number(item.stock) === 0 ? "OUT" : `${item.stock} stk`}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 bg-zinc-800 border-zinc-700 text-muted-foreground/60">∞</span>
                  )}
                  {isOwner && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditItemId(item.id); setItemForm({ name: item.name, emoji: item.emoji, description: item.description ?? "", category: item.category, type: item.type ?? "item", value: item.value != null ? String(item.value) : "", stock: item.stock != null ? String(item.stock) : "", image_url: item.image_url ?? "" }); }}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-zinc-900 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteItem(item.id)} className="p-1.5 rounded-lg text-red-400 hover:text-red-400 hover:bg-red-950 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div className="bg-card border border-zinc-700 rounded-xl overflow-hidden">
                {/* Header + controls */}
                <div className="px-4 py-3 border-b border-zinc-700 bg-zinc-900 space-y-2">
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="text" placeholder="Search by name, tag, description…"
                      value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                      className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 outline-none min-w-0"
                    />
                    <select value={itemSort} onChange={e => setItemSort(e.target.value as any)}
                      className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-muted-foreground shrink-0 outline-none">
                      <option value="name-asc">A → Z</option>
                      <option value="name-desc">Z → A</option>
                      <option value="category">By category</option>
                      <option value="type">By type</option>
                      <option value="stock-low">Stock: low first</option>
                      <option value="value-high">Value: high first</option>
                    </select>
                    <button
                      onClick={() => setItemGroupByCategory(g => !g)}
                      title="Group by category"
                      className={`px-2 py-1 rounded-lg text-xs font-semibold border transition-colors shrink-0 ${itemGroupByCategory ? "bg-violet-950 border-violet-600 text-violet-300" : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:border-foreground/30"}`}
                    >
                      📁 {itemGroupByCategory ? "Grouped" : "Group"}
                    </button>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {TYPE_OPTS.map(t => (
                      <button key={t} onClick={() => setItemTypeFilter(t)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors ${itemTypeFilter === t ? "bg-violet-600 border-violet-500 text-white" : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:border-foreground/30"}`}>
                        {t === "all" ? `All (${items.length})` : `${typeEmojis[t] ?? "📦"} ${t}`}
                      </button>
                    ))}
                  </div>
                </div>

                {filtered.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {items.length === 0 ? "No items yet. Add some below." : "No items match your search."}
                  </div>
                )}

                {groups ? (
                  /* Grouped by category */
                  groups.map(([cat, catItems]) => {
                    const isCollapsed = collapsedCategories.has(cat);
                    return (
                      <div key={cat} className="border-t border-zinc-700 first:border-t-0">
                        <button
                          onClick={() => setCollapsedCategories(prev => {
                            const next = new Set(prev);
                            if (next.has(cat)) next.delete(cat); else next.add(cat);
                            return next;
                          })}
                          className="w-full flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-900 transition-colors text-left"
                        >
                          <span className="text-sm">{isCollapsed ? "▶" : "▼"}</span>
                          <span className="text-xs font-bold text-violet-300 uppercase tracking-wider">{cat}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{catItems.length} item{catItems.length !== 1 ? "s" : ""}</span>
                        </button>
                        {!isCollapsed && catItems.map((item, i, arr) => renderRow(item, i, arr))}
                      </div>
                    );
                  })
                ) : (
                  /* Flat list */
                  filtered.map((item, i, arr) => renderRow(item, i, arr))
                )}
              </div>
            );
          })()}

          {/* Add / Edit form */}
          <form onSubmit={saveItem} className="bg-card border border-zinc-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground">{editItemId ? "Edit Item" : "Add New Item"}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Prize Type *</label>
                <select className={inCls} value={itemForm.type} onChange={e => setItemForm(f => ({ ...f, type: e.target.value }))}>
                  <option value="vehicle">🚗 Vehicle</option>
                  <option value="chips">🪙 Chips</option>
                  <option value="bet">◈ BET Currency</option>
                  <option value="gems">💎 Gems</option>
                  <option value="cash">💵 Cash (in-game $)</option>
                  <option value="item">📦 Item / Random Prize</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Name *</label>
                <input required className={inCls} value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder={itemForm.type === "vehicle" ? "e.g. Hellcat R" : itemForm.type === "chips" ? "e.g. 5,000 Chips" : itemForm.type === "bet" ? "e.g. 100 BET" : "e.g. Mystery Box"} />
              </div>
              <div>
                <label className={labelCls}>
                  {itemForm.type === "chips" ? "Amount (chips) *" : itemForm.type === "bet" ? "Amount (BET) *" : itemForm.type === "cash" ? "Amount ($) *" : itemForm.type === "gems" ? "Amount (Gems) *" : "House value (chips) *"}
                </label>
                <input type="number" min="1" className={inCls} value={itemForm.value} onChange={e => setItemForm(f => ({ ...f, value: e.target.value }))}
                  placeholder={itemForm.type === "bet" ? "e.g. 100" : itemForm.type === "cash" ? "e.g. 5000" : itemForm.type === "chips" ? "e.g. 2500" : itemForm.type === "gems" ? "e.g. 50" : "e.g. 10000"} />
                {(itemForm.type === "vehicle" || itemForm.type === "item") && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Used by Auto Balance to set rarity. Enter the chip equivalent of this prize.</p>
                )}
              </div>
              <div>
                <label className={labelCls}>Stock (leave blank = unlimited)</label>
                <input type="number" min="0" className={inCls} value={itemForm.stock} onChange={e => setItemForm(f => ({ ...f, stock: e.target.value }))} placeholder="e.g. 5" />
              </div>
              {/* BET reservation indicator — only when type=bet with value & stock */}
              {itemForm.type === "bet" && itemForm.value && itemForm.stock && Number(itemForm.stock) > 0 && (() => {
                const willReserve = Number(itemForm.value) * Number(itemForm.stock);
                const currentAvail = houseBet ? Number(houseBet.available_balance) : null;
                // For edits, subtract the old reservation so we only show the NET change
                const editingItem = editItemId ? items.find((p: any) => p.id === editItemId) : null;
                const oldReserve = editingItem?.type === "bet" && editingItem?.value != null && editingItem?.stock != null
                  ? Number(editingItem.value) * Number(editingItem.stock) : 0;
                const netChange = willReserve - oldReserve;
                const afterAvail = currentAvail != null ? currentAvail - netChange : null;
                const overBudget = afterAvail != null && afterAvail < 0;
                return (
                  <div className={`col-span-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${overBudget ? "bg-red-950 border border-red-600 text-red-300" : "bg-cyan-950 border border-cyan-700 text-cyan-200"}`}>
                    <span className="text-base leading-none mt-0.5">{overBudget ? "⚠️" : "◈"}</span>
                    <div className="space-y-0.5">
                      <p className="font-semibold">{overBudget ? "Insufficient BET balance" : "BET reservation"}</p>
                      <p>Will lock <span className="font-bold">{willReserve.toLocaleString()} BET</span> from house inventory ({Number(itemForm.stock)} × {Number(itemForm.value)} BET)</p>
                      {currentAvail != null && (
                        <p>After saving: <span className={`font-bold ${overBudget ? "text-red-400" : "text-cyan-300"}`}>{afterAvail!.toLocaleString()} BET available</span>{overBudget ? " — top up house BET before saving" : ""}</p>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div ref={emojiPickerRef} className="relative">
                <label className={labelCls}>Emoji</label>
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(p => !p)}
                  className="w-full flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm hover:border-primary/40 transition-colors"
                >
                  <span className="text-xl leading-none">{itemForm.emoji || "🎁"}</span>
                  <span className="text-muted-foreground text-xs flex-1 text-left">Choose emoji…</span>
                  <span className="text-muted-foreground text-xs">▾</span>
                </button>
                {showEmojiPicker && (
                  <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-zinc-700 rounded-xl shadow-2xl w-72 overflow-hidden">
                    <div className="max-h-72 overflow-y-auto p-2 space-y-2">
                      {EMOJI_GROUPS.map(group => (
                        <div key={group.label}>
                          <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest px-1 pb-1">{group.label}</p>
                          <div className="grid grid-cols-10 gap-0.5">
                            {group.emojis.map(em => (
                              <button
                                key={em}
                                type="button"
                                onClick={() => { setItemForm(f => ({ ...f, emoji: em })); setShowEmojiPicker(false); }}
                                className={`text-lg p-1 rounded hover:bg-zinc-900 transition-colors leading-none ${itemForm.emoji === em ? "bg-primary/20 ring-1 ring-primary/40" : ""}`}
                                title={em}
                              >
                                {em}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Category / Folder</label>
                <input list="item-categories" className={inCls} value={itemForm.category} onChange={e => setItemForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. muscle cars, luxury…" />
                <datalist id="item-categories">
                  {Array.from(new Set(items.map((it: any) => it.category).filter(Boolean))).sort().map((cat: any) => (
                    <option key={cat} value={cat} />
                  ))}
                  {["vehicles","luxury cars","muscle cars","supercars","motorcycles","weapons","clothing","jewellery","properties","chips","cash","misc"].map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className={labelCls}>Description</label>
                <input className={inCls} value={itemForm.description} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} placeholder="Short note for staff" />
              </div>
              {/* Prize Image Upload */}
              <div>
                <label className={labelCls}>Prize Image (optional — replaces emoji in spin reel)</label>
                <div className="flex items-center gap-3">
                  {itemForm.image_url && (
                    <div className="relative shrink-0">
                      <img src={`${BASE_URL}/api/uploads${itemForm.image_url}`} alt="" className="w-16 h-16 object-contain rounded-lg border border-zinc-700 bg-zinc-800" />
                      <button type="button" onClick={() => setItemForm(p => ({ ...p, image_url: "" }))} className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center leading-none">✕</button>
                    </div>
                  )}
                  <label className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-lg border border-dashed border-zinc-700 cursor-pointer hover:border-violet-600 transition-colors text-xs text-muted-foreground ${prizeImageUploading ? "opacity-50 pointer-events-none" : ""}`}>
                    <span className="text-base">🖼️</span>
                    <span>{prizeImageUploading ? "Uploading…" : itemForm.image_url ? "Replace" : "Upload image"}</span>
                    <input type="file" className="sr-only" accept="image/jpeg,image/png,image/gif,image/webp"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadPrizeImage(f); e.target.value = ""; }}
                      disabled={prizeImageUploading} />
                  </label>
                </div>
              </div>
            </div>
            {itemMsg && <p className={`text-xs ${itemMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>{itemMsg}</p>}
            <div className="flex gap-2">
              <Button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white text-xs">{editItemId ? "Update Item" : "Add Item"}</Button>
              {editItemId && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditItemId(null); setItemForm({ name: "", emoji: "🎁", description: "", category: "misc", type: "item", value: "", stock: "", image_url: "" }); }}>Cancel</Button>}
            </div>
          </form>
        </div>
      )}


      {/* ── Cases ── */}
      {subTab === "cases" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Create cases with tier-based drops. Players open cases to win items from your inventory. Set drop rates per tier — pure probability, no guarantees.</p>
            <button
              onClick={() => { setShowCreateCase(!showCreateCase); setEditCaseId(null); setCaseForm({ name: "", emoji: "📦", description: "", price: "0", price_gems: "0", currency: "chips", image_url: "", tier_common: "7992", tier_rare: "1598", tier_epic: "320", tier_legendary: "64", tier_jackpot: "26" }); }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white border border-violet-500 transition-colors shrink-0"
            >
              {showCreateCase && !editCaseId ? "✕ Cancel" : "+ New Case"}
            </button>
          </div>

          {caseMsg && (
            <div className={`text-xs px-3 py-2 rounded-lg ${caseMsg.startsWith("Error") ? "bg-red-950 text-red-400" : "bg-emerald-950 text-emerald-400"}`}>
              {caseMsg}
            </div>
          )}

          {/* Create / Edit case form */}
          {showCreateCase && (
            <div className="border border-zinc-700 rounded-xl p-4 bg-card space-y-3">
              <div className="text-sm font-semibold text-foreground">{editCaseId ? "Edit Case" : "Create New Case"}</div>
              <form onSubmit={saveCase} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Name</label>
                    <input required value={caseForm.name} onChange={e => setCaseForm(p => ({ ...p, name: e.target.value }))} placeholder="Premium Case" className="w-full px-3 py-2 rounded-lg bg-input border border-zinc-700 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Emoji (fallback if no image)</label>
                    <input value={caseForm.emoji} onChange={e => setCaseForm(p => ({ ...p, emoji: e.target.value }))} placeholder="📦" className="w-full px-3 py-2 rounded-lg bg-input border border-zinc-700 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Price</label>
                    <div className="flex gap-1.5">
                      <div className="flex rounded-lg overflow-hidden border border-zinc-700 shrink-0">
                        <button type="button" onClick={() => setCaseForm(p => ({ ...p, currency: "chips" }))} className={`px-2 py-1.5 text-xs font-semibold transition-colors ${caseForm.currency === "chips" ? "bg-yellow-900 text-yellow-400" : "bg-input text-muted-foreground hover:text-foreground"}`}>🪙 Chips</button>
                        <button type="button" onClick={() => setCaseForm(p => ({ ...p, currency: "gems" }))} className={`px-2 py-1.5 text-xs font-semibold transition-colors ${caseForm.currency === "gems" ? "bg-cyan-900 text-cyan-400" : "bg-input text-muted-foreground hover:text-foreground"}`}>💎 Gems</button>
                      </div>
                      <input type="number" min="0" value={caseForm.price} onChange={e => setCaseForm(p => ({ ...p, price: e.target.value }))} className="w-full px-3 py-2 rounded-lg bg-input border border-zinc-700 text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                    <input value={caseForm.description} onChange={e => setCaseForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional" className="w-full px-3 py-2 rounded-lg bg-input border border-zinc-700 text-sm" />
                  </div>
                </div>
                {/* Case image upload */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Case Image</label>
                  <div className="flex items-center gap-3">
                    {caseForm.image_url && (
                      <div className="relative shrink-0">
                        <img
                          src={`${BASE_URL}/api/uploads${caseForm.image_url}`}
                          alt=""
                          className="w-20 h-20 object-cover rounded-lg border border-zinc-700"
                        />
                        <button
                          type="button"
                          onClick={() => setCaseForm(p => ({ ...p, image_url: "" }))}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center hover:bg-red-400"
                        >✕</button>
                      </div>
                    )}
                    <label className={`flex flex-col items-center justify-center gap-1.5 px-4 py-3 rounded-lg border border-dashed border-zinc-700 cursor-pointer hover:border-violet-600 transition-colors text-xs text-muted-foreground ${caseImageUploading ? "opacity-50 pointer-events-none" : ""}`}>
                      <span className="text-lg">🖼️</span>
                      <span>{caseImageUploading ? "Uploading…" : caseForm.image_url ? "Replace image" : "Upload image"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={e => { const f = e.target.files?.[0]; if (f) uploadCaseImage(f); e.target.value = ""; }}
                        disabled={caseImageUploading}
                      />
                    </label>
                  </div>
                </div>
                {/* Tier odds */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tier Drop Weights — integer weights, any scale. Jackpot target: ≈0.26% (1 in 385).</label>
                  {(() => {
                    const tiers = ["common","rare","epic","legendary","jackpot"] as const;
                    const total = tiers.reduce((s, t) => s + (parseInt(caseForm[`tier_${t}` as keyof typeof caseForm] as string) || 0), 0);
                    const jpWeight = parseInt(caseForm.tier_jackpot) || 0;
                    const jpPct = total > 0 ? (jpWeight / total) * 100 : 0;
                    const jpWarn = total > 0 && jpPct > 0.27;
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-2">
                          {tiers.map(tier => {
                            const w = parseInt(caseForm[`tier_${tier}` as keyof typeof caseForm] as string) || 0;
                            const pct = total > 0 ? (w / total) * 100 : 0;
                            const oneIn = pct > 0 ? Math.round(100 / pct) : 0;
                            return (
                              <div key={tier} className="space-y-1">
                                <div className="text-[10px] font-semibold" style={{ color: TIER_COLORS[tier] }}>{TIER_LABELS[tier]}</div>
                                <input
                                  type="number" min="0"
                                  value={caseForm[`tier_${tier}` as keyof typeof caseForm]}
                                  onChange={e => setCaseForm(p => ({ ...p, [`tier_${tier}`]: e.target.value }))}
                                  className="w-full px-2 py-1.5 rounded-lg bg-input border text-xs text-center"
                                  style={{ borderColor: TIER_COLORS[tier] + "66" }}
                                />
                                <div className="text-[9px] text-center" style={{ color: TIER_COLORS[tier] + "cc" }}>
                                  {total > 0 ? `${pct < 0.01 ? pct.toFixed(4) : pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%` : "–"}
                                </div>
                                <div className="text-[9px] text-center text-muted-foreground">
                                  {total > 0 && oneIn > 0 ? `1 in ${oneIn.toLocaleString()}` : "–"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <div className={`text-[10px] ${total > 0 ? "text-emerald-400" : "text-yellow-400"}`}>
                            Total weight: {total.toLocaleString()} {total > 0 ? "✓" : "⚠ add weights"}
                          </div>
                          {jpWarn && (
                            <div className="text-[10px] text-orange-400 font-semibold">
                              ⚠ Jackpot {jpPct.toFixed(2)}% — target is ≤0.26% (1 in 385)
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-4 py-2 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors">
                    {editCaseId ? "Update Case" : "Create Case"}
                  </button>
                  {editCaseId && (
                    <button type="button" onClick={() => { setEditCaseId(null); setShowCreateCase(false); }} className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-900 text-muted-foreground transition-colors">
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}

          {/* Cases list */}
          {cases.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">No cases yet — create one above</div>
          ) : (
            <div className="space-y-3">
              {cases.map((c: any) => {
                const isExpanded = expandedCaseId === c.id;
                const detail = caseDetail[c.id] ?? null;
                const stats = caseStats[c.id] ?? null;
                return (
                  <div key={c.id} className="border border-zinc-700 rounded-xl bg-card overflow-hidden">
                    {/* Case header */}
                    <div className="flex items-center gap-3 p-3">
                      {c.image_url ? (
                        <img src={`${BASE_URL}/api/uploads${c.image_url}`} alt="" className="w-10 h-10 rounded-lg object-cover border border-zinc-700 shrink-0" />
                      ) : (
                        <div className="text-2xl shrink-0">{c.emoji}</div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground">{c.name}</span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${c.enabled ? "bg-emerald-950 text-emerald-400" : "bg-red-950 text-red-400"}`}>
                            {c.enabled ? "Live" : "Disabled"}
                          </span>
                          {Number(c.price_gems) > 0 && <span className="text-[10px] text-cyan-400 font-semibold">💎 {Number(c.price_gems).toLocaleString()} gems</span>}
                          {Number(c.price_gems) === 0 && c.price > 0 && <span className="text-[10px] text-yellow-400 font-semibold">🪙 {Number(c.price).toLocaleString()}</span>}
                          {Number(c.price_gems) === 0 && c.price === 0 && <span className="text-[10px] text-emerald-400 font-semibold">FREE</span>}
                        </div>
                        <div className="flex gap-2 mt-1 flex-wrap">
                          {(() => {
                            const tiers = ["common","rare","epic","legendary","jackpot"] as const;
                            const total = tiers.reduce((s, t) => s + (Number(c[`tier_${t}`]) || 0), 0);
                            return tiers.map(tier => {
                              const w = Number(c[`tier_${tier}`]) || 0;
                              if (!w) return null;
                              const pct = total > 0 ? (w / total) * 100 : 0;
                              const pctStr = pct < 0.01 ? pct.toFixed(4) : pct < 1 ? pct.toFixed(2) : pct.toFixed(1);
                              return <span key={tier} style={{ color: TIER_COLORS[tier], fontSize: 10, fontWeight: 600 }}>{TIER_LABELS[tier]} {pctStr}%</span>;
                            });
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => toggleCaseEnabled(c.id, !c.enabled)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${c.enabled ? "bg-red-950 text-red-400 border-red-800 hover:bg-red-900" : "bg-emerald-950 text-emerald-400 border-emerald-800 hover:bg-emerald-900"}`}
                        >
                          {c.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => startEditCase(c)}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-blue-950 text-blue-400 border border-blue-800 hover:bg-blue-900 transition-colors"
                        >
                          Edit
                        </button>
                        {isOwner && (
                          <button
                            onClick={() => deleteCase(c.id)}
                            className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-red-950 text-red-400 border border-red-800 hover:bg-red-900 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const open = !isExpanded;
                            setExpandedCaseId(open ? c.id : null);
                            if (open) { loadCaseItems(c.id); loadCaseStats(c.id); }
                          }}
                          className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-zinc-800 text-muted-foreground border border-zinc-700 hover:border-foreground/30 transition-colors"
                        >
                          {isExpanded ? "▲ Hide" : "▼ Items"}
                        </button>
                      </div>
                    </div>

                    {/* Expanded: items + stats */}
                    {isExpanded && (
                      <div className="border-t border-zinc-700 p-3 space-y-3">
                        {/* Stats */}
                        {stats && (
                          <div className="grid grid-cols-4 gap-2 text-center">
                            {[
                              { label: "Total Opens", value: stats.totalOpens?.toLocaleString() ?? "0" },
                              { label: "Revenue", value: `🪙 ${(stats.totalRevenue ?? 0).toLocaleString()}` },
                              { label: "Paid Out", value: `🪙 ${(stats.totalPaid ?? 0).toLocaleString()}` },
                              { label: "House Profit", value: `🪙 ${(stats.houseProfit ?? 0).toLocaleString()}` },
                            ].map(s => (
                              <div key={s.label} className="bg-zinc-800 rounded-lg p-2">
                                <div className="text-[10px] text-muted-foreground">{s.label}</div>
                                <div className="text-xs font-bold text-foreground mt-0.5">{s.value}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Items in case */}
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground mb-2">Items in this case ({detail?.length ?? 0})</div>
                          {!detail ? (
                            <div className="text-xs text-muted-foreground">Loading…</div>
                          ) : detail.length === 0 ? (
                            <div className="text-xs text-muted-foreground">No items yet — add some below</div>
                          ) : (
                            <div className="space-y-1">
                              {detail.map((it: any) => (
                                <div key={it.id} className="flex items-center gap-2 py-1.5 border-b border-zinc-700 last:border-0">
                                  <span className="text-sm">{it.emoji}</span>
                                  <span className="text-xs text-foreground flex-1">{it.name}</span>
                                  {it.stock != null && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${Number(it.stock) === 0 ? "bg-red-950 text-red-400" : "bg-emerald-950 text-emerald-400"}`}>
                                      {Number(it.stock) === 0 ? "Out of stock" : `${it.stock} stock`}
                                    </span>
                                  )}
                                  {/* Tier selector */}
                                  <select
                                    value={it.tier ?? "common"}
                                    onChange={e => updateItemTierInCase(c.id, it.id, e.target.value)}
                                    className="text-[10px] px-2 py-1 rounded bg-input border border-zinc-700"
                                    style={{ color: TIER_COLORS[it.tier ?? "common"] }}
                                  >
                                    {(["common","rare","epic","legendary","jackpot"] as const).map(t => (
                                      <option key={t} value={t} style={{ color: TIER_COLORS[t] }}>{TIER_LABELS[t]}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => removeItemFromCase(c.id, it.id)}
                                    className="text-[10px] px-2 py-1 rounded-lg bg-red-950 text-red-400 border border-red-800 hover:bg-red-900 transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Add item to case */}
                        {addItemCaseId === c.id ? (
                          <form onSubmit={addItemToCase} className="flex gap-2 flex-wrap items-end">
                            <div className="flex-1 min-w-[200px]">
                              <label className="text-[10px] text-muted-foreground mb-1 block">Select Item</label>
                              <div className="flex items-center gap-1.5 bg-input border border-zinc-700 rounded-lg px-2 py-1 mb-1">
                                <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                                <input type="text" placeholder="Filter items…" value={caseItemSearch} onChange={e => setCaseItemSearch(e.target.value)}
                                  className="flex-1 bg-transparent text-xs outline-none text-foreground placeholder:text-muted-foreground/50 min-w-0" />
                              </div>
                              <select
                                required
                                value={addItemForm.prize_item_id}
                                onChange={e => setAddItemForm(p => ({ ...p, prize_item_id: e.target.value }))}
                                className="w-full px-2 py-1.5 rounded-lg bg-input border border-zinc-700 text-xs"
                                size={Math.min(7, items.filter((it: any) => !detail?.find((d: any) => d.id === it.id) && (!caseItemSearch.trim() || it.name.toLowerCase().includes(caseItemSearch.toLowerCase()) || (it.category ?? "").toLowerCase().includes(caseItemSearch.toLowerCase()))).length + 1)}
                              >
                                <option value="">— Choose from inventory ({items.filter((it: any) => !detail?.find((d: any) => d.id === it.id)).length} available) —</option>
                                {(() => {
                                  const available = items.filter((it: any) => !detail?.find((d: any) => d.id === it.id));
                                  const q = caseItemSearch.trim().toLowerCase();
                                  const filtered = q ? available.filter((it: any) => it.name.toLowerCase().includes(q) || (it.category ?? "").toLowerCase().includes(q) || (it.type ?? "").toLowerCase().includes(q)) : available;
                                  // Group by category
                                  const byCategory: Record<string, any[]> = {};
                                  filtered.forEach((it: any) => { const cat = it.category || "misc"; if (!byCategory[cat]) byCategory[cat] = []; byCategory[cat].push(it); });
                                  return Object.entries(byCategory).sort(([a],[b]) => a.localeCompare(b)).map(([cat, catItems]) => (
                                    <Fragment key={cat}>
                                      {Object.keys(byCategory).length > 1 && <option disabled value="">── {cat.toUpperCase()} ──</option>}
                                      {catItems.map((it: any) => (
                                        <option key={it.id} value={it.id}>{it.emoji} {it.name}{it.stock != null ? ` (${it.stock} stk)` : ""}</option>
                                      ))}
                                    </Fragment>
                                  ));
                                })()}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground mb-1 block">Tier</label>
                              <select
                                value={addItemForm.tier}
                                onChange={e => setAddItemForm(p => ({ ...p, tier: e.target.value }))}
                                className="px-2 py-1.5 rounded-lg bg-input border border-zinc-700 text-xs"
                                style={{ color: TIER_COLORS[addItemForm.tier] }}
                              >
                                {(["common","rare","epic","legendary","jackpot"] as const).map(t => (
                                  <option key={t} value={t} style={{ color: TIER_COLORS[t] }}>{TIER_LABELS[t]}</option>
                                ))}
                              </select>
                            </div>
                            <button type="submit" className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition-colors">
                              Add
                            </button>
                            <button type="button" onClick={() => setAddItemCaseId(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-muted-foreground hover:bg-zinc-900 transition-colors">
                              Cancel
                            </button>
                          </form>
                        ) : (
                          <button
                            onClick={() => { setAddItemCaseId(c.id); setAddItemForm({ prize_item_id: "", tier: "common" }); }}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-muted-foreground border border-zinc-700 hover:border-foreground/30 transition-colors"
                          >
                            + Add Item to Case
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Case Stats ── */}
      {subTab === "stats" && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Aggregate stats for all cases — revenue, payouts, and house profit pulled from the transaction ledger.</p>
            <button onClick={loadAllStats} disabled={statsLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-muted-foreground border border-zinc-700 hover:border-foreground/30 transition-colors disabled:opacity-50">
              {statsLoading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>

          {statsLoading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Loading stats…</div>
          )}

          {!statsLoading && allStats && (
            <>
              {/* Totals summary cards */}
              <div className="grid grid-cols-2 gap-3 grid-cols-4">
                {[
                  { label: "Total Opens", value: (allStats.totals.opens ?? 0).toLocaleString(), color: "text-violet-400" },
                  { label: "Total Revenue", value: `${(allStats.totals.revenue ?? 0).toLocaleString()} chips`, color: "text-blue-400" },
                  { label: "Total Paid Out", value: `${(allStats.totals.paid ?? 0).toLocaleString()} chips`, color: "text-amber-400" },
                  { label: "Net House Profit", value: `${(allStats.totals.profit ?? 0).toLocaleString()} chips`, color: (allStats.totals.profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400" },
                ].map(card => (
                  <div key={card.label} className="bg-card border border-zinc-700 rounded-xl p-3 flex flex-col gap-1">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{card.label}</div>
                    <div className={`text-sm font-bold ${card.color}`}>{card.value}</div>
                  </div>
                ))}
              </div>

              {/* Per-case breakdown table */}
              <div className="bg-card border border-zinc-700 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-zinc-700 bg-zinc-900 flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground">Per-Case Breakdown</span>
                  <span className="text-[10px] text-muted-foreground">({allStats.cases.length} cases)</span>
                </div>
                {allStats.cases.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">No cases found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-700 bg-zinc-900">
                          <th className="px-4 py-2 text-left text-muted-foreground font-semibold">Case</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Price</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Opens</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Revenue</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Paid Out</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Profit</th>
                          <th className="px-4 py-2 text-right text-muted-foreground font-semibold">Margin</th>
                          <th className="px-3 py-2 text-center text-muted-foreground font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        {allStats.cases.map((c: any, i: number) => {
                          const margin = c.revenue > 0 ? Math.round((c.profit / c.revenue) * 100) : 0;
                          const profitPos = c.profit >= 0;
                          return (
                            <tr key={c.id} className={`${i > 0 ? "border-t border-zinc-700" : ""} hover:bg-zinc-900 transition-colors`}>
                              <td className="px-4 py-2.5 font-semibold text-foreground">{c.name}</td>
                              <td className="px-4 py-2.5 text-right text-muted-foreground">{Number(c.price).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-right text-violet-400 font-semibold">{Number(c.opens).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-right text-blue-400">{Number(c.revenue).toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-right text-amber-400">{Number(c.paid).toLocaleString()}</td>
                              <td className={`px-4 py-2.5 text-right font-bold ${profitPos ? "text-emerald-400" : "text-red-400"}`}>
                                {profitPos ? "+" : ""}{Number(c.profit).toLocaleString()}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-semibold ${margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {margin}%
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${c.enabled ? "bg-emerald-950 text-emerald-400" : "bg-red-950 text-red-400"}`}>
                                  {c.enabled ? "ON" : "OFF"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      {/* Totals row */}
                      <tfoot>
                        <tr className="border-t-2 border-zinc-700 bg-zinc-900">
                          <td className="px-4 py-2.5 font-bold text-foreground text-xs">TOTAL</td>
                          <td className="px-4 py-2.5"></td>
                          <td className="px-4 py-2.5 text-right text-violet-400 font-bold">{Number(allStats.totals.opens).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right text-blue-400 font-bold">{Number(allStats.totals.revenue).toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right text-amber-400 font-bold">{Number(allStats.totals.paid).toLocaleString()}</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${(allStats.totals.profit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {(allStats.totals.profit ?? 0) >= 0 ? "+" : ""}{Number(allStats.totals.profit).toLocaleString()}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-bold ${allStats.totals.revenue > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                            {allStats.totals.revenue > 0 ? `${Math.round((allStats.totals.profit / allStats.totals.revenue) * 100)}%` : "—"}
                          </td>
                          <td className="px-3 py-2.5"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {!statsLoading && !allStats && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Failed to load stats. Click Refresh to try again.</div>
          )}
        </div>
      )}

      {/* ── Rewards ── */}
      {subTab === "rewards" && (
        <RewardsTab isOwner={isOwner} staffUsername={staffUsername} />
      )}

    </div>
  );
}

function GamesTab({ canManageBets = false, isOwner = false, staffUsername = "staff", defaultView = "games" }: { canManageBets?: boolean; isOwner?: boolean; staffUsername?: string; defaultView?: "games" | "prizes" | "sportbets" }) {
  const [gamesView, setGamesView] = useState<"games" | "prizes" | "sportbets">(defaultView);
  const { bankerToken, sessionToken } = useStore();
  const authToken = bankerToken || sessionToken || "";
  const { data: bjSettings, refetch: refetchBj } = useGetBlackjackSettings({ query: { refetchInterval: 5000 } });
  const bjMutation = useUpdateBlackjackSettings();
  const [bjMinBet, setBjMinBet] = useState("");
  const [bjMaxBet, setBjMaxBet] = useState("");
  useEffect(() => {
    if (bjSettings) { setBjMinBet(String(bjSettings.minBet)); setBjMaxBet(String(bjSettings.maxBet)); }
  }, [bjSettings]);

  const { data: slotsSettings, refetch: refetchSlots } = useGetSlotsSettings({ query: { refetchInterval: 5000 } });
  const slotsMutation = useUpdateSlotsSettings();

  // ── Slot bet limits ─────────────────────────────────────────────────────────
  const [fortunaBetInput,   setFortunaBetInput]   = useState("20,40,100,200,400,1000,2000,5000");
  const [westernBetInput,   setWesternBetInput]   = useState("20,40,100,200,400,1000,2000,5000");
  const [slotBetSaving,     setSlotBetSaving]     = useState(false);
  const [slotBetMsg,        setSlotBetMsg]        = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (slotsSettings?.fortunaBetSteps)      setFortunaBetInput((slotsSettings.fortunaBetSteps as number[]).join(","));
    if (slotsSettings?.westernSlotsBetSteps) setWesternBetInput((slotsSettings.westernSlotsBetSteps as number[]).join(","));
  }, [slotsSettings]);
  async function saveSlotBetLimits(e: React.FormEvent) {
    e.preventDefault();
    setSlotBetSaving(true); setSlotBetMsg(null);
    try {
      const parse = (s: string) => s.split(",").map(v => parseInt(v.trim())).filter(n => !isNaN(n) && n > 0);
      const enabled = slotsSettings?.enabled ?? false;
      const minBet  = slotsSettings?.minBet  ?? 50;
      const maxBet  = slotsSettings?.maxBet  ?? 5000;
      await slotsMutation.mutateAsync({ data: { enabled, minBet, maxBet, fortunaBetSteps: parse(fortunaBetInput) as any, westernSlotsBetSteps: parse(westernBetInput) as any } });
      await refetchSlots();
      setSlotBetMsg({ ok: true, text: "Saved!" });
    } catch (err: any) { setSlotBetMsg({ ok: false, text: err?.message || "Failed to save" }); }
    finally { setSlotBetSaving(false); }
  }

  const { data: rouletteSettings, refetch: refetchRoulette } = useGetRouletteSettings({ query: { refetchInterval: 5000 } });
  const rouletteMutation = useUpdateRouletteSettings();
  const [rouletteMinBet, setRouletteMinBet] = useState("");
  const [rouletteMaxBet, setRouletteMaxBet] = useState("");
  const [rouletteMaxBetsPerSpin, setRouletteMaxBetsPerSpin] = useState("");
  const [rouletteWheelType, setRouletteWheelType] = useState<"european" | "american">("european");
  useEffect(() => {
    if (rouletteSettings) {
      setRouletteMinBet(String(rouletteSettings.minBet));
      setRouletteMaxBet(String(rouletteSettings.maxBet));
      setRouletteMaxBetsPerSpin(String(rouletteSettings.maxBetsPerSpin ?? 0));
      setRouletteWheelType((rouletteSettings.wheelType as "european" | "american") ?? "european");
    }
  }, [rouletteSettings]);

  // Rake settings (poker only — game odds controlled by Owner oddsMode preset)
  const { data: rakeSettings, refetch: refetchRake } = useGetRakeSettings();
  const rakeMutation = useUpdateRakeSettings();
  async function saveRakeFor(patch: Partial<Parameters<typeof rakeMutation.mutateAsync>[0]["data"]>) {
    if (!rakeSettings) return;
    await rakeMutation.mutateAsync({
      data: {
        pokerRakePercent: rakeSettings.pokerRakePercent,
        pokerRakeCap: rakeSettings.pokerRakeCap,
        ...patch,
      } as any,
    });
    refetchRake();
  }

  // Baccarat tables (for game card)
  const [baccaratAdminTables, setBaccaratAdminTables] = useState<any[]>([]);
  const [bacToggling, setBacToggling] = useState(false);
  const [bacMinBet, setBacMinBet] = useState("100");
  const [bacMaxBet, setBacMaxBet] = useState("10000");
  const [bacLimitsSaving, setBacLimitsSaving] = useState(false);
  useEffect(() => {
    if (!authToken) return;
    fetch(`${BASE_URL}/api/baccarat/tables`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) setBaccaratAdminTables(d); }).catch(() => {});
  }, [authToken]);
  const firstBacTable = baccaratAdminTables[0] ?? null;

  useEffect(() => {
    if (firstBacTable) {
      setBacMinBet(String(firstBacTable.minBet ?? 100));
      setBacMaxBet(String(firstBacTable.maxBet ?? 10000));
    }
  }, [firstBacTable?.id]);

  async function toggleBaccarat(_v: boolean) {
    if (!firstBacTable) return;
    setBacToggling(true);
    try {
      const r = await fetch(`${BASE_URL}/api/baccarat/tables/${firstBacTable.id}/toggle`, { method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      setBaccaratAdminTables(prev => prev.map(t => t.id === firstBacTable.id ? { ...t, isOpen: d.isOpen ?? !t.isOpen } : t));
    } catch (err: any) { showToast(err?.message || "Failed"); } finally { setBacToggling(false); }
  }

  async function saveBacLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!firstBacTable || !authToken) return;
    setBacLimitsSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/baccarat/tables/${firstBacTable.id}/set-limits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ minBet: parseInt(bacMinBet), maxBet: parseInt(bacMaxBet) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setBaccaratAdminTables(prev => prev.map(t => t.id === firstBacTable.id ? { ...t, minBet: d.minBet, maxBet: d.maxBet } : t));
    } catch (err: any) { showToast(err?.message || "Failed to save limits"); }
    finally { setBacLimitsSaving(false); }
  }

  // Horse Racing settings
  const [horseSettings, setHorseSettings] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [horseMinBet, setHorseMinBet] = useState("");
  const [horseMaxBet, setHorseMaxBet] = useState("");
  const [horseSaving, setHorseSaving] = useState(false);
  useEffect(() => {
    if (!authToken) return;
    fetch(`${BASE_URL}/api/horse/banker-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (typeof d.minBet === "number") { setHorseSettings(d); setHorseMinBet(String(d.minBet)); setHorseMaxBet(String(d.maxBet)); }
      }).catch(() => {});
  }, [authToken]);
  async function toggleHorse(v: boolean) {
    try {
      const r = await fetch(`${BASE_URL}/api/horse/banker-settings`, { method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: v, minBet: horseSettings?.minBet ?? 10, maxBet: horseSettings?.maxBet ?? 50000 }) });
      const d = await r.json(); if (typeof d.minBet === "number") setHorseSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed"); }
  }
  async function saveHorseLimits(e: React.FormEvent) {
    e.preventDefault(); setHorseSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/horse/banker-settings`, { method: "POST", headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ enabled: horseSettings?.enabled ?? true, minBet: parseInt(horseMinBet), maxBet: parseInt(horseMaxBet) }) });
      const d = await r.json(); if (typeof d.minBet === "number") setHorseSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed"); } finally { setHorseSaving(false); }
  }

  // Game passwords
  const [gamePasswords, setGamePasswords] = useState<{ blackjack: boolean; slots: boolean; roulette: boolean; baccarat: boolean; horseRacing: boolean; cases: boolean; mines: boolean; keno: boolean; highlow: boolean } | null>(null);
  const [casesGameSettings, setCasesGameSettings] = useState<{ enabled: boolean; totalCases: number; activeCases: number } | null>(null);
  const [casesToggling, setCasesToggling] = useState(false);
  const [minesGameSettings, setMinesGameSettings] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [minesToggling, setMinesToggling] = useState(false);
  const [minesMinBet, setMinesMinBet] = useState("50");
  const [minesMaxBet, setMinesMaxBet] = useState("10000");
  const [minesSaving, setMinesSaving] = useState(false);
  const [kenoGameSettings, setKenoGameSettings] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [kenoToggling, setKenoToggling] = useState(false);
  const [kenoMinBet, setKenoMinBet] = useState("100");
  const [kenoMaxBet, setKenoMaxBet] = useState("50000");
  const [kenoSaving, setKenoSaving] = useState(false);
  const [highLowGameSettings, setHighLowGameSettings] = useState<{ enabled: boolean; minBet: number; maxBet: number } | null>(null);
  const [highLowToggling, setHighLowToggling] = useState(false);
  const [highLowMinBet, setHighLowMinBet] = useState("100");
  const [highLowMaxBet, setHighLowMaxBet] = useState("50000");
  const [highLowSaving, setHighLowSaving] = useState(false);
  const [mobTowerGameSettings, setMobTowerGameSettings] = useState<{ enabled: boolean; minBet: number; maxBet: number; betSteps?: number[] } | null>(null);
  const [mobTowerToggling, setMobTowerToggling] = useState(false);
  const [mobTowerMinBet, setMobTowerMinBet] = useState("100");
  const [mobTowerMaxBet, setMobTowerMaxBet] = useState("50000");
  const [mobTowerBetInput, setMobTowerBetInput] = useState("100,250,500,1000");
  const [mobTowerSaving, setMobTowerSaving] = useState(false);
  const [mobTowerBetMsg, setMobTowerBetMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpEditing, setGpEditing] = useState<string | null>(null);
  const [gpInput, setGpInput] = useState("");
  const [gpMsg, setGpMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!authToken) return;
    fetch(`${BASE_URL}/api/banker/game-passwords`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => setGamePasswords({ blackjack: d.blackjack?.hasPassword, slots: d.slots?.hasPassword, roulette: d.roulette?.hasPassword, baccarat: d.baccarat?.hasPassword, horseRacing: d.horseRacing?.hasPassword, cases: d.cases?.hasPassword, mines: d.mines?.hasPassword, keno: d.keno?.hasPassword, highlow: d.highlow?.hasPassword }))
      .catch(() => {});
    fetch(`${BASE_URL}/api/cases/game-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => { if (!d.error) setCasesGameSettings(d); })
      .catch(() => {});
    fetch(`${BASE_URL}/api/mines/banker-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (!d.error) {
          setMinesGameSettings(d);
          setMinesMinBet(String(d.minBet));
          setMinesMaxBet(String(d.maxBet));
        }
      })
      .catch(() => {});
    fetch(`${BASE_URL}/api/keno/banker-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (!d.error) {
          setKenoGameSettings(d);
          setKenoMinBet(String(d.minBet));
          setKenoMaxBet(String(d.maxBet));
        }
      })
      .catch(() => {});
    fetch(`${BASE_URL}/api/high-low/banker-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (!d.error) {
          setHighLowGameSettings(d);
          setHighLowMinBet(String(d.minBet));
          setHighLowMaxBet(String(d.maxBet));
        }
      })
      .catch(() => {});
    fetch(`${BASE_URL}/api/mob-tower/banker-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (!d.error) {
          setMobTowerGameSettings(d);
          setMobTowerMinBet(String(d.minBet));
          setMobTowerMaxBet(String(d.maxBet));
          if (Array.isArray(d.betSteps) && d.betSteps.length > 0) setMobTowerBetInput(d.betSteps.join(","));
        }
      })
      .catch(() => {});
  }, [authToken]);

  async function toggleCasesEnabled(v: boolean) {
    if (!authToken) return;
    setCasesToggling(true);
    try {
      const r = await fetch(`${BASE_URL}/api/cases/game-settings`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: v }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCasesGameSettings(prev => prev ? { ...prev, enabled: v } : { enabled: v, totalCases: 0, activeCases: 0 });
    } catch (err: any) { showToast(err?.message || "Failed to toggle cases"); }
    finally { setCasesToggling(false); }
  }

  async function toggleMinesEnabled(v: boolean) {
    if (!authToken) return;
    setMinesToggling(true);
    try {
      const r = await fetch(`${BASE_URL}/api/mines/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: v, minBet: parseInt(minesMinBet) || 50, maxBet: parseInt(minesMaxBet) || 10000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMinesGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed to toggle mines"); }
    finally { setMinesToggling(false); }
  }

  async function saveMinesLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setMinesSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/mines/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: minesGameSettings?.enabled ?? false, minBet: parseInt(minesMinBet) || 50, maxBet: parseInt(minesMaxBet) || 10000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMinesGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed"); }
    finally { setMinesSaving(false); }
  }

  async function toggleKenoEnabled(v: boolean) {
    if (!authToken) return;
    setKenoToggling(true);
    try {
      const r = await fetch(`${BASE_URL}/api/keno/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: v, minBet: parseInt(kenoMinBet) || 100, maxBet: parseInt(kenoMaxBet) || 50000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setKenoGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed to toggle Keno"); }
    finally { setKenoToggling(false); }
  }

  async function saveKenoLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setKenoSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/keno/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: kenoGameSettings?.enabled ?? false, minBet: parseInt(kenoMinBet) || 100, maxBet: parseInt(kenoMaxBet) || 50000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setKenoGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed"); }
    finally { setKenoSaving(false); }
  }

  async function toggleHighLowEnabled(v: boolean) {
    if (!authToken) return;
    setHighLowToggling(true);
    try {
      const r = await fetch(`${BASE_URL}/api/high-low/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: v, minBet: parseInt(highLowMinBet) || 100, maxBet: parseInt(highLowMaxBet) || 50000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setHighLowGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed to toggle High-Low"); }
    finally { setHighLowToggling(false); }
  }

  async function saveHighLowLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setHighLowSaving(true);
    try {
      const r = await fetch(`${BASE_URL}/api/high-low/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: highLowGameSettings?.enabled ?? true, minBet: parseInt(highLowMinBet) || 100, maxBet: parseInt(highLowMaxBet) || 50000 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setHighLowGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed"); }
    finally { setHighLowSaving(false); }
  }


  function parseMobTowerBetSteps(input: string): number[] | null {
    const nums = input.split(",").map(s => parseInt(s.trim())).filter(n => n > 0 && Number.isInteger(n));
    if (nums.length === 0 || nums.length > 12) return null;
    for (let i = 1; i < nums.length; i++) { if (nums[i] <= nums[i - 1]) return null; }
    return nums;
  }

  async function toggleMobTowerEnabled(v: boolean) {
    if (!authToken) return;
    setMobTowerToggling(true);
    try {
      const steps = parseMobTowerBetSteps(mobTowerBetInput);
      const r = await fetch(`${BASE_URL}/api/mob-tower/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: v, minBet: parseInt(mobTowerMinBet) || 100, maxBet: parseInt(mobTowerMaxBet) || 50000, ...(steps ? { betSteps: steps } : {}) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMobTowerGameSettings(d);
    } catch (err: any) { showToast(err?.message || "Failed to toggle Mob Tower"); }
    finally { setMobTowerToggling(false); }
  }

  async function saveMobTowerLimits(e: React.FormEvent) {
    e.preventDefault();
    if (!authToken) return;
    setMobTowerSaving(true);
    setMobTowerBetMsg(null);
    try {
      const steps = parseMobTowerBetSteps(mobTowerBetInput);
      if (!steps) { setMobTowerBetMsg({ ok: false, text: "Invalid bet steps — use ascending positive integers e.g. 100,250,500,1000" }); return; }
      const r = await fetch(`${BASE_URL}/api/mob-tower/banker-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: mobTowerGameSettings?.enabled ?? false, minBet: parseInt(mobTowerMinBet) || 100, maxBet: parseInt(mobTowerMaxBet) || 50000, betSteps: steps }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMobTowerGameSettings(d);
      setMobTowerBetMsg({ ok: true, text: "Saved!" });
    } catch (err: any) { setMobTowerBetMsg({ ok: false, text: err?.message || "Failed" }); }
    finally { setMobTowerSaving(false); }
  }

  async function setGamePassword(game: string) {
    if (!authToken) return;
    setGpLoading(true); setGpMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/banker/game-passwords/${game}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: gpInput || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setGamePasswords(prev => prev ? { ...prev, [game]: d.hasPassword } as any : prev);
      setGpEditing(null); setGpInput("");
      setGpMsg(`${game.charAt(0).toUpperCase() + game.slice(1)} password ${d.hasPassword ? "set" : "cleared"} successfully`);
      setTimeout(() => setGpMsg(null), 3000);
    } catch (err: any) {
      setGpMsg(err?.message || "Failed to update password");
    } finally {
      setGpLoading(false);
    }
  }

  async function saveBjLimits(e: React.FormEvent) {
    e.preventDefault();
    try {
      await bjMutation.mutateAsync({ data: { enabled: bjSettings?.enabled ?? true, minBet: parseInt(bjMinBet), maxBet: parseInt(bjMaxBet) } });
      refetchBj();
    } catch (err: any) { showToast(err?.message || "Failed"); }
  }

  async function saveRouletteLimits(e: React.FormEvent) {
    e.preventDefault();
    try {
      await rouletteMutation.mutateAsync({ data: { enabled: rouletteSettings?.enabled ?? false, wheelType: rouletteWheelType, minBet: parseInt(rouletteMinBet), maxBet: parseInt(rouletteMaxBet), maxBetsPerSpin: parseInt(rouletteMaxBetsPerSpin) || 0 } });
      refetchRoulette();
    } catch (err: any) { showToast(err?.message || "Failed"); }
  }

  function passwordSection(game: "blackjack" | "slots" | "roulette" | "baccarat" | "horseRacing" | "cases" | "mines" | "keno" | "highlow") {
    const isEditing = gpEditing === game;
    const hasPassword = (gamePasswords as any)?.[game];
    return (
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
        {gpMsg && gpEditing === game && (
          <p className={`text-[10px] px-2 py-0.5 rounded mb-1.5 ${gpMsg.includes("success") ? "text-green-400" : "text-red-400"}`}>{gpMsg}</p>
        )}
        {isEditing ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="password" value={gpInput}
              onChange={(e) => setGpInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setGamePassword(game); } }}
              placeholder={hasPassword ? "New pw (blank = remove)" : "Set password"}
              className="flex-1 text-xs h-7" autoComplete="new-password"
            />
            <Button type="button" size="sm" onClick={() => setGamePassword(game)} isLoading={gpLoading} className="h-7 text-xs px-2">Save</Button>
            <button type="button" onClick={() => { setGpEditing(null); setGpInput(""); }}
              className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground text-sm">✕</button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <KeyRound className="w-3 h-3" style={{ color: hasPassword ? "#f59e0b" : "rgba(255,255,255,0.25)" }} />
              <span className="text-[10px]" style={{ color: hasPassword ? "#f59e0b" : "rgba(255,255,255,0.3)" }}>
                {hasPassword ? "Password set" : "No password"}
              </span>
            </div>
            <button
              onClick={() => { setGpEditing(game); setGpInput(""); }}
              className="text-[10px] px-2 py-0.5 rounded transition-colors"
              style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {hasPassword ? "Change" : "Set"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {[{ key: "games", label: "🎮 House Games" }, { key: "prizes", label: "🎡 Prize Games" }, { key: "sportbets", label: "🏆 Sport Bets" }].map(({ key, label }) => (
          <button key={key} onClick={() => setGamesView(key as any)}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={gamesView === key
              ? { background: "rgba(139,92,246,0.8)", color: "#fff", border: "1px solid rgba(139,92,246,0.5)" }
              : { background: "transparent", color: "rgba(255,255,255,0.4)", border: "1px solid transparent" }}>
            {label}
          </button>
        ))}
      </div>

      {gamesView === "prizes" && <PrizesManagementPanel isOwner={isOwner} staffUsername={staffUsername} />}

      {gamesView === "sportbets" && <SportBetsTab isOwner={isOwner} />}

      {gamesView === "games" && <>
      <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>Toggle games open/closed · Set bet limits · Manage room passwords</p>

      <div className="grid grid-cols-2 grid-cols-3 gap-2">

        <GameCard
          accentColor="#3b82f6"
          icon="🃏" title="Blackjack" subtitle="Players vs the dealer"
          enabled={bjSettings?.enabled ?? false}
          onToggle={async (v) => { try { await bjMutation.mutateAsync({ data: { enabled: v, minBet: bjSettings?.minBet ?? 100, maxBet: bjSettings?.maxBet ?? 10000 } }); refetchBj(); } catch (err: any) { showToast(err?.message); } }}
          toggling={bjMutation.isPending}
          hasPassword={gamePasswords?.blackjack}
          betRange={bjSettings ? `${bjSettings.minBet.toLocaleString()}–${bjSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveBjLimits} className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Bet Limits</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={bjMinBet} onChange={(e) => setBjMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={bjMaxBet} onChange={(e) => setBjMaxBet(e.target.value)} min={1} /></div>
              </div>
              <Button type="submit" isLoading={bjMutation.isPending} size="sm">Save</Button>
              {passwordSection("blackjack")}
            </form>
          ) : passwordSection("blackjack")}
        />

        <GameCard
          accentColor="#a855f7"
          icon="🎰" title="Slots" subtitle="5-reel 243-ways · 500× jackpot"
          enabled={slotsSettings?.enabled ?? false}
          onToggle={async (v) => { try { await slotsMutation.mutateAsync({ data: { enabled: v } }); refetchSlots(); } catch (err: any) { showToast(err?.message); } }}
          toggling={slotsMutation.isPending}
          hasPassword={gamePasswords?.slots}
          settingsContent={canManageBets ? (
            <div className="space-y-4">

              {/* ── Per-game Slot Bet Steps ── */}
              <div className="border-t border-zinc-700 pt-3 space-y-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Bet Steps (comma-separated)</p>
                <form onSubmit={saveSlotBetLimits} className="space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">⚔ Fortuna</label>
                    <Input value={fortunaBetInput} onChange={e => setFortunaBetInput(e.target.value)} placeholder="20,40,100,200,400,1000" className="font-mono text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">★ Deadwood Dollars</label>
                    <Input value={westernBetInput} onChange={e => setWesternBetInput(e.target.value)} placeholder="20,40,100,200,400,1000" className="font-mono text-xs" />
                  </div>
                  <Button type="submit" isLoading={slotBetSaving} size="sm">Save Steps</Button>
                  {slotBetMsg && <p className={`text-xs ${slotBetMsg.ok ? "text-green-400" : "text-red-400"}`}>{slotBetMsg.text}</p>}
                </form>
              </div>

              {passwordSection("slots")}
            </div>
          ) : passwordSection("slots")}
        />

        <GameCard
          accentColor="#22c55e"
          icon="🎡" title="Roulette" subtitle={rouletteSettings?.wheelType === "american" ? "American wheel" : "European wheel"}
          enabled={rouletteSettings?.enabled ?? false}
          onToggle={async (v) => { try { await rouletteMutation.mutateAsync({ data: { enabled: v, wheelType: rouletteWheelType, minBet: parseInt(rouletteMinBet) || 50, maxBet: parseInt(rouletteMaxBet) || 5000, maxBetsPerSpin: parseInt(rouletteMaxBetsPerSpin) || 0 } }); refetchRoulette(); } catch (err: any) { showToast(err?.message); } }}
          toggling={rouletteMutation.isPending}
          hasPassword={gamePasswords?.roulette}
          betRange={rouletteSettings ? `${rouletteSettings.minBet.toLocaleString()}–${rouletteSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveRouletteLimits} className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Bet Limits</p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Wheel Type</label>
                <select value={rouletteWheelType} onChange={(e) => setRouletteWheelType(e.target.value as "european" | "american")} className="w-full bg-input border border-zinc-700 rounded-xl px-3 py-2 text-foreground text-xs">
                  <option value="european">European — single zero</option>
                  <option value="american">American — double zero</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={rouletteMinBet} onChange={(e) => setRouletteMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={rouletteMaxBet} onChange={(e) => setRouletteMaxBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bets Per Spin <span className="text-muted-foreground/60">(0 = unlimited)</span></label><Input type="number" value={rouletteMaxBetsPerSpin} onChange={(e) => setRouletteMaxBetsPerSpin(e.target.value)} min={0} placeholder="0" /></div>
              </div>
              <Button type="submit" isLoading={rouletteMutation.isPending} size="sm">Save</Button>
              {passwordSection("roulette")}
            </form>
          ) : passwordSection("roulette")}
        />

        <GameCard
          accentColor="#10b981"
          icon="🎴" title="Baccarat" subtitle="Punto Banco — bet Player, Banker, or Tie"
          enabled={firstBacTable?.isOpen ?? false}
          onToggle={toggleBaccarat}
          toggling={bacToggling}
          hasPassword={gamePasswords?.baccarat}
          betRange={firstBacTable ? `${(firstBacTable.minBet ?? 0).toLocaleString()}–${(firstBacTable.maxBet ?? 0).toLocaleString()} chips` : undefined}
          settingsContent={
            <div className="space-y-1">
              <form onSubmit={saveBacLimits} className="space-y-1.5">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold pt-1">Bet Limits</p>
                <div className="flex gap-2">
                  <div className="flex-1 space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">Min bet</label>
                    <Input type="number" value={bacMinBet} onChange={e => setBacMinBet(e.target.value)} min={1} className="text-xs h-7" />
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <label className="text-[10px] text-muted-foreground">Max bet</label>
                    <Input type="number" value={bacMaxBet} onChange={e => setBacMaxBet(e.target.value)} min={1} className="text-xs h-7" />
                  </div>
                </div>
                <Button type="submit" isLoading={bacLimitsSaving} size="sm" className="w-full">Save Limits</Button>
              </form>
              {passwordSection("baccarat")}
            </div>
          }
        />

        <GameCard
          accentColor="#f97316"
          icon="🏇" title="Horse Racing" subtitle="Live race betting"
          enabled={horseSettings?.enabled ?? true}
          onToggle={toggleHorse}
          toggling={false}
          hasPassword={gamePasswords?.horseRacing}
          betRange={horseSettings ? `${horseSettings.minBet.toLocaleString()}–${horseSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveHorseLimits} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={horseMinBet} onChange={(e) => setHorseMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={horseMaxBet} onChange={(e) => setHorseMaxBet(e.target.value)} min={1} /></div>
              </div>
              <Button type="submit" isLoading={horseSaving} size="sm">Save</Button>
              {passwordSection("horseRacing")}
            </form>
          ) : passwordSection("horseRacing")}
        />

        <GameCard
          accentColor="#8b5cf6"
          icon="📦" title="Case Opening" subtitle="CS:GO-style prize cases"
          enabled={casesGameSettings?.enabled ?? true}
          onToggle={toggleCasesEnabled}
          toggling={casesToggling}
          hasPassword={gamePasswords?.cases}
          betRange={casesGameSettings ? `${casesGameSettings.activeCases} / ${casesGameSettings.totalCases} cases active` : undefined}
          settingsContent={passwordSection("cases")}
        />

        <GameCard
          accentColor="#a0223a"
          icon="💣" title="Mines" subtitle="Pick tiles, avoid bombs"
          enabled={minesGameSettings?.enabled ?? false}
          onToggle={toggleMinesEnabled}
          toggling={minesToggling}
          hasPassword={gamePasswords?.mines}
          betRange={minesGameSettings ? `${minesGameSettings.minBet.toLocaleString()}–${minesGameSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveMinesLimits} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={minesMinBet} onChange={(e) => setMinesMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={minesMaxBet} onChange={(e) => setMinesMaxBet(e.target.value)} min={1} /></div>
              </div>
              <Button type="submit" isLoading={minesSaving} size="sm">Save</Button>
              {passwordSection("mines")}
            </form>
          ) : passwordSection("mines")}
        />

        <GameCard
          accentColor="#b8860b"
          icon="🎱" title="Keno" subtitle="Pick numbers, draw 10, win multipliers"
          enabled={kenoGameSettings?.enabled ?? false}
          onToggle={toggleKenoEnabled}
          toggling={kenoToggling}
          hasPassword={gamePasswords?.keno}
          betRange={kenoGameSettings ? `${kenoGameSettings.minBet.toLocaleString()}–${kenoGameSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveKenoLimits} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={kenoMinBet} onChange={(e) => setKenoMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={kenoMaxBet} onChange={(e) => setKenoMaxBet(e.target.value)} min={1} /></div>
              </div>
              <Button type="submit" isLoading={kenoSaving} size="sm">Save</Button>
              {passwordSection("keno")}
            </form>
          ) : passwordSection("keno")}
        />

        <GameCard
          accentColor="#1a6b8a"
          icon="🃏" title="High-Low" subtitle="Guess higher or lower, build your streak"
          enabled={highLowGameSettings?.enabled ?? true}
          onToggle={toggleHighLowEnabled}
          toggling={highLowToggling}
          hasPassword={gamePasswords?.highlow}
          betRange={highLowGameSettings ? `${highLowGameSettings.minBet.toLocaleString()}–${highLowGameSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveHighLowLimits} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={highLowMinBet} onChange={(e) => setHighLowMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={highLowMaxBet} onChange={(e) => setHighLowMaxBet(e.target.value)} min={1} /></div>
              </div>
              <Button type="submit" isLoading={highLowSaving} size="sm">Save</Button>
              {passwordSection("highlow")}
            </form>
          ) : passwordSection("highlow")}
        />

        <GameCard
          accentColor="#7c3aed"
          icon="🏙️" title="Mob Tower" subtitle="8 floors · pick 1 of 3 · up to 24.86×"
          enabled={mobTowerGameSettings?.enabled ?? false}
          onToggle={toggleMobTowerEnabled}
          toggling={mobTowerToggling}
          betRange={mobTowerGameSettings ? `${mobTowerGameSettings.minBet.toLocaleString()}–${mobTowerGameSettings.maxBet.toLocaleString()} chips` : undefined}
          settingsContent={canManageBets ? (
            <form onSubmit={saveMobTowerLimits} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-muted-foreground block mb-1">Min Bet</label><Input type="number" value={mobTowerMinBet} onChange={(e) => setMobTowerMinBet(e.target.value)} min={1} /></div>
                <div><label className="text-xs text-muted-foreground block mb-1">Max Bet</label><Input type="number" value={mobTowerMaxBet} onChange={(e) => setMobTowerMaxBet(e.target.value)} min={1} /></div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Bet Buttons (comma-separated)</label>
                <Input value={mobTowerBetInput} onChange={e => setMobTowerBetInput(e.target.value)} placeholder="100,250,500,1000" className="font-mono text-xs" />
                <p className="text-[10px] text-muted-foreground mt-1">e.g. 100,250,500,1000 — up to 12 ascending values</p>
              </div>
              <Button type="submit" isLoading={mobTowerSaving} size="sm">Save</Button>
              {mobTowerBetMsg && <p className={`text-xs ${mobTowerBetMsg.ok ? "text-green-400" : "text-red-400"}`}>{mobTowerBetMsg.text}</p>}
            </form>
          ) : undefined}
        />


      </div>
      </>}
    </div>
  );
}

// ── Date helpers (Eastern Time / America/New_York) ────────────────────────────
function computeRange(preset: string, cStart: string, cEnd: string): { start: string; end: string } {
  const today = todayEST();
  if (preset === "today")     return { start: today,              end: today };
  if (preset === "yesterday") return { start: daysAgoEST(1),      end: daysAgoEST(1) };
  if (preset === "7d")        return { start: daysAgoEST(6),      end: today };
  if (preset === "30d")       return { start: daysAgoEST(29),     end: today };
  if (preset === "week")      return { start: startOfWeekEST(),   end: today };
  if (preset === "month")     return { start: startOfMonthEST(),  end: today };
  return { start: cStart || today, end: cEnd || today };
}
type RangeGameStat = { bets: number; payouts: number; profit: number; rounds: number; rake: number; rtp: number | null };
type DailyRow = { date: string; deposits: number; withdrawals: number; gameProfit: number; rake: number; net: number };
type RangeStats = {
  range: { start: string; end: string };
  summary: {
    deposits: number; withdrawals: number; gameProfit: number; rake: number; netProfit: number;
    rakebackPaid?: number;
    /** Total chips paid out to winning sportsbook bettors in this period */
    sportsbookPayouts?: number;
    /** Total chips wagered on sportsbook in this period */
    sportsbookWagered?: number;
    /** 10% live-bet rake collected from sport_bet_finances in this period */
    sportsbookRake?: number;
    /** Net house profit from sportsbook = wagered - payouts + liveRake */
    sportsbookNetProfit?: number;
  };
  games: Record<string, RangeGameStat>;
  daily: DailyRow[];
};

// ── Loan Settings Panel ────────────────────────────────────────────────────────
function LoanSettingsPanel() {
  const TABS = ["Credit", "Scoring", "Loans", "Escalation", "Interest", "Tiers", "Progression", "Loan Tiers"] as const;
  type SettingsTab = typeof TABS[number];
  const [activeTab, setActiveTab] = useState<SettingsTab>("Credit");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<any[]>([]);
  const [loanTiers, setLoanTiers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [tierForm, setTierForm] = useState({ name: "", minScore: "", interestModifier: "", loanMultiplier: "" });
  const [editingTier, setEditingTier] = useState<number | null>(null);
  const [loanTierForm, setLoanTierForm] = useState({ name: "", requiredRepaid: "", cap: "", sortOrder: "" });
  const [editingLoanTier, setEditingLoanTier] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const [sr, tr, ltr] = await Promise.all([
      bankerApiFetch("/loans/settings").then(r => r.json()).catch(() => ({})),
      bankerApiFetch("/loans/credit-tiers").then(r => r.json()).catch(() => []),
      bankerApiFetch("/loans/loan-tiers").then(r => r.json()).catch(() => []),
    ]);
    setSettings(sr ?? {});
    setTiers(Array.isArray(tr) ? tr : []);
    setLoanTiers(Array.isArray(ltr) ? ltr : []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function set(k: string, v: string) { setSettings(s => ({ ...s, [k]: v })); }

  async function save(keys: string[]) {
    setSaving(true); setSaveMsg(null);
    const patch: Record<string, string> = {};
    for (const k of keys) patch[k] = settings[k] ?? "";
    const res = await bankerApiFetch("/loans/settings", { method: "PUT", body: JSON.stringify(patch) });
    const data = await res.json();
    if (res.ok) { setSettings(data); setSaveMsg("Saved"); }
    else setSaveMsg(data.error ?? "Error");
    setSaving(false);
    setTimeout(() => setSaveMsg(null), 2500);
  }

  async function saveTier(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: tierForm.name,
      minScore: tierForm.minScore,
      interestModifier: tierForm.interestModifier || "0",
      loanMultiplier: tierForm.loanMultiplier || "1",
    };
    const url = editingTier ? `/loans/credit-tiers/${editingTier}` : "/loans/credit-tiers";
    const res = await bankerApiFetch(url, { method: editingTier ? "PATCH" : "POST", body: JSON.stringify(payload) });
    if (res.ok) { setTierForm({ name: "", minScore: "", interestModifier: "", loanMultiplier: "" }); setEditingTier(null); await load(); }
  }

  async function deleteTier(id: number) {
    showConfirm("Delete this tier?", async () => {
      await bankerApiFetch(`/loans/credit-tiers/${id}`, { method: "DELETE" });
      await load();
    });
  }

  function startEdit(tier: any) {
    setEditingTier(tier.id);
    setTierForm({ name: tier.name, minScore: String(tier.minScore), interestModifier: String(tier.interestModifier), loanMultiplier: String(tier.loanMultiplier) });
  }

  async function saveLoanTier(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: loanTierForm.name,
      requiredRepaid: loanTierForm.requiredRepaid || "0",
      cap: loanTierForm.cap,
      sortOrder: loanTierForm.sortOrder || "0",
    };
    const url = editingLoanTier ? `/loans/loan-tiers/${editingLoanTier}` : "/loans/loan-tiers";
    const res = await bankerApiFetch(url, { method: editingLoanTier ? "PATCH" : "POST", body: JSON.stringify(payload) });
    if (res.ok) { setLoanTierForm({ name: "", requiredRepaid: "", cap: "", sortOrder: "" }); setEditingLoanTier(null); await load(); }
  }

  async function deleteLoanTier(id: number) {
    showConfirm("Delete this loan tier?", async () => {
      await bankerApiFetch(`/loans/loan-tiers/${id}`, { method: "DELETE" });
      await load();
    });
  }

  function startEditLoanTier(t: any) {
    setEditingLoanTier(t.id);
    setLoanTierForm({ name: t.name, requiredRepaid: String(t.requiredRepaid), cap: String(t.cap), sortOrder: String(t.sortOrder) });
  }

  if (loading) return <p className="text-xs text-muted-foreground text-center py-6">Loading loan settings…</p>;

  const inputCls = "w-full bg-input border border-zinc-700 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "text-xs text-muted-foreground block mb-1";
  const sectionHead = "text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3";

  return (
    <div className="bg-card border border-violet-800 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Settings className="w-5 h-5 text-violet-400" />
        <h3 className="font-display font-semibold text-foreground">Loan System Settings</h3>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${activeTab === t ? "bg-violet-600 text-white border-violet-500" : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground hover:border-foreground/30"}`}>
            {t}
          </button>
        ))}
      </div>

      {saveMsg && <p className={`text-xs px-3 py-2 rounded-lg border ${saveMsg === "Saved" ? "bg-green-950 text-green-400 border-green-700" : "bg-red-950 text-red-400 border-red-700"}`}>{saveMsg}</p>}

      {/* ── Credit Tab ── */}
      {activeTab === "Credit" && (
        <div className="space-y-4">
          <p className={sectionHead}>Eligibility Requirements</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Min Credit Score to borrow</label>
              <input className={inputCls} type="number" min={0} max={1000} value={settings.minCreditScore ?? "250"} onChange={e => set("minCreditScore", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Min Active Days</label>
              <input className={inputCls} type="number" min={0} value={settings.minActiveDays ?? "3"} onChange={e => set("minActiveDays", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Min Total Wagered (chips)</label>
              <input className={inputCls} type="number" min={0} value={settings.minTotalWagered ?? "50000"} onChange={e => set("minTotalWagered", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Base Loan Multiplier (per score point)</label>
              <input className={inputCls} type="number" min={1} value={settings.loanMultiplier ?? "500"} onChange={e => set("loanMultiplier", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">score 600 × {settings.loanMultiplier ?? 500} = {(600 * parseInt(settings.loanMultiplier ?? "500")).toLocaleString()} max chips</p>
            </div>
          </div>
          <Button isLoading={saving} onClick={() => save(["minCreditScore", "minActiveDays", "minTotalWagered", "loanMultiplier"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Credit Settings</Button>
        </div>
      )}

      {/* ── Scoring Tab ── */}
      {activeTab === "Scoring" && (
        <div className="space-y-4">
          <p className={sectionHead}>Credit Score Formula Weights</p>
          <p className="text-xs text-muted-foreground bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
            Formula: <span className="font-mono text-foreground">
              score = Base + √(deposits)×DepositW + √(repaid)×RepaidVolW + (loansPaid×LoanBonus) + (days×DayBonus) − (defaults×DefaultPen) − (overdue×OverduePen)
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Base Score (all players start here)</label>
              <input className={inputCls} type="number" min={0} max={1000} step={10} value={settings.scoreBase ?? "300"} onChange={e => set("scoreBase", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Deposit Weight (× √total deposits)</label>
              <input className={inputCls} type="number" min={0} step={0.01} value={settings.scoreDepositWeight ?? "0.15"} onChange={e => set("scoreDepositWeight", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">100k chips deposited → +{Math.round(Math.sqrt(100000) * parseFloat(settings.scoreDepositWeight ?? "0.15"))} pts</p>
            </div>
            <div>
              <label className={labelCls}>Repayment Volume Weight (× √trusted vol)</label>
              <input className={inputCls} type="number" min={0} step={0.01} value={settings.scoreTrustedVolumeWeight ?? "0.5"} onChange={e => set("scoreTrustedVolumeWeight", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">75k repaid → +{Math.round(Math.sqrt(75000) * parseFloat(settings.scoreTrustedVolumeWeight ?? "0.5"))} pts</p>
            </div>
            <div>
              <label className={labelCls}>Bonus per Loan Fully Repaid</label>
              <input className={inputCls} type="number" min={0} step={5} value={settings.scoreLoansRepaidBonus ?? "50"} onChange={e => set("scoreLoansRepaidBonus", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">3 loans paid off → +{3 * parseInt(settings.scoreLoansRepaidBonus ?? "50")} pts</p>
            </div>
            <div>
              <label className={labelCls}>Bonus per Active Payment Day</label>
              <input className={inputCls} type="number" min={0} step={1} value={settings.scoreActiveDaysBonus ?? "3"} onChange={e => set("scoreActiveDaysBonus", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Penalty per Default</label>
              <input className={inputCls} type="number" min={0} step={10} value={settings.scoreDefaultPenalty ?? "150"} onChange={e => set("scoreDefaultPenalty", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Penalty per Overdue / Delinquent Loan</label>
              <input className={inputCls} type="number" min={0} step={5} value={settings.scoreOverduePenalty ?? "75"} onChange={e => set("scoreOverduePenalty", e.target.value)} />
            </div>
          </div>
          <Button isLoading={saving} onClick={() => save(["scoreBase", "scoreDepositWeight", "scoreTrustedVolumeWeight", "scoreLoansRepaidBonus", "scoreActiveDaysBonus", "scoreDefaultPenalty", "scoreOverduePenalty"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Scoring Settings</Button>
        </div>
      )}

      {/* ── Loans Tab ── */}
      {activeTab === "Loans" && (
        <div className="space-y-4">
          <p className={sectionHead}>Interest Rate Formula</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Base Interest Rate (%)</label>
              <input className={inputCls} type="number" min={0} step="0.1" value={settings.baseInterestRate ?? "25"} onChange={e => set("baseInterestRate", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Rate for score 0. Better scores get reduced rates via tiers.</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
            Formula: <span className="font-mono text-foreground">rate = baseRate − (score/1000 × baseRate×0.6) + tier.interestModifier</span>
          </p>
          <Button isLoading={saving} onClick={() => save(["baseInterestRate"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Loan Settings</Button>
        </div>
      )}

      {/* ── Escalation Tab ── */}
      {activeTab === "Escalation" && (
        <div className="space-y-4">
          <p className={sectionHead}>Stage Thresholds (days past due date)</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Overdue after (days)</label>
              <input className={inputCls} type="number" min={1} value={settings.overdueDays ?? "3"} onChange={e => set("overdueDays", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Delinquent after (days)</label>
              <input className={inputCls} type="number" min={1} value={settings.delinquentDays ?? "7"} onChange={e => set("delinquentDays", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Collections after (days)</label>
              <input className={inputCls} type="number" min={1} value={settings.collectionsDays ?? "14"} onChange={e => set("collectionsDays", e.target.value)} />
            </div>
          </div>
          <p className={sectionHead}>Enforcement Toggles</p>
          <div className="space-y-2">
            {[
              { key: "blockWithdrawals", label: "Block withdrawals for delinquent/collections players" },
              { key: "autoFlagEscalated", label: "Auto-flag player in security when stage escalates" },
              { key: "autoDeductFromDeposit", label: "Auto-deduct % from deposits toward loan balance" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center gap-3">
                <button
                  onClick={() => set(key, settings[key] === "true" ? "false" : "true")}
                  className={`relative w-10 h-5 rounded-full transition-colors ${settings[key] === "true" ? "bg-violet-600" : "bg-zinc-800"}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings[key] === "true" ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
                <span className="text-sm text-foreground">{label}</span>
              </div>
            ))}
          </div>
          {settings.autoDeductFromDeposit === "true" && (
            <div>
              <label className={labelCls}>Auto-deduct % per deposit</label>
              <input className={inputCls} type="number" min={1} max={100} value={settings.autoDeductPercent ?? "20"} onChange={e => set("autoDeductPercent", e.target.value)} />
            </div>
          )}
          <Button isLoading={saving} onClick={() => save(["overdueDays", "delinquentDays", "collectionsDays", "blockWithdrawals", "autoFlagEscalated", "autoDeductFromDeposit", "autoDeductPercent"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Escalation Settings</Button>
        </div>
      )}

      {/* ── Interest Tab ── */}
      {activeTab === "Interest" && (
        <div className="space-y-4">
          <p className={sectionHead}>Interest Mode</p>
          <div className="flex gap-3">
            {["flat", "daily"].map(mode => (
              <button key={mode} onClick={() => set("interestMode", mode)}
                className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${settings.interestMode === mode ? "bg-violet-600 text-white border-violet-500" : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground"}`}>
                {mode === "flat" ? "Flat (one-time)" : "Daily (accruing)"}
              </button>
            ))}
          </div>
          {settings.interestMode === "daily" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Daily Interest Rate (%)</label>
                <input className={inputCls} type="number" min={0} step="0.1" value={settings.dailyInterestRate ?? "2"} onChange={e => set("dailyInterestRate", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Max Interest Cap (% of principal)</label>
                <input className={inputCls} type="number" min={0} value={settings.maxInterestCap ?? "200"} onChange={e => set("maxInterestCap", e.target.value)} />
                <p className="text-[10px] text-muted-foreground mt-1">200% = interest can grow to 2× the principal max</p>
              </div>
            </div>
          )}
          {settings.interestMode === "flat" && (
            <p className="text-xs text-muted-foreground bg-zinc-800 rounded-xl px-3 py-2 border border-zinc-700">In flat mode, interest is calculated once at loan creation (principal × rate). No daily accrual.</p>
          )}
          <Button isLoading={saving} onClick={() => save(["interestMode", "dailyInterestRate", "maxInterestCap"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Interest Settings</Button>
        </div>
      )}

      {/* ── Progression Tab ── */}
      {activeTab === "Progression" && (
        <div className="space-y-4">
          <p className={sectionHead}>Trusted Volume Settings</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Min Qualifying Loan (chips)</label>
              <input className={inputCls} type="number" min={0} value={settings.minQualifyingLoan ?? "50000"} onChange={e => set("minQualifyingLoan", e.target.value)} />
              <p className="text-[10px] text-muted-foreground mt-1">Loans below this use a reduced progression multiplier to prevent small-loan exploitation</p>
            </div>
          </div>
          <p className={sectionHead}>Weighted Multipliers</p>
          <p className="text-xs text-muted-foreground bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
            When a payment is made, the progression increment = <span className="font-mono text-foreground">paymentAmount × multiplier</span>. Larger loans earn trust faster.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Large Loan Multiplier (≥ 500k)</label>
              <input className={inputCls} type="number" min={0} step="0.1" value={settings.progressionMultiLarge ?? "1.5"} onChange={e => set("progressionMultiLarge", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Mid Loan Multiplier (≥ 250k)</label>
              <input className={inputCls} type="number" min={0} step="0.1" value={settings.progressionMultiMid ?? "1.2"} onChange={e => set("progressionMultiMid", e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Small Loan Multiplier (&lt; Min)</label>
              <input className={inputCls} type="number" min={0} step="0.1" value={settings.progressionMultiSmall ?? "0.2"} onChange={e => set("progressionMultiSmall", e.target.value)} />
            </div>
          </div>
          <p className={sectionHead}>Progression Block Rules</p>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => set("progressionBlockDefaults", settings.progressionBlockDefaults === "false" ? "true" : "false")}
                className={`relative w-10 h-5 rounded-full transition-colors ${settings.progressionBlockDefaults !== "false" ? "bg-violet-600" : "bg-zinc-800"}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.progressionBlockDefaults !== "false" ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
              <span className="text-sm text-foreground">Block tier progression if player has any defaults</span>
            </div>
            <div>
              <label className={labelCls}>Block progression if overdue loan count exceeds</label>
              <input className={inputCls} type="number" min={0} value={settings.progressionBlockOverdue ?? "2"} onChange={e => set("progressionBlockOverdue", e.target.value)} />
            </div>
          </div>
          <Button isLoading={saving} onClick={() => save(["minQualifyingLoan", "progressionMultiLarge", "progressionMultiMid", "progressionMultiSmall", "progressionBlockDefaults", "progressionBlockOverdue"])} className="bg-violet-600 hover:bg-violet-500 text-white text-xs">Save Progression Settings</Button>
        </div>
      )}

      {/* ── Loan Tiers Tab ── */}
      {activeTab === "Loan Tiers" && (
        <div className="space-y-4">
          <p className={sectionHead}>Volume-Based Loan Tiers</p>
          <p className="text-xs text-muted-foreground bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
            Players progress through tiers based on <span className="font-semibold text-foreground">trusted volume</span> — total chips repaid (weighted by loan size). The tier cap sets the maximum loan amount for each tier.
          </p>
          <div className="overflow-x-auto rounded-xl border border-zinc-700 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 bg-black/30">
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Order</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Tier</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Required Repaid</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Max Loan Cap</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {loanTiers.map(t => (
                  <tr key={t.id} className="border-b border-zinc-700 last:border-0 hover:bg-zinc-900">
                    <td className="px-3 py-2 text-muted-foreground">{t.sortOrder}</td>
                    <td className="px-3 py-2 font-semibold text-foreground">{t.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.requiredRepaid === 0 ? "—" : t.requiredRepaid.toLocaleString()}</td>
                    <td className="px-3 py-2 text-amber-400 font-semibold">{t.cap.toLocaleString()}</td>
                    <td className="px-3 py-2 flex items-center gap-1 justify-end">
                      <button onClick={() => startEditLoanTier(t)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-zinc-900"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteLoanTier(t.id)} className="p-1 rounded text-red-500 hover:text-red-400 hover:bg-red-950"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={saveLoanTier} className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">{editingLoanTier ? "Edit Loan Tier" : "Add Loan Tier"}</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Name</label><input required className={inputCls} value={loanTierForm.name} onChange={e => setLoanTierForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Trusted" /></div>
              <div><label className={labelCls}>Sort Order</label><input type="number" min={0} className={inputCls} value={loanTierForm.sortOrder} onChange={e => setLoanTierForm(f => ({ ...f, sortOrder: e.target.value }))} placeholder="e.g. 2" /></div>
              <div><label className={labelCls}>Required Repaid (chips)</label><input type="number" min={0} className={inputCls} value={loanTierForm.requiredRepaid} onChange={e => setLoanTierForm(f => ({ ...f, requiredRepaid: e.target.value }))} placeholder="e.g. 300000" /></div>
              <div><label className={labelCls}>Max Loan Cap (chips)</label><input required type="number" min={1} className={inputCls} value={loanTierForm.cap} onChange={e => setLoanTierForm(f => ({ ...f, cap: e.target.value }))} placeholder="e.g. 300000" /></div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white text-xs">{editingLoanTier ? "Update Tier" : "Add Tier"}</Button>
              {editingLoanTier && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingLoanTier(null); setLoanTierForm({ name: "", requiredRepaid: "", cap: "", sortOrder: "" }); }}>Cancel</Button>}
            </div>
          </form>
        </div>
      )}

      {/* ── Tiers Tab ── */}
      {activeTab === "Tiers" && (
        <div className="space-y-4">
          <p className={sectionHead}>Credit Tiers</p>
          <div className="overflow-x-auto rounded-xl border border-zinc-700 bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-700 bg-black/30">
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Tier</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Min Score</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Rate Modifier (%)</th>
                  <th className="text-left px-3 py-2 text-xs text-muted-foreground font-semibold">Loan Multiplier</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {tiers.map(tier => (
                  <tr key={tier.id} className="border-b border-zinc-700 last:border-0 hover:bg-zinc-900">
                    <td className="px-3 py-2 font-semibold text-foreground">{tier.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{tier.minScore}+</td>
                    <td className={`px-3 py-2 font-semibold ${tier.interestModifier < 0 ? "text-green-400" : tier.interestModifier > 0 ? "text-red-400" : "text-muted-foreground"}`}>{tier.interestModifier > 0 ? "+" : ""}{tier.interestModifier}%</td>
                    <td className="px-3 py-2 text-muted-foreground">{tier.loanMultiplier}×</td>
                    <td className="px-3 py-2 flex items-center gap-1 justify-end">
                      <button onClick={() => startEdit(tier)} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-zinc-900"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => deleteTier(tier.id)} className="p-1 rounded text-red-500 hover:text-red-400 hover:bg-red-950"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={saveTier} className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground">{editingTier ? "Edit Tier" : "Add Tier"}</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Name</label><input required className={inputCls} value={tierForm.name} onChange={e => setTierForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. VIP" /></div>
              <div><label className={labelCls}>Min Score</label><input required type="number" min={0} max={1000} className={inputCls} value={tierForm.minScore} onChange={e => setTierForm(f => ({ ...f, minScore: e.target.value }))} /></div>
              <div><label className={labelCls}>Rate Modifier (%) negative = discount</label><input type="number" step="0.1" className={inputCls} value={tierForm.interestModifier} onChange={e => setTierForm(f => ({ ...f, interestModifier: e.target.value }))} placeholder="e.g. -5" /></div>
              <div><label className={labelCls}>Loan Multiplier</label><input type="number" min={0.1} step="0.1" className={inputCls} value={tierForm.loanMultiplier} onChange={e => setTierForm(f => ({ ...f, loanMultiplier: e.target.value }))} placeholder="e.g. 2" /></div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white text-xs">{editingTier ? "Update Tier" : "Add Tier"}</Button>
              {editingTier && <Button type="button" variant="ghost" size="sm" onClick={() => { setEditingTier(null); setTierForm({ name: "", minScore: "", interestModifier: "", loanMultiplier: "" }); }}>Cancel</Button>}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ── Rewards Tab ───────────────────────────────────────────────────────────────
function RewardsTab({ isOwner = false, staffUsername = "staff" }: { isOwner?: boolean; staffUsername?: string }) {
  const { bankerToken, sessionToken } = useStore();
  const authToken = bankerToken || sessionToken || "";
  const [rewards, setRewards] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"pending" | "delivered" | "all">("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [delivering, setDelivering] = useState<number | null>(null);
  const [deliverMsg, setDeliverMsg] = useState<{ id: number; ok: boolean; text: string } | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<number, string>>({});
  const [betPaidInputs, setBetPaidInputs] = useState<Record<number, string>>({});
  const [betPaidByInputs, setBetPaidByInputs] = useState<Record<number, string>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/prizes/pending?all=true`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      setRewards(Array.isArray(d) ? d : []);
    } catch { setRewards([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [authToken]);

  async function deliver(id: number) {
    setDelivering(id);
    setDeliverMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/prizes/pending/${id}/deliver`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          deliveredBy: staffUsername,
          notes: noteInputs[id] || null,
          betPaidBy: betPaidByInputs[id] || null,
          betPaidAmount: betPaidInputs[id] || null,
        }),
      });
      const d = await r.json();
      if (d.error) { setDeliverMsg({ id, ok: false, text: "Error: " + d.error }); }
      else { setDeliverMsg({ id, ok: true, text: "✓ Delivered" }); setExpandedId(null); load(); }
    } finally { setDelivering(null); }
  }

  async function deleteReward(id: number) {
    showConfirm("Delete this reward record?", async () => {
      await fetch(`${BASE_URL}/api/prizes/pending/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      load();
    });
  }

  const filtered = rewards
    .filter((r: any) => statusFilter === "all" || (statusFilter === "pending" ? !r.delivered_at : !!r.delivered_at));

  const pendingCount = rewards.filter((r: any) => !r.delivered_at).length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Prize Requests</h2>
          {pendingCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-900 text-amber-400 border border-amber-700">{pendingCount} pending</span>
          )}
        </div>
        <button onClick={load} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1 border border-zinc-700 rounded-lg hover:bg-zinc-900">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1 border-b border-zinc-700 pb-2">
        {(["pending", "all", "delivered"] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${statusFilter === s ? "bg-violet-950 border-violet-600 text-violet-300" : "border-zinc-700 text-muted-foreground hover:text-foreground"}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading && <div className="text-xs text-muted-foreground py-6 text-center">Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-10 text-muted-foreground text-sm">
          <Gift className="w-7 h-7 mx-auto mb-2 opacity-30" />
          {statusFilter === "pending" ? "All caught up — no pending requests." : "Nothing matches this filter."}
        </div>
      )}

      {/* Compact table */}
      {!loading && filtered.length > 0 && (
        <div className="rounded-xl border border-zinc-700 overflow-hidden bg-card">
          <table className="w-full text-xs">
            <thead className="bg-black/40 border-b border-zinc-700">
              <tr>
                <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Prize</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Player</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">ID</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Requested</th>
                <th className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Status</th>
                <th className="px-3 py-2 text-right text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">Action</th>
              </tr>
            </thead>
            <tbody className="bg-zinc-950">
              {filtered.map((r: any) => {
                const isPending = !r.delivered_at;
                const isBetPrize = r.item_type === "bet" || r.prize_type === "bet";
                const isExpanded = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t border-zinc-700 hover:bg-white/5 transition-colors ${isExpanded ? "bg-white/5" : ""}`}>
                      <td className="px-3 py-2 font-semibold text-foreground">
                        <span className="mr-1">{r.prize_emoji || "🎁"}</span>{r.prize_name}
                        {isBetPrize && <span className="ml-1.5 px-1 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-400">BET</span>}
                      </td>
                      <td className="px-3 py-2 text-foreground">{r.player_name}</td>
                      <td className="px-3 py-2 font-mono text-amber-400">{r.state_id || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{fmtETDateShort(r.won_at)}</td>
                      <td className="px-3 py-2">
                        {isPending
                          ? <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950 text-amber-400 border border-amber-800">PENDING</span>
                          : <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">✓ {r.delivered_by || "Done"}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPending && (
                            <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${isExpanded ? "bg-green-950 border-green-600 text-green-300" : "bg-green-950 border-green-700 text-green-400 hover:bg-green-950"}`}>
                              {isExpanded ? "Cancel" : "Deliver"}
                            </button>
                          )}
                          {isOwner && (
                            <button onClick={() => deleteReward(r.id)} className="p-1 rounded border border-zinc-700 text-muted-foreground/40 hover:text-red-400 hover:border-red-700">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded deliver form */}
                    {isExpanded && (
                      <tr className="border-t border-dashed border-zinc-700 bg-black/20">
                        <td colSpan={6} className="px-3 py-3">
                          <div className="space-y-2">
                            {isBetPrize && (
                              <div className="flex gap-2 p-2 rounded-lg bg-cyan-950 border border-cyan-800">
                                <input type="text" placeholder="Staff who sent BET"
                                  className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-cyan-600"
                                  value={betPaidByInputs[r.id] ?? ""} onChange={e => setBetPaidByInputs(n => ({ ...n, [r.id]: e.target.value }))} />
                                <input type="number" min="1" placeholder={r.item_value ? String(r.item_value) : "BET amount"}
                                  className="w-28 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-cyan-600"
                                  value={betPaidInputs[r.id] ?? ""} onChange={e => setBetPaidInputs(n => ({ ...n, [r.id]: e.target.value }))} />
                              </div>
                            )}
                            <div className="flex gap-2">
                              <input type="text" placeholder="Delivery note (optional)"
                                className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-foreground focus:outline-none"
                                value={noteInputs[r.id] ?? ""} onChange={e => setNoteInputs(n => ({ ...n, [r.id]: e.target.value }))} />
                              <button onClick={() => deliver(r.id)} disabled={delivering === r.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-xs font-bold disabled:opacity-50 whitespace-nowrap">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {delivering === r.id ? "Saving…" : "Mark Delivered"}
                              </button>
                            </div>
                            {deliverMsg?.id === r.id && (
                              <p className={`text-[10px] font-semibold ${deliverMsg.ok ? "text-emerald-400" : "text-red-400"}`}>{deliverMsg.text}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatsTab({ isOwner = false, isBanker = false, isJuniorBanker = false, staffUsername = "staff" }: { isOwner?: boolean; isBanker?: boolean; isJuniorBanker?: boolean; staffUsername?: string }) {
  const canManageLoanStats = isOwner || isBanker || isJuniorBanker;
  const [statsSubTab, setStatsSubTab] = useState<"overview" | "games" | "players" | "loans" | "bet" | "babalari">(isJuniorBanker && !isOwner && !isBanker ? "loans" : "overview");

  // Sport bets stats
  const [sportBetStats, setSportBetStats] = useState<{
    totalEvents: number; openEvents: number; closedEvents: number; settledEvents: number;
    totalBets: number; totalWagered: number; selfPlacedBets: number; selfPlacedWagered: number;
    pendingPayouts: number; paidPayouts: number; rakeCollected: number; totalPaidOut: number;
  } | null>(null);
  const [sportBetStatsLoading, setSportBetStatsLoading] = useState(false);

  function loadSportBetStats() {
    setSportBetStatsLoading(true);
    bankerApiFetch("/sportbets/stats").then(r => r.json()).then(d => {
      setSportBetStats(d);
      setSportBetStatsLoading(false);
    }).catch(() => setSportBetStatsLoading(false));
  }

  const [bingoStats, setBingoStats] = useState<{
    totalRounds: number; totalCollected: number; totalHouseProfit: number;
    totalPrizePool: number; totalCardsSold: number; bestRound: number;
    recentRounds: { id: number; status: string; cardPrice: number; totalCardsSold: number; totalCollected: number; prizePool: number; houseProfit: number; }[];
  } | null>(null);

  function loadBingoStats() {
    bankerApiFetch("/bingo/stats").then(r => r.json()).then(d => {
      if (typeof d.totalRounds === "number") setBingoStats(d);
    }).catch(() => {});
  }

  const [lotteryStats, setLotteryStats] = useState<{
    totalDraws: number; totalTicketsSold: number; totalCollected: number;
    totalPaidOut: number; houseProfit: number; biggestJackpot: number;
    jackpotWinnerCount: number; consolationWinnerCount: number;
    recentDraws: { id: number; status: string; drawTime: string; ticketsSold: number; collected: number; jackpot: number; consolation: number; jackpotRolledOver: boolean; consolationRolledOver: boolean; winningNumbers: number[]; }[];
  } | null>(null);

  function loadLotteryStats() {
    bankerApiFetch("/lottery/stats").then(r => r.json()).then(d => {
      if (typeof d.totalDraws === "number") setLotteryStats(d);
    }).catch(() => {});
  }

  // BET deposit stats
  const [betStats, setBetStats] = useState<{ total_transactions: number; total_bet: number; total_chips: number; unique_players: number } | null>(null);
  // Babalari stats
  const [babalariStats, setBabalariStats] = useState<{ total_accepted: number; total_chips_issued: number; total_transactions: number; unique_players: number; rate: number } | null>(null);
  const [babalariLedger, setBabalariLedger] = useState<any[]>([]);
  const [babalariLedgerLoading, setBabalariLedgerLoading] = useState(false);
  const [showBabLedger, setShowBabLedger] = useState(false);
  const [editBabalariRate, setEditBabalariRate] = useState("");
  const [editBabalariSellPrice, setEditBabalariSellPrice] = useState("");
  const [babalariSellPrice, setBabalariSellPrice] = useState<number>(0.10);
  const [babalariRateSaving, setBabalariRateSaving] = useState(false);
  const [babalariRateMsg, setBabalariRateMsg] = useState<{ text: string; ok: boolean } | null>(null);
  // Babalari house inventory
  const [babHouseBalance, setBabHouseBalance] = useState<{ total_in: number; total_out: number; balance: number; tx_count: number; last_updated: string | null } | null>(null);
  const [babHouseLoading, setBabHouseLoading] = useState(false);
  const [babDebitAmt, setBabDebitAmt] = useState("");
  const [babDebitCat, setBabDebitCat] = useState("payout");
  const [babDebitPlayer, setBabDebitPlayer] = useState("");
  const [babDebitNote, setBabDebitNote] = useState("");
  const [babDebitMsg, setBabDebitMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [babDebitLoading, setBabDebitLoading] = useState(false);
  const [babCreditAmt, setBabCreditAmt] = useState("");
  const [babCreditNote, setBabCreditNote] = useState("");
  const [babCreditMsg, setBabCreditMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [babCreditLoading, setBabCreditLoading] = useState(false);
  // BET settings (sell price + chips rate)
  const [betSettings, setBetSettings] = useState<{ ratePerBet: number; sellPrice: number } | null>(null);
  const [betSettingsSaving, setBetSettingsSaving] = useState(false);
  const [betSettingsMsg, setBetSettingsMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editSell, setEditSell] = useState("");

  function loadBetSettings() {
    bankerApiFetch("/banker/bet-settings").then(r => r.json()).then(d => {
      if (d && d.ratePerBet !== undefined) {
        setBetSettings(d);
        setEditRate(String(d.ratePerBet));
        setEditSell(String(d.sellPrice));
      }
    }).catch(() => {});
  }

  async function saveBetSettings() {
    const rate = parseInt(editRate);
    const sell = parseFloat(editSell);
    if (!rate || rate < 1) { setBetSettingsMsg({ text: "Chips rate must be a positive integer", ok: false }); return; }
    if (!sell || sell <= 0) { setBetSettingsMsg({ text: "Sell price must be a positive number", ok: false }); return; }
    setBetSettingsSaving(true);
    setBetSettingsMsg(null);
    try {
      const r = await bankerApiFetch("/banker/bet-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratePerBet: rate, sellPrice: sell }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setBetSettings({ ratePerBet: d.ratePerBet, sellPrice: d.sellPrice });
      setBetSettingsMsg({ text: "Settings saved!", ok: true });
    } catch (e: any) { setBetSettingsMsg({ text: e.message, ok: false }); }
    setBetSettingsSaving(false);
  }

  async function saveBabalariRate() {
    const rate = parseInt(editBabalariRate);
    const sell = parseFloat(editBabalariSellPrice);
    if (!rate || rate < 1) { setBabalariRateMsg({ text: "Rate must be a positive integer", ok: false }); return; }
    if (!sell || sell <= 0) { setBabalariRateMsg({ text: "Sell price must be a positive number", ok: false }); return; }
    setBabalariRateSaving(true);
    setBabalariRateMsg(null);
    try {
      const r = await bankerApiFetch("/banker/babalari-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ratePerBabalari: rate, sellPrice: sell }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setBabalariStats(prev => prev ? { ...prev, rate: d.ratePerBabalari } : null);
      setBabalariSellPrice(d.sellPrice);
      setBabalariRateMsg({ text: "Settings saved!", ok: true });
    } catch (e: any) { setBabalariRateMsg({ text: e.message, ok: false }); }
    setBabalariRateSaving(false);
  }

  function loadBabalariStats() {
    bankerApiFetch("/banker/babalari-stats").then(r => r.json()).then(d => {
      if (typeof d.total_accepted === "number") {
        setBabalariStats(d);
        setEditBabalariRate(String(d.rate));
        if (d.sell_price !== undefined) {
          setBabalariSellPrice(d.sell_price);
          setEditBabalariSellPrice(String(d.sell_price));
        }
      }
    }).catch(() => {});
  }

  function loadBabalariLedger() {
    setBabalariLedgerLoading(true);
    bankerApiFetch("/banker/babalari-ledger?limit=100").then(r => r.json()).then(d => {
      if (Array.isArray(d)) setBabalariLedger(d);
    }).catch(() => {}).finally(() => setBabalariLedgerLoading(false));
  }

  function loadBabHouseBalance() {
    setBabHouseLoading(true);
    bankerApiFetch("/banker/babalari/balance").then(r => r.json()).then(d => {
      if (d && d.balance !== undefined) setBabHouseBalance(d);
    }).catch(() => {}).finally(() => setBabHouseLoading(false));
  }

  async function submitBabDebit() {
    const amt = parseFloat(babDebitAmt);
    if (!amt || amt <= 0) { setBabDebitMsg({ text: "Enter a valid amount", ok: false }); return; }
    setBabDebitLoading(true); setBabDebitMsg(null);
    try {
      const r = await bankerApiFetch("/banker/babalari/debit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, category: babDebitCat, playerName: babDebitPlayer || undefined, notes: babDebitNote || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setBabDebitMsg({ text: `Logged: ${amt} Babalari out (${babDebitCat})`, ok: true });
      setBabDebitAmt(""); setBabDebitPlayer(""); setBabDebitNote("");
      loadBabHouseBalance(); if (showBabLedger) loadBabalariLedger();
    } catch (e: any) { setBabDebitMsg({ text: e.message, ok: false }); }
    setBabDebitLoading(false);
  }

  async function submitBabCredit() {
    const amt = parseFloat(babCreditAmt);
    if (!amt || amt <= 0) { setBabCreditMsg({ text: "Enter a valid amount", ok: false }); return; }
    setBabCreditLoading(true); setBabCreditMsg(null);
    try {
      const r = await bankerApiFetch("/banker/babalari/credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, notes: babCreditNote || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setBabCreditMsg({ text: `Credited: +${amt} Babalari to inventory`, ok: true });
      setBabCreditAmt(""); setBabCreditNote("");
      loadBabHouseBalance(); if (showBabLedger) loadBabalariLedger();
    } catch (e: any) { setBabCreditMsg({ text: e.message, ok: false }); }
    setBabCreditLoading(false);
  }

  useEffect(() => {
    bankerApiFetch("/banker/bet-deposits/stats").then(r => r.json()).then(d => { if (d && d.total_transactions !== undefined) setBetStats(d); }).catch(() => {});
    loadBetSettings();
    loadBabalariStats();
  }, []);

  // House BET inventory
  const [chipAudit, setChipAudit] = useState<{ totalChipsEverIn: number; totalChipsEverOut: number; expectedInCirculation: number; actualPlayerChips: number; houseChipsSetting: number; conservationGap: number; outstandingLoans: number; loansIssued: number; loansRepaid: number; tourneyBuyins: number; tourneyPayouts: number; tableCloseReturns: number } | null>(null);
  const [houseBet, setHouseBet] = useState<{ total_in: number; total_out: number; balance: number; reserved_for_prizes: number; available_balance: number; tx_count: number; last_updated: string | null } | null>(null);
  const [houseBetLedger, setHouseBetLedger] = useState<any[]>([]);
  const [houseBetLoading, setHouseBetLoading] = useState(false);
  const [houseBetLedgerLoading, setHouseBetLedgerLoading] = useState(false);
  const [showHouseBetLedger, setShowHouseBetLedger] = useState(false);
  // Debit form
  const [hbDebitAmt, setHbDebitAmt] = useState("");
  const [hbDebitCat, setHbDebitCat] = useState("prize");
  const [hbDebitPlayer, setHbDebitPlayer] = useState("");
  const [hbDebitNote, setHbDebitNote] = useState("");
  const [hbDebitMsg, setHbDebitMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [hbDebitLoading, setHbDebitLoading] = useState(false);
  // Credit form (owner only)
  const [hbCreditAmt, setHbCreditAmt] = useState("");
  const [hbCreditNote, setHbCreditNote] = useState("");
  const [hbCreditMsg, setHbCreditMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [hbCreditLoading, setHbCreditLoading] = useState(false);
  // BET Reimbursement queue
  const [betReimburse, setBetReimburse] = useState<any[]>([]);
  const [betReimburseLoading, setBetReimburseLoading] = useState(false);
  const [betReimburseShowAll, setBetReimburseShowAll] = useState(false);
  const [reimbursingId, setReimbursingId] = useState<number | null>(null);

  function loadHouseBet() {
    setHouseBetLoading(true);
    bankerApiFetch("/banker/house-bet/balance")
      .then(r => r.json())
      .then(d => { if (d && d.balance !== undefined) setHouseBet(d); })
      .catch(() => {})
      .finally(() => setHouseBetLoading(false));
  }

  function loadChipAudit() {
    bankerApiFetch("/banker/stats/audit")
      .then(r => r.json())
      .then(d => { if (d && d.conservationGap !== undefined) setChipAudit(d); })
      .catch(() => {});
  }

  function loadHouseBetLedger() {
    setHouseBetLedgerLoading(true);
    bankerApiFetch("/banker/house-bet/ledger?limit=100")
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setHouseBetLedger(d); })
      .catch(() => {})
      .finally(() => setHouseBetLedgerLoading(false));
  }

  function loadBetReimburse(all = betReimburseShowAll) {
    setBetReimburseLoading(true);
    bankerApiFetch(`/prizes/bet-reimbursements?all=${all}`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBetReimburse(d); })
      .catch(() => {})
      .finally(() => setBetReimburseLoading(false));
  }

  async function reimbursePrize(id: number) {
    setReimbursingId(id);
    try {
      await bankerApiFetch(`/prizes/pending/${id}/reimburse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reimbursedBy: staffUsername }),
      });
      loadBetReimburse();
    } finally { setReimbursingId(null); }
  }

  async function submitHouseBetDebit() {
    const amt = parseFloat(hbDebitAmt);
    if (!amt || amt <= 0) { setHbDebitMsg({ text: "Enter a valid amount", ok: false }); return; }
    setHbDebitLoading(true);
    setHbDebitMsg(null);
    try {
      const r = await bankerApiFetch("/banker/house-bet/debit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, category: hbDebitCat, playerName: hbDebitPlayer || undefined, notes: hbDebitNote || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setHbDebitMsg({ text: `Logged: ${amt} BET out (${hbDebitCat})`, ok: true });
      setHbDebitAmt(""); setHbDebitPlayer(""); setHbDebitNote("");
      loadHouseBet(); if (showHouseBetLedger) loadHouseBetLedger();
    } catch (e: any) { setHbDebitMsg({ text: e.message, ok: false }); }
    setHbDebitLoading(false);
  }

  async function submitHouseBetCredit() {
    const amt = parseFloat(hbCreditAmt);
    if (!amt || amt <= 0) { setHbCreditMsg({ text: "Enter a valid amount", ok: false }); return; }
    setHbCreditLoading(true);
    setHbCreditMsg(null);
    try {
      const r = await bankerApiFetch("/banker/house-bet/credit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: amt, category: "restock", notes: hbCreditNote || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setHbCreditMsg({ text: `Restocked: +${amt} BET`, ok: true });
      setHbCreditAmt(""); setHbCreditNote("");
      loadHouseBet(); if (showHouseBetLedger) loadHouseBetLedger();
    } catch (e: any) { setHbCreditMsg({ text: e.message, ok: false }); }
    setHbCreditLoading(false);
  }

  const [preset, setPreset]           = useState<string>("today");
  const [customStart, setCustomStart] = useState(todayEST());
  const [customEnd,   setCustomEnd]   = useState(todayEST());
  const { start, end } = computeRange(preset, customStart, customEnd);

  const [rangeStats,    setRangeStats]    = useState<RangeStats | null>(null);
  const [rangeLoading,  setRangeLoading]  = useState(false);
  const [rangeError,    setRangeError]    = useState<string | null>(null);

  const { data: ltStats, refetch: refetchLt, isLoading: ltLoading } = useGetBankerStats({ query: {} });
  const resetMutation = useResetStats();
  const [confirmReset, setConfirmReset]   = useState(false);
  const [refreshing,   setRefreshing]     = useState(false);
  const canManageFinances = isOwner || isBanker;

  // Loan stats state
  const [loanStats, setLoanStats] = useState<any | null>(null);
  function loadLoanStats() {
    bankerApiFetch("/loans/stats")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setLoanStats(d); })
      .catch(() => {});
  }

  // Live loan monitor
  const [loanMonitor, setLoanMonitor] = useState<any[]>([]);
  const [loanMonitorLoading, setLoanMonitorLoading] = useState(false);
  const [loanMonitorFilter, setLoanMonitorFilter] = useState<"all" | "overdue" | "collections" | "high-risk">("all");
  const [loanSettingsOpen, setLoanSettingsOpen] = useState(false);

  function loadLoanMonitor() {
    setLoanMonitorLoading(true);
    bankerApiFetch("/loans/monitor")
      .then(r => r.ok ? r.json() : [])
      .then(d => { setLoanMonitor(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => setLoanMonitorLoading(false));
  }

  // Employee stats (banker/owner view)
  const [employeeStats, setEmployeeStats] = useState<any[]>([]);
  const [employeeStatsLoading, setEmployeeStatsLoading] = useState(false);

  function loadEmployeeStats() {
    setEmployeeStatsLoading(true);
    bankerApiFetch("/loans/employee-stats")
      .then(r => r.ok ? r.json() : [])
      .then(d => setEmployeeStats(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setEmployeeStatsLoading(false));
  }

  // Commission pay-out modal
  const [payCommModal, setPayCommModal] = useState<{ username: string; owed: number } | null>(null);
  const [payCommAmount, setPayCommAmount] = useState("");
  const [payCommNote, setPayCommNote] = useState("");
  const [payCommLoading, setPayCommLoading] = useState(false);
  const [payCommResult, setPayCommResult] = useState<{ chipsDelivered: boolean; linkedPlayerId: number | null } | null>(null);

  async function submitCommPayout() {
    if (!payCommModal) return;
    const amt = parseInt(payCommAmount, 10);
    if (isNaN(amt) || amt <= 0) return;
    setPayCommLoading(true);
    try {
      const res = await bankerApiFetch("/loans/commissions/pay-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankerUsername: payCommModal.username, amount: amt, note: payCommNote || undefined }),
      });
      if (!res.ok) {
        const d = await res.json();
        showToast(d.error ?? "Failed to process payout");
        return;
      }
      const d = await res.json();
      setPayCommResult({ chipsDelivered: d.chipsDelivered, linkedPlayerId: d.linkedPlayerId });
      loadEmployeeStats();
    } finally {
      setPayCommLoading(false);
    }
  }

  // All loan details (banker/owner full view, or filtered by banker for junior)
  const [allLoanDetails, setAllLoanDetails] = useState<any[]>([]);
  const [allLoanDetailsLoading, setAllLoanDetailsLoading] = useState(false);
  const [loanDetailsFilter, setLoanDetailsFilter] = useState<"all"|"active"|"overdue"|"paid"|"defaulted">("all");
  const [loanDetailsPage, setLoanDetailsPage] = useState(1);
  const LOAN_DETAILS_PAGE_SIZE = 10;

  function loadAllLoanDetails(bankerFilter?: string) {
    setAllLoanDetailsLoading(true);
    const url = bankerFilter ? `/loans/all-details?banker=${encodeURIComponent(bankerFilter)}` : "/loans/all-details";
    bankerApiFetch(url)
      .then(r => r.ok ? r.json() : [])
      .then(d => setAllLoanDetails(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setAllLoanDetailsLoading(false));
  }

  // House finances state
  const [finances, setFinances] = useState<{ crateBalance: number; bankBalance: number; netChipRevenue: number; manualCrate: number; transactions: any[] } | null>(null);
  const [finSource, setFinSource] = useState<"crate" | "bank">("crate");
  const [finType, setFinType] = useState<"deposit" | "withdraw">("deposit");
  const [finAmount, setFinAmount] = useState("");
  const [finReason, setFinReason] = useState("");
  const [finLoading, setFinLoading] = useState(false);
  const [finMsg, setFinMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [finTxFilter, setFinTxFilter] = useState<"all"|"chip_in"|"chip_out"|"vault"|"bank"|"loans"|"gifts">("all");
  const [finTxSearch, setFinTxSearch] = useState("");
  const [finTxPage, setFinTxPage] = useState(1);

  function loadFinances() {
    bankerApiFetch("/banker/house-finances")
      .then(r => r.json())
      .then(d => { if (typeof d.crateBalance === "number") setFinances(d); })
      .catch(() => {});
  }

  async function fetchRangeStats(s: string, e: string) {
    setRangeLoading(true);
    setRangeError(null);
    try {
      const r = await bankerApiFetch(`/banker/stats/range?start=${s}&end=${e}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setRangeStats(d);
    } catch (err: any) {
      setRangeError(err.message || "Failed to load stats");
    }
    setRangeLoading(false);
  }

  useEffect(() => {
    loadLoanStats();
    if (isOwner || isBanker) {
      loadFinances(); loadLoanMonitor(); loadHouseBet(); loadBetReimburse(false); loadChipAudit(); loadSportBetStats(); loadBabHouseBalance(); loadBingoStats(); loadLotteryStats();
    }
    if (isOwner || isBanker) {
      loadEmployeeStats();
      loadAllLoanDetails();
    } else if (isJuniorBanker) {
      loadAllLoanDetails(staffUsername);
      loadEmployeeStats();
    }
  }, []);
  useEffect(() => { if (isOwner || isBanker) fetchRangeStats(start, end); }, [start, end]);

  // Load/refresh data when switching to loans tab
  useEffect(() => {
    if (statsSubTab !== "loans") return;
    if ((isOwner || isBanker) && loanMonitor.length === 0 && !loanMonitorLoading) loadLoanMonitor();
    if ((isOwner || isBanker) && employeeStats.length === 0 && !employeeStatsLoading) loadEmployeeStats();
    if (allLoanDetails.length === 0 && !allLoanDetailsLoading) {
      loadAllLoanDetails(isJuniorBanker && !isOwner && !isBanker ? staffUsername : undefined);
    }
  }, [statsSubTab]);

  async function handleFinanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseInt(finAmount);
    if (isNaN(amt) || amt <= 0) return;
    setFinLoading(true);
    setFinMsg(null);
    try {
      const res = await bankerApiFetch("/banker/house-finances", {
        method: "POST",
        body: JSON.stringify({ source: finSource, type: finType, amount: amt, reason: finReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (typeof data.crateBalance === "number") setFinances(data);
      else loadFinances();
      setFinMsg({ text: `${finType === "deposit" ? "Added" : "Removed"} $${amt.toLocaleString()} ${finType === "deposit" ? "to" : "from"} ${finSource === "crate" ? "Cash in Crate" : "Bank Account"}.`, ok: true });
      setFinAmount("");
      setFinReason("");
    } catch (err: any) {
      setFinMsg({ text: err.message || "Failed", ok: false });
    }
    setFinLoading(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    const tasks: Promise<any>[] = [refetchLt()];
    if (isOwner || isBanker) tasks.push(fetchRangeStats(start, end), new Promise<void>(r => { loadFinances(); loadLoanStats(); loadLoanMonitor(); r(); }));
    tasks.push(new Promise<void>(r => { loadEmployeeStats(); loadAllLoanDetails(isJuniorBanker && !isOwner && !isBanker ? staffUsername : undefined); r(); }));
    await Promise.all(tasks);
    setRefreshing(false);
  }

  async function handleReset() {
    try {
      await resetMutation.mutateAsync();
      refetchLt();
      fetchRangeStats(start, end);
      setConfirmReset(false);
    } catch (err: any) {
      showToast(err?.message || "Failed to reset stats");
    }
  }

  const fmt = (n: number) => n.toLocaleString();
  const fmtDate = (d: string) => {
    const [, m, day] = d.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[parseInt(m) - 1]} ${parseInt(day)}`;
  };

  function rtpBadge(rtp: number | null) {
    if (rtp === null) return null;
    const color = rtp >= 92 && rtp <= 97 ? "bg-green-950 text-green-400 border-green-700"
      : rtp >= 85 ? "bg-yellow-950 text-yellow-400 border-yellow-700"
      : "bg-red-950 text-red-400 border-red-700";
    return <span className={`px-2 py-0.5 rounded-lg text-xs font-bold border ${color}`}>{rtp.toFixed(1)}% RTP</span>;
  }

  const vaultCash = finances?.crateBalance ?? null;
  const bankBal   = finances?.bankBalance ?? null;
  const netCash   = vaultCash !== null && bankBal !== null ? vaultCash + bankBal : null;

  const PRESETS = [
    { id: "today",     label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "7d",        label: "Last 7 Days" },
    { id: "30d",       label: "Last 30 Days" },
    { id: "week",      label: "This Week" },
    { id: "month",     label: "This Month" },
    { id: "custom",    label: "Custom" },
  ];

  const GAME_DEFS = [
    { key: "blackjack", label: "Blackjack",  icon: "🃏" },
    { key: "roulette",  label: "Roulette",   icon: "🎡" },
    { key: "slots",     label: "Slots",      icon: "🎰" },
    { key: "baccarat",  label: "Baccarat",   icon: "🎴" },
    { key: "horse",     label: "Horses",     icon: "🐎" },
    { key: "mines",     label: "Mines",      icon: "💣" },
    { key: "keno",      label: "Keno",       icon: "🎱" },
    { key: "highlow",   label: "High-Low",   icon: "🃏" },
    { key: "mobtower",  label: "Mob Tower",  icon: "🏙️" },
    { key: "cases",     label: "Cases",      icon: "📦" },
    { key: "poker",     label: "Poker",      icon: "♠️" },
  ];

  const summary = rangeStats?.summary;
  const daily   = rangeStats?.daily ?? [];
  const games   = rangeStats?.games ?? {};

  const extLt = ltStats as ExtendedCasinoStats | undefined;

  const ALL_STAT_TABS = [
    { id: "overview",  label: "Overview" },
    { id: "bet",       label: "BET" },
    { id: "babalari",  label: "Babalari" },
    { id: "games",     label: "Games" },
    { id: "players",   label: "Players" },
    { id: "loans",     label: "Loans" },
  ] as const;
  const STAT_TABS = (isJuniorBanker && !isOwner && !isBanker)
    ? ALL_STAT_TABS.filter(t => t.id === "loans")
    : ALL_STAT_TABS;

  // Filtered loan monitor rows
  const filteredMonitor = loanMonitor.filter(row => {
    if (loanMonitorFilter === "overdue") return row.stage === "overdue";
    if (loanMonitorFilter === "collections") return row.stage === "collections";
    if (loanMonitorFilter === "high-risk") return row.riskLevel === "High" || row.riskLevel === "Critical";
    return true;
  });

  const stageBadge = (stage: string) => {
    const cls: Record<string, string> = {
      active:      "bg-green-900 text-green-400",
      overdue:     "bg-yellow-900 text-yellow-400",
      delinquent:  "bg-orange-900 text-orange-400",
      collections: "bg-red-900 text-red-400",
    };
    return <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls[stage] ?? "bg-zinc-900 text-muted-foreground"}`}>{stage}</span>;
  };

  const riskBadge = (risk: string) => {
    const cls: Record<string, string> = {
      Low:      "bg-green-900 text-green-400",
      Medium:   "bg-yellow-900 text-yellow-400",
      High:     "bg-orange-900 text-orange-400",
      Critical: "bg-red-900 text-red-400",
    };
    return <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${cls[risk] ?? "bg-zinc-900 text-muted-foreground"}`}>{risk}</span>;
  };

  // Vault transaction categorisation
  type FinTxCat = "chip_in" | "chip_out" | "vault" | "bank" | "loans" | "gifts";
  function getTxCategory(tx: any): FinTxCat {
    if (tx.type === "bonus") return "gifts";
    const desc: string = (tx.reason ?? "").toLowerCase();
    if (desc.includes("loan #") || desc.includes("loan cash")) return "loans";
    if (!tx.isChipTx) return tx.source === "crate" ? "vault" : "bank";
    return tx.type === "deposit" ? "chip_in" : "chip_out";
  }
  const FIN_TX_PAGE_SIZE = 6;

  // Date range bar — shared between Overview and Games tabs
  const DateRangeBar = () => (
    <div className="bg-card border border-zinc-700 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPreset(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              preset === p.id
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground hover:border-foreground/30"
            }`}>
            {p.label}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">From</span>
          <input type="date" value={customStart} max={customEnd}
            onChange={e => setCustomStart(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-foreground" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={customEnd} min={customStart} max={todayEST()}
            onChange={e => setCustomEnd(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-foreground" />
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-1">
        {!rangeLoading && !rangeError && rangeStats && (
          <p className="text-[10px] text-muted-foreground">
            Showing: <span className="text-foreground font-semibold">{fmtDate(start)}</span>
            {start !== end && <> – <span className="text-foreground font-semibold">{fmtDate(end)}</span></>}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground ml-auto">All stats in Eastern Time (EST/EDT)</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5 max-w-2xl mx-auto">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-display font-semibold text-foreground mb-1">Casino Dashboard</h2>
          <p className="text-xs text-muted-foreground">Big House Casino — Staff View</p>
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="text-xs px-3 py-1.5 rounded-lg bg-card border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* ── Sub-tab bar ── */}
      <div className="flex gap-1 bg-zinc-800 border border-zinc-700 rounded-xl p-1">
        {STAT_TABS.map(t => (
          <button key={t.id} onClick={() => setStatsSubTab(t.id)}
            className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
              statsSubTab === t.id
                ? "bg-card border border-zinc-700 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════
          OVERVIEW TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "overview" && (
        <div className="space-y-5">

          {/* Vault / Cash on Hand */}
          {canManageFinances && (
            <div className="bg-card border border-green-800 rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                <h3 className="font-display font-semibold text-foreground">Vault — Cash on Hand</h3>
                <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground font-semibold border border-zinc-700 rounded px-1.5 py-0.5">Real Money</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-950 border border-green-800 rounded-xl p-4">
                  <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-1">Vault (Cash on Hand)</p>
                  <p className={`text-2xl font-display font-bold ${vaultCash === null ? "text-muted-foreground" : vaultCash >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${vaultCash !== null ? vaultCash.toLocaleString() : "—"}
                  </p>
                  {finances && (
                    <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                      <div className="flex justify-between"><span>Chip revenue</span><span className="text-foreground/70">${finances.netChipRevenue.toLocaleString()}</span></div>
                      {finances.manualCrate !== 0 && (
                        <div className="flex justify-between">
                          <span>Manual adj.</span>
                          <span className={finances.manualCrate >= 0 ? "text-green-400" : "text-red-400"}>
                            {finances.manualCrate >= 0 ? "+" : ""}${finances.manualCrate.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="bg-blue-950 border border-blue-800 rounded-xl p-4">
                  <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold mb-1">Bank Balance</p>
                  <p className={`text-2xl font-display font-bold ${bankBal === null ? "text-muted-foreground" : bankBal >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${bankBal !== null ? bankBal.toLocaleString() : "—"}
                  </p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Net Cash Total</p>
                  <p className={`text-2xl font-display font-bold ${netCash === null ? "text-muted-foreground" : netCash >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${netCash !== null ? netCash.toLocaleString() : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">vault + bank</p>
                </div>
              </div>
              <form onSubmit={handleFinanceSubmit} className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                    <button type="button" onClick={() => setFinSource("crate")}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${finSource === "crate" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                      Vault
                    </button>
                    <button type="button" onClick={() => setFinSource("bank")}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${finSource === "bank" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                      Bank
                    </button>
                  </div>
                  <div className="flex rounded-lg overflow-hidden border border-zinc-700">
                    <button type="button" onClick={() => setFinType("deposit")}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${finType === "deposit" ? "bg-green-600 text-white" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                      + Add
                    </button>
                    <button type="button" onClick={() => setFinType("withdraw")}
                      className={`px-3 py-1.5 text-sm font-medium transition-colors ${finType === "withdraw" ? "bg-red-700 text-white" : "bg-card text-muted-foreground hover:text-foreground"}`}>
                      − Remove
                    </button>
                  </div>
                  <Input type="number" placeholder="Amount" value={finAmount}
                    onChange={(e) => setFinAmount(e.target.value)} className="w-32" min={1} />
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Input placeholder={`Reason (e.g. "${finType === "deposit" ? "Player cash buy-in" : "Payout to owner"}")`}
                      value={finReason} onChange={(e) => setFinReason(e.target.value)} />
                  </div>
                  <Button type="submit" isLoading={finLoading} disabled={!finAmount || parseInt(finAmount) <= 0}
                    className={finType === "withdraw" ? "bg-red-700 hover:bg-red-600" : ""}>
                    {finType === "deposit" ? "Add Funds" : "Remove Funds"}
                  </Button>
                </div>
              </form>
              {finMsg && <p className={`text-sm ${finMsg.ok ? "text-green-400" : "text-destructive"}`}>{finMsg.text}</p>}
              {finances && finances.transactions.length > 0 && (() => {
                const CAT_DEFS: { id: "all"|FinTxCat; label: string; color: string }[] = [
                  { id: "all",      label: "All",      color: "bg-zinc-800 text-foreground" },
                  { id: "chip_in",  label: "Cash In",  color: "bg-green-900 text-green-400" },
                  { id: "chip_out", label: "Cash Out", color: "bg-red-900 text-red-400" },
                  { id: "vault",    label: "Vault",    color: "bg-emerald-900 text-emerald-400" },
                  { id: "bank",     label: "Bank",     color: "bg-blue-900 text-blue-400" },
                  { id: "loans",    label: "Loans",    color: "bg-amber-900 text-amber-400" },
                  { id: "gifts",    label: "Gifts",    color: "bg-purple-900 text-purple-400" },
                ];
                const BADGE_CFG: Record<string, { label: string; cls: string }> = {
                  chip_in:  { label: "Cash In",   cls: "bg-green-900 text-green-400" },
                  chip_out: { label: "Cash Out",  cls: "bg-red-900 text-red-400" },
                  vault:    { label: "Vault",     cls: "bg-emerald-900 text-emerald-400" },
                  bank:     { label: "Bank",      cls: "bg-blue-900 text-blue-400" },
                  loans:    { label: "Loan",      cls: "bg-amber-900 text-amber-400" },
                  gifts:    { label: "Gift",      cls: "bg-purple-900 text-purple-400" },
                };

                const allTxs = finances.transactions;
                const categorised = allTxs.map(tx => ({ ...tx, _cat: getTxCategory(tx) }));

                // Count per category
                const counts: Record<string, number> = { all: allTxs.length };
                for (const c of ["chip_in","chip_out","vault","bank","loans","gifts"]) {
                  counts[c] = categorised.filter(tx => tx._cat === c).length;
                }

                const q = finTxSearch.trim().toLowerCase();
                const filtered = categorised.filter(tx => {
                  if (finTxFilter !== "all" && tx._cat !== finTxFilter) return false;
                  if (q) {
                    const haystack = `${tx.reason ?? ""} ${tx.staffUsername ?? ""}`.toLowerCase();
                    if (!haystack.includes(q)) return false;
                  }
                  return true;
                });

                // Net for filtered view
                const filteredNet = filtered.reduce((sum, tx) =>
                  sum + (tx.type === "deposit" ? tx.amount : tx.type === "bonus" ? 0 : -tx.amount), 0);

                const totalPages = Math.max(1, Math.ceil(filtered.length / FIN_TX_PAGE_SIZE));
                const safePage = Math.min(finTxPage, totalPages);
                const pageSlice = filtered.slice((safePage - 1) * FIN_TX_PAGE_SIZE, safePage * FIN_TX_PAGE_SIZE);

                return (
                  <div className="space-y-3 pt-1">
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Transactions</p>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          placeholder="Search player / staff…"
                          value={finTxSearch}
                          onChange={e => { setFinTxSearch(e.target.value); setFinTxPage(1); }}
                          className="bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 w-44 focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button onClick={() => loadFinances()} className="p-1.5 rounded-lg bg-card border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Filter tabs */}
                    <div className="flex gap-1.5 flex-wrap">
                      {CAT_DEFS.map(cat => (
                        <button key={cat.id}
                          onClick={() => { setFinTxFilter(cat.id as any); setFinTxPage(1); }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                            finTxFilter === cat.id
                              ? `${cat.color} border-current`
                              : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground"
                          }`}>
                          {cat.label}
                          {counts[cat.id] > 0 && (
                            <span className="ml-1 opacity-60">{counts[cat.id]}</span>
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Net bar */}
                    {filtered.length > 0 && (
                      <div className="flex items-center justify-between bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2">
                        <span className="text-[11px] text-muted-foreground font-medium">{filtered.length} transaction{filtered.length !== 1 ? "s" : ""} · net</span>
                        <span className={`text-sm font-display font-bold ${filteredNet >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {filteredNet >= 0 ? "+" : "−"}${Math.abs(filteredNet).toLocaleString()}
                        </span>
                      </div>
                    )}

                    {/* Rows */}
                    {filtered.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No transactions match.</p>
                    ) : (
                      <div className="space-y-0.5">
                        {pageSlice.map((tx: any) => {
                          const badge = BADGE_CFG[tx._cat] ?? { label: tx._cat, cls: "bg-zinc-800 text-foreground" };
                          const isGift = tx.type === "bonus";
                          const isIn = tx.type === "deposit";
                          const amtColor = isGift ? "text-purple-400" : isIn ? "text-green-400" : "text-red-400";
                          const amtPrefix = isGift ? "" : isIn ? "+" : "−";
                          return (
                            <div key={tx.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 text-xs py-2 border-b border-zinc-700 last:border-0">
                              <span className={`shrink-0 whitespace-nowrap px-1.5 py-0.5 rounded font-semibold text-[10px] mt-0.5 ${badge.cls}`}>
                                {badge.label}
                              </span>
                              <div className="min-w-0">
                                <span className="text-foreground/80 block leading-snug" style={{ wordBreak: "break-word" }}>
                                  {tx.reason}
                                </span>
                                <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5 flex-wrap">
                                  {tx.staffUsername && <span className="font-medium text-muted-foreground/80">{tx.staffUsername}</span>}
                                  {tx.staffUsername && tx.createdAt && <span>·</span>}
                                  {tx.createdAt && (
                                    <span className="flex items-center gap-0.5">
                                      <Clock className="w-2.5 h-2.5" />
                                      {fmtETDateTimeShort(tx.createdAt)}
                                    </span>
                                  )}
                                </span>
                              </div>
                              <span className={`shrink-0 font-bold font-display text-sm ${amtColor}`}>
                                {amtPrefix}${tx.amount.toLocaleString()}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <button onClick={() => setFinTxPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                          className="px-3 py-1 rounded-lg bg-card border border-zinc-700 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors">
                          ← Prev
                        </button>
                        <span className="text-[11px] text-muted-foreground">Page {safePage} / {totalPages}</span>
                        <button onClick={() => setFinTxPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                          className="px-3 py-1 rounded-lg bg-card border border-zinc-700 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors">
                          Next →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Date range + period stats */}
          <DateRangeBar />

          {rangeLoading && <div className="text-center py-6 text-sm text-muted-foreground">Loading stats…</div>}
          {rangeError && (
            <div className="text-center py-4 text-sm text-red-400">
              {rangeError}
              <button onClick={() => fetchRangeStats(start, end)} className="ml-3 px-3 py-1 bg-card border border-zinc-700 rounded-lg text-xs text-muted-foreground hover:text-foreground">Retry</button>
            </div>
          )}
          {!rangeLoading && summary && (
            <>
              <div className={`rounded-2xl p-5 border ${summary.netProfit >= 0 ? "bg-green-950 border-green-800" : "bg-red-950 border-red-800"}`}>
                <div className="flex items-center gap-2 mb-1">
                  {summary.netProfit >= 0 ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />}
                  <span className="text-xs uppercase tracking-widest font-semibold text-muted-foreground">Net Profit — Selected Period</span>
                </div>
                <p className={`text-4xl font-display font-bold ${summary.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.netProfit >= 0 ? "+" : "−"}{fmt(Math.abs(summary.netProfit))}
                  <span className="text-base font-normal text-muted-foreground ml-1">chips</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">(Deposits − Withdrawals) + Game Profit + Rake + Sportsbook Net</p>
              </div>
              <div className="grid grid-cols-2 grid-cols-3 gap-3">
                {[
                  { label: "Deposits",        value: summary.deposits,      color: "text-green-400",  sign: "+" },
                  { label: "Withdrawals",     value: summary.withdrawals,   color: "text-red-400",    sign: "−" },
                  { label: "Game Profit",     value: summary.gameProfit,    color: summary.gameProfit >= 0 ? "text-green-400" : "text-red-400", sign: summary.gameProfit >= 0 ? "+" : "−" },
                  { label: "Poker Rake",      value: summary.rake,          color: "text-yellow-400", sign: "+" },
                  { label: "Rakeback Paid",   value: summary.rakebackPaid ?? 0, color: "text-amber-400",  sign: "−" },
                  { label: "Cash in Crate",   value: vaultCash ?? null,     color: vaultCash !== null && vaultCash >= 0 ? "text-green-400" : "text-red-400", sign: "" },
                ].map(card => (
                  <div key={card.label} className="bg-card border border-zinc-700 rounded-xl p-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{card.label}</p>
                    <p className={`text-xl font-display font-bold ${card.color}`}>
                      {card.value === null ? "—" : `${card.sign !== "−" ? card.sign : "−"}${fmt(Math.abs(card.value as number))}`}
                    </p>
                  </div>
                ))}
              </div>

              {/* Sportsbook Payouts — shown whenever sportsbook data exists for the period */}
              {(summary.sportsbookPayouts !== undefined) && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    <p className="text-xs font-display font-semibold text-foreground uppercase tracking-widest">Sportsbook — Selected Period</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      {
                        label: "Wagered",
                        value: summary.sportsbookWagered ?? 0,
                        color: "text-amber-400",
                        sign: "",
                      },
                      {
                        label: "Sportsbook Payouts",
                        value: summary.sportsbookPayouts ?? 0,
                        color: "text-red-400",
                        sign: "−",
                      },
                      {
                        label: "Live-Bet Rake",
                        value: summary.sportsbookRake ?? 0,
                        color: "text-yellow-400",
                        sign: "+",
                      },
                      {
                        label: "Sportsbook Net",
                        value: summary.sportsbookNetProfit ?? 0,
                        color: (summary.sportsbookNetProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400",
                        sign: (summary.sportsbookNetProfit ?? 0) >= 0 ? "+" : "−",
                      },
                    ].map(card => (
                      <div key={card.label} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{card.label}</p>
                        <p className={`text-lg font-display font-bold ${card.color}`}>
                          {card.sign === "−" ? "−" : card.sign}{fmt(Math.abs(card.value))}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Sportsbook Net = Wagered − Payouts + Live-Bet Rake. Included in Net Profit above.</p>
                </div>
              )}
            </>
          )}

          {/* Sport Bets Summary */}
          {sportBetStats && (sportBetStats.totalBets > 0 || sportBetStats.totalEvents > 0) && (
            <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <p className="text-sm font-display font-semibold text-foreground uppercase tracking-wide">Sport Bets — All Time</p>
                <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${sportBetStats.openEvents > 0 ? "bg-green-900 text-green-400" : "bg-zinc-800 text-muted-foreground"}`}>
                  {sportBetStats.openEvents > 0 ? `${sportBetStats.openEvents} Open` : "No Open Events"}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                  <p className="text-lg font-display font-black text-foreground">{sportBetStats.totalEvents}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Events</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                  <p className="text-lg font-display font-black text-amber-400">{fmt(sportBetStats.totalWagered)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Wagered</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                  <p className="text-lg font-display font-black text-green-400">{fmt(sportBetStats.rakeCollected)}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Rake</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                  <p className={`text-lg font-display font-black ${(sportBetStats.totalWagered - sportBetStats.totalPaidOut + sportBetStats.rakeCollected) >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(sportBetStats.totalWagered - sportBetStats.totalPaidOut + sportBetStats.rakeCollected)}
                  </p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mt-0.5">Net Profit</p>
                </div>
              </div>
              {sportBetStats.pendingPayouts > 0 && (
                <div className="flex items-center gap-2 bg-amber-950 border border-amber-800 rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-amber-400">⏳</span>
                  <span className="text-amber-300 font-semibold">{sportBetStats.pendingPayouts} winner{sportBetStats.pendingPayouts !== 1 ? "s" : ""} awaiting payout</span>
                  <span className="text-muted-foreground text-xs ml-1">— go to Sport Bets staff tab</span>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* ══════════════════════════════════════════════
          GAMES TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "games" && (
        <div className="space-y-5">
          <DateRangeBar />

          {rangeLoading && <div className="text-center py-6 text-sm text-muted-foreground">Loading stats…</div>}
          {rangeError && (
            <div className="text-center py-4 text-sm text-red-400">
              {rangeError}
              <button onClick={() => fetchRangeStats(start, end)} className="ml-3 px-3 py-1 bg-card border border-zinc-700 rounded-lg text-xs text-muted-foreground hover:text-foreground">Retry</button>
            </div>
          )}
          {!rangeLoading && summary && (
            <>
              {/* Line chart */}
              {daily.length > 1 && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">Daily Net Profit</p>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={daily} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={fmtDate} />
                      <YAxis tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v) => fmt(v)} width={60} />
                      <Tooltip
                        contentStyle={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8 }}
                        labelStyle={{ color: "#aaa", fontSize: 11 }}
                        itemStyle={{ color: "#22c55e", fontSize: 11 }}
                        formatter={(v: number) => [fmt(v), "Net"]}
                        labelFormatter={fmtDate}
                      />
                      <ReferenceLine y={0} stroke="#555" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="net" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Per-game breakdown table */}
              {GAME_DEFS.some(g => games[g.key] && (games[g.key].bets > 0 || games[g.key].rake > 0)) && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">Game Breakdown — Selected Period</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">Game</th>
                          <th className="text-right pb-2 font-semibold">Bets</th>
                          <th className="text-right pb-2 font-semibold">Paid Out</th>
                          <th className="text-right pb-2 font-semibold">Profit</th>
                          <th className="text-right pb-2 font-semibold">RTP</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        {GAME_DEFS.map(({ key, label, icon }) => {
                          const g = games[key];
                          if (!g || (g.bets === 0 && g.rake === 0)) return null;
                          const profit = key === "poker" ? g.rake : g.profit;
                          const rtp    = key === "poker" ? null : g.rtp;
                          return (
                            <tr key={key} className="border-b border-zinc-700 last:border-0">
                              <td className="py-2 flex items-center gap-1.5 font-medium text-foreground">
                                <span>{icon}</span>{label}
                              </td>
                              <td className="py-2 text-right text-foreground">{key === "poker" ? <span className="text-muted-foreground">—</span> : fmt(g.bets)}</td>
                              <td className="py-2 text-right text-foreground">{key === "poker" ? <span className="text-muted-foreground">—</span> : fmt(g.payouts)}</td>
                              <td className={`py-2 text-right font-bold ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                                {profit >= 0 ? "+" : "−"}{fmt(Math.abs(profit))}
                                {key === "poker" && <span className="text-muted-foreground font-normal"> (rake)</span>}
                              </td>
                              <td className={`py-2 text-right ${rtp === null ? "text-muted-foreground" : rtp >= 92 && rtp <= 97 ? "text-green-400" : rtp >= 85 ? "text-yellow-400" : "text-red-400"}`}>
                                {rtp !== null ? `${rtp.toFixed(1)}%` : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Sport Bets row in Games */}
              {sportBetStats && sportBetStats.totalEvents > 0 && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">Sport Bets — All Time</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">Game</th>
                          <th className="text-right pb-2 font-semibold">Events</th>
                          <th className="text-right pb-2 font-semibold">Wagered</th>
                          <th className="text-right pb-2 font-semibold">Paid Out</th>
                          <th className="text-right pb-2 font-semibold">Rake</th>
                          <th className="text-right pb-2 font-semibold">Net Profit</th>
                          <th className="text-right pb-2 font-semibold">Pending</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        <tr className="border-b border-zinc-700 last:border-0">
                          <td className="py-2 flex items-center gap-1.5 font-medium text-foreground">
                            <span>🏆</span>Sport Bets
                          </td>
                          <td className="py-2 text-right text-foreground">{sportBetStats.totalEvents}</td>
                          <td className="py-2 text-right text-foreground">{fmt(sportBetStats.totalWagered)}</td>
                          <td className="py-2 text-right text-foreground">{fmt(sportBetStats.totalPaidOut)}</td>
                          <td className="py-2 text-right text-yellow-400">+{fmt(sportBetStats.rakeCollected)}</td>
                          <td className={`py-2 text-right font-bold ${(sportBetStats.totalWagered - sportBetStats.totalPaidOut + sportBetStats.rakeCollected) >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {(sportBetStats.totalWagered - sportBetStats.totalPaidOut + sportBetStats.rakeCollected) >= 0 ? "+" : "−"}
                            {fmt(Math.abs(sportBetStats.totalWagered - sportBetStats.totalPaidOut + sportBetStats.rakeCollected))}
                          </td>
                          <td className={`py-2 text-right font-bold ${sportBetStats.pendingPayouts > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {sportBetStats.pendingPayouts > 0 ? `⏳ ${sportBetStats.pendingPayouts}` : "—"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Bingo stats */}
              {bingoStats && bingoStats.totalRounds > 0 && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">🎱 Bingo — All Time</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">Game</th>
                          <th className="text-right pb-2 font-semibold">Rounds</th>
                          <th className="text-right pb-2 font-semibold">Cards Sold</th>
                          <th className="text-right pb-2 font-semibold">Collected</th>
                          <th className="text-right pb-2 font-semibold">Paid Out</th>
                          <th className="text-right pb-2 font-semibold">House Profit</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        <tr className="border-b border-zinc-700 last:border-0">
                          <td className="py-2 flex items-center gap-1.5 font-medium text-foreground"><span>🎱</span>Bingo</td>
                          <td className="py-2 text-right text-foreground">{bingoStats.totalRounds}</td>
                          <td className="py-2 text-right text-foreground">{bingoStats.totalCardsSold.toLocaleString()}</td>
                          <td className="py-2 text-right text-foreground">{bingoStats.totalCollected.toLocaleString()}</td>
                          <td className="py-2 text-right text-foreground">{bingoStats.totalPrizePool.toLocaleString()}</td>
                          <td className={`py-2 text-right font-bold ${bingoStats.totalHouseProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {bingoStats.totalHouseProfit >= 0 ? "+" : "−"}{Math.abs(bingoStats.totalHouseProfit).toLocaleString()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {bingoStats.recentRounds.filter(r => r.status === "completed").length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-2">Recent Rounds</p>
                      <div className="overflow-x-auto max-h-40 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-card">
                            <tr className="text-muted-foreground border-b border-zinc-700">
                              <th className="text-left pb-1.5 font-semibold">Round</th>
                              <th className="text-right pb-1.5 font-semibold">Price</th>
                              <th className="text-right pb-1.5 font-semibold">Cards</th>
                              <th className="text-right pb-1.5 font-semibold">Collected</th>
                              <th className="text-right pb-1.5 font-semibold">Profit</th>
                            </tr>
                          </thead>
                          <tbody className="bg-zinc-950">
                            {bingoStats.recentRounds.filter(r => r.status === "completed").map(r => (
                              <tr key={r.id} className="border-b border-zinc-700 last:border-0">
                                <td className="py-1 text-muted-foreground">#{r.id}</td>
                                <td className="py-1 text-right text-foreground">{r.cardPrice.toLocaleString()}</td>
                                <td className="py-1 text-right text-foreground">{r.totalCardsSold}</td>
                                <td className="py-1 text-right text-foreground">{r.totalCollected.toLocaleString()}</td>
                                <td className={`py-1 text-right font-bold ${r.houseProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                                  {r.houseProfit >= 0 ? "+" : "−"}{Math.abs(r.houseProfit).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Lottery stats */}
              {lotteryStats && lotteryStats.totalDraws > 0 && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">🎟️ Lottery — All Time</p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">Game</th>
                          <th className="text-right pb-2 font-semibold">Draws</th>
                          <th className="text-right pb-2 font-semibold">Tickets Sold</th>
                          <th className="text-right pb-2 font-semibold">Collected</th>
                          <th className="text-right pb-2 font-semibold">Paid Out</th>
                          <th className="text-right pb-2 font-semibold">House Profit</th>
                          <th className="text-right pb-2 font-semibold">Biggest Jackpot</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        <tr className="border-b border-zinc-700 last:border-0">
                          <td className="py-2 flex items-center gap-1.5 font-medium text-foreground"><span>🎟️</span>Lottery</td>
                          <td className="py-2 text-right text-foreground">{lotteryStats.totalDraws}</td>
                          <td className="py-2 text-right text-foreground">{lotteryStats.totalTicketsSold.toLocaleString()}</td>
                          <td className="py-2 text-right text-foreground">{lotteryStats.totalCollected.toLocaleString()}</td>
                          <td className="py-2 text-right text-foreground">{lotteryStats.totalPaidOut.toLocaleString()}</td>
                          <td className={`py-2 text-right font-bold ${lotteryStats.houseProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {lotteryStats.houseProfit >= 0 ? "+" : "−"}{Math.abs(lotteryStats.houseProfit).toLocaleString()}
                          </td>
                          <td className="py-2 text-right text-yellow-400 font-bold">{lotteryStats.biggestJackpot.toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                    <span>🏆 Jackpot winners: <span className="text-foreground font-semibold">{lotteryStats.jackpotWinnerCount}</span></span>
                    <span>🥈 Consolation winners: <span className="text-foreground font-semibold">{lotteryStats.consolationWinnerCount}</span></span>
                  </div>
                  {lotteryStats.recentDraws.filter(d => d.status === "complete").length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-2">Recent Draws</p>
                      <div className="overflow-x-auto max-h-40 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-card">
                            <tr className="text-muted-foreground border-b border-zinc-700">
                              <th className="text-left pb-1.5 font-semibold">Draw</th>
                              <th className="text-right pb-1.5 font-semibold">Tickets</th>
                              <th className="text-right pb-1.5 font-semibold">Collected</th>
                              <th className="text-right pb-1.5 font-semibold">Jackpot</th>
                              <th className="text-right pb-1.5 font-semibold">Result</th>
                            </tr>
                          </thead>
                          <tbody className="bg-zinc-950">
                            {lotteryStats.recentDraws.filter(d => d.status === "complete").map(d => (
                              <tr key={d.id} className="border-b border-zinc-700 last:border-0">
                                <td className="py-1 text-muted-foreground">#{d.id}</td>
                                <td className="py-1 text-right text-foreground">{d.ticketsSold}</td>
                                <td className="py-1 text-right text-foreground">{d.collected.toLocaleString()}</td>
                                <td className="py-1 text-right text-yellow-400">{d.jackpot.toLocaleString()}</td>
                                <td className="py-1 text-right text-muted-foreground">{d.jackpotRolledOver ? "🔄 Rolled" : "✅ Won"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Daily breakdown table */}
              {daily.length > 0 && (
                <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-3">Day-by-Day Breakdown</p>
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">Date</th>
                          <th className="text-right pb-2 font-semibold">Deposits</th>
                          <th className="text-right pb-2 font-semibold">Withdrawals</th>
                          <th className="text-right pb-2 font-semibold">Game Profit</th>
                          <th className="text-right pb-2 font-semibold">Rake</th>
                          <th className="text-right pb-2 font-semibold">Net</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        {[...daily].reverse().map(row => (
                          <tr key={row.date} className="border-b border-zinc-700 last:border-0">
                            <td className="py-1.5 text-muted-foreground font-medium">{fmtDate(row.date)}</td>
                            <td className="py-1.5 text-right text-green-400">{row.deposits > 0 ? `+${fmt(row.deposits)}` : "—"}</td>
                            <td className="py-1.5 text-right text-red-400">{row.withdrawals > 0 ? `−${fmt(row.withdrawals)}` : "—"}</td>
                            <td className={`py-1.5 text-right font-medium ${row.gameProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {row.gameProfit !== 0 ? `${row.gameProfit > 0 ? "+" : "−"}${fmt(Math.abs(row.gameProfit))}` : "—"}
                            </td>
                            <td className="py-1.5 text-right text-yellow-400">{row.rake > 0 ? `+${fmt(row.rake)}` : "—"}</td>
                            <td className={`py-1.5 text-right font-bold ${row.net >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {row.net >= 0 ? "+" : "−"}{fmt(Math.abs(row.net))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Chip Conservation Audit ── */}
          {chipAudit && (
            <div className={`bg-card border rounded-2xl p-4 space-y-3 ${Math.abs(chipAudit.conservationGap) > 1000 ? "border-amber-700" : "border-zinc-700"}`}>
              <div className="flex items-center gap-2">
                <span className="text-base">{Math.abs(chipAudit.conservationGap) > 1000 ? "⚠️" : "✅"}</span>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Chip Conservation Audit</p>
                <button onClick={loadChipAudit} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors border border-zinc-700 rounded px-2 py-0.5">↻ Refresh</button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">All-time chip flows</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total chips ever created</span><span className="text-green-400">{fmt(chipAudit.totalChipsEverIn)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total chips ever destroyed</span><span className="text-red-400">-{fmt(chipAudit.totalChipsEverOut)}</span></div>
                  <div className="flex justify-between border-t border-zinc-700 pt-1"><span className="text-muted-foreground">Expected in circulation</span><span className="font-bold text-foreground">{fmt(chipAudit.expectedInCirculation)}</span></div>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Actual balances</p>
                  <div className="flex justify-between"><span className="text-muted-foreground">Player chips (live sum)</span><span className="text-foreground">{fmt(chipAudit.actualPlayerChips)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Outstanding loans</span><span className="text-amber-400">{fmt(chipAudit.outstandingLoans)}</span></div>
                  <div className="flex justify-between border-t border-zinc-700 pt-1">
                    <span className="text-muted-foreground">Conservation gap</span>
                    <span className={`font-bold ${Math.abs(chipAudit.conservationGap) <= 1000 ? "text-green-400" : Math.abs(chipAudit.conservationGap) <= 50000 ? "text-amber-400" : "text-red-400"}`}>
                      {chipAudit.conservationGap >= 0 ? "+" : ""}{fmt(chipAudit.conservationGap)}
                    </span>
                  </div>
                </div>
              </div>
              {Math.abs(chipAudit.conservationGap) > 1000 && (
                <div className="bg-amber-950 border border-amber-700 rounded-xl p-3 text-xs space-y-1 text-amber-300">
                  <p className="font-semibold text-amber-300">Gap explainers (check these first):</p>
                  {chipAudit.outstandingLoans > 0 && <p>• Outstanding loans: <span className="text-amber-300 font-semibold">{fmt(chipAudit.outstandingLoans)} chips</span> are in player wallets borrowed but not yet repaid</p>}
                  {chipAudit.tourneyBuyins > 0 && <p>• Tournament buy-ins vs payouts: <span className="text-amber-300">{fmt(chipAudit.tourneyBuyins)} in / {fmt(chipAudit.tourneyPayouts)} out</span> (net {fmt(chipAudit.tourneyBuyins - chipAudit.tourneyPayouts)})</p>}
                  {chipAudit.tableCloseReturns > 0 && <p>• Chips returned when tables closed: <span className="text-amber-300">{fmt(chipAudit.tableCloseReturns)}</span></p>}
                  <p className="text-amber-400 pt-1">If gap exceeds outstanding loans + tourney net significantly, check for manually adjusted chips or deleted tables before this fix was deployed.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          PLAYERS TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "players" && (
        <div className="space-y-5">
          {ltLoading && <div className="text-center py-6 text-sm text-muted-foreground">Loading…</div>}
          {extLt && (() => {
            const ltBets = extLt.totalBetsPlaced ?? 0;
            const ltPaid = extLt.totalPaidOut ?? 0;
            const ltProfit = ltBets - ltPaid;
            const ltRtp = ltBets > 0 ? (ltPaid / ltBets) * 100 : null;
            return (
              <div className="space-y-5">
                {/* Top-line metrics */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-center">
                    <p className="text-xl font-display font-bold text-primary">{fmt(extLt.totalChipsInCirculation ?? 0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Chips in Circulation</p>
                  </div>
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-center">
                    <p className="text-xl font-display font-bold text-foreground">{fmt(extLt.totalPlayersRegistered ?? 0)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Registered Players</p>
                  </div>
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 text-center">
                    <p className="text-xl font-display font-bold text-foreground">
                      {fmt((extLt.blackjack?.rounds ?? 0) + (extLt.roulette?.rounds ?? 0) + (extLt.slots?.rounds ?? 0) + (extLt.baccarat?.rounds ?? 0) + ((extLt as any).mines?.rounds ?? 0) + ((extLt as any).keno?.rounds ?? 0) + ((extLt as any).highlow?.rounds ?? 0) + ((extLt as any).mobtower?.rounds ?? 0) + ((extLt as any).cases?.rounds ?? 0))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Total Rounds Played</p>
                  </div>
                </div>

                {/* Lifetime game totals */}
                <div className="bg-card border border-zinc-700 rounded-2xl p-4 space-y-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Lifetime Totals (All Time)</p>
                  <div className="grid grid-cols-3 grid-cols-5 gap-3">
                    {[
                      { label: "Total Bets",      val: fmt(ltBets) },
                      { label: "Total Paid",       val: fmt(ltPaid) },
                      { label: "Profit",           val: `${ltProfit >= 0 ? "+" : ""}${fmt(ltProfit)}`, color: ltProfit >= 0 ? "text-green-400" : "text-red-400" },
                      { label: "Rakeback Paid",    val: fmt((extLt as any).totalRakebackPaid ?? 0), color: "text-amber-400" },
                      { label: "Overall RTP",      val: ltRtp !== null ? `${ltRtp.toFixed(1)}%` : "—", color: ltRtp === null ? "text-muted-foreground" : ltRtp >= 92 && ltRtp <= 97 ? "text-green-400" : ltRtp >= 85 ? "text-yellow-400" : "text-red-400" },
                    ].map(c => (
                      <div key={c.label} className="bg-zinc-900 rounded-xl p-3 text-center">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{c.label}</p>
                        <p className={`text-base font-display font-bold ${(c as any).color ?? "text-foreground"}`}>{c.val}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Per-game lifetime cards */}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: "blackjack", label: "Blackjack", icon: "🃏" },
                    { key: "roulette",  label: "Roulette",  icon: "🎡" },
                    { key: "slots",     label: "Slots",     icon: "🎰" },
                    { key: "baccarat",  label: "Baccarat",  icon: "🎴" },
                    { key: "mines",     label: "Mines",     icon: "💣" },
                    { key: "keno",      label: "Keno",      icon: "🎱" },
                    { key: "highlow",   label: "High-Low",  icon: "🃏" },
                    { key: "mobtower",  label: "Mob Tower", icon: "🏙️" },
                    { key: "cases",     label: "Cases",     icon: "📦" },
                  ]).map(({ key, label, icon }) => {
                    const g = (extLt as any)[key];
                    if (!g || (g.bets === 0 && g.payouts === 0)) return null;
                    const gP = g.bets - g.payouts;
                    const gRtp = g.bets > 0 ? (g.payouts / g.bets) * 100 : null;
                    return (
                      <div key={key} className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground">{icon} {label}</span>
                          {rtpBadge(gRtp)}
                        </div>
                        <div className="flex justify-between text-muted-foreground"><span>Rounds</span><span className="text-foreground">{fmt(g.rounds)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Bets</span><span className="text-foreground">{fmt(g.bets)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Paid out</span><span className="text-foreground">{fmt(g.payouts)}</span></div>
                        <div className="flex justify-between border-t border-zinc-700 pt-1"><span className="text-muted-foreground">Profit</span><span className={`font-bold ${gP >= 0 ? "text-green-400" : "text-red-400"}`}>{gP >= 0 ? "+" : ""}{fmt(gP)}</span></div>
                      </div>
                    );
                  })}
                  {(() => {
                    const g = (extLt as any).lottery;
                    if (!g || (g.bets === 0 && g.payouts === 0)) return null;
                    const gRtp = g.bets > 0 ? (g.payouts / g.bets) * 100 : null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground">🎟️ Lottery</span>
                          {rtpBadge(gRtp)}
                        </div>
                        <div className="flex justify-between text-muted-foreground"><span>Draws</span><span className="text-foreground">{fmt(g.rounds)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Tickets sold</span><span className="text-foreground">{fmt(g.ticketsSold)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Collected</span><span className="text-foreground">{fmt(g.bets)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Paid out</span><span className="text-foreground">{fmt(g.payouts)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Jackpot wins</span><span className="text-yellow-400">{g.jackpotWins}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Consolation wins</span><span className="text-foreground">{g.consolationWins}</span></div>
                        <div className="flex justify-between border-t border-zinc-700 pt-1"><span className="text-muted-foreground">House profit</span><span className={`font-bold ${g.profit >= 0 ? "text-green-400" : "text-red-400"}`}>{g.profit >= 0 ? "+" : ""}{fmt(g.profit)}</span></div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const g = (extLt as any).bingo;
                    if (!g || (g.bets === 0 && g.payouts === 0)) return null;
                    const gRtp = g.bets > 0 ? (g.payouts / g.bets) * 100 : null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-foreground">🎱 Bingo</span>
                          {rtpBadge(gRtp)}
                        </div>
                        <div className="flex justify-between text-muted-foreground"><span>Rounds</span><span className="text-foreground">{fmt(g.rounds)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Cards sold</span><span className="text-foreground">{fmt(g.cardsSold)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Collected</span><span className="text-foreground">{fmt(g.bets)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Prize pool paid</span><span className="text-foreground">{fmt(g.payouts)}</span></div>
                        <div className="flex justify-between border-t border-zinc-700 pt-1"><span className="text-muted-foreground">House profit</span><span className={`font-bold ${g.profit >= 0 ? "text-green-400" : "text-red-400"}`}>{g.profit >= 0 ? "+" : ""}{fmt(g.profit)}</span></div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const pr = extLt.poker?.rake ?? 0;
                    const pt = extLt.poker?.tournamentHouseRake ?? 0;
                    if (pr + pt === 0) return null;
                    return (
                      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 space-y-1.5 text-xs">
                        <span className="font-semibold text-foreground">♠️ Poker (rake)</span>
                        <div className="flex justify-between text-muted-foreground"><span>Cash rake</span><span className="text-green-400">+{fmt(pr)}</span></div>
                        <div className="flex justify-between text-muted-foreground"><span>Tournament cut</span><span className="text-green-400">+{fmt(pt)}</span></div>
                        <div className="flex justify-between border-t border-zinc-700 pt-1"><span className="text-muted-foreground">Total</span><span className="font-bold text-green-400">+{fmt(pr + pt)}</span></div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════
          LOANS TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "loans" && canManageLoanStats && (() => {
        const isJuniorOnly = isJuniorBanker && !isOwner && !isBanker;
        const myStats = employeeStats.find(e => e.username === staffUsername);

        // Shared all-loan details filtered view
        const filteredLoanDetails = allLoanDetails.filter(l => {
          if (loanDetailsFilter === "all") return true;
          if (loanDetailsFilter === "overdue") return ["overdue","delinquent","collections"].includes(l.effectiveStatus);
          return l.effectiveStatus === loanDetailsFilter;
        });
        const totalLoanPages = Math.max(1, Math.ceil(filteredLoanDetails.length / LOAN_DETAILS_PAGE_SIZE));
        const safeLoanPage = Math.min(loanDetailsPage, totalLoanPages);
        const loanPageSlice = filteredLoanDetails.slice((safeLoanPage - 1) * LOAN_DETAILS_PAGE_SIZE, safeLoanPage * LOAN_DETAILS_PAGE_SIZE);

        const loanStatusBadge = (status: string) => {
          const cls: Record<string, string> = {
            active: "bg-green-900 text-green-400",
            overdue: "bg-yellow-900 text-yellow-400",
            delinquent: "bg-orange-900 text-orange-400",
            collections: "bg-red-950 text-red-400",
            paid: "bg-blue-900 text-blue-400",
            defaulted: "bg-red-900 text-red-500",
          };
          return <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${cls[status] ?? "bg-zinc-900 text-muted-foreground"}`}>{status}</span>;
        };

        return (
          <div className="space-y-5">

            {/* ── MY PERFORMANCE (all users) ── */}
            <div className="bg-card border border-amber-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Landmark className="w-5 h-5 text-amber-400" />
                  <h3 className="font-display font-semibold text-foreground">
                    {isJuniorOnly ? "My Loan Performance" : `My Performance — ${staffUsername}`}
                  </h3>
                </div>
                <button onClick={() => { loadEmployeeStats(); loadAllLoanDetails(isJuniorOnly ? staffUsername : undefined); }}
                  disabled={employeeStatsLoading || allLoanDetailsLoading}
                  className="text-xs px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                  {(employeeStatsLoading || allLoanDetailsLoading) ? "Loading…" : "↻ Refresh"}
                </button>
              </div>
              {myStats ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 grid-cols-4">
                    <div className="bg-amber-950 border border-amber-800 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Loans Issued</p>
                      <p className="text-2xl font-display font-bold text-amber-400">{myStats.totalLoans}</p>
                    </div>
                    <div className="bg-green-950 border border-green-800 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-1">Paid Off</p>
                      <p className="text-2xl font-display font-bold text-green-400">{myStats.paidLoans}</p>
                    </div>
                    <div className="bg-yellow-950 border border-yellow-800 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold mb-1">Overdue</p>
                      <p className="text-2xl font-display font-bold text-yellow-400">{myStats.overdueLoans}</p>
                    </div>
                    <div className="bg-red-950 border border-red-800 rounded-xl p-3 text-center">
                      <p className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-1">Defaulted</p>
                      <p className="text-2xl font-display font-bold text-red-400">{myStats.defaultedLoans}</p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-amber-950/40 to-green-950/40 border border-amber-700 rounded-xl p-4">
                    <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-2">Commission Earned (50% of interest collected)</p>
                    <div className="flex items-end gap-4 flex-wrap">
                      <div>
                        <p className="text-3xl font-display font-black text-amber-400">{(myStats.totalCommission ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">chips owed to you</p>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5 pb-0.5">
                        <div className="flex gap-2"><span className="text-foreground/60">Total interest collected:</span><span className="text-blue-400 font-semibold">{(myStats.totalInterestCollected ?? 0).toLocaleString()}</span></div>
                        <div className="flex gap-2"><span className="text-foreground/60">Casino's 50% share:</span><span className="text-green-400 font-semibold">{(myStats.totalCasinoRevenue ?? 0).toLocaleString()}</span></div>
                        <div className="flex gap-2"><span className="text-foreground/60">Principal issued:</span><span className="text-foreground font-semibold">{(myStats.totalPrincipal ?? 0).toLocaleString()}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : employeeStatsLoading ? (
                <p className="text-xs text-muted-foreground text-center py-3">Loading…</p>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-3">No loan activity yet under your account.</p>
              )}
            </div>

            {/* ── MY LOANS TABLE (filtered to user for junior, all for banker/owner) ── */}
            <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-display font-semibold text-foreground text-sm">
                  {isJuniorOnly ? "My Active Loans" : "All Loans — Full Ledger"}
                </h3>
                <div className="flex gap-1 flex-wrap">
                  {(["all","active","overdue","paid","defaulted"] as const).map(f => (
                    <button key={f} onClick={() => { setLoanDetailsFilter(f); setLoanDetailsPage(1); }}
                      className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${
                        loanDetailsFilter === f
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground"
                      }`}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {allLoanDetailsLoading ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
              ) : filteredLoanDetails.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No loans match this filter.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-zinc-700">
                          <th className="text-left pb-2 font-semibold">ID</th>
                          <th className="text-left pb-2 font-semibold pl-2">Player</th>
                          {!isJuniorOnly && <th className="text-left pb-2 font-semibold pl-2">Issued By</th>}
                          <th className="text-right pb-2 font-semibold">Principal</th>
                          <th className="text-right pb-2 font-semibold">Interest</th>
                          <th className="text-right pb-2 font-semibold">Balance</th>
                          <th className="text-left pb-2 font-semibold pl-2">Status</th>
                          <th className="text-left pb-2 font-semibold pl-2">Due</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950">
                        {loanPageSlice.map(loan => (
                          <tr key={loan.id} className="border-b border-zinc-700 last:border-0 hover:bg-zinc-900">
                            <td className="py-2 text-muted-foreground font-mono">#{loan.id}</td>
                            <td className="py-2 pl-2 font-medium text-foreground">{loan.playerName}</td>
                            {!isJuniorOnly && <td className="py-2 pl-2 text-muted-foreground">{loan.bankerUsername}</td>}
                            <td className="py-2 text-right text-amber-400 font-semibold">{loan.principalAmount.toLocaleString()}</td>
                            <td className="py-2 text-right text-blue-400">{loan.interestTotal.toLocaleString()} <span className="text-muted-foreground">({loan.interestRate}%)</span></td>
                            <td className={`py-2 text-right font-bold ${loan.remainingBalance === 0 ? "text-green-400" : loan.effectiveStatus === "overdue" || loan.effectiveStatus === "delinquent" || loan.effectiveStatus === "collections" ? "text-red-400" : "text-foreground"}`}>
                              {loan.remainingBalance.toLocaleString()}
                            </td>
                            <td className="py-2 pl-2">{loanStatusBadge(loan.effectiveStatus)}</td>
                            <td className="py-2 pl-2 text-muted-foreground text-[10px]">{loan.dueDate ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalLoanPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <button onClick={() => setLoanDetailsPage(p => Math.max(1, p - 1))} disabled={safeLoanPage <= 1}
                        className="px-3 py-1 rounded-lg bg-card border border-zinc-700 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors">← Prev</button>
                      <span className="text-[11px] text-muted-foreground">Page {safeLoanPage} / {totalLoanPages} · {filteredLoanDetails.length} loans</span>
                      <button onClick={() => setLoanDetailsPage(p => Math.min(totalLoanPages, p + 1))} disabled={safeLoanPage >= totalLoanPages}
                        className="px-3 py-1 rounded-lg bg-card border border-zinc-700 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition-colors">Next →</button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── HEAD BANKER SECTIONS (banker/owner only) ── */}
            {canManageFinances && (
              <>
                {/* CASINO-WIDE LOAN OVERVIEW */}
                {loanStats && (
                  <>
                    <div className="bg-card border border-amber-800 rounded-2xl p-5 space-y-4">
                      <div className="flex items-center gap-2">
                        <Landmark className="w-5 h-5 text-amber-400" />
                        <h3 className="font-display font-semibold text-foreground">Casino-Wide Loan Overview</h3>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-amber-950 border border-amber-800 rounded-xl p-4">
                          <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Total Loaned Out</p>
                          <p className="text-2xl font-display font-bold text-amber-400">{loanStats.totalLoaned.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">chips issued as loans</p>
                        </div>
                        <div className="bg-green-950 border border-green-800 rounded-xl p-4">
                          <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-1">Total Repaid</p>
                          <p className="text-2xl font-display font-bold text-green-400">{loanStats.totalRepaid.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">chips recovered</p>
                        </div>
                        <div className="bg-blue-950 border border-blue-800 rounded-xl p-4">
                          <p className="text-[10px] text-blue-400 uppercase tracking-widest font-bold mb-1">Interest Earned</p>
                          <p className="text-2xl font-display font-bold text-blue-400">{loanStats.interestEarned.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">from fully paid loans</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Active Outstanding</p>
                          <p className="text-xl font-display font-bold text-foreground">{loanStats.activeOutstanding.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">{loanStats.activeCount} active loan{loanStats.activeCount !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="bg-red-950 border border-red-800 rounded-xl p-4">
                          <p className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-1">Default Losses</p>
                          <p className="text-xl font-display font-bold text-red-400">{loanStats.defaultedLosses.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground mt-1">chips never recovered</p>
                        </div>
                        <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Net Position</p>
                          <p className={`text-xl font-display font-bold ${loanStats.totalRepaid - loanStats.totalLoaned >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {(loanStats.totalRepaid - loanStats.totalLoaned).toLocaleString()}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">repaid minus loaned</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Avg Loan Size</p>
                          <p className="text-lg font-display font-bold text-foreground">{(loanStats.avgLoanSize ?? 0).toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">chips</p>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Default Rate</p>
                          <p className={`text-lg font-display font-bold ${(loanStats.defaultRate ?? 0) > 20 ? "text-red-400" : (loanStats.defaultRate ?? 0) > 10 ? "text-yellow-400" : "text-green-400"}`}>
                            {(loanStats.defaultRate ?? 0).toFixed(1)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">of all loans</p>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">High-Risk Players</p>
                          <p className="text-lg font-display font-bold text-orange-400">{loanStats.riskyPlayerCount ?? 0}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">score below 400</p>
                        </div>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Total Loans</p>
                          <p className="text-lg font-display font-bold text-foreground">{loanStats.totalLoanCount ?? 0}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">all time</p>
                        </div>
                      </div>
                    </div>
                    {loanStats.avgCreditScore != null && (
                      <div className="bg-card border border-indigo-800 rounded-2xl p-5 space-y-4">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-5 h-5 text-indigo-400" />
                          <h3 className="font-display font-semibold text-foreground">Credit Risk Overview</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-3 grid-cols-4">
                          <div className="bg-indigo-950 border border-indigo-800 rounded-xl p-4">
                            <p className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold mb-1">Avg Credit Score</p>
                            <p className="text-2xl font-display font-bold text-indigo-400">{Math.round(loanStats.avgCreditScore)}</p>
                            <p className="text-xs text-muted-foreground mt-1">across all borrowers</p>
                          </div>
                          <div className="bg-yellow-950 border border-yellow-800 rounded-xl p-4">
                            <p className="text-[10px] text-yellow-400 uppercase tracking-widest font-bold mb-1">Risky Borrowers</p>
                            <p className="text-2xl font-display font-bold text-yellow-400">{(loanStats.riskyPercent ?? 0).toFixed(1)}%</p>
                            <p className="text-xs text-muted-foreground mt-1">score below 400</p>
                          </div>
                          <div className="bg-red-950 border border-red-800 rounded-xl p-4">
                            <p className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-1">Defaulted Loans</p>
                            <p className="text-2xl font-display font-bold text-red-400">{loanStats.defaultedCount ?? 0}</p>
                            <p className="text-xs text-muted-foreground mt-1">total on record</p>
                          </div>
                          <div className="bg-orange-950 border border-orange-800 rounded-xl p-4">
                            <p className="text-[10px] text-orange-400 uppercase tracking-widest font-bold mb-1">Outstanding Risk</p>
                            <p className="text-2xl font-display font-bold text-orange-400">{(loanStats.totalOutstandingRisk ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-muted-foreground mt-1">chips in risky loans</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* EMPLOYEE COMMISSION BREAKDOWN */}
                <div className="bg-card border border-green-800 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-green-400" />
                      <h3 className="font-display font-semibold text-foreground">Employee Loan Commission</h3>
                      <span className="text-[10px] text-muted-foreground border border-zinc-700 rounded px-1.5 py-0.5">50% of interest to employee</span>
                    </div>
                    <button onClick={loadEmployeeStats} disabled={employeeStatsLoading}
                      className="text-xs px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                      {employeeStatsLoading ? "Loading…" : "↻ Refresh"}
                    </button>
                  </div>
                  {employeeStatsLoading ? (
                    <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
                  ) : employeeStats.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No loan activity recorded yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-zinc-700">
                            <th className="text-left pb-2 font-semibold">Employee</th>
                            <th className="text-right pb-2 font-semibold">Loans</th>
                            <th className="text-right pb-2 font-semibold">Active</th>
                            <th className="text-right pb-2 font-semibold">Overdue</th>
                            <th className="text-right pb-2 font-semibold">Paid</th>
                            <th className="text-right pb-2 font-semibold">Defaulted</th>
                            <th className="text-right pb-2 font-semibold">Interest Collected</th>
                            <th className="text-right pb-2 font-semibold text-green-400">Owed (Unpaid)</th>
                            <th className="text-right pb-2 font-semibold text-foreground/50">Total Earned</th>
                            <th className="text-right pb-2 font-semibold text-blue-400">Casino Cut</th>
                            <th className="pb-2"></th>
                          </tr>
                        </thead>
                        <tbody className="bg-zinc-950">
                          {employeeStats.map(emp => {
                            const owed = emp.unpaidCommission ?? 0;
                            return (
                              <tr key={emp.username} className="border-b border-zinc-700 last:border-0 hover:bg-zinc-900">
                                <td className="py-2.5 font-semibold text-foreground">{emp.username}</td>
                                <td className="py-2.5 text-right text-amber-400 font-bold">{emp.totalLoans}</td>
                                <td className="py-2.5 text-right text-green-400">{emp.activeLoans}</td>
                                <td className={`py-2.5 text-right font-semibold ${emp.overdueLoans > 0 ? "text-yellow-400" : "text-muted-foreground"}`}>{emp.overdueLoans}</td>
                                <td className="py-2.5 text-right text-blue-400">{emp.paidLoans}</td>
                                <td className={`py-2.5 text-right font-semibold ${emp.defaultedLoans > 0 ? "text-red-400" : "text-muted-foreground"}`}>{emp.defaultedLoans}</td>
                                <td className="py-2.5 text-right text-foreground/70">{(emp.totalInterestCollected ?? 0).toLocaleString()}</td>
                                <td className={`py-2.5 text-right font-black text-lg leading-none ${owed > 0 ? "text-green-400" : "text-muted-foreground"}`}>{owed.toLocaleString()}</td>
                                <td className="py-2.5 text-right text-foreground/40 text-[11px]">{(emp.totalCommission ?? 0).toLocaleString()}</td>
                                <td className="py-2.5 text-right text-blue-400">{(emp.totalCasinoRevenue ?? 0).toLocaleString()}</td>
                                <td className="py-2.5 pl-2">
                                  {owed > 0 ? (
                                    <button
                                      onClick={() => { setPayCommModal({ username: emp.username, owed }); setPayCommAmount(String(owed)); setPayCommNote(""); setPayCommResult(null); }}
                                      className="px-2.5 py-1 rounded-lg bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold transition-colors whitespace-nowrap">
                                      Pay Out
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground px-1">✓ Settled</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        {employeeStats.length > 1 && (
                          <tfoot>
                            <tr className="border-t border-zinc-700 text-muted-foreground">
                              <td className="pt-2 font-semibold" colSpan={6}>Totals</td>
                              <td className="pt-2 text-right text-foreground/70 font-semibold">{employeeStats.reduce((s,e) => s + (e.totalInterestCollected ?? 0), 0).toLocaleString()}</td>
                              <td className="pt-2 text-right text-green-400 font-bold">{employeeStats.reduce((s,e) => s + (e.unpaidCommission ?? 0), 0).toLocaleString()}</td>
                              <td className="pt-2 text-right text-foreground/40 text-[11px]">{employeeStats.reduce((s,e) => s + (e.totalCommission ?? 0), 0).toLocaleString()}</td>
                              <td className="pt-2 text-right text-blue-400 font-bold">{employeeStats.reduce((s,e) => s + (e.totalCasinoRevenue ?? 0), 0).toLocaleString()}</td>
                              <td></td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>

                {/* LIVE LOAN MONITOR */}
                <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-foreground" />
                      <h3 className="font-display font-semibold text-foreground">Live Loan Monitor</h3>
                      {loanMonitor.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-muted-foreground font-semibold">{loanMonitor.length} open</span>
                      )}
                    </div>
                    <button onClick={loadLoanMonitor} disabled={loanMonitorLoading}
                      className="text-xs px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                      {loanMonitorLoading ? "Loading…" : "↻ Refresh"}
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { id: "all", label: "All" },
                      { id: "overdue", label: "Overdue" },
                      { id: "collections", label: "Collections" },
                      { id: "high-risk", label: "High Risk" },
                    ] as const).map(f => (
                      <button key={f.id} onClick={() => setLoanMonitorFilter(f.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${loanMonitorFilter === f.id ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-zinc-700 hover:text-foreground"}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {loanMonitorLoading && <p className="text-sm text-muted-foreground text-center py-4">Loading loans…</p>}
                  {!loanMonitorLoading && filteredMonitor.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{loanMonitor.length === 0 ? "No open loans." : "No loans match this filter."}</p>
                  )}
                  {!loanMonitorLoading && filteredMonitor.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-zinc-700">
                            <th className="text-left pb-2 font-semibold">Player</th>
                            <th className="text-left pb-2 font-semibold pl-2">Issued By</th>
                            <th className="text-right pb-2 font-semibold">Credit</th>
                            <th className="text-left pb-2 font-semibold pl-3">Tier</th>
                            <th className="text-right pb-2 font-semibold">Balance</th>
                            <th className="text-left pb-2 font-semibold pl-3">Stage</th>
                            <th className="text-left pb-2 font-semibold pl-3">Risk</th>
                          </tr>
                        </thead>
                        <tbody className="bg-zinc-950">
                          {filteredMonitor.map(row => (
                            <tr key={row.loanId} className="border-b border-zinc-700 last:border-0 hover:bg-zinc-900">
                              <td className="py-2 font-medium text-foreground">{row.playerName}</td>
                              <td className="py-2 pl-2 text-muted-foreground">{row.bankerUsername ?? "—"}</td>
                              <td className={`py-2 text-right font-bold ${row.creditScore >= 600 ? "text-green-400" : row.creditScore >= 400 ? "text-yellow-400" : "text-red-400"}`}>{row.creditScore}</td>
                              <td className="py-2 pl-3 text-muted-foreground">{row.loanTierName}</td>
                              <td className="py-2 text-right font-semibold text-foreground">{row.remainingBalance.toLocaleString()}</td>
                              <td className="py-2 pl-3">{stageBadge(row.stage)}</td>
                              <td className="py-2 pl-3">{riskBadge(row.riskLevel)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* LOAN SETTINGS (collapsible) */}
                <div className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
                  <button onClick={() => setLoanSettingsOpen(v => !v)}
                    className="w-full flex items-center justify-between p-4 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">
                    <span className="flex items-center gap-2"><Settings className="w-4 h-4" /> Loan System Settings</span>
                    {loanSettingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {loanSettingsOpen && (
                    <div className="border-t border-zinc-700">
                      <LoanSettingsPanel />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════
          COMMISSION PAY-OUT MODAL
      ══════════════════════════════════════════════ */}
      {payCommModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="bg-card border border-green-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-zinc-700">
              <div>
                <h2 className="font-display font-bold text-foreground">Pay Commission</h2>
                <p className="text-xs text-muted-foreground mt-0.5">to <span className="text-foreground font-semibold">{payCommModal.username}</span></p>
              </div>
              <button onClick={() => { setPayCommModal(null); setPayCommResult(null); }}
                className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">✕</button>
            </div>

            {payCommResult ? (
              <div className="p-5 space-y-4">
                <div className="bg-green-950 border border-green-700 rounded-xl p-4 text-center space-y-1">
                  <p className="text-green-400 font-bold text-lg font-display">✓ Commission Paid</p>
                  <p className="text-sm text-muted-foreground">
                    {parseInt(payCommAmount, 10).toLocaleString()} chips marked as settled
                  </p>
                  {payCommResult.chipsDelivered ? (
                    <p className="text-xs text-green-400 mt-1">
                      Chips delivered directly to their player account
                    </p>
                  ) : (
                    <p className="text-xs text-amber-400 mt-1">
                      No linked player account — record-keeping only. Pay them manually in-game.
                    </p>
                  )}
                </div>
                <button onClick={() => { setPayCommModal(null); setPayCommResult(null); }}
                  className="w-full py-2 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold text-sm transition-colors">
                  Done
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* Owed banner */}
                <div className="bg-amber-950 border border-amber-800 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-0.5">Total Owed</p>
                    <p className="text-2xl font-display font-black text-amber-400">{payCommModal.owed.toLocaleString()}</p>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    <p>Unpaid commission</p>
                    <p className="text-[10px] mt-0.5">from loan interest earnings</p>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1.5">Amount to Pay</label>
                  <div className="flex gap-2">
                    <input
                      type="number" min={1} max={payCommModal.owed}
                      value={payCommAmount}
                      onChange={e => setPayCommAmount(e.target.value)}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
                      placeholder="0"
                    />
                    <button onClick={() => setPayCommAmount(String(payCommModal.owed))}
                      className="px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-xl text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
                      Pay All
                    </button>
                  </div>
                  {parseInt(payCommAmount, 10) > payCommModal.owed && (
                    <p className="text-[11px] text-red-400 mt-1">Cannot exceed owed amount ({payCommModal.owed.toLocaleString()})</p>
                  )}
                </div>

                {/* Optional note */}
                <div>
                  <label className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1.5">Note (optional)</label>
                  <input type="text" value={payCommNote} onChange={e => setPayCommNote(e.target.value)}
                    placeholder="e.g. Weekly payout — Week 1"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>

                {/* Info about chip delivery */}
                <p className="text-[11px] text-muted-foreground border border-zinc-700 rounded-lg px-3 py-2">
                  If this employee has a linked player account (via their State ID in Account Settings), chips will be deposited automatically. Otherwise the payout is recorded as a manual in-game payment.
                </p>

                <div className="flex gap-3">
                  <button onClick={() => setPayCommModal(null)}
                    className="flex-1 py-2 rounded-xl bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground text-sm transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={submitCommPayout}
                    disabled={payCommLoading || !parseInt(payCommAmount, 10) || parseInt(payCommAmount, 10) > payCommModal.owed}
                    className="flex-1 py-2 rounded-xl bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
                    {payCommLoading ? "Processing…" : `Pay ${parseInt(payCommAmount, 10) > 0 ? parseInt(payCommAmount, 10).toLocaleString() : "—"} chips`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════
          BET TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "bet" && (
        <div className="space-y-5">

          {/* ── Volume Summary ─────────────────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-base font-display font-bold text-cyan-300">BET Currency</span>
              <span className="text-xs text-muted-foreground ml-auto">All-time totals</span>
            </div>
            {betStats ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Total BET Deposited</p>
                  <p className="text-2xl font-display font-black text-cyan-300">{Number(betStats.total_bet).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">BET · across {Number(betStats.total_transactions).toLocaleString()} deposits</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Chips Issued</p>
                  <p className="text-2xl font-display font-black text-foreground">{Number(betStats.total_chips).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">chips · {Number(betStats.unique_players).toLocaleString()} players</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">House BET Available</p>
                  <p className={`text-2xl font-display font-black ${houseBet && Number(houseBet.available_balance) >= 0 ? "text-cyan-300" : "text-red-400"}`}>{houseBet ? Number(houseBet.available_balance).toLocaleString() : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{houseBet && Number(houseBet.reserved_for_prizes) > 0 ? `${Number(houseBet.reserved_for_prizes).toLocaleString()} reserved for prizes` : "BET on hand"}</p>
                </div>
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Revenue Value</p>
                  <p className="text-2xl font-display font-black text-green-400">${betSettings ? (Number(betStats.total_bet) * betSettings.sellPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">at current sell price</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No deposit data yet.</p>
            )}
          </div>

          {/* ── BET Settings (Owner only) ─────────────── */}
          {isOwner && (
            <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground">BET Rates &amp; Pricing</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-2">
                    Chips per 1 BET
                  </label>
                  <input type="number" min="1" step="1" value={editRate} onChange={e => setEditRate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
                  <p className="text-[10px] text-muted-foreground mt-1">e.g. 250 means 400 BET → 100,000 chips</p>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-2">
                    Sell Price per BET ($)
                  </label>
                  <input type="number" min="0.01" step="0.01" value={editSell} onChange={e => setEditSell(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
                  <p className="text-[10px] text-muted-foreground mt-1">What the house charges per BET sold</p>
                </div>
              </div>
              {betSettings && (
                <div className="rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-xs text-muted-foreground space-y-1">
                  <p>Current: <span className="text-foreground font-semibold">1 BET = {betSettings.ratePerBet.toLocaleString()} chips</span> · <span className="text-foreground font-semibold">${betSettings.sellPrice.toFixed(2)} per BET</span></p>
                  <p>Example: 400 BET deposited → {(400 * betSettings.ratePerBet).toLocaleString()} chips issued · ${(400 * betSettings.sellPrice).toFixed(2)} revenue</p>
                </div>
              )}
              {betSettingsMsg && <p className={`text-xs ${betSettingsMsg.ok ? "text-green-400" : "text-red-400"}`}>{betSettingsMsg.text}</p>}
              <button type="button" onClick={saveBetSettings} disabled={betSettingsSaving}
                className="w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-50">
                {betSettingsSaving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          )}

          {/* ── House BET Inventory ───────────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">House Inventory</p>
              <button type="button" onClick={() => { loadHouseBet(); if (showHouseBetLedger) loadHouseBetLedger(); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded-lg border border-zinc-700 hover:border-zinc-700 transition-colors">
                {houseBetLoading ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>

            {houseBet ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-cyan-950 border border-cyan-800 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold mb-1">Available</p>
                    <p className={`text-2xl font-display font-black ${Number(houseBet.available_balance) >= 0 ? "text-cyan-300" : "text-red-400"}`}>{Number(houseBet.available_balance).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">free to spend</p>
                  </div>
                  <div className="bg-amber-950 border border-amber-800 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Reserved for Prizes</p>
                    <p className="text-2xl font-display font-black text-amber-300">{Number(houseBet.reserved_for_prizes).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">stocked BET prizes</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Total Balance</p>
                    <p className="text-lg font-display font-bold text-foreground">{Number(houseBet.balance).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">in + out</p>
                  </div>
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Total In</p>
                    <p className="text-lg font-display font-bold text-green-400">+{Number(houseBet.total_in).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">received</p>
                  </div>
                  <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Total Out</p>
                    <p className="text-lg font-display font-bold text-red-400">-{Number(houseBet.total_out).toLocaleString()}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">spent</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">{houseBetLoading ? "Loading…" : "No inventory data yet."}</p>
            )}

            {/* Log BET Out */}
            <div className="space-y-3 pt-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Log BET Out</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1.5">Amount (BET)</label>
                  <input type="number" min="0.01" step="0.01" value={hbDebitAmt} onChange={e => setHbDebitAmt(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" placeholder="e.g. 50" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1.5">Purpose</label>
                  <select value={hbDebitCat} onChange={e => setHbDebitCat(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary">
                    <option value="prize">Case Prize</option>
                    <option value="reward">Player Reward</option>
                    <option value="cashout">Player Cashout</option>
                    <option value="box">Car Box / Kit</option>
                    <option value="investment">Investment</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1.5">Player / Recipient</label>
                  <input type="text" value={hbDebitPlayer} onChange={e => setHbDebitPlayer(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" placeholder="Optional" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1.5">Notes</label>
                  <input type="text" value={hbDebitNote} onChange={e => setHbDebitNote(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" placeholder="e.g. Hellcat engine kit" />
                </div>
              </div>
              {hbDebitMsg && <p className={`text-xs ${hbDebitMsg.ok ? "text-green-400" : "text-red-400"}`}>{hbDebitMsg.text}</p>}
              <button type="button" onClick={submitHouseBetDebit} disabled={hbDebitLoading}
                className="w-full py-2.5 rounded-xl bg-red-900 hover:bg-red-900 border border-red-800 text-red-300 text-sm font-semibold transition-colors disabled:opacity-50">
                {hbDebitLoading ? "Logging…" : "Log BET Out"}
              </button>
            </div>

            {/* Restock — owner only */}
            {isOwner && (
              <div className="space-y-3 border-t border-zinc-700 pt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Restock Inventory</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1.5">Amount (BET)</label>
                    <input type="number" min="0.01" step="0.01" value={hbCreditAmt} onChange={e => setHbCreditAmt(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" placeholder="e.g. 500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1.5">Notes</label>
                    <input type="text" value={hbCreditNote} onChange={e => setHbCreditNote(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" placeholder="e.g. Restocked from vendor" />
                  </div>
                </div>
                {hbCreditMsg && <p className={`text-xs ${hbCreditMsg.ok ? "text-green-400" : "text-red-400"}`}>{hbCreditMsg.text}</p>}
                <button type="button" onClick={submitHouseBetCredit} disabled={hbCreditLoading}
                  className="w-full py-2.5 rounded-xl bg-cyan-900 hover:bg-cyan-900 border border-cyan-800 text-cyan-300 text-sm font-semibold transition-colors disabled:opacity-50">
                  {hbCreditLoading ? "Restocking…" : "+ Add BET to Inventory"}
                </button>
              </div>
            )}
          </div>

          {/* ── Transaction Ledger ────────────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => {
                const next = !showHouseBetLedger;
                setShowHouseBetLedger(next);
                if (next && houseBetLedger.length === 0) loadHouseBetLedger();
              }}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-900 transition-colors">
              <span className="text-sm font-semibold text-foreground">Transaction Ledger</span>
              <span className="text-xs text-muted-foreground">{houseBet ? `${Number(houseBet.tx_count).toLocaleString()} entries` : "–"} {showHouseBetLedger ? "▲" : "▼"}</span>
            </button>
            {showHouseBetLedger && (
              <ErrorBoundary>
              <div className="border-t border-zinc-700 divide-y divide-zinc-700 max-h-80 overflow-y-auto">
                {houseBetLedgerLoading && <p className="text-center py-6 text-sm text-muted-foreground">Loading…</p>}
                {!houseBetLedgerLoading && houseBetLedger.length === 0 && <p className="text-center py-6 text-sm text-muted-foreground">No transactions yet.</p>}
                {houseBetLedger.map((tx: any) => (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`text-lg font-bold leading-none ${tx.direction === "in" ? "text-green-400" : "text-red-400"}`}>{tx.direction === "in" ? "▲" : "▼"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${tx.direction === "in" ? "text-green-400" : "text-red-400"}`}>{tx.direction === "in" ? "+" : "-"}{Number(tx.amount).toLocaleString()} BET</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-zinc-800 text-muted-foreground text-[10px] uppercase tracking-wide font-semibold">{tx.category}</span>
                        {tx.player_name && <span className="text-xs text-muted-foreground">→ {tx.player_name}</span>}
                      </div>
                      {tx.notes && <p className="text-xs text-muted-foreground mt-0.5 truncate">{tx.notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">{tx.logged_by}</p>
                      <p className="text-[10px] text-muted-foreground/60">{tx.logged_at ? fmtETDateShort(tx.logged_at) : "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
              </ErrorBoundary>
            )}
          </div>

          {/* ── BET Reimbursement Queue ───────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
              <div>
                <p className="text-sm font-semibold text-foreground">◈ Staff BET Reimbursement Queue</p>
                <p className="text-xs text-muted-foreground mt-0.5">BET sent by employees from their own wallets to deliver prizes — mark as reimbursed once you've paid them back.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={betReimburseShowAll} onChange={e => { setBetReimburseShowAll(e.target.checked); loadBetReimburse(e.target.checked); }} className="rounded" />
                  Show all
                </label>
                <button type="button" onClick={() => loadBetReimburse(betReimburseShowAll)} className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-900 transition-colors">
                  ↻ Refresh
                </button>
              </div>
            </div>

            {betReimburseLoading && <p className="text-center py-6 text-sm text-muted-foreground">Loading…</p>}
            {!betReimburseLoading && betReimburse.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">No pending reimbursements.</p>
                <p className="text-xs mt-1 opacity-60">When staff log BET they sent from their wallet to deliver a prize, it appears here.</p>
              </div>
            )}
            {betReimburse.map((row: any) => (
              <div key={row.id} className={`flex items-start gap-4 px-5 py-4 border-t border-zinc-700 ${row.bet_reimbursed ? "opacity-50" : ""}`}>
                {/* Prize info */}
                <div className="w-9 h-9 rounded-lg bg-cyan-950 border border-cyan-800 flex items-center justify-center text-lg shrink-0">
                  {row.prize_emoji || "◈"}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{row.prize_name}</span>
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-cyan-950 text-cyan-400 border border-cyan-800">BET PRIZE</span>
                    {row.bet_reimbursed && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-950 text-green-400 border border-green-800">REIMBURSED</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Won by <span className="text-foreground font-medium">{row.player_name}</span>
                    {row.state_id && <span className="text-amber-400 font-mono ml-1">[{row.state_id}]</span>}
                    {row.phone_number && <span className="ml-1">· 📞 {row.phone_number}</span>}
                    {row.delivered_at && <span className="ml-1">· Delivered {fmtETDateShort(row.delivered_at)}</span>}
                  </div>
                  {row.bet_paid_by && (
                    <div className="flex items-center gap-3 bg-cyan-950 border border-cyan-800 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Employee</p>
                        <p className="text-sm font-bold text-cyan-300">{row.bet_paid_by}</p>
                      </div>
                      <div className="ml-4">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">BET Owed</p>
                        <p className="text-sm font-bold text-cyan-400">◈ {Number(row.bet_paid_amount).toLocaleString()} BET</p>
                      </div>
                      {row.bet_reimbursed && (
                        <div className="ml-4">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Reimbursed By</p>
                          <p className="text-xs text-green-400">{row.bet_reimbursed_by} · {row.bet_reimbursed_at ? fmtETDateShort(row.bet_reimbursed_at) : ""}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!row.bet_reimbursed && (
                  <Button size="sm" onClick={() => reimbursePrize(row.id)} isLoading={reimbursingId === row.id}
                    className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs whitespace-nowrap shrink-0">
                    ✓ Mark Reimbursed
                  </Button>
                )}
              </div>
            ))}
          </div>

        </div>
      )}

      {/* ══════════════════════════════════════════════
          BABALARI TAB
      ══════════════════════════════════════════════ */}
      {statsSubTab === "babalari" && (
        <div className="space-y-5">

          {/* ── Babalari Currency Volume Summary ───────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <img src={`${BASE_URL}/babalari-coin.png`} alt="Babalari" className="w-5 h-5 object-contain" />
              <span className="text-base font-display font-bold text-violet-300">Babalari Currency</span>
              <button type="button" onClick={() => { loadBabalariStats(); loadBabHouseBalance(); }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-900 transition-colors">
                ↻ Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-violet-950 border border-violet-800 rounded-xl p-4 text-center">
                <p className="text-[10px] text-violet-400 uppercase tracking-widest font-bold mb-1">Total Deposited</p>
                <p className="text-2xl font-display font-black text-violet-300">{babalariStats ? babalariStats.total_accepted.toLocaleString() : "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">Babalari received from players</p>
              </div>
              <div className="bg-cyan-950 border border-cyan-800 rounded-xl p-4 text-center">
                <p className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold mb-1">House Available</p>
                <p className={`text-2xl font-display font-black ${babHouseBalance && babHouseBalance.balance < 0 ? "text-red-400" : "text-cyan-300"}`}>
                  {babHouseBalance !== null ? Number(babHouseBalance.balance).toLocaleString() : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Babalari on hand</p>
              </div>
              <div className="bg-green-950 border border-green-800 rounded-xl p-4 text-center">
                <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-1">Chips Issued</p>
                <p className="text-2xl font-display font-black text-green-400">{babalariStats ? babalariStats.total_chips_issued.toLocaleString() : "—"}</p>
                <p className="text-xs text-muted-foreground mt-1">credited to players</p>
              </div>
              <div className="bg-amber-950 border border-amber-800 rounded-xl p-4 text-center">
                <p className="text-[10px] text-amber-400 uppercase tracking-widest font-bold mb-1">Revenue Value</p>
                <p className="text-2xl font-display font-black text-amber-300">
                  {babHouseBalance !== null ? `$${(Number(babHouseBalance.balance) * babalariSellPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">@ ${babalariSellPrice.toFixed(2)}/Babalari</p>
              </div>
            </div>
          </div>

          {/* ── Rates & Pricing (Owner only) ───────────── */}
          {isOwner && (
            <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Babalari Rates &amp; Pricing</p>
                <p className="text-xs text-muted-foreground mt-0.5">Set the exchange rate (chips per Babalari) and your sell price</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-2">
                    Chips per 1 Babalari
                  </label>
                  <input type="number" min="1" step="1" value={editBabalariRate}
                    onChange={e => setEditBabalariRate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold block mb-2">
                    Sell Price ($ per Babalari)
                  </label>
                  <input type="number" min="0.01" step="0.01" value={editBabalariSellPrice}
                    onChange={e => setEditBabalariSellPrice(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary" />
                </div>
              </div>
              {editBabalariRate && editBabalariSellPrice && parseInt(editBabalariRate) > 0 && parseFloat(editBabalariSellPrice) > 0 && (
                <div className="bg-zinc-900 rounded-lg px-3 py-2 text-xs text-muted-foreground space-y-0.5">
                  <p>Current: <span className="text-foreground font-semibold">1 Babalari = {parseInt(editBabalariRate).toLocaleString()} chips</span> · <span className="text-foreground font-semibold">${parseFloat(editBabalariSellPrice).toFixed(2)} per Babalari</span></p>
                  <p>Example: 10 Babalari deposited → {(10 * parseInt(editBabalariRate)).toLocaleString()} chips issued · ${(10 * parseFloat(editBabalariSellPrice)).toFixed(2)} value</p>
                </div>
              )}
              {babalariRateMsg && <p className={`text-xs ${babalariRateMsg.ok ? "text-green-400" : "text-red-400"}`}>{babalariRateMsg.text}</p>}
              <button type="button" onClick={saveBabalariRate} disabled={babalariRateSaving}
                className="w-full py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {babalariRateSaving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          )}

          {/* ── House Inventory ─────────────────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">House Babalari Inventory</p>
                <p className="text-xs text-muted-foreground mt-0.5">Track Babalari held and paid out by the house</p>
              </div>
              <button type="button" onClick={() => { loadBabHouseBalance(); if (showBabLedger) loadBabalariLedger(); }}
                className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded-lg border border-zinc-700 hover:bg-zinc-900 transition-colors">
                ↻ Refresh
              </button>
            </div>

            {babHouseLoading && <p className="text-sm text-muted-foreground text-center py-2">Loading…</p>}
            {babHouseBalance && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Net Balance</p>
                  <p className={`text-xl font-display font-black ${babHouseBalance.balance >= 0 ? "text-violet-300" : "text-red-400"}`}>{Number(babHouseBalance.balance).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Babalari</p>
                </div>
                <div className="bg-green-950 border border-green-800 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-green-400 uppercase tracking-widest font-bold mb-1">Total In</p>
                  <p className="text-xl font-display font-black text-green-400">{Number(babHouseBalance.total_in).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">received</p>
                </div>
                <div className="bg-red-950 border border-red-800 rounded-xl p-3 text-center">
                  <p className="text-[10px] text-red-400 uppercase tracking-widest font-bold mb-1">Total Out</p>
                  <p className="text-xl font-display font-black text-red-400">{Number(babHouseBalance.total_out).toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">paid out</p>
                </div>
              </div>
            )}

            {/* Log Babalari Out (all bankers) */}
            <div className="border border-zinc-700 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Log Babalari Out</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Amount</label>
                  <input type="number" min="0.01" step="0.01" value={babDebitAmt} onChange={e => setBabDebitAmt(e.target.value)}
                    placeholder="0"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">Category</label>
                  <select value={babDebitCat} onChange={e => setBabDebitCat(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary">
                    <option value="prize">Prize</option>
                    <option value="reward">Reward</option>
                    <option value="payout">Payout</option>
                    <option value="cashout">Cashout</option>
                    <option value="investment">Investment</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Player Name (optional)</label>
                <input type="text" value={babDebitPlayer} onChange={e => setBabDebitPlayer(e.target.value)}
                  placeholder="Recipient name"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">Notes (optional)</label>
                <input type="text" value={babDebitNote} onChange={e => setBabDebitNote(e.target.value)}
                  placeholder="Details…"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
              </div>
              {babDebitMsg && <p className={`text-xs ${babDebitMsg.ok ? "text-green-400" : "text-red-400"}`}>{babDebitMsg.text}</p>}
              <button type="button" onClick={submitBabDebit} disabled={babDebitLoading}
                className="w-full py-2.5 rounded-xl bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {babDebitLoading ? "Logging…" : "Log Babalari Out"}
              </button>
            </div>

            {/* Restock (owner only) */}
            {isOwner && (
              <div className="border border-violet-700 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-violet-400 uppercase tracking-widest">Restock / Manual Credit</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Amount</label>
                    <input type="number" min="0.01" step="0.01" value={babCreditAmt} onChange={e => setBabCreditAmt(e.target.value)}
                      placeholder="0"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">Notes (optional)</label>
                    <input type="text" value={babCreditNote} onChange={e => setBabCreditNote(e.target.value)}
                      placeholder="Reason…"
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary" />
                  </div>
                </div>
                {babCreditMsg && <p className={`text-xs ${babCreditMsg.ok ? "text-green-400" : "text-red-400"}`}>{babCreditMsg.text}</p>}
                <button type="button" onClick={submitBabCredit} disabled={babCreditLoading}
                  className="w-full py-2.5 rounded-xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {babCreditLoading ? "Crediting…" : "+ Add Babalari to Inventory"}
                </button>
              </div>
            )}
          </div>

          {/* ── Transaction Ledger ──────────────────────── */}
          <div className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
            <button type="button"
              onClick={() => {
                const next = !showBabLedger;
                setShowBabLedger(next);
                if (next && babalariLedger.length === 0) loadBabalariLedger();
              }}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-900 transition-colors">
              <span className="text-sm font-semibold text-foreground">Transaction Ledger</span>
              <span className="text-xs text-muted-foreground">{babHouseBalance ? `${Number(babHouseBalance.tx_count).toLocaleString()} entries` : "–"} {showBabLedger ? "▲" : "▼"}</span>
            </button>
            {showBabLedger && (
              <div className="border-t border-zinc-700 divide-y divide-zinc-700 max-h-80 overflow-y-auto">
                {babalariLedgerLoading && <p className="text-center py-6 text-sm text-muted-foreground">Loading…</p>}
                {!babalariLedgerLoading && babalariLedger.length === 0 && <p className="text-center py-6 text-sm text-muted-foreground">No transactions yet.</p>}
                {babalariLedger.map((tx: any) => (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={`text-lg font-bold leading-none ${tx.direction === "in" ? "text-green-400" : "text-red-400"}`}>{tx.direction === "in" ? "▲" : "▼"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-bold ${tx.direction === "in" ? "text-green-400" : "text-red-400"}`}>{tx.direction === "in" ? "+" : "-"}{Number(tx.amount).toLocaleString()} Babalari</span>
                        <span className="px-1.5 py-0.5 rounded-md bg-zinc-800 text-muted-foreground text-[10px] uppercase tracking-wide font-semibold">{tx.category || (tx.chips_amount ? "deposit" : "manual")}</span>
                        {tx.player_name && <span className="text-xs text-muted-foreground">→ {tx.player_name}</span>}
                        {tx.chips_amount && tx.direction === "in" && <span className="text-xs text-amber-400">→ {Number(tx.chips_amount).toLocaleString()} chips</span>}
                      </div>
                      {tx.reason && <p className="text-xs text-muted-foreground mt-0.5 truncate">{tx.reason}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-muted-foreground">{tx.logged_by ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground/60">{tx.logged_at ? fmtETDateShort(tx.logged_at) : "—"}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}


    </div>
  );
}

// ── Accounts Management Tab (Admin only) ───────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-yellow-900 text-yellow-400",
  banker: "bg-green-900 text-green-400",
  dealer: "bg-blue-900 text-blue-400",
  sportbets: "bg-purple-900 text-purple-400",
  security_guard: "bg-red-900 text-red-400",
  pit_boss: "bg-orange-900 text-orange-400",
  cage_clerk: "bg-teal-900 text-teal-400",
  junior_banker: "bg-cyan-900 text-cyan-400",
};

const VALID_STAFF_ROLES_UI = ["owner", "banker", "dealer", "sportbets", "pit_boss", "security_guard", "cage_clerk", "junior_banker"];

function parsePlayerRoles(p: any): string[] {
  if (p.staffRolesJson) {
    try { return JSON.parse(p.staffRolesJson); } catch { /* fall through */ }
  }
  return [p.staffRole, p.staffRole2].filter(Boolean);
}

function PlayerStaffSection({ isOwner = false }: { isOwner?: boolean }) {
  const { data: allPlayers = [], refetch: refetchPlayers } = useListPlayers();
  const { bankerToken, sessionToken } = useStore();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [addRoleValue, setAddRoleValue] = useState<string>("none");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const authToken = bankerToken || sessionToken || "";

  const staffPlayers = (allPlayers as any[]).filter((p) => p.staffRole || p.staffRolesJson);
  const searchLower = search.toLowerCase();
  const filteredPlayers = search
    ? (allPlayers as any[]).filter(
        (p) =>
          p.username?.toLowerCase().includes(searchLower) ||
          p.stateId?.toLowerCase().includes(searchLower),
      )
    : (allPlayers as any[]);

  async function handleSave(playerId: number) {
    setSaving(true);
    setError("");
    try {
      const resp = await fetch(
        `${BASE_URL}/api/players/${playerId}/staff-role`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({ staffRoles: editRoles }),
        },
      );
      if (!resp.ok) {
        const d = await resp.json();
        setError(d.error || "Failed to save");
      } else {
        setEditingId(null);
        refetchPlayers();
      }
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(player: any) {
    setEditingId(player.id);
    setEditRoles(parsePlayerRoles(player));
    setAddRoleValue("none");
    setError("");
  }

  function addRole() {
    if (addRoleValue === "none" || editRoles.includes(addRoleValue)) return;
    setEditRoles((prev) => [...prev, addRoleValue]);
    setAddRoleValue("none");
  }

  function removeRole(role: string) {
    setEditRoles((prev) => prev.filter((r) => r !== role));
  }

  const assignableRolesUI = isOwner
    ? VALID_STAFF_ROLES_UI
    : VALID_STAFF_ROLES_UI.filter((r) => r !== "owner" && r !== "banker");
  const availableToAdd = assignableRolesUI.filter((r) => !editRoles.includes(r));

  return (
    <div className="bg-card border border-primary/20 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-display font-semibold uppercase tracking-widest text-primary flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Player-Linked Staff Access
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Give a player account staff access — they'll see the Staff Dashboard in their lobby. Players can hold multiple roles.
        </p>
      </div>

      {staffPlayers.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Currently assigned</p>
          {staffPlayers.map((p: any) => {
            const roles = parsePlayerRoles(p);
            return (
              <div key={p.id} className="flex items-center gap-3 bg-black/30 border border-zinc-700 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm text-foreground">{p.username}</span>
                  {p.stateId && <span className="text-xs text-muted-foreground ml-2">#{p.stateId}</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {roles.map((r: string) => (
                    <span key={r} className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ROLE_COLORS[r] || "bg-zinc-800 text-muted-foreground"}`}>{ROLE_LABELS[r] || r}</span>
                  ))}
                </div>
                <button onClick={() => startEdit(p)} className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">Assign role to a player</p>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by player name or State ID…"
          className="w-full bg-black/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 mb-2"
        />
        {search && (
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {filteredPlayers.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No players found</p>
            )}
            {filteredPlayers.map((p: any) => {
              const roles = parsePlayerRoles(p);
              return (
                <div key={p.id} className="flex items-center gap-3 bg-black/30 border border-zinc-700 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm text-foreground">{p.username}</span>
                    {p.stateId && <span className="text-xs text-muted-foreground ml-2">#{p.stateId}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {roles.map((r: string) => (
                      <span key={r} className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ROLE_COLORS[r] || "bg-zinc-800 text-muted-foreground"}`}>{ROLE_LABELS[r] || r}</span>
                    ))}
                  </div>
                  <button onClick={() => startEdit(p)} className="text-xs text-primary/80 hover:text-primary border border-primary/20 hover:border-primary/40 rounded px-2 py-1 transition-colors">
                    {roles.length > 0 ? "Edit Roles" : "Assign Role"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingId !== null && (() => {
        const player = (allPlayers as any[]).find((p) => p.id === editingId);
        return (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="bg-black/40 border border-primary/30 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">
              {player?.username || `Player #${editingId}`}
              {player?.stateId && <span className="text-muted-foreground font-normal ml-2">#{player.stateId}</span>}
            </p>

            <div>
              <label className="block text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Assigned Roles</label>
              {editRoles.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No roles assigned — player will lose staff access</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {editRoles.map((r) => (
                    <div key={r} className={`flex items-center gap-1.5 text-xs font-bold px-2 py-1 rounded uppercase tracking-wider ${ROLE_COLORS[r] || "bg-zinc-800 text-muted-foreground"}`}>
                      {ROLE_LABELS[r] || r}
                      <button onClick={() => removeRole(r)} className="opacity-70 hover:opacity-100 transition-opacity ml-0.5" title="Remove role">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {availableToAdd.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={addRoleValue}
                  onChange={(e) => setAddRoleValue(e.target.value)}
                  className="flex-1 bg-input border border-zinc-700 rounded-lg px-2 py-1.5 text-foreground text-sm"
                >
                  <option value="none">— Add a role —</option>
                  {availableToAdd.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={addRole} disabled={addRoleValue === "none"}>
                  Add
                </Button>
              </div>
            )}

            {error && <p className="text-destructive text-xs">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleSave(editingId)} disabled={saving} isLoading={saving}>Save</Button>
              <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setError(""); }}>Cancel</Button>
            </div>
          </motion.div>
        );
      })()}
    </div>
  );
}

// ── Security Tab ───────────────────────────────────────────────────────────────

const SEV_CONFIG = {
  LOW:  { label: "LOW",  color: "bg-blue-900 text-blue-400 border-blue-700",   glow: "",                          icon: "🔵" },
  MED:  { label: "MED",  color: "bg-amber-900 text-amber-400 border-amber-700", glow: "",                          icon: "🟡" },
  HIGH: { label: "HIGH", color: "bg-red-900 text-red-400 border-red-700",       glow: "shadow-red-500/40 shadow-md", icon: "🔴" },
};

const FLOOR_EVENT_CONFIG: Record<string, { icon: JSX.Element; label: string }> = {
  flagged_presence:  { icon: <Eye className="w-3.5 h-3.5" />,           label: "On Floor" },
  flagged_movement:  { icon: <MapPin className="w-3.5 h-3.5" />,        label: "Moved" },
  large_transaction: { icon: <DollarSign className="w-3.5 h-3.5" />,   label: "Large TX" },
  player_kicked:     { icon: <LogOut className="w-3.5 h-3.5" />,        label: "Kicked" },
  player_warned:     { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "Warning" },
  player_banned:     { icon: <Ban className="w-3.5 h-3.5" />,           label: "Banned" },
  player_flagged:    { icon: <Flag className="w-3.5 h-3.5" />,          label: "Flagged" },
  player_joined:     { icon: <LogOut className="w-3.5 h-3.5 rotate-180" />, label: "Joined" },
  player_left:       { icon: <LogOut className="w-3.5 h-3.5" />,        label: "Left" },
  bet_placed:        { icon: <DollarSign className="w-3.5 h-3.5" />,    label: "Bet" },
  player_login:      { icon: <LogOut className="w-3.5 h-3.5 rotate-180" />, label: "Login" },
  player_site_active:{ icon: <Activity className="w-3.5 h-3.5" />,      label: "Active" },
  player_left_site:  { icon: <LogOut className="w-3.5 h-3.5" />,        label: "Left Site" },
};

const FLOOR_SEVERITY_STYLE: Record<string, string> = {
  info:     "border-zinc-700 bg-card text-muted-foreground",
  warn:     "border-amber-800 bg-amber-950 text-amber-300",
  critical: "border-red-700 bg-red-950 text-red-300",
};

const BAN_DURATION_OPTIONS = [
  { label: "1 hour",     hours: 1 },
  { label: "4 hours",    hours: 4 },
  { label: "12 hours",   hours: 12 },
  { label: "24 hours",   hours: 24 },
  { label: "48 hours",   hours: 48 },
  { label: "72 hours",   hours: 72 },
  { label: "1 week",     hours: 168 },
  { label: "2 weeks",    hours: 336 },
  { label: "1 month",    hours: 720 },
  { label: "Permanent",  hours: 0 },
];

// ── Recently Created Accounts ──────────────────────────────────────────────────
const RECENT_ACCOUNTS_PAGE_SIZE = 25;

function RecentAccountsSection({ authToken, onViewPlayer }: { authToken: string; onViewPlayer: (stateId: string) => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [timeFilter, setTimeFilter] = useState<"1h" | "24h" | "7d" | "30d" | "all">("all");
  const [specialFilter, setSpecialFilter] = useState<"all" | "promo" | "referral" | "zerodeposit" | "freechips">("all");
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${BASE_URL}/api/security/recent-accounts`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (r.ok) { setAccounts(await r.json()); setPage(1); }
      else setErr("Failed to load accounts.");
    } catch { setErr("Network error."); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function parseTs(ts: string): number {
    // Ensure the timestamp is treated as UTC if no timezone info present
    if (!ts) return 0;
    const s = ts.endsWith("Z") || ts.includes("+") ? ts : ts.replace(" ", "T") + "Z";
    return new Date(s).getTime();
  }

  function timeAgo(ts: string | null): string {
    if (!ts) return "Unknown";
    const d = Date.now() - parseTs(ts);
    if (d < 0) return "just now";
    if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return `${Math.floor(d / 86_400_000)}d ago`;
  }

  function fmtDate(ts: string | null): string {
    if (!ts) return "Unknown";
    return new Date(parseTs(ts)).toLocaleDateString();
  }

  const now = Date.now();
  const timeMs: Record<string, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

  const filtered = accounts.filter(a => {
    if (timeFilter !== "all") {
      if (!a.createdAt) return false;
      if (now - parseTs(a.createdAt) > timeMs[timeFilter]) return false;
    }
    if (specialFilter === "promo" && !a.promoCodeUsed) return false;
    if (specialFilter === "referral" && !a.referredBy && !a.referredByCode) return false;
    if (specialFilter === "zerodeposit" && Number(a.totalDeposits) > 0) return false;
    if (specialFilter === "freechips" && Number(a.totalBonusChips) <= 0) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (a.username ?? "").toLowerCase().includes(q)
        || (a.stateId ?? "").toLowerCase().includes(q)
        || (a.phoneNumber ?? "").toLowerCase().includes(q)
        || (a.promoCodeUsed ?? "").toLowerCase().includes(q)
        || (a.referredBy ?? "").toLowerCase().includes(q)
        || (a.referredByCode ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / RECENT_ACCOUNTS_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageSlice = filtered.slice((clampedPage - 1) * RECENT_ACCOUNTS_PAGE_SIZE, clampedPage * RECENT_ACCOUNTS_PAGE_SIZE);

  const fmtChips = (val: any) => (val == null || Number(val) === 0) ? "—" : Number(val).toLocaleString();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-red-400" /> Recently Created Accounts
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">Newest → oldest. Catch alt accounts, promo abuse, and suspicious registrations.</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search name / State ID / phone / promo / referral..."
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-foreground placeholder:text-muted-foreground"
        />
        <div className="flex gap-1 flex-wrap">
          {(["1h", "24h", "7d", "30d", "all"] as const).map(t => (
            <button key={t} onClick={() => { setTimeFilter(t); setPage(1); }}
              className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${timeFilter === t ? "bg-red-700 text-white" : "bg-zinc-800 text-muted-foreground hover:text-foreground"}`}>
              {t === "all" ? "All time" : `Last ${t}`}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {([
            { key: "all", label: "All" },
            { key: "promo", label: "Used promo" },
            { key: "referral", label: "Used referral" },
            { key: "zerodeposit", label: "Zero deposits" },
            { key: "freechips", label: "Claimed free chips" },
          ] as const).map(f => (
            <button key={f.key} onClick={() => { setSpecialFilter(f.key); setPage(1); }}
              className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${specialFilter === f.key ? "bg-amber-700 text-white" : "bg-zinc-800 text-muted-foreground hover:text-foreground"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading accounts…</p>}

      {!loading && !err && (
        <>
          <div className="rounded-lg border border-zinc-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: 900 }}>
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-900 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Player</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">State ID</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Phone</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Created</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Promo Used</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Referral</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Free Chips</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Balance</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">1st Dep</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Tot Dep</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Tot Wdw</th>
                    <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Wagered</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Flag</th>
                    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-zinc-950">
                  {pageSlice.length === 0 && (
                    <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">No accounts match the current filters.</td></tr>
                  )}
                  {pageSlice.map(a => (
                    <tr key={a.id} className="border-b border-zinc-800 hover:bg-zinc-900 transition-colors">
                      <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{a.username}</td>
                      <td className="px-3 py-2 text-muted-foreground font-mono whitespace-nowrap">{a.stateId ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{a.phoneNumber ?? "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="text-foreground">{fmtDate(a.createdAt)}</div>
                        <div className="text-muted-foreground text-[10px]">{timeAgo(a.createdAt)}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {a.promoCodeUsed
                          ? <span className="px-1.5 py-0.5 rounded bg-amber-900 border border-amber-700 text-amber-300 font-mono">{a.promoCodeUsed}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {(a.referredByCode || a.referredBy)
                          ? <span className="px-1.5 py-0.5 rounded bg-blue-900 border border-blue-700 text-blue-300 font-mono">{a.referredByCode || a.referredBy}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-400 whitespace-nowrap">{fmtChips(a.totalBonusChips)}</td>
                      <td className="px-3 py-2 text-right font-medium text-foreground whitespace-nowrap">{Number(a.chips).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-emerald-400 whitespace-nowrap">{a.firstDeposit ? Number(a.firstDeposit).toLocaleString() : "—"}</td>
                      <td className="px-3 py-2 text-right text-emerald-400 whitespace-nowrap">{fmtChips(a.totalDeposits)}</td>
                      <td className="px-3 py-2 text-right text-red-400 whitespace-nowrap">{fmtChips(a.totalWithdrawals)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground whitespace-nowrap">{fmtChips(a.totalWagered)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {a.flagSeverity
                          ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${a.flagSeverity === "HIGH" ? "bg-red-900 text-red-300" : a.flagSeverity === "MED" ? "bg-orange-900 text-orange-300" : "bg-yellow-900 text-yellow-300"}`}>{a.flagSeverity}</span>
                          : <span className="text-muted-foreground text-[10px]">Clean</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => onViewPlayer(a.stateId ?? String(a.id))}
                          className="px-2 py-1 text-[10px] rounded bg-red-950 border border-red-800 text-red-300 hover:bg-red-900 transition-colors whitespace-nowrap">
                          View Profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Showing {filtered.length === 0 ? 0 : (clampedPage - 1) * RECENT_ACCOUNTS_PAGE_SIZE + 1}–{Math.min(clampedPage * RECENT_ACCOUNTS_PAGE_SIZE, filtered.length)} of {filtered.length} accounts
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  disabled={clampedPage <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  ‹ Prev
                </button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pg: number;
                  if (totalPages <= 7) { pg = i + 1; }
                  else if (clampedPage <= 4) { pg = i + 1; if (i === 6) pg = totalPages; }
                  else if (clampedPage >= totalPages - 3) { pg = totalPages - 6 + i; if (i === 0) pg = 1; }
                  else { const offsets = [1, clampedPage - 2, clampedPage - 1, clampedPage, clampedPage + 1, clampedPage + 2, totalPages]; pg = offsets[i]; }
                  return (
                    <button key={i} onClick={() => setPage(pg)}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${pg === clampedPage ? "bg-red-700 border-red-600 text-white" : "bg-zinc-800 border-zinc-700 text-muted-foreground hover:text-foreground"}`}>
                      {pg}
                    </button>
                  );
                })}
                <button
                  disabled={clampedPage >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-2 py-1 text-xs rounded bg-zinc-800 border border-zinc-700 text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Next ›
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SecurityTab({ currentRole }: { currentRole: string }) {
  const isPitBossOrAbove = ["owner", "banker", "pit_boss"].includes(currentRole);
  const { bankerToken, sessionToken } = useStore();
  const authToken = bankerToken || sessionToken || "";

  const [activeSection, setActiveSection] = useState<"watchlist" | "feed" | "profile" | "accounts">("watchlist");
  const [onlinePlayers, setOnlinePlayers] = useState<any[]>([]);
  const [flaggedPlayers, setFlaggedPlayers] = useState<any[]>([]);
  const [floorEvents, setFloorEvents] = useState<any[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [floorEventsLoading, setFloorEventsLoading] = useState(false);
  const [onlineLastRefreshed, setOnlineLastRefreshed] = useState<number | null>(null);
  const [feedSearch, setFeedSearch] = useState("");
  const [feedTypeFilter, setFeedTypeFilter] = useState<string>("all");
  const [feedSevFilter, setFeedSevFilter] = useState<string>("all");
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  const [profileSearch, setProfileSearch] = useState("");
  const [profilePlayer, setProfilePlayer] = useState<any | null>(null);
  const [profileData, setProfileData] = useState<any | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [secTxs, setSecTxs] = useState<any[]>([]);
  const [secTxsLoading, setSecTxsLoading] = useState(false);
  const [secTxSearch, setSecTxSearch] = useState("");
  const [secTxTypeFilter, setSecTxTypeFilter] = useState<"all"|"deposit"|"withdrawal"|"win"|"loss"|"rake">("all");

  const [activeAction, setActiveAction] = useState<"flag" | "note" | "tags" | "warn" | "ban" | null>("flag");
  const [excludeFromLoginLogs, setExcludeFromLoginLogs] = useState(false);
  const [togglingLoginLogs, setTogglingLoginLogs] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagSeverity, setFlagSeverity] = useState<"LOW" | "MED" | "HIGH">("MED");
  const [flagging, setFlagging] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [securityNotes, setSecurityNotes] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [photoUrlInput, setPhotoUrlInput] = useState("");
  const [photoUrlAdding, setPhotoUrlAdding] = useState(false);
  const [pendingDeletePhotoUrl, setPendingDeletePhotoUrl] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [warnReason, setWarnReason] = useState("");
  const [warning, setWarning] = useState(false);
  const [banGame, setBanGame] = useState("all");
  const [banReason, setBanReason] = useState("");
  const [banDurationHours, setBanDurationHours] = useState<number>(24);
  const [banning, setBanning] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tagLabel, setTagLabel] = useState("");
  const [tagColor, setTagColor] = useState("#ef4444");
  const [tagFlagged, setTagFlagged] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [tagMsg, setTagMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allTagTemplates, setAllTagTemplates] = useState<{label:string;color:string;flagged:boolean}[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [secTagsMap, setSecTagsMap] = useState<Map<number, {id:number;label:string;color:string;flagged:boolean}[]>>(new Map());
  useEffect(() => {
    fetch(`${BASE_URL}/api/security/player-tags`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json()).then(d => {
        if (!Array.isArray(d.tags)) return;
        // Build per-player map for tag search
        const map = new Map<number, {id:number;label:string;color:string;flagged:boolean}[]>();
        for (const t of d.tags) {
          if (!map.has(t.playerId)) map.set(t.playerId, []);
          map.get(t.playerId)!.push(t);
        }
        setSecTagsMap(map);
        // Build unique templates for autocomplete
        const seen = new Set<string>();
        const uniq: {label:string;color:string;flagged:boolean}[] = [];
        for (const t of d.tags) {
          const key = t.label.toUpperCase();
          if (!seen.has(key)) { seen.add(key); uniq.push({ label: t.label, color: t.color, flagged: !!t.flagged }); }
        }
        setAllTagTemplates(uniq);
      }).catch(() => {});
  }, [authToken]);

  const { data: allPlayers = [] } = useListPlayers();
  const [kickingId, setKickingId] = useState<number | null>(null);

  function authHeaders() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` };
  }

  const GAME_LABELS: Record<string, string> = { all: "All Games", blackjack: "Blackjack", slots: "Slots", roulette: "Roulette", baccarat: "Baccarat", poker: "Poker", "horse-racing": "Horse Racing", lobby: "Lobby", "rome-slots": "Fortuna", "western-slots": "Deadwood $" };
  const GAME_COLORS: Record<string, string> = { slots: "bg-yellow-900 text-yellow-400", blackjack: "bg-blue-900 text-blue-400", roulette: "bg-purple-900 text-purple-400", baccarat: "bg-cyan-900 text-cyan-400", poker: "bg-orange-900 text-orange-400", "horse-racing": "bg-emerald-900 text-emerald-400", lobby: "bg-zinc-800 text-muted-foreground", "rome-slots": "bg-amber-900 text-amber-400", "western-slots": "bg-orange-900 text-orange-400" };

  async function kickPlayer(playerId: number, username: string) {
    showConfirm(`Kick ${username} to the lobby?`, async () => {
      setKickingId(playerId);
      try {
        const r = await fetch(`${BASE_URL}/api/security/kick/${playerId}`, {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify({ reason: "Removed from game by security" }),
        });
        if (!r.ok) { showToast("Failed to kick player"); }
        else { fetchOnline(); }
      } catch { showToast("Network error kicking player"); }
      finally { setKickingId(null); }
    });
  }

  async function dismissPlayer(playerId: number, username: string) {
    showConfirm(`Remove ${username} from the activity tracker? They will disappear from the online list.`, async () => {
      setDismissingId(playerId);
      try {
        const r = await fetch(`${BASE_URL}/api/security/dismiss/${playerId}`, {
          method: "DELETE", headers: authHeaders(),
        });
        if (!r.ok) { setActionMsg({ ok: false, text: "Failed to dismiss player." }); }
        else { setActionMsg({ ok: true, text: `${username} dismissed from activity list.` }); fetchOnline(); }
      } catch { setActionMsg({ ok: false, text: "Network error." }); }
      finally { setDismissingId(null); setTimeout(() => setActionMsg(null), 3500); }
    });
  }

  async function fetchOnline() {
    setOnlineLoading(true);
    try {
      const [rOnline, rFlagged] = await Promise.all([
        fetch(`${BASE_URL}/api/security/online`, { headers: authHeaders() }),
        fetch(`${BASE_URL}/api/security/flagged`, { headers: authHeaders() }),
      ]);
      if (rOnline.ok) { const d = await rOnline.json(); setOnlinePlayers(d.players ?? []); }
      if (rFlagged.ok) { const d = await rFlagged.json(); setFlaggedPlayers(d.players ?? []); }
      setOnlineLastRefreshed(Date.now());
    } catch (e) { console.error("[security] fetchOnline error:", e); }
    finally { setOnlineLoading(false); }
  }

  async function fetchFloorEvents() {
    setFloorEventsLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/floor-events`, { headers: authHeaders() });
      if (r.ok) { const d = await r.json(); setFloorEvents(d.events ?? []); }
    } catch {}
    finally { setFloorEventsLoading(false); }
  }

  async function loadProfile(player: any) {
    setProfilePlayer(player);
    setProfileData(null);
    setProfileLoading(true);
    setProfileError("");
    setActiveSection("profile");
    setSecTxs([]);
    setSecTxSearch("");
    setSecTxTypeFilter("all");
    try {
      const [r, txR] = await Promise.all([
        fetch(`${BASE_URL}/api/security/profile/${player.id}`, { headers: authHeaders() }),
        fetch(`${BASE_URL}/api/players/${player.id}/transactions`, { headers: authHeaders() }),
      ]);
      const text = await r.text();
      let d: any;
      try { d = JSON.parse(text); } catch { throw new Error(r.ok ? "Invalid server response" : `Server error ${r.status}`); }
      if (!r.ok) throw new Error(d.error || "Failed");
      setProfileData(d);
      if (d.player?.flagged) {
        setFlagSeverity((d.player.flagSeverity as "LOW" | "MED" | "HIGH") || "MED");
        setFlagReason(d.player.flagReason || "");
      } else {
        setFlagReason("");
        setFlagSeverity("MED");
      }
      setSecurityNotes(d.player?.securityNotes || "");
      setExcludeFromLoginLogs(!!d.player?.excludeFromLoginLogs);
      if (txR.ok) {
        try { const txData = await txR.json(); setSecTxs(Array.isArray(txData) ? txData : []); } catch { /* ignore */ }
      }
    } catch (e: any) { setProfileError(e.message); }
    finally { setProfileLoading(false); }
  }

  async function refreshProfile() {
    if (!profilePlayer) return;
    // Lightweight in-place refresh — does NOT blank profileData or reset UI state,
    // so tag/note/warning actions feel instant instead of causing a full reload flash.
    try {
      const [r, txR] = await Promise.all([
        fetch(`${BASE_URL}/api/security/profile/${profilePlayer.id}`, { headers: authHeaders() }),
        fetch(`${BASE_URL}/api/players/${profilePlayer.id}/transactions`, { headers: authHeaders() }),
      ]);
      let d: any;
      try { d = JSON.parse(await r.text()); } catch { return; }
      if (!r.ok) return;
      setProfileData(d);
      if (d.player?.flagged) {
        setFlagSeverity((d.player.flagSeverity as "LOW" | "MED" | "HIGH") || "MED");
        setFlagReason(d.player.flagReason || "");
      } else {
        setFlagReason("");
        setFlagSeverity("MED");
      }
      setSecurityNotes(d.player?.securityNotes || "");
      setExcludeFromLoginLogs(!!d.player?.excludeFromLoginLogs);
      if (txR.ok) {
        try { const txData = await txR.json(); setSecTxs(Array.isArray(txData) ? txData : []); } catch { /* ignore */ }
      }
    } catch { /* silent */ }
  }

  async function handleToggleLoginLogs() {
    if (!profilePlayer || togglingLoginLogs) return;
    setTogglingLoginLogs(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/toggle-login-logs/${profilePlayer.id}`, {
        method: "PATCH", headers: authHeaders(),
      });
      const d = await r.json();
      if (r.ok) setExcludeFromLoginLogs(d.excludeFromLoginLogs);
    } catch { /* silent */ }
    setTogglingLoginLogs(false);
  }

  // Auto-poll security chip history every 5 s while a profile is open
  useEffect(() => {
    if (!profilePlayer) return;
    const id = profilePlayer.id;
    async function pollChips() {
      try {
        const r = await fetch(`${BASE_URL}/api/players/${id}/transactions`, { headers: authHeaders() });
        if (r.ok) {
          const d = await r.json();
          if (Array.isArray(d)) setSecTxs(d);
        }
      } catch { /* silent */ }
    }
    const iv = setInterval(pollChips, 5000);
    return () => clearInterval(iv);
  }, [profilePlayer?.id]);

  async function handleFlag(unflag = false) {
    if (!profilePlayer) return;
    if (!unflag && !flagReason.trim()) { setActionMsg({ ok: false, text: "Enter a reason." }); return; }
    setFlagging(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/flag/${profilePlayer.id}`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ reason: flagReason, unflag, severity: flagSeverity }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: unflag ? "Flag removed." : `Player flagged [${flagSeverity}].` });
      setFlagReason("");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setFlagging(false); }
  }

  async function handleEditFlag() {
    if (!profilePlayer) return;
    setFlagging(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/flag/${profilePlayer.id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ reason: flagReason, severity: flagSeverity }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: `Flag updated [${flagSeverity}].` });
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setFlagging(false); }
  }

  async function handleSaveNotes() {
    if (!profilePlayer) return;
    setSavingNotes(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/notes/${profilePlayer.id}`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ notes: securityNotes }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: "Notes saved." });
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setSavingNotes(false); }
  }

  async function handlePhotoUpload(file: File) {
    if (!profilePlayer) return;
    setPhotoUploading(true);
    setPhotoError("");
    try {
      const r = await fetch(`${BASE_URL}/api/security/photo/${profilePlayer.id}`, {
        method: "POST",
        headers: { "Content-Type": file.type, Authorization: `Bearer ${authToken}` },
        body: file,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Upload failed");
      await refreshProfile();
    } catch (e: any) { setPhotoError(e.message); }
    finally { setPhotoUploading(false); }
  }

  async function handlePhotoUrlAdd() {
    if (!profilePlayer || !photoUrlInput.trim()) return;
    setPhotoUrlAdding(true);
    setPhotoError("");
    try {
      const r = await fetch(`${BASE_URL}/api/security/photo/${profilePlayer.id}/url`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: photoUrlInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to add URL");
      setPhotoUrlInput("");
      await refreshProfile();
    } catch (e: any) { setPhotoError(e.message); }
    finally { setPhotoUrlAdding(false); }
  }

  async function handlePhotoDelete(photoUrl: string) {
    if (!profilePlayer) return;
    try {
      const r = await fetch(`${BASE_URL}/api/security/photo/${profilePlayer.id}`, {
        method: "DELETE", headers: authHeaders(),
        body: JSON.stringify({ photoUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Delete failed");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function handleSetPrimaryPhoto(photoUrl: string) {
    if (!profilePlayer) return;
    try {
      const r = await fetch(`${BASE_URL}/api/security/photo/${profilePlayer.id}/primary`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ photoUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function handleAddNote() {
    if (!profilePlayer || !noteContent.trim()) return;
    setAddingNote(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/note/${profilePlayer.id}`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ content: noteContent }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: "Note added." });
      setNoteContent("");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setAddingNote(false); }
  }

  async function handleDeleteNote(noteId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/security/note/${noteId}`, { method: "DELETE", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function handleWarn() {
    if (!profilePlayer || !warnReason.trim()) return;
    setWarning(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/warn/${profilePlayer.id}`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ reason: warnReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: "Warning issued." });
      setWarnReason("");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setWarning(false); }
  }

  async function handleDeleteWarning(warningId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/security/warn/${warningId}`, { method: "DELETE", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: "Warning removed." });
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
  }

  async function handleAddTag() {
    if (!profilePlayer || !tagLabel.trim()) return;
    setAddingTag(true); setTagMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/security/player-tags`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ playerId: profilePlayer.id, label: tagLabel.trim(), color: tagColor, flagged: tagFlagged }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      const addedLabel = tagLabel.trim();
      const addedColor = tagColor;
      const addedFlagged = tagFlagged;
      setTagLabel("");
      setTagFlagged(false);
      setTagMsg({ ok: true, text: "Tag added." });
      setAllTagTemplates(prev => {
        if (prev.some(t => t.label.toUpperCase() === addedLabel.toUpperCase())) return prev;
        return [...prev, { label: addedLabel, color: addedColor, flagged: addedFlagged }];
      });
      await refreshProfile();
    } catch (e: any) { setTagMsg({ ok: false, text: e.message }); }
    finally { setAddingTag(false); }
  }

  async function handleDeleteTag(tagId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/security/player-tags/${tagId}`, { method: "DELETE", headers: authHeaders() });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || "Failed"); }
      setTagMsg({ ok: true, text: "Tag removed." });
      await refreshProfile();
    } catch (e: any) { setTagMsg({ ok: false, text: e.message }); }
  }

  async function handleGameBan() {
    if (!profilePlayer || !banReason.trim()) return;
    setBanning(true);
    try {
      const r = await fetch(`${BASE_URL}/api/security/game-ban/${profilePlayer.id}`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ game: banGame, reason: banReason, durationHours: banDurationHours > 0 ? banDurationHours : null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      const durLabel = BAN_DURATION_OPTIONS.find((o) => o.hours === banDurationHours)?.label ?? `${banDurationHours}h`;
      setActionMsg({ ok: true, text: `Game ban issued (${banGame}, ${durLabel}).` });
      setBanReason("");
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
    finally { setBanning(false); }
  }

  async function handleLiftBan(banId: number) {
    try {
      const r = await fetch(`${BASE_URL}/api/security/game-ban/${banId}`, { method: "DELETE", headers: authHeaders() });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setActionMsg({ ok: true, text: "Ban lifted." });
      await refreshProfile();
    } catch (e: any) { setActionMsg({ ok: false, text: e.message }); }
  }

  // ── WS subscription ─────────────────────────────────────────────────────────
  const secWsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!authToken) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ws`);
    secWsRef.current = ws;

    ws.onopen = () => { ws.send(JSON.stringify({ type: "subscribe_security", token: authToken })); };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === "security_player_update" && msg.player) {
          const p = msg.player;
          setOnlinePlayers((prev) => {
            const idx = prev.findIndex((x: any) => x.playerId === p.playerId);
            if (idx >= 0) { const u = [...prev]; u[idx] = { ...u[idx], ...p }; return u; }
            return [p, ...prev];
          });
          setOnlineLastRefreshed(Date.now());
        } else if (msg.type === "floor_event" && msg.event) {
          setFloorEvents((prev) => [msg.event, ...prev].slice(0, 60));
        }
      } catch {}
    };

    ws.onerror = () => ws.close();
    return () => { ws.close(); secWsRef.current = null; };
  }, [authToken]);

  // Initial data load
  useEffect(() => { fetchOnline(); fetchFloorEvents(); }, []);
  useEffect(() => { if (actionMsg) { const t = setTimeout(() => setActionMsg(null), 4000); return () => clearTimeout(t); } }, [actionMsg]);

  // Auto-refresh online players every 30s
  useEffect(() => {
    const iv = setInterval(fetchOnline, 30_000);
    return () => clearInterval(iv);
  }, []);

  function fmtLastSeen(ms: number): string {
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 10) return "just now";
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }

  function fmtEventTime(ms: number): string {
    return fmtETTimeSec(ms);
  }

  // Watchlist = flagged players who are also currently online
  const watchlistPlayers = flaggedPlayers
    .map((fp) => {
      const online = onlinePlayers.find((op) => op.playerId === fp.id);
      return online ? { ...fp, ...online, _flagSeverity: fp.flagSeverity, _flagReason: fp.flagReason, _flaggedBy: fp.flaggedBy } : null;
    })
    .filter(Boolean) as any[];

  const searchedPlayers = profileSearch
    ? (allPlayers as any[]).filter((p: any) => {
        const q = profileSearch.toLowerCase();
        if (p.username.toLowerCase().includes(q)) return true;
        if (p.stateId && p.stateId.toLowerCase().includes(q)) return true;
        const tags = secTagsMap.get(p.id) || [];
        return tags.some(t => t.label.toLowerCase().includes(q));
      })
    : [];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Section nav */}
      <div className="flex gap-1 border-b border-zinc-700 pb-1">
        {[
          { key: "watchlist", label: "Active Watchlist", icon: Shield,   count: watchlistPlayers.length || undefined },
          { key: "feed",      label: "Floor Feed",       icon: Activity, count: floorEvents.length || undefined },
          { key: "profile",   label: "Player Lookup",    icon: Search },
          { key: "accounts",  label: "New Accounts",     icon: UserPlus },
        ].map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => {
              setActiveSection(key as any);
              if (key === "feed") fetchFloorEvents();
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeSection === key ? "bg-red-950 text-red-300 border border-red-800 border-b-0" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
            {count !== undefined && (
              <span className={`ml-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeSection === key ? "bg-red-900 text-red-300" : "bg-zinc-800 text-muted-foreground"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Feedback message */}
      {actionMsg && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className={`px-4 py-2 rounded-lg text-sm font-medium ${actionMsg.ok ? "bg-green-950 border border-green-700 text-green-400" : "bg-destructive/10 border border-destructive/30 text-destructive"}`}>
          {actionMsg.text}
        </motion.div>
      )}

      {/* ── Active Watchlist ─────────────────────────────────────────────────── */}
      {activeSection === "watchlist" && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-red-400" /> Active Watchlist
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Flagged players currently on the floor</p>
            </div>
            <button onClick={fetchOnline} disabled={onlineLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-900 text-muted-foreground hover:text-foreground text-xs transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${onlineLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {/* Watchlist cards */}
          {watchlistPlayers.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground bg-card border border-zinc-700 rounded-2xl">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">Floor is clear</p>
              <p className="text-xs mt-1">No flagged players are currently online</p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchlistPlayers.map((p) => {
                const sev = (p._flagSeverity || "MED") as keyof typeof SEV_CONFIG;
                const sevCfg = SEV_CONFIG[sev] || SEV_CONFIG.MED;
                return (
                  <motion.div
                    key={p.playerId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`bg-card border rounded-xl p-4 flex items-start gap-3 ${sev === "HIGH" ? "border-red-700 " + sevCfg.glow : sev === "MED" ? "border-amber-800" : "border-blue-800"}`}
                  >
                    {/* Player avatar — never use security photos here */}
                    {(() => {
                      const img = p.avatarUrl || null;
                      return (
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 overflow-hidden ${sev === "HIGH" ? "bg-red-900 border border-red-700" : sev === "MED" ? "bg-amber-900 border border-amber-700" : "bg-blue-900 border border-blue-700"}`}>
                          {img ? (
                            <img src={img} alt={p.username} className="w-full h-full object-cover" />
                          ) : (
                            <span className={`text-sm font-display font-bold ${sev === "HIGH" ? "text-red-400" : sev === "MED" ? "text-amber-400" : "text-blue-400"}`}>{p.username?.[0]?.toUpperCase()}</span>
                          )}
                        </div>
                      );
                    })()}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-foreground text-sm">{p.username}</span>
                        {/* Severity badge */}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${sevCfg.color}`}>
                          <Flag className="w-2.5 h-2.5" /> {sevCfg.label}
                        </span>
                        {/* Location */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${GAME_COLORS[p.game] || "bg-zinc-800 text-muted-foreground"}`}>
                          {GAME_LABELS[p.game] || p.game}
                        </span>
                        {p.status === "playing" && p.game !== "lobby" && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-green-900 text-green-400">Playing</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        <span className="text-red-400">{p._flagReason}</span>
                        {p._flaggedBy && <span className="ml-2 text-[10px]">· by {p._flaggedBy}</span>}
                      </p>
                      {p.lastSeenAt && <p className="text-[10px] text-muted-foreground mt-0.5">{fmtLastSeen(p.lastSeenAt)}</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {p.game && p.game !== "lobby" && (
                        <button onClick={() => kickPlayer(p.playerId, p.username)} disabled={kickingId === p.playerId} title="Kick to lobby" className="p-1.5 rounded hover:bg-red-950 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50">
                          <LogOut className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => { const found = (allPlayers as any[]).find((ap: any) => ap.id === p.playerId); if (found) loadProfile(found); }} className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Divider + All Online */}
          <div className="pt-2">
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-green-400" />
                All Online ({onlinePlayers.length})
                {onlineLastRefreshed && <span className="ml-1 text-[10px]">· {fmtETTimeSec(onlineLastRefreshed)}</span>}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            {onlinePlayers.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-4">No active players right now.</p>
            ) : (
              <div className="max-h-[340px] overflow-y-auto pr-1 grid grid-cols-1 grid-cols-2 gap-2 content-start">
                {onlinePlayers.map((p) => {
                  const isFlagged = flaggedPlayers.some((fp) => fp.id === p.playerId);
                  return (
                    <div key={p.playerId} className={`bg-card border rounded-lg p-3 flex items-center gap-2.5 ${isFlagged ? "border-red-800" : "border-zinc-700"}`}>
                      <div className="w-7 h-7 rounded-full bg-green-950 border border-green-800 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-green-400">{p.username?.[0]?.toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-foreground text-xs">{p.username}</p>
                          {isFlagged && <Flag className="w-2.5 h-2.5 text-red-400" />}
                          {(p.tags || []).map((t: any) => (
                            <span key={t.id} style={{background: t.color + "33", color: t.color, borderColor: t.color + "66"}} className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border leading-none">{t.label}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${GAME_COLORS[p.game] || "bg-zinc-800 text-muted-foreground"}`}>{GAME_LABELS[p.game] || p.game}</span>
                          {p.lastSeenAt && <span className="text-[10px] text-muted-foreground">{fmtLastSeen(p.lastSeenAt)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {p.game && p.game !== "lobby" ? (
                          <button onClick={() => kickPlayer(p.playerId, p.username)} disabled={kickingId === p.playerId} title="Kick to lobby" className="p-1 rounded hover:bg-red-950 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50">
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => dismissPlayer(p.playerId, p.username)} disabled={dismissingId === p.playerId} title="Dismiss ghost player" className="p-1 rounded hover:bg-amber-950 text-muted-foreground hover:text-amber-400 transition-colors disabled:opacity-50">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button onClick={() => { const found = (allPlayers as any[]).find((ap: any) => ap.id === p.playerId); if (found) loadProfile(found); }} className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Floor Feed ───────────────────────────────────────────────────────── */}
      {activeSection === "feed" && (() => {
        const filteredEvents = floorEvents.filter((evt: any) => {
          if (feedSearch && !evt.username?.toLowerCase().includes(feedSearch.toLowerCase()) && !evt.message?.toLowerCase().includes(feedSearch.toLowerCase())) return false;
          if (feedTypeFilter !== "all" && evt.type !== feedTypeFilter) return false;
          if (feedSevFilter !== "all" && evt.severity !== feedSevFilter) return false;
          return true;
        });
        return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-display font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" /> Live Floor Feed
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">Player movements, bets, kicks, flags &amp; warnings — live</p>
            </div>
            <button onClick={fetchFloorEvents} disabled={floorEventsLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-900 text-muted-foreground hover:text-foreground text-xs transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${floorEventsLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center bg-card border border-zinc-700 rounded-xl px-3 py-2.5">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={feedSearch}
              onChange={(e) => setFeedSearch(e.target.value)}
              placeholder="Search player or message…"
              className="flex-1 min-w-[140px] bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <select
              value={feedTypeFilter}
              onChange={(e) => setFeedTypeFilter(e.target.value)}
              className="bg-black/40 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-foreground focus:outline-none"
            >
              <option value="all">All types</option>
              <option value="player_login">Login</option>
              <option value="player_site_active">Site Active</option>
              <option value="player_left_site">Left Site</option>
              <option value="player_joined">Joined</option>
              <option value="player_left">Left</option>
              <option value="bet_placed">Bet</option>
              <option value="large_transaction">Large TX</option>
              <option value="flagged_presence">On Floor</option>
              <option value="flagged_movement">Moved</option>
              <option value="player_kicked">Kicked</option>
              <option value="player_warned">Warning</option>
              <option value="player_banned">Banned</option>
              <option value="player_flagged">Flagged</option>
            </select>
            <select
              value={feedSevFilter}
              onChange={(e) => setFeedSevFilter(e.target.value)}
              className="bg-black/40 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-foreground focus:outline-none"
            >
              <option value="all">All severity</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="critical">Critical</option>
            </select>
            {(feedSearch || feedTypeFilter !== "all" || feedSevFilter !== "all") && (
              <button onClick={() => { setFeedSearch(""); setFeedTypeFilter("all"); setFeedSevFilter("all"); }} className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-zinc-900 transition-colors">
                Clear
              </button>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">{filteredEvents.length} / {floorEvents.length}</span>
          </div>

          {floorEvents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground bg-card border border-zinc-700 rounded-2xl">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="font-medium">No events yet</p>
              <p className="text-xs mt-1">Events appear here as players move around the floor</p>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground bg-card border border-zinc-700 rounded-2xl">
              <Search className="w-6 h-6 mx-auto mb-2 opacity-30" />
              <p className="font-medium text-sm">No matching events</p>
              <p className="text-xs mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
              {filteredEvents.map((evt: any) => {
                const evtCfg = FLOOR_EVENT_CONFIG[evt.type] || { icon: <Zap className="w-3.5 h-3.5" />, label: evt.type };
                const sevStyle = FLOOR_SEVERITY_STYLE[evt.severity] || FLOOR_SEVERITY_STYLE.info;
                return (
                  <motion.div
                    key={evt.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex items-start gap-3 border rounded-lg px-3 py-2 ${sevStyle}`}
                  >
                    <div className="shrink-0 mt-0.5">{evtCfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{evtCfg.label}</span>
                        {evt.flagSeverity && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider border ${(SEV_CONFIG[evt.flagSeverity as keyof typeof SEV_CONFIG] || SEV_CONFIG.MED).color}`}>
                            {evt.flagSeverity}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-medium mt-0.5 leading-snug">{evt.message}</p>
                      {evt.location && evt.location !== "lobby" && (
                        <p className="text-[10px] opacity-60 mt-0.5 flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {GAME_LABELS[evt.location] || evt.location}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-[10px] opacity-50 flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" /> {fmtEventTime(evt.timestamp)}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
        );
      })()}

      {/* ── Player Lookup ────────────────────────────────────────────────────── */}
      {activeSection === "profile" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="bg-card border border-zinc-700 rounded-2xl p-4">
            <h3 className="text-sm font-display font-semibold uppercase tracking-widest text-primary mb-3 flex items-center gap-2">
              <Search className="w-4 h-4" /> Player Lookup
            </h3>
            <input
              type="text"
              value={profileSearch}
              onChange={(e) => setProfileSearch(e.target.value)}
              placeholder="Search by name, State ID, or tag…"
              className="w-full bg-black/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {profileSearch && searchedPlayers.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {searchedPlayers.map((p: any) => (
                  <button
                    key={p.id}
                    onClick={() => { loadProfile(p); setProfileSearch(""); }}
                    className="w-full flex items-center gap-3 bg-black/30 hover:bg-primary/10 border border-transparent hover:border-primary/20 rounded-lg px-3 py-2 text-left transition-colors"
                  >
                    <span className="font-medium text-sm text-foreground">{p.username}</span>
                    {p.stateId && <span className="text-xs text-muted-foreground">#{p.stateId}</span>}
                    {(p as any).flagged && <Flag className="w-3 h-3 text-red-400 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
            {profileSearch && searchedPlayers.length === 0 && (
              <p className="text-xs text-muted-foreground mt-2 text-center py-2">No players found</p>
            )}
          </div>

          {profileLoading && <div className="text-center py-12 text-muted-foreground">Loading profile…</div>}
          {profileError && <div className="text-destructive text-sm text-center py-8">{profileError}</div>}

          {profileData && profilePlayer && (
            <div className="space-y-3">

              {/* ── Profile Header ───────────────────────────────────────────── */}
              <div className="bg-card border border-zinc-700 rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  {(() => {
                    const avatarImg = profileData.player?.avatarUrl || null;
                    return (
                      <div className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0 border-2 border-red-900 bg-red-950">
                        {avatarImg
                          ? <img src={avatarImg} alt={profilePlayer.username} className="w-full h-full object-cover" />
                          : <span className="text-xl font-display font-bold text-primary">{profilePlayer.username?.[0]?.toUpperCase()}</span>}
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-foreground leading-tight">{profilePlayer.username}</h3>
                      {profileData.player?.flagged && (() => {
                        const sev = (profileData.player.flagSeverity || "MED") as keyof typeof SEV_CONFIG;
                        const cfg = SEV_CONFIG[sev] || SEV_CONFIG.MED;
                        return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cfg.color} ${cfg.glow}`}><Flag className="w-2.5 h-2.5" /> {cfg.label}</span>;
                      })()}
                      {profileData.activeBans?.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-orange-900 text-orange-400 text-[10px] font-bold uppercase tracking-wider border border-orange-700"><Ban className="w-2.5 h-2.5" /> Game Banned</span>
                      )}
                      {(profileData.tags || []).map((t: any) => (
                        <span key={t.id} style={{background: t.color + "33", color: t.color, borderColor: t.color + "66"}} className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border">{t.label}</span>
                      ))}
                      {(() => {
                        const act = onlinePlayers.find((op: any) => op.playerId === profilePlayer.id);
                        if (!act) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 text-[10px] font-bold uppercase tracking-wider">Offline</span>;
                        if (act.game === "lobby") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-muted-foreground text-[10px] font-bold uppercase tracking-wider">In Lobby</span>;
                        return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${GAME_COLORS[act.game] || "bg-zinc-800 text-muted-foreground"}`}>{GAME_LABELS[act.game] || act.game}</span>;
                      })()}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="text-xs text-muted-foreground">{profileData.player?.chips?.toLocaleString()} chips</span>
                      {profileData.player?.flagReason && <span className="text-[10px] text-red-400">Flag: {profileData.player.flagReason} <span className="text-muted-foreground">(by {profileData.player.flaggedBy})</span></span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex gap-3 text-center">
                      <div><p className="text-sm font-bold text-foreground">{profileData.warnings?.length ?? 0}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">Warns</p></div>
                      <div><p className="text-sm font-bold text-foreground">{profileData.notes?.length ?? 0}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">Notes</p></div>
                      <div><p className="text-sm font-bold text-foreground">{profileData.activeBans?.length ?? 0}</p><p className="text-[9px] text-muted-foreground uppercase tracking-wider">Bans</p></div>
                    </div>
                    <button onClick={refreshProfile} className="p-1.5 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors ml-2">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Two-column body ──────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3 items-start">

                {/* LEFT: Actions */}
                <div className="space-y-3">
                  <div className="bg-card border border-zinc-700 rounded-2xl overflow-hidden">
                    {/* Action tabs */}
                    <div className="flex border-b border-zinc-700">
                      {([
                        { id: "flag", icon: <Flag className="w-3 h-3" />, label: "Flag" },
                        { id: "note", icon: <FileText className="w-3 h-3" />, label: "Note" },
                        { id: "tags", icon: <Tag className="w-3 h-3" />, label: "Tags" },
                        ...(isPitBossOrAbove ? [
                          { id: "warn", icon: <AlertTriangle className="w-3 h-3" />, label: "Warn" },
                          { id: "ban",  icon: <Ban className="w-3 h-3" />, label: "Ban"  },
                        ] : []),
                      ] as { id: string; icon: React.ReactNode; label: string }[]).map((tab) => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveAction(activeAction === tab.id as any ? null : tab.id as any)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-r border-zinc-700 last:border-r-0
                            ${activeAction === tab.id
                              ? tab.id === "ban" ? "bg-orange-950 text-orange-400"
                              : tab.id === "warn" ? "bg-yellow-950 text-yellow-400"
                              : "bg-red-950 text-red-300"
                              : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}
                        >
                          {tab.icon} {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Flag panel */}
                    {activeAction === "flag" && (
                      <div className="p-4 space-y-3">
                        <div className="flex gap-1.5">
                          {(["LOW", "MED", "HIGH"] as const).map((s) => {
                            const cfg = SEV_CONFIG[s];
                            return (
                              <button key={s} onClick={() => setFlagSeverity(s)}
                                className={`flex-1 py-1.5 rounded text-[11px] font-bold uppercase tracking-wider border transition-all ${flagSeverity === s ? cfg.color + " " + cfg.glow : "border-zinc-700 text-muted-foreground hover:text-foreground"}`}>
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <input type="text" value={flagReason} onChange={(e) => setFlagReason(e.target.value)}
                            placeholder={profileData.player?.flagged ? "Update reason…" : "Reason…"}
                            className="flex-1 bg-black/50 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
                          {profileData.player?.flagged
                            ? <Button size="sm" variant="secondary" onClick={handleEditFlag} isLoading={flagging}>Save</Button>
                            : <Button size="sm" variant="destructive" onClick={() => handleFlag(false)} isLoading={flagging} disabled={!flagReason.trim()}><Flag className="w-3 h-3 mr-1" />Flag</Button>}
                        </div>
                        {profileData.player?.flagged && (
                          <button onClick={() => handleFlag(true)} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <UserCheck className="w-3.5 h-3.5" /> Remove flag &amp; clear watchlist
                          </button>
                        )}
                        {/* Kick inline if online */}
                        {(() => {
                          const online = onlinePlayers.find((op) => op.playerId === profilePlayer.id);
                          if (!online || online.game === "lobby") return null;
                          return (
                            <div className="pt-2 border-t border-zinc-700">
                              <Button size="sm" variant="secondary" onClick={() => kickPlayer(profilePlayer.id, profilePlayer.username)} isLoading={kickingId === profilePlayer.id} className="w-full">
                                <LogOut className="w-3.5 h-3.5 mr-1.5" /> Kick to Lobby
                              </Button>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Note panel */}
                    {activeAction === "note" && (
                      <div className="p-4 space-y-2">
                        <textarea value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
                          placeholder="Staff note…" rows={3}
                          className="w-full bg-black/50 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
                        <div className="flex justify-end">
                          <Button size="sm" onClick={handleAddNote} isLoading={addingNote} disabled={!noteContent.trim()}>
                            <Plus className="w-3.5 h-3.5 mr-1" /> Add Note
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Tags panel */}
                    {activeAction === "tags" && (
                      <div className="p-4 space-y-3">
                        {/* Existing tags */}
                        {(profileData?.tags || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {(profileData.tags || []).map((t: any) => (
                              <span key={t.id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border" style={{background: t.color+"33", color: t.color, borderColor: t.color+"66"}}>
                                {t.flagged && <Flag className="w-2.5 h-2.5 shrink-0" />}
                                {t.label}
                                <button type="button" onClick={() => handleDeleteTag(t.id)} className="opacity-60 hover:opacity-100 transition-opacity ml-0.5 rounded hover:bg-black/20">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Add new tag */}
                        <div className="space-y-2">
                          <div className="relative">
                            <input type="text" value={tagLabel}
                              onChange={e => { setTagLabel(e.target.value); setTagDropdownOpen(true); }}
                              onFocus={() => setTagDropdownOpen(true)}
                              onBlur={() => setTimeout(() => setTagDropdownOpen(false), 150)}
                              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } if (e.key === "Escape") setTagDropdownOpen(false); }}
                              placeholder="Tag label (e.g. WHALE, WATCH, VIP)…" maxLength={30}
                              className="w-full bg-black/50 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50" />
                            {tagDropdownOpen && (() => {
                              const q = tagLabel.trim().toUpperCase();
                              const matches = allTagTemplates.filter(t => !q || t.label.toUpperCase().includes(q));
                              return matches.length > 0 ? (
                                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden max-h-40 overflow-y-auto">
                                  {matches.map((t, i) => (
                                    <button key={i} type="button"
                                      onMouseDown={() => { setTagLabel(t.label); setTagColor(t.color); setTagFlagged(!!t.flagged); setTagDropdownOpen(false); }}
                                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 text-left transition-colors">
                                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background: t.color}} />
                                      <span className="text-xs font-bold uppercase tracking-wider" style={{color: t.color}}>{t.label}</span>
                                      {t.flagged && <Flag className="w-2.5 h-2.5 text-red-400 ml-auto shrink-0" />}
                                    </button>
                                  ))}
                                </div>
                              ) : null;
                            })()}
                          </div>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider shrink-0">Color:</p>
                            <div className="flex gap-1.5 flex-wrap">
                              {["#6b7280","#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#dc2626","#7c3aed"].map(c => (
                                <button key={c} onClick={() => setTagColor(c)} title={c}
                                  className="w-5 h-5 rounded-full border-2 transition-all"
                                  style={{background: c, borderColor: tagColor === c ? "white" : "transparent", transform: tagColor === c ? "scale(1.2)" : "scale(1)"}} />
                              ))}
                            </div>
                          </div>
                          <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                            <div
                              onClick={() => setTagFlagged(f => !f)}
                              className={`relative w-8 h-4 rounded-full transition-colors ${tagFlagged ? "bg-red-600" : "bg-zinc-700"}`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${tagFlagged ? "translate-x-4" : "translate-x-0.5"}`} />
                            </div>
                            <span className={`text-[10px] uppercase tracking-wider font-semibold ${tagFlagged ? "text-red-400" : "text-muted-foreground"}`}>
                              <Flag className="w-2.5 h-2.5 inline mr-0.5 mb-0.5" />
                              Flag
                            </span>
                          </label>
                          <div className="flex items-center justify-between gap-2">
                            {tagLabel.trim() && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border" style={{background: tagColor+"33", color: tagColor, borderColor: tagColor+"66"}}>
                                {tagFlagged && <Flag className="w-2.5 h-2.5" />}
                                {tagLabel}
                              </span>
                            )}
                            <Button size="sm" onClick={handleAddTag} isLoading={addingTag} disabled={!tagLabel.trim()} className="ml-auto">
                              <Plus className="w-3.5 h-3.5 mr-1" /> Add Tag
                            </Button>
                          </div>
                        </div>
                        {tagMsg && <p className={`text-xs ${tagMsg.ok ? "text-green-400" : "text-red-400"}`}>{tagMsg.text}</p>}
                      </div>
                    )}

                    {/* Warn panel (pit boss+) */}
                    {activeAction === "warn" && isPitBossOrAbove && (
                      <div className="p-4 space-y-2">
                        <div className="flex gap-2">
                          <input type="text" value={warnReason} onChange={(e) => setWarnReason(e.target.value)}
                            placeholder="Warning reason…"
                            className="flex-1 bg-black/50 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
                          <Button size="sm" variant="secondary" onClick={handleWarn} isLoading={warning} disabled={!warnReason.trim()}>
                            <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Warn
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Ban panel (pit boss+) */}
                    {activeAction === "ban" && isPitBossOrAbove && (
                      <div className="p-4 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <select value={banGame} onChange={(e) => setBanGame(e.target.value)} className="bg-input border border-zinc-700 rounded-lg px-2 py-1.5 text-foreground text-sm">
                            {Object.entries(GAME_LABELS).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}
                          </select>
                          <select value={banDurationHours} onChange={(e) => setBanDurationHours(Number(e.target.value))} className="bg-input border border-zinc-700 rounded-lg px-2 py-1.5 text-foreground text-sm">
                            {BAN_DURATION_OPTIONS.map((o) => <option key={o.hours} value={o.hours}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <input type="text" value={banReason} onChange={(e) => setBanReason(e.target.value)}
                            placeholder="Ban reason…"
                            className="flex-1 bg-black/50 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-orange-500/50" />
                          <Button size="sm" variant="destructive" onClick={handleGameBan} isLoading={banning} disabled={!banReason.trim()}>
                            <Ban className="w-3.5 h-3.5 mr-1" /> Ban
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Staff Intel — security-only, never affects player avatar */}
                  <div className="bg-card border border-amber-700 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-amber-800">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5" /> Staff Intel
                      </h4>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 bg-amber-950 border border-amber-800 px-2 py-0.5 rounded">Security Only</span>
                    </div>

                    {/* Photo gallery */}
                    {(() => {
                      let photos: string[] = [];
                      try { photos = JSON.parse(profileData.player?.securityPhotos || "[]"); } catch {}
                      return (
                        <div className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[9px] text-amber-400 uppercase tracking-wider font-semibold">Surveillance Photos</p>
                            <label className={`cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${photoUploading ? "border-zinc-700 text-muted-foreground cursor-not-allowed" : "border-amber-700 text-amber-400 hover:bg-amber-950"}`}>
                              {photoUploading ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Uploading…</> : <><Upload className="w-2.5 h-2.5" /> Add</>}
                              <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" disabled={photoUploading}
                                onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = ""; }} />
                            </label>
                          </div>
                          {/* URL input */}
                          <div className="flex gap-1.5">
                            <input
                              type="url"
                              value={photoUrlInput}
                              onChange={(e) => setPhotoUrlInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handlePhotoUrlAdd(); }}
                              placeholder="Paste image URL…"
                              className="flex-1 bg-black/50 border border-amber-800 rounded px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                            />
                            <button
                              onClick={handlePhotoUrlAdd}
                              disabled={!photoUrlInput.trim() || photoUrlAdding}
                              className="px-2 py-1 rounded bg-amber-800 hover:bg-amber-600 disabled:opacity-40 text-[10px] font-bold text-white uppercase tracking-wider transition-colors shrink-0"
                            >
                              {photoUrlAdding ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                            </button>
                          </div>

                          {photos.length === 0 ? (
                            <div className="border border-dashed border-amber-800 rounded-lg p-3 text-center">
                              <p className="text-[10px] text-muted-foreground">No photos on file</p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-3 gap-1.5">
                              {photos.map((url: string, i: number) => (
                                <div key={url} className="relative group aspect-square">
                                  <img src={url} alt={`Photo ${i + 1}`}
                                    className={`w-full h-full object-cover rounded border-2 cursor-pointer ${i === 0 ? "border-amber-600" : "border-zinc-700"}`}
                                    onClick={() => setLightboxPhoto(url)} />
                                  {i === 0 && <span className="absolute top-0.5 left-0.5 bg-amber-600 text-[7px] font-bold px-1 rounded uppercase text-black leading-tight py-0.5">Primary</span>}
                                  <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center gap-1 p-1">
                                    <button onClick={() => setLightboxPhoto(url)} title="View" className="p-1 rounded bg-white/20 hover:bg-white/30 text-white transition-colors"><Eye className="w-3 h-3" /></button>
                                    {i !== 0 && <button onClick={() => handleSetPrimaryPhoto(url)} title="Set as primary" className="p-1 rounded bg-amber-800 hover:bg-amber-600 text-white transition-colors"><Star className="w-3 h-3" /></button>}
                                    <button onClick={() => setPendingDeletePhotoUrl(url)} title="Delete" className="p-1 rounded bg-red-800 hover:bg-red-600 text-white transition-colors"><Trash2 className="w-3 h-3" /></button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {photoError && <p className="text-[10px] text-red-400">{photoError}</p>}
                          {pendingDeletePhotoUrl && (
                            <div className="mt-2 rounded-lg border border-red-700 bg-red-950 p-2 flex items-center gap-2">
                              <p className="text-[10px] text-red-300 flex-1">Delete this photo? Cannot be undone.</p>
                              <button onClick={() => { handlePhotoDelete(pendingDeletePhotoUrl); setPendingDeletePhotoUrl(null); }}
                                className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold transition-colors">Delete</button>
                              <button onClick={() => setPendingDeletePhotoUrl(null)}
                                className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] font-bold transition-colors">Cancel</button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Internal notes */}
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-amber-800">
                      <p className="text-[9px] text-amber-400 uppercase tracking-wider font-semibold pt-2">Internal Notes</p>
                      <textarea value={securityNotes} onChange={(e) => setSecurityNotes(e.target.value)}
                        placeholder="Staff-only notes…" rows={2}
                        className="w-full bg-black/50 border border-amber-800 rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/40 resize-none" />
                      <div className="flex justify-end">
                        <Button size="sm" variant="secondary" onClick={handleSaveNotes} isLoading={savingNotes}>Save</Button>
                      </div>
                    </div>

                    {/* Login log exclusion toggle */}
                    <div className="px-3 pb-3 pt-1 border-t border-amber-800">
                      <button
                        onClick={handleToggleLoginLogs}
                        disabled={togglingLoginLogs}
                        className="flex items-center justify-between w-full py-2 group"
                      >
                        <div className="text-left">
                          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Exclude from Login Logs</p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">Hides login &amp; site-active events from the floor feed for this player</p>
                        </div>
                        <div className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ml-3 ${excludeFromLoginLogs ? "bg-amber-600" : "bg-zinc-700"}`}>
                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${excludeFromLoginLogs ? "translate-x-4" : "translate-x-0.5"}`} />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>{/* end left col */}

                {/* RIGHT column — history */}
                <div className="space-y-3">

                  {/* Active Bans */}
                  {profileData.activeBans?.length > 0 && (
                    <div className="bg-card border border-orange-800 rounded-2xl p-4 space-y-2">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-orange-400 flex items-center gap-1.5"><Ban className="w-3.5 h-3.5" /> Active Game Bans</h4>
                      {profileData.activeBans.map((ban: any) => (
                        <div key={ban.id} className="flex items-start gap-2 bg-black/30 border border-orange-800 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${GAME_COLORS[ban.game] || "bg-zinc-800 text-muted-foreground"}`}>{GAME_LABELS[ban.game] || ban.game}</span>
                              {ban.expiresAt && <span className="text-[10px] text-muted-foreground">Exp: {fmtETFull(ban.expiresAt)}</span>}
                              {!ban.expiresAt && <span className="text-[10px] text-red-400 font-semibold">Permanent</span>}
                            </div>
                            <p className="text-xs text-foreground mt-1">{ban.reason}</p>
                            <p className="text-[10px] text-muted-foreground">by {ban.staffUsername}</p>
                          </div>
                          {isPitBossOrAbove && (
                            <Button size="sm" variant="ghost" onClick={() => handleLiftBan(ban.id)} className="text-green-400 hover:text-green-300 shrink-0 text-xs">
                              <Unlock className="w-3 h-3 mr-1" /> Lift
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Notes history */}
                  {profileData.notes?.length > 0 && (
                    <div className="bg-card border border-zinc-700 rounded-2xl p-4 space-y-2">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Staff Notes</h4>
                      {profileData.notes.map((note: any) => (
                        <div key={note.id} className="flex items-start gap-2 bg-black/30 border border-zinc-700 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground">{note.content}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{note.staffUsername} · {fmtETFull(note.createdAt)}</p>
                          </div>
                          <button onClick={() => handleDeleteNote(note.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Warnings history */}
                  {profileData.warnings?.length > 0 && (
                    <div className="bg-card border border-yellow-800 rounded-2xl p-4 space-y-2">
                      <h4 className="text-[11px] font-bold uppercase tracking-widest text-yellow-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Warnings</h4>
                      {profileData.warnings.map((w: any) => (
                        <div key={w.id} className="bg-black/30 border border-yellow-800 rounded-lg px-3 py-2 flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground">{w.reason}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{w.staffUsername} · {fmtETFull(w.createdAt)}</p>
                          </div>
                          {isPitBossOrAbove && (
                            <button onClick={() => handleDeleteWarning(w.id)} className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Chip Transaction History */}
                  {(() => {
                    const secFiltered = [...secTxs].filter(tx => {
                      if (detectTxGame(tx.description, tx.type) === "Poker" && tx.type !== "rake") return false;
                      if (secTxTypeFilter !== "all" && tx.type !== secTxTypeFilter) return false;
                      if (secTxSearch && !tx.description?.toLowerCase().includes(secTxSearch.toLowerCase())) return false;
                      return true;
                    });
                    return (
                      <div className="bg-card border border-zinc-700 rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <DollarSign className="w-3.5 h-3.5 text-primary" />
                          <h4 className="text-[11px] font-bold uppercase tracking-widest text-primary flex-1">Chip History</h4>
                          <span className="text-[10px] text-muted-foreground/60">{secTxsLoading ? "…" : `${secFiltered.length}/${secTxs.length}`}</span>
                        </div>
                        {/* Filter bar */}
                        <div className="flex flex-wrap gap-1 items-center">
                          <div className="relative flex-1 min-w-[90px]">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            <input
                              value={secTxSearch}
                              onChange={e => setSecTxSearch(e.target.value)}
                              placeholder="Search…"
                              className="w-full bg-black/30 border border-zinc-700 rounded-lg pl-6 pr-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                            />
                          </div>
                          {(["all","win","loss","deposit","withdrawal","rake"] as const).map(t => (
                            <button key={t} onClick={() => setSecTxTypeFilter(t)}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                                secTxTypeFilter === t
                                  ? t === "all" ? "bg-red-950 text-red-300 border-red-800" : (TX_TYPE_BADGE[t] || "bg-zinc-800 text-muted-foreground border-zinc-700") + " border"
                                  : "border-zinc-700 text-muted-foreground hover:text-foreground"
                              }`}>
                              {t === "all" ? "All" : TX_TYPE_LABEL[t] || t}
                            </button>
                          ))}
                          {(secTxSearch || secTxTypeFilter !== "all") && (
                            <button onClick={() => { setSecTxSearch(""); setSecTxTypeFilter("all"); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1">✕</button>
                          )}
                        </div>
                        {/* List */}
                        {secTxsLoading ? (
                          <p className="text-xs text-muted-foreground py-2">Loading…</p>
                        ) : secTxs.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">No chip transactions on file.</p>
                        ) : secFiltered.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">No matches.</p>
                        ) : (
                          <div className="max-h-64 overflow-y-auto pr-0.5">
                            <GroupedTransactionList txs={secFiltered} />
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Empty right col placeholder */}
                  {!profileData.activeBans?.length && !profileData.notes?.length && !profileData.warnings?.length && secTxs.length === 0 && !secTxsLoading && (
                    <div className="border border-dashed border-zinc-700 rounded-2xl p-6 text-center">
                      <p className="text-xs text-muted-foreground">No bans, notes, warnings, or chip transactions on file.</p>
                    </div>
                  )}
                </div>{/* end right col */}

              </div>{/* end 2-col grid */}
            </div>
          )}
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] w-full flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-amber-400 font-bold uppercase tracking-widest">Surveillance Photo</span>
              <div className="flex items-center gap-2">
                <a href={lightboxPhoto} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground border border-zinc-700 rounded px-2 py-1 transition-colors">
                  Open in new tab
                </a>
                <button onClick={() => setLightboxPhoto(null)} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <img
              src={lightboxPhoto}
              alt="Surveillance photo"
              className="max-w-full max-h-[80vh] object-contain rounded-lg border border-amber-800"
            />
          </div>
        </div>
      )}

      {activeSection === "accounts" && (
        <RecentAccountsSection
          authToken={authToken}
          onViewPlayer={(stateId) => {
            setProfileSearch(stateId);
            setActiveSection("profile");
          }}
        />
      )}
    </div>
  );
}

// ── Employee Activity Stats ────────────────────────────────────────────────────
type StaffStat = {
  username: string;
  depositCount: number; depositTotal: number;
  withdrawalCount: number; withdrawalTotal: number;
  bonusCount: number; bonusTotal: number;
  loanCount: number;
  bansIssued: number; notesAdded: number; warningsIssued: number;
  lastActivity: string | null;
};

function StaffTab({ isOwner = false }: { isOwner?: boolean }) {
  const { data: accounts = [], refetch } = useListBankerAccounts();
  const createMutation = useCreateBankerAccount();
  const updateMutation = useUpdateBankerAccount();
  const deleteMutation = useDeleteBankerAccount();
  const { bankerUsername, bankerToken, sessionToken, setBankerStateId } = useStore();
  const esAuthToken = bankerToken || sessionToken || "";

  // ── Employee Activity Stats state ──
  const [esPeriod, setEsPeriod] = useState<"today" | "7d" | "30d" | "all" | "custom">("30d");
  const [esStats, setEsStats] = useState<StaffStat[]>([]);
  const [esLoading, setEsLoading] = useState(false);
  const [esError, setEsError] = useState<string | null>(null);
  const [esCustomStart, setEsCustomStart] = useState<string>("");
  const [esCustomEnd, setEsCustomEnd] = useState<string>("");

  const esFetch = useCallback(async (p: string, customStart?: string, customEnd?: string) => {
    setEsLoading(true); setEsError(null);
    try {
      let url: string;
      if (p === "custom" && customStart && customEnd) {
        url = `${BASE_URL}/api/banker/staff-stats?start=${encodeURIComponent(customStart)}&end=${encodeURIComponent(customEnd)}`;
      } else {
        url = `${BASE_URL}/api/banker/staff-stats?period=${p}`;
      }
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${esAuthToken}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setEsStats(d.stats ?? []);
    } catch (e: any) { setEsError(e.message); }
    finally { setEsLoading(false); }
  }, [esAuthToken]);

  useEffect(() => { if (esPeriod !== "custom") esFetch(esPeriod); }, [esPeriod]);
  // Auto-refresh employee stats every 60 s so "Last Active" stays current
  useEffect(() => {
    const iv = setInterval(() => {
      if (esPeriod === "custom") esFetch("custom", esCustomStart, esCustomEnd);
      else esFetch(esPeriod);
    }, 60_000);
    return () => clearInterval(iv);
  }, [esPeriod, esCustomStart, esCustomEnd]);

  const esFmtC = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
    return n.toLocaleString();
  };
  const esFmtAge = (iso: string | null): { label: string; color: string } => {
    if (!iso) return { label: "Never", color: "text-muted-foreground" };
    // Postgres raw timestamps come back without a timezone marker — force UTC so
    // the browser doesn't mis-parse them as local time and report a negative diff.
    const utcIso = iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`;
    const diff = Date.now() - new Date(utcIso).getTime();
    const secs  = Math.floor(diff / 1000);
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (secs  < 60)  return { label: "Just now",      color: "text-green-400" };
    if (hours < 1)   return { label: `${mins}m ago`,  color: "text-green-400" };
    if (hours < 24)  return { label: `${hours}h ago`, color: "text-yellow-400" };
    if (days  < 7)   return { label: `${days}d ago`,  color: "text-amber-400" };
    if (days  < 30)  return { label: `${days}d ago`,  color: "text-orange-400" };
    return { label: `${days}d ago`, color: "text-red-400" };
  };
  const esTotals = esStats.reduce(
    (acc, s) => ({ deposits: acc.deposits + s.depositTotal, depositCt: acc.depositCt + s.depositCount, withdrawals: acc.withdrawals + s.withdrawalTotal, withdrawalCt: acc.withdrawalCt + s.withdrawalCount, bonuses: acc.bonuses + s.bonusTotal, bonusCt: acc.bonusCt + s.bonusCount }),
    { deposits: 0, depositCt: 0, withdrawals: 0, withdrawalCt: 0, bonuses: 0, bonusCt: 0 }
  );
  const esPeriodLabels: Record<string, string> = { today: "Today", "7d": "7 Days", "30d": "30 Days", all: "All Time", custom: "Custom" };

  // Roles a banker can assign — owners and bankers are off-limits for non-owners
  const assignableRoles = isOwner
    ? ["dealer", "banker", "sportbets", "pit_boss", "security_guard", "cage_clerk", "junior_banker", "owner"]
    : ["dealer", "sportbets", "pit_boss", "security_guard", "cage_clerk", "junior_banker"];

  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<string>("dealer");
  const [newRole2, setNewRole2] = useState<string>("none");
  const [newStateId, setNewStateId] = useState("");
  const [createError, setCreateError] = useState("");

  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [editRoleId, setEditRoleId] = useState<number | null>(null);
  const [editRole, setEditRole] = useState<string>("dealer");
  const [editRole2, setEditRole2] = useState<string>("none");
  const [stateIdEditId, setStateIdEditId] = useState<number | null>(null);
  const [stateIdInput, setStateIdInput] = useState("");
  const [stateIdError, setStateIdError] = useState("");
  const [confirmDel, setConfirmDel] = useState<{ id: number; name: string } | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    try {
      await createMutation.mutateAsync({ data: { username: newUsername, password: newPassword, isAdmin: newRole === "owner", role: newRole, role2: newRole2 === "none" ? null : newRole2, stateId: newStateId || null } as any });
      setNewUsername(""); setNewPassword(""); setNewRole("dealer"); setNewRole2("none"); setNewStateId(""); setShowCreate(false);
      refetch();
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || "Failed to create account.");
    }
  }

  async function handleSaveStateId() {
    if (stateIdEditId === null) return;
    setStateIdError("");
    try {
      await updateMutation.mutateAsync({ id: stateIdEditId, data: { stateId: stateIdInput.trim() || null } as any });
      const account = accounts.find((a: any) => a.id === stateIdEditId);
      if (account && (account as any).username === bankerUsername) {
        setBankerStateId(stateIdInput.trim() || null);
      }
      setStateIdEditId(null); setStateIdInput("");
      refetch();
    } catch (err: any) {
      setStateIdError(err?.response?.data?.error || "Failed to update State ID.");
    }
  }

  async function handleToggleActive(id: number, current: boolean) {
    await updateMutation.mutateAsync({ id, data: { isActive: !current } });
    refetch();
  }

  async function handleDelete(id: number, username: string) {
    setConfirmDel({ id, name: username });
  }

  async function confirmDeleteAccount() {
    if (!confirmDel) return;
    try {
      await deleteMutation.mutateAsync({ id: confirmDel.id });
      setConfirmDel(null);
      refetch();
    } catch (err: any) {
      setConfirmDel(null);
      showToast(err?.message || "Failed to delete account");
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    if (!resetId) return;
    try {
      await updateMutation.mutateAsync({ id: resetId, data: { password: resetPassword } });
      setResetId(null); setResetPassword("");
      refetch();
    } catch (err: any) {
      setResetError(err?.response?.data?.error || "Failed to reset password.");
    }
  }

  async function handleSaveRole() {
    if (!editRoleId) return;
    try {
      await updateMutation.mutateAsync({ id: editRoleId, data: { role: editRole, isAdmin: editRole === "owner", role2: editRole2 === "none" ? null : editRole2 } as any });
      setEditRoleId(null);
      refetch();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Failed to update role.");
    }
  }

  const fmtDate = (d: string | null) => d ? fmtETDateTimeFull(d) : "Never";

  return (
    <div className="space-y-6">
      {/* ── Employee Activity Stats ── */}
      <div className="space-y-4">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 className="text-xl font-display font-bold text-foreground uppercase tracking-wide" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Activity className="w-5 h-5 text-primary" /> Employee Activity
            </h2>
            <p className="text-xs text-muted-foreground" style={{ marginTop: "2px" }}>Chip transactions and enforcement actions processed by each staff member</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {(["today", "7d", "30d", "all", "custom"] as const).map(p => (
              <button key={p} onClick={() => setEsPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-wider transition-colors ${esPeriod === p ? "bg-primary text-primary-foreground" : "bg-card border border-zinc-700 text-muted-foreground hover:text-foreground"}`}>
                {esPeriodLabels[p]}
              </button>
            ))}
            <button onClick={() => esPeriod === "custom" ? esFetch("custom", esCustomStart, esCustomEnd) : esFetch(esPeriod)} disabled={esLoading}
              className="ml-1 p-1.5 rounded-lg bg-card border border-zinc-700 text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${esLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {esPeriod === "custom" && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "10px", flexWrap: "wrap" }} className="bg-card border border-zinc-700 rounded-xl p-4">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="text-xs text-muted-foreground uppercase tracking-wider font-display">From</label>
              <input
                type="datetime-local"
                value={esCustomStart}
                onChange={e => setEsCustomStart(e.target.value)}
                className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                style={{ colorScheme: "dark" }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label className="text-xs text-muted-foreground uppercase tracking-wider font-display">To</label>
              <input
                type="datetime-local"
                value={esCustomEnd}
                onChange={e => setEsCustomEnd(e.target.value)}
                className="bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                style={{ colorScheme: "dark" }}
              />
            </div>
            <button
              onClick={() => esFetch("custom", esCustomStart, esCustomEnd)}
              disabled={!esCustomStart || !esCustomEnd || esLoading}
              className="px-4 py-1.5 rounded-lg text-xs font-display font-bold uppercase tracking-wider bg-primary text-primary-foreground disabled:opacity-40 transition-colors"
            >
              {esLoading ? "Loading…" : "Apply"}
            </button>
            {esCustomStart && esCustomEnd && (
              <span className="text-xs text-muted-foreground self-center">
                {new Date(esCustomStart).toLocaleString()} — {new Date(esCustomEnd).toLocaleString()}
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-zinc-700 rounded-xl p-4">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <TrendingUp className="w-4 h-4 text-green-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Deposits In</span>
            </div>
            <p className="text-xl font-bold text-green-400">{esFmtC(esTotals.deposits)} chips</p>
            <p className="text-xs text-muted-foreground" style={{ marginTop: "2px" }}>{esTotals.depositCt} transaction{esTotals.depositCt !== 1 ? "s" : ""}</p>
          </div>
          <div className="bg-card border border-zinc-700 rounded-xl p-4">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Withdrawals Out</span>
            </div>
            <p className="text-xl font-bold text-red-400">{esFmtC(esTotals.withdrawals)} chips</p>
            <p className="text-xs text-muted-foreground" style={{ marginTop: "2px" }}>{esTotals.withdrawalCt} transaction{esTotals.withdrawalCt !== 1 ? "s" : ""}</p>
          </div>
          <div className="bg-card border border-zinc-700 rounded-xl p-4">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
              <Gift className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-display">Bonuses / Other</span>
            </div>
            <p className="text-xl font-bold text-amber-400">{esFmtC(esTotals.bonuses)} chips</p>
            <p className="text-xs text-muted-foreground" style={{ marginTop: "2px" }}>{esTotals.bonusCt} issued</p>
          </div>
        </div>
        {esError ? (
          <p className="text-destructive text-sm">{esError}</p>
        ) : esLoading && esStats.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 0", gap: "8px" }} className="text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading...
          </div>
        ) : esStats.length === 0 ? (
          <div className="bg-card border border-zinc-700 rounded-xl p-6 text-center text-muted-foreground text-sm font-typewriter">
            No staff activity found for this period.
          </div>
        ) : (
          <div className="bg-card border border-zinc-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-700 bg-zinc-800">
                    <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider font-display">Staff</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Deposits</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Withdrawals</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Bonus/Other</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Loans</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Actions</th>
                    <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wider font-display">Last Active</th>
                  </tr>
                </thead>
                <tbody className="bg-zinc-950 divide-y divide-zinc-700">
                  {esStats.map(s => {
                    const age = esFmtAge(s.lastActivity);
                    const totalActions = s.bansIssued + s.notesAdded + s.warningsIssued;
                    return (
                      <tr key={s.username} className="hover:bg-zinc-900 transition-colors">
                        <td className="px-4 py-3">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div className="w-7 h-7 rounded-full bg-red-950 border border-red-900" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                            <span className="font-semibold text-foreground">{s.username}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.depositCount > 0 ? <div><span className="font-bold text-green-400">{esFmtC(s.depositTotal)}</span><span className="text-muted-foreground text-xs ml-1">({s.depositCount}×)</span></div> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.withdrawalCount > 0 ? <div><span className="font-bold text-red-400">{esFmtC(s.withdrawalTotal)}</span><span className="text-muted-foreground text-xs ml-1">({s.withdrawalCount}×)</span></div> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.bonusCount > 0 ? <div><span className="font-bold text-amber-400">{esFmtC(s.bonusTotal)}</span><span className="text-muted-foreground text-xs ml-1">({s.bonusCount}×)</span></div> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {s.loanCount > 0 ? <span className="text-cyan-400 font-bold">{s.loanCount}</span> : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {totalActions > 0 ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "8px" }}>
                              {s.bansIssued > 0 && <span className="text-xs bg-red-950 text-red-400 px-1.5 py-0.5 rounded font-bold">{s.bansIssued} ban{s.bansIssued !== 1 ? "s" : ""}</span>}
                              {s.warningsIssued > 0 && <span className="text-xs bg-amber-950 text-amber-400 px-1.5 py-0.5 rounded font-bold">{s.warningsIssued} warn</span>}
                              {s.notesAdded > 0 && <span className="text-xs bg-blue-950 text-blue-400 px-1.5 py-0.5 rounded font-bold">{s.notesAdded} note{s.notesAdded !== 1 ? "s" : ""}</span>}
                            </div>
                          ) : <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs font-medium ${age.color}`}>{age.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-700 bg-zinc-900">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-display">Totals</td>
                    <td className="px-4 py-2.5 text-right"><span className="font-bold text-green-400 text-sm">{esFmtC(esTotals.deposits)}</span><span className="text-muted-foreground text-xs ml-1">({esTotals.depositCt})</span></td>
                    <td className="px-4 py-2.5 text-right"><span className="font-bold text-red-400 text-sm">{esFmtC(esTotals.withdrawals)}</span><span className="text-muted-foreground text-xs ml-1">({esTotals.withdrawalCt})</span></td>
                    <td className="px-4 py-2.5 text-right"><span className="font-bold text-amber-400 text-sm">{esFmtC(esTotals.bonuses)}</span><span className="text-muted-foreground text-xs ml-1">({esTotals.bonusCt})</span></td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-zinc-700 bg-zinc-900">
              <p className="text-[11px] text-muted-foreground">Period: <span className="text-foreground font-medium">{esPeriodLabels[esPeriod]}</span> — chip transactions. Enforcement actions shown all-time.</p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-700 pt-6">
        <PlayerStaffSection isOwner={isOwner} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground uppercase tracking-wide">Staff Management</h2>
          <p className="text-sm text-muted-foreground mt-1">Legacy standalone staff accounts — use player-linked access above for new staff.</p>
        </div>
        <Button onClick={() => setShowCreate(v => !v)} size="sm">
          <Plus className="w-4 h-4 mr-2" /> Add Staff Account
        </Button>
      </div>

      {/* Role guide */}
      <div className="grid grid-cols-2 grid-cols-4 gap-2">
        {[
          { role: "owner", desc: "Full access — all tabs, staff management" },
          { role: "banker", desc: "Players, chips in/out, tables, tournaments, stats" },
          { role: "dealer", desc: "Open/close tables and games only" },
          { role: "sportbets", desc: "Sport bets section only" },
          { role: "pit_boss", desc: "Flag players, issue warnings, temporary game bans, view security" },
          { role: "security_guard", desc: "View online players, flag accounts, add notes (read-only enforcement)" },
          { role: "cage_clerk", desc: "Deposits only — max 50k per transaction; no withdrawals" },
          { role: "junior_banker", desc: "Deposit & withdraw chips — max 250k per transaction" },
        ].map(({ role, desc }) => (
          <div key={role} className="bg-card border border-zinc-700 rounded-xl p-3">
            <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ROLE_COLORS[role]}`}>{ROLE_LABELS[role]}</span>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>

      {showCreate && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-zinc-700 rounded-xl p-5">
          <h3 className="text-sm font-display font-semibold uppercase tracking-widest text-primary mb-4">Add New Staff Member</h3>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Username</label>
                <Input value={newUsername} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUsername(e.target.value)} placeholder="e.g. dealer_mike" autoComplete="off" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Password (min 8 chars)</label>
                <Input type="password" value={newPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)} placeholder="Password" autoComplete="new-password" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Primary Role</label>
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="w-full bg-input border border-zinc-700 rounded-xl px-3 py-2 text-foreground text-sm">
                  {assignableRoles.includes("dealer") && <option value="dealer">Dealer — tables &amp; games</option>}
                  {assignableRoles.includes("banker") && <option value="banker">Banker — chips &amp; players</option>}
                  {assignableRoles.includes("sportbets") && <option value="sportbets">Sport Bets — sport bets section</option>}
                  {assignableRoles.includes("pit_boss") && <option value="pit_boss">Pit Boss — security enforcement</option>}
                  {assignableRoles.includes("security_guard") && <option value="security_guard">Security Guard — flag &amp; observe</option>}
                  {assignableRoles.includes("cage_clerk") && <option value="cage_clerk">Cage Clerk — deposits only, max 50k/tx</option>}
                  {assignableRoles.includes("junior_banker") && <option value="junior_banker">Junior Banker — deposit &amp; withdraw, max 250k/tx</option>}
                  {assignableRoles.includes("owner") && <option value="owner">Owner — full access</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Secondary Role (optional)</label>
                <select value={newRole2} onChange={(e) => setNewRole2(e.target.value)} className="w-full bg-input border border-zinc-700 rounded-xl px-3 py-2 text-foreground text-sm">
                  <option value="none">— None —</option>
                  {VALID_STAFF_ROLES_UI.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">State ID <span className="normal-case text-muted-foreground/50">(optional — used for loan contracts)</span></label>
              <Input value={newStateId} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewStateId(e.target.value)} placeholder="e.g. 12345" autoComplete="off" />
            </div>
            {createError && <p className="text-destructive text-sm">{createError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={!newUsername || newPassword.length < 8 || createMutation.isPending} size="sm">
                {createMutation.isPending ? "Adding..." : "Add Staff Member"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setCreateError(""); }}>Cancel</Button>
            </div>
          </form>
        </motion.div>
      )}

      {resetId !== null && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-amber-700 rounded-xl p-5">
          <h3 className="text-sm font-display font-semibold uppercase tracking-widest text-amber-400 mb-4 flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Reset Staff Password
          </h3>
          <form onSubmit={handleResetPassword} className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">New Password (min 8 chars)</label>
              <Input type="password" value={resetPassword} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setResetPassword(e.target.value)} placeholder="New password" autoComplete="new-password" />
            </div>
            {resetError && <p className="text-destructive text-sm">{resetError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={resetPassword.length < 8 || updateMutation.isPending} size="sm">
                {updateMutation.isPending ? "Saving..." : "Save New Password"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setResetId(null); setResetPassword(""); setResetError(""); }}>Cancel</Button>
            </div>
          </form>
        </motion.div>
      )}

      {stateIdEditId !== null && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-blue-700 rounded-xl p-5">
          <h3 className="text-sm font-display font-semibold uppercase tracking-widest text-blue-400 mb-4 flex items-center gap-2">
            <Hash className="w-4 h-4" /> Set State ID
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">In-Game State ID <span className="normal-case text-muted-foreground/50">(used for loan contracts)</span></label>
              <Input value={stateIdInput} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStateIdInput(e.target.value)} placeholder="e.g. 12345" autoComplete="off" />
            </div>
            {stateIdError && <p className="text-destructive text-sm">{stateIdError}</p>}
            <div className="flex gap-2">
              <Button onClick={handleSaveStateId} disabled={updateMutation.isPending} size="sm">
                {updateMutation.isPending ? "Saving..." : "Save State ID"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setStateIdEditId(null); setStateIdInput(""); setStateIdError(""); }}>Cancel</Button>
            </div>
          </div>
        </motion.div>
      )}

      <div className="space-y-3">
        {accounts.map((account) => {
          const isLocked = account.lockedUntil && new Date(account.lockedUntil) > new Date();
          const acctRole = (account as any).role || (account.isAdmin ? "owner" : "banker");
          const isSelf = account.username === bankerUsername;
          // Bankers can only manage sub-role accounts — owners and bankers are off-limits
          const canManage = isOwner || (acctRole !== "owner" && acctRole !== "banker");
          return (
            <div key={account.id} className={`bg-card border rounded-xl p-4 flex items-center gap-4 ${!account.isActive ? "opacity-60 border-zinc-700" : "border-zinc-700"}`}>
              <div className="w-10 h-10 rounded-full bg-red-950 border border-red-900 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className={`w-5 h-5 ${acctRole === "owner" ? "text-yellow-400" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground truncate">{account.username}</span>
                  {isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                  <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider ${ROLE_COLORS[acctRole] || "bg-zinc-800 text-muted-foreground"}`}>
                    {ROLE_LABELS[acctRole] || acctRole}
                  </span>
                  {(account as any).role2 && <span className="text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wider bg-secondary/30 text-muted-foreground">+{ROLE_LABELS[(account as any).role2] || (account as any).role2}</span>}
                  {!account.isActive && <span className="text-xs bg-destructive/20 text-destructive px-2 py-0.5 rounded font-display uppercase tracking-wider">Inactive</span>}
                  {isLocked && <span className="text-xs bg-amber-900 text-amber-400 px-2 py-0.5 rounded font-display uppercase tracking-wider">Locked</span>}
                </div>
                {editRoleId === account.id && canManage ? (
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Primary</span>
                      <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="bg-input border border-zinc-700 rounded px-2 py-1 text-foreground text-xs">
                        {assignableRoles.includes("dealer") && <option value="dealer">Dealer</option>}
                        {assignableRoles.includes("banker") && <option value="banker">Banker</option>}
                        {assignableRoles.includes("sportbets") && <option value="sportbets">Sport Bets</option>}
                        {assignableRoles.includes("pit_boss") && <option value="pit_boss">Pit Boss</option>}
                        {assignableRoles.includes("security_guard") && <option value="security_guard">Security Guard</option>}
                        {assignableRoles.includes("cage_clerk") && <option value="cage_clerk">Cage Clerk</option>}
                        {assignableRoles.includes("junior_banker") && <option value="junior_banker">Junior Banker</option>}
                        {assignableRoles.includes("owner") && <option value="owner">Owner</option>}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Secondary</span>
                      <select value={editRole2} onChange={(e) => setEditRole2(e.target.value)} className="bg-input border border-zinc-700 rounded px-2 py-1 text-foreground text-xs">
                        <option value="none">— None —</option>
                        {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end gap-2 mt-4">
                      <Button size="sm" onClick={handleSaveRole} isLoading={updateMutation.isPending}>Save</Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditRoleId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span>Last login: {fmtDate(account.lastLoginAt ?? null)}</span>
                    {(account as any).stateId ? (
                      <span className="text-blue-400">SID: {(account as any).stateId}</span>
                    ) : (
                      <span className="text-muted-foreground/40 italic">No State ID</span>
                    )}
                    {account.failedAttempts > 0 && <span className="text-amber-400">Failed attempts: {account.failedAttempts}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {!isSelf && canManage && (
                  <button
                    onClick={() => { setEditRoleId(account.id); setEditRole(acctRole); setEditRole2((account as any).role2 || "none"); }}
                    className="p-2 rounded-lg text-muted-foreground hover:text-blue-400 hover:bg-blue-950 transition-colors"
                    title="Change role"
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </button>
                )}
                {(canManage || isSelf) && (
                  <button
                    onClick={() => { setStateIdEditId(account.id); setStateIdInput((account as any).stateId || ""); setStateIdError(""); }}
                    className="p-2 rounded-lg text-muted-foreground hover:text-blue-400 hover:bg-blue-950 transition-colors"
                    title="Set State ID"
                  >
                    <Hash className="w-4 h-4" />
                  </button>
                )}
                {canManage && (
                  <button
                    onClick={() => { setResetId(account.id); setResetPassword(""); setResetError(""); }}
                    className="p-2 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-amber-950 transition-colors"
                    title="Reset password"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>
                )}
                {!isSelf && canManage && (
                  <button
                    onClick={() => handleToggleActive(account.id, account.isActive)}
                    className={`p-2 rounded-lg transition-colors ${account.isActive ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10" : "text-muted-foreground hover:text-green-400 hover:bg-green-950"}`}
                    title={account.isActive ? "Deactivate" : "Activate"}
                  >
                    {account.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                  </button>
                )}
                {!isSelf && canManage && (
                  <button
                    onClick={() => handleDelete(account.id, account.username)}
                    className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove staff member"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {accounts.length === 0 && (
          <p className="text-center text-muted-foreground py-8 font-typewriter">No staff accounts found.</p>
        )}
      </div>

      {isOwner && (
        <div className="border-t border-zinc-700 pt-6">
          <h2 className="text-base font-display font-semibold uppercase tracking-widest text-primary mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4" /> House Edge &amp; RTP Settings
          </h2>
          <OwnerDashboardTab />
        </div>
      )}

      <div className="bg-amber-950 border border-amber-800 rounded-xl p-4">
        <p className="text-xs text-amber-400 font-typewriter leading-relaxed">
          <strong>Security:</strong> Accounts lock for 30 minutes after 5 failed login attempts.
          IPs are blocked for 1 hour after 10 total failures. Sessions expire after 4 hours.
          Deactivating an account immediately kills all active sessions.
        </p>
      </div>

      {confirmDel && (
        <ConfirmModal
          message={`Remove "${confirmDel.name}" from staff? This cannot be undone.`}
          confirmLabel="Remove Staff"
          isLoading={deleteMutation.isPending}
          onConfirm={confirmDeleteAccount}
          onCancel={() => setConfirmDel(null)}
        />
      )}
    </div>
  );
}

type SBPlayer = { id: number; username: string; stateId: string | null; phoneNumber: string | null; avatarUrl: string | null };
type SBOption = { id: number; eventId: number; label: string; odds: string; entryCount: number; totalWagered: number };
type SBEntry = { id: number; eventId: number; optionId: number; playerId: number | null; playerName: string; amount: number; enteredBy: string; createdAt: string; paidAt: string | null; player: SBPlayer | null };
type SBEvent = { id: number; title: string; description: string; league: string; gameDate: string | null; status: string; winnerId: number | null; rakePercent: number; createdBy: string; createdAt: string; settledAt: string | null; options: SBOption[]; entries: SBEntry[]; totalWagered: number };
type SBPayout = { entryId: number; eventId: number; eventTitle: string; playerName: string; player: SBPlayer | null; betAmount: number; optionLabel: string; odds: string; grossPayout: number; rakeAmount: number; rakePercent: number; payoutAmount: number; enteredAt: string };

type ManualEvent = {
  id: number; sport: string; sport_key: string; league: string;
  home_team: string; away_team: string; home_odds: number; away_odds: number;
  commence_time: string; live: boolean; event_name: string | null; created_by: string;
};

type BetSlipRecord = {
  id: number; playerId: number; playerUsername: string; type: string;
  wagerAmount: number; potentialPayout: number; actualPayout: number | null;
  status: string; selections: string; adminNote: string | null;
  settledAt: string | null; settledBy: string | null; createdAt: string;
};
type SlipSel = { teamName?: string; odds?: number; matchup?: string };

function fmtOddsAdmin(o: number) { return o >= 0 ? `+${o}` : String(o); }

function SportBetsTab({ isOwner = false }: { isOwner?: boolean }) {
  const { bankerToken, sessionToken } = useStore();
  const authToken = bankerToken || sessionToken || "";

  // ── Slips state ─────────────────────────────────────────────────────────────
  const [slips, setSlips] = useState<BetSlipRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [noteInputs, setNoteInputs] = useState<Record<number, string>>({});
  const [noteEditing, setNoteEditing] = useState<number | null>(null);

  // Filters
  const [fPlayer, setFPlayer] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fType, setFType] = useState("");
  const [fMinWager, setFMinWager] = useState("");
  const [fMaxWager, setFMaxWager] = useState("");

  async function loadSlips() {
    if (!authToken) return;
    const p = new URLSearchParams();
    if (fPlayer)   p.set("player",   fPlayer);
    if (fStatus)   p.set("status",   fStatus);
    if (fType)     p.set("type",     fType);
    if (fMinWager) p.set("minWager", fMinWager);
    if (fMaxWager) p.set("maxWager", fMaxWager);
    try {
      const r = await fetch(`${BASE_URL}/api/sportbets/admin/slips?${p}`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      if (Array.isArray(d)) setSlips(d);
    } catch {}
    setLoading(false);
  }

  useEffect(() => {
    loadSlips();
    const iv = setInterval(loadSlips, 6000);
    return () => clearInterval(iv);
  }, [authToken, fPlayer, fStatus, fType, fMinWager, fMaxWager]);

  async function handleSetStatus(slipId: number, status: string) {
    setActionLoading(slipId);
    try {
      await fetch(`${BASE_URL}/api/sportbets/admin/slips/${slipId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      loadSlips();
    } catch {}
    setActionLoading(null);
  }

  async function handleSaveNote(slipId: number) {
    const note = noteInputs[slipId] ?? "";
    try {
      await fetch(`${BASE_URL}/api/sportbets/admin/slips/${slipId}/note`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      setNoteEditing(null);
      loadSlips();
    } catch {}
  }

  async function handleDelete(slipId: number) {
    if (!window.confirm("Permanently delete this bet slip?")) return;
    try {
      await fetch(`${BASE_URL}/api/sportbets/admin/slips/${slipId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      loadSlips();
    } catch {}
  }

  const statusStyle = (s: string): React.CSSProperties => {
    if (s === "won")       return { background: "#052e16", border: "1px solid #16a34a", color: "#4ade80" };
    if (s === "lost")      return { background: "#3b0707", border: "1px solid #ef4444", color: "#f87171" };
    if (s === "voided")    return { background: "#1c1917", border: "1px solid #78716c", color: "#a8a29e" };
    if (s === "cashed_out") return { background: "#0c1445", border: "1px solid #3b82f6", color: "#93c5fd" };
    return { background: "#1c0e00", border: "1px solid #f59e0b", color: "#fbbf24" }; // pending
  };

  const fmt = (n: number) => n.toLocaleString();

  // ── Bet Limits state ───────────────────────────────────────────────────────
  const [sbMinBet, setSbMinBet] = useState("100");
  const [sbMaxBet, setSbMaxBet] = useState("50000");
  const [sbSettingsSaving, setSbSettingsSaving] = useState(false);
  const [sbSettingsMsg, setSbSettingsMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function loadSbSettings() {
    fetch(`${BASE_URL}/api/sportbets/settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => { if (d.minBet !== undefined) { setSbMinBet(String(d.minBet)); setSbMaxBet(String(d.maxBet)); } })
      .catch(() => {});
  }

  async function saveSbSettings() {
    const min = parseInt(sbMinBet);
    const max = parseInt(sbMaxBet);
    if (!min || min <= 0) { setSbSettingsMsg({ text: "Min Bet must be greater than 0", ok: false }); return; }
    if (!max || max <= min) { setSbSettingsMsg({ text: "Max Bet must be greater than Min Bet", ok: false }); return; }
    setSbSettingsSaving(true); setSbSettingsMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/sportbets/settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ minBet: min, maxBet: max }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setSbMinBet(String(d.minBet)); setSbMaxBet(String(d.maxBet));
      setSbSettingsMsg({ text: "Saved ✓", ok: true });
    } catch (err: any) { setSbSettingsMsg({ text: err.message || "Failed", ok: false }); }
    setSbSettingsSaving(false);
    setTimeout(() => setSbSettingsMsg(null), 3000);
  }

  useEffect(() => { loadSbSettings(); }, [authToken]);

  // ── Auto-Delete Settings state ────────────────────────────────────────────
  const [sbAutoDelete, setSbAutoDelete] = useState(true);
  const [sbRetentionMins, setSbRetentionMins] = useState("30");
  const [sbCleanupSaving, setSbCleanupSaving] = useState(false);
  const [sbCleanupMsg, setSbCleanupMsg] = useState<{ text: string; ok: boolean } | null>(null);

  function loadCleanupSettings() {
    fetch(`${BASE_URL}/api/sportbets/admin/cleanup-settings`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.json())
      .then(d => {
        if (d.enabled !== undefined) setSbAutoDelete(d.enabled);
        if (d.retentionMinutes !== undefined) setSbRetentionMins(String(d.retentionMinutes));
      })
      .catch(() => {});
  }

  async function saveCleanupSettings() {
    setSbCleanupSaving(true); setSbCleanupMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/sportbets/admin/cleanup-settings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: sbAutoDelete, retentionMinutes: parseInt(sbRetentionMins) || 30 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setSbAutoDelete(d.enabled);
      setSbRetentionMins(String(d.retentionMinutes));
      setSbCleanupMsg({ text: "Saved", ok: true });
    } catch (err: any) {
      setSbCleanupMsg({ text: err.message || "Failed", ok: false });
    }
    setSbCleanupSaving(false);
    setTimeout(() => setSbCleanupMsg(null), 3000);
  }

  useEffect(() => { loadCleanupSettings(); }, [authToken]);

  // ── Sport Events state ────────────────────────────────────────────────────
  const [sbEvents, setSbEvents] = useState<SBEvent[]>([]);
  const [showEventsPanel, setShowEventsPanel] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createSport, setCreateSport] = useState("NFL");
  const [createLeague, setCreateLeague] = useState("");
  const [createGameDate, setCreateGameDate] = useState("");
  const [createRake, setCreateRake] = useState("0");
  const [createOptions, setCreateOptions] = useState([{ label: "", odds: "" }, { label: "", odds: "" }]);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [createEventMsg, setCreateEventMsg] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<number | null>(null);
  const [settleWinner, setSettleWinner] = useState<number | null>(null);

  function datetimeLocalToEasternUTC(localStr: string): string {
    if (!localStr) return localStr;
    const [datePart, timePart = "00:00"] = localStr.split("T");
    const [y, m, d] = datePart.split("-").map(Number);
    const [h, min] = timePart.split(":").map(Number);
    const probeUTC = new Date(Date.UTC(y, m - 1, d, h, min));
    const nyHourStr = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
      .formatToParts(probeUTC).find(p => p.type === "hour")?.value ?? "0";
    const nyHour = parseInt(nyHourStr);
    let offsetH = h - nyHour;
    if (offsetH > 12) offsetH -= 24;
    if (offsetH < -12) offsetH += 24;
    return new Date(Date.UTC(y, m - 1, d, h + offsetH, min)).toISOString();
  }

  function loadSbEvents() {
    if (!authToken) return;
    fetch(`${BASE_URL}/api/sportbets/events`, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async r => { const d = await r.json(); if (Array.isArray(d)) setSbEvents(d); })
      .catch(() => {});
  }

  useEffect(() => {
    if (!showEventsPanel) return;
    loadSbEvents();
    const iv = setInterval(loadSbEvents, 8000);
    return () => clearInterval(iv);
  }, [showEventsPanel, authToken]);

  async function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!createTitle.trim()) return;
    setCreatingEvent(true); setCreateEventMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/sportbets/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createTitle, description: createDesc, sport: createSport, league: createLeague || createSport,
          gameDate: createGameDate ? datetimeLocalToEasternUTC(createGameDate) : null,
          options: createOptions, rakePercent: parseInt(createRake) || 0,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setCreateTitle(""); setCreateDesc(""); setCreateSport("NFL"); setCreateLeague(""); setCreateGameDate(""); setCreateRake("0");
      setCreateOptions([{ label: "", odds: "" }, { label: "", odds: "" }]);
      setShowCreateEvent(false); loadSbEvents();
    } catch (err: any) { setCreateEventMsg(err.message || "Failed"); }
    setCreatingEvent(false);
  }

  async function handleSetEventStatus(eventId: number, status: string, winnerId?: number) {
    const body: any = { status };
    if (winnerId) body.winnerId = winnerId;
    await fetch(`${BASE_URL}/api/sportbets/events/${eventId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSettlingId(null); setSettleWinner(null); loadSbEvents();
  }

  async function handleDeleteEvent(id: number) {
    if (!window.confirm("Delete this event?")) return;
    await fetch(`${BASE_URL}/api/sportbets/events/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
    loadSbEvents();
  }

  // ── Create Game state ──────────────────────────────────────────────────
  const SPORT_LIST = ["NFL","NBA","MLB","NHL","UFC","Soccer","Boxing","College Football","College Basketball"] as const;
  const SPORT_DEFAULT_LEAGUE: Record<string, string> = {
    NFL:"NFL", NBA:"NBA", MLB:"MLB", NHL:"NHL", UFC:"UFC",
    Soccer:"MLS", Boxing:"Boxing",
    "College Football":"NCAAF", "College Basketball":"NCAAB",
  };

  const [showCreateGame, setShowCreateGame] = useState(false);
  const [cgSport,    setCgSport]    = useState("NFL");
  const [cgHome,     setCgHome]     = useState("");
  const [cgAway,     setCgAway]     = useState("");
  const [cgHomeOdds, setCgHomeOdds] = useState("-110");
  const [cgAwayOdds, setCgAwayOdds] = useState("-110");
  const [cgDate,     setCgDate]     = useState("");
  const [cgLeague,   setCgLeague]   = useState("NFL");
  const [cgLive,     setCgLive]     = useState(false);
  const [cgEvent,    setCgEvent]    = useState("");
  const [cgCreating, setCgCreating] = useState(false);
  const [cgMsg,      setCgMsg]      = useState<{ text: string; ok: boolean } | null>(null);
  const [manualEvts, setManualEvts] = useState<ManualEvent[]>([]);
  const [cgDeleting, setCgDeleting] = useState<number | null>(null);

  async function loadManualEvents() {
    if (!authToken) return;
    try {
      const r = await fetch(`${BASE_URL}/api/sportsbook/admin/events`, { headers: { Authorization: `Bearer ${authToken}` } });
      const d = await r.json();
      if (Array.isArray(d)) setManualEvts(d);
    } catch {}
  }

  useEffect(() => { if (showCreateGame) loadManualEvents(); }, [showCreateGame, authToken]);

  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault();
    if (!cgHome.trim() || !cgAway.trim() || !cgDate) { setCgMsg({ text: "Home team, away team, and date are required.", ok: false }); return; }
    setCgCreating(true); setCgMsg(null);
    try {
      const r = await fetch(`${BASE_URL}/api/sportsbook/admin/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          sport: cgSport, homeTeam: cgHome.trim(), awayTeam: cgAway.trim(),
          homeOdds: parseInt(cgHomeOdds) || -110, awayOdds: parseInt(cgAwayOdds) || -110,
          commenceTime: new Date(cgDate).toISOString(),
          league: cgLeague.trim() || SPORT_DEFAULT_LEAGUE[cgSport] || cgSport,
          live: cgLive, eventName: cgEvent.trim() || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setCgMsg({ text: "Game added ✓ — players will see it on next refresh.", ok: true });
      setCgHome(""); setCgAway(""); setCgHomeOdds("-110"); setCgAwayOdds("-110");
      setCgDate(""); setCgLive(false); setCgEvent("");
      loadManualEvents();
    } catch (err: any) { setCgMsg({ text: err.message || "Failed", ok: false }); }
    setCgCreating(false);
  }

  async function handleDeleteGame(id: number) {
    if (!window.confirm("Remove this game from the sportsbook?")) return;
    setCgDeleting(id);
    try {
      await fetch(`${BASE_URL}/api/sportsbook/admin/events/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${authToken}` } });
      loadManualEvents();
    } catch {}
    setCgDeleting(null);
  }

  async function handleToggleLive(id: number, current: boolean) {
    try {
      await fetch(`${BASE_URL}/api/sportsbook/admin/events/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ live: !current }),
      });
      loadManualEvents();
    } catch {}
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: "18px", color: "#e2e8f0", margin: 0 }}>Sport Bet Slips</h2>
        <p style={{ fontSize: "12px", color: "#64748b", margin: "4px 0 0" }}>View and manage all player sportsbook bet slips.</p>
      </div>

      {/* Bet Limits */}
      <div style={{ background: "rgba(15,10,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <span style={{ fontSize: "14px" }}>⚙️</span>
          <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: "13px", color: "#e2e8f0", letterSpacing: "0.06em" }}>Bet Limits</span>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 120px" }}>
            <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Min Bet</label>
            <input type="number" value={sbMinBet} onChange={e => setSbMinBet(e.target.value)}
              style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Max Bet</label>
            <input type="number" value={sbMaxBet} onChange={e => setSbMaxBet(e.target.value)}
              style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "8px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
          </div>
          <button onClick={saveSbSettings} disabled={sbSettingsSaving}
            style={{ padding: "8px 22px", background: sbSettingsSaving ? "rgba(160,34,58,0.4)" : "#a0223a", border: "none", borderRadius: "9px", fontSize: "12px", fontWeight: 700, color: "#fff", cursor: sbSettingsSaving ? "not-allowed" : "pointer", fontFamily: "Oswald, sans-serif", letterSpacing: "0.05em" }}>
            {sbSettingsSaving ? "Saving…" : "Save"}
          </button>
          {sbSettingsMsg && (
            <span style={{ fontSize: "11px", fontWeight: 600, color: sbSettingsMsg.ok ? "#4ade80" : "#f87171" }}>{sbSettingsMsg.text}</span>
          )}
        </div>
      </div>

      {/* Auto-Delete Settled Bets */}
      <div style={{ background: "rgba(15,10,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "12px 18px", display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "13px" }}>🗑️</span>
        <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: "12px", color: "#94a3b8", letterSpacing: "0.06em", flex: "0 0 auto" }}>Auto-Delete Settled Bets</span>
        <button onClick={() => setSbAutoDelete(v => !v)} style={{ padding: "4px 14px", borderRadius: "7px", fontSize: "11px", fontWeight: 700, cursor: "pointer", border: "none", fontFamily: "Oswald, sans-serif", background: sbAutoDelete ? "#166534" : "#3b0707", color: sbAutoDelete ? "#4ade80" : "#f87171" }}>
          {sbAutoDelete ? "ON" : "OFF"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", fontWeight: 600 }}>Retention (min)</label>
          <input type="number" min="1" max="1440" value={sbRetentionMins} onChange={e => setSbRetentionMins(e.target.value)}
            style={{ width: "64px", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "7px", padding: "4px 8px", fontSize: "12px", color: "#e2e8f0", outline: "none" }} />
        </div>
        <button onClick={saveCleanupSettings} disabled={sbCleanupSaving}
          style={{ padding: "4px 14px", background: sbCleanupSaving ? "rgba(160,34,58,0.4)" : "#a0223a", border: "none", borderRadius: "7px", fontSize: "11px", fontWeight: 700, color: "#fff", cursor: sbCleanupSaving ? "not-allowed" : "pointer", fontFamily: "Oswald, sans-serif" }}>
          {sbCleanupSaving ? "…" : "Save"}
        </button>
        {sbCleanupMsg && <span style={{ fontSize: "11px", fontWeight: 600, color: sbCleanupMsg.ok ? "#4ade80" : "#f87171" }}>{sbCleanupMsg.text}</span>}
      </div>

      {/* Sport Events */}
      <div style={{ background: "rgba(15,10,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", overflow: "hidden" }}>
        <button onClick={() => setShowEventsPanel(p => !p)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px" }}>🏆</span>
            <span style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: "13px", color: "#e2e8f0", letterSpacing: "0.06em" }}>Sport Events</span>
            {sbEvents.length > 0 && (
              <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", background: "rgba(255,255,255,0.08)", color: "#94a3b8" }}>{sbEvents.length}</span>
            )}
          </div>
          <span style={{ fontSize: "11px", color: "#64748b" }}>{showEventsPanel ? "▲" : "▼"}</span>
        </button>

        {showEventsPanel && (
          <div style={{ padding: "0 18px 18px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            {showCreateEvent ? (
              <form onSubmit={handleCreateEvent} style={{ paddingTop: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
                <p style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>New Event</p>
                <div style={{ display: "flex", gap: "10px" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "9px", color: "#64748b", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: "4px" }}>Sport Category</label>
                    <select value={createSport} onChange={e => { setCreateSport(e.target.value); setCreateLeague(""); }}
                      style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none", cursor: "pointer" }}>
                      {["NFL","NBA","MLB","NHL","UFC","Soccer","Boxing","College Football","College Basketball"].map(s => (
                        <option key={s} value={s} style={{ background: "#1e293b" }}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: "9px", color: "#64748b", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: "4px" }}>League / Sub-label (optional)</label>
                    <input value={createLeague} onChange={e => setCreateLeague(e.target.value)} placeholder={`e.g. ${createSport === "Soccer" ? "EPL, MLS" : createSport === "College Football" ? "NCAAF" : createSport}`}
                      style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
                  </div>
                </div>
                <input value={createTitle} onChange={e => setCreateTitle(e.target.value)} placeholder="Event title (e.g. Chiefs vs Eagles)"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none" }} />
                <div style={{ position: "relative" }}>
                  <label style={{ fontSize: "9px", color: "#64748b", display: "block", marginBottom: "4px", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" }}>Game Date &amp; Time (EST)</label>
                  <input type="datetime-local" value={createGameDate} onChange={e => setCreateGameDate(e.target.value)}
                    style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
                </div>
                <input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="Description (optional)"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "13px", color: "#e2e8f0", outline: "none" }} />
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <label style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>House Rake %</label>
                  <input type="number" min={0} max={50} value={createRake} onChange={e => setCreateRake(e.target.value)}
                    style={{ width: "70px", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", padding: "6px 10px", fontSize: "13px", color: "#e2e8f0", outline: "none" }} />
                  <span style={{ fontSize: "11px", color: "#475569" }}>taken from winning pool before payouts</span>
                </div>
                <p style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", margin: "4px 0 0" }}>Options (minimum 2)</p>
                {createOptions.map((opt, i) => (
                  <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input value={opt.label} onChange={e => { const o = [...createOptions]; o[i] = { ...o[i], label: e.target.value }; setCreateOptions(o); }}
                      placeholder={`Option ${i + 1} (e.g. ${i === 0 ? "Chiefs Win" : "Eagles Win"})`}
                      style={{ flex: 3, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "12px", color: "#e2e8f0", outline: "none" }} />
                    <input value={opt.odds} onChange={e => { const o = [...createOptions]; o[i] = { ...o[i], odds: e.target.value }; setCreateOptions(o); }}
                      placeholder="Odds (e.g. 2.5)"
                      style={{ flex: 1, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "9px 12px", fontSize: "12px", color: "#e2e8f0", outline: "none" }} />
                    {createOptions.length > 2 && (
                      <button type="button" onClick={() => setCreateOptions(createOptions.filter((_, j) => j !== i))}
                        style={{ padding: "6px 10px", background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "7px", fontSize: "12px", color: "#ef4444", cursor: "pointer" }}>✕</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setCreateOptions([...createOptions, { label: "", odds: "" }])}
                  style={{ fontSize: "11px", fontWeight: 700, color: "#a0223a", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: "2px 0" }}>
                  ＋ Add Option
                </button>
                {createEventMsg && <p style={{ fontSize: "11px", color: "#f87171", margin: 0 }}>{createEventMsg}</p>}
                <div style={{ display: "flex", gap: "10px", paddingTop: "4px" }}>
                  <button type="submit" disabled={creatingEvent}
                    style={{ padding: "10px 24px", background: "#a0223a", border: "none", borderRadius: "9px", fontSize: "12px", fontWeight: 700, color: "#fff", cursor: creatingEvent ? "not-allowed" : "pointer", fontFamily: "Oswald, sans-serif", letterSpacing: "0.08em", textTransform: "uppercase", opacity: creatingEvent ? 0.6 : 1 }}>
                    {creatingEvent ? "Creating…" : "Create Event"}
                  </button>
                  <button type="button" onClick={() => { setShowCreateEvent(false); setCreateEventMsg(null); }}
                    style={{ padding: "10px 18px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "9px", fontSize: "12px", fontWeight: 700, color: "#94a3b8", cursor: "pointer" }}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setShowCreateEvent(true)}
                style={{ marginTop: "14px", padding: "8px 18px", background: "#a0223a", border: "none", borderRadius: "9px", fontSize: "11px", fontWeight: 700, color: "#fff", cursor: "pointer", fontFamily: "Oswald, sans-serif", letterSpacing: "0.06em" }}>
                ＋ Create Event
              </button>
            )}

            {sbEvents.length > 0 && (
              <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {sbEvents.map(ev => (
                  <div key={ev.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "10px", padding: "10px 14px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.title}</p>
                        <p style={{ margin: "2px 0 0", fontSize: "10px", color: "#475569" }}>
                          {ev.league}{ev.gameDate ? ` · ${new Date(ev.gameDate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""} · {ev.entries?.length ?? 0} entries · ${fmt(ev.totalWagered ?? 0)} wagered
                        </p>
                      </div>
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 9px", borderRadius: "20px", whiteSpace: "nowrap",
                        background: ev.status === "open" ? "rgba(0,230,118,0.12)" : ev.status === "settled" ? "rgba(59,130,246,0.12)" : "rgba(255,255,255,0.07)",
                        color: ev.status === "open" ? "#00E676" : ev.status === "settled" ? "#93c5fd" : "#94a3b8" }}>
                        {ev.status}
                      </span>
                    </div>
                    <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      {(ev.options ?? []).map((opt: any) => (
                        <span key={opt.id} style={{ fontSize: "10px", fontWeight: 600, padding: "3px 9px", borderRadius: "8px",
                          background: ev.winnerId === opt.id ? "rgba(0,230,118,0.15)" : "rgba(255,255,255,0.05)",
                          color: ev.winnerId === opt.id ? "#00E676" : "#94a3b8",
                          border: `1px solid ${ev.winnerId === opt.id ? "rgba(0,230,118,0.3)" : "rgba(255,255,255,0.07)"}` }}>
                          {opt.label} {opt.odds ? `(${opt.odds}x)` : ""}
                          {ev.winnerId === opt.id ? " ✓ Winner" : ""}
                        </span>
                      ))}
                    </div>
                    {ev.status !== "settled" && (
                      <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                        {ev.status === "open" ? (
                          <button onClick={() => handleSetEventStatus(ev.id, "closed")}
                            style={{ padding: "5px 12px", background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: "#f59e0b", cursor: "pointer" }}>
                            Close Betting
                          </button>
                        ) : (
                          <button onClick={() => handleSetEventStatus(ev.id, "open")}
                            style={{ padding: "5px 12px", background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.25)", borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: "#00E676", cursor: "pointer" }}>
                            Reopen
                          </button>
                        )}
                        {settlingId === ev.id ? (
                          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                            <select value={settleWinner ?? ""} onChange={e => setSettleWinner(parseInt(e.target.value) || null)}
                              style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "7px", padding: "5px 8px", fontSize: "11px", color: "#e2e8f0", outline: "none" }}>
                              <option value="">Select winner…</option>
                              {(ev.options ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.label}</option>)}
                            </select>
                            <button onClick={() => settleWinner && handleSetEventStatus(ev.id, "settled", settleWinner)} disabled={!settleWinner}
                              style={{ padding: "5px 12px", background: "#a0223a", border: "none", borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: "#fff", cursor: settleWinner ? "pointer" : "not-allowed", opacity: settleWinner ? 1 : 0.5 }}>
                              Confirm Settle
                            </button>
                            <button onClick={() => { setSettlingId(null); setSettleWinner(null); }}
                              style={{ padding: "5px 10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "7px", fontSize: "10px", color: "#64748b", cursor: "pointer" }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setSettlingId(ev.id)}
                            style={{ padding: "5px 12px", background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.3)", borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: "#93c5fd", cursor: "pointer" }}>
                            Settle Event
                          </button>
                        )}
                        <button onClick={() => handleDeleteEvent(ev.id)}
                          style={{ padding: "5px 10px", background: "transparent", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "7px", fontSize: "10px", fontWeight: 700, color: "#ef4444", cursor: "pointer", marginLeft: "auto" }}>
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ background: "rgba(15,10,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px", display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Player</label>
          <input value={fPlayer} onChange={e => setFPlayer(e.target.value)} placeholder="Search username…"
            style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: "1 1 120px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Status</label>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)}
            style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none" }}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="voided">Voided</option>
            <option value="cashed_out">Cashed Out</option>
          </select>
        </div>
        <div style={{ flex: "1 1 100px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Type</label>
          <select value={fType} onChange={e => setFType(e.target.value)}
            style={{ width: "100%", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none" }}>
            <option value="">All</option>
            <option value="parlay">Parlay</option>
            <option value="single">Single</option>
          </select>
        </div>
        <div style={{ flex: "1 1 90px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Min Wager</label>
          <input type="number" value={fMinWager} onChange={e => setFMinWager(e.target.value)} placeholder="0"
            style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: "1 1 90px" }}>
          <label style={{ fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, display: "block", marginBottom: "4px" }}>Max Wager</label>
          <input type="number" value={fMaxWager} onChange={e => setFMaxWager(e.target.value)} placeholder="∞"
            style={{ width: "100%", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none", boxSizing: "border-box" }} />
        </div>
        <button onClick={() => { setFPlayer(""); setFStatus(""); setFType(""); setFMinWager(""); setFMaxWager(""); }}
          style={{ padding: "6px 14px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "11px", color: "#94a3b8", cursor: "pointer", fontWeight: 600, letterSpacing: "0.04em", alignSelf: "flex-end" }}>
          Reset
        </button>
      </div>

      {/* Table */}
      <div style={{ background: "rgba(15,10,18,0.9)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", overflow: "hidden" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 100px 100px 90px 120px", gap: "8px", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.3)" }}>
          {["Slip ID", "Player", "Type", "Wager", "Pot. Payout", "Status", "Submitted"].map(col => (
            <span key={col} style={{ fontSize: "10px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em" }}>{col}</span>
          ))}
        </div>

        {loading && (
          <p style={{ textAlign: "center", padding: "32px", fontSize: "12px", color: "#475569" }}>Loading…</p>
        )}
        {!loading && slips.length === 0 && (
          <p style={{ textAlign: "center", padding: "32px", fontSize: "12px", color: "#475569" }}>No bet slips found.</p>
        )}

        {slips.map(slip => {
          const isExpanded = expandedId === slip.id;
          const sels: SlipSel[] = (() => { try { return JSON.parse(slip.selections); } catch { return []; } })();
          const ss = statusStyle(slip.status);
          const busy = actionLoading === slip.id;

          return (
            <div key={slip.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {/* Row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : slip.id)}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "80px 1fr 90px 100px 100px 90px 120px", gap: "8px", padding: "10px 16px", background: isExpanded ? "rgba(255,255,255,0.03)" : "transparent", border: "none", cursor: "pointer", textAlign: "left", alignItems: "center" }}
              >
                <span style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace" }}>#{slip.id}</span>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slip.playerUsername}</span>
                  <span style={{ fontSize: "10px", color: "#475569" }}>ID {slip.playerId}</span>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 600, color: slip.type === "parlay" ? "#f59e0b" : "#94a3b8", textTransform: "capitalize" }}>{slip.type}</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0" }}>${fmt(slip.wagerAmount)}</span>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#00E676" }}>${fmt(slip.potentialPayout)}</span>
                <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "20px", textTransform: "capitalize", ...ss, display: "inline-block", whiteSpace: "nowrap" }}>
                  {slip.status.replace("_", " ")}
                </span>
                <span style={{ fontSize: "10px", color: "#475569" }}>
                  {new Date(slip.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{ padding: "12px 16px 16px", background: "rgba(0,0,0,0.25)", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Selections */}
                  <div>
                    <p style={{ fontSize: "10px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "8px" }}>
                      {sels.length} Selection{sels.length !== 1 ? "s" : ""}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {sels.length === 0 && <p style={{ fontSize: "11px", color: "#475569" }}>No selections recorded.</p>}
                      {sels.map((sel, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", background: "rgba(255,255,255,0.04)", borderRadius: "8px", padding: "7px 10px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", flex: 1 }}>{sel.teamName ?? "?"}</span>
                          {sel.matchup && <span style={{ fontSize: "10px", color: "#64748b" }}>{sel.matchup}</span>}
                          {sel.odds !== undefined && (
                            <span style={{ fontSize: "11px", fontWeight: 700, color: sel.odds >= 0 ? "#00E676" : "#94a3b8" }}>{fmtOddsAdmin(sel.odds)}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Settlement info */}
                  {slip.status !== "pending" && (
                    <div style={{ fontSize: "11px", color: "#64748b", display: "flex", flexWrap: "wrap", gap: "12px" }}>
                      {slip.settledBy && <span>Settled by <span style={{ color: "#94a3b8", fontWeight: 600 }}>{slip.settledBy}</span></span>}
                      {slip.settledAt && <span>at {new Date(slip.settledAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>}
                      {slip.actualPayout !== null && slip.actualPayout !== undefined && (
                        <span>Actual payout: <span style={{ color: "#4ade80", fontWeight: 700 }}>${fmt(slip.actualPayout)}</span></span>
                      )}
                    </div>
                  )}

                  {/* Admin note */}
                  <div>
                    {noteEditing === slip.id ? (
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input
                          autoFocus
                          value={noteInputs[slip.id] ?? slip.adminNote ?? ""}
                          onChange={e => setNoteInputs(prev => ({ ...prev, [slip.id]: e.target.value }))}
                          placeholder="Admin note…"
                          style={{ flex: 1, background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "6px 10px", fontSize: "12px", color: "#e2e8f0", outline: "none" }}
                        />
                        <button onClick={() => handleSaveNote(slip.id)}
                          style={{ padding: "5px 12px", background: "#a0223a", border: "none", borderRadius: "7px", fontSize: "11px", fontWeight: 700, color: "#fff", cursor: "pointer" }}>Save</button>
                        <button onClick={() => setNoteEditing(null)}
                          style={{ padding: "5px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "7px", fontSize: "11px", color: "#94a3b8", cursor: "pointer" }}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => { setNoteEditing(slip.id); setNoteInputs(prev => ({ ...prev, [slip.id]: slip.adminNote ?? "" })); }}
                        style={{ fontSize: "11px", color: slip.adminNote ? "#e2e8f0" : "#475569", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "8px", padding: "6px 12px", cursor: "pointer", textAlign: "left", width: "100%" }}>
                        {slip.adminNote ? `📝 ${slip.adminNote}` : "＋ Add admin note"}
                      </button>
                    )}
                  </div>

                  {/* Action buttons */}
                  {slip.status === "pending" && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <button onClick={() => handleSetStatus(slip.id, "won")} disabled={busy}
                        style={{ padding: "6px 14px", background: busy ? "#1a2e1a" : "#14532d", border: "1px solid #16a34a", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#4ade80", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                        ✓ Mark Won
                      </button>
                      <button onClick={() => handleSetStatus(slip.id, "lost")} disabled={busy}
                        style={{ padding: "6px 14px", background: busy ? "#2e1a1a" : "#3b0707", border: "1px solid #ef4444", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#f87171", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                        ✕ Mark Lost
                      </button>
                      <button onClick={() => handleSetStatus(slip.id, "voided")} disabled={busy}
                        style={{ padding: "6px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#94a3b8", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                        ⊘ Void (Refund)
                      </button>
                      <button onClick={() => handleSetStatus(slip.id, "cashed_out")} disabled={busy}
                        style={{ padding: "6px 14px", background: "#0c1445", border: "1px solid #3b82f6", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#93c5fd", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}>
                        ⓟ Cash Out
                      </button>
                      {isOwner && (
                        <button onClick={() => handleDelete(slip.id)} disabled={busy}
                          style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#ef4444", cursor: busy ? "not-allowed" : "pointer", marginLeft: "auto", opacity: busy ? 0.6 : 1 }}>
                          🗑 Delete
                        </button>
                      )}
                    </div>
                  )}
                  {slip.status !== "pending" && isOwner && (
                    <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "4px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                      <button onClick={() => handleDelete(slip.id)}
                        style={{ padding: "5px 12px", background: "transparent", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", fontSize: "11px", fontWeight: 700, color: "#ef4444", cursor: "pointer" }}>
                        🗑 Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary footer */}
      {slips.length > 0 && (
        <p style={{ fontSize: "11px", color: "#475569", textAlign: "right" }}>
          Showing {slips.length} slip{slips.length !== 1 ? "s" : ""} · Total wagered: <span style={{ color: "#e2e8f0", fontWeight: 700 }}>${fmt(slips.reduce((s, x) => s + x.wagerAmount, 0))}</span>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMO TAB
// ─────────────────────────────────────────────────────────────────────────────
const PAGE_KEYS = ["homepage", "lobby", "roulette", "blackjack", "slots", "baccarat", "poker", "tournaments"];

type PromoRegion = { id: number; name: string; pageKey: string; x: number; y: number; width: number; height: number; isActive: boolean; desktopVisible: boolean; mobileVisible: boolean; createdAt: string };
type PromoAsset = { id: number; title: string; imageUrl: string; targetUrl?: string | null; uploadedBy: string; notes?: string | null; createdAt: string };
type PromoPlacement = { id: number; regionId: number; assetId: number; startsAt: string; endsAt: string; isActive: boolean; createdBy: string; createdAt: string };

function fmtDt(iso: string) {
  return fmtETDateTime(iso);
}
function placementStatus(p: PromoPlacement): { label: string; color: string } {
  const now = Date.now();
  const start = new Date(p.startsAt).getTime();
  const end = new Date(p.endsAt).getTime();
  if (!p.isActive) return { label: "Inactive", color: "#71717A" };
  if (now < start) return { label: "Scheduled", color: "#F59E0B" };
  if (now > end) return { label: "Expired", color: "#EF4444" };
  return { label: "Live", color: "#22C55E" };
}

function PromoTab({ isOwner }: { isOwner: boolean }) {
  const [section, setSection] = useState<"regions" | "assets" | "placements" | "referrals" | "codes" | "redemptions" | "controls">("placements");
  const [regions, setRegions] = useState<PromoRegion[]>([]);
  const [assets, setAssets] = useState<PromoAsset[]>([]);
  const [placements, setPlacements] = useState<PromoPlacement[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadAll() {
    setLoading(true);
    const [rr, ar, pr] = await Promise.all([
      bankerApiFetch("/promo/regions").then(r => r.ok ? r.json() : []),
      bankerApiFetch("/promo/assets").then(r => r.ok ? r.json() : []),
      bankerApiFetch("/promo/placements").then(r => r.ok ? r.json() : []),
    ]);
    setRegions(rr);
    setAssets(ar);
    setPlacements(pr);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const sections = [
    { key: "placements" as const, label: "Placements" },
    { key: "assets" as const, label: "Assets" },
    ...(isOwner ? [{ key: "regions" as const, label: "Regions" }] : []),
    { key: "referrals" as const, label: "Referrals" },
    { key: "codes" as const, label: "Codes" },
    { key: "redemptions" as const, label: "Redemptions" },
    { key: "controls" as const, label: "Kill Switches" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2"><Megaphone className="w-5 h-5 text-amber-400" />Promo Manager</h2>
          <p className="text-sm text-muted-foreground mt-1">Staff-managed promotional placements across the casino</p>
        </div>
        {section !== "referrals" && (
          <button onClick={loadAll} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        )}
      </div>

      <div className="flex border-b border-zinc-700 gap-1">
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${section === s.key ? "border-amber-400 text-amber-400" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {section === "regions" && isOwner && <RegionsSection regions={regions} onRefresh={loadAll} />}
      {section === "assets" && <AssetsSection assets={assets} onRefresh={loadAll} />}
      {section === "placements" && <PlacementsSection placements={placements} regions={regions} assets={assets} onRefresh={loadAll} />}
      {section === "referrals" && <ReferralsSection />}
      {section === "codes" && <PromoCodesSection />}
      {section === "redemptions" && <PromoRedemptionsSection />}
      {section === "controls" && <PlayerControlsSection />}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
type PromoterWithStats = {
  id: number;
  code: string;
  ownerUserId: string;
  commissionPercent: number;
  bonusChips: number;
  isActive: boolean;
  createdAt: string;
  totalReferredUsers: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWagered: number;
  netProfit: number;
  commissionOwed: number;
};

type PromoterDetailUser = {
  id: number;
  username: string;
  chips: number;
  handsPlayed: number;
  joinedAt: string;
  totalDeposited: number;
  totalWithdrawn: number;
  totalWagered: number;
  gameWins: number;
  rakePaid: number;
  profitLoss: number;
  commissionOwed: number;
  commissionQualified: boolean;
};

type PromoterDetail = {
  promoter: PromoterWithStats;
  users: PromoterDetailUser[];
  totals?: {
    totalDeposited: number;
    totalWithdrawn: number;
    totalWagered: number;
    netProfit: number;
    commissionOwed: number;
  };
};

function ReferralsSection() {
  const [promoters, setPromoters] = useState<PromoterWithStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<PromoterDetail | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ code: "", ownerUserId: "", commissionPercent: 0, bonusChips: 0, isActive: true });
  const [createForm, setCreateForm] = useState({ code: "", ownerUserId: "", commissionPercent: 10, bonusChips: 0, isActive: true });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [playerSearch, setPlayerSearch] = useState("");
  const [allPlayers, setAllPlayers] = useState<{ id: number; username: string; stateId: string }[]>([]);
  const [showPlayerDrop, setShowPlayerDrop] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await bankerApiFetch("/admin/referrals/promoters");
      if (r.ok) setPromoters(await r.json());
      else setErr("Failed to load promoters.");
    } catch { setErr("Network error."); }
    setLoading(false);
  }

  async function loadPlayers() {
    try {
      const r = await bankerApiFetch("/players");
      if (r.ok) {
        const data = await r.json();
        setAllPlayers(Array.isArray(data) ? data : (data.players ?? []));
      }
    } catch { /* silent */ }
  }

  async function loadDetail(code: string) {
    const r = await bankerApiFetch(`/admin/referrals/promoters/${code}`);
    if (r.ok) setDetail(await r.json());
  }

  useEffect(() => { load(); loadPlayers(); }, []);

  const filteredPlayers = allPlayers.filter(p =>
    p.username.toLowerCase().includes(playerSearch.toLowerCase()) ||
    (p.stateId ?? "").toLowerCase().includes(playerSearch.toLowerCase())
  ).slice(0, 12);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const r = await bankerApiFetch("/admin/referrals/promoters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...createForm, commissionPercent: Number(createForm.commissionPercent) }),
      });
      if (r.ok) {
        setShowCreate(false);
        setCreateForm({ code: "", ownerUserId: "", commissionPercent: 10, bonusChips: 0, isActive: true });
        setPlayerSearch("");
        load();
      } else {
        const d = await r.json();
        setErr(d.error || "Failed to create.");
      }
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  async function handleSaveEdit(id: number) {
    setSaving(true);
    setErr("");
    try {
      const r = await bankerApiFetch(`/admin/referrals/promoters/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, commissionPercent: Number(editForm.commissionPercent) }),
      });
      if (r.ok) { setEditId(null); load(); }
      else { const d = await r.json(); setErr(d.error || "Failed to save."); }
    } catch { setErr("Network error."); }
    setSaving(false);
  }

  function openEdit(p: PromoterWithStats) {
    setEditId(p.id);
    setEditForm({ code: p.code, ownerUserId: p.ownerUserId, commissionPercent: p.commissionPercent, bonusChips: p.bonusChips ?? 0, isActive: p.isActive });
  }

  async function handleDelete(p: PromoterWithStats) {
    showConfirm(`Delete promoter "${p.code}"? This cannot be undone.`, async () => {
      try {
        const r = await bankerApiFetch(`/admin/referrals/promoters/${p.id}`, { method: "DELETE" });
        if (r.ok) load();
        else { const d = await r.json(); setErr(d.error || "Failed to delete."); }
      } catch { setErr("Network error."); }
    });
  }

  const fmt = (n: number | undefined | null) => (n ?? 0).toLocaleString();

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (detail) {
    const p = detail.promoter;
    const totals = detail.totals;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setDetail(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Tag className="w-4 h-4 text-amber-400" /> {p.code}
            </h3>
            <p className="text-xs text-muted-foreground">Owner: {p.ownerUserId} · {p.commissionPercent}% commission · Commission requires ≥10,000 chips wagered</p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {[
            { label: "Referred Users", value: fmt(detail.users.length) },
            { label: "Total Deposited", value: `$${fmt(totals?.totalDeposited ?? p.totalDeposited)}` },
            { label: "Total Withdrawn", value: `$${fmt(totals?.totalWithdrawn ?? p.totalWithdrawn)}` },
            { label: "Total Wagered", value: `${fmt(totals?.totalWagered)}` },
            { label: "Commission Owed", value: `$${fmt(totals?.commissionOwed ?? p.commissionOwed)}`, highlight: true },
          ].map(s => (
            <div key={s.label} className={`rounded-lg border p-3 ${s.highlight ? "border-amber-700 bg-amber-950" : "border-zinc-700 bg-card/50"}`}>
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className={`text-lg font-bold ${s.highlight ? "text-amber-400" : "text-foreground"}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {detail.users.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm">No referred users yet.</div>
        ) : (
          <div className="rounded-lg border border-zinc-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card/80 border-b border-zinc-700">
                <tr>
                  {["Username", "Chips", "Rounds", "Deposited", "Withdrawn", "Wagered", "Game Wins", "P&L (House)", "Commission", "Qualified"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-zinc-950 divide-y divide-zinc-700">
                {detail.users.map(u => (
                  <tr key={u.id} className="hover:bg-card/50 transition-colors">
                    <td className="px-3 py-2 font-medium text-foreground">{u.username}</td>
                    <td className="px-3 py-2 text-yellow-400">{fmt(u.chips)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(u.handsPlayed)}</td>
                    <td className="px-3 py-2 text-green-400">${fmt(u.totalDeposited)}</td>
                    <td className="px-3 py-2 text-red-400">${fmt(u.totalWithdrawn)}</td>
                    <td className="px-3 py-2 text-blue-400">{fmt(u.totalWagered)}</td>
                    <td className="px-3 py-2 text-emerald-400">{fmt(u.gameWins)}</td>
                    <td className={`px-3 py-2 font-medium ${u.profitLoss >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {u.profitLoss >= 0 ? "+" : ""}${fmt(u.profitLoss)}
                    </td>
                    <td className="px-3 py-2 text-amber-400">${fmt(u.commissionOwed)}</td>
                    <td className="px-3 py-2">
                      {u.commissionQualified
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-400 border border-green-800">Yes</span>
                        : <span className="text-xs px-1.5 py-0.5 text-muted-foreground">No</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Main list view ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-foreground flex items-center gap-2"><Tag className="w-4 h-4 text-amber-400" /> Referral Promoters</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Manage sponsor/affiliate codes · Commission requires ≥10,000 chips wagered</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button onClick={() => { setShowCreate(v => !v); setErr(""); }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-amber-950 text-amber-400 hover:bg-amber-900 border border-amber-800 transition-colors">
            <UserPlus className="w-3.5 h-3.5" /> Add Promoter
          </button>
        </div>
      </div>

      {err && <p className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{err}</p>}

      {showCreate && (
        <form onSubmit={handleCreate} className="rounded-lg border border-amber-800 bg-amber-950 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-amber-400">New Promoter</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Referral Code</label>
              <input value={createForm.code} onChange={e => setCreateForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. RHATTV" required
                className="w-full bg-black/50 border border-zinc-700 rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50 font-mono" />
            </div>
            <div className="relative">
              <label className="block text-xs text-muted-foreground mb-1">Owner Account</label>
              <input
                value={playerSearch || createForm.ownerUserId}
                onChange={e => {
                  setPlayerSearch(e.target.value);
                  setCreateForm(f => ({ ...f, ownerUserId: e.target.value }));
                  setShowPlayerDrop(true);
                }}
                onFocus={() => setShowPlayerDrop(true)}
                placeholder="Search player…"
                required
                autoComplete="off"
                className="w-full bg-black/50 border border-zinc-700 rounded px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
              {showPlayerDrop && filteredPlayers.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl max-h-48 overflow-y-auto">
                  {filteredPlayers.map(pl => (
                    <button key={pl.id} type="button"
                      onMouseDown={() => {
                        setCreateForm(f => ({ ...f, ownerUserId: pl.username }));
                        setPlayerSearch(pl.username);
                        setShowPlayerDrop(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors flex items-center gap-2">
                      <span className="text-foreground font-medium">{pl.username}</span>
                      {pl.stateId && <span className="text-xs text-muted-foreground">#{pl.stateId}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Commission %</label>
              <div className="relative">
                <input type="number" min="0" max="100" step="1" value={createForm.commissionPercent}
                  onChange={e => setCreateForm(f => ({ ...f, commissionPercent: Math.round(Number(e.target.value)) }))}
                  className="w-full bg-black/50 border border-zinc-700 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50 pr-8" />
                <Percent className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Bonus Chips on Signup</label>
              <input type="number" min="0" step="1" value={createForm.bonusChips}
                onChange={e => setCreateForm(f => ({ ...f, bonusChips: Math.max(0, Math.round(Number(e.target.value))) }))}
                placeholder="0"
                className="w-full bg-black/50 border border-zinc-700 rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button type="button" onClick={() => setCreateForm(f => ({ ...f, isActive: !f.isActive }))}
                  className={`text-muted-foreground transition-colors ${createForm.isActive ? "text-green-400" : ""}`}>
                  {createForm.isActive ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                </button>
                <span className="text-sm text-muted-foreground">Active</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => { setShowCreate(false); setPlayerSearch(""); }} className="text-xs px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button type="submit" disabled={saving}
              className="text-xs px-4 py-1.5 rounded bg-amber-950 text-amber-400 border border-amber-700 hover:bg-amber-900 disabled:opacity-50 transition-colors">
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      )}

      {loading && promoters.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
      ) : promoters.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">No promoters yet. Add one above.</div>
      ) : (
        <div className="rounded-lg border border-zinc-700 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-card/80 border-b border-zinc-700">
              <tr>
                {["Code", "Owner", "Commission", "Bonus Chips", "Active", "Users", "Deposited", "Withdrawn", "Wagered", "Net", "Commission Owed", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-zinc-950 divide-y divide-zinc-700">
              {promoters.map(p => {
                if (editId === p.id) {
                  return (
                    <tr key={p.id} className="bg-amber-950">
                      <td className="px-2 py-1.5">
                        <input value={editForm.code} onChange={e => setEditForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                          className="w-24 bg-black/50 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={editForm.ownerUserId} onChange={e => setEditForm(f => ({ ...f, ownerUserId: e.target.value }))}
                          className="w-28 bg-black/50 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" max="100" step="1" value={editForm.commissionPercent}
                          onChange={e => setEditForm(f => ({ ...f, commissionPercent: Math.round(Number(e.target.value)) }))}
                          className="w-16 bg-black/50 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="1" value={editForm.bonusChips}
                          onChange={e => setEditForm(f => ({ ...f, bonusChips: Math.max(0, Math.round(Number(e.target.value))) }))}
                          className="w-20 bg-black/50 border border-zinc-700 rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400/50" />
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}>
                          {editForm.isActive ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      </td>
                      <td colSpan={6} />
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleSaveEdit(p.id)} disabled={saving}
                            className="text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-700 hover:bg-amber-900 disabled:opacity-50">Save</button>
                          <button onClick={() => setEditId(null)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={p.id} className="hover:bg-card/50 transition-colors">
                    <td className="px-3 py-2">
                      <span className="font-mono font-bold text-amber-400">{p.code}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{p.ownerUserId}</td>
                    <td className="px-3 py-2 text-foreground">{p.commissionPercent}%</td>
                    <td className="px-3 py-2 text-yellow-400 font-medium">{(p.bonusChips ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {p.isActive
                        ? <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-400 border border-green-800">Active</span>
                        : <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-muted-foreground border border-zinc-700">Inactive</span>}
                    </td>
                    <td className="px-3 py-2 text-foreground">{fmt(p.totalReferredUsers)}</td>
                    <td className="px-3 py-2 text-green-400">${fmt(p.totalDeposited)}</td>
                    <td className="px-3 py-2 text-red-400">${fmt(p.totalWithdrawn)}</td>
                    <td className="px-3 py-2 text-blue-400">{fmt(p.totalWagered)}</td>
                    <td className={`px-3 py-2 font-medium ${p.netProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {p.netProfit >= 0 ? "+" : ""}${fmt(p.netProfit)}
                    </td>
                    <td className="px-3 py-2 text-amber-400 font-medium">${fmt(p.commissionOwed)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setDetail(null); loadDetail(p.code); }} title="View details"
                          className="text-muted-foreground hover:text-foreground transition-colors"><Eye className="w-3.5 h-3.5" /></button>
                        <button onClick={() => openEdit(p)} title="Edit"
                          className="text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => handleDelete(p)} title="Delete"
                          className="text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RegionsSection({ regions, onRefresh }: { regions: PromoRegion[]; onRefresh: () => void }) {
  const [pageKey, setPageKey] = useState("lobby");

  const handleSave = useCallback(async (
    region: Omit<VRERegion, "id" | "createdAt">,
    id?: number
  ) => {
    if (id) {
      await bankerApiFetch(`/promo/regions/${id}`, { method: "PUT", body: JSON.stringify(region) });
    } else {
      await bankerApiFetch("/promo/regions", { method: "POST", body: JSON.stringify(region) });
    }
    await onRefresh();
  }, [onRefresh]);

  const handleDelete = useCallback(async (id: number) => {
    await bankerApiFetch(`/promo/regions/${id}`, { method: "DELETE" });
    await onRefresh();
  }, [onRefresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Draw promo zones directly on the page layout. <span className="text-amber-400">Owner only.</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Page:</span>
          <select
            value={pageKey}
            onChange={e => setPageKey(e.target.value)}
            className="bg-input border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-foreground"
          >
            {PAGE_KEYS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <VisualRegionEditor
        regions={regions as VRERegion[]}
        pageKey={pageKey}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}

function AssetsSection({ assets, onRefresh }: { assets: PromoAsset[]; onRefresh: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({ title: "", targetUrl: "", notes: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingAsset, setEditingAsset] = useState<PromoAsset | null>(null);
  const [editForm, setEditForm] = useState({ title: "", targetUrl: "", notes: "" });
  const [preview, setPreview] = useState<string | null>(null);

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function handleUpload() {
    if (!selectedFile || !uploadForm.title) return;
    setUploading(true);
    const { bankerToken, sessionToken } = useStore.getState();
    const authToken = bankerToken || sessionToken || "";
    const res = await fetch(`${BASE_URL}/api/promo/assets/upload`, {
      method: "POST",
      headers: {
        "Content-Type": selectedFile.type,
        Authorization: `Bearer ${authToken}`,
        "x-promo-title": encodeURIComponent(uploadForm.title),
        "x-promo-url": encodeURIComponent(uploadForm.targetUrl),
        "x-promo-notes": encodeURIComponent(uploadForm.notes),
      },
      body: selectedFile,
    });
    if (res.ok) {
      setShowUpload(false); setSelectedFile(null); setPreview(null); setUploadForm({ title: "", targetUrl: "", notes: "" }); onRefresh();
    } else { showToast("Upload failed — check image type and size (max 10MB)"); }
    setUploading(false);
  }

  async function saveEdit() {
    if (!editingAsset) return;
    await bankerApiFetch(`/promo/assets/${editingAsset.id}`, { method: "PUT", body: JSON.stringify(editForm) });
    setEditingAsset(null); onRefresh();
  }

  async function del(id: number) {
    showConfirm("Delete this asset? Any placements using it will also be removed.", async () => {
      await bankerApiFetch(`/promo/assets/${id}`, { method: "DELETE" });
      onRefresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Upload promo banners and images for use in placements.</p>
        <button onClick={() => setShowUpload(v => !v)} className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-zinc-900 font-bold px-3 py-1.5 rounded-lg transition-colors">
          <Upload className="w-3.5 h-3.5" /> Upload Image
        </button>
      </div>

      {showUpload && (
        <div className="bg-card border border-amber-700 rounded-xl p-5 space-y-4">
          <p className="text-sm font-bold text-amber-400">Upload Promo Asset</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Title *</label>
              <input value={uploadForm.title} onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. July 4th Weekend Special" className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Image File *</label>
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 text-sm border border-zinc-700 rounded-lg px-3 py-2 hover:border-amber-400 transition-colors">
                  <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  {selectedFile ? selectedFile.name : "Choose image…"}
                </button>
                {selectedFile && <span className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB</span>}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={e => handleFileChange(e.target.files?.[0] ?? null)} />
              </div>
              {preview && <img src={preview} alt="preview" className="mt-2 max-h-24 rounded-lg border border-zinc-700 object-contain" />}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Link URL (optional)</label>
              <input value={uploadForm.targetUrl} onChange={e => setUploadForm(f => ({ ...f, targetUrl: e.target.value }))} placeholder="https://..." className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
              <input value={uploadForm.notes} onChange={e => setUploadForm(f => ({ ...f, notes: e.target.value }))} placeholder="Internal notes..." className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleUpload} disabled={uploading || !selectedFile || !uploadForm.title} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-sm font-bold rounded-lg disabled:opacity-50">{uploading ? "Uploading..." : "Upload"}</button>
            <button onClick={() => { setShowUpload(false); setSelectedFile(null); setPreview(null); }} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-900 text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {editingAsset && (
        <div className="bg-card border border-amber-700 rounded-xl p-5 space-y-4">
          <p className="text-sm font-bold text-amber-400">Edit Asset</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Link URL</label>
              <input value={editForm.targetUrl} onChange={e => setEditForm(f => ({ ...f, targetUrl: e.target.value }))} placeholder="https://..." className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
              <input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={saveEdit} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-sm font-bold rounded-lg">Save</button>
            <button onClick={() => setEditingAsset(null)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-900 text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 italic text-sm">No assets yet — upload an image to get started</div>
      ) : (
        <div className="grid grid-cols-2 grid-cols-3 grid-cols-4 gap-4">
          {assets.map(a => (
            <div key={a.id} className="bg-card border border-zinc-700 rounded-xl overflow-hidden">
              <div className="aspect-video bg-zinc-900 flex items-center justify-center overflow-hidden">
                <img src={`${BASE_URL}${a.imageUrl}`} alt={a.title} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              </div>
              <div className="p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground truncate">{a.title}</p>
                {a.targetUrl && <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1"><Link className="w-3 h-3 flex-shrink-0" />{a.targetUrl}</p>}
                <p className="text-[10px] text-zinc-600">by {a.uploadedBy}</p>
              </div>
              <div className="px-3 pb-3 flex gap-2">
                <button onClick={() => { setEditingAsset(a); setEditForm({ title: a.title, targetUrl: a.targetUrl ?? "", notes: a.notes ?? "" }); setShowUpload(false); }} className="flex-1 text-xs text-center py-1 border border-zinc-700 rounded hover:border-amber-400 hover:text-amber-400 transition-colors">Edit</button>
                <button onClick={() => del(a.id)} className="text-xs px-2 py-1 border border-zinc-700 rounded hover:border-red-400 hover:text-red-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlacementsSection({ placements, regions, assets, onRefresh }: { placements: PromoPlacement[]; regions: PromoRegion[]; assets: PromoAsset[]; onRefresh: () => void }) {
  const blankForm = { regionId: 0, assetId: 0, startsAt: "", endsAt: "", isActive: true };
  const [showForm, setShowForm] = useState(false);
  const [editingP, setEditingP] = useState<PromoPlacement | null>(null);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);

  function toLocalInput(iso: string) {
    if (!iso) return "";
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function toInput(d: Date) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

  function openCreate() {
    setEditingP(null);
    const now = new Date();
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    setForm({ regionId: regions[0]?.id ?? 0, assetId: assets[0]?.id ?? 0, startsAt: toInput(now), endsAt: toInput(later), isActive: true });
    setShowForm(true);
  }

  function openEdit(p: PromoPlacement) {
    setEditingP(p);
    setForm({ regionId: p.regionId, assetId: p.assetId, startsAt: toLocalInput(p.startsAt), endsAt: toLocalInput(p.endsAt), isActive: p.isActive });
    setShowForm(true);
  }

  async function save() {
    if (!form.regionId || !form.assetId || !form.startsAt || !form.endsAt) return;
    setSaving(true);
    const body = { ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() };
    if (editingP) {
      await bankerApiFetch(`/promo/placements/${editingP.id}`, { method: "PUT", body: JSON.stringify(body) });
    } else {
      await bankerApiFetch("/promo/placements", { method: "POST", body: JSON.stringify(body) });
    }
    setSaving(false); setShowForm(false); onRefresh();
  }

  async function del(id: number) {
    showConfirm("Delete this placement?", async () => {
      await bankerApiFetch(`/promo/placements/${id}`, { method: "DELETE" });
      onRefresh();
    });
  }

  async function toggleActive(p: PromoPlacement) {
    await bankerApiFetch(`/promo/placements/${p.id}`, { method: "PUT", body: JSON.stringify({ isActive: !p.isActive }) });
    onRefresh();
  }

  const regionName = (id: number) => regions.find(r => r.id === id)?.name ?? `Region #${id}`;
  const regionPage = (id: number) => regions.find(r => r.id === id)?.pageKey ?? "";
  const assetTitle = (id: number) => assets.find(a => a.id === id)?.title ?? `Asset #${id}`;
  const assetImg = (id: number) => assets.find(a => a.id === id)?.imageUrl ?? "";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Assign assets to regions with a scheduled start and end time.</p>
        <button onClick={openCreate} disabled={regions.length === 0 || assets.length === 0}
          className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-zinc-900 font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Plus className="w-3.5 h-3.5" /> New Placement
        </button>
      </div>

      {(regions.length === 0 || assets.length === 0) && (
        <div className="bg-amber-950 border border-amber-700 rounded-xl p-4 text-sm text-amber-400">
          {regions.length === 0
            ? "No regions yet — an owner must create regions first (Regions tab)."
            : "No assets yet — upload a promo image in the Assets tab first."}
        </div>
      )}

      {showForm && (
        <div className="bg-card border border-amber-700 rounded-xl p-5 space-y-4">
          <p className="text-sm font-bold text-amber-400">{editingP ? "Edit Placement" : "New Placement"}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Region</label>
              <select value={form.regionId} onChange={e => setForm(f => ({ ...f, regionId: +e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground">
                {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.pageKey})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Asset</label>
              <select value={form.assetId} onChange={e => setForm(f => ({ ...f, assetId: +e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground">
                {assets.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Starts At</label>
              <input type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ends At</label>
              <input type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} className="w-full bg-input border border-zinc-700 rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="accent-amber-400" /> Active
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-900 text-sm font-bold rounded-lg disabled:opacity-50">{saving ? "Saving..." : editingP ? "Save Changes" : "Create Placement"}</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-900 text-sm rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {placements.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 italic text-sm">No placements yet</div>
      ) : (
        <div className="space-y-2">
          {[...placements].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map(p => {
            const status = placementStatus(p);
            return (
              <div key={p.id} className="bg-card border border-zinc-700 rounded-xl p-3 flex items-center gap-3">
                <div className="w-16 h-10 rounded-lg bg-zinc-900 overflow-hidden flex-shrink-0 border border-zinc-700">
                  {assetImg(p.assetId) && <img src={`${BASE_URL}${assetImg(p.assetId)}`} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground truncate">{assetTitle(p.assetId)}</p>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: status.color + "22", color: status.color }}>{status.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    <span className="text-amber-400">{regionName(p.regionId)}</span>
                    <span className="text-zinc-600"> · {regionPage(p.regionId)}</span>
                    {" · "}{fmtDt(p.startsAt)} &rarr; {fmtDt(p.endsAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => toggleActive(p)} title={p.isActive ? "Deactivate" : "Activate"} className="text-muted-foreground hover:text-amber-400 transition-colors">
                    {p.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(p)} className="text-muted-foreground hover:text-foreground transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => del(p.id)} className="text-muted-foreground hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── PromoCodesSection ────────────────────────────────────────────────────────

type PromoCodeRow = {
  id: number;
  code: string;
  type: string;
  rewardType: string;
  rewardAmount: number;
  maxUses: number | null;
  totalUses: number;
  createdBy: string;
  active: boolean;
  createdAt: string;
};

function PromoCodesSection() {
  const [codes, setCodes] = useState<PromoCodeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ code: "", type: "single_use", rewardType: "chips", rewardAmount: "", maxUses: "" });
  const [formErr, setFormErr] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ code: "", type: "single_use", rewardAmount: "", maxUses: "" });
  const [editErr, setEditErr] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await bankerApiFetch("/promo/codes");
      if (r.ok) setCodes(await r.json());
      else setErr("Failed to load codes.");
    } catch { setErr("Network error."); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function createCode() {
    if (!form.code.trim() || !form.rewardAmount) return;
    setSaving(true);
    setFormErr("");
    try {
      const r = await bankerApiFetch("/promo/codes", {
        method: "POST",
        body: JSON.stringify({ ...form, code: form.code.toUpperCase().trim(), rewardAmount: parseInt(form.rewardAmount), maxUses: form.maxUses ? parseInt(form.maxUses) : null }),
      });
      const d = await r.json();
      if (!r.ok) { setFormErr(d.error || "Failed to create code."); setSaving(false); return; }
      setShowCreate(false);
      setForm({ code: "", type: "single_use", rewardType: "chips", rewardAmount: "", maxUses: "" });
      load();
    } catch { setFormErr("Network error."); }
    setSaving(false);
  }

  async function toggleActive(c: PromoCodeRow) {
    await bankerApiFetch(`/promo/codes/${c.id}`, { method: "PUT", body: JSON.stringify({ active: !c.active }) });
    load();
  }

  async function deleteCode(id: number) {
    showConfirm("Delete this promo code and all its redemptions?", async () => {
      await bankerApiFetch(`/promo/codes/${id}`, { method: "DELETE" });
      load();
    });
  }

  function startEdit(c: PromoCodeRow) {
    setEditId(c.id);
    setEditForm({ code: c.code, type: c.type, rewardAmount: String(c.rewardAmount), maxUses: c.maxUses != null ? String(c.maxUses) : "" });
    setEditErr("");
  }

  async function saveEdit(id: number) {
    if (!editForm.code.trim() || !editForm.rewardAmount) return;
    setEditSaving(true);
    setEditErr("");
    try {
      const r = await bankerApiFetch(`/promo/codes/${id}`, {
        method: "PUT",
        body: JSON.stringify({ code: editForm.code, type: editForm.type, rewardAmount: parseInt(editForm.rewardAmount), maxUses: editForm.maxUses ? parseInt(editForm.maxUses) : null }),
      });
      const d = await r.json();
      if (!r.ok) { setEditErr(d.error || "Failed to save."); setEditSaving(false); return; }
      setEditId(null);
      load();
    } catch { setEditErr("Network error."); }
    setEditSaving(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-amber-400" />
          <h3 className="font-bold text-foreground text-base">Promo Codes</h3>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className="w-4 h-4" /></button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg text-black transition-all"
            style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)" }}
          >
            <Plus className="w-3.5 h-3.5" /> New Code
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-white/10 bg-card p-4 space-y-3">
          <p className="text-sm font-bold text-foreground">Create New Code</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground block mb-1">Code</label>
              <Input value={form.code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUMMER25" className="font-mono" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-950 text-foreground text-sm px-3 py-2 focus:outline-none">
                <option value="single_use">Single Use</option>
                <option value="multi_use">Multi Use</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reward Type</label>
              <select value={form.rewardType} onChange={(e) => setForm({ ...form, rewardType: e.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-950 text-foreground text-sm px-3 py-2 focus:outline-none">
                <option value="chips">Chips</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reward Amount</label>
              <Input type="number" value={form.rewardAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, rewardAmount: e.target.value })} placeholder="5000" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Max Uses (blank = unlimited)</label>
              <Input type="number" value={form.maxUses} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, maxUses: e.target.value })} placeholder="Leave blank" />
            </div>
          </div>
          {formErr && <p className="text-xs text-red-400">{formErr}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={createCode} disabled={saving || !form.code.trim() || !form.rewardAmount}>
              {saving ? "Creating…" : "Create Code"}
            </Button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-400">{err}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && codes.length === 0 && <p className="text-sm text-muted-foreground">No promo codes yet.</p>}

      {codes.map((c) => (
        <div key={c.id} className="rounded-xl border border-white/10 bg-card overflow-hidden">
          {/* Summary row */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold font-mono ${c.active ? "bg-green-950 text-green-400" : "bg-white/5 text-white/30"}`}>
                <Tag className="w-3 h-3" /> {c.code}
              </span>
              <div className="text-xs text-muted-foreground space-x-1">
                <span className="capitalize">{c.type.replace("_", " ")}</span>
                <span>·</span>
                <span className="text-amber-400 font-medium">+{c.rewardAmount.toLocaleString()} chips</span>
                <span>·</span>
                <span>{c.totalUses}{c.maxUses ? `/${c.maxUses}` : ""} uses</span>
                <span>·</span>
                <span>by {c.createdBy}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => toggleActive(c)} title={c.active ? "Deactivate" : "Activate"} className="text-muted-foreground hover:text-amber-400 transition-colors">
                {c.active ? <ToggleRight className="w-4 h-4 text-green-400" /> : <ToggleLeft className="w-4 h-4" />}
              </button>
              <button onClick={() => editId === c.id ? setEditId(null) : startEdit(c)} className={`transition-colors ${editId === c.id ? "text-amber-400" : "text-muted-foreground hover:text-foreground"}`}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => deleteCode(c.id)} className="text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Inline edit form */}
          {editId === c.id && (
            <div className="border-t border-white/10 bg-white/[0.03] px-4 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1">Code</label>
                  <Input value={editForm.code} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditForm({ ...editForm, code: e.target.value.toUpperCase() })} className="font-mono" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Type</label>
                  <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className="w-full rounded-lg border border-white/10 bg-zinc-950 text-foreground text-sm px-3 py-2 focus:outline-none">
                    <option value="single_use">Single Use</option>
                    <option value="multi_use">Multi Use</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Reward Amount</label>
                  <Input type="number" value={editForm.rewardAmount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditForm({ ...editForm, rewardAmount: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs text-muted-foreground block mb-1">Max Uses (blank = unlimited)</label>
                  <Input type="number" value={editForm.maxUses} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditForm({ ...editForm, maxUses: e.target.value })} placeholder="Leave blank for unlimited" />
                </div>
              </div>
              {editErr && <p className="text-xs text-red-400">{editErr}</p>}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                <Button onClick={() => saveEdit(c.id)} disabled={editSaving || !editForm.code.trim() || !editForm.rewardAmount}>
                  {editSaving ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── PromoRedemptionsSection ──────────────────────────────────────────────────

type RedemptionRow = {
  id: number;
  player_id: number;
  code_id: number;
  redeemed_at: string;
  player_name: string | null;
  code_name: string | null;
};

function PromoRedemptionsSection() {
  const [rows, setRows] = useState<RedemptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await bankerApiFetch("/promo/redemptions");
      if (r.ok) setRows(await r.json());
      else setErr("Failed to load redemptions.");
    } catch { setErr("Network error."); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = search.trim()
    ? rows.filter((r) => (r.player_name ?? "").toLowerCase().includes(search.toLowerCase()) || (r.code_name ?? "").toLowerCase().includes(search.toLowerCase()))
    : rows;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-amber-400" />
          <h3 className="font-bold text-foreground text-base">Redemptions</h3>
        </div>
        <button onClick={load} className="text-muted-foreground hover:text-foreground transition-colors"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} placeholder="Search by player or code…" className="pl-8" />
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground">No redemptions found.</p>}

      {filtered.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/5">
                <th className="text-left px-4 py-2 text-xs text-muted-foreground font-semibold">Player</th>
                <th className="text-left px-4 py-2 text-xs text-muted-foreground font-semibold">Code</th>
                <th className="text-left px-4 py-2 text-xs text-muted-foreground font-semibold">Date</th>
              </tr>
            </thead>
            <tbody className="bg-zinc-950">
              {filtered.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? "bg-card" : "bg-white/[0.02]"}>
                  <td className="px-4 py-2 text-foreground">{row.player_name ?? `#${row.player_id}`}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded bg-amber-950 text-amber-400">
                      <Tag className="w-3 h-3" /> {row.code_name ?? `#${row.code_id}`}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{fmtETFull(row.redeemed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Owner RTP Presets Dashboard
// ─────────────────────────────────────────────────────────────────────────────

interface RTPPreset {
  id: string;
  name: string;
  description: string;
  color: string;
  targetRtp: string;
  settings: {
    blackjackOddsMode: "cold" | "cool" | "standard" | "warm" | "hot";
    rouletteOddsMode: "cold" | "cool" | "standard" | "warm" | "hot";
    crashHouseEdgePct: number;
  };
  estimatedRtp: { blackjack: number; roulette: number; crash: number };
}

interface OwnerPresetsData {
  presets: RTPPreset[];
  activePreset: string;
  liveSettings: {
    blackjackOddsMode: string;
    rouletteOddsMode: string;
    crashHouseEdgePct: number;
  };
  history: { preset_id: string; preset_name: string; applied_by: string; applied_at: string }[];
}

const PRESET_COLOR_MAP: Record<string, { border: string; badge: string; button: string; glow: string }> = {
  green: {
    border: "border-emerald-700",
    badge: "bg-emerald-950 text-emerald-400",
    button: "bg-emerald-700 hover:bg-emerald-600 text-white",
    glow: "shadow-emerald-900/40",
  },
  red: {
    border: "border-red-700",
    badge: "bg-red-950 text-red-400",
    button: "bg-red-700 hover:bg-red-600 text-white",
    glow: "shadow-red-900/40",
  },
  yellow: {
    border: "border-amber-700",
    badge: "bg-amber-900 text-amber-400",
    button: "bg-amber-600 hover:bg-amber-500 text-black font-semibold",
    glow: "shadow-amber-900/40",
  },
};

// ── Player Self-Service Kill Switches ─────────────────────────────────────────
function PlayerControlsSection() {
  const [controls, setControls] = useState<{ promoCodesEnabled: boolean; referralCodesEnabled: boolean; playerTransfersEnabled: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await bankerApiFetch("/settings/player-controls");
      if (r.ok) setControls(await r.json());
    } catch {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: "promoCodesEnabled" | "referralCodesEnabled" | "playerTransfersEnabled") {
    if (!controls) return;
    const newVal = !controls[key];
    setSaving(key); setMsg(null);
    try {
      const r = await bankerApiFetch("/settings/player-controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: newVal }),
      });
      if (r.ok) {
        setControls(await r.json());
        setMsg({ ok: true, text: `${key === "promoCodesEnabled" ? "Promo codes" : key === "referralCodesEnabled" ? "Referral codes" : "Player transfers"} ${newVal ? "enabled" : "disabled"}.` });
      } else {
        setMsg({ ok: false, text: "Failed to update setting." });
      }
    } catch { setMsg({ ok: false, text: "Network error." }); }
    setSaving(null);
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading controls…</p>;
  if (!controls) return <p className="text-sm text-destructive py-4">Failed to load controls.</p>;

  const items: { key: "promoCodesEnabled" | "referralCodesEnabled" | "playerTransfersEnabled"; label: string; desc: string; enabledDesc: string; disabledDesc: string }[] = [
    {
      key: "promoCodesEnabled",
      label: "Promo Codes",
      desc: "Player-facing promo code redemption",
      enabledDesc: "Players can redeem promo codes normally.",
      disabledDesc: "Players see \"Promo codes are temporarily disabled.\" Backend rejects all redemption requests.",
    },
    {
      key: "referralCodesEnabled",
      label: "Referral Codes",
      desc: "Referral code usage during account registration",
      enabledDesc: "Players can use referral codes when registering.",
      disabledDesc: "Players see \"Referral codes are temporarily disabled.\" Backend rejects registrations with a referral code.",
    },
    {
      key: "playerTransfersEnabled",
      label: "Player Transfers",
      desc: "Player-initiated chip transfers to other players",
      enabledDesc: "Players can transfer chips to each other normally.",
      disabledDesc: "Players see \"Player transfers are temporarily disabled.\" Backend rejects all transfer requests. Staff manual transfers still work.",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-foreground flex items-center gap-2">
          <Shield className="w-4 h-4 text-red-400" /> Player Self-Service Kill Switches
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Instantly disable player-facing systems. Codes, histories, and balances are never deleted. Staff-managed functions are unaffected.
        </p>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border ${msg.ok ? "bg-emerald-950 border-emerald-600 text-emerald-300" : "bg-red-950 border-red-600 text-red-300"}`}>
          {msg.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="space-y-3">
        {items.map(({ key, label, desc, enabledDesc, disabledDesc }) => {
          const enabled = controls[key];
          const isSaving = saving === key;
          return (
            <div key={key} className={`rounded-xl border p-5 transition-all ${enabled ? "border-emerald-700 bg-emerald-950" : "border-red-700 bg-red-950"}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-foreground">{label}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${enabled ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}`}>
                      {enabled ? "ENABLED" : "DISABLED"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{desc}</p>
                  <p className={`text-xs ${enabled ? "text-emerald-400" : "text-red-400"}`}>{enabled ? enabledDesc : disabledDesc}</p>
                </div>
                <button
                  onClick={() => toggle(key)}
                  disabled={isSaving}
                  className={`relative flex-shrink-0 w-14 h-7 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-zinc-950 ${enabled ? "bg-emerald-600 focus:ring-emerald-500" : "bg-red-700 focus:ring-red-500"} disabled:opacity-60`}
                  title={enabled ? `Disable ${label}` : `Enable ${label}`}
                >
                  {isSaving
                    ? <Loader2 className="w-4 h-4 animate-spin absolute top-1.5 left-1/2 -translate-x-1/2 text-white" />
                    : <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200 ${enabled ? "left-8" : "left-1"}`} />
                  }
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground border-t border-zinc-700 pt-3 leading-relaxed">
        These settings are enforced on the server. Players cannot bypass them by calling API endpoints directly. Toggle changes take effect immediately for all players.
      </p>
    </div>
  );
}

function OwnerDashboardTab() {
  const [liveSettings, setLiveSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Per-game temperature sliders: 0 = fully cold, 100 = fully hot
  const [bjTemp,      setBjTemp]      = useState(50);
  const [roulTemp,    setRoulTemp]    = useState(50);
  const [crashTemp,   setCrashTemp]   = useState(50);
  const [baccTemp,    setBaccTemp]    = useState(50);
  const [rtpInputs,   setRtpInputs]   = useState<Record<string, string>>({});

  // Hot spin bank
  const [hotSpinsInput, setHotSpinsInput] = useState("3");
  const [hotSpinsSaving, setHotSpinsSaving] = useState(false);
  const [hotSpinsLive, setHotSpinsLive] = useState(0);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function oddsMode(pct: number): "glacier" | "frozen" | "cold" | "cool" | "standard" | "warm" | "hot" {
    if (pct <= 14) return "glacier";
    if (pct <= 28) return "frozen";
    if (pct <= 42) return "cold";
    if (pct <= 56) return "cool";
    if (pct <= 71) return "standard";
    if (pct <= 85) return "warm";
    return "hot";
  }
  function crashEdge(pct: number): number {
    return Math.round((30 - 28 * (pct / 100)) * 2) / 2;
  }
  function modeToSlider(mode: string): number {
    return { glacier: 7, frozen: 21, cold: 35, cool: 49, standard: 64, warm: 78, hot: 93 }[mode] ?? 64;
  }
  function tempColor(pct: number) {
    const m = oddsMode(pct);
    return { glacier: "text-indigo-400", frozen: "text-blue-400", cold: "text-sky-400", cool: "text-cyan-400", standard: "text-yellow-400", warm: "text-orange-400", hot: "text-red-400" }[m] ?? "text-foreground";
  }

  // Smooth linear interpolation for RTP display — no zone-boundary jumps
  type LerpGame = "blackjack" | "roulette" | "baccarat";
  const LERP_ANCHORS: { pct: number; blackjack: number; roulette: number; baccarat: number }[] = [
    { pct:   0, blackjack: 95.5, roulette: 80,   baccarat: 86   },
    { pct:  14, blackjack: 95.7, roulette: 83,   baccarat: 90   },
    { pct:  28, blackjack: 96.0, roulette: 87,   baccarat: 93   },
    { pct:  42, blackjack: 97.5, roulette: 90,   baccarat: 95.5 },
    { pct:  56, blackjack: 97.8, roulette: 92.4, baccarat: 97   },
    { pct:  71, blackjack: 99.0, roulette: 94.7, baccarat: 98.5 },
    { pct:  85, blackjack: 99.2, roulette: 95.5, baccarat: 99.5 },
    { pct: 100, blackjack: 99.4, roulette: 96.3, baccarat: 100.5},
  ];
  function lerpRTP(pct: number, game: LerpGame): number {
    const pts = LERP_ANCHORS;
    if (pct <= pts[0].pct) return pts[0][game];
    if (pct >= pts[pts.length - 1].pct) return pts[pts.length - 1][game];
    for (let i = 0; i < pts.length - 1; i++) {
      if (pct >= pts[i].pct && pct <= pts[i + 1].pct) {
        const t = (pct - pts[i].pct) / (pts[i + 1].pct - pts[i].pct);
        const v = pts[i][game] + t * (pts[i + 1][game] - pts[i][game]);
        return Math.round(v * 10) / 10;
      }
    }
    return pts[pts.length - 1][game];
  }
  function rtpToSlider(rtp: number, game: LerpGame | "crash"): number {
    if (game === "crash") {
      // rtp = 100 - (30 - 28*(pct/100)) = 70 + 28*(pct/100) → pct = (rtp - 70) / 28 * 100
      return Math.round(Math.min(100, Math.max(0, (rtp - 70) / 28 * 100)));
    }
    const pts = LERP_ANCHORS;
    if (rtp <= pts[0][game]) return pts[0].pct;
    if (rtp >= pts[pts.length - 1][game]) return pts[pts.length - 1].pct;
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i][game], hi = pts[i + 1][game];
      if (rtp >= lo && rtp <= hi) {
        const t = (rtp - lo) / (hi - lo);
        return Math.round(pts[i].pct + t * (pts[i + 1].pct - pts[i].pct));
      }
    }
    return pts[pts.length - 1].pct;
  }
  function applyRtpInput(key: string, game: LerpGame | "crash", setter: (v: number) => void) {
    const raw = rtpInputs[key];
    if (!raw) return;
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setter(rtpToSlider(val, game));
    setRtpInputs(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await bankerApiFetch("/owner/rtp-presets");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      const ls = json.liveSettings;
      setLiveSettings(ls);
      // Use saved raw slider positions if available, fall back to mode midpoints
      setBjTemp(ls.sliderBjTemp        ?? modeToSlider(ls.blackjackOddsMode ?? "standard"));
      setRoulTemp(ls.sliderRoulTemp    ?? modeToSlider(ls.rouletteOddsMode ?? "standard"));
      setBaccTemp(ls.sliderBaccTemp    ?? modeToSlider(ls.baccaratOddsMode ?? "standard"));
      const edge = ls.crashHouseEdgePct ?? 10;
      setCrashTemp(ls.sliderCrashTemp  ?? Math.round(Math.min(100, Math.max(0, (30 - edge) / 28 * 100))));
      setHotSpinsLive(ls.rouletteHotSpins ?? 0);
    } catch (e: any) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await bankerApiFetch("/owner/rtp-presets");
        if (!res.ok) return;
        const json = await res.json();
        setHotSpinsLive(json.liveSettings?.rouletteHotSpins ?? 0);
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(id);
  }, []);

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const body = {
        blackjackOddsMode: oddsMode(bjTemp),
        rouletteOddsMode:  oddsMode(roulTemp),
        baccaratOddsMode:  oddsMode(baccTemp),
        crashHouseEdgePct: crashEdge(crashTemp),
        // Also persist exact slider positions so they survive a page refresh
        sliderBjTemp:      bjTemp,
        sliderRoulTemp:    roulTemp,
        sliderCrashTemp:   crashTemp,
        sliderBaccTemp:    baccTemp,
      };
      const res = await bankerApiFetch("/owner/manual-settings", { method: "POST", body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setMsg({ type: "success", text: "Game odds applied." });
    } catch (e: any) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const queueHotSpins = async (count: number) => {
    setHotSpinsSaving(true); setMsg(null);
    try {
      const res = await bankerApiFetch("/owner/roulette-hot-spins", { method: "POST", body: JSON.stringify({ count }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setMsg({ type: "success", text: json.message });
      if (typeof json.rouletteHotSpins === "number") setHotSpinsLive(json.rouletteHotSpins);
    } catch (e: any) {
      setMsg({ type: "error", text: e.message });
    } finally {
      setHotSpinsSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  if (!liveSettings) return <div className="flex items-center justify-center py-8 gap-2 text-red-400"><AlertCircle className="w-4 h-4" /> Failed to load.</div>;

  const GAME_SLIDERS: { label: string; emoji: string; pct: number; set: (v: number) => void; rtp: number; game: LerpGame | "crash"; locked?: boolean; lockNote?: string }[] = [
    {
      label: "Blackjack", emoji: "🃏",
      pct: bjTemp, set: setBjTemp,
      rtp: lerpRTP(bjTemp, "blackjack"), game: "blackjack",
    },
    {
      label: "Roulette", emoji: "🎡",
      pct: roulTemp, set: setRoulTemp,
      rtp: lerpRTP(roulTemp, "roulette"), game: "roulette",
    },
    {
      label: "Baccarat", emoji: "🎴",
      pct: baccTemp, set: setBaccTemp,
      rtp: lerpRTP(baccTemp, "baccarat"), game: "baccarat",
    },
  ];

  return (
    <div className="space-y-4">
      {/* ── Per-game temperature sliders ── */}
      <div className="rounded-xl border border-zinc-700 bg-card/50 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Table Temperature</span>
          <span className="text-xs text-muted-foreground ml-1">— set each game independently</span>
        </div>

        <div className="space-y-3">
          {GAME_SLIDERS.map(({ label, emoji, pct, set, rtp, game, locked, lockNote }) => (
            <div key={label} className="space-y-1">
              <div className="grid grid-cols-[80px_1fr_80px_64px] items-center gap-3">
                {/* Label */}
                <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <span>{emoji}</span> {label}
                </div>
                {/* Slider */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">🧊</span>
                  <input
                    type="range" min={0} max={100} step={1}
                    value={pct}
                    disabled={locked}
                    onChange={e => { if (locked) return; set(Number(e.target.value)); setRtpInputs(prev => { const n = { ...prev }; delete n[label]; return n; }); }}
                    className={`flex-1 h-1.5 rounded-full ${locked ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                    style={{ background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${pct}%, #374151 ${pct}%, #374151 100%)`, accentColor: "#6366f1" }}
                  />
                  <span className="text-xs">🔥</span>
                </div>
                {/* RTP input */}
                <div className="flex items-center gap-0.5">
                  <input
                    type="number"
                    min={0} max={100} step={0.1}
                    value={locked ? rtp : (rtpInputs[label] !== undefined ? rtpInputs[label] : rtp)}
                    disabled={locked}
                    onChange={e => { if (!locked) setRtpInputs(prev => ({ ...prev, [label]: e.target.value })); }}
                    onBlur={() => { if (!locked) applyRtpInput(label, game, set); }}
                    onKeyDown={e => { if (!locked && e.key === "Enter") applyRtpInput(label, game, set); }}
                    className={`w-full text-xs font-bold font-mono text-foreground bg-transparent border border-zinc-700 rounded px-1.5 py-0.5 text-right focus:outline-none focus:border-primary/60 ${locked ? "opacity-60 cursor-not-allowed" : ""}`}
                  />
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
                {/* Temp label */}
                <span className={`text-[10px] font-semibold ${locked ? "text-emerald-400" : tempColor(pct)} truncate`}>{locked ? "Locked" : oddsMode(pct)}</span>
              </div>
              {locked && lockNote && (
                <p className="text-[10px] text-muted-foreground/80 pl-[92px] leading-snug">🔒 {lockNote}</p>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</> : <><CheckCircle className="w-3.5 h-3.5" /> Apply All</>}
        </button>

        {/* Inline feedback — shown right where the user is looking */}
        {msg && (
          <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium border ${msg.type === "success" ? "bg-emerald-950 border-emerald-600 text-emerald-300" : "bg-red-950 border-red-600 text-red-300"}`}>
            {msg.type === "success" ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1">{msg.text}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setMsg(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>

      {/* ── Roulette Hot Spin Bank ── */}
      <div className="rounded-xl border border-amber-700 bg-amber-950 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-base">🎯</span>
          <span className="text-sm font-semibold text-amber-300">Roulette Hot Spins</span>
          <span className={`text-sm font-bold font-mono px-2 py-0.5 rounded ml-auto ${hotSpinsLive > 0 ? "bg-amber-900 text-amber-300" : "bg-zinc-800 text-muted-foreground"}`}>
            {hotSpinsLive} banked
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number" min={1} max={50} step={1}
              value={hotSpinsInput}
              onChange={e => setHotSpinsInput(e.target.value)}
              className="w-16 bg-input border border-zinc-700 rounded px-2 py-1.5 text-foreground text-sm font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <button
              onClick={() => { const n = parseInt(hotSpinsInput, 10); if (!isNaN(n) && n >= 1 && n <= 50) queueHotSpins(n); }}
              disabled={hotSpinsSaving}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition disabled:opacity-60"
            >
              {hotSpinsSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : "+ Queue"}
            </button>
            {hotSpinsLive > 0 && (
              <button
                onClick={() => queueHotSpins(0)}
                disabled={hotSpinsSaving}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-xs text-muted-foreground hover:text-red-400 hover:border-red-700 transition disabled:opacity-60"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
          Queue guaranteed player-winning roulette spins. Each banked spin forces at least one paying pocket. Bank counts down automatically.
        </p>
        {msg && msg.type === "success" && msg.text.toLowerCase().includes("spin") && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border bg-emerald-950 border-emerald-600 text-emerald-300 mt-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{msg.text}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setMsg(null)}><X className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  );
}
