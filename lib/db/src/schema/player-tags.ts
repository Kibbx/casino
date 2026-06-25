import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const playerTagsTable = pgTable("player_tags", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  label: text("label").notNull(),
  color: text("color").notNull().default("#6b7280"),
  flagged: boolean("flagged").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PlayerTag = typeof playerTagsTable.$inferSelect;
