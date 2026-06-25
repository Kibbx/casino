import { pgTable, serial, integer, text, real, timestamp, boolean } from "drizzle-orm/pg-core";

export const loansTable = pgTable("loans", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  bankerUsername: text("banker_username").notNull().default(""),
  principalAmount: integer("principal_amount").notNull(),
  interestRate: real("interest_rate").notNull().default(0),
  totalOwed: integer("total_owed").notNull(),
  remainingBalance: integer("remaining_balance").notNull(),
  dueDate: text("due_date"),
  status: text("status").notNull().default("active"),
  stage: text("stage").notNull().default("active"),
  interestAccrued: integer("interest_accrued").notNull().default(0),
  notes: text("notes"),
  paymentHistory: text("payment_history").notNull().default("[]"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creditTiersTable = pgTable("credit_tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  minScore: integer("min_score").notNull(),
  interestModifier: real("interest_modifier").notNull().default(0),
  loanMultiplier: real("loan_multiplier").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanTiersTable = pgTable("loan_tiers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  requiredRepaid: integer("required_repaid").notNull().default(0),
  cap: integer("cap").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const loanCommissionsTable = pgTable("loan_commissions", {
  id: serial("id").primaryKey(),
  loanId: integer("loan_id").notNull(),
  bankerUsername: text("banker_username").notNull(),
  paymentAmount: integer("payment_amount").notNull(),
  interestPortion: integer("interest_portion").notNull(),
  employeeCommission: integer("employee_commission").notNull(),
  casinoCommission: integer("casino_commission").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  paidBy: text("paid_by"),
});

export const commissionPayoutsTable = pgTable("commission_payouts", {
  id: serial("id").primaryKey(),
  bankerUsername: text("banker_username").notNull(),
  amount: integer("amount").notNull(),
  rowsMarked: integer("rows_marked").notNull(),
  chipsDelivered: boolean("chips_delivered").notNull().default(false),
  linkedPlayerId: integer("linked_player_id"),
  paidBy: text("paid_by").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Loan = typeof loansTable.$inferSelect;
export type CreditTier = typeof creditTiersTable.$inferSelect;
export type LoanTier = typeof loanTiersTable.$inferSelect;
export type LoanCommission = typeof loanCommissionsTable.$inferSelect;
