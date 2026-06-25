import { pgTable, serial, integer, real, text, timestamp } from "drizzle-orm/pg-core";

export const kenoGamesTable = pgTable("keno_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bet: integer("bet").notNull(),
  risk: text("risk").notNull(),
  picks: text("picks").notNull(),
  drawn: text("drawn").notNull(),
  hits: integer("hits").notNull(),
  multiplier: real("multiplier").notNull(),
  payout: integer("payout").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type KenoGame = typeof kenoGamesTable.$inferSelect;
