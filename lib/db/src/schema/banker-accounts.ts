import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";

export const bankerAccountsTable = pgTable("banker_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isAdmin: boolean("is_admin").notNull().default(false),
  role: text("role").notNull().default("banker"),
  role2: text("role2"),
  rolesJson: text("roles_json"),
  stateId: text("state_id"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});
