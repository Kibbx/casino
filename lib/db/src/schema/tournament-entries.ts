import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tournamentEntriesTable = pgTable("tournament_entries", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  playerId: integer("player_id").notNull(),
  playerName: text("player_name").notNull(),
  tournamentChips: integer("tournament_chips").notNull(),
  tableId: integer("table_id"),
  status: text("status").notNull().default("registered"), // registered | active | eliminated | winner
  finishPosition: integer("finish_position"),
  rebuysUsed: integer("rebuys_used").notNull().default(0),
  // Slots tournament fields
  score: integer("score").notNull().default(0),
  biggestSpin: integer("biggest_spin").notNull().default(0),
  registeredAt: timestamp("registered_at").notNull().defaultNow(),
});

export const insertTournamentEntrySchema = createInsertSchema(tournamentEntriesTable).omit({ id: true, registeredAt: true });
export type InsertTournamentEntry = z.infer<typeof insertTournamentEntrySchema>;
export type TournamentEntry = typeof tournamentEntriesTable.$inferSelect;
