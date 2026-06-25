CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"state_id" text,
	"phone_number" text,
	"pin" text DEFAULT '0000' NOT NULL,
	"chips" integer DEFAULT 0 NOT NULL,
	"hands_played" integer DEFAULT 0 NOT NULL,
	"timebank_seconds" integer DEFAULT 15 NOT NULL,
	"avatar_url" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"staff_role" text,
	"staff_role2" text,
	"staff_roles_json" text,
	"bonus_spins" integer DEFAULT 0 NOT NULL,
	"bonus_bet" integer DEFAULT 0 NOT NULL,
	"bonus_mult" integer DEFAULT 2 NOT NULL,
	"bonus_game" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"flag_severity" text,
	"flagged_by" text,
	"flagged_at" timestamp,
	"security_photos" text,
	"security_notes" text,
	"referral_code" text,
	"referred_by" text,
	"referred_by_code" text,
	"credit_score" integer DEFAULT 500 NOT NULL,
	"trusted_volume" integer DEFAULT 0 NOT NULL,
	"real_balance" integer DEFAULT 0 NOT NULL,
	"babalari" integer DEFAULT 0 NOT NULL,
	"exclude_from_login_logs" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "players_username_unique" UNIQUE("username"),
	CONSTRAINT "players_state_id_unique" UNIQUE("state_id"),
	CONSTRAINT "players_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"staff_id" integer,
	"staff_username" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poker_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"small_blind" integer NOT NULL,
	"big_blind" integer NOT NULL,
	"min_buy_in" integer NOT NULL,
	"max_buy_in" integer NOT NULL,
	"rake_percent" real DEFAULT 5 NOT NULL,
	"rake_cap" integer DEFAULT 500 NOT NULL,
	"seats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"game_state" jsonb,
	"tournament_id" integer,
	"ready_player_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"password" text,
	"theme" text DEFAULT 'velvet' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"escalation_enabled" boolean DEFAULT false NOT NULL,
	"reset_delay" integer DEFAULT 30 NOT NULL,
	"blind_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "blackjack_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"player_cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dealer_cards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bet" integer NOT NULL,
	"payout" integer,
	"split_cards" jsonb,
	"split_status" text,
	"split_payout" integer,
	"split_bet" integer,
	"active_hand" text DEFAULT 'main',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blackjack_hands" (
	"id" serial PRIMARY KEY NOT NULL,
	"table_id" integer NOT NULL,
	"table_name" varchar(128) DEFAULT '' NOT NULL,
	"round_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"player_name" varchar(128) NOT NULL,
	"seat_index" integer NOT NULL,
	"player_cards" varchar(128) NOT NULL,
	"player_value" integer NOT NULL,
	"split_cards" varchar(128),
	"split_value" integer,
	"dealer_cards" varchar(128) NOT NULL,
	"dealer_value" integer NOT NULL,
	"result" varchar(32) NOT NULL,
	"split_result" varchar(32),
	"bet" integer NOT NULL,
	"split_bet" integer DEFAULT 0 NOT NULL,
	"payout" integer NOT NULL,
	"odds_mode" varchar(16) DEFAULT 'standard' NOT NULL,
	"played_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banker_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"role" text DEFAULT 'banker' NOT NULL,
	"role2" text,
	"roles_json" text,
	"state_id" text,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "banker_accounts_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'poker' NOT NULL,
	"buy_in" integer NOT NULL,
	"starting_chips" integer NOT NULL,
	"max_players" integer DEFAULT 8 NOT NULL,
	"small_blind" integer DEFAULT 0 NOT NULL,
	"big_blind" integer DEFAULT 0 NOT NULL,
	"min_bet" integer,
	"max_bet" integer,
	"slot_game" text DEFAULT 'fortuna' NOT NULL,
	"status" text DEFAULT 'registering' NOT NULL,
	"prize_pool" integer DEFAULT 0 NOT NULL,
	"base_prize_pool" integer DEFAULT 0 NOT NULL,
	"buy_in_prize_percent" integer DEFAULT 100 NOT NULL,
	"winner_id" integer,
	"winner_name" text,
	"table_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"rebuys_enabled" boolean DEFAULT false NOT NULL,
	"max_rebuys" integer DEFAULT 1 NOT NULL,
	"duration_minutes" integer,
	"end_time" timestamp,
	"leaderboard_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"leaderboard_updated_at" timestamp,
	"prize_awarded" boolean DEFAULT false NOT NULL,
	"prize_awarded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournament_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"player_name" text NOT NULL,
	"tournament_chips" integer NOT NULL,
	"table_id" integer,
	"status" text DEFAULT 'registered' NOT NULL,
	"finish_position" integer,
	"rebuys_used" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"biggest_spin" integer DEFAULT 0 NOT NULL,
	"registered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "house_finances" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"staff_username" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_bet_finances" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'crate' NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"staff_username" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_bet_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"league" text DEFAULT '' NOT NULL,
	"game_date" timestamp,
	"status" text DEFAULT 'open' NOT NULL,
	"winner_id" integer,
	"rake_percent" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sport_bet_event_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"label" text NOT NULL,
	"odds" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_bet_event_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"option_id" integer NOT NULL,
	"player_id" integer,
	"player_name" text NOT NULL,
	"amount" integer NOT NULL,
	"entered_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "banker_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"username" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"role" text NOT NULL,
	"role2" text,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"username" text NOT NULL,
	"staff_role" text,
	"staff_role2" text
);
--> statement-breakpoint
CREATE TABLE "crash_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"bet" integer NOT NULL,
	"crash_point" real NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"cashout_multiplier" real,
	"payout" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"staff_username" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_warnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"staff_username" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_game_bans" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"game" text NOT NULL,
	"staff_id" integer NOT NULL,
	"staff_username" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp,
	"lifted" boolean DEFAULT false NOT NULL,
	"lifted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"image_url" varchar(500) NOT NULL,
	"target_url" varchar(500),
	"uploaded_by" varchar(100) NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_placements" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"page_key" varchar(50) NOT NULL,
	"x" real DEFAULT 10 NOT NULL,
	"y" real DEFAULT 10 NOT NULL,
	"width" real DEFAULT 30 NOT NULL,
	"height" real DEFAULT 15 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"desktop_visible" boolean DEFAULT true NOT NULL,
	"mobile_visible" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_promoters" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"commission_percent" integer DEFAULT 0 NOT NULL,
	"bonus_chips" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referral_promoters_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"reward_type" text NOT NULL,
	"reward_amount" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"total_uses" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"code_id" integer NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horses" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"odds" integer DEFAULT 10 NOT NULL,
	"weight" real DEFAULT 0.1 NOT NULL,
	"owner_id" integer,
	"owner_cut" real DEFAULT 0.02 NOT NULL,
	"total_earnings" integer DEFAULT 0 NOT NULL,
	"races_count" integer DEFAULT 0 NOT NULL,
	"wins_count" integer DEFAULT 0 NOT NULL,
	"losses_count" integer DEFAULT 0 NOT NULL,
	"variant_id" integer DEFAULT 1 NOT NULL,
	"visual_base" text DEFAULT 'brown' NOT NULL,
	"visual_pattern" text DEFAULT 'none' NOT NULL,
	"visual_flair" text DEFAULT 'none' NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"speed" integer DEFAULT 50 NOT NULL,
	"stamina" integer DEFAULT 50 NOT NULL,
	"acceleration" integer DEFAULT 50 NOT NULL,
	"luck" integer DEFAULT 50 NOT NULL,
	"base_sprite_key" text,
	"anim_frames" text,
	"anim_fps" integer DEFAULT 12 NOT NULL,
	"effect_type" text DEFAULT 'none' NOT NULL,
	"glow_color" text,
	"outline_color" text,
	"tack_color" text,
	"avg_stat" integer,
	"price" integer,
	"is_for_sale" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "horse_race_bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"race_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"horse_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"paid_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"banker_username" text NOT NULL,
	"amount" integer NOT NULL,
	"rows_marked" integer NOT NULL,
	"chips_delivered" boolean DEFAULT false NOT NULL,
	"linked_player_id" integer,
	"paid_by" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_score" integer NOT NULL,
	"interest_modifier" real DEFAULT 0 NOT NULL,
	"loan_multiplier" real DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"loan_id" integer NOT NULL,
	"banker_username" text NOT NULL,
	"payment_amount" integer NOT NULL,
	"interest_portion" integer NOT NULL,
	"employee_commission" integer NOT NULL,
	"casino_commission" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	"paid_by" text
);
--> statement-breakpoint
CREATE TABLE "loan_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"required_repaid" integer DEFAULT 0 NOT NULL,
	"cap" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"banker_username" text DEFAULT '' NOT NULL,
	"principal_amount" integer NOT NULL,
	"interest_rate" real DEFAULT 0 NOT NULL,
	"total_owed" integer NOT NULL,
	"remaining_balance" integer NOT NULL,
	"due_date" text,
	"status" text DEFAULT 'active' NOT NULL,
	"stage" text DEFAULT 'active' NOT NULL,
	"interest_accrued" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"payment_history" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "baccarat_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_bet" integer DEFAULT 100 NOT NULL,
	"max_bet" integer DEFAULT 10000 NOT NULL,
	"banker_commission" integer DEFAULT 5 NOT NULL,
	"tie_payout" integer DEFAULT 8 NOT NULL,
	"betting_timer_secs" integer DEFAULT 30 NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blackjack_tables" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"min_bet" integer DEFAULT 100 NOT NULL,
	"max_bet" integer DEFAULT 10000 NOT NULL,
	"num_seats" integer DEFAULT 6 NOT NULL,
	"theme" text DEFAULT 'velvet' NOT NULL,
	"password_hash" text,
	"house_edge" real DEFAULT 2.5 NOT NULL,
	"is_open" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mines_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"bet" integer NOT NULL,
	"mines" integer NOT NULL,
	"mine_positions" text NOT NULL,
	"revealed_tiles" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"current_multiplier" real DEFAULT 1 NOT NULL,
	"payout" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keno_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"bet" integer NOT NULL,
	"risk" text NOT NULL,
	"picks" text NOT NULL,
	"drawn" text NOT NULL,
	"hits" integer NOT NULL,
	"multiplier" real NOT NULL,
	"payout" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rakeback" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"wagered_real" integer DEFAULT 0 NOT NULL,
	"won_real" integer DEFAULT 0 NOT NULL,
	"period_start" timestamp DEFAULT now() NOT NULL,
	"last_claimed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rakeback_player_id_unique" UNIQUE("player_id")
);
--> statement-breakpoint
CREATE TABLE "highlow_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"bet" integer NOT NULL,
	"deck_json" text NOT NULL,
	"current_position" integer DEFAULT 0 NOT NULL,
	"current_multiplier" real DEFAULT 1 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"payout" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mob_tower_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"bet" integer NOT NULL,
	"floor_safes" text NOT NULL,
	"current_floor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'playing' NOT NULL,
	"payout" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blackjack_games" ADD CONSTRAINT "blackjack_games_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;