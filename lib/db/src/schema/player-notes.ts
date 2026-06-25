import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const playerNotesTable = pgTable("player_notes", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  staffId: integer("staff_id").notNull(),
  staffUsername: text("staff_username").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlayerNote = typeof playerNotesTable.$inferSelect;
