import { useState, useEffect, useRef } from "react";
import { CatalogCard, CatalogGame, CardGrid } from "./shared";
import { useLocation } from "wouter";
import { useStore } from "../store";
import {
  Coins, User, Users, LogOut, Menu, Clock, Search,
  Home, Spade, CircleDot, Trophy, Gift, Crown, Zap, Gamepad2, Flag,
  Star, Target, BarChart2, ShoppingBag, Volume2, VolumeX,
  TrendingUp, Package, Gavel, History, ArrowLeftRight,
  Tag, Settings, ListOrdered, Store, AlertTriangle, Activity, Layers,
} from "lucide-react";
import { getRewardsState, subscribeRewards, getSubRank } from "../lib/rewardsState";
import { TableGamesPage } from "./TableGamesPage";
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
import { AvatarImg }         from "../components/AvatarUpload";
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
import { MktComingSoon }      from "./MktComingSoon";
import { MaintenanceOverlay } from "./MaintenanceOverlay";
import { SportsbookPage }    from "./SportsbookPage";
import { useGameLauncher, GAMES } from "../lib/gameLauncher";
import { GAME_CFG, GAME_DISPLAY } from "../lib/gamesData";
import { getRecentlyPlayed, RecentlyPlayedEntry } from "../lib/recentlyPlayed";

const IMGS = import.meta.env.BASE_URL;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Nav ─────────────────────────────────────────────────────── */
type NavItem  = { id: string; label: string; icon: React.ElementType; expandable?: boolean; route?: string; staffOnly?: boolean; disabled?: boolean; tokenId?: string };
type NavGroup = { section?: string; items: NavItem[] };

const marketNavGroups: NavGroup[] = [
  { items: [{ id: "mkt-home", label: "Home", icon: Home, route: "/market" }] },
  {
    section: "Seller Dashboard",
    items: [
      { id: "mkt-item-listings",  label: "Item Listings",  icon: Tag,            route: "/market/item-listings"  },
      { id: "mkt-trades",         label: "Trades",         icon: ArrowLeftRight,  route: "/market/trades"         },
      { id: "mkt-sales-history",  label: "Sales History",  icon: ListOrdered,     route: "/market/sales-history"  },
      { id: "mkt-stall-settings", label: "Stall Settings", icon: Settings,        route: "/market/stall-settings" },
    ],
  },
  {
    section: "Marketplace",
    items: [
      { id: "mkt-trending",  label: "Trending",  icon: TrendingUp, route: "/market/trending"  },
      { id: "mkt-shops",     label: "Shops",     icon: Store,      route: "/market/shops"     },
      { id: "mkt-inventory", label: "Inventory", icon: Package,    route: "/market/inventory" },
    ],
  },
  {
    section: "Account",
    items: [
      { id: "mkt-profile", label: "Profile", icon: User,  route: "/market/profile" },
      { id: "staff",       label: "Staff",   icon: Crown, route: "/banker", staffOnly: true },
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
      { id: "horse-racing", label: "Horse Racing", icon: Flag,  route: "/horse-racing", launchKey: "horse" },
      { id: "lottery",      label: "Lottery",      icon: Zap,   route: "/lottery"        },
      { id: "bingo",        label: "Bingo",         icon: Gift,  route: "/bingo"          },
    ],
  },
  {
    section: "The Hub",
    items: [
      { id: "rewards",      label: "Rewards",      icon: Star,   route: "/rewards" },
      { id: "challenges",   label: "Challenges",   icon: Target, route: "/challenges" },
      { id: "leaderboards", label: "Leaderboards", icon: BarChart2, route: "/leaderboards" },
    ],
  },
  {
    section: "Account",
    items: [
      { id: "profile", label: "Profile", icon: User, route: "/profile" },
      { id: "staff", label: "Staff", icon: Crown, route: "/banker", staffOnly: true },
    ],
  },
];

/* ─── Live Activity — server game string → display/nav config ─── */
const ACTIVITY_MAP: Record<string, { cfgKey: string; name: string; route: string; launchKey?: string; tokenId?: string }> = {
  "blackjack":    { cfgKey: "blackjack", name: "Blackjack",       route: "/blackjack",    launchKey: "blackjack" },
  "roulette":     { cfgKey: "roulette",  name: "Roulette",        route: "/roulette",     launchKey: "roulette"  },
  "baccarat":     { cfgKey: "baccarat",  name: "Baccarat",        route: "/baccarat",     launchKey: "baccarat"  },
  "poker":        { cfgKey: "poker",     name: "Poker",           route: "/poker-tables", launchKey: "poker"     },
  "poker-lobby":  { cfgKey: "poker",     name: "Poker",           route: "/poker-tables", launchKey: "poker"     },
  "high-low":     { cfgKey: "highlow",   name: "High Low",        route: "/high-low",     launchKey: "highlow"   },
  "highlow":      { cfgKey: "highlow",   name: "High Low",        route: "/high-low",     launchKey: "highlow"   },
  "slots":        { cfgKey: "slots",     name: "Slots",           route: "/slots",        tokenId: "slots"       },
  "fortuna":      { cfgKey: "slots",     name: "Fortuna",         route: "/rome-slots",   tokenId: "slots"       },
  "rome-slots":   { cfgKey: "slots",     name: "Fortuna",         route: "/rome-slots",   tokenId: "slots"       },
  "western-slots":{ cfgKey: "slots",     name: "Deadwood Dollars",route: "/western-slots",tokenId: "slots"       },
  "mines":        { cfgKey: "mines",     name: "Mines",           route: "/mines",        launchKey: "mines"     },
  "mob-tower":    { cfgKey: "mob_tower", name: "Mob Tower",       route: "/mob-tower",    launchKey: "mobtower"  },
  "horse-racing": { cfgKey: "horse",     name: "Horse Racing",    route: "/horse-racing", launchKey: "horse"     },
  "bingo":        { cfgKey: "bingo",     name: "Bingo",           route: "/bingo",        launchKey: "bingo"     },
  "lottery":      { cfgKey: "lottery",   name: "Lottery",         route: "/lottery",      launchKey: "lottery"   },
  "cases":        { cfgKey: "slots",     name: "Case Opening",    route: "/cases"                                },
  "keno":         { cfgKey: "slots",     name: "Keno",            route: "/keno",         tokenId: "keno"        },
};

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

/* ─── Search items ────────────────────────────────────────────── */
const SEARCH_ITEMS = [
  { label: "Blackjack",    category: "Table Games",  route: "/blackjack" },
  { label: "Roulette",     category: "Table Games",  route: "/roulette" },
  { label: "Baccarat",     category: "Table Games",  route: "/baccarat" },
  { label: "Slots",        category: "Slots",        route: "/slots" },
  { label: "Poker",        category: "Games",        route: "/poker-tables" },
  { label: "Horse Racing", category: "Mini Games",   route: "/horse-racing" },
  { label: "Sportsbook",   category: "Sections",     route: "/sportsbook" },
  { label: "Tournaments",  category: "Sections",     route: "/tournaments" },
  { label: "Rewards",      category: "Sections",     route: "/rewards" },
  { label: "Challenges",   category: "Sections",     route: "/challenges" },
  { label: "Leaderboards", category: "Sections",     route: "/leaderboards" },
  { label: "Profile",      category: "Account",      route: "/profile" },
];

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

  // ── Search ────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen,  setSearchOpen]  = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const searchResults = searchQuery.trim().length > 0
    ? SEARCH_ITEMS.filter(i => i.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const goSearch = (route: string) => {
    setSearchQuery("");
    setSearchOpen(false);
    setLocation(route);
  };

  const handleSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setSearchOpen(false); return; }
    if (e.key === "Enter" && searchResults.length > 0) goSearch(searchResults[0].route);
  };

  // ── Rewards rank (live, from rewardsState) ────────────────────
  const [rewardsXP, setRewardsXP] = useState(() => getRewardsState().xp);
  useEffect(() => {
    setRewardsXP(getRewardsState().xp);
    return subscribeRewards((s) => setRewardsXP(s.xp));
  }, []);
  const subRank = getSubRank(rewardsXP);

  // ── Recently Played ───────────────────────────────────────────
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayedEntry[]>(getRecentlyPlayed);

  useEffect(() => {
    if (activeNav !== "home") return;
    setRecentlyPlayed(getRecentlyPlayed());
  }, [activeNav]);

  // ── Live Activity — real players from server, polled every 10 s ──
  const [liveActivity, setLiveActivity] = useState<Array<{ username: string; game: string }>>([]);

  useEffect(() => {
    if (activeNav !== "home") return;
    async function poll() {
      try {
        const r = await fetch(`${BASE}/api/live-activity`);
        if (!r.ok) return;
        const data: Array<{ username: string; game: string }> = await r.json();
        const seen = new Set<string>();
        const deduped = data
          .filter(({ username }) => username !== playerUsername)
          .filter(({ game }) => {
            if (!ACTIVITY_MAP[game]) return false;
            if (seen.has(game)) return false;
            seen.add(game);
            return true;
          }).slice(0, 4);
        setLiveActivity(deduped);
      } catch { /* keep previous state */ }
    }
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, [activeNav]);


  useEffect(() => {
    const routeToNav: Record<string, string> = {
      "/lobby":                   "home",
      "/tablegames":              "table-games",
      "/sportsbook":              "sportsbook",
      "/minigames":               "mini-games",
      "/tournaments":             "tournaments",
      "/lottery":                 "lottery",
      "/poker-tables":            "poker",
      "/slots":                   "slots",
      "/horse-racing":            "horse-racing",
      "/rewards":                 "rewards",
      "/challenges":              "challenges",
      "/leaderboards":            "leaderboards",
      "/profile":                 "profile",
      "/market":                  "mkt-home",
      "/market/item-listings":    "mkt-item-listings",
      "/market/trades":           "mkt-trades",
      "/market/sales-history":    "mkt-sales-history",
      "/market/stall-settings":   "mkt-stall-settings",
      "/market/trending":         "mkt-trending",
      "/market/shops":            "mkt-shops",
      "/market/inventory":        "mkt-inventory",
      "/market/profile":          "mkt-profile",
    };
    const mapped = routeToNav[location];
    if (mapped) {
      setActiveNav(mapped);
      if (mapped.startsWith("mkt-")) setAppMode("marketplace");
    }
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
    if (mode === "casino") {
      setActiveNav("home");
      setLocation("/lobby");
    } else {
      setActiveNav("mkt-home");
      setLocation("/market");
    }
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
          <div className="w-px h-5 shrink-0 hidden lg:block" style={{ background: "rgba(255,255,255,0.09)" }} />
        </div>

        {/* MODE TOGGLE — inline on desktop/tablet, own row on mobile */}
        <div className="mode-switcher shrink-0 order-4 md:order-2 lg:mx-2">
          <button className={`mode-tab${appMode === "casino" ? " active" : ""}`} onClick={() => switchMode("casino")}>Casino</button>
          <button className={`mode-tab${appMode === "marketplace" ? " active" : ""}`} onClick={() => switchMode("marketplace")}>Market</button>
        </div>

        {/* SEARCH — centered & flex-1 on desktop, full row on tablet/mobile */}
        <div className="w-full order-3 md:order-4 lg:order-3 lg:w-auto lg:flex-1 lg:px-4" ref={searchRef} style={{ position: "relative" }}>
          <div className="header-search lg:max-w-[350px] lg:mx-auto">
            <Search size={15} style={{ color: "#a855f7", flexShrink: 0 }} />
            <input
              type="text"
              placeholder={appMode === "casino" ? "Search games, events, players..." : "Search listings, sellers, categories..."}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => { if (searchQuery.trim()) setSearchOpen(true); }}
              onKeyDown={handleSearchKey}
            />
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div
              className="lg:max-w-[350px] lg:mx-auto"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "rgba(12,10,10,0.98)",
                border: "1px solid rgba(232,64,10,0.25)",
                borderRadius: 8,
                zIndex: 999,
                overflow: "hidden",
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}
            >
              {searchResults.map((item, idx) => (
                <button
                  key={idx}
                  onMouseDown={() => goSearch(item.route)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "9px 14px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    borderBottom: idx < searchResults.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                    textAlign: "left",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(232,64,10,0.1)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.category}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — rank · chips · profile · logout (Git pill design) */}
        <div className="flex items-center shrink-0 ml-auto order-2 md:order-3 lg:order-4 lg:pr-1" style={{ gap: 12 }}>
          {/* Wallet / Chips pill */}
          <ActiveChipsDisplay chips={chips} label={appMode === "marketplace" ? "Wallet" : "Chips"} />

          {/* Profile chip — avatar always, name/role hidden on mobile */}
          <div className="nav-user-chip">
            <AvatarImg
              src={currentPlayer?.avatarUrl}
              username={displayName}
              size="sm"
              style={{ boxShadow: "0 0 10px rgba(232,64,10,0.4)" }}
            />
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
          <nav className="flex flex-col py-3 overflow-y-auto overflow-x-hidden flex-1" tabIndex={-1} onFocus={(e) => e.currentTarget.blur()} style={{ outline: "none" }}>
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
                  const isStaffItem = item.id === "staff";
                  return (
                    <div key={item.id} className="relative group/nav px-2">
                      <button
                        onClick={item.disabled ? undefined : () => { if ((item as any).launchKey) { enter(GAMES[(item as any).launchKey]); return; } if (item.tokenId) setAccessToken(item.tokenId, "open"); item.route ? setLocation(item.route) : navigate(item.id); }}
                        onMouseEnter={() => setHoveredNav(item.id)}
                        onMouseLeave={() => setHoveredNav(null)}
                        className="relative w-full flex items-center rounded-lg py-[7px] transition-colors duration-150"
                        style={{
                          gap: collapsed ? 0 : 10,
                          paddingLeft: collapsed ? 0 : 10,
                          justifyContent: collapsed ? "center" : "flex-start",
                          background: active
                            ? (isStaffItem ? "rgba(212,170,0,0.12)" : "rgba(232,64,10,0.12)")
                            : hovered ? (isStaffItem ? "rgba(212,170,0,0.08)" : "rgba(232,64,10,0.07)") : undefined,
                        }}
                      >
                        {active && !collapsed && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[16px] rounded-r-full"
                            style={{ background: isStaffItem ? "#d4aa00" : "#e8400a", boxShadow: isStaffItem ? "0 0 6px #d4aa00" : "0 0 6px #e8400a" }}
                          />
                        )}
                        <Icon
                          size={16}
                          style={{
                            flexShrink: 0,
                            color: isStaffItem
                              ? (lit ? "#f5c518" : "#c9960a")
                              : (lit ? "#e8400a" : "rgba(255,255,255,0.35)"),
                            transition: "color 0.15s",
                            filter: isStaffItem ? "drop-shadow(0 0 4px rgba(212,170,0,0.6))" : undefined,
                          }}
                        />
                        {!collapsed && (
                          <span
                            className="flex-1 text-left text-[13px] whitespace-nowrap overflow-hidden"
                            style={{
                              fontWeight: isStaffItem ? 700 : (active ? 600 : 500),
                              color: isStaffItem
                                ? (active ? "#f5c518" : hovered ? "#ffe066" : "#c9960a")
                                : (active ? "#ffffff" : hovered ? "rgba(232,64,10,0.95)" : "rgba(255,255,255,0.50)"),
                              transition: "color 0.15s",
                              textShadow: isStaffItem ? "0 0 8px rgba(212,170,0,0.4)" : undefined,
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
        <main className="flex-1 overflow-y-auto relative" style={{ background: "#060404", outline: "none" }} tabIndex={-1} onFocus={(e) => e.currentTarget.blur()}>
          {activeNav === "home" && (
            <>
              <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                <div className="absolute top-0 left-1/4 w-[600px] h-[300px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(ellipse, #a855f7 0%, transparent 70%)", filter: "blur(40px)" }} />
                <div className="absolute top-[55%] left-1/3 w-[700px] h-[300px] rounded-full opacity-[0.04]" style={{ background: "radial-gradient(ellipse, #e8400a 0%, transparent 70%)", filter: "blur(50px)" }} />
              </div>
              <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 pt-8 pb-12 flex flex-col gap-8">
                <div>
                  <SectionHeader label="Recently Played" dotColor="#d946ef" />
                  {recentlyPlayed.length > 0 ? (
                    <CardGrid>
                      {recentlyPlayed.map((entry) => (
                        <CatalogCard key={entry.id} game={entry.game} onClick={() => {
                          if (entry.launchData?.tableId !== undefined) {
                            setAccessToken("blackjack", "open");
                            sessionStorage.setItem("bab_bj_autojoin", JSON.stringify({ tableId: entry.launchData.tableId, password: entry.launchData.password ?? null }));
                            setLocation("/blackjack");
                          } else {
                            if (entry.tokenId) setAccessToken(entry.tokenId, "open");
                            setLocation(entry.route);
                          }
                        }} />
                      ))}
                    </CardGrid>
                  ) : (
                    <p className="text-sm py-4 text-center" style={{ color: "rgba(255,255,255,0.22)" }}>
                      No recently played games yet. Pick a game to get started.
                    </p>
                  )}
                </div>
                <div>
                  <SectionHeader label="Live Activity" dotColor="#22c55e" />
                  {liveActivity.length > 0 ? (
                    <CardGrid>
                      {liveActivity.map(({ username, game }) => {
                        const m   = ACTIVITY_MAP[game]!;
                        const cfg = GAME_CFG[m.cfgKey] ?? GAME_CFG.blackjack;
                        const g: CatalogGame = {
                          id:          `live-${username}-${game}`,
                          name:        m.name,
                          description: cfg.description,
                          gradient:    cfg.gradient,
                          neonClass:   cfg.neonClass,
                          neonColor:   cfg.neonColor,
                          players:     `${username} is playing`,
                          statusLabel: "ACTIVE",
                          statusColor: "#22c55e",
                        };
                        return (
                          <CatalogCard
                            key={g.id}
                            game={g}
                            onClick={() => {
                              if (m.launchKey) {
                                const def = GAMES[m.launchKey];
                                if (def) { enter(def); return; }
                              }
                              if (m.tokenId) setAccessToken(m.tokenId, "open");
                              setLocation(m.route);
                            }}
                          />
                        );
                      })}
                    </CardGrid>
                  ) : (
                    <p className="text-sm py-4 text-center" style={{ color: "rgba(255,255,255,0.22)" }}>
                      No players online right now. Check back soon.
                    </p>
                  )}
                </div>
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
          {activeNav === "mkt-home"          && <MktHomePage />}
          {activeNav === "mkt-item-listings"  && <MktComingSoon title="Item Listings"  />}
          {activeNav === "mkt-trades"         && <MktComingSoon title="Trades"         />}
          {activeNav === "mkt-sales-history"  && <MktComingSoon title="Sales History"  />}
          {activeNav === "mkt-stall-settings" && <MktComingSoon title="Stall Settings" />}
          {activeNav === "mkt-trending"       && <MktComingSoon title="Trending"       />}
          {activeNav === "mkt-shops"          && <MktComingSoon title="Shops"          />}
          {activeNav === "mkt-inventory"      && <MktComingSoon title="Inventory"      />}
          {activeNav === "mkt-profile"        && <MktComingSoon title="Profile"        />}
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
