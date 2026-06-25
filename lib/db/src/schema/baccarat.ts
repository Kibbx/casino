import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const baccaratTablesTable = pgTable("baccarat_tables", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  minBet: integer("min_bet").notNull().default(100),
  maxBet: integer("max_bet").notNull().default(10000),
  bankerCommission: integer("banker_commission").notNull().default(5),
  tiePayout: integer("tie_payout").notNull().default(8),
  bettingTimerSecs: integer("betting_timer_secs").notNull().default(30),
  isOpen: boolean("is_open").notNull().default(true),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BaccaratTable = typeof baccaratTablesTable.$inferSelect;
