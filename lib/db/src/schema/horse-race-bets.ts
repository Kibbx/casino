import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const horseRaceBetsTable = pgTable("horse_race_bets", {
  id: serial("id").primaryKey(),
  raceId: integer("race_id").notNull(),
  playerId: integer("player_id").notNull(),
  horseId: integer("horse_id").notNull(),
  amount: integer("amount").notNull(),
  paidOut: boolean("paid_out").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type HorseRaceBet = typeof horseRaceBetsTable.$inferSelect;
