import { pgTable, serial, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tournamentsTable = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("poker"), // "poker" | "slots"
  buyIn: integer("buy_in").notNull(),
  startingChips: integer("starting_chips").notNull(),
  maxPlayers: integer("max_players").notNull().default(8),
  // Poker-specific
  smallBlind: integer("small_blind").notNull().default(0),
  bigBlind: integer("big_blind").notNull().default(0),
  // Slots-specific
  minBet: integer("min_bet"),
  maxBet: integer("max_bet"),
  slotGame: text("slot_game").notNull().default("fortuna"), // "fortuna" | "western"
  status: text("status").notNull().default("registering"), // registering | running | finished
  prizePool: integer("prize_pool").notNull().default(0),
  basePrizePool: integer("base_prize_pool").notNull().default(0),
  buyInPrizePercent: integer("buy_in_prize_percent").notNull().default(100),
  winnerId: integer("winner_id"),
  winnerName: text("winner_name"),
  tableId: integer("table_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Rebuys (poker only)
  rebuysEnabled: boolean("rebuys_enabled").notNull().default(false),
  maxRebuys: integer("max_rebuys").notNull().default(1),
  // Slots rolling-entry
  durationMinutes: integer("duration_minutes"),   // how long the tournament runs
  endTime: timestamp("end_time"),                  // auto-computed: createdAt + duration
  // Snapshot only updated at bust / consolidation — not every hand
  leaderboardSnapshot: jsonb("leaderboard_snapshot").notNull().default([]),
  leaderboardUpdatedAt: timestamp("leaderboard_updated_at"),
  // Prize payout tracking
  prizeAwarded: boolean("prize_awarded").notNull().default(false),
  prizeAwardedAt: timestamp("prize_awarded_at"),
});

export const insertTournamentSchema = createInsertSchema(tournamentsTable).omit({ id: true, createdAt: true });
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Tournament = typeof tournamentsTable.$inferSelect;
