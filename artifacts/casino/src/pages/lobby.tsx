import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import {
  Coins, User, Users, LogOut, Menu, Clock, Search,
  Home, Spade, CircleDot, Trophy, Gift, Crown, Zap, Gamepad2, Flag,
  Star, Target, BarChart2, ShoppingBag, Volume2, VolumeX,
  TrendingUp, Package, Gavel, History, ArrowLeftRight,
  Tag, Settings, ListOrdered, Store, AlertTriangle, Activity, Layers,
} from "lucide-react";
import { TableGamesPage }    from "./TableGamesPage";
import { MiniGamesPage }     from "./MiniGamesPage";
import { SlotsPage }         from "./SlotsPage";
import { PokerPage }         from "./PokerPage";
import { TournamentsPage }   from "./TournamentsPage";
import { LotteryPage }       from "./LotteryPage";
import { BingoPage }         from "./BingoPage";
import { RewardsPage }       from "./RewardsPage";
import { ChallengesPage }    from "./ChallengesPage";
import { LeaderboardsPage }  from "./LeaderboardsPage";
import { MarketplacePage }   from "./MarketplacePage";
import { ProfilePage }       from "./ProfilePage";
import { StaffPage }         from "./StaffPage";
import { MktHomePage }       from "./MktHomePage";
import { useGetPlayer }      from "@workspace/api-client-react";
import { usePlayerSocket }   from "../lib/usePlayerSocket";
import { setAccessToken }    from "../lib/gamePasswordGuard";
import { ActiveChipsDisplay } from "../components/ActiveChipsDisplay";
import { MktTrendingPage }   from "./MktTrendingPage";
import { MktInventoryPage }  from "./MktInventoryPage";
import { MktAuctionsPage }   from "./MktAuctionsPage";
import { MktRecentSalesPage } from "./MktRecentSalesPage";
import { MktTradingPage }    from "./MktTradingPage";
import { MktProfilePage }    from "./MktProfilePage";
import { MktShopsPage }      from "./MktShopsPage";
import { MktShopBuilderPage } from "./MktShopBuilderPage";
import { MaintenanceOverlay } from "./MaintenanceOverlay";
import { SportsbookPage }    from "./SportsbookPage";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";

const IMGS = import.meta.env.BASE_URL;

/* ─── Nav ─────────────────────────────────────────────────────── */
type NavItem  = { id: string; label: string; icon: React.ElementType; expandable?: boolean; route?: string; staffOnly?: boolean; disabled?: boolean; tokenId?: string };
type NavGroup = { section?: string; items: NavItem[] };

const marketNavGroups: NavGroup[] = [
  { items: [{ id: "mkt-home", label: "Home", icon: Home }] },
  {
    section: "Seller Dashboard",
    items: [
      { id: "mkt-item-listings",  label: "Item Listings",  icon: Tag           },
      { id: "mkt-trades",         label: "Trades",         icon: ArrowLeftRight },
      { id: "mkt-sales-history",  label: "Sales History",  icon: ListOrdered   },
      { id: "mkt-stall-settings", label: "Stall Settings", icon: Settings      },
    ],
  },
  {
    section: "Marketplace",
    items: [
      { id: "mkt-trending",  label: "Trending",  icon: TrendingUp },
      { id: "mkt-shops",     label: "Shops",     icon: Store      },
      { id: "mkt-inventory", label: "Inventory", icon: Package    },
    ],
  },
  {
    section: "Account",
    items: [
      { id: "mkt-profile", label: "Profile", icon: User  },
      { id: "staff", label: "Staff", icon: Crown, route: "/banker", staffOnly: true },
    ],
  },
];

const navGroups: NavGroup[] = [
  { items: [{ id: "home", label: "Home", icon: Home, route: "/lobby" }] },
  {
    section: "Casino",
    items: [
      { id: "table-games", label: "Table Games", icon: CircleDot, route: "/tablegames"    },
      { id: "mini-games",  label: "Mini Games",  icon: Gamepad2,  route: "/minigames" },
      { id: "slots",       label: "Slots",       icon: Layers,    route: "/slots" },
      { id: "poker",       label: "Poker",       icon: Spade,     route: "/poker-tables" },
      { id: "sportsbook",  label: "Sportsbook",  icon: Activity,  route: "/sportsbook"  },
    ],
  },
  {
    section: "Events",
    items: [
      { id: "tournaments",   label: "Tournaments",  icon: Trophy, route: "/tournaments" },
      { id: "horse-racing", label: "Horse Racing", icon: Flag,  route: "/horse-racing"   },
      { id: "lottery",      label: "Lottery",      icon: Zap,   route: "/lottery"        },
      { id: "bingo",        label: "Bingo",         icon: Gift,  route: "/bingo"          },
    ],
  },
  {
    section: "The Hub",
    items: [
      { id: "rewards",      label: "Rewards",      icon: Star    },
      { id: "challenges",   label: "Challenges",   icon: Target     },
      { id: "leaderboards", label: "Leaderboards", icon: BarChart2  },
    ],
  },
  {
    section: "Account",
    items: [
      { id: "profile", label: "Profile", icon: User,  route: "/profile" },
      { id: "staff", label: "Staff", icon: Crown, route: "/banker", staffOnly: true },
    ],
  },
];

/* ─── Data ────────────────────────────────────────────────────── */
interface Game {
  id: number; name: string; category: string; image: string;
  players: number; maxPlayers: number; activeBets: string; status: string;
}
type RecentGame = Game & { lastPlayed: string; result: string; won: boolean };

const recentlyPlayed: RecentGame[] = [
  { id: 101, name: "Blackjack",    category: "TABLE GAMES", image: `${IMGS}images/table-games.png`, players: 4,  maxPlayers: 6,  activeBets: "$340",  status: "Completed", lastPlayed: "12 min ago", result: "+$220", won: true  },
  { id: 102, name: "Lucky Slots",  category: "MINI GAMES",  image: `${IMGS}images/mini-games.png`,  players: 6,  maxPlayers: 10, activeBets: "$120",  status: "Completed", lastPlayed: "34 min ago", result: "-$80",  won: false },
  { id: 103, name: "Roulette",     category: "TABLE GAMES", image: `${IMGS}images/table-games.png`, players: 5,  maxPlayers: 8,  activeBets: "$500",  status: "Completed", lastPlayed: "1 hr ago",   result: "+$650", won: true  },
  { id: 104, name: "Horse Racing", category: "LIVE EVENTS", image: `${IMGS}images/live-events.png`, players: 9,  maxPlayers: 20, activeBets: "$200",  status: "Completed", lastPlayed: "2 hr ago",   result: "-$200", won: false },
];

const allLiveGames: Game[] = [
  { id: 1, name: "Blackjack",    category: "TABLE GAMES", image: `${IMGS}images/table-games.png`, players: 4,  maxPlayers: 6,  activeBets: "$2,340",  status: "In Progress" },
  { id: 2, name: "Roulette",     category: "TABLE GAMES", image: `${IMGS}images/table-games.png`, players: 7,  maxPlayers: 8,  activeBets: "$5,120",  status: "In Progress" },
  { id: 3, name: "Lucky Slots",  category: "MINI GAMES",  image: `${IMGS}images/mini-games.png`,  players: 3,  maxPlayers: 10, activeBets: "$870",    status: "Active"      },
  { id: 4, name: "Poker Night",  category: "TABLE GAMES", image: `${IMGS}images/table-games.png`, players: 5,  maxPlayers: 6,  activeBets: "$8,900",  status: "In Progress" },
  { id: 5, name: "Neon Slots",   category: "MINI GAMES",  image: `${IMGS}images/mini-games.png`,  players: 6,  maxPlayers: 10, activeBets: "$1,450",  status: "Active"      },
  { id: 6, name: "Horse Racing", category: "LIVE EVENTS", image: `${IMGS}images/live-events.png`, players: 12, maxPlayers: 20, activeBets: "$14,200", status: "Race Live"   },
];

function parseBets(s: string) { return parseInt(s.replace(/[$,]/g, ""), 10) || 0; }
const liveGames = [...allLiveGames]
  .sort((a, b) => b.players - a.players || parseBets(b.activeBets) - parseBets(a.activeBets))
  .slice(0, 4);

/* lobby demo cards → real game registry keys (launched via the gated useGameLauncher) */
const NAME_TO_GAME: Record<string, string> = {
  "Blackjack": "blackjack", "Roulette": "roulette", "Lucky Slots": "slots",
  "Neon Slots": "slots", "Poker Night": "poker", "Horse Racing": "horse",
};

/* ─── Neon colors ─────────────────────────────────────────────── */
const RECENT_NEON   = ["neon-green", "neon-red", "neon-pink", "neon-orange"] as const;
const LIVE_NEON     = ["neon-orange", "neon-blue", "neon-yellow", "neon-teal"] as const;
const PULSE_DELAYS  = ["0s", "-1s", "-2s", "-3s"];

/* ─── Status pill ─────────────────────────────────────────────── */
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  "In Progress":  { label: "IN PROGRESS", color: "#06b6d4", bg: "rgba(6,182,212,0.15)"   },
  "Betting Open": { label: "BETTING",     color: "#22c55e", bg: "rgba(34,197,94,0.15)"   },
  "Active":       { label: "ACTIVE",      color: "#f97316", bg: "rgba(249,115,22,0.15)"  },
  "Race Live":    { label: "LIVE",        color: "#ef4444", bg: "rgba(239,68,68,0.18)"   },
  "Completed":    { label: "DONE",        color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS["Completed"];
  const isLive = status === "Race Live";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.color}55` }}
    >
      {isLive && (
        <span className="w-1.5 h-1.5 rounded-full inline-block animate-pulse" style={{ background: s.color, boxShadow: `0 0 5px ${s.color}` }} />
      )}
      {s.label}
    </span>
  );
}

function PlayerDots({ count }: { count: number }) {
  const show = Math.min(count, 4);
  return (
    <div className="flex -space-x-1.5">
      {Array.from({ length: show }).map((_, i) => (
        <div key={i} className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-black"
          style={{ background: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.7)", zIndex: show - i }}>
          {String.fromCharCode(65 + i)}
        </div>
      ))}
      {count > 4 && (
        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-black"
          style={{ background: "#1f1f1f", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", zIndex: 0 }}>
          +{count - 4}
        </div>
      )}
    </div>
  );
}

/* ─── Recently Played Card ────────────────────────────────────── */
function RecentCard({ game, neonClass, delay, onPlay }: { game: RecentGame; neonClass: string; delay: string; onPlay: () => void }) {
  const won = game.won;
  const accentColor = won ? "#22c55e" : "#ef4444";
  const pillLabel   = won ? "WON" : "LOST";
  const pillBg      = won ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${neonClass}`}
      style={{ width: "220px", background: "rgba(10,7,7,0.92)", animationDelay: delay }}
    >
      <div className="relative h-32 overflow-hidden">
        <img src={game.image} alt={game.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,5,5,0.95) 0%, rgba(8,5,5,0.3) 60%, transparent 100%)" }} />
        <div className="absolute top-2.5 left-2.5">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ background: "rgba(0,0,0,0.75)", color: "rgba(255,255,255,0.62)", border: "1px solid rgba(255,255,255,0.14)" }}>
            {game.category}
          </span>
        </div>
        <div className="absolute top-2.5 right-2.5">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest"
            style={{ color: accentColor, background: pillBg, border: `1px solid ${accentColor}55` }}>
            {pillLabel}
          </span>
        </div>
      </div>
      <div className="px-4 py-3">
        <h3 className="font-rajdhani text-white text-base font-black uppercase tracking-wide mb-2 leading-tight">{game.name}</h3>
        <div className="flex items-center justify-between mb-3">
          <PlayerDots count={game.players} />
          <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.52)" }}>{game.players}/{game.maxPlayers}</span>
        </div>
        <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.42)" }}>
              <Clock size={9} /> {game.lastPlayed}
            </p>
            <p className="text-xl font-black" style={{ color: accentColor, textShadow: `0 0 8px ${accentColor}55` }}>{game.result}</p>
          </div>
          <button
            onClick={onPlay}
            className="text-xs font-bold uppercase tracking-wide px-3.5 py-2 rounded-lg transition-all duration-200"
            style={{ color: "rgba(255,255,255,0.65)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)" }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = "#fff"; b.style.borderColor = "rgba(255,255,255,0.38)"; b.style.background = "rgba(255,255,255,0.12)"; b.style.boxShadow = "0 0 10px rgba(255,255,255,0.1)"; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = "rgba(255,255,255,0.65)"; b.style.borderColor = "rgba(255,255,255,0.18)"; b.style.background = "rgba(255,255,255,0.06)"; b.style.boxShadow = "none"; }}
          >
            Play Again
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Live Activity Card ──────────────────────────────────────── */
function LiveCard({ game, neonClass, delay, onPlay }: { game: Game; neonClass: string; delay: string; onPlay: () => void }) {
  const s = STATUS[game.status] ?? STATUS["Active"];
  const isRaceLive = game.status === "Race Live";

  return (
    <div
      className={`rounded-2xl overflow-hidden group neon-card ${neonClass}`}
      style={{ width: "220px", background: "rgba(10,7,7,0.92)", animationDelay: delay }}
    >
      <div className="relative h-32 overflow-hidden">
        <img src={game.image} alt={game.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(8,5,5,0.95) 0%, rgba(8,5,5,0.2) 60%, transparent 100%)" }} />
        {isRaceLive && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.45)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#ef4444", boxShadow: "0 0 6px #ef4444" }} />
            <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#ef4444" }}>Live</span>
          </div>
        )}
        {!isRaceLive && (
          <div className="absolute top-2.5 left-2.5">
            <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider" style={{ background: "rgba(0,0,0,0.75)", color: "rgba(255,255,255,0.62)", border: "1px solid rgba(255,255,255,0.14)" }}>
              {game.category}
            </span>
          </div>
        )}
        <div className="absolute top-2.5 right-2.5">
          <StatusPill status={game.status} />
        </div>
      </div>
      <div className="px-4 py-3">
        <h3 className="font-rajdhani text-white text-base font-black uppercase tracking-wide mb-2 leading-tight">{game.name}</h3>
        <div className="flex items-center justify-between mb-3">
          <PlayerDots count={game.players} />
          <div className="flex items-center gap-1" style={{ color: "rgba(255,255,255,0.52)" }}>
            <Users size={10} />
            <span className="text-[11px] font-medium">{game.players}/{game.maxPlayers}</span>
          </div>
        </div>
        <div className="flex items-center justify-between pt-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.42)" }}>Active Bets</p>
            <p className="text-lg font-black" style={{ color: "#f5c518", textShadow: "0 0 8px rgba(245,197,24,0.35)" }}>{game.activeBets}</p>
          </div>
          <button
            onClick={onPlay}
            className="text-xs font-black uppercase tracking-wider px-4 py-2 rounded-lg transition-all duration-200"
            style={{ color: "#e8400a", background: "rgba(232,64,10,0.1)", border: "1px solid rgba(232,64,10,0.45)" }}
            onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "linear-gradient(135deg,#e8400a,#c43209)"; b.style.color = "#fff"; b.style.boxShadow = "0 0 18px rgba(232,64,10,0.55)"; b.style.borderColor = "#e8400a"; }}
            onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "rgba(232,64,10,0.1)"; b.style.color = "#e8400a"; b.style.boxShadow = "none"; b.style.borderColor = "rgba(232,64,10,0.45)"; }}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Section header ──────────────────────────────────────────── */
function SectionHeader({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <div className="flex items-center w-full mb-8">
      <div className="divider-line dl-left" style={{ "--d-c": dotColor } as React.CSSProperties} />
      <span className="divider-dot" style={{ background: dotColor, boxShadow: `0 0 8px 3px ${dotColor}99` }} />
      <h2 className="section-title shrink-0 mx-4">{label}</h2>
      <span className="divider-dot" style={{ background: dotColor, boxShadow: `0 0 8px 3px ${dotColor}99` }} />
      <div className="divider-line dl-right" style={{ "--d-c": dotColor } as React.CSSProperties} />
    </div>
  );
}

/* ─── Lobby ───────────────────────────────────────────────────── */
export function Lobby() {
  const { playerUsername, logoutPlayer, playerStaffRoles, playerId, sessionToken } = useStore();
  const [location, setLocation] = useLocation();
  const { enter, modalNode } = useGameLauncher();
  const isStaff = (playerStaffRoles?.length ?? 0) > 0;

  const [collapsed,   setCollapsed]   = useState(false);
  const [activeNav,   setActiveNav]   = useState("home");
  const [hoveredNav,  setHoveredNav]  = useState<string | null>(null);
  const [volume,      setVolume]      = useState(75);
  const [muted,       setMuted]       = useState(false);
  const [appMode,     setAppMode]     = useState<"casino" | "marketplace">("casino");

  const { data: currentPlayer } = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips }   = usePlayerSocket(playerId ?? null, sessionToken);
  const chips = liveChips ?? currentPlayer?.chips ?? 0;

  const displayName  = playerUsername ?? "Player";
  const initials     = displayName.charAt(0).toUpperCase();

  const maintenanceMode     = false;
  const maintenanceRedirect = "casino" as const;

  const [mntToast,   setMntToast]   = useState<string | null>(null);
  const [mntExiting, setMntExiting] = useState(false);

  useEffect(() => {
    const routeToNav: Record<string, string> = {
      "/lobby":         "home",
      "/tablegames":    "table-games",
      "/sportsbook":    "sportsbook",
      "/minigames":     "mini-games",
      "/tournaments":   "tournaments",
      "/lottery":       "lottery",
      "/poker-tables":  "poker",
      "/slots":         "slots",
      "/horse-racing":  "horse-racing",
    };
    const mapped = routeToNav[location];
    if (mapped) setActiveNav(mapped);
  }, [location]);

  function handleMaintenanceRedirect() {
    if (mntExiting) return;
    setMntExiting(true);
    setMntToast("Marketplace is currently under maintenance. Redirecting to Casino...");
    setTimeout(() => {
      setAppMode(maintenanceRedirect);
      setActiveNav("home");
      setMntToast(null);
      setMntExiting(false);
    }, 900);
  }

  function navigate(navId: string) {
    if (maintenanceMode && navId.startsWith("mkt-")) {
      handleMaintenanceRedirect();
      return;
    }
    setActiveNav(navId);
  }

  function switchMode(mode: "casino" | "marketplace") {
    if (mode === "marketplace" && maintenanceMode) {
      handleMaintenanceRedirect();
      return;
    }
    setAppMode(mode);
    setActiveNav(mode === "casino" ? "home" : "mkt-home");
  }

  function handleLogout() {
    logoutPlayer();
    setLocation("/");
  }

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-sans" style={{ background: "#050303" }}>

      {/* ── Top nav (responsive) ── */}
      <nav
        className="shrink-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 lg:flex-nowrap lg:gap-x-0 lg:py-0 lg:h-[52px]"
        style={{
          background: "rgba(5,3,3,0.97)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(232,64,10,0.1)",
          boxSizing: "border-box",
        }}
      >
        {/* LEFT — hamburger + brand + volume */}
        <div className="flex items-center gap-2 shrink-0 order-1">
          <button onClick={() => setCollapsed(c => !c)} className="nav-icon-btn">
            <Menu size={17} style={{ color: "rgba(255,255,255,0.48)" }} />
          </button>
          <div className="w-px h-5 shrink-0 hidden sm:block" style={{ background: "rgba(255,255,255,0.09)" }} />
          <h1 className="font-rajdhani font-black tracking-[0.15em] uppercase shrink-0"
            style={{ color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", fontSize: "clamp(13px, 1vw, 15px)" }}>
            {appMode === "casino"
              ? <>Big House <span style={{ color: "#e8400a", textShadow: "0 0 14px rgba(232,64,10,0.75)" }}>Casino</span></>
              : <>Big House <span style={{ color: "#f5c518", textShadow: "0 0 14px rgba(245,197,24,0.65)" }}>Market</span></>
            }
          </h1>
          {/* Volume — hidden on mobile */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            <div className="w-px h-5 shrink-0" style={{ background: "rgba(255,255,255,0.09)" }} />
            <button className="nav-icon-btn shrink-0" onClick={() => setMuted(m => !m)}>
              {muted
                ? <VolumeX size={14} style={{ color: "rgba(255,255,255,0.3)" }} />
                : <Volume2 size={14} style={{ color: "rgba(255,255,255,0.5)" }} />}
            </button>
            <input
              type="range" min={0} max={100}
              value={muted ? 0 : volume}
              onChange={e => { setVolume(Number(e.target.value)); setMuted(false); }}
              className="nav-volume-slider"
              style={{ "--vol-pct": `${muted ? 0 : volume}%`, display: "block" } as React.CSSProperties}
            />
          </div>
          <div className="w-px h-5 shrink-0 hidden lg:block" style={{ background: "rgba(255,255,255,0.09)" }} />
        </div>

        {/* MODE TOGGLE — inline on desktop/tablet, own row on mobile */}
        <div className="mode-switcher shrink-0 order-4 md:order-2 lg:mx-2">
          <button className={`mode-tab${appMode === "casino" ? " active" : ""}`} onClick={() => switchMode("casino")}>Casino</button>
          <button className={`mode-tab${appMode === "marketplace" ? " active" : ""}`} onClick={() => switchMode("marketplace")}>Market</button>
        </div>

        {/* SEARCH — centered & flex-1 on desktop, full row on tablet/mobile */}
        <div className="w-full order-3 md:order-4 lg:order-3 lg:w-auto lg:flex-1 lg:px-4">
          <div className="header-search lg:max-w-[350px] lg:mx-auto">
            <Search size={15} style={{ color: "#a855f7", flexShrink: 0 }} />
            <input type="text" placeholder={appMode === "casino" ? "Search games, events, players..." : "Search listings, sellers, categories..."} />
          </div>
        </div>

        {/* RIGHT — rank · chips · profile · logout (Git pill design) */}
        <div className="flex items-center shrink-0 ml-auto order-2 md:order-3 lg:order-4 lg:pr-1" style={{ gap: 12 }}>
          {/* Rank pill — hidden on mobile */}
          <div className="nav-pill nav-pill-rank hidden md:flex">
            <Star size={12} style={{ color: "#9ca3af", fill: "#9ca3af", flexShrink: 0 }} />
            <div className="flex flex-col leading-none gap-[5px]">
              <span className="text-[11px] font-black uppercase tracking-wide leading-none" style={{ color: "#c4cdd8" }}>Silver II</span>
              <div className="flex items-center gap-1.5">
                <div className="nav-rank-bar">
                  <div className="nav-rank-fill" style={{ width: "68%" }} />
                </div>
                <span className="text-[8px] font-bold tracking-wide leading-none" style={{ color: "rgba(245,197,24,0.65)" }}>68% TO GOLD</span>
              </div>
            </div>
          </div>

          {/* Wallet / Chips pill */}
          <ActiveChipsDisplay chips={chips} label={appMode === "marketplace" ? "Wallet" : "Chips"} />

          {/* Profile chip — avatar always, name/role hidden on mobile */}
          <div className="nav-user-chip">
            <div
              className="w-[28px] h-[28px] rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
              style={{ background: "linear-gradient(135deg,#e8400a,#b83008)", color: "#fff", boxShadow: "0 0 12px rgba(232,64,10,0.5)" }}
            >{initials}</div>
            <div className="hidden sm:flex flex-col leading-none gap-[3px] min-w-0">
              <span className="text-[11px] font-semibold truncate max-w-[140px]" style={{ color: "rgba(255,255,255,0.9)" }}>{displayName}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "#e8400a" }}>Member</span>
            </div>
          </div>

          {/* Logout — standalone icon button */}
          <button
            className="nav-icon-btn shrink-0"
            title="Log out"
            onClick={handleLogout}
            style={{ padding: "6px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }}
          >
            <LogOut size={13} style={{ color: "rgba(255,255,255,0.35)" }} />
          </button>
        </div>
      </nav>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ── */}
        <aside
          className="shrink-0 flex flex-col overflow-x-hidden transition-[width] duration-300 ease-in-out z-10"
          style={{ width: collapsed ? "52px" : "170px", background: "#060404", borderRight: "1px solid rgba(255,255,255,0.07)" }}
        >
          <nav className="flex flex-col py-3 overflow-y-auto overflow-x-hidden flex-1">
            {(appMode === "casino" ? navGroups : marketNavGroups).map((group, gi) => (
              <div key={gi}>
                {group.section && !collapsed && (
                  <p
                    className="px-4 pt-4 pb-1.5 text-[10px] font-bold uppercase tracking-widest select-none"
                    style={{ color: "rgba(255,255,255,0.22)", letterSpacing: "0.12em" }}
                  >
                    {group.section}
                  </p>
                )}
                {group.section && collapsed && gi > 0 && (
                  <div className="mx-3 my-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />
                )}
                {group.items.filter(item => !item.staffOnly || isStaff).map((item) => {
                  const active  = item.route ? location === item.route : item.id === activeNav;
                  const hovered = item.id === hoveredNav;
                  const lit     = active || hovered;
                  const Icon    = item.icon;
                  return (
                    <div key={item.id} className="relative group/nav px-2">
                      <button
                        onClick={item.disabled ? undefined : () => { if (item.tokenId) setAccessToken(item.tokenId, "open"); item.route ? setLocation(item.route) : navigate(item.id); }}
                        onMouseEnter={() => setHoveredNav(item.id)}
                        onMouseLeave={() => setHoveredNav(null)}
                        className="relative w-full flex items-center rounded-lg py-[7px] transition-colors duration-150"
                        style={{
                          gap: collapsed ? 0 : 10,
                          paddingLeft: collapsed ? 0 : 10,
                          justifyContent: collapsed ? "center" : "flex-start",
                          background: active
                            ? "rgba(232,64,10,0.12)"
                            : hovered ? "rgba(232,64,10,0.07)" : undefined,
                        }}
                      >
                        {active && !collapsed && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[16px] rounded-r-full"
                            style={{ background: "#e8400a", boxShadow: "0 0 6px #e8400a" }}
                          />
                        )}
                        <Icon
                          size={16}
                          style={{
                            flexShrink: 0,
                            color: lit ? "#e8400a" : "rgba(255,255,255,0.35)",
                            transition: "color 0.15s",
                          }}
                        />
                        {!collapsed && (
                          <span
                            className="flex-1 text-left text-[13px] whitespace-nowrap overflow-hidden"
                            style={{
                              fontWeight: active ? 600 : 500,
                              color: active
                                ? "#ffffff"
                                : hovered ? "rgba(232,64,10,0.95)" : "rgba(255,255,255,0.50)",
                              transition: "color 0.15s",
                            }}
                          >
                            {item.label}
                          </span>
                        )}
                      </button>
                      {collapsed && (
                        <div
                          className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap opacity-0 group-hover/nav:opacity-100 transition-opacity duration-150 z-50"
                          style={{ background: "#1c1c1c", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 4px 14px rgba(0,0,0,0.5)" }}
                        >
                          {item.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </nav>

        </aside>

        {/* ── Main ── */}
        <main className="flex-1 overflow-y-auto relative" style={{ background: "#060404" }}>
          {activeNav === "home" && (
            <>
              <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                <div className="absolute top-0 left-1/4 w-[600px] h-[300px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(ellipse, #a855f7 0%, transparent 70%)", filter: "blur(40px)" }} />
                <div className="absolute top-[55%] left-1/3 w-[700px] h-[300px] rounded-full opacity-[0.04]" style={{ background: "radial-gradient(ellipse, #e8400a 0%, transparent 70%)", filter: "blur(50px)" }} />
              </div>
              <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 pt-8 pb-12 flex flex-col gap-8">
                <section>
                  <SectionHeader label="Recently Played" dotColor="#d946ef" />
                  <div className="flex flex-wrap justify-center gap-5">
                    {recentlyPlayed.map((g, i) => (
                      <RecentCard key={g.id} game={g} neonClass={RECENT_NEON[i]} delay={PULSE_DELAYS[i]}
                        onPlay={() => { const def = GAMES[NAME_TO_GAME[g.name]]; if (def) enter(def); }} />
                    ))}
                  </div>
                </section>
                <section>
                  <SectionHeader label="Live Activity" dotColor="#22c55e" />
                  <div className="flex flex-wrap justify-center gap-5">
                    {liveGames.map((g, i) => (
                      <LiveCard key={g.id} game={g} neonClass={LIVE_NEON[i]} delay={PULSE_DELAYS[i]}
                        onPlay={() => { const def = GAMES[NAME_TO_GAME[g.name]]; if (def) enter(def); }} />
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}
          {activeNav === "table-games"   && <TableGamesPage />}
          {activeNav === "mini-games"    && <MiniGamesPage />}
          {activeNav === "slots"         && <SlotsPage />}
          {activeNav === "poker"         && <PokerPage />}
          {activeNav === "sportsbook"    && <SportsbookPage />}
          {activeNav === "tournaments"   && <TournamentsPage />}
          {activeNav === "lottery"       && <LotteryPage />}
          {activeNav === "bingo"         && <BingoPage />}
          {activeNav === "rewards"       && <RewardsPage />}
          {activeNav === "challenges"    && <ChallengesPage />}
          {activeNav === "leaderboards"  && <LeaderboardsPage />}
          {activeNav === "marketplace"   && <MarketplacePage />}
          {activeNav === "profile"       && <ProfilePage />}
          {activeNav === "staff"         && <StaffPage />}
          {activeNav === "mkt-home"      && <MktHomePage />}
          {activeNav === "mkt-trending"  && <MktTrendingPage />}
          {activeNav === "mkt-inventory" && <MktInventoryPage />}
          {activeNav === "mkt-auctions"  && <MktAuctionsPage />}
          {activeNav === "mkt-sales"     && <MktRecentSalesPage />}
          {activeNav === "mkt-trading"   && <MktTradingPage />}
          {activeNav === "mkt-profile"        && <MktProfilePage />}
          {activeNav === "mkt-shops"          && <MktShopsPage />}
          {activeNav === "mkt-stall-settings" && <MktShopBuilderPage onDeleted={() => setActiveNav("mkt-shops")} />}
        </main>
      </div>

      {modalNode}

      {/* Maintenance toast */}
      {mntToast && (
        <div
          className="fixed bottom-8 left-1/2 z-[300] flex items-center gap-3 px-5 py-3 rounded-xl text-[12px] font-bold uppercase tracking-wide"
          style={{
            transform:    "translateX(-50%)",
            background:   "rgba(245,197,24,0.12)",
            border:       "1px solid rgba(245,197,24,0.35)",
            color:        "#f5c518",
            boxShadow:    "0 0 28px rgba(245,197,24,0.22)",
            animation:    "mnt-fadein 0.25s ease both",
            whiteSpace:   "nowrap",
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          {mntToast}
        </div>
      )}

      {appMode === "marketplace" && maintenanceMode && (
        <MaintenanceOverlay
          onBackdropClick={handleMaintenanceRedirect}
          fading={mntExiting}
        />
      )}
    </div>
  );
}

export default Lobby;
