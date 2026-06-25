import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";

export const crashGamesTable = pgTable("crash_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bet: integer("bet").notNull(),
  crashPoint: real("crash_point").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  status: text("status").notNull().default("playing"), // playing | cashed_out | crashed
  cashoutMultiplier: real("cashout_multiplier"),
  payout: integer("payout"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CrashGame = typeof crashGamesTable.$inferSelect;
