import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Persists each player's challenge progress server-side so it survives
 * logouts and browser refreshes. Stores a compact JSON blob of progress
 * counts, consecutive-win streak, and claimed IDs only — rotation metadata
 * is computed from dates and lives client-side.
 */
export const challengeStateTable = pgTable("challenge_state", {
  id:        serial("id").primaryKey(),
  playerId:  integer("player_id").notNull().unique(),
  stateJson: text("state_json").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ChallengeStateRow = typeof challengeStateTable.$inferSelect;
