import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const mobTowerGamesTable = pgTable("mob_tower_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bet: integer("bet").notNull(),
  floorSafes: text("floor_safes").notNull(),
  currentFloor: integer("current_floor").notNull().default(0),
  status: text("status").notNull().default("playing"),
  payout: integer("payout").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MobTowerGame = typeof mobTowerGamesTable.$inferSelect;
