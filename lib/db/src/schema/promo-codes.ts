import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  type: text("type").notNull(), // "single_use" | "multi_use"
  rewardType: text("reward_type").notNull(), // "chips" | "freeplay"
  rewardAmount: integer("reward_amount").notNull().default(0),
  maxUses: integer("max_uses"), // null = unlimited
  totalUses: integer("total_uses").notNull().default(0),
  createdBy: text("created_by").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PromoCode = typeof promoCodesTable.$inferSelect;

export const promoRedemptionsTable = pgTable("promo_redemptions", {
  id: serial("id").primaryKey(),
  playerId: integer("player_id").notNull(),
  codeId: integer("code_id").notNull(),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
});

export type PromoRedemption = typeof promoRedemptionsTable.$inferSelect;
