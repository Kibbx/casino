import { useState, useEffect, useCallback, useRef } from "react";
import {
  Tv2, TrendingUp, Clock, ChevronRight, ChevronLeft, X, Trash2,
  ReceiptText, Lock, AlertTriangle, Search,
} from "lucide-react";
import { PageWrapper } from "./shared";
import { useStore } from "../store";
import { usePlayerSocket } from "../lib/usePlayerSocket";
import { useGetPlayer } from "@workspace/api-client-react";

/* ── Types ───────────────────────────────────────────────────────── */
interface SbEvent {
  id: string;
  sportKey: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  live: boolean;
  bestHomeOdds: number | null;
  bestAwayOdds: number | null;
  bestHomeBook: string;
  bestAwayBook: string;
  promotion?: string;
  eventName?: string;
}

interface OddsResponse {
  events: SbEvent[];
  cached: boolean;
  activeSportKeys?: string[];
  refreshed?: boolean;
}

interface ScoreInfo {
  home: string | null;
  away: string | null;
}
type ScoreMap = Record<string, ScoreInfo>; // keyed by event ID

interface BetSlipEntry {
  selectionId: string;      // unique per side: `${eventId}-${side}`
  eventId: string;
  side: "home" | "away";
  teamName: string;
  matchup: string;
  odds: number;
  wager: string;
}

/* ── Config ──────────────────────────────────────────────────────── */
const SPORTS = [
  "Live",
  "NFL",
  "NBA",
  "MLB",
  "NHL",
  "UFC",
  "Soccer",
  "Boxing",
  "Tennis",
  "Golf",
  "College Football",
  "College Basketball",
] as const;
type SportTab = (typeof SPORTS)[number];

const SPORT_ICONS: Record<string, string> = {
  "NFL":                  "🏈",
  "NBA":                  "🏀",
  "MLB":                  "⚾",
  "NHL":                  "🏒",
  "UFC":                  "🥊",
  "Soccer":               "⚽",
  "Boxing":               "🥊",
  "Tennis":               "🎾",
  "Golf":                 "⛳",
  "College Football":     "🏈",
  "College Basketball":   "🏀",
};

const SPORT_COLORS: Record<string, string> = {
  NFL:                "#f97316",
  NBA:                "#06b6d4",
  MLB:                "#ef4444",
  NHL:                "#3b82f6",
  "UFC":              "#a855f7",
  Soccer:             "#22c55e",
  Boxing:             "#f5c518",
  Tennis:             "#84cc16",
  Golf:               "#10b981",
  "College Football": "#fb923c",
  "College Basketball": "#38bdf8",
};

const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // once per week

// Maximum elapsed time after commence_time for a game to be considered LIVE
const SPORT_LIVE_WINDOWS_MS: Record<string, number> = {
  NFL:                  4   * 60 * 60 * 1000,
  NBA:                  3   * 60 * 60 * 1000,
  MLB:                  4   * 60 * 60 * 1000,
  NHL:                  3   * 60 * 60 * 1000,
  Soccer:               2.5 * 60 * 60 * 1000,
  UFC:                  6   * 60 * 60 * 1000,
  Boxing:               6   * 60 * 60 * 1000,
  Tennis:               4   * 60 * 60 * 1000,
  Golf:                 8   * 60 * 60 * 1000,
  "College Football":   4   * 60 * 60 * 1000,
  "College Basketball": 3   * 60 * 60 * 1000,
};

/* ── Helpers ─────────────────────────────────────────────────────── */
function isLiveNow(event: SbEvent): boolean {
  if (!event.live) return false;
  const window = SPORT_LIVE_WINDOWS_MS[event.sport] ?? 4 * 60 * 60 * 1000;
  const elapsed = Date.now() - new Date(event.commenceTime).getTime();
  return elapsed < window;
}

function fmtOdds(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

function impliedPct(n: number) {
  const pct = n >= 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
  return (pct * 100).toFixed(0) + "%";
}

function calcPayout(wagerStr: string, odds: number): string | null {
  const w = parseFloat(wagerStr);
  if (!w || w <= 0) return null;
  const profit = odds >= 0 ? (w * odds) / 100 : (w * 100) / Math.abs(odds);
  return (w + profit).toFixed(2);
}

function americanToDecimal(odds: number): number {
  return odds >= 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1;
}

function fmtTime(iso: string, live: boolean) {
  if (live) return "LIVE";
  const d = new Date(iso);
  const isToday = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (isToday) return `Today ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}


/* ── Sports ticker ───────────────────────────────────────────────── */
function TickerLogo({ name, sport }: { name: string; sport?: string }) {
  const url = sport === "Soccer"
    ? (getFlagUrl(name) ?? getLogoUrl(name))
    : (sport && NO_LOGO_SPORTS.has(sport)) ? null : getLogoUrl(name);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  const isFlag = sport === "Soccer" && !!getFlagUrl(name);
  return (
    <img src={url} alt={`${name} flag`} width={isFlag ? 20 : 16} height={isFlag ? 14 : 16}
      onError={() => setFailed(true)}
      className={`object-cover shrink-0 ${isFlag ? "rounded-[2px]" : "rounded-full"}`}
      style={{ width: isFlag ? 20 : 16, height: isFlag ? 14 : 16 }} />
  );
}

function SportsTicker({ items, scores }: { items: SbEvent[]; scores: ScoreMap }) {
  if (items.length === 0) return null;

  const capped  = items.slice(0, 24);
  const doubled = [...capped, ...capped];
  const shortName = (full: string) => full.split(" ").slice(-1)[0]; // last word only

  return (
    <div className="flex items-stretch rounded-xl overflow-hidden mb-4"
      style={{
        border:     "1px solid rgba(34,197,94,0.18)",
        boxShadow:  "0 0 20px rgba(34,197,94,0.07)",
        background: "rgba(34,197,94,0.05)",
        height:     36,
      }}>

      {/* Pinned LIVE badge */}
      <div className="flex items-center gap-2 shrink-0 px-3 select-none"
        style={{ borderRight: "1px solid rgba(34,197,94,0.18)", background: "rgba(34,197,94,0.1)" }}>
        <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-[#22c55e] animate-pulse" />
        <span className="text-[10px] font-black uppercase tracking-[0.18em]" style={{ color: "#22c55e" }}>LIVE</span>
      </div>

      {/* Scrolling track */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute left-0 top-0 bottom-0 w-8 pointer-events-none z-10"
          style={{ background: "linear-gradient(90deg,rgba(9,9,11,0.9),transparent)" }} />
        <div className="absolute right-0 top-0 bottom-0 w-12 pointer-events-none z-10"
          style={{ background: "linear-gradient(270deg,rgba(9,9,11,0.9),transparent)" }} />

        <div className="flex items-center h-full whitespace-nowrap"
          style={{ animation: "mkt-ticker 40s linear infinite", willChange: "transform" }}
          onMouseEnter={e => (e.currentTarget.style.animationPlayState = "paused")}
          onMouseLeave={e => (e.currentTarget.style.animationPlayState = "running")}
        >
          {doubled.map((ev, i) => {
            const sc = scores[ev.id];
            const awayScore = sc?.away ?? null;
            const homeScore = sc?.home ?? null;
            const hasScore  = awayScore !== null && homeScore !== null;
            const hasOdds   = ev.bestAwayOdds !== null && ev.bestHomeOdds !== null;
            return (
              <span key={`${ev.id}-${i}`} className="inline-flex items-center gap-2 px-5 shrink-0">

                {/* Away: logo + short name */}
                <span className="inline-flex items-center gap-1">
                  <TickerLogo name={ev.awayTeam} sport={ev.sport} />
                  <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>
                    {shortName(ev.awayTeam)}
                  </span>
                </span>

                {/* Score */}
                <span className="text-[11px] font-black tabular-nums" style={{ color: "#fff" }}>
                  {hasScore ? `${awayScore} - ${homeScore}` : "— - —"}
                </span>

                {/* Home: logo + short name */}
                <span className="inline-flex items-center gap-1">
                  <TickerLogo name={ev.homeTeam} sport={ev.sport} />
                  <span className="text-[11px] font-bold" style={{ color: "rgba(255,255,255,0.9)" }}>
                    {shortName(ev.homeTeam)}
                  </span>
                </span>

                {/* Separator + odds */}
                {hasOdds && (
                  <>
                    <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 9 }}>•</span>
                    <span className="text-[10px] font-black" style={{ color: "#22c55e" }}>
                      {fmtOdds(ev.bestAwayOdds!)} / {fmtOdds(ev.bestHomeOdds!)}
                    </span>
                  </>
                )}

                {/* Item divider */}
                <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 10 }}>◆</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Fake sportsbook providers ───────────────────────────────────── */
const FAKE_BOOKS = [
  "Four Dragons",
  "Caligula's Palace",
  "Diamond Casino",
  "Camel's Toe",
  "V-Rock",
  "Krystal Casino",
  "Visage",
];

/** Deterministic pick so the same event+side always shows the same book */
function pickBook(eventId: string, sideIdx: number) {
  let h = sideIdx * 2654435761;
  for (let i = 0; i < eventId.length; i++) h = Math.imul(h ^ eventId.charCodeAt(i), 2246822519);
  return FAKE_BOOKS[Math.abs(h) % FAKE_BOOKS.length];
}

function SportsbookBadge({ eventId, sideIdx }: { eventId: string; sideIdx: number }) {
  const name = pickBook(eventId, sideIdx);
  return (
    <span
      className="truncate w-full px-1 mt-0.5 text-center block"
      style={{ fontSize: 9, color: "rgba(255,255,255,0.28)", lineHeight: 1.2 }}
      title={`Odds supplied by ${name}`}
    >
      {name}
    </span>
  );
}

/* ── Team logo lookup (ESPN CDN) ─────────────────────────────────── */
// Keys are full team names as returned by The Odds API (case-insensitive lookup below)
const TEAM_LOGOS: Record<string, string> = {
  // ── MLB ──────────────────────────────────────────────────────────
  "Arizona Diamondbacks":    "https://a.espncdn.com/i/teamlogos/mlb/500/ari.png",
  "Atlanta Braves":          "https://a.espncdn.com/i/teamlogos/mlb/500/atl.png",
  "Baltimore Orioles":       "https://a.espncdn.com/i/teamlogos/mlb/500/bal.png",
  "Boston Red Sox":          "https://a.espncdn.com/i/teamlogos/mlb/500/bos.png",
  "Chicago Cubs":            "https://a.espncdn.com/i/teamlogos/mlb/500/chc.png",
  "Chicago White Sox":       "https://a.espncdn.com/i/teamlogos/mlb/500/chw.png",
  "Cincinnati Reds":         "https://a.espncdn.com/i/teamlogos/mlb/500/cin.png",
  "Cleveland Guardians":     "https://a.espncdn.com/i/teamlogos/mlb/500/cle.png",
  "Colorado Rockies":        "https://a.espncdn.com/i/teamlogos/mlb/500/col.png",
  "Detroit Tigers":          "https://a.espncdn.com/i/teamlogos/mlb/500/det.png",
  "Houston Astros":          "https://a.espncdn.com/i/teamlogos/mlb/500/hou.png",
  "Kansas City Royals":      "https://a.espncdn.com/i/teamlogos/mlb/500/kc.png",
  "Los Angeles Angels":      "https://a.espncdn.com/i/teamlogos/mlb/500/laa.png",
  "Los Angeles Dodgers":     "https://a.espncdn.com/i/teamlogos/mlb/500/lad.png",
  "Miami Marlins":           "https://a.espncdn.com/i/teamlogos/mlb/500/mia.png",
  "Milwaukee Brewers":       "https://a.espncdn.com/i/teamlogos/mlb/500/mil.png",
  "Minnesota Twins":         "https://a.espncdn.com/i/teamlogos/mlb/500/min.png",
  "New York Mets":           "https://a.espncdn.com/i/teamlogos/mlb/500/nym.png",
  "New York Yankees":        "https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png",
  "Oakland Athletics":       "https://a.espncdn.com/i/teamlogos/mlb/500/oak.png",
  "Athletics":               "https://a.espncdn.com/i/teamlogos/mlb/500/oak.png",
  "Philadelphia Phillies":   "https://a.espncdn.com/i/teamlogos/mlb/500/phi.png",
  "Pittsburgh Pirates":      "https://a.espncdn.com/i/teamlogos/mlb/500/pit.png",
  "San Diego Padres":        "https://a.espncdn.com/i/teamlogos/mlb/500/sd.png",
  "San Francisco Giants":    "https://a.espncdn.com/i/teamlogos/mlb/500/sf.png",
  "Seattle Mariners":        "https://a.espncdn.com/i/teamlogos/mlb/500/sea.png",
  "St. Louis Cardinals":     "https://a.espncdn.com/i/teamlogos/mlb/500/stl.png",
  "Tampa Bay Rays":          "https://a.espncdn.com/i/teamlogos/mlb/500/tb.png",
  "Texas Rangers":           "https://a.espncdn.com/i/teamlogos/mlb/500/tex.png",
  "Toronto Blue Jays":       "https://a.espncdn.com/i/teamlogos/mlb/500/tor.png",
  "Washington Nationals":    "https://a.espncdn.com/i/teamlogos/mlb/500/wsh.png",
  // ── NFL ──────────────────────────────────────────────────────────
  "Arizona Cardinals":       "https://a.espncdn.com/i/teamlogos/nfl/500/ari.png",
  "Atlanta Falcons":         "https://a.espncdn.com/i/teamlogos/nfl/500/atl.png",
  "Baltimore Ravens":        "https://a.espncdn.com/i/teamlogos/nfl/500/bal.png",
  "Buffalo Bills":           "https://a.espncdn.com/i/teamlogos/nfl/500/buf.png",
  "Carolina Panthers":       "https://a.espncdn.com/i/teamlogos/nfl/500/car.png",
  "Chicago Bears":           "https://a.espncdn.com/i/teamlogos/nfl/500/chi.png",
  "Cincinnati Bengals":      "https://a.espncdn.com/i/teamlogos/nfl/500/cin.png",
  "Cleveland Browns":        "https://a.espncdn.com/i/teamlogos/nfl/500/cle.png",
  "Dallas Cowboys":          "https://a.espncdn.com/i/teamlogos/nfl/500/dal.png",
  "Denver Broncos":          "https://a.espncdn.com/i/teamlogos/nfl/500/den.png",
  "Detroit Lions":           "https://a.espncdn.com/i/teamlogos/nfl/500/det.png",
  "Green Bay Packers":       "https://a.espncdn.com/i/teamlogos/nfl/500/gb.png",
  "Houston Texans":          "https://a.espncdn.com/i/teamlogos/nfl/500/hou.png",
  "Indianapolis Colts":      "https://a.espncdn.com/i/teamlogos/nfl/500/ind.png",
  "Jacksonville Jaguars":    "https://a.espncdn.com/i/teamlogos/nfl/500/jax.png",
  "Kansas City Chiefs":      "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png",
  "Las Vegas Raiders":       "https://a.espncdn.com/i/teamlogos/nfl/500/lv.png",
  "Los Angeles Chargers":    "https://a.espncdn.com/i/teamlogos/nfl/500/lac.png",
  "Los Angeles Rams":        "https://a.espncdn.com/i/teamlogos/nfl/500/lar.png",
  "Miami Dolphins":          "https://a.espncdn.com/i/teamlogos/nfl/500/mia.png",
  "Minnesota Vikings":       "https://a.espncdn.com/i/teamlogos/nfl/500/min.png",
  "New England Patriots":    "https://a.espncdn.com/i/teamlogos/nfl/500/ne.png",
  "New Orleans Saints":      "https://a.espncdn.com/i/teamlogos/nfl/500/no.png",
  "New York Giants":         "https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png",
  "New York Jets":           "https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png",
  "Philadelphia Eagles":     "https://a.espncdn.com/i/teamlogos/nfl/500/phi.png",
  "Pittsburgh Steelers":     "https://a.espncdn.com/i/teamlogos/nfl/500/pit.png",
  "San Francisco 49ers":     "https://a.espncdn.com/i/teamlogos/nfl/500/sf.png",
  "Seattle Seahawks":        "https://a.espncdn.com/i/teamlogos/nfl/500/sea.png",
  "Tampa Bay Buccaneers":    "https://a.espncdn.com/i/teamlogos/nfl/500/tb.png",
  "Tennessee Titans":        "https://a.espncdn.com/i/teamlogos/nfl/500/ten.png",
  "Washington Commanders":   "https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png",
  // ── NBA ──────────────────────────────────────────────────────────
  "Atlanta Hawks":           "https://a.espncdn.com/i/teamlogos/nba/500/atl.png",
  "Boston Celtics":          "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
  "Brooklyn Nets":           "https://a.espncdn.com/i/teamlogos/nba/500/bkn.png",
  "Charlotte Hornets":       "https://a.espncdn.com/i/teamlogos/nba/500/cha.png",
  "Chicago Bulls":           "https://a.espncdn.com/i/teamlogos/nba/500/chi.png",
  "Cleveland Cavaliers":     "https://a.espncdn.com/i/teamlogos/nba/500/cle.png",
  "Dallas Mavericks":        "https://a.espncdn.com/i/teamlogos/nba/500/dal.png",
  "Denver Nuggets":          "https://a.espncdn.com/i/teamlogos/nba/500/den.png",
  "Detroit Pistons":         "https://a.espncdn.com/i/teamlogos/nba/500/det.png",
  "Golden State Warriors":   "https://a.espncdn.com/i/teamlogos/nba/500/gs.png",
  "Houston Rockets":         "https://a.espncdn.com/i/teamlogos/nba/500/hou.png",
  "Indiana Pacers":          "https://a.espncdn.com/i/teamlogos/nba/500/ind.png",
  "Los Angeles Clippers":    "https://a.espncdn.com/i/teamlogos/nba/500/lac.png",
  "Los Angeles Lakers":      "https://a.espncdn.com/i/teamlogos/nba/500/lal.png",
  "Memphis Grizzlies":       "https://a.espncdn.com/i/teamlogos/nba/500/mem.png",
  "Miami Heat":              "https://a.espncdn.com/i/teamlogos/nba/500/mia.png",
  "Milwaukee Bucks":         "https://a.espncdn.com/i/teamlogos/nba/500/mil.png",
  "Minnesota Timberwolves":  "https://a.espncdn.com/i/teamlogos/nba/500/min.png",
  "New Orleans Pelicans":    "https://a.espncdn.com/i/teamlogos/nba/500/no.png",
  "New York Knicks":         "https://a.espncdn.com/i/teamlogos/nba/500/ny.png",
  "Oklahoma City Thunder":   "https://a.espncdn.com/i/teamlogos/nba/500/okc.png",
  "Orlando Magic":           "https://a.espncdn.com/i/teamlogos/nba/500/orl.png",
  "Philadelphia 76ers":      "https://a.espncdn.com/i/teamlogos/nba/500/phi.png",
  "Phoenix Suns":            "https://a.espncdn.com/i/teamlogos/nba/500/phx.png",
  "Portland Trail Blazers":  "https://a.espncdn.com/i/teamlogos/nba/500/por.png",
  "Sacramento Kings":        "https://a.espncdn.com/i/teamlogos/nba/500/sac.png",
  "San Antonio Spurs":       "https://a.espncdn.com/i/teamlogos/nba/500/sa.png",
  "Toronto Raptors":         "https://a.espncdn.com/i/teamlogos/nba/500/tor.png",
  "Utah Jazz":               "https://a.espncdn.com/i/teamlogos/nba/500/utah.png",
  "Washington Wizards":      "https://a.espncdn.com/i/teamlogos/nba/500/wsh.png",
  // ── NHL ──────────────────────────────────────────────────────────
  "Anaheim Ducks":           "https://a.espncdn.com/i/teamlogos/nhl/500/ana.png",
  "Boston Bruins":           "https://a.espncdn.com/i/teamlogos/nhl/500/bos.png",
  "Buffalo Sabres":          "https://a.espncdn.com/i/teamlogos/nhl/500/buf.png",
  "Calgary Flames":          "https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png",
  "Carolina Hurricanes":     "https://a.espncdn.com/i/teamlogos/nhl/500/car.png",
  "Chicago Blackhawks":      "https://a.espncdn.com/i/teamlogos/nhl/500/chi.png",
  "Colorado Avalanche":      "https://a.espncdn.com/i/teamlogos/nhl/500/col.png",
  "Columbus Blue Jackets":   "https://a.espncdn.com/i/teamlogos/nhl/500/cbj.png",
  "Dallas Stars":            "https://a.espncdn.com/i/teamlogos/nhl/500/dal.png",
  "Detroit Red Wings":       "https://a.espncdn.com/i/teamlogos/nhl/500/det.png",
  "Edmonton Oilers":         "https://a.espncdn.com/i/teamlogos/nhl/500/edm.png",
  "Florida Panthers":        "https://a.espncdn.com/i/teamlogos/nhl/500/fla.png",
  "Los Angeles Kings":       "https://a.espncdn.com/i/teamlogos/nhl/500/lak.png",
  "Minnesota Wild":          "https://a.espncdn.com/i/teamlogos/nhl/500/min.png",
  "Montreal Canadiens":      "https://a.espncdn.com/i/teamlogos/nhl/500/mtl.png",
  "Nashville Predators":     "https://a.espncdn.com/i/teamlogos/nhl/500/nsh.png",
  "New Jersey Devils":       "https://a.espncdn.com/i/teamlogos/nhl/500/njd.png",
  "New York Islanders":      "https://a.espncdn.com/i/teamlogos/nhl/500/nyi.png",
  "New York Rangers":        "https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png",
  "Ottawa Senators":         "https://a.espncdn.com/i/teamlogos/nhl/500/ott.png",
  "Philadelphia Flyers":     "https://a.espncdn.com/i/teamlogos/nhl/500/phi.png",
  "Pittsburgh Penguins":     "https://a.espncdn.com/i/teamlogos/nhl/500/pit.png",
  "San Jose Sharks":         "https://a.espncdn.com/i/teamlogos/nhl/500/sjs.png",
  "Seattle Kraken":          "https://a.espncdn.com/i/teamlogos/nhl/500/sea.png",
  "St. Louis Blues":         "https://a.espncdn.com/i/teamlogos/nhl/500/stl.png",
  "Tampa Bay Lightning":     "https://a.espncdn.com/i/teamlogos/nhl/500/tb.png",
  "Toronto Maple Leafs":     "https://a.espncdn.com/i/teamlogos/nhl/500/tor.png",
  "Utah Hockey Club":        "https://a.espncdn.com/i/teamlogos/nhl/500/utah.png",
  "Vancouver Canucks":       "https://a.espncdn.com/i/teamlogos/nhl/500/van.png",
  "Vegas Golden Knights":    "https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png",
  "Washington Capitals":     "https://a.espncdn.com/i/teamlogos/nhl/500/wsh.png",
  "Winnipeg Jets":           "https://a.espncdn.com/i/teamlogos/nhl/500/wpg.png",
};

function getLogoUrl(name: string): string | null {
  return TEAM_LOGOS[name] ?? TEAM_LOGOS[name.trim()] ?? null;
}

/* ── Soccer country flags ────────────────────────────────────────── */
const SOCCER_FLAGS: Record<string, string> = {
  // North & Central America
  "United States":         "us",
  "USA":                   "us",
  "Mexico":                "mx",
  "Canada":                "ca",
  "Panama":                "pa",
  "Costa Rica":            "cr",
  "Honduras":              "hn",
  "El Salvador":           "sv",
  "Guatemala":             "gt",
  "Jamaica":               "jm",
  "Trinidad and Tobago":   "tt",
  "Haiti":                 "ht",
  "Cuba":                  "cu",
  "Curaçao":               "cw",
  "Curacao":               "cw",
  // South America
  "Brazil":                "br",
  "Argentina":             "ar",
  "Uruguay":               "uy",
  "Colombia":              "co",
  "Chile":                 "cl",
  "Peru":                  "pe",
  "Ecuador":               "ec",
  "Paraguay":              "py",
  "Bolivia":               "bo",
  "Venezuela":             "ve",
  // Europe
  "France":                "fr",
  "Germany":               "de",
  "Spain":                 "es",
  "Portugal":              "pt",
  "Netherlands":           "nl",
  "Italy":                 "it",
  "England":               "gb-eng",
  "Scotland":              "gb-sct",
  "Wales":                 "gb-wls",
  "Northern Ireland":      "gb-nir",
  "Ireland":               "ie",
  "Belgium":               "be",
  "Switzerland":           "ch",
  "Croatia":               "hr",
  "Poland":                "pl",
  "Sweden":                "se",
  "Denmark":               "dk",
  "Norway":                "no",
  "Austria":               "at",
  "Czech Republic":        "cz",
  "Czechia":               "cz",
  "Slovakia":              "sk",
  "Slovenia":              "si",
  "Hungary":               "hu",
  "Romania":               "ro",
  "Serbia":                "rs",
  "Bosnia and Herzegovina":"ba",
  "Kosovo":                "xk",
  "Albania":               "al",
  "North Macedonia":       "mk",
  "Montenegro":            "me",
  "Greece":                "gr",
  "Turkey":                "tr",
  "Ukraine":               "ua",
  "Russia":                "ru",
  "Finland":               "fi",
  "Iceland":               "is",
  "Armenia":               "am",
  "Georgia":               "ge",
  "Azerbaijan":            "az",
  "Israel":                "il",
  "Cape Verde":            "cv",
  // Africa
  "Morocco":               "ma",
  "Algeria":               "dz",
  "Tunisia":               "tn",
  "Egypt":                 "eg",
  "Senegal":               "sn",
  "Ghana":                 "gh",
  "Nigeria":               "ng",
  "Cameroon":              "cm",
  "Ivory Coast":           "ci",
  "Côte d'Ivoire":         "ci",
  "South Africa":          "za",
  "DR Congo":              "cd",
  "Congo":                 "cg",
  "Ethiopia":              "et",
  "Kenya":                 "ke",
  "Tanzania":              "tz",
  "Zambia":                "zm",
  "Zimbabwe":              "zw",
  // Asia & Oceania
  "Japan":                 "jp",
  "South Korea":           "kr",
  "Korea Republic":        "kr",
  "Australia":             "au",
  "New Zealand":           "nz",
  "Saudi Arabia":          "sa",
  "Qatar":                 "qa",
  "Iran":                  "ir",
  "Iraq":                  "iq",
  "Jordan":                "jo",
  "China":                 "cn",
  "India":                 "in",
  "Thailand":              "th",
  "Indonesia":             "id",
  "Vietnam":               "vn",
  "Philippines":           "ph",
  "Uzbekistan":            "uz",
};

function getFlagUrl(name: string): string | null {
  const code = SOCCER_FLAGS[name] ?? SOCCER_FLAGS[name.trim()] ?? null;
  if (!code) return null;
  return `https://flagcdn.com/w40/${code}.png`;
}

const NO_LOGO_SPORTS = new Set(["UFC", "Boxing", "Golf", "Tennis"]);

function TeamLogo({ name, accent, sport }: { name: string; accent: string; sport?: string }) {
  const isSoccer = sport === "Soccer";
  const flagUrl  = isSoccer ? getFlagUrl(name) : null;
  const logoUrl  = (sport && NO_LOGO_SPORTS.has(sport)) ? null : getLogoUrl(name);
  const url      = flagUrl ?? logoUrl;
  const isFlag   = !!flagUrl;
  const initials = name.split(" ").slice(-2).map(w => w[0]).join("").toUpperCase().slice(0, 2);
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={isFlag ? `${name} flag` : name}
        width={isFlag ? 28 : 22}
        height={isFlag ? 20 : 22}
        onError={() => setFailed(true)}
        className={`object-cover shrink-0 ${isFlag ? "rounded-[3px]" : "rounded-full object-contain"}`}
        style={{ width: isFlag ? 28 : 22, height: isFlag ? 20 : 22 }}
      />
    );
  }
  // No logo + no-logo sport → render nothing; name will fill the full row width
  if (sport && NO_LOGO_SPORTS.has(sport)) return null;
  return (
    <span
      className="rounded-full shrink-0 flex items-center justify-center text-[8px] font-black"
      style={{ width: 22, height: 22, background: `${accent}22`, color: accent, border: `1px solid ${accent}44` }}
    >
      {initials}
    </span>
  );
}


/* ── Competition name ────────────────────────────────────────────────── */
function getCompetitionName(event: SbEvent): string {
  const { sport, league, eventName } = event;

  // Soccer & Golf & Tennis already carry the tournament name in `league`
  if (sport === "Soccer" || sport === "Golf" || sport === "Tennis") return league;

  // MMA — prefer the card name (e.g. "UFC 317") from eventName
  if (sport === "UFC") return eventName ?? league ?? "UFC Fight Card";
  if (sport === "Boxing") return league ?? "World Championship Bout";

  // College sports carry the conference/tournament in league
  if (sport === "College Football" || sport === "College Basketball") return `NCAA ${sport === "College Football" ? "Football" : "Basketball"}`;

  // Big four — Odds API free tier doesn't expose season type,
  // so default to Regular Season (accurate for most of the year)
  return "Regular Season";
}

function CompetitionBadge({ event }: { event: SbEvent }) {
  const name = getCompetitionName(event);
  return (
    <div className="px-3 pt-1.5 pb-0">
      <p
        className="text-[8.5px] font-bold uppercase tracking-widest truncate text-center"
        style={{ color: "rgba(255,255,255,0.28)", letterSpacing: "0.09em" }}
        title={name}
      >
        {name}
      </p>
    </div>
  );
}

/* ── Game status ─────────────────────────────────────────────────────────
   Estimated from commenceTime elapsed minutes.
   The Odds API free tier returns scores but not period/clock — this
   derives a realistic status from how long the game has been running.
   All durations are real-world wall-clock averages, not game-clock.
   ─────────────────────────────────────────────────────────────────────── */
const ORD = ["1st","2nd","3rd","4th","5th","6th","7th","8th","9th","10th","11th","12th"];
function mm(n: number) { return String(Math.max(0, n)).padStart(2, "0"); }
function mmss(totalSecs: number) {
  const s = Math.max(0, Math.round(totalSecs));
  return `${mm(Math.floor(s / 60))}:${mm(s % 60)}`;
}

function computeGameStatus(sport: string, commenceTime: string): string {
  const elapsed = (Date.now() - new Date(commenceTime).getTime()) / 60000; // real minutes since kick-off
  if (elapsed < 0) return "Live";

  if (sport === "Soccer") {
    // Wall-clock structure: ~47 min 1st half → ~15 min HT break → ~50+ min 2nd half
    if (elapsed <= 47) {
      const min = Math.min(Math.floor(elapsed), 45);
      return min >= 45 ? "45+'" : `${min}'`;
    }
    if (elapsed <= 62) return "HT";
    const sh = Math.floor(elapsed - 62) + 45; // 2nd half game minute
    if (sh > 120) return "FT";
    if (sh >= 90) return `90+${sh - 90}'`;
    return `${sh}'`;
  }

  if (sport === "MLB") {
    // Avg MLB game ~3 h (180 min); 18 half-innings ≈ 10 min each
    const halfInning = Math.floor(elapsed / 10);
    if (halfInning >= 18 || elapsed >= 185) return "Final";
    const inning  = Math.floor(halfInning / 2);
    const isTop   = halfInning % 2 === 0;
    const withinH = elapsed % 10;
    // Brief mid-inning break (last ~1.5 min of each half-inning)
    if (withinH >= 8.5) return `Mid ${ORD[inning]}`;
    return `${isTop ? "Top" : "Bot"} ${ORD[inning]}`;
  }

  if (sport === "NFL") {
    // Avg NFL game ~3.5 h (210 min); 4 quarters ≈ 48 min wall-clock each
    // Each real minute ≈ 15/48 game-minutes remaining math below
    if (elapsed >= 215) return "Final";
    if (elapsed >= 195) return `OT ${mmss((215 - elapsed) * 60 * (15 / 20))}`;
    const quarter   = Math.min(Math.floor(elapsed / 48), 3);
    const qElapsed  = elapsed % 48;
    const gameSecs  = Math.max(0, (1 - qElapsed / 48) * 15 * 60);
    return `Q${quarter + 1} ${mmss(gameSecs)}`;
  }

  if (sport === "NBA") {
    // Avg NBA game ~2.5 h (150 min); 4 quarters ≈ 35 min wall-clock each
    if (elapsed >= 155) return "Final";
    if (elapsed >= 145) return `OT ${mmss((155 - elapsed) * 60 * (5 / 10))}`;
    const quarter  = Math.min(Math.floor(elapsed / 35), 3);
    const qElapsed = elapsed % 35;
    const gameSecs = Math.max(0, (1 - qElapsed / 35) * 12 * 60);
    return `Q${quarter + 1} ${mmss(gameSecs)}`;
  }

  if (sport === "NHL") {
    // Avg NHL game ~2.5 h (150 min); 3 periods ≈ 47 min wall-clock each
    if (elapsed >= 150) return "Final";
    if (elapsed >= 142) return `OT ${mmss((150 - elapsed) * 60 * (5 / 8))}`;
    const period   = Math.min(Math.floor(elapsed / 47), 2);
    const pElapsed = elapsed % 47;
    const gameSecs = Math.max(0, (1 - pElapsed / 47) * 20 * 60);
    return `${ORD[period]} ${mmss(gameSecs)}`;
  }

  if (sport === "UFC" || sport === "Boxing") {
    // 5 rounds × 5 min each + 1 min rest = ~30 min total
    if (elapsed >= 32) return "Final";
    const round = Math.min(Math.floor(elapsed / 6) + 1, 5);
    return `Rd ${round}`;
  }

  return "Live";
}

/* ── Event card ──────────────────────────────────────────────────────── */
function EventCard({
  event, selHome, selAway, onHome, onAway, score,
}: { event: SbEvent; selHome: boolean; selAway: boolean; onHome: () => void; onAway: () => void; score?: ScoreInfo }) {
  const accent    = SPORT_COLORS[event.sport] ?? "#f97316";
  const live      = isLiveNow(event);
  const isCombat  = event.sport === "UFC" || event.sport === "Boxing";
  const shortName = (s: string) => s.split(" ").slice(-1)[0];

  const borderBase  = live ? "rgba(34,197,94,0.24)" : "rgba(255,255,255,0.07)";
  const borderHover = live ? "rgba(34,197,94,0.5)" : `${accent}60`;
  const shadowBase  = live ? "0 0 16px rgba(34,197,94,0.08)" : "none";
  const shadowHover = live ? "0 0 28px rgba(34,197,94,0.18)" : `0 0 18px ${accent}22`;

  type Side = { label: string; odds: number | null; sel: boolean; onClick: () => void };
  const sides: Side[] = [
    { label: shortName(event.awayTeam), odds: event.bestAwayOdds, sel: selAway, onClick: onAway },
    { label: shortName(event.homeTeam), odds: event.bestHomeOdds, sel: selHome, onClick: onHome },
  ];

  return (
    <div
      className="rounded-xl overflow-hidden flex flex-col transition-all duration-200"
      style={{
        background: live
          ? "linear-gradient(160deg,rgba(34,197,94,0.07) 0%,rgba(12,12,16,0) 55%),rgba(255,255,255,0.026)"
          : "rgba(255,255,255,0.026)",
        border:    `1px solid ${borderBase}`,
        boxShadow: shadowBase,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.border    = `1px solid ${borderHover}`;
        el.style.boxShadow = shadowHover;
        el.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.border    = `1px solid ${borderBase}`;
        el.style.boxShadow = shadowBase;
        el.style.transform = "none";
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5"
        style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.045)" }}>
        <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0"
          style={{ background: `${accent}20`, color: accent, border: `1px solid ${accent}35` }}>
          {SPORT_ICONS[event.sport] ?? ""} {event.sport}
        </span>
        {live ? (
          <span className="flex items-center gap-1 shrink-0">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            <span className="text-[8px] font-black uppercase tracking-wider" style={{ color: "#22c55e" }}>LIVE</span>
            <span className="text-[8px] font-medium whitespace-nowrap" style={{ color: "rgba(255,255,255,0.32)" }}>
              · {computeGameStatus(event.sport, event.commenceTime)}
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[8px] shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
            <Clock size={8} />{fmtTime(event.commenceTime, false)}
          </span>
        )}
      </div>

      <CompetitionBadge event={event} />

      {/* Team rows — logo/flag left, name, score right */}
      <div className="px-2.5 pt-1 pb-2 flex flex-col gap-1">
        {/* Away */}
        <div className="flex items-center justify-center gap-1.5 min-w-0">
          <TeamLogo name={event.awayTeam} accent={accent} sport={event.sport} />
          <p className="text-[11.5px] font-bold text-white leading-tight truncate max-w-[130px]">{event.awayTeam}</p>
          {score?.away != null && (
            <span className="text-[19px] font-black shrink-0 tabular-nums leading-none ml-1"
              style={{ color: live ? "#fff" : "rgba(255,255,255,0.4)" }}>{score.away}</span>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
          <span className="text-[6.5px] font-black tracking-widest shrink-0"
            style={{ color: "rgba(255,255,255,0.18)" }}>{isCombat ? "VS" : "AT"}</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
        </div>

        {/* Home */}
        <div className="flex items-center justify-center gap-1.5 min-w-0">
          <TeamLogo name={event.homeTeam} accent={accent} sport={event.sport} />
          <p className="text-[11.5px] font-bold text-white leading-tight truncate max-w-[130px]">{event.homeTeam}</p>
          {score?.home != null && (
            <span className="text-[19px] font-black shrink-0 tabular-nums leading-none ml-1"
              style={{ color: live ? "#fff" : "rgba(255,255,255,0.4)" }}>{score.home}</span>
          )}
        </div>
      </div>

      {/* Odds buttons */}
      <div className="px-2.5 pb-2.5 flex gap-1.5">
        {sides.map(({ label, odds, sel, onClick }, i) =>
          odds === null ? (
            <div key={i} className="flex-1 flex flex-col items-center justify-center rounded-lg py-2"
              style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="text-[8px] truncate w-full text-center px-1" style={{ color: "rgba(255,255,255,0.18)" }}>{label}</span>
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.12)" }}>N/A</span>
            </div>
          ) : (
            <button key={i} onClick={onClick}
              className="flex-1 flex flex-col items-center rounded-lg py-1.5 pb-1 transition-all duration-150"
              style={{
                background: sel ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.04)",
                border:     `1px solid ${sel ? "rgba(249,115,22,0.55)" : "rgba(255,255,255,0.08)"}`,
                boxShadow:  sel ? "0 0 12px rgba(249,115,22,0.25)" : "none",
                cursor:     "pointer",
              }}
              onMouseEnter={e => {
                const el = e.currentTarget;
                el.style.background = sel ? "rgba(249,115,22,0.22)" : "rgba(255,255,255,0.08)";
                el.style.border     = `1px solid ${sel ? "rgba(249,115,22,0.7)" : "rgba(255,255,255,0.18)"}`;
              }}
              onMouseLeave={e => {
                const el = e.currentTarget;
                el.style.background = sel ? "rgba(249,115,22,0.15)" : "rgba(255,255,255,0.04)";
                el.style.border     = `1px solid ${sel ? "rgba(249,115,22,0.55)" : "rgba(255,255,255,0.08)"}`;
              }}
            >
              <span className="text-[8px] font-bold truncate w-full text-center px-1 leading-tight"
                style={{ color: sel ? "rgba(249,115,22,0.75)" : "rgba(255,255,255,0.3)" }}>
                {label}
              </span>
              <span className="text-[16px] font-black leading-tight"
                style={{ color: sel ? "#f97316" : "rgba(255,255,255,0.85)", fontVariantNumeric: "tabular-nums" }}>
                {fmtOdds(odds)}
              </span>
              <SportsbookBadge eventId={event.id} sideIdx={i} />
            </button>
          )
        )}
      </div>
    </div>
  );
}

/* ── Bet slip ────────────────────────────────────────────────────── */
function BetSlip({
  entries, popularEvents = [], onRemove, onClear, onPlace, onSelect,
  chips, chipsKnown = false, placeError, placing = false,
}: {
  entries: BetSlipEntry[];
  popularEvents?: SbEvent[];
  onWager?: (id: string, side: "home" | "away", val: string) => void;
  onRemove: (selectionId: string) => void;
  onClear: () => void;
  onPlace: (wager: string, entry?: BetSlipEntry) => void;
  onSelect?: (ev: SbEvent, side: "home" | "away") => void;
  chips?: number;
  chipsKnown?: boolean;
  placeError?: string;
  placing?: boolean;
}) {
  const [activeTab,    setActiveTab]    = useState<"parlay" | "singles">("parlay");
  const [parlayWager,  setParlayWager]  = useState("");
  const [singleWagers, setSingleWagers] = useState<Record<string, string>>({});

  /* Reset wager state whenever slip is cleared */
  useEffect(() => {
    if (entries.length === 0) {
      setParlayWager("");
      setSingleWagers({});
      setActiveTab("parlay");
    }
  }, [entries.length]);

  const avail = chipsKnown ? (chips ?? Infinity) : Infinity;

  const getSingleWager = (e: BetSlipEntry) => singleWagers[e.selectionId] ?? "";
  const setSingleWager = (e: BetSlipEntry, val: string) =>
    setSingleWagers(prev => ({ ...prev, [e.selectionId]: val }));
  const addToSingle = (e: BetSlipEntry, amt: number) => {
    const cur = parseFloat(getSingleWager(e)) || 0;
    setSingleWager(e, String(Math.min(cur + amt, avail)));
  };
  const addToParlay = (amt: number) => {
    const cur = parseFloat(parlayWager) || 0;
    setParlayWager(String(Math.min(cur + amt, avail)));
  };

  /* Parlay combined odds (decimal product → display as ×N) */
  const combinedDecimal = entries.reduce((p, e) => p * americanToDecimal(e.odds), 1);
  const parlayWagerNum  = parseFloat(parlayWager) || 0;
  const parlayPayout    = parlayWagerNum > 0 ? parlayWagerNum * combinedDecimal : 0;

  /* Same-game conflict — block parlaying both sides of one event */
  const hasSameGame = entries.length >= 2 &&
    new Set(entries.map(e => e.eventId)).size < entries.length;

  /* Popular bet rows */
  const STATIC_POPULAR = [
    { key: "dodgers", label: "Dodgers ML", league: "MLB", odds: -130, ev: null as SbEvent | null, side: "home" as const },
    { key: "celtics", label: "Celtics ML",  league: "NBA", odds: -135, ev: null as SbEvent | null, side: "home" as const },
  ];
  const realRows = popularEvents.slice(0, 2).map(ev => {
    const isFav = Math.abs(ev.bestHomeOdds ?? 999) <= Math.abs(ev.bestAwayOdds ?? 999);
    const side: "home" | "away" = isFav ? "home" : "away";
    const team = isFav ? ev.homeTeam : ev.awayTeam;
    const odds = (isFav ? ev.bestHomeOdds : ev.bestAwayOdds) ?? 0;
    return { key: ev.id, label: `${team.split(" ").slice(-1)[0]} ML`, league: ev.league, odds, ev, side };
  });
  const popularRows = realRows.length >= 2 ? realRows : STATIC_POPULAR;

  /* Quick-add chip button */
  const QuickBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick}
      className="flex-1 py-1.5 rounded-md text-[10px] font-black transition-opacity active:opacity-70"
      style={{ background: "rgba(0,230,118,0.10)", border: "1px solid rgba(0,230,118,0.2)", color: "#00E676" }}>
      {label}
    </button>
  );

  return (
    <div style={{ background: "#111217", border: "1px solid #2A2B32", borderRadius: 12, overflow: "hidden" }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3.5 py-2.5"
        style={{ background: "#241715", borderBottom: "2px solid #FF6A00" }}>
        <div className="flex items-center gap-2">
          <ReceiptText size={13} style={{ color: "#FF6A00" }} />
          <span className="font-orbitron text-[11px] font-black uppercase tracking-widest text-white">
            Bet Slip
          </span>
          {entries.length > 0 && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: "#FF6A00", color: "#000" }}>
              {entries.length}
            </span>
          )}
        </div>
        {entries.length > 0 && (
          <button onClick={onClear}
            className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-bold transition-opacity hover:opacity-70"
            style={{ color: "#8B8E98" }}>
            <Trash2 size={10} />Clear
          </button>
        )}
      </div>

      {/* ── Tabs (only when picks exist) ── */}
      {entries.length > 0 && (
        <div className="flex" style={{ borderBottom: "1px solid #2A2B32" }}>
          {(["parlay", "singles"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-1 py-2.5 text-[10px] font-black uppercase tracking-widest transition-colors relative"
              style={{ color: activeTab === tab ? "#fff" : "#8B8E98" }}>
              {tab === "parlay" ? "Parlay" : "Singles"}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-[2px] rounded-full"
                  style={{ background: "#00E676" }} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {entries.length === 0 && (
        <>
          <div className="flex flex-col items-center gap-2 px-5 pt-8 pb-5 text-center">
            <ReceiptText size={30} style={{ color: "rgba(255,255,255,0.055)" }} />
            <p className="text-[12px] font-bold text-white">No selections yet</p>
            <p className="text-[10px]" style={{ color: "#8B8E98" }}>
              Tap any odds to build your slip.
            </p>
          </div>
          <div className="mx-3 mb-4 overflow-hidden"
            style={{ background: "#17181E", border: "1px solid #2A2B32", borderRadius: 9 }}>
            <div className="px-3 py-2 flex items-center gap-1.5" style={{ borderBottom: "1px solid #2A2B32" }}>
              <TrendingUp size={10} style={{ color: "#FF6A00" }} />
              <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: "#FF6A00" }}>
                Popular Bets
              </span>
            </div>
            {popularRows.map((row, i) => (
              <button key={row.key}
                onClick={() => row.ev && onSelect && onSelect(row.ev, row.side)}
                disabled={!row.ev || !onSelect}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                style={{ borderBottom: i < popularRows.length - 1 ? "1px solid #2A2B32" : "none",
                  cursor: row.ev && onSelect ? "pointer" : "default" }}>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-white truncate">{row.label}</p>
                  <p className="text-[8px] uppercase tracking-wide truncate" style={{ color: "#8B8E98" }}>
                    {row.league}
                  </p>
                </div>
                <span className="text-[11px] font-black shrink-0 ml-2"
                  style={{ color: row.odds >= 0 ? "#00E676" : "rgba(255,255,255,0.6)" }}>
                  {fmtOdds(row.odds)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════
          PARLAY TAB
      ══════════════════════════════════════════ */}
      {entries.length > 0 && activeTab === "parlay" && (
        <div className="flex flex-col">
          {entries.length < 2 ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <TrendingUp size={22} style={{ color: "rgba(255,255,255,0.08)" }} />
              <p className="text-[11px] font-bold text-white">Need 2+ picks for a parlay</p>
              <p className="text-[9px]" style={{ color: "#8B8E98" }}>
                Add at least 2 selections to build a parlay.
              </p>
            </div>
          ) : (
            <>
              {/* Parlay summary row */}
              <div className="flex items-center justify-between px-3.5 py-2.5"
                style={{ borderBottom: "1px solid #2A2B32" }}>
                <div>
                  <p className="text-[12px] font-black text-white">{entries.length} Pick Parlay</p>
                  <p className="text-[9px] mt-0.5" style={{ color: "#8B8E98" }}>
                    Combined odds
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[16px] font-black" style={{ color: "#00E676" }}>
                    {combinedDecimal.toFixed(2)}×
                  </p>
                  <button className="text-[8px] font-black uppercase tracking-wide px-2 py-0.5 rounded"
                    style={{ background: "rgba(0,230,118,0.08)", border: "1px solid rgba(0,230,118,0.2)", color: "#00E676" }}>
                    Cash Out
                  </button>
                </div>
              </div>

              {/* Picks list */}
              <div className="flex flex-col px-3 pt-2 gap-1.5">
                {entries.map(e => (
                  <div key={e.selectionId} className="flex items-center gap-2 py-1.5 px-2 rounded-lg"
                    style={{ background: "#17181E", border: "1px solid #2A2B32" }}>
                    <button onClick={() => onRemove(e.selectionId)}
                      className="shrink-0 rounded-full p-0.5 transition-opacity hover:opacity-70"
                      style={{ border: "1px solid rgba(255,106,0,0.4)", color: "#FF6A00" }}>
                      <X size={9} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold text-white truncate">{e.teamName}</p>
                      <p className="text-[8px] uppercase tracking-wide" style={{ color: "#8B8E98" }}>
                        Moneyline
                      </p>
                    </div>
                    <span className="text-[10px] font-black shrink-0"
                      style={{ color: e.odds >= 0 ? "#00E676" : "rgba(255,255,255,0.55)" }}>
                      {fmtOdds(e.odds)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Wager controls */}
              <div className="px-3 pt-3 pb-3 flex flex-col gap-2">
                {/* Available chips */}
                {chips !== undefined && (
                  <p className="text-[9px]" style={{ color: "#8B8E98" }}>
                    Available: <span className="font-bold" style={{ color: "#00E676" }}>{chips.toLocaleString()}</span> chips
                  </p>
                )}
                {/* Quick-add row */}
                <div className="flex gap-1.5">
                  <QuickBtn label="+$100"  onClick={() => addToParlay(100)}  />
                  <QuickBtn label="+$500"  onClick={() => addToParlay(500)}  />
                  <QuickBtn label="+$1k"   onClick={() => addToParlay(1000)} />
                  {/* Custom input */}
                  <div className="flex-1 flex items-center px-2 rounded-md"
                    style={{ background: "#17181E", border: "1px solid #2A2B32" }}>
                    <span className="text-[10px] font-black" style={{ color: "#8B8E98" }}>$</span>
                    <input type="number" min={0} placeholder="0.00" value={parlayWager}
                      onChange={ev => setParlayWager(ev.target.value)}
                      className="w-full bg-transparent text-[11px] font-bold text-white outline-none pl-1"
                      style={{ caretColor: "#00E676" }} />
                  </div>
                </div>

                {/* Validation / place error */}
                {(hasSameGame || placeError || (chipsKnown && parlayWagerNum > 0 && chips !== undefined && parlayWagerNum > chips)) && (
                  <p className="text-[9px] font-bold" style={{ color: "#ef4444" }}>
                    {hasSameGame
                      ? "Can't parlay both sides of the same game"
                      : placeError ?? "Insufficient chips"}
                  </p>
                )}

                {/* CTA block */}
                {(() => {
                  const insufficient = chipsKnown && chips !== undefined && parlayWagerNum > chips;
                  const canPlace = parlayWagerNum > 0 && !insufficient && !hasSameGame && !placing;
                  return (
                    <button onClick={() => onPlace(parlayWager)}
                      disabled={!canPlace}
                      className="w-full rounded-xl py-3 flex flex-col items-center transition-opacity active:opacity-80"
                      style={{
                        background: canPlace
                          ? "linear-gradient(135deg, #FF6A00, #cc5500)"
                          : "#17181E",
                        border: canPlace ? "none" : "1px solid #2A2B32",
                        boxShadow: canPlace ? "0 0 18px rgba(255,106,0,0.3)" : "none",
                        opacity: placing ? 0.6 : 1,
                        cursor: canPlace ? "pointer" : "not-allowed",
                      }}>
                      <span className="text-[12px] font-black uppercase tracking-widest"
                        style={{ color: canPlace ? "#fff" : "#8B8E98" }}>
                        {placing
                          ? "Placing…"
                          : hasSameGame
                          ? "Invalid Parlay"
                          : insufficient
                          ? "Insufficient Chips"
                          : parlayWagerNum > 0
                          ? "Place Parlay"
                          : "Enter Wager Amount"}
                      </span>
                      {canPlace && (
                        <span className="text-[9px] mt-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>
                          ${parlayWager} pays ${parlayPayout.toFixed(2)}
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════
          SINGLES TAB
      ══════════════════════════════════════════ */}
      {entries.length > 0 && activeTab === "singles" && (
        <div className="flex flex-col gap-2 p-3">
          {entries.map(e => {
            const sw     = getSingleWager(e);
            const swNum  = parseFloat(sw) || 0;
            const payout = swNum > 0 ? swNum * americanToDecimal(e.odds) : 0;
            return (
              <div key={e.selectionId} className="rounded-xl overflow-hidden"
                style={{ background: "#17181E", border: "1px solid #2A2B32" }}>
                {/* Pick header */}
                <div className="flex items-start justify-between px-3 pt-2.5 pb-1.5"
                  style={{ borderBottom: "1px solid #2A2B32" }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] uppercase tracking-wide truncate" style={{ color: "#8B8E98" }}>
                      {e.matchup}
                    </p>
                    <p className="text-[11px] font-bold text-white mt-0.5">{e.teamName}</p>
                    <p className="text-[8px] uppercase tracking-wide mt-0.5" style={{ color: "#8B8E98" }}>
                      Moneyline
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 ml-2">
                    <button onClick={() => onRemove(e.selectionId)}
                      className="rounded-full p-0.5 transition-opacity hover:opacity-70"
                      style={{ border: "1px solid rgba(255,106,0,0.4)", color: "#FF6A00" }}>
                      <X size={9} />
                    </button>
                    <span className="text-[13px] font-black"
                      style={{ color: e.odds >= 0 ? "#00E676" : "rgba(255,255,255,0.6)" }}>
                      {fmtOdds(e.odds)}
                    </span>
                  </div>
                </div>

                {/* Wager controls */}
                <div className="px-2.5 py-2 flex flex-col gap-1.5">
                  <div className="flex gap-1">
                    <QuickBtn label="+$100"  onClick={() => addToSingle(e, 100)}  />
                    <QuickBtn label="+$500"  onClick={() => addToSingle(e, 500)}  />
                    <QuickBtn label="+$1k"   onClick={() => addToSingle(e, 1000)} />
                    <div className="flex-1 flex items-center px-2 rounded-md"
                      style={{ background: "#111217", border: "1px solid #2A2B32" }}>
                      <span className="text-[10px] font-black" style={{ color: "#8B8E98" }}>$</span>
                      <input type="number" min={0} placeholder="0" value={sw}
                        onChange={ev => setSingleWager(e, ev.target.value)}
                        className="w-full bg-transparent text-[10px] font-bold text-white outline-none pl-1"
                        style={{ caretColor: "#00E676" }} />
                    </div>
                  </div>

                  {/* Payout / Place row */}
                  {(() => {
                    const insufficient = chipsKnown && chips !== undefined && swNum > chips;
                    const canPlace = swNum > 0 && !insufficient && !placing && !placeError;
                    return (
                      <>
                        {(placeError || insufficient) && (
                          <p className="text-[8px] font-bold" style={{ color: "#ef4444" }}>
                            {placeError ?? "Insufficient chips"}
                          </p>
                        )}
                        <button onClick={() => onPlace(sw, e)}
                          disabled={!canPlace}
                          className="w-full rounded-lg py-2 flex flex-col items-center transition-opacity active:opacity-80"
                          style={{
                            background: canPlace
                              ? "linear-gradient(135deg, #FF6A00, #cc5500)"
                              : "#111217",
                            border: canPlace ? "none" : "1px solid #2A2B32",
                            boxShadow: canPlace ? "0 0 12px rgba(255,106,0,0.25)" : "none",
                            opacity: placing ? 0.6 : 1,
                            cursor: canPlace ? "pointer" : "not-allowed",
                          }}>
                          <span className="text-[10px] font-black uppercase tracking-wide"
                            style={{ color: canPlace ? "#fff" : "#8B8E98" }}>
                            {placing ? "Placing…" : insufficient ? "Insufficient Chips" : swNum > 0 ? "Place Bet" : "Enter Wager"}
                          </span>
                          {canPlace && (
                            <span className="text-[8px] mt-0.5" style={{ color: "rgba(255,255,255,0.6)" }}>
                              ${sw} pays ${payout.toFixed(2)}
                            </span>
                          )}
                        </button>
                      </>
                    );
                  })()}

                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Pagination controls ─────────────────────────────────────────── */
function Pagination({
  page, totalPages, onPrev, onNext, onGo,
}: { page: number; totalPages: number; onPrev: () => void; onNext: () => void; onGo: (p: number) => void }) {
  if (totalPages <= 1) return null;

  // Show up to 5 page buttons around current page
  const range: number[] = [];
  const delta = 2;
  const left  = Math.max(1, page - delta);
  const right = Math.min(totalPages, page + delta);
  for (let i = left; i <= right; i++) range.push(i);

  const btnBase: React.CSSProperties = {
    minWidth: 32, height: 32, borderRadius: 8, fontSize: 11, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.15s",
  };
  const btnInactive: React.CSSProperties = {
    ...btnBase, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.4)", cursor: "pointer",
  };
  const btnActive: React.CSSProperties = {
    ...btnBase, background: "rgba(249,115,22,0.18)", border: "1px solid rgba(249,115,22,0.5)",
    color: "#f97316", cursor: "default", boxShadow: "0 0 10px rgba(249,115,22,0.2)",
  };
  const btnDisabled: React.CSSProperties = {
    ...btnBase, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.15)", cursor: "not-allowed",
  };

  return (
    <div className="flex items-center justify-center gap-1 pt-2 pb-1">
      <button onClick={onPrev} disabled={page === 1} style={page === 1 ? btnDisabled : btnInactive}>
        <ChevronLeft size={13} />
      </button>

      {left > 1 && (
        <>
          <button onClick={() => onGo(1)} style={btnInactive}>1</button>
          {left > 2 && <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, padding: "0 2px" }}>…</span>}
        </>
      )}

      {range.map(p => (
        <button key={p} onClick={() => onGo(p)} disabled={p === page} style={p === page ? btnActive : btnInactive}>
          {p}
        </button>
      ))}

      {right < totalPages && (
        <>
          {right < totalPages - 1 && <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 11, padding: "0 2px" }}>…</span>}
          <button onClick={() => onGo(totalPages)} style={btnInactive}>{totalPages}</button>
        </>
      )}

      <button onClick={onNext} disabled={page === totalPages} style={page === totalPages ? btnDisabled : btnInactive}>
        <ChevronRight size={13} />
      </button>
    </div>
  );
}

/* ── Trending / fill panel ───────────────────────────────────────── */

function TrendingPanel({ events }: { events: SbEvent[] }) {
  const shortName = (s: string) => s.split(" ").slice(-1)[0];
  const withOdds  = events.filter(e => e.bestHomeOdds !== null && e.bestAwayOdds !== null);

  const favorites = [...withOdds]
    .sort((a, b) => Math.min(a.bestHomeOdds!, a.bestAwayOdds!) - Math.min(b.bestHomeOdds!, b.bestAwayOdds!))
    .slice(0, 3);

  const underdogs = [...withOdds]
    .sort((a, b) => Math.max(b.bestHomeOdds!, b.bestAwayOdds!) - Math.max(a.bestHomeOdds!, a.bestAwayOdds!))
    .slice(0, 3);

  const panelBase: React.CSSProperties = {
    background: "rgba(255,255,255,0.022)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12,
    overflow: "hidden",
  };

  const rowSep = { borderBottom: "1px solid rgba(255,255,255,0.04)" } as React.CSSProperties;

  return (
    <div className="flex justify-center gap-3 mt-4">

      {/* Biggest Favorites */}
      <div style={{ ...panelBase, width: 260 }}>
        <div className="flex items-center gap-2 px-3 py-2"
          style={{ background: "rgba(34,197,94,0.06)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <TrendingUp size={11} style={{ color: "#22c55e" }} />
          <span className="text-[9.5px] font-black uppercase tracking-widest" style={{ color: "#22c55e" }}>
            Biggest Favorites
          </span>
        </div>
        {favorites.length === 0
          ? <p className="text-[10px] text-center py-6" style={{ color: "rgba(255,255,255,0.2)" }}>No data</p>
          : favorites.map((ev, i) => {
              const favOdds = Math.min(ev.bestHomeOdds!, ev.bestAwayOdds!);
              const favTeam = ev.bestHomeOdds! <= ev.bestAwayOdds! ? ev.homeTeam : ev.awayTeam;
              return (
                <div key={ev.id} className="flex items-center justify-between px-3 py-2"
                  style={i < favorites.length - 1 ? rowSep : {}}>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-white truncate">{shortName(favTeam)} ML</p>
                    <p className="text-[8px] truncate" style={{ color: "rgba(255,255,255,0.28)" }}>{ev.league}</p>
                  </div>
                  <span className="text-[11px] font-black shrink-0 ml-2" style={{ color: "#22c55e" }}>{fmtOdds(favOdds)}</span>
                </div>
              );
            })}
      </div>

      {/* Biggest Underdogs */}
      <div style={{ ...panelBase, width: 260 }}>
        <div className="flex items-center gap-2 px-3 py-2"
          style={{ background: "rgba(249,115,22,0.06)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <TrendingUp size={11} style={{ color: "#f97316", transform: "rotate(180deg)" }} />
          <span className="text-[9.5px] font-black uppercase tracking-widest" style={{ color: "#f97316" }}>
            Biggest Underdogs
          </span>
        </div>
        {underdogs.length === 0
          ? <p className="text-[10px] text-center py-6" style={{ color: "rgba(255,255,255,0.2)" }}>No data</p>
          : underdogs.map((ev, i) => {
              const dogOdds = Math.max(ev.bestHomeOdds!, ev.bestAwayOdds!);
              const dogTeam = ev.bestHomeOdds! >= ev.bestAwayOdds! ? ev.homeTeam : ev.awayTeam;
              return (
                <div key={ev.id} className="flex items-center justify-between px-3 py-2"
                  style={i < underdogs.length - 1 ? rowSep : {}}>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-white truncate">{shortName(dogTeam)} ML</p>
                    <p className="text-[8px] truncate" style={{ color: "rgba(255,255,255,0.28)" }}>{ev.league}</p>
                  </div>
                  <span className="text-[11px] font-black shrink-0 ml-2" style={{ color: "#f97316" }}>{fmtOdds(dogOdds)}</span>
                </div>
              );
            })}
      </div>


    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SportsbookPage
   ══════════════════════════════════════════════════════════════════ */
export function SportsbookPage() {
  const [sport,      setSport]      = useState<SportTab>("Live");
  const [events,     setEvents]     = useState<SbEvent[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [placed,     setPlaced]     = useState(false);
  const [slip,       setSlip]       = useState<BetSlipEntry[]>([]);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());

  // Search
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState("");

  // Separate all-sports feed for the ticker — always live across every tab
  const [allEvents, setAllEvents] = useState<SbEvent[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/sportsbook/odds?sport=all", { signal: ctrl.signal });
        if (res.ok) setAllEvents((await res.json() as OddsResponse).events);
      } catch { /* silent — ticker just stays empty */ }
    })();
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/sportsbook/odds?sport=all");
        if (res.ok) setAllEvents((await res.json() as OddsResponse).events);
      } catch { /* silent */ }
    }, REFRESH_MS);
    return () => { ctrl.abort(); clearInterval(id); };
  }, []);

  // Live scores — fetched for each live sport key, cached 1 hour server-side
  const [scores, setScores] = useState<ScoreMap>({});
  useEffect(() => {
    const liveKeys = [...new Set(allEvents.filter(isLiveNow).map(e => e.sportKey))];
    if (liveKeys.length === 0) return;
    (async () => {
      const maps = await Promise.all(liveKeys.map(async k => {
        try {
          const res = await fetch(`/api/sportsbook/scores?sportKey=${encodeURIComponent(k)}`);
          if (!res.ok) return {};
          const data = await res.json() as { scores: { id: string; homeScore: string | null; awayScore: string | null }[] };
          const m: ScoreMap = {};
          for (const s of data.scores) m[s.id] = { home: s.homeScore, away: s.awayScore };
          return m;
        } catch { return {}; }
      }));
      setScores(Object.assign({}, ...maps));
    })();
  }, [allEvents]);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derived: 7-day window (keep live events always) → sort live-first then soonest → LIVE tab filter → search → paginate
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const upcomingEvents = events
    .filter(e => {
      if (isLiveNow(e)) return true;                      // always show in-progress
      const t = new Date(e.commenceTime).getTime();
      return t >= nowMs && t <= nowMs + SEVEN_DAYS_MS;    // next 7 days only
    })
    .sort((a, b) => {
      const aLive = isLiveNow(a);
      const bLive = isLiveNow(b);
      if (aLive !== bLive) return aLive ? -1 : 1;
      return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    });

  const filteredEvents = upcomingEvents
    .filter(e => sport === "Live" ? isLiveNow(e) : !isLiveNow(e))
    .filter(e => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        e.homeTeam.toLowerCase().includes(q) ||
        e.awayTeam.toLowerCase().includes(q) ||
        e.league.toLowerCase().includes(q) ||
        (e.eventName?.toLowerCase().includes(q) ?? false) ||
        (e.promotion?.toLowerCase().includes(q) ?? false)
      );
    });
  const totalPages  = Math.max(1, Math.ceil(filteredEvents.length / 25));
  const safePage    = Math.min(page, totalPages);
  const pagedEvents = filteredEvents.slice((safePage - 1) * 25, safePage * 25);

  const applyResponse = (data: OddsResponse) => {
    setEvents(data.events);
    setError(null);
    setPage(1);
  };

  const fetchOdds = useCallback(async (tab: SportTab, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const param = tab === "Live" ? "all" : tab;
      const res   = await fetch(`/api/sportsbook/odds?sport=${encodeURIComponent(param)}`, { signal });
      if (res.status === 503) { setError((await res.json() as { error: string }).error); return; }
      if (res.status === 429) { setError("Odds API quota exceeded. Try again later."); return; }
      if (!res.ok)            { setError(`Server error (${res.status}).`); return; }
      applyResponse(await res.json() as OddsResponse);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Mount + auto-refresh
  useEffect(() => {
    const ctrl = new AbortController();
    fetchOdds(sport, ctrl.signal);
    intervalRef.current = setInterval(() => fetchOdds(sport), REFRESH_MS);
    return () => { ctrl.abort(); if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [sport, fetchOdds]);

  // Reset to page 1 when search changes
  useEffect(() => { setPage(1); }, [search]);


  function handleSportChange(s: SportTab) {
    setSport(s); setSelected(new Set()); setSlip([]); setPage(1); setSearch("");
  }

  function toggleSelection(event: SbEvent, side: "home" | "away") {
    const selId = `${event.id}-${side}`;
    const odds  = side === "home" ? event.bestHomeOdds : event.bestAwayOdds;
    const team  = side === "home" ? event.homeTeam     : event.awayTeam;
    if (odds === null) return;
    setSelected(prev => { const n = new Set(prev); n.has(selId) ? n.delete(selId) : n.add(selId); return n; });
    setSlip(prev => {
      const exists = prev.find(e => e.selectionId === selId);
      if (exists) return prev.filter(e => e.selectionId !== selId);
      return [...prev, {
        selectionId: selId,
        eventId: event.id,
        side,
        teamName: team,
        matchup: `${event.homeTeam} vs ${event.awayTeam}`,
        odds,
        wager: "",
      }];
    });
  }

  function removeEntry(selectionId: string) {
    setSlip(prev => prev.filter(e => e.selectionId !== selectionId));
    setSelected(prev => { const n = new Set(prev); n.delete(selectionId); return n; });
  }
  function clearSlip() { setSlip([]); setSelected(new Set()); }

  /* ── Chip balance ───────────────────────────────────────────────── */
  const { playerId, sessionToken } = useStore();
  const { data: currentPlayer }   = useGetPlayer(playerId!, { query: { enabled: !!playerId } });
  const { chips: liveChips }      = usePlayerSocket(playerId ?? null, sessionToken);
  const chips = liveChips ?? currentPlayer?.chips ?? 0;

  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placing,    setPlacing]    = useState(false);

  /* true once we have a real balance reading (WS or query) */
  const chipsKnown = liveChips !== null || currentPlayer !== undefined;

  async function placeBets(wager: string, entry?: BetSlipEntry) {
    const w = Math.floor(parseFloat(wager) || 0);
    const isSingle = !!entry;
    const picks = isSingle
      ? [{ teamName: entry.teamName, odds: entry.odds, matchup: entry.matchup }]
      : slip.map(e => ({ teamName: e.teamName, odds: e.odds, matchup: e.matchup }));
    const betType = isSingle ? "single" : "parlay";

    console.log("[placeBets] wager=", wager, "w=", w, "betType=", betType, "picks=", picks.length);
    if (!sessionToken || !playerId) { setPlaceError("Not logged in"); return; }
    if (w <= 0) { setPlaceError("Enter a wager amount"); return; }
    if (chipsKnown && w > chips) { setPlaceError("Insufficient chips"); return; }
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/sportbets/public/live-bet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ wager: w, betType, picks }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      console.log("[placeBets] response status=", res.status, "data=", data);
      if (!res.ok) { setPlaceError(data.error ?? "Failed to place bet"); return; }
      setPlaced(true);
      if (isSingle) {
        // Remove only this pick; keep the rest of the slip intact
        setSlip(prev => prev.filter(e => e.selectionId !== entry.selectionId));
        setSelected(prev => { const n = new Set(prev); n.delete(entry.selectionId); return n; });
      } else {
        clearSlip();
      }
      setTimeout(() => setPlaced(false), 3500);
    } catch (err) {
      console.error("[placeBets] fetch error:", err);
      setPlaceError("Network error — try again");
    } finally {
      setPlacing(false);
    }
  }

  const liveEvents = events.filter(e => e.live);

  return (
    <PageWrapper title="SPORTSBOOK" accentColor="#f97316">

      {/* Placed toast */}
      {placed && (
        <div className="fixed bottom-8 left-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-xl text-[12px] font-black uppercase tracking-wide"
          style={{
            transform: "translateX(-50%)", whiteSpace: "nowrap",
            background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.38)",
            color: "#22c55e", boxShadow: "0 0 24px rgba(34,197,94,0.28)", backdropFilter: "blur(8px)",
          }}>
          ✓ Bet placed!
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-xl mb-4"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#ef4444" }}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} style={{ flexShrink: 0 }} />
            <span className="text-[12px] font-bold">{error}</span>
          </div>
          <button onClick={() => fetchOdds(sport)}
            className="text-[11px] font-black uppercase tracking-wide px-3 py-1 rounded-lg shrink-0"
            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
            Retry
          </button>
        </div>
      )}

      {/* Smooth scrolling ticker — only currently live games, all sports, all tabs */}
      <SportsTicker items={allEvents.filter(isLiveNow)} scores={scores} />

      <div className="flex gap-6">
        {/* ── Events column ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-3">

          {/* Sport tabs — nowrap so tabs never reflow; transition-colors only so layout never shifts */}
          <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-0.5"
            style={{ scrollbarWidth: "none" }}>
            {SPORTS.map(s => {
              const isLiveTab = s === "Live";
              const isActive  = sport === s;
              const liveCount = isLiveTab ? events.filter(isLiveNow).length : 0;
              return (
                <button key={s} onClick={() => handleSportChange(s)}
                  className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-lg transition-colors duration-150 shrink-0 whitespace-nowrap"
                  style={{
                    boxSizing: "border-box",
                    background: isActive
                      ? isLiveTab ? "rgba(34,197,94,0.15)" : "rgba(249,115,22,0.18)"
                      : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isActive
                      ? isLiveTab ? "rgba(34,197,94,0.5)" : "rgba(249,115,22,0.5)"
                      : "rgba(255,255,255,0.08)"}`,
                    color: isActive
                      ? isLiveTab ? "#22c55e" : "#f97316"
                      : "rgba(255,255,255,0.4)",
                    boxShadow: isActive
                      ? isLiveTab ? "0 0 10px rgba(34,197,94,0.2)" : "0 0 10px rgba(249,115,22,0.2)"
                      : "none",
                  }}>
                  {isLiveTab && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        background: "#22c55e",
                        boxShadow: liveCount > 0 ? "0 0 6px #22c55e" : "none",
                        animation: liveCount > 0 ? "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" : "none",
                      }} />
                  )}
                  {s}
                  {/* always reserve badge space — hide it when no live count to prevent tab width shift */}
                  {isLiveTab && (
                    <span className="text-[9px] font-black px-1 py-0.5 rounded-full shrink-0"
                      style={{
                        background: "#22c55e22",
                        color: "#22c55e",
                        border: "1px solid #22c55e44",
                        visibility: liveCount > 0 && !loading ? "visible" : "hidden",
                      }}>
                      {liveCount > 0 ? liveCount : "0"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search + per-page + status */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="flex-1 relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: "rgba(255,255,255,0.25)" }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search team, fighter, league…"
                className="w-full bg-transparent text-[11px] text-white placeholder-white/20 outline-none pl-8 pr-3 py-1.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}
              />
            </div>

          </div>

          {/* Results summary + "Next 7 Days" badge */}
          {!loading && !error && events.length > 0 && (
            <div className="flex items-center justify-between text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
              <div className="flex items-center gap-2">
                <span>
                  {filteredEvents.length === upcomingEvents.length
                    ? `${filteredEvents.length} event${filteredEvents.length !== 1 ? "s" : ""}`
                    : `${filteredEvents.length} of ${upcomingEvents.length} events`}
                </span>
              </div>
              {search && filteredEvents.length === 0 && (
                <button onClick={() => setSearch("")} className="text-[10px]" style={{ color: "#f97316" }}>
                  Clear search
                </button>
              )}
            </div>
          )}

          {/* Loading skeletons */}
          {loading && events.length === 0 && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-xl h-[80px] animate-pulse"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
              ))}
            </div>
          )}

          {/* No events — sport has no odds at all */}
          {!loading && !error && events.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Lock size={28} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-[13px] font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>
                {sport === "Live"
                  ? "No live games right now."
                  : sport === "UFC"
                    ? "No UFC odds currently available."
                    : `No current odds available for ${sport}.`}
              </p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                {sport === "Live"
                  ? "Check back when games are in progress, or browse upcoming events by sport."
                  : sport === "UFC"
                    ? "Only official UFC events are shown. Check back closer to the next event."
                    : "This sport may be out of season. Check back later or try another tab."}
              </p>
            </div>
          )}

          {/* No events within 7-day window (odds exist but all beyond the window) */}
          {!loading && !error && events.length > 0 && upcomingEvents.length === 0 && sport !== "Live" && !search && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Lock size={28} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-[13px] font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>
                No events scheduled within the next 7 days.
              </p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                {sport === "UFC"
                  ? "No UFC events in the next 7 days. Check back closer to the next card."
                  : `No ${sport} games in the next 7 days. Try another sport or check back soon.`}
              </p>
            </div>
          )}

          {/* No live events on LIVE tab */}
          {!loading && !error && sport === "Live" && filteredEvents.length === 0 && !search && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Lock size={28} style={{ color: "rgba(255,255,255,0.1)" }} />
              <p className="text-[13px] font-bold" style={{ color: "rgba(255,255,255,0.35)" }}>
                No live games right now.
              </p>
              <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.2)" }}>
                Check back when games are in progress, or browse upcoming events by sport.
              </p>
            </div>
          )}

          {/* No search results */}
          {!loading && !error && upcomingEvents.length > 0 && filteredEvents.length === 0 && search && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search size={24} style={{ color: "rgba(255,255,255,0.08)" }} />
              <p className="text-[12px]" style={{ color: "rgba(255,255,255,0.3)" }}>
                No events match <span style={{ color: "#f97316" }}>"{search}"</span>
              </p>
              <button onClick={() => setSearch("")} className="text-[11px] mt-1"
                style={{ color: "#f97316" }}>Clear search</button>
            </div>
          )}

          {/* Event cards — responsive grid */}
          {pagedEvents.length > 0 && (
            <div className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
              {pagedEvents.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  selHome={selected.has(`${event.id}-home`)}
                  selAway={selected.has(`${event.id}-away`)}
                  onHome={() => toggleSelection(event, "home")}
                  onAway={() => toggleSelection(event, "away")}
                  score={scores[event.id]}
                />
              ))}
            </div>
          )}

          {/* Pagination */}
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage(p => Math.max(1, p - 1))}
            onNext={() => setPage(p => Math.min(totalPages, p + 1))}
            onGo={setPage}
          />

          {/* Trending / fill section — visible when events loaded */}
          {!loading && !error && pagedEvents.length > 0 && (
            <TrendingPanel events={pagedEvents} />
          )}
        </div>

        {/* ── Bet slip column ── */}
        <div className="shrink-0" style={{ width: 280 }}>
          <div className="sticky top-0">
            <BetSlip
              entries={slip}
              popularEvents={pagedEvents}
              onRemove={removeEntry}
              onClear={clearSlip}
              onPlace={placeBets}
              onSelect={toggleSelection}
              chips={chips}
              chipsKnown={chipsKnown}
              placeError={placeError}
              placing={placing}
            />
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}
