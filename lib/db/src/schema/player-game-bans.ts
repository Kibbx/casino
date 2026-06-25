import { pgTable, serial, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const playerGameBansTable = pgTable("player_game_bans", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  game: text("game").notNull(), // "blackjack" | "slots" | "roulette" | "crash" | "poker" | "all"
  staffId: integer("staff_id").notNull(),
  staffUsername: text("staff_username").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at"), // null = permanent
  lifted: boolean("lifted").notNull().default(false),
  liftedBy: text("lifted_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlayerGameBan = typeof playerGameBansTable.$inferSelect;
