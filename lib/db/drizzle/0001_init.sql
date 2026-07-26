CREATE TABLE "sport_bet_slips" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"player_username" text NOT NULL,
	"type" text DEFAULT 'single' NOT NULL,
	"wager_amount" integer NOT NULL,
	"potential_payout" integer DEFAULT 0 NOT NULL,
	"actual_payout" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"selections" text DEFAULT '[]' NOT NULL,
	"admin_note" text,
	"settled_at" timestamp,
	"settled_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"challenge_id" text NOT NULL,
	"challenge_name" text NOT NULL,
	"reward_amount" integer NOT NULL,
	"period_key" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "challenge_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"state_json" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "challenge_state_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "wins" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "total_won" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "biggest_win" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "reward_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "blackjack_games" ADD COLUMN "shoe" jsonb;