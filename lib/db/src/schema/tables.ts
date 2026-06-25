import { pgTable, serial, text, integer, real, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pokerTablesTable = pgTable("poker_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("waiting"), // waiting, playing, finished
  smallBlind: integer("small_blind").notNull(),
  bigBlind: integer("big_blind").notNull(),
  minBuyIn: integer("min_buy_in").notNull(),
  maxBuyIn: integer("max_buy_in").notNull(),
  rakePercent: real("rake_percent").notNull().default(5),
  rakeCap: integer("rake_cap").notNull().default(500),
  seats: jsonb("seats").notNull().default([]),
  gameState: jsonb("game_state"),
  tournamentId: integer("tournament_id"),
  readyPlayerIds: jsonb("ready_player_ids").notNull().default([]),
  password: text("password"),
  theme: text("theme").notNull().default("velvet"),
  locked: boolean("locked").notNull().default(false),
  // Blind escalation
  escalationEnabled: boolean("escalation_enabled").notNull().default(false),
  resetDelay: integer("reset_delay").notNull().default(30),
  blindLevels: jsonb("blind_levels").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPokerTableSchema = createInsertSchema(pokerTablesTable).omit({ id: true, createdAt: true });
export type InsertPokerTable = z.infer<typeof insertPokerTableSchema>;
export type PokerTable = typeof pokerTablesTable.$inferSelect;
