import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const challengeClaimsTable = pgTable("challenge_claims", {
  id:            serial("id").primaryKey(),
  playerId:      integer("player_id").notNull(),
  challengeId:   text("challenge_id").notNull(),
  challengeName: text("challenge_name").notNull(),
  rewardAmount:  integer("reward_amount").notNull(),
  periodKey:     text("period_key").notNull(),
  claimedAt:     timestamp("claimed_at").notNull().defaultNow(),
});

export type ChallengeClaim = typeof challengeClaimsTable.$inferSelect;
