import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(), // deposit, withdrawal, win, loss, rake
  description: text("description").notNull(),
  staffId: integer("staff_id"),
  staffUsername: text("staff_username"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({ id: true, createdAt: true });
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
