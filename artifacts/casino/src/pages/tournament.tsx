import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useStore } from "../store";
import { fmtETTime } from "../utils/timezone";
import DOMPurify from "dompurify";
import { Button } from "../components/ui-elements";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Trophy, Users, Coins, Clock, ChevronLeft, ChevronRight, LayoutGrid, RefreshCw, Lock, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useWs } from "../lib/WsContext";

type TournamentStatus = "registering" | "running" | "finished";

interface TournamentEntry {
  id: number;
  playerId: number;
  playerName: string;
  tournamentChips: number;
  tableId: number | null;
  status: string;
  finishPosition: number | null;
  rebuysUsed: number;
  score?: number;
  biggestSpin?: number;
}

interface TableSeat {
  seatIndex: number;
  playerId: number | null;
  playerName: string | null;
  chips: number | null;
  status: string;
}

interface TournamentTable {
  id: number;
  name: string;
  status: string;
  seats: TableSeat[];
  locked?: boolean;
}

interface Tournament {
  id: number;
  name: string;
  description: string | null;
  type: "poker" | "slots";
  buyIn: number;
  startingChips: number;
  maxPlayers: number;
  smallBlind: number;
  bigBlind: number;
  minBet?: number | null;
  maxBet?: number | null;
  durationMinutes?: number | null;
  endTime?: string | null;
  status: TournamentStatus;
  prizePool: number;
  winnerId: number | null;
  winnerName: string | null;
  createdAt: string;
  rebuysEnabled: boolean;
  maxRebuys: number;
  entries: TournamentEntry[];
  tables: TournamentTable[];
}

interface LeaderboardEntry {
  rank: number;
  playerId: number;
  playerName: string;
  tournamentChips: number;
  score: number;
  biggestSpin?: number;
  status: string;
  tableId: number | null;
}

interface Leaderboard {
  tournamentId: number;
  tournamentName: string;
  status: string;
  prizePool: number;
  updatedAt: string | null;
  entries: LeaderboardEntry[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const { sessionToken, bankerToken } = useStore.getState();
  const token = sessionToken || bankerToken;
  return fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
}

export default function TournamentPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { playerId, sessionToken } = useStore();
  const { toast } = useToast();
  const { subscribe, _addSub, _removeSub } = useWs();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [lbPage, setLbPage] = useState(0);
  const LB_PAGE_SIZE = 10;
  const [rebuying, setRebuying] = useState(false);
  const [movingToTableId, setMovingToTableId] = useState<number | null>(null);
  const wsActiveRef = useRef(false);


  // ── Rolling-entry countdown ────────────────────────────────────────────────
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (tournament?.type !== "slots" || !tournament.endTime) {
      setCountdown(null);
      return;
    }
    const tick = () => setCountdown(Math.max(0, new Date(tournament.endTime!).getTime() - Date.now()));
    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [tournament?.endTime]);

  const tournamentId = parseInt(id);

  useEffect(() => {
    if (!playerId) setLocation("/login");
  }, [playerId]);

  // ── WS subscription for live tournament updates ────────────────────────────
  useEffect(() => {
    if (!tournamentId) return;
    const subMsg = { type: "subscribe_tournament", tournamentId };
    _addSub(subMsg);
    wsActiveRef.current = false;
    const unsub = subscribe("tournament_update", (m: any) => {
      if (m.tournamentId !== tournamentId) return;
      wsActiveRef.current = true;
      setTournament(m.tournament as Tournament);
    });
    // Fallback poll: fetch every 15s if WS hasn't delivered an update yet
    fetchTournament();
    const fallback = setInterval(() => {
      if (!wsActiveRef.current) fetchTournament();
    }, 15_000);
    return () => {
      unsub();
      _removeSub(subMsg);
      wsActiveRef.current = false;
      clearInterval(fallback);
    };
  }, [tournamentId, _addSub, _removeSub, subscribe]);

  async function fetchTournament() {
    try {
      const res = await apiFetch(`/tournaments/${tournamentId}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setTournament(data);
    } catch {}
    setLoading(false);
  }

  const fetchLeaderboard = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLeaderboardLoading(true);
    try {
      const res = await apiFetch(`/tournaments/${tournamentId}/leaderboard`);
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data);
        setLbPage(0);
      }
    } catch {}
    setLeaderboardLoading(false);
  }, [tournamentId]);

  // Load leaderboard once on mount (and whenever status changes to running/finished)
  useEffect(() => {
    if (!tournament) return;
    if (tournament.status === "running" || tournament.status === "finished") {
      fetchLeaderboard(false);
    }
  }, [tournament?.status]);

  const myEntry = tournament?.entries.find((e) => e.playerId === playerId);
  const isRegistered = !!myEntry;
  const activeCount = tournament?.entries.filter((e) => e.status === "registered" || e.status === "active").length ?? 0;
  const isFull = activeCount >= (tournament?.maxPlayers ?? 0);

  const myTableId = myEntry?.tableId;
  const myTable = (tournament?.tables ?? []).find((t) => t.id === myTableId);
  const playersRemaining = tournament?.entries.filter((e) => e.status === "active").length ?? 0;

  async function handleRegister() {
    if (!tournament) return;
    setRegistering(true);
    try {
      const res = await apiFetch(`/tournaments/${tournament.id}/register`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Registration failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Registered!", description: `You're in. Buy-in of ${tournament.buyIn.toLocaleString()} chips deducted.` });
        fetchTournament();
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    }
    setRegistering(false);
  }

  async function handleRebuy() {
    if (!tournament) return;
    setRebuying(true);
    try {
      const res = await apiFetch(`/tournaments/${tournament.id}/rebuy`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Rebuy failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Rebuy successful!", description: `You're back in with ${tournament.startingChips.toLocaleString()} chips. ${data.rebuysRemaining} rebuy(s) remaining.` });
        fetchTournament();
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    }
    setRebuying(false);
  }

  async function handleUnregister() {
    if (!tournament) return;
    setRegistering(true);
    try {
      const res = await apiFetch(`/tournaments/${tournament.id}/register`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Withdrawn", description: `Buy-in of ${tournament.buyIn.toLocaleString()} chips refunded.` });
        fetchTournament();
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    }
    setRegistering(false);
  }


  async function handleMoveToTable(targetTableId: number) {
    setMovingToTableId(targetTableId);
    try {
      const res = await apiFetch(`/tables/${targetTableId}/tournament-move`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Cannot move", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Moved!", description: "You've been moved to the new table." });
        setLocation(`/table/${targetTableId}`);
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    }
    setMovingToTableId(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading tournament...</div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-muted-foreground">Tournament not found.</div>
        <Button variant="ghost" onClick={() => setLocation("/tournaments")}>Back to Lobby</Button>
      </div>
    );
  }

  const statusLabel = {
    registering: "Open for Registration",
    running: "In Progress",
    finished: "Finished",
  }[tournament.status];

  const statusColor = {
    registering: "bg-green-900 text-green-400",
    running: "bg-yellow-900 text-yellow-400",
    finished: "bg-muted text-muted-foreground",
  }[tournament.status];

  const lbUpdatedLabel = leaderboard?.updatedAt
    ? `Updated ${fmtETTime(leaderboard.updatedAt)}`
    : "Not yet updated";

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <div className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => setLocation("/tournaments")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-display font-bold text-primary">{tournament.name}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 grid-cols-4 gap-3">
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <Coins className="w-5 h-5 text-primary mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Buy-in</p>
            <p className="text-lg font-display font-bold text-primary">{tournament.buyIn.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <Trophy className="w-5 h-5 text-yellow-400 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Prize Pool</p>
            <p className="text-lg font-display font-bold text-yellow-400">{tournament.prizePool.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <Users className="w-5 h-5 text-blue-400 mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">
              {tournament.status === "running" ? "Remaining" : "Registered"}
            </p>
            <p className="text-lg font-display font-bold text-foreground">
              {tournament.status === "running" ? playersRemaining : activeCount}/{tournament.maxPlayers}
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 text-center">
            <Clock className="w-5 h-5 text-muted-foreground mx-auto mb-1" />
            <p className="text-xs text-muted-foreground">Blinds</p>
            <p className="text-lg font-display font-bold text-foreground">{tournament.smallBlind}/{tournament.bigBlind}</p>
          </div>
        </div>

        {/* Starting chips */}
        <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Starting chips (tournament only)</p>
            <p className="text-xl font-display font-bold text-primary">{tournament.startingChips.toLocaleString()} T-chips</p>
          </div>
          <p className="text-xs text-muted-foreground max-w-[200px] text-right">Tournament chips are separate from your regular wallet.</p>
        </div>

        {tournament.description && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div
              className="rte-display text-sm text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(tournament.description) }}
            />
          </div>
        )}

        {/* Winner banner */}
        {tournament.status === "finished" && tournament.winnerName && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-yellow-950 border border-yellow-700 rounded-2xl p-6 flex flex-col items-center gap-2"
          >
            <Trophy className="w-10 h-10 text-yellow-400" />
            <h2 className="text-2xl font-display font-bold text-yellow-400">Tournament Winner</h2>
            <p className="text-white text-lg font-semibold">{tournament.winnerName}</p>
            <p className="text-sm text-muted-foreground">Won the {tournament.prizePool.toLocaleString()} chip prize pool</p>
          </motion.div>
        )}

        {/* Registration actions */}
        {tournament.status === "registering" && (
          <div className="flex flex-col gap-3">
            {isRegistered ? (
              <>
                <div className="bg-green-950 border border-green-700 rounded-xl p-4 text-center">
                  <p className="text-green-400 font-semibold">You are registered for this tournament</p>
                  <p className="text-sm text-muted-foreground mt-1">Wait for the banker to start the tournament.</p>
                </div>
                <Button variant="ghost" onClick={handleUnregister} disabled={registering} className="text-red-400 hover:text-red-300">
                  Withdraw Registration (get refund)
                </Button>
              </>
            ) : isFull ? (
              <Button disabled>Tournament Full</Button>
            ) : (
              <Button onClick={handleRegister} disabled={registering || !sessionToken} className="h-12 text-base">
                <Coins className="w-5 h-5 mr-2" />
                Register — {tournament.buyIn.toLocaleString()} chips
              </Button>
            )}
          </div>
        )}

        {/* Running phase — slots tournament: Go to Slots */}
        {tournament.status === "running" && tournament.type === "slots" && (
          <div className="space-y-4">
            {myEntry && myEntry.status === "active" ? (
              <div className="bg-primary/10 border border-primary/30 rounded-2xl p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-primary/80 font-medium uppercase tracking-wide">Your Slot Machine</p>
                  <p className="text-lg font-display font-bold text-primary mt-0.5">🎰 Tournament Slots</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    T-chips: <span className="text-primary font-mono font-bold">{myEntry.tournamentChips.toLocaleString()}</span>
                    {" · "}Score: <span className="text-yellow-400 font-mono font-bold">{(myEntry.score ?? 0).toLocaleString()}</span>
                  </p>
                  {countdown !== null && (
                    <p className="text-xs mt-1 font-mono" style={{ color: countdown < 3_600_000 ? "#f59e0b" : "#666" }}>
                      {countdown > 0
                        ? `${Math.floor(countdown / 3_600_000) > 0 ? `${Math.floor(countdown / 3_600_000)}h ` : ""}${Math.floor((countdown % 3_600_000) / 60_000)}m remaining`
                        : "Time's up"}
                    </p>
                  )}
                </div>
                <Button onClick={() => setLocation(`/slots-tournament/${tournament.id}`)} className="shrink-0">
                  <ChevronRight className="w-5 h-5 mr-1" />
                  Go to Slots
                </Button>
              </div>
            ) : myEntry?.status === "eliminated" ? (
              <div className="bg-zinc-950 border border-zinc-700 rounded-xl p-4 text-center">
                <p className="text-zinc-300 font-semibold">You're done spinning</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Final score: <span className="font-mono font-bold text-yellow-400">{(myEntry.score ?? 0).toLocaleString()}</span> · {playersRemaining} players still spinning
                </p>
              </div>
            ) : !isRegistered ? (
              // Rolling-entry: allow joining while running + time remaining
              countdown !== null && countdown > 0 ? (
                <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
                  <div className="text-center space-y-1">
                    <p className="font-display font-bold text-xl text-foreground">Join the Tournament</p>
                    <p className="text-sm text-muted-foreground">Jump in now and start spinning to earn your score!</p>
                  </div>
                  {countdown < 3_600_000 && countdown > 0 && (
                    <div className="bg-yellow-950 border border-yellow-700 rounded-lg px-3 py-2 text-center">
                      <p className="text-yellow-400 text-sm font-medium">⚠ Less than 1 hour left — last chance to enter!</p>
                    </div>
                  )}
                  <Button
                    onClick={handleRegister}
                    disabled={registering || !sessionToken}
                    className="w-full h-12 text-base"
                  >
                    <Coins className="w-5 h-5 mr-2" />
                    {registering ? "Entering…" : `Join Now — ${tournament.buyIn.toLocaleString()} chips`}
                  </Button>
                </div>
              ) : (
                <div className="bg-muted/20 border border-border rounded-xl p-4 text-center">
                  <p className="text-sm text-muted-foreground">This tournament has ended — no more entries accepted.</p>
                </div>
              )
            ) : null}
          </div>
        )}

        {/* Running phase — poker: My table + all tables */}
        {tournament.status === "running" && tournament.type !== "slots" && (
          <div className="space-y-4">
            {/* My table CTA */}
            {myEntry && myEntry.status === "active" && myTableId ? (
              <div className="bg-primary/10 border border-primary/30 rounded-2xl p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-primary/80 font-medium uppercase tracking-wide">Your Table</p>
                  <p className="text-lg font-display font-bold text-primary mt-0.5">{myTable?.name ?? `Table #${myTableId}`}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your chips: <span className="text-primary font-mono font-bold">{myEntry.tournamentChips.toLocaleString()}</span>
                  </p>
                </div>
                <Button onClick={() => setLocation(`/table/${myTableId}`)} className="shrink-0">
                  <ChevronRight className="w-5 h-5 mr-1" />
                  Go to Table
                </Button>
              </div>
            ) : myEntry && myEntry.status === "active" && !myTableId ? (
              <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-4 text-center">
                <p className="text-yellow-400 font-semibold text-sm">Placing you at a table…</p>
                <p className="text-xs text-muted-foreground mt-1">Refreshing automatically</p>
              </div>
            ) : myEntry?.status === "eliminated" ? (
              <div className="bg-red-950 border border-red-700 rounded-xl p-4">
                <div className="text-center">
                  <p className="text-red-400 font-semibold">You have been eliminated</p>
                  <p className="text-sm text-muted-foreground mt-1">{playersRemaining} players remaining</p>
                </div>
                {tournament.rebuysEnabled && (myEntry.rebuysUsed ?? 0) < tournament.maxRebuys && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Rebuy available — {tournament.maxRebuys - (myEntry.rebuysUsed ?? 0)} of {tournament.maxRebuys} remaining
                    </p>
                    <Button
                      onClick={handleRebuy}
                      disabled={rebuying || !sessionToken}
                      className="h-10 text-sm"
                    >
                      <Coins className="w-4 h-4 mr-2" />
                      Rebuy — {tournament.buyIn.toLocaleString()} chips
                    </Button>
                  </div>
                )}
                {tournament.rebuysEnabled && (myEntry.rebuysUsed ?? 0) >= tournament.maxRebuys && (
                  <p className="text-center text-xs text-muted-foreground mt-3">No rebuys remaining ({tournament.maxRebuys}/{tournament.maxRebuys} used)</p>
                )}
              </div>
            ) : null}

            {/* All active tables */}
            {(tournament.tables ?? []).length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-semibold text-foreground">Active Tables ({(tournament.tables ?? []).length})</h3>
                </div>
                <div className="divide-y divide-border">
                  {(tournament.tables ?? []).map((table) => {
                    const activeSeats = table.seats.filter((s) => s.playerId && (s.chips ?? 0) > 0);
                    const chipLeader = activeSeats.reduce<TableSeat | null>(
                      (best, s) => (!best || (s.chips ?? 0) > (best.chips ?? 0) ? s : best),
                      null
                    );
                    const isMyTable = table.id === myTableId;
                    const isLocked = !!table.locked;
                    const canMove = myEntry?.status === "active" && !isMyTable && !isLocked && myEntry.tableId !== null;
                    const isMoving = movingToTableId === table.id;
                    return (
                      <div
                        key={table.id}
                        className={`px-4 py-3 flex items-center justify-between gap-3 ${isMyTable ? "bg-primary/5" : ""}`}
                      >
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-foreground">{table.name}</span>
                            {isMyTable && (
                              <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">Your Table</span>
                            )}
                            {isLocked && (
                              <span className="flex items-center gap-0.5 text-xs text-red-400 bg-red-950 px-1.5 py-0.5 rounded-full">
                                <Lock className="w-2.5 h-2.5" /> Locked
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {activeSeats.length} players
                            {chipLeader && ` · Leader: ${chipLeader.playerName} (${(chipLeader.chips ?? 0).toLocaleString()})`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canMove && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleMoveToTable(table.id)}
                              disabled={isMoving || movingToTableId !== null}
                              className="text-xs h-7 px-2"
                            >
                              {isMoving ? "Moving…" : "Move Here"}
                            </Button>
                          )}
                          <button
                            onClick={() => setLocation(`/table/${table.id}`)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                          >
                            Watch <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Leaderboard — snapshot updated at bust / consolidation ─────────── */}
        {(tournament.status === "running" || tournament.status === "finished") && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">
                  {tournament.type === "slots" ? "Score Leaderboard" : "Chip Leaderboard"}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">{lbUpdatedLabel}</p>
              </div>
              <button
                onClick={() => fetchLeaderboard(true)}
                disabled={leaderboardLoading}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${leaderboardLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            {!leaderboard || leaderboard.entries.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                {leaderboard ? "Leaderboard will appear once the tournament starts." : "Loading..."}
              </div>
            ) : (() => {
              const totalPages = Math.ceil(leaderboard.entries.length / LB_PAGE_SIZE);
              const pageEntries = leaderboard.entries.slice(lbPage * LB_PAGE_SIZE, (lbPage + 1) * LB_PAGE_SIZE);
              return (
                <>
                  <div className="divide-y divide-border">
                    {pageEntries.map((entry) => (
                      <div
                        key={entry.playerId}
                        className={`px-4 py-3 flex items-center justify-between ${entry.playerId === playerId ? "bg-primary/5" : ""}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-sm font-mono w-6 text-center ${entry.rank === 1 ? "text-yellow-400 font-bold" : "text-muted-foreground"}`}>
                            {entry.rank}
                          </span>
                          <span className={`font-medium ${entry.status === "winner" ? "text-yellow-400" : entry.status === "eliminated" && tournament.type !== "slots" ? "text-muted-foreground line-through" : entry.status === "eliminated" ? "text-muted-foreground" : "text-foreground"}`}>
                            {entry.playerName}
                            {entry.playerId === playerId && <span className="text-primary text-xs ml-1">(you)</span>}
                          </span>
                          {entry.status === "winner" && <Trophy className="w-3.5 h-3.5 text-yellow-400" />}
                          {entry.status === "eliminated" && tournament.type !== "slots" && <span className="text-red-500 text-xs">Eliminated</span>}
                          {entry.status === "eliminated" && tournament.type === "slots" && <span className="text-zinc-600 text-xs">Done</span>}
                        </div>
                        <span className={`font-mono text-sm ${entry.status === "eliminated" ? "text-muted-foreground" : tournament.type === "slots" ? "text-yellow-400" : "text-primary"}`}>
                          {tournament.type === "slots"
                            ? <><Star className="w-3 h-3 inline mr-0.5 -mt-0.5" />{(entry.score ?? 0).toLocaleString()}</>
                            : entry.tournamentChips.toLocaleString()
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="px-4 py-2.5 border-t border-border flex items-center justify-between">
                      <button
                        onClick={() => setLbPage((p) => Math.max(0, p - 1))}
                        disabled={lbPage === 0}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Prev
                      </button>
                      <span className="text-xs text-muted-foreground">
                        Page {lbPage + 1} of {totalPages} · {leaderboard.entries.length} players
                      </span>
                      <button
                        onClick={() => setLbPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={lbPage >= totalPages - 1}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* Registered player list (registering only — finished view uses the chip leaderboard) */}
        {tournament.status === "registering" && (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="font-semibold text-foreground">Registered Players</h3>
            </div>
            {tournament.entries.length === 0 ? (
              <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                No players registered yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tournament.entries
                  .slice()
                  .sort((a, b) => {
                    const order: Record<string, number> = { winner: 0, active: 1, registered: 2, eliminated: 3 };
                    return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                  })
                  .map((entry) => (
                    <div key={entry.id} className="px-4 py-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${
                          entry.status === "winner" ? "bg-yellow-400" :
                          entry.status === "active" ? "bg-green-400" :
                          entry.status === "registered" ? "bg-blue-400" :
                          "bg-red-800"
                        }`} />
                        <span className={`font-medium ${entry.status === "eliminated" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {entry.playerName}
                        </span>
                        {entry.status === "winner" && <Trophy className="w-3.5 h-3.5 text-yellow-400" />}
                      </div>
                      <div className="text-sm text-right">
                        {(entry.status === "active" || entry.status === "winner") && (
                          <span className="text-primary font-mono">{entry.tournamentChips.toLocaleString()} T-chips</span>
                        )}
                        {entry.status === "eliminated" && <span className="text-red-400 text-xs">Eliminated</span>}
                        {entry.status === "registered" && <span className="text-muted-foreground text-xs">Waiting</span>}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
