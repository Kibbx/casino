import { pgTable, serial, text, integer, boolean, timestamp, real } from "drizzle-orm/pg-core";

export const blackjackTablesTable = pgTable("blackjack_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  minBet: integer("min_bet").notNull().default(100),
  maxBet: integer("max_bet").notNull().default(10000),
  numSeats: integer("num_seats").notNull().default(6),
  theme: text("theme").notNull().default("velvet"),
  passwordHash: text("password_hash"),
  houseEdge: real("house_edge").notNull().default(2.5),
  isOpen: boolean("is_open").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
