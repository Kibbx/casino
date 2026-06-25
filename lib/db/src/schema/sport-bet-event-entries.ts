import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const sportBetEventEntriesTable = pgTable("sport_bet_event_entries", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  optionId: integer("option_id").notNull(),
  playerId: integer("player_id"),
  playerName: text("player_name").notNull(),
  amount: integer("amount").notNull(),
  enteredBy: text("entered_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
});
