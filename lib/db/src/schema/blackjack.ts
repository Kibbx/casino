import { pgTable, serial, integer, text, jsonb, timestamp, varchar } from "drizzle-orm/pg-core";
import { playersTable } from "./players";

export const blackjackGamesTable = pgTable("blackjack_games", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull().references(() => playersTable.id),
  status: text("status").notNull().default("active"),
  playerCards: jsonb("player_cards").notNull().default([]),
  dealerCards: jsonb("dealer_cards").notNull().default([]),
  bet: integer("bet").notNull(),
  payout: integer("payout"),
  splitCards: jsonb("split_cards"),
  splitStatus: text("split_status"),
  splitPayout: integer("split_payout"),
  splitBet: integer("split_bet"),
  activeHand: text("active_hand").default("main"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type BlackjackGame = typeof blackjackGamesTable.$inferSelect;

export const blackjackHandsTable = pgTable("blackjack_hands", {
  id: serial("id").primaryKey(),
  tableId: integer("table_id").notNull(),
  tableName: varchar("table_name", { length: 128 }).notNull().default(""),
  roundId: integer("round_id").notNull(),
  playerId: integer("player_id").notNull(),
  playerName: varchar("player_name", { length: 128 }).notNull(),
  seatIndex: integer("seat_index").notNull(),
  playerCards: varchar("player_cards", { length: 128 }).notNull(),
  playerValue: integer("player_value").notNull(),
  splitCards: varchar("split_cards", { length: 128 }),
  splitValue: integer("split_value"),
  dealerCards: varchar("dealer_cards", { length: 128 }).notNull(),
  dealerValue: integer("dealer_value").notNull(),
  result: varchar("result", { length: 32 }).notNull(),
  splitResult: varchar("split_result", { length: 32 }),
  bet: integer("bet").notNull(),
  splitBet: integer("split_bet").notNull().default(0),
  payout: integer("payout").notNull(),
  oddsMode: varchar("odds_mode", { length: 16 }).notNull().default("standard"),
  playedAt: timestamp("played_at").notNull().defaultNow(),
});

export type BlackjackHand = typeof blackjackHandsTable.$inferSelect;
