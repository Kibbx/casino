import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { getActivePlayers } from "../lib/player-activity.js";
import { getRouletteSubscribers } from "../lib/roulette-room.js";

const router = Router();

export interface GameMeta {
  currentPlayers: number;
  minBet: number;
  maxBet: number;
  status: "open" | "live" | "closed";
  hasPassword: boolean;
}

router.get("/", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const s: Record<string, string> = {};
  for (const r of rows) s[r.key] = r.value;

  const int  = (key: string, def: number)  => parseInt(s[key] ?? String(def)) || def;
  const bool = (key: string, def: boolean) => (s[key] ?? (def ? "true" : "false")) === "true";

  const active = getActivePlayers();
  const byGame = new Map<string, number>();
  for (const p of active) {
    if (p.game === "lobby") continue;
    byGame.set(p.game, (byGame.get(p.game) ?? 0) + 1);
  }
  const count = (gameKey: string) => byGame.get(gameKey) ?? 0;

  const rouletteSubs = getRouletteSubscribers().length;

  const games: Record<string, GameMeta> = {
    blackjack: {
      currentPlayers: count("blackjack"),
      minBet: int("blackjackMinBet", 100),
      maxBet: int("blackjackMaxBet", 10000),
      // Default true — blackjack is enabled unless explicitly set to "false"
      status: bool("blackjackEnabled", true) ? "open" : "closed",
      hasPassword: false,
    },
    roulette: {
      currentPlayers: Math.max(count("roulette"), rouletteSubs),
      minBet: int("rouletteMinBet", 50),
      maxBet: int("rouletteMaxBet", 5000),
      // When roulette is disabled it must be "closed", not "open"
      status: bool("rouletteEnabled", false) ? "live" : "closed",
      hasPassword: !!s["roulettePassword"],
    },
    baccarat: {
      currentPlayers: count("baccarat"),
      minBet: int("baccaratMinBet", 100),
      maxBet: int("baccaratMaxBet", 10000),
      // No separate baccaratEnabled setting — baccarat is always open
      status: "open",
      hasPassword: !!s["baccaratPassword"],
    },
    highlow: {
      currentPlayers: count("high-low"),
      minBet: int("highlowMinBet", 100),
      maxBet: int("highlowMaxBet", 50000),
      status: bool("highlowEnabled", true) ? "open" : "closed",
      hasPassword: !!s["highlowPassword"],
    },
    mines: {
      currentPlayers: count("mines"),
      minBet: int("minesMinBet", 50),
      maxBet: int("minesMaxBet", 10000),
      status: bool("minesEnabled", false) ? "open" : "closed",
      hasPassword: !!s["minesPassword"],
    },
    keno: {
      currentPlayers: count("keno"),
      minBet: int("kenoMinBet", 100),
      maxBet: int("kenoMaxBet", 50000),
      status: bool("kenoEnabled", false) ? "live" : "closed",
      hasPassword: !!s["kenoPassword"],
    },
    "mob-tower": {
      currentPlayers: count("mob-tower"),
      minBet: int("mobTowerMinBet", 100),
      maxBet: int("mobTowerMaxBet", 50000),
      status: bool("mobTowerEnabled", false) ? "open" : "closed",
      hasPassword: false,
    },
    fortuna: {
      currentPlayers: count("rome-slots"),
      minBet: int("slotsMinBet", 50),
      maxBet: int("slotsMaxBet", 5000),
      status: bool("slotsEnabled", false) ? "open" : "closed",
      hasPassword: !!s["slotsPassword"],
    },
    "deadwood-dollars": {
      currentPlayers: count("western-slots"),
      minBet: int("slotsMinBet", 50),
      maxBet: int("slotsMaxBet", 5000),
      status: bool("slotsEnabled", false) ? "open" : "closed",
      hasPassword: !!s["slotsPassword"],
    },
    cases: {
      currentPlayers: count("cases"),
      minBet: 0,
      maxBet: 0,
      // cases.enabled defaults to true (enabled unless explicitly disabled)
      status: (s["cases.enabled"] ?? "true") === "true" ? "open" : "closed",
      hasPassword: !!s["casesPassword"],
    },
  };

  res.setHeader("Cache-Control", "no-store");
  res.json(games);
});

export default router;
