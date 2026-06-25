import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const sportBetFinancesTable = pgTable("sport_bet_finances", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("crate"),
  type: text("type").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull().default(""),
  staffUsername: text("staff_username").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
