import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireSportbetsOrAbove } from "../middleware/auth.js";

const router = Router();

/* ── Types ─────────────────────────────────────────────────────────────── */

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

interface CacheEntry {
  events: SbEvent[];
  fetchedAt: string;
  expiresAt: number;
}

/* ── Cache ─────────────────────────────────────────────────────────────── */

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/* ── Sport key mapping (frontend tab → the-odds-api.com sport keys) ─────── */

const UNSUPPORTED_SPORTS = new Set(["Tennis", "Golf"]);

const SPORT_TO_KEYS: Record<string, string[]> = {
  "NFL":                ["americanfootball_nfl"],
  "NBA":                ["basketball_nba"],
  "MLB":                ["baseball_mlb"],
  "NHL":                ["icehockey_nhl"],
  "UFC":                ["mma_mixed_martial_arts"],
  "Soccer":             ["soccer_epl", "soccer_usa_mls", "soccer_spain_la_liga", "soccer_germany_bundesliga", "soccer_france_ligue_one"],
  "Boxing":             ["boxing_boxing"],
  "College Football":   ["americanfootball_ncaaf"],
  "College Basketball": ["basketball_ncaab"],
};

const SPORT_KEY_TO_SPORT: Record<string, string> = {};
const SPORT_KEY_TO_LEAGUE: Record<string, string> = {
  "americanfootball_nfl":          "NFL",
  "basketball_nba":                "NBA",
  "baseball_mlb":                  "MLB",
  "icehockey_nhl":                 "NHL",
  "mma_mixed_martial_arts":        "UFC",
  "soccer_epl":                    "EPL",
  "soccer_usa_mls":                "MLS",
  "soccer_spain_la_liga":          "La Liga",
  "soccer_germany_bundesliga":     "Bundesliga",
  "soccer_france_ligue_one":       "Ligue 1",
  "boxing_boxing":                 "Boxing",
  "americanfootball_ncaaf":        "NCAAF",
  "basketball_ncaab":              "NCAAB",
};

for (const [sport, keys] of Object.entries(SPORT_TO_KEYS)) {
  for (const key of keys) SPORT_KEY_TO_SPORT[key] = sport;
}

/* ── Decimal → American odds conversion ─────────────────────────────────── */

function decimalToAmerican(dec: number): number {
  if (isNaN(dec) || dec <= 1) return -110;
  if (dec >= 2.0) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

/* ── Sport name → sportKey mapping (for staff events) ───────────────────── */

const STAFF_SPORT_TO_KEY: Record<string, string> = {
  "NFL":                "americanfootball_nfl",
  "NBA":                "basketball_nba",
  "MLB":                "baseball_mlb",
  "NHL":                "icehockey_nhl",
  "UFC":                "mma_mixed_martial_arts",
  "Soccer":             "soccer_usa_mls",
  "Boxing":             "boxing_boxing",
  "College Football":   "americanfootball_ncaaf",
  "College Basketball": "basketball_ncaab",
};

/* ── Staff events (sport_bet_events) — always fetched fresh, no cache ────── */
// These appear on the player sportsbook immediately after creation.
// status=open  → visible + bettable odds
// status=closed → visible but odds disabled (null)
// status=settled/void → hidden from sportsbook

async function getStaffEvents(): Promise<SbEvent[]> {
  try {
    const rows = await db.execute(sql`
      SELECT
        e.id, e.title, e.league, e.sport, e.game_date, e.status,
        json_agg(json_build_object('label', o.label, 'odds', o.odds) ORDER BY o.id ASC) AS options
      FROM sport_bet_events e
      JOIN sport_bet_event_options o ON o.event_id = e.id
      WHERE e.status IN ('open', 'closed')
      GROUP BY e.id, e.title, e.league, e.sport, e.game_date, e.status
      HAVING COUNT(o.id) >= 2
      ORDER BY e.game_date ASC NULLS LAST, e.id ASC
    `);

    return (rows.rows as any[]).map(r => {
      const opts    = r.options as Array<{ label: string; odds: string }>;
      const home    = opts[0];
      const away    = opts[1];
      const sport   = r.sport || r.league || "Other";
      const sportKey = STAFF_SPORT_TO_KEY[sport] ?? "other";
      const isOpen  = r.status === "open";
      const homeOdds = isOpen ? decimalToAmerican(parseFloat(home.odds)) : null;
      const awayOdds = isOpen ? decimalToAmerican(parseFloat(away.odds)) : null;

      return {
        id: `staff-${r.id}`,
        sportKey,
        sport,
        league: r.league || sport,
        homeTeam: home.label,
        awayTeam: away.label,
        commenceTime: r.game_date
          ? new Date(r.game_date as string).toISOString()
          : new Date().toISOString(),
        live: false,
        bestHomeOdds: homeOdds,
        bestAwayOdds: awayOdds,
        bestHomeBook: "staff",
        bestAwayBook: "staff",
        eventName: r.title,
      } satisfies SbEvent;
    });
  } catch (e) {
    console.error("[sportsbook] getStaffEvents error:", e);
    return [];
  }
}

function filterStaffForSport(events: SbEvent[], sport: string): SbEvent[] {
  const supported = events.filter(e => !UNSUPPORTED_SPORTS.has(e.sport));
  if (sport === "all") return supported;
  if (sport === "Live") return []; // staff events are never live
  return supported.filter(e => e.sport === sport);
}

/* ── Manual events helpers ──────────────────────────────────────────────── */

async function getManualEvents(): Promise<SbEvent[]> {
  try {
    const rows = await db.execute(sql`
      SELECT id, sport, sport_key, league, home_team, away_team,
             home_odds, away_odds, commence_time, live, event_name
      FROM manual_sportsbook_events
      WHERE active = true
      ORDER BY commence_time ASC
    `);
    return (rows.rows as any[]).map(r => ({
      id: `manual-${r.id}`,
      sportKey: String(r.sport_key),
      sport: String(r.sport),
      league: String(r.league),
      homeTeam: String(r.home_team),
      awayTeam: String(r.away_team),
      commenceTime: new Date(r.commence_time as string).toISOString(),
      live: Boolean(r.live),
      bestHomeOdds: Number(r.home_odds),
      bestAwayOdds: Number(r.away_odds),
      bestHomeBook: "manual",
      bestAwayBook: "manual",
      eventName: r.event_name ? String(r.event_name) : undefined,
    }));
  } catch {
    return [];
  }
}

function filterManualForSport(events: SbEvent[], sport: string): SbEvent[] {
  const supported = events.filter(e => !UNSUPPORTED_SPORTS.has(e.sport));
  if (sport === "all") return supported;
  if (sport === "Live") return supported.filter(e => e.live);
  return supported.filter(e => e.sport === sport);
}

function clearAllCache() {
  cache.clear();
}

/* ── Fetch from the-odds-api.com ────────────────────────────────────────── */

async function fetchFromOddsApi(sportKeys: string[]): Promise<SbEvent[]> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const events: SbEvent[] = [];

  for (const sportKey of sportKeys) {
    try {
      const url =
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds` +
        `?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
      const res = await fetch(url);
      if (res.status === 422) continue; // sport not active / off-season
      if (res.status === 401) throw new Error("INVALID_KEY");
      if (res.status === 429) throw new Error("QUOTA");
      if (!res.ok) continue;

      const data = (await res.json()) as any[];
      for (const ev of data) {
        let bestHomeOdds: number | null = null;
        let bestAwayOdds: number | null = null;
        let bestHomeBook = "";
        let bestAwayBook = "";

        for (const book of ev.bookmakers ?? []) {
          const h2h = (book.markets ?? []).find((m: any) => m.key === "h2h");
          if (!h2h) continue;
          const home = (h2h.outcomes ?? []).find((o: any) => o.name === ev.home_team);
          const away = (h2h.outcomes ?? []).find((o: any) => o.name === ev.away_team);
          if (home?.price != null && (bestHomeOdds === null || home.price > bestHomeOdds)) {
            bestHomeOdds = home.price;
            bestHomeBook = book.key;
          }
          if (away?.price != null && (bestAwayOdds === null || away.price > bestAwayOdds)) {
            bestAwayOdds = away.price;
            bestAwayBook = book.key;
          }
        }

        events.push({
          id: ev.id,
          sportKey,
          sport: SPORT_KEY_TO_SPORT[sportKey] ?? sportKey,
          league: SPORT_KEY_TO_LEAGUE[sportKey] ?? sportKey,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          commenceTime: ev.commence_time,
          live: false,
          bestHomeOdds,
          bestAwayOdds,
          bestHomeBook,
          bestAwayBook,
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "INVALID_KEY" || msg === "QUOTA") throw err;
      // network error on individual sport — skip and continue
    }
  }

  return events;
}

/* ── Mock data fallback (shown when ODDS_API_KEY is not configured) ─────── */

function makeMockEvents(): SbEvent[] {
  const now = Date.now();
  const h   = 3_600_000;
  const d   = 86_400_000;

  const mock: Array<Omit<SbEvent, "id">> = [
    // Live
    { sportKey: "basketball_nba",          sport: "NBA",              league: "NBA",         homeTeam: "Boston Celtics",          awayTeam: "Golden State Warriors",  commenceTime: new Date(now - 45 * 60_000).toISOString(),  live: true,  bestHomeOdds: -135, bestAwayOdds:  115, bestHomeBook: "draftkings", bestAwayBook: "fanduel" },
    { sportKey: "baseball_mlb",            sport: "MLB",              league: "MLB",         homeTeam: "New York Yankees",        awayTeam: "Los Angeles Dodgers",    commenceTime: new Date(now - 2  * h).toISOString(),       live: true,  bestHomeOdds:  110, bestAwayOdds: -130, bestHomeBook: "betmgm",    bestAwayBook: "draftkings" },
    // NFL
    { sportKey: "americanfootball_nfl",    sport: "NFL",              league: "NFL",         homeTeam: "Kansas City Chiefs",      awayTeam: "Philadelphia Eagles",    commenceTime: new Date(now + 2  * d).toISOString(),       live: false, bestHomeOdds: -175, bestAwayOdds:  155, bestHomeBook: "draftkings", bestAwayBook: "fanduel" },
    { sportKey: "americanfootball_nfl",    sport: "NFL",              league: "NFL",         homeTeam: "San Francisco 49ers",     awayTeam: "Dallas Cowboys",         commenceTime: new Date(now + 2  * d + h).toISOString(),   live: false, bestHomeOdds: -110, bestAwayOdds: -110, bestHomeBook: "betmgm",    bestAwayBook: "betmgm" },
    { sportKey: "americanfootball_nfl",    sport: "NFL",              league: "NFL",         homeTeam: "Miami Dolphins",          awayTeam: "Buffalo Bills",          commenceTime: new Date(now + 3  * d).toISOString(),       live: false, bestHomeOdds:  140, bestAwayOdds: -160, bestHomeBook: "draftkings", bestAwayBook: "draftkings" },
    // NBA
    { sportKey: "basketball_nba",          sport: "NBA",              league: "NBA",         homeTeam: "Denver Nuggets",          awayTeam: "Miami Heat",             commenceTime: new Date(now + d).toISOString(),            live: false, bestHomeOdds: -220, bestAwayOdds:  185, bestHomeBook: "fanduel",   bestAwayBook: "betmgm" },
    { sportKey: "basketball_nba",          sport: "NBA",              league: "NBA",         homeTeam: "Milwaukee Bucks",         awayTeam: "Phoenix Suns",           commenceTime: new Date(now + d  + 2 * h).toISOString(),  live: false, bestHomeOdds: -145, bestAwayOdds:  125, bestHomeBook: "draftkings", bestAwayBook: "fanduel" },
    // MLB
    { sportKey: "baseball_mlb",            sport: "MLB",              league: "MLB",         homeTeam: "Houston Astros",          awayTeam: "Atlanta Braves",         commenceTime: new Date(now + 18 * h).toISOString(),       live: false, bestHomeOdds: -150, bestAwayOdds:  130, bestHomeBook: "betmgm",    bestAwayBook: "draftkings" },
    { sportKey: "baseball_mlb",            sport: "MLB",              league: "MLB",         homeTeam: "Chicago Cubs",            awayTeam: "St. Louis Cardinals",    commenceTime: new Date(now + 20 * h).toISOString(),       live: false, bestHomeOdds:  105, bestAwayOdds: -125, bestHomeBook: "fanduel",   bestAwayBook: "betmgm" },
    // NHL
    { sportKey: "icehockey_nhl",           sport: "NHL",              league: "NHL",         homeTeam: "Vegas Golden Knights",    awayTeam: "Colorado Avalanche",     commenceTime: new Date(now + d  + 4 * h).toISOString(),  live: false, bestHomeOdds: -140, bestAwayOdds:  120, bestHomeBook: "draftkings", bestAwayBook: "fanduel" },
    { sportKey: "icehockey_nhl",           sport: "NHL",              league: "NHL",         homeTeam: "Tampa Bay Lightning",     awayTeam: "Toronto Maple Leafs",    commenceTime: new Date(now + 2  * d + 2 * h).toISOString(),live: false, bestHomeOdds:  120, bestAwayOdds: -140, bestHomeBook: "betmgm",    bestAwayBook: "betmgm" },
    // UFC
    { sportKey: "mma_mixed_martial_arts",  sport: "UFC",              league: "UFC",         homeTeam: "Jon Jones",               awayTeam: "Stipe Miocic",           commenceTime: new Date(now + 4  * d).toISOString(),       live: false, bestHomeOdds: -280, bestAwayOdds:  230, bestHomeBook: "draftkings", bestAwayBook: "fanduel",   eventName: "UFC 312: Jones vs. Miocic" },
    { sportKey: "mma_mixed_martial_arts",  sport: "UFC",              league: "UFC",         homeTeam: "Alex Pereira",            awayTeam: "Jiri Prochazka",         commenceTime: new Date(now + 4  * d + 30 * 60_000).toISOString(), live: false, bestHomeOdds: -165, bestAwayOdds: 140, bestHomeBook: "betmgm", bestAwayBook: "draftkings", eventName: "UFC 312 Co-Main" },
    // Soccer
    { sportKey: "soccer_epl",              sport: "Soccer",           league: "EPL",         homeTeam: "Manchester City",         awayTeam: "Arsenal",                commenceTime: new Date(now + d  + 3 * h).toISOString(),  live: false, bestHomeOdds: -125, bestAwayOdds:  340, bestHomeBook: "fanduel",   bestAwayBook: "betmgm" },
    { sportKey: "soccer_usa_mls",          sport: "Soccer",           league: "MLS",         homeTeam: "LA Galaxy",               awayTeam: "Inter Miami",            commenceTime: new Date(now + 2  * d + h).toISOString(),  live: false, bestHomeOdds:  110, bestAwayOdds:  240, bestHomeBook: "draftkings", bestAwayBook: "draftkings" },
    { sportKey: "soccer_spain_la_liga",    sport: "Soccer",           league: "La Liga",     homeTeam: "Real Madrid",             awayTeam: "FC Barcelona",           commenceTime: new Date(now + 3  * d).toISOString(),       live: false, bestHomeOdds: -110, bestAwayOdds:  290, bestHomeBook: "betmgm",    bestAwayBook: "fanduel" },
    // Boxing
    { sportKey: "boxing_boxing",           sport: "Boxing",           league: "Boxing",      homeTeam: "Canelo Alvarez",          awayTeam: "David Benavidez",        commenceTime: new Date(now + 5  * d).toISOString(),       live: false, bestHomeOdds: -300, bestAwayOdds:  250, bestHomeBook: "draftkings", bestAwayBook: "fanduel",   eventName: "Super Middleweight WBC Title" },
    // College Football
    { sportKey: "americanfootball_ncaaf",  sport: "College Football", league: "NCAAF",       homeTeam: "Alabama Crimson Tide",    awayTeam: "Georgia Bulldogs",       commenceTime: new Date(now + 3  * d + h).toISOString(),  live: false, bestHomeOdds: -120, bestAwayOdds:  100, bestHomeBook: "fanduel",   bestAwayBook: "betmgm" },
    // College Basketball
    { sportKey: "basketball_ncaab",        sport: "College Basketball",league: "NCAAB",      homeTeam: "Duke Blue Devils",        awayTeam: "Kentucky Wildcats",      commenceTime: new Date(now + d  + h).toISOString(),      live: false, bestHomeOdds: -110, bestAwayOdds: -110, bestHomeBook: "draftkings", bestAwayBook: "fanduel" },
  ];

  return mock.map((e, i) => ({ ...e, id: `mock-${i}` }));
}

/* ── GET /sportsbook/odds?sport=NFL|NBA|...|all ─────────────────────────── */

router.get("/odds", async (req, res) => {
  const sport    = ((req.query.sport as string) ?? "all").trim();
  const cacheKey = sport;

  // Staff events and manual events are always fetched fresh (bypass cache)
  // so that newly created or updated staff events appear immediately.
  const [staffAll, manualAll] = await Promise.all([getStaffEvents(), getManualEvents()]);
  const staff  = filterStaffForSport(staffAll, sport);
  const manual = filterManualForSport(manualAll, sport);

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    // Cache hit for external API events — prepend fresh staff + manual events
    return res.json({ events: [...staff, ...manual, ...hit.events], cached: true, fetchedAt: hit.fetchedAt });
  }

  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    const all      = makeMockEvents();
    const filtered = sport === "all"
      ? all
      : sport === "Live"
        ? all.filter(e => e.live)
        : all.filter(e => e.sport === sport);
    const merged    = [...staff, ...manual, ...filtered];
    const fetchedAt = new Date().toISOString();
    // Cache only the mock/API portion, not staff events
    cache.set(cacheKey, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: merged, cached: false, fetchedAt });
  }

  try {
    const sportKeys =
      sport === "all" || sport === "Live"
        ? Object.values(SPORT_TO_KEYS).flat()
        : (SPORT_TO_KEYS[sport] ?? []);

    if (sportKeys.length === 0) {
      return res.json({ events: [...staff, ...manual], cached: false, fetchedAt: new Date().toISOString() });
    }

    const apiEvents = await fetchFromOddsApi(sportKeys);
    const filtered  = sport === "Live" ? apiEvents.filter(e => e.live) : apiEvents;
    const merged    = [...staff, ...manual, ...filtered];
    const fetchedAt = new Date().toISOString();
    // Cache only the API portion, not staff events
    cache.set(cacheKey, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: merged, cached: false, fetchedAt });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "QUOTA")       return res.status(429).json({ error: "Odds API quota exceeded. Try again later." });
    if (msg === "INVALID_KEY") return res.status(503).json({ error: "Invalid ODDS_API_KEY. Check server configuration." });
    return res.status(503).json({ error: "Could not fetch odds from external provider." });
  }
});

/* ── GET /sportsbook/scores?sportKey=... ────────────────────────────────── */

router.get("/scores", async (req, res) => {
  const sportKey = (req.query.sportKey as string | undefined)?.trim();
  if (!sportKey) return res.json({ scores: [] });

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return res.json({ scores: [] });

  try {
    const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/scores?apiKey=${apiKey}&daysFrom=1`;
    const r   = await fetch(url);
    if (!r.ok) return res.json({ scores: [] });
    const data = (await r.json()) as any[];
    const scores = data.map(ev => ({
      id:        ev.id,
      homeScore: (ev.scores ?? []).find((s: any) => s.name === ev.home_team)?.score ?? null,
      awayScore: (ev.scores ?? []).find((s: any) => s.name === ev.away_team)?.score ?? null,
    }));
    return res.json({ scores });
  } catch {
    return res.json({ scores: [] });
  }
});

/* ── POST /sportsbook/refresh?sport=... ─────────────────────────────────── */

router.post("/refresh", async (req, res) => {
  const sport = ((req.query.sport as string) ?? "all").trim();
  cache.delete(sport);

  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    const all      = makeMockEvents();
    const filtered = sport === "all"
      ? all
      : sport === "Live"
        ? all.filter(e => e.live)
        : all.filter(e => e.sport === sport);
    const fetchedAt = new Date().toISOString();
    cache.set(sport, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: filtered, cached: false, fetchedAt, refreshed: true });
  }

  try {
    const sportKeys =
      sport === "all" || sport === "Live"
        ? Object.values(SPORT_TO_KEYS).flat()
        : (SPORT_TO_KEYS[sport] ?? []);

    const events    = await fetchFromOddsApi(sportKeys);
    const filtered  = sport === "Live" ? events.filter(e => e.live) : events;
    const fetchedAt = new Date().toISOString();
    cache.set(sport, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: filtered, cached: false, fetchedAt, refreshed: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "QUOTA") return res.status(429).json({ error: "Odds API quota exceeded." });
    return res.status(503).json({ error: "Could not refresh odds." });
  }
});

/* ── Admin: manual game CRUD ────────────────────────────────────────────── */

const SPORT_TO_DEFAULT_KEY: Record<string, string> = {
  "NFL":                "americanfootball_nfl",
  "NBA":                "basketball_nba",
  "MLB":                "baseball_mlb",
  "NHL":                "icehockey_nhl",
  "UFC":                "mma_mixed_martial_arts",
  "Soccer":             "soccer_usa_mls",
  "Boxing":             "boxing_boxing",
  "College Football":   "americanfootball_ncaaf",
  "College Basketball": "basketball_ncaab",
};

// GET /sportsbook/admin/events — list manual events
router.get("/admin/events", requireSportbetsOrAbove, async (_req, res) => {
  try {
    const rows = await db.execute(sql`
      SELECT id, sport, sport_key, league, home_team, away_team,
             home_odds, away_odds, commence_time, live, event_name, created_by, created_at, active
      FROM manual_sportsbook_events
      ORDER BY created_at DESC
    `);
    return res.json(rows.rows);
  } catch (err) {
    console.error("[manual-events] list error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /sportsbook/admin/events — create a manual game
router.post("/admin/events", requireSportbetsOrAbove, async (req, res) => {
  try {
    const { sport, homeTeam, awayTeam, homeOdds, awayOdds, commenceTime, league, live = false, eventName } = req.body as {
      sport: string; homeTeam: string; awayTeam: string;
      homeOdds: number; awayOdds: number; commenceTime: string;
      league?: string; live?: boolean; eventName?: string;
    };
    const session = (req as any).bankerSession;

    if (!sport || !homeTeam || !awayTeam || !commenceTime) {
      return res.status(400).json({ error: "sport, homeTeam, awayTeam, and commenceTime are required" });
    }
    const sportKey   = SPORT_TO_DEFAULT_KEY[sport] ?? sport.toLowerCase().replace(/ /g, "_");
    const leagueVal  = (league?.trim()) || sport;
    const commenceTs = new Date(commenceTime);
    if (isNaN(commenceTs.getTime())) return res.status(400).json({ error: "Invalid commenceTime" });

    const result = await db.execute(sql`
      INSERT INTO manual_sportsbook_events
        (sport, sport_key, league, home_team, away_team, home_odds, away_odds, commence_time, live, event_name, created_by)
      VALUES
        (${sport}, ${sportKey}, ${leagueVal}, ${homeTeam.trim()}, ${awayTeam.trim()},
         ${Number(homeOdds) || -110}, ${Number(awayOdds) || -110},
         ${commenceTs.toISOString()}, ${live}, ${eventName?.trim() || null}, ${session.username})
      RETURNING id
    `);
    clearAllCache();
    return res.json({ success: true, id: (result.rows[0] as any).id });
  } catch (err) {
    console.error("[manual-events] create error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /sportsbook/admin/events/:id — toggle live / update odds
router.patch("/admin/events/:id", requireSportbetsOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { live, homeOdds, awayOdds, active } = req.body as { live?: boolean; homeOdds?: number; awayOdds?: number; active?: boolean };
    await db.execute(sql`
      UPDATE manual_sportsbook_events SET
        live       = COALESCE(${live ?? null}, live),
        home_odds  = COALESCE(${homeOdds != null ? Number(homeOdds) : null}, home_odds),
        away_odds  = COALESCE(${awayOdds != null ? Number(awayOdds) : null}, away_odds),
        active     = COALESCE(${active ?? null}, active)
      WHERE id = ${id}
    `);
    clearAllCache();
    return res.json({ success: true });
  } catch (err) {
    console.error("[manual-events] patch error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /sportsbook/admin/events/:id — remove manual game
router.delete("/admin/events/:id", requireSportbetsOrAbove, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.execute(sql`DELETE FROM manual_sportsbook_events WHERE id = ${id}`);
    clearAllCache();
    return res.json({ success: true });
  } catch (err) {
    console.error("[manual-events] delete error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
