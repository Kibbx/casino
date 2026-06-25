import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";

export const minesGamesTable = pgTable("mines_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bet: integer("bet").notNull(),
  mines: integer("mines").notNull(),
  minePositions: text("mine_positions").notNull(),
  revealedTiles: text("revealed_tiles").notNull().default("[]"),
  status: text("status").notNull().default("playing"),
  currentMultiplier: real("current_multiplier").notNull().default(1.0),
  payout: integer("payout"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MinesGame = typeof minesGamesTable.$inferSelect;
