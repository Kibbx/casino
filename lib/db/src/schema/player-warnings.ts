import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const playerWarningsTable = pgTable("player_warnings", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  staffId: integer("staff_id").notNull(),
  staffUsername: text("staff_username").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlayerWarning = typeof playerWarningsTable.$inferSelect;
