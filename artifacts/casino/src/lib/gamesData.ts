/**
 * gamesData.ts — Single source of truth for all static casino game definitions.
 *
 * To add a new game:
 *   1. Add a GameDef entry to the relevant category array below.
 *   2. It will automatically appear on the category page AND be eligible
 *      for Recently Played / Live Activity on the Home page.
 *
 * For dynamic data (Blackjack tables, Poker tables, Sportsbook odds) keep
 * the per-page API fetch logic — only add a visual definition here if you
 * want the game to appear in Recently Played / Live Activity.
 */

import type { CatalogGame } from "../pages/shared";

const IMGS = import.meta.env.BASE_URL;

/* ── Extended game definition ─────────────────────────────────────────
   Extends CatalogGame (used by CatalogCard) with navigation + lobby metadata.
──────────────────────────────────────────────────────────────────────── */
export interface GameDef extends CatalogGame {
  /** Key used in GAME_CFG / GAME_DISPLAY (may differ from CatalogGame.id) */
  lobbyKey?: string;
  /** Wouter route to navigate to when clicked */
  route: string;
  /** setAccessToken key for gated games */
  tokenId?: string;
  /** useGameLauncher key for games launched via the launcher */
  launchKey?: string;
  /** Image URL used in GAME_DISPLAY for lobby Recently Played/Live Activity */
  image?: string;
  /** Legacy gameKey used in GAME_DISPLAY for launcher resolution */
  gameKey?: string;
  /** Human-readable category label, e.g. "TABLE GAMES" */
  displayCategory?: string;
}

/* ══════════════════════════════════════════════════════════════════
   TABLE GAMES  (non-blackjack static games — BJ tables are dynamic)
══════════════════════════════════════════════════════════════════ */
export const tableGamesData: GameDef[] = [
  {
    id: "roulette", lobbyKey: "roulette",
    name: "Roulette",
    description: "Spin the wheel. Bet on numbers, colors, or ranges in this iconic game.",
    gradient: "linear-gradient(135deg, #1a0505 0%, #2e0808 60%, #4a1010 100%)",
    neonClass: "neon-red", neonColor: "#ff3131",
    actionLabel: "Join Table", statusLabel: "LIVE", statusColor: "#22c55e",
    route: "/roulette", tokenId: "roulette",
    image: `${IMGS}images/card-roulette.webp`, gameKey: "roulette",
    displayCategory: "TABLE GAMES",
  },
  {
    id: "baccarat", lobbyKey: "baccarat",
    name: "Baccarat",
    description: "Bet on Player, Banker, or Tie. High-limit prestige at every hand.",
    gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)",
    neonClass: "neon-yellow", neonColor: "#fbbf24",
    badge: "VIP", badgeColor: "#7c3aed",
    actionLabel: "Join Table", statusLabel: "OPEN", statusColor: "#fbbf24",
    route: "/baccarat",
    image: `${IMGS}images/card-baccarat.webp`, gameKey: "baccarat",
    displayCategory: "TABLE GAMES",
  },
  {
    id: "highlow", lobbyKey: "highlow",
    name: "High Low",
    description: "Predict whether the next card is higher or lower than the dealer's.",
    gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)",
    neonClass: "neon-blue", neonColor: "#06b6d4",
    actionLabel: "Play Now", statusLabel: "OPEN", statusColor: "#06b6d4",
    route: "/high-low", tokenId: "highlow",
    image: `${IMGS}images/card-mini-games.png`, gameKey: "highlow",
    displayCategory: "TABLE GAMES",
  },
];

/* ══════════════════════════════════════════════════════════════════
   MINI GAMES
══════════════════════════════════════════════════════════════════ */
export const miniGamesData: GameDef[] = [
  {
    id: "mines", lobbyKey: "mines",
    name: "Mines",
    description: "Uncover gems while dodging hidden mines. Cash out before it's too late.",
    gradient: "linear-gradient(135deg, #0a1a10 0%, #122a18 60%, #1a4024 100%)",
    neonClass: "neon-green", neonColor: "#39ff14",
    badge: "POPULAR", badgeColor: "#e8400a",
    actionLabel: "Play Now", statusLabel: "OPEN", statusColor: "#22c55e",
    route: "/mines", tokenId: "mines",
    image: `${IMGS}images/card-mines.webp`, gameKey: "mines",
    displayCategory: "MINI GAMES",
  },
  {
    id: "keno",
    name: "Keno",
    description: "Pick your lucky numbers and watch the draw. The more you match, the more you win.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink", neonColor: "#ec4899",
    actionLabel: "Play Now", statusLabel: "OPEN", statusColor: "#ec4899",
    route: "/keno", tokenId: "keno",
    image: `${IMGS}images/card-keno.png`,
    displayCategory: "MINI GAMES",
  },
  {
    id: "mob-tower", lobbyKey: "mob_tower",
    name: "Mob Tower",
    description: "Climb the tower, dodge the mobsters. Each floor multiplies your bet.",
    gradient: "linear-gradient(135deg, #1a0800 0%, #2e1200 60%, #4a1e00 100%)",
    neonClass: "neon-orange", neonColor: "#f97316",
    badge: "NEW", badgeColor: "#7c3aed",
    actionLabel: "Start Climb", statusLabel: "OPEN", statusColor: "#f97316",
    route: "/mob-tower",
    image: `${IMGS}images/card-mob-tower.png`, gameKey: "mobtower",
    displayCategory: "MINI GAMES",
  },
  {
    id: "case-opening",
    name: "Case Opening",
    description: "Open cases to reveal rare items and exclusive collectibles.",
    gradient: "linear-gradient(135deg, #001525 0%, #002035 60%, #003055 100%)",
    neonClass: "neon-blue", neonColor: "#06b6d4",
    actionLabel: "Open Case", statusLabel: "OPEN", statusColor: "#06b6d4",
    route: "/cases",
    image: `${IMGS}images/card-cases.webp`,
    displayCategory: "MINI GAMES",
  },
];

/* ══════════════════════════════════════════════════════════════════
   SLOTS
══════════════════════════════════════════════════════════════════ */
export const slotsData: GameDef[] = [
  {
    id: "fortuna", lobbyKey: "rome_slots",
    name: "Fortuna",
    description: "Spin to conquer Rome — classic reels with an epic theme and massive jackpots.",
    gradient: "linear-gradient(135deg, #0d0020 0%, #1a0035 60%, #280050 100%)",
    neonClass: "neon-purple", neonColor: "#a855f7",
    badge: "POPULAR", badgeColor: "#e8400a",
    actionLabel: "Play Now", statusLabel: "OPEN", statusColor: "#a855f7",
    route: "/rome-slots", tokenId: "slots",
    image: `${IMGS}images/card-fortuna.png?v=2`, gameKey: "slots",
    displayCategory: "SLOTS",
  },
  {
    id: "deadwood-dollars", lobbyKey: "western_slots",
    name: "Deadwood Dollars",
    description: "Saddle up for big wins in the wild west with Deadwood Dollars.",
    gradient: "linear-gradient(135deg, #0a1a08 0%, #122810 60%, #1a3a16 100%)",
    neonClass: "neon-green", neonColor: "#22c55e",
    badge: "NEW", badgeColor: "#7c3aed",
    actionLabel: "Play Now", statusLabel: "OPEN", statusColor: "#22c55e",
    route: "/western-slots", tokenId: "slots",
    image: `${IMGS}images/card-deadwood.png?v=2`, gameKey: "slots",
    displayCategory: "SLOTS",
  },
];

/* ══════════════════════════════════════════════════════════════════
   BINGO
══════════════════════════════════════════════════════════════════ */
export const bingoData: GameDef[] = [
  {
    id: "classic", lobbyKey: "bingo",
    name: "Classic Bingo",
    description: "Standard 90-ball bingo. First to a full house wins the jackpot.",
    gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)",
    neonClass: "neon-green", neonColor: "#22c55e",
    players: "4 waiting", betRange: "$1 – $10 / card",
    actionLabel: "Join Room", statusLabel: "FILLING", statusColor: "#22c55e",
    route: "/bingo", launchKey: "bingo",
    image: `${IMGS}images/card-bingo.png`,
    displayCategory: "EVENTS",
  },
  {
    id: "speed",
    name: "Speed Bingo",
    description: "Faster calls, higher energy. Games complete in under 3 minutes.",
    gradient: "linear-gradient(135deg, #1a0800 0%, #2e1200 60%, #4a1e00 100%)",
    neonClass: "neon-orange", neonColor: "#f97316",
    badge: "FAST", badgeColor: "#e8400a",
    players: "7 playing", betRange: "$2 – $20 / card",
    actionLabel: "Join Room", statusLabel: "LIVE", statusColor: "#22c55e",
    route: "/bingo", launchKey: "bingo",
    image: `${IMGS}images/card-bingo.png`,
  },
  {
    id: "75ball",
    name: "75-Ball Bingo",
    description: "American-style bingo on a 5×5 card. More patterns, more ways to win.",
    gradient: "linear-gradient(135deg, #050d1a 0%, #091625 60%, #0f2a45 100%)",
    neonClass: "neon-blue", neonColor: "#06b6d4",
    players: "12 playing", betRange: "$0.50 – $5 / card",
    actionLabel: "Join Room", statusLabel: "LIVE", statusColor: "#22c55e",
    route: "/bingo", launchKey: "bingo",
    image: `${IMGS}images/card-bingo.png`,
  },
  {
    id: "pattern",
    name: "Pattern Bingo",
    description: "Match special patterns on your card for bonus prizes and multipliers.",
    gradient: "linear-gradient(135deg, #0d0520 0%, #160930 60%, #1c0d40 100%)",
    neonClass: "neon-pink", neonColor: "#ec4899",
    players: "2 waiting", betRange: "$3 – $25 / card",
    actionLabel: "Join Room", statusLabel: "OPEN", statusColor: "#06b6d4",
    route: "/bingo", launchKey: "bingo",
    image: `${IMGS}images/card-bingo.png`,
  },
];

/* ══════════════════════════════════════════════════════════════════
   DERIVED MAPS  — backward compat for lobby.tsx
══════════════════════════════════════════════════════════════════ */
const ALL_DEFS = [...tableGamesData, ...miniGamesData, ...slotsData, ...bingoData];

/** Per-game visual config used by lobby RecentCard / LiveCard */
export const GAME_CFG: Record<string, Pick<GameDef, "gradient" | "neonClass" | "neonColor" | "description">> = {
  // Build from the category arrays first (indexed by lobbyKey or id)
  ...Object.fromEntries(
    ALL_DEFS.map(g => [
      g.lobbyKey ?? g.id,
      { gradient: g.gradient, neonClass: g.neonClass, neonColor: g.neonColor, description: g.description },
    ])
  ),
  // Games that only live in lobby GAME_CFG (no dedicated category page)
  blackjack:  { gradient: "linear-gradient(135deg, #0a1f0a 0%, #0d2e0d 60%, #174e17 100%)", neonClass: "neon-green",  neonColor: "#39ff14", description: "Beat the dealer to 21. Classic table game with live competition." },
  poker:      { gradient: "linear-gradient(135deg, #1a0505 0%, #2e0808 60%, #4a1010 100%)", neonClass: "neon-red",    neonColor: "#ef4444", description: "Texas Hold'em with live players and real chips on the line." },
  slots:      { gradient: "linear-gradient(135deg, #0d0020 0%, #1a0035 60%, #280050 100%)", neonClass: "neon-purple", neonColor: "#a855f7", description: "Spin the reels of fortune and uncover massive wins." },
  fortune:    { gradient: "linear-gradient(135deg, #0d0020 0%, #1a0035 60%, #280050 100%)", neonClass: "neon-purple", neonColor: "#a855f7", description: "Spin the fortune wheel for instant prizes and massive multipliers." },
  horse:      { gradient: "linear-gradient(135deg, #1a0f05 0%, #2e1e08 60%, #4a3010 100%)", neonClass: "neon-yellow", neonColor: "#fbbf24", description: "Bet on your horse and watch the race unfold in real time." },
  lottery:    { gradient: "linear-gradient(135deg, #1a0010 0%, #2e0020 60%, #4a0030 100%)", neonClass: "neon-pink",   neonColor: "#ec4899", description: "Pick your lucky numbers and try your luck at the jackpot." },
  tournament: { gradient: "linear-gradient(135deg, #1a1505 0%, #2e2208 60%, #4a380a 100%)", neonClass: "neon-yellow", neonColor: "#fbbf24", description: "Compete in timed slot tournaments for prizes and glory." },
};

/** Game image + category metadata used by lobby Recently Played / Live Activity */
export const GAME_DISPLAY: Record<string, { name: string; category: string; image: string; gameKey?: string }> = {
  blackjack:     { name: "Blackjack",        category: "TABLE GAMES",  image: `${IMGS}images/card-blackjack.webp`,       gameKey: "blackjack"  },
  roulette:      { name: "Roulette",         category: "TABLE GAMES",  image: `${IMGS}images/card-roulette.webp`,        gameKey: "roulette"   },
  baccarat:      { name: "Baccarat",         category: "TABLE GAMES",  image: `${IMGS}images/card-baccarat.webp`,        gameKey: "baccarat"   },
  poker:         { name: "Poker",            category: "TABLE GAMES",  image: `${IMGS}images/card-poker.webp`,           gameKey: "poker"      },
  slots:         { name: "Slots",            category: "SLOTS",        image: `${IMGS}images/card-slots.webp`,           gameKey: "slots"      },
  rome_slots:    { name: "Rome Slots",       category: "SLOTS",        image: `${IMGS}images/card-rome-slots.webp`,      gameKey: "slots"      },
  western_slots: { name: "Big House Slots",  category: "SLOTS",        image: `${IMGS}images/card-backalley-slots.webp`, gameKey: "slots"      },
  mines:         { name: "Mines",            category: "MINI GAMES",   image: `${IMGS}images/card-mines.webp`,           gameKey: "mines"      },
  mob_tower:     { name: "Mob Tower",        category: "MINI GAMES",   image: `${IMGS}images/card-mob-tower.png`,        gameKey: "mobtower"   },
  fortune:       { name: "Fortune Spin",     category: "MINI GAMES",   image: `${IMGS}images/mini-games.png`,            gameKey: "slots"      },
  highlow:       { name: "High Low",         category: "MINI GAMES",   image: `${IMGS}images/mini-games.png`,            gameKey: "highlow"    },
  horse:         { name: "Horse Racing",     category: "LIVE EVENTS",  image: `${IMGS}images/card-horseracing.webp`,     gameKey: "horse"      },
  bingo:         { name: "Bingo",            category: "EVENTS",       image: `${IMGS}images/card-bingo.png`                                   },
  lottery:       { name: "Lottery",          category: "EVENTS",       image: `${IMGS}images/card-lottery.png`                                 },
  tournament:    { name: "Slots Tournament", category: "EVENTS",       image: `${IMGS}images/card-tournaments.webp`,    gameKey: "slots"      },
};

/** Fallback Live Activity cards shown when the /api/players/online endpoint
 *  returns no grouped data. Covers a broad sample across all categories. */
export interface FallbackLiveGame {
  id: number; name: string; category: string; image: string;
  players: number; maxPlayers: number; activeBets: string; status: string;
}
export const FALLBACK_LIVE: FallbackLiveGame[] = [
  { id: 1, name: "Blackjack",        category: "TABLE GAMES",  image: `${IMGS}images/card-blackjack.webp`,       players: 4,  maxPlayers: 6,  activeBets: "$2,340",  status: "In Progress" },
  { id: 2, name: "Roulette",         category: "TABLE GAMES",  image: `${IMGS}images/card-roulette.webp`,        players: 7,  maxPlayers: 8,  activeBets: "$5,120",  status: "In Progress" },
  { id: 3, name: "Poker",            category: "TABLE GAMES",  image: `${IMGS}images/card-poker.webp`,           players: 5,  maxPlayers: 6,  activeBets: "$8,900",  status: "In Progress" },
  { id: 4, name: "Horse Racing",     category: "LIVE EVENTS",  image: `${IMGS}images/card-horseracing.webp`,     players: 14, maxPlayers: 20, activeBets: "$14,200", status: "Race Live"   },
  { id: 5, name: "Mines",            category: "MINI GAMES",   image: `${IMGS}images/card-mines.webp`,           players: 9,  maxPlayers: 0,  activeBets: "$1,870",  status: "In Progress" },
  { id: 6, name: "Big House Slots",  category: "SLOTS",        image: `${IMGS}images/card-backalley-slots.webp`, players: 6,  maxPlayers: 0,  activeBets: "$3,200",  status: "In Progress" },
  { id: 7, name: "Bingo",            category: "EVENTS",       image: `${IMGS}images/card-bingo.png`,            players: 12, maxPlayers: 20, activeBets: "$480",    status: "Live Draw"   },
  { id: 8, name: "Lottery",          category: "EVENTS",       image: `${IMGS}images/card-lottery.png`,          players: 88, maxPlayers: 0,  activeBets: "$22,600", status: "Open"        },
];
