import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const sportBetEventsTable = pgTable("sport_bet_events", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  league: text("league").notNull().default(""),
  gameDate: timestamp("game_date"),
  status: text("status").notNull().default("open"),
  winnerId: integer("winner_id"),
  rakePercent: integer("rake_percent").notNull().default(0),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
});
