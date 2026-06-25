import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const rakebackTable = pgTable("rakeback", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().unique(),
  wageredReal: integer("wagered_real").notNull().default(0),
  wonReal: integer("won_real").notNull().default(0),
  periodStart: timestamp("period_start").notNull().defaultNow(),
  lastClaimed: timestamp("last_claimed"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Rakeback = typeof rakebackTable.$inferSelect;
