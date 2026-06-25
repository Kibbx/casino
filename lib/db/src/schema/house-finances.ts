import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const houseFinancesTable = pgTable("house_finances", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // "crate" | "bank"
  type: text("type").notNull(),     // "deposit" | "withdraw"
  amount: integer("amount").notNull(),
  reason: text("reason").notNull().default(""),
  staffUsername: text("staff_username").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
