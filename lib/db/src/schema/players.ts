import { pgTable, serial, text, integer, bigint, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const playersTable = pgTable("players", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  stateId: text("state_id").unique(),
  phoneNumber: text("phone_number"),
  pin: text("pin").notNull().default("0000"),
  chips: integer("chips").notNull().default(0),
  handsPlayed: integer("hands_played").notNull().default(0),
  timebankSeconds: integer("timebank_seconds").notNull().default(15),
  avatarUrl: text("avatar_url"),
  isBot: boolean("is_bot").notNull().default(false),
  staffRole: text("staff_role"),
  staffRole2: text("staff_role2"),
  staffRolesJson: text("staff_roles_json"),
  bonusSpins: integer("bonus_spins").notNull().default(0),
  bonusBet: integer("bonus_bet").notNull().default(0),
  bonusMult: integer("bonus_mult").notNull().default(2),
  bonusGame: text("bonus_game"),
  flagged: boolean("flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  flagSeverity: text("flag_severity"),
  flaggedBy: text("flagged_by"),
  flaggedAt: timestamp("flagged_at"),
  securityPhotos: text("security_photos"),
  securityNotes: text("security_notes"),
  referralCode: text("referral_code").unique(),
  referredBy: text("referred_by"),
  referredByCode: text("referred_by_code"),
  creditScore: integer("credit_score").notNull().default(500),
  trustedVolume: integer("trusted_volume").notNull().default(0),
  realBalance: integer("real_balance").notNull().default(0),
  babalari: integer("babalari").notNull().default(0),
  excludeFromLoginLogs: boolean("exclude_from_login_logs").notNull().default(false),
  wins: bigint("wins", { mode: "number" }).notNull().default(0),
  totalWon: bigint("total_won", { mode: "number" }).notNull().default(0),
  rewardPoints: integer("reward_points").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPlayerSchema = createInsertSchema(playersTable).omit({ id: true, createdAt: true });
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Player = typeof playersTable.$inferSelect;
