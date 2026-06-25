import { pgTable, serial, text, integer } from "drizzle-orm/pg-core";

export const sportBetEventOptionsTable = pgTable("sport_bet_event_options", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  label: text("label").notNull(),
  odds: text("odds").notNull(),
});
