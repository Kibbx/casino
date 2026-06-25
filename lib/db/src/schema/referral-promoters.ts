import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const referralPromotersTable = pgTable("referral_promoters", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull(),
  commissionPercent: integer("commission_percent").notNull().default(0),
  bonusChips: integer("bonus_chips").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReferralPromoter = typeof referralPromotersTable.$inferSelect;
