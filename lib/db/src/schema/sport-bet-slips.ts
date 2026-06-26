import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const sportBetSlipsTable = pgTable("sport_bet_slips", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  playerUsername: text("player_username").notNull(),
  type: text("type").notNull().default("single"),
  wagerAmount: integer("wager_amount").notNull(),
  potentialPayout: integer("potential_payout").notNull().default(0),
  actualPayout: integer("actual_payout"),
  status: text("status").notNull().default("pending"),
  selections: text("selections").notNull().default("[]"),
  adminNote: text("admin_note"),
  settledAt: timestamp("settled_at"),
  settledBy: text("settled_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
