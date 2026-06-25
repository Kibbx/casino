import { pgTable, text, integer, boolean, bigint } from "drizzle-orm/pg-core";

export const playerSessionsTable = pgTable("player_sessions", {
  token: text("token").primaryKey(),
  playerId: integer("player_id").notNull(),
  username: text("username").notNull(),
  staffRole: text("staff_role"),
  staffRole2: text("staff_role2"),
});

export const bankerSessionsTable = pgTable("banker_sessions", {
  token: text("token").primaryKey(),
  accountId: integer("account_id").notNull(),
  username: text("username").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  role: text("role").notNull(),
  role2: text("role2"),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});
