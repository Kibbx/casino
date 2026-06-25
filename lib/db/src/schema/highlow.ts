import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";

export const highlowGamesTable = pgTable("highlow_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bet: integer("bet").notNull(),
  deckJson: text("deck_json").notNull(),
  currentPosition: integer("current_position").notNull().default(0),
  currentMultiplier: real("current_multiplier").notNull().default(1.0),
  streak: integer("streak").notNull().default(0),
  status: text("status").notNull().default("playing"),
  payout: integer("payout"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type HighlowGame = typeof highlowGamesTable.$inferSelect;
