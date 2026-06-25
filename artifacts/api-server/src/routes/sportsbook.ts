import { Router } from "express";

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

const SPORT_TO_KEYS: Record<string, string[]> = {
  "NFL":                ["americanfootball_nfl"],
  "NBA":                ["basketball_nba"],
  "MLB":                ["baseball_mlb"],
  "NHL":                ["icehockey_nhl"],
  "UFC":                ["mma_mixed_martial_arts"],
  "Soccer":             ["soccer_epl", "soccer_usa_mls", "soccer_spain_la_liga", "soccer_germany_bundesliga", "soccer_france_ligue_one"],
  "Boxing":             ["boxing_boxing"],
  "Tennis":             ["tennis_atp_us_open", "tennis_wta_us_open"],
  "Golf":               ["golf_pga_championship_winner", "golf_us_open_winner"],
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
  "tennis_atp_us_open":            "ATP US Open",
  "tennis_wta_us_open":            "WTA US Open",
  "golf_pga_championship_winner":  "PGA Championship",
  "golf_us_open_winner":           "US Open",
  "americanfootball_ncaaf":        "NCAAF",
  "basketball_ncaab":              "NCAAB",
};

for (const [sport, keys] of Object.entries(SPORT_TO_KEYS)) {
  for (const key of keys) SPORT_KEY_TO_SPORT[key] = sport;
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
    // Tennis
    { sportKey: "tennis_atp_us_open",      sport: "Tennis",           league: "ATP US Open", homeTeam: "Carlos Alcaraz",          awayTeam: "Novak Djokovic",         commenceTime: new Date(now + 6  * d).toISOString(),       live: false, bestHomeOdds: -145, bestAwayOdds:  125, bestHomeBook: "betmgm",    bestAwayBook: "betmgm",    eventName: "Wimbledon Final" },
    // Golf
    { sportKey: "golf_pga_championship_winner", sport: "Golf",        league: "PGA",         homeTeam: "Scottie Scheffler",       awayTeam: "Rory McIlroy",           commenceTime: new Date(now + 7  * d).toISOString(),       live: false, bestHomeOdds: -140, bestAwayOdds:  120, bestHomeBook: "draftkings", bestAwayBook: "fanduel",   eventName: "The Open Championship" },
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

  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return res.json({ events: hit.events, cached: true, fetchedAt: hit.fetchedAt });
  }

  const apiKey = process.env.ODDS_API_KEY;

  if (!apiKey) {
    const all      = makeMockEvents();
    const filtered = sport === "all"
      ? all
      : sport === "Live"
        ? all.filter(e => e.live)
        : all.filter(e => e.sport === sport);
    const fetchedAt = new Date().toISOString();
    cache.set(cacheKey, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: filtered, cached: false, fetchedAt });
  }

  try {
    const sportKeys =
      sport === "all" || sport === "Live"
        ? Object.values(SPORT_TO_KEYS).flat()
        : (SPORT_TO_KEYS[sport] ?? []);

    if (sportKeys.length === 0) {
      return res.json({ events: [], cached: false, fetchedAt: new Date().toISOString() });
    }

    const events    = await fetchFromOddsApi(sportKeys);
    const filtered  = sport === "Live" ? events.filter(e => e.live) : events;
    const fetchedAt = new Date().toISOString();
    cache.set(cacheKey, { events: filtered, fetchedAt, expiresAt: Date.now() + CACHE_TTL_MS });
    return res.json({ events: filtered, cached: false, fetchedAt });
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

export default router;
