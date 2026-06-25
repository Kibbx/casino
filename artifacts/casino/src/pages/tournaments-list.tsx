import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import DOMPurify from "dompurify";
import { Button } from "../components/ui-elements";
import { motion } from "framer-motion";
import { Trophy, Users, Coins, Clock, ChevronRight, ArrowLeft, LayoutGrid, Medal } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string) {
  const { sessionToken, bankerToken } = useStore.getState();
  const token = sessionToken || bankerToken;
  return fetch(`${BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => r.json());
}

type TournamentStatus = "registering" | "running" | "finished";
type GameTypeFilter = "all" | "poker" | "blackjack" | "slots" | "mixed";

interface Tournament {
  id: number;
  name: string;
  description: string | null;
  type?: "poker" | "slots";
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
  basePrizePool: number;
  buyInPrizePercent: number;
  winnerId: number | null;
  winnerName: string | null;
  registeredCount: number;
  entries: any[];
  tables: any[];
  gameType?: string;
}

const GAME_TYPE_TABS: { key: GameTypeFilter; label: string; icon: string }[] = [
  { key: "all",       label: "All",       icon: "🎲" },
  { key: "poker",     label: "Poker",     icon: "♠️" },
  { key: "blackjack", label: "Blackjack", icon: "🃏" },
  { key: "slots",     label: "Slots",     icon: "🎰" },
  { key: "mixed",     label: "Mixed",     icon: "🏆" },
];

function inferGameType(t: Tournament): GameTypeFilter {
  if (t.type) return t.type as GameTypeFilter;
  if (t.gameType) return t.gameType as GameTypeFilter;
  if (t.smallBlind || t.bigBlind) return "poker";
  return "mixed";
}

export default function TournamentsListPage() {
  const [, setLocation] = useLocation();
  const { playerId } = useStore();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<GameTypeFilter>("all");

  useEffect(() => {
    if (!playerId) setLocation("/login");
  }, [playerId]);

  useEffect(() => {
    loadTournaments();
    const iv = setInterval(loadTournaments, 5000);
    return () => clearInterval(iv);
  }, []);

  async function loadTournaments() {
    try {
      const data = await apiFetch("/tournaments");
      setTournaments(data);
    } catch {}
    setLoading(false);
  }

  const filtered = filter === "all"
    ? tournaments
    : tournaments.filter((t) => inferGameType(t) === filter);

  const upcoming = filtered.filter((t) => t.status === "registering");
  const running  = filtered.filter((t) => t.status === "running");
  const finished = filtered.filter((t) => t.status === "finished");

  // Which tabs actually have tournaments?
  const tabsWithData = new Set<GameTypeFilter>(["all"]);
  tournaments.forEach((t) => tabsWithData.add(inferGameType(t)));

  return (
    <div className="min-h-screen bg-transparent">
      {/* Header */}
      <div className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => setLocation("/lobby")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-3xl font-display font-bold text-primary flex items-center gap-3">
            <Trophy className="w-7 h-7 text-yellow-400" /> Tournaments
          </h1>
        </div>

        {/* Game type filter tabs */}
        <div className="max-w-4xl mx-auto px-6 pb-3 flex gap-2 overflow-x-auto">
          {GAME_TYPE_TABS.map((tab) => {
            const hasData = tabsWithData.has(tab.key);
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors
                  ${filter === tab.key
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent"
                  }
                  ${!hasData && tab.key !== "all" ? "opacity-40" : ""}
                `}
              >
                <span>{tab.icon}</span>
                {tab.label}
                {tab.key === "all" && tournaments.filter((t) => t.status !== "finished").length > 0 && (
                  <span className="text-[10px] bg-yellow-500 text-black rounded-full w-4 h-4 flex items-center justify-center font-bold leading-none">
                    {tournaments.filter((t) => t.status !== "finished").length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
        {loading && (
          <div className="text-center py-16 text-muted-foreground">Loading tournaments...</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <Trophy className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">
              {filter === "all" ? "No tournaments scheduled right now." : `No ${filter} tournaments right now.`}
            </p>
            <p className="text-sm text-muted-foreground/60 mt-1">Check back soon</p>
          </div>
        )}

        {/* Active / In Progress */}
        {running.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" />
              In Progress
            </h2>
            <div className="space-y-4">
              {running.map((t) => (
                <TournamentCard key={t.id} tournament={t} onOpen={() => setLocation(`/tournament/${t.id}`)} />
              ))}
            </div>
          </section>
        )}

        {/* Registration Open */}
        {upcoming.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              Open Registration
            </h2>
            <div className="space-y-4">
              {upcoming.map((t) => (
                <TournamentCard key={t.id} tournament={t} onOpen={() => setLocation(`/tournament/${t.id}`)} />
              ))}
            </div>
          </section>
        )}

        {/* Finished */}
        {finished.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Completed</h2>
            <div className="space-y-3">
              {finished.map((t) => (
                <TournamentCard key={t.id} tournament={t} onOpen={() => setLocation(`/tournament/${t.id}`)} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const GAME_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  poker:     { label: "Poker",     icon: "♠️", color: "bg-blue-900 text-blue-400" },
  blackjack: { label: "Blackjack", icon: "🃏", color: "bg-green-900 text-green-400" },
  slots:     { label: "Slots",     icon: "🎰", color: "bg-purple-900 text-purple-400" },
  mixed:     { label: "Mixed",     icon: "🏆", color: "bg-amber-900 text-amber-400" },
};

function useCountdown(endTime?: string | null) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!endTime) { setRemaining(null); return; }
    const tick = () => setRemaining(Math.max(0, new Date(endTime).getTime() - Date.now()));
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [endTime]);
  return remaining;
}

function formatCountdown(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function TournamentCard({ tournament: t, onOpen, compact }: { tournament: Tournament; onOpen: () => void; compact?: boolean }) {
  const { playerId } = useStore();
  const remaining = useCountdown(t.type === "slots" && t.status === "running" ? t.endTime : null);

  const statusColor = {
    registering: "bg-green-900 text-green-400",
    running: "bg-yellow-900 text-yellow-400",
    finished: "bg-muted text-muted-foreground",
  }[t.status];

  const statusLabel = {
    registering: "Open",
    running: "Live",
    finished: "Finished",
  }[t.status];

  const myEntry = t.entries?.find((e: any) => e.playerId === playerId);
  const activeCount = t.entries?.filter((e: any) => e.status === "active").length ?? 0;
  const registeredCount = t.registeredCount ?? 0;
  const sponsorFunding = t.basePrizePool > 0;

  const gameTypeKey = inferGameType(t);
  const gameTypeMeta = GAME_TYPE_LABELS[gameTypeKey] ?? GAME_TYPE_LABELS.mixed;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-2xl overflow-hidden"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display font-bold text-foreground text-lg">{t.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>{statusLabel}</span>
              {/* Game type badge */}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${gameTypeMeta.color}`}>
                <span>{gameTypeMeta.icon}</span> {gameTypeMeta.label}
              </span>
              {myEntry && myEntry.status === "registered" && (
                <span className="text-xs bg-blue-900 text-blue-400 px-2 py-0.5 rounded-full">Registered</span>
              )}
              {myEntry && myEntry.status === "active" && (
                <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">Playing</span>
              )}
            </div>
            {t.description && !compact && (
              <div
                className="rte-display text-sm text-muted-foreground mt-1"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t.description) }}
              />
            )}
            <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Coins className="w-3.5 h-3.5" />
                {t.buyIn.toLocaleString()} buy-in
              </span>
              <span className="flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                <span className="text-yellow-400">{t.prizePool.toLocaleString()}</span> prize pool
                {sponsorFunding && <span className="text-xs text-yellow-500">(sponsored)</span>}
              </span>
              {t.type === "slots" && t.status === "running" && remaining !== null && (
                <span className={`flex items-center gap-1 font-mono font-semibold ${remaining < 300_000 ? "text-red-400" : remaining < 600_000 ? "text-yellow-400" : "text-emerald-400"}`}>
                  <Clock className="w-3.5 h-3.5" />
                  {remaining > 0 ? formatCountdown(remaining) : "Time up!"}
                </span>
              )}
              {t.type === "slots" ? (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Bet {t.minBet?.toLocaleString()}–{t.maxBet?.toLocaleString() ?? "∞"}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {t.smallBlind}/{t.bigBlind} blinds
                </span>
              )}
              {t.status === "running" ? (
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {activeCount} remaining
                  {(t.tables ?? []).length > 1 && (
                    <span className="flex items-center gap-1 text-xs">
                      · <LayoutGrid className="w-3 h-3" /> {t.tables.length} tables
                    </span>
                  )}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {registeredCount}/{t.maxPlayers}
                </span>
              )}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onOpen} className="shrink-0">
            {t.status === "registering"
              ? "View & Register"
              : t.status === "running"
                ? t.type === "slots"
                  ? myEntry?.status === "active" ? "Resume Spinning" : "Join Now"
                  : myEntry?.status === "active" ? "Go to Table" : "Watch"
                : "Results"}
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>

        {/* Winner banner */}
        {t.status === "finished" && t.winnerName && (
          <div className="mt-3 flex items-center gap-2 bg-yellow-950 border border-yellow-800 rounded-lg px-3 py-2">
            <Medal className="w-4 h-4 text-yellow-400" />
            <span className="text-yellow-400 font-semibold text-sm">Winner: {t.winnerName}</span>
            <span className="text-muted-foreground text-xs ml-auto">{t.prizePool.toLocaleString()} chips</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
