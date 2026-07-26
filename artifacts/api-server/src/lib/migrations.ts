import { db } from "@workspace/db";

export async function runMigrations(): Promise<void> {
  const steps: Array<{ name: string; sql: string }> = [
    {
      name: "player_sessions table",
      sql: `CREATE TABLE IF NOT EXISTS player_sessions (
        token TEXT PRIMARY KEY,
        player_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        staff_role TEXT,
        staff_role2 TEXT
      )`,
    },
    {
      name: "banker_sessions table",
      sql: `CREATE TABLE IF NOT EXISTS banker_sessions (
        token TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        role TEXT NOT NULL,
        role2 TEXT,
        expires_at BIGINT NOT NULL
      )`,
    },
    {
      name: "sport_bet_events.league column",
      sql: `ALTER TABLE sport_bet_events ADD COLUMN IF NOT EXISTS league TEXT NOT NULL DEFAULT ''`,
    },
    {
      name: "sport_bet_events.game_date column",
      sql: `ALTER TABLE sport_bet_events ADD COLUMN IF NOT EXISTS game_date TIMESTAMP`,
    },
    {
      name: "sport_bet_event_entries.paid_at column",
      sql: `ALTER TABLE sport_bet_event_entries ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`,
    },
    {
      name: "sport_bet_events.rake_percent column",
      sql: `ALTER TABLE sport_bet_events ADD COLUMN IF NOT EXISTS rake_percent INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "transactions.staff_id column",
      sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS staff_id INTEGER`,
    },
    {
      name: "transactions.staff_username column",
      sql: `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS staff_username TEXT`,
    },
    {
      name: "banker_accounts.role2 column",
      sql: `ALTER TABLE banker_accounts ADD COLUMN IF NOT EXISTS role2 TEXT`,
    },
    {
      name: "banker_accounts.roles_json column",
      sql: `ALTER TABLE banker_accounts ADD COLUMN IF NOT EXISTS roles_json TEXT`,
    },
    {
      name: "player_game_bans.lifted column",
      sql: `ALTER TABLE player_game_bans ADD COLUMN IF NOT EXISTS lifted BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "player_game_bans.lifted_by column",
      sql: `ALTER TABLE player_game_bans ADD COLUMN IF NOT EXISTS lifted_by TEXT`,
    },
    {
      name: "player_game_bans.staff_username column",
      sql: `ALTER TABLE player_game_bans ADD COLUMN IF NOT EXISTS staff_username TEXT NOT NULL DEFAULT ''`,
    },
    {
      name: "player_notes.staff_username column",
      sql: `ALTER TABLE player_notes ADD COLUMN IF NOT EXISTS staff_username TEXT NOT NULL DEFAULT ''`,
    },
    {
      name: "player_warnings.staff_username column",
      sql: `ALTER TABLE player_warnings ADD COLUMN IF NOT EXISTS staff_username TEXT NOT NULL DEFAULT ''`,
    },
    {
      name: "promo_regions table",
      sql: `CREATE TABLE IF NOT EXISTS promo_regions (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        page_key VARCHAR(50) NOT NULL,
        x INTEGER NOT NULL DEFAULT 0,
        y INTEGER NOT NULL DEFAULT 0,
        width INTEGER NOT NULL DEFAULT 300,
        height INTEGER NOT NULL DEFAULT 100,
        is_active BOOLEAN NOT NULL DEFAULT true,
        desktop_visible BOOLEAN NOT NULL DEFAULT true,
        mobile_visible BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "promo_assets table",
      sql: `CREATE TABLE IF NOT EXISTS promo_assets (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        image_url VARCHAR(500) NOT NULL,
        target_url VARCHAR(500),
        uploaded_by VARCHAR(100) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "promo_placements table",
      sql: `CREATE TABLE IF NOT EXISTS promo_placements (
        id SERIAL PRIMARY KEY,
        region_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_by VARCHAR(100) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "promo_regions x/y/width/height to real (percentage-based)",
      sql: `ALTER TABLE promo_regions
        ALTER COLUMN x TYPE real USING x::real,
        ALTER COLUMN y TYPE real USING y::real,
        ALTER COLUMN width TYPE real USING width::real,
        ALTER COLUMN height TYPE real USING height::real`,
    },
    {
      name: "players.hands_played column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS hands_played INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "players.referral_code column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE`,
    },
    {
      name: "players.referred_by column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by TEXT`,
    },
    {
      name: "players.referred_by_code column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS referred_by_code TEXT`,
    },
    {
      name: "players.referral_code backfill from state_id",
      sql: `UPDATE players SET referral_code = state_id WHERE referral_code IS NULL AND state_id IS NOT NULL`,
    },
    {
      name: "referral_promoters table",
      sql: `CREATE TABLE IF NOT EXISTS referral_promoters (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        owner_user_id TEXT NOT NULL,
        commission_percent INTEGER NOT NULL DEFAULT 0,
        bonus_chips INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "referral_promoters.bonus_chips column",
      sql: `ALTER TABLE referral_promoters ADD COLUMN IF NOT EXISTS bonus_chips INTEGER NOT NULL DEFAULT 0`,
    },
    // ── Slot tournament support ────────────────────────────────────────────────
    {
      name: "tournaments.type column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'poker'`,
    },
    {
      name: "tournaments.min_bet column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS min_bet INTEGER`,
    },
    {
      name: "tournaments.max_bet column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_bet INTEGER`,
    },
    {
      name: "tournaments.small_blind nullable default",
      sql: `ALTER TABLE tournaments ALTER COLUMN small_blind SET DEFAULT 0`,
    },
    {
      name: "tournaments.big_blind nullable default",
      sql: `ALTER TABLE tournaments ALTER COLUMN big_blind SET DEFAULT 0`,
    },
    {
      name: "tournament_entries.score column",
      sql: `ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "tournament_entries.biggest_spin column",
      sql: `ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS biggest_spin INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "tournaments.duration_minutes column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER`,
    },
    {
      name: "tournaments.end_time column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS end_time TIMESTAMP`,
    },
    // ── Missing players columns ────────────────────────────────────────────────
    {
      name: "players.staff_role2 column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS staff_role2 TEXT`,
    },
    {
      name: "players.staff_roles_json column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS staff_roles_json TEXT`,
    },
    {
      name: "players.bonus_spins column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_spins INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "players.bonus_bet column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_bet INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "players.bonus_mult column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_mult INTEGER NOT NULL DEFAULT 2`,
    },
    {
      name: "players.flagged column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "players.flag_reason column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_reason TEXT`,
    },
    {
      name: "players.flagged_by column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS flagged_by TEXT`,
    },
    {
      name: "players.flagged_at column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP`,
    },
    {
      name: "players.flag_severity column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS flag_severity TEXT DEFAULT 'MED'`,
    },
    {
      name: "players.security_photos column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS security_photos TEXT`,
    },
    {
      name: "players.security_notes column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS security_notes TEXT`,
    },
    {
      name: "players.avatar_url column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_url TEXT`,
    },
    // ── Core tables that may be absent on VPS if never manually created ────────
    {
      name: "settings table",
      sql: `CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL
      )`,
    },
    {
      name: "poker_tables table",
      sql: `CREATE TABLE IF NOT EXISTS poker_tables (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        small_blind INTEGER NOT NULL DEFAULT 10,
        big_blind INTEGER NOT NULL DEFAULT 20,
        min_buy_in INTEGER NOT NULL DEFAULT 200,
        max_buy_in INTEGER NOT NULL DEFAULT 2000,
        rake_percent REAL NOT NULL DEFAULT 5,
        rake_cap INTEGER NOT NULL DEFAULT 500,
        seats JSONB NOT NULL DEFAULT '[]',
        game_state JSONB,
        tournament_id INTEGER,
        ready_player_ids JSONB NOT NULL DEFAULT '[]',
        password TEXT,
        theme TEXT NOT NULL DEFAULT 'velvet',
        locked BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "house_finances table",
      sql: `CREATE TABLE IF NOT EXISTS house_finances (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        staff_username TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "crash_games table",
      sql: `CREATE TABLE IF NOT EXISTS crash_games (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        bet INTEGER NOT NULL,
        crash_point REAL NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'playing',
        cashout_multiplier REAL,
        payout INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "blackjack_games table",
      sql: `CREATE TABLE IF NOT EXISTS blackjack_games (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        player_cards JSONB NOT NULL DEFAULT '[]',
        dealer_cards JSONB NOT NULL DEFAULT '[]',
        bet INTEGER NOT NULL,
        payout INTEGER,
        split_cards JSONB,
        split_status TEXT,
        split_payout INTEGER,
        split_bet INTEGER,
        active_hand TEXT DEFAULT 'main',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "horse_race_bets table",
      sql: `CREATE TABLE IF NOT EXISTS horse_race_bets (
        id SERIAL PRIMARY KEY,
        race_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        horse_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        paid_out BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "promo_codes table",
      sql: `CREATE TABLE IF NOT EXISTS promo_codes (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        reward_type TEXT NOT NULL,
        reward_amount INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER,
        total_uses INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "promo_redemptions table",
      sql: `CREATE TABLE IF NOT EXISTS promo_redemptions (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        code_id INTEGER NOT NULL,
        redeemed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "sport_bet_event_options table",
      sql: `CREATE TABLE IF NOT EXISTS sport_bet_event_options (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        odds TEXT NOT NULL
      )`,
    },
    {
      name: "sport_bet_finances table",
      sql: `CREATE TABLE IF NOT EXISTS sport_bet_finances (
        id SERIAL PRIMARY KEY,
        source TEXT NOT NULL DEFAULT 'crate',
        type TEXT NOT NULL,
        amount INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        staff_username TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    // ── Horses table (create if not exists, then add columns idempotently) ────
    {
      name: "horses table",
      sql: `CREATE TABLE IF NOT EXISTS horses (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        odds INTEGER NOT NULL DEFAULT 10,
        weight REAL NOT NULL DEFAULT 0.1
      )`,
    },
    // ── Horse base columns (added after initial table creation) ───────────────
    {
      name: "horses.owner_id column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_id INTEGER`,
    },
    {
      name: "horses.owner_cut column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS owner_cut REAL NOT NULL DEFAULT 0.02`,
    },
    {
      name: "horses.total_earnings column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS total_earnings INTEGER NOT NULL DEFAULT 0`,
    },
    // ── Horse visual / stats columns ───────────────────────────────────────────
    {
      name: "horses.variant_id column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS variant_id INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "horses.visual_base column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS visual_base TEXT NOT NULL DEFAULT 'brown'`,
    },
    {
      name: "horses.visual_pattern column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS visual_pattern TEXT NOT NULL DEFAULT 'none'`,
    },
    {
      name: "horses.visual_flair column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS visual_flair TEXT NOT NULL DEFAULT 'none'`,
    },
    {
      name: "horses.rarity column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'common'`,
    },
    {
      name: "horses.speed column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS speed INTEGER NOT NULL DEFAULT 50`,
    },
    {
      name: "horses.stamina column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS stamina INTEGER NOT NULL DEFAULT 50`,
    },
    {
      name: "horses.acceleration column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS acceleration INTEGER NOT NULL DEFAULT 50`,
    },
    {
      name: "horses.luck column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS luck INTEGER NOT NULL DEFAULT 50`,
    },
    {
      name: "horses.base_sprite_key column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS base_sprite_key TEXT`,
    },
    {
      name: "horses.anim_frames column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS anim_frames TEXT`,
    },
    {
      name: "horses.anim_fps column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS anim_fps INTEGER NOT NULL DEFAULT 12`,
    },
    {
      name: "horses.effect_type column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS effect_type TEXT NOT NULL DEFAULT 'none'`,
    },
    {
      name: "horses.glow_color column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS glow_color TEXT`,
    },
    {
      name: "horses.outline_color column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS outline_color TEXT`,
    },
    {
      name: "horses.tack_color column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS tack_color TEXT`,
    },
    // ── Horse race history ─────────────────────────────────────────────────────
    {
      name: "horses.races_count column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS races_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "horses.wins_count column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS wins_count INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "horses.losses_count column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS losses_count INTEGER NOT NULL DEFAULT 0`,
    },
    // ── Horse pricing / AVG system ─────────────────────────────────────────────
    {
      name: "horses.avg_stat column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS avg_stat INTEGER`,
    },
    {
      name: "horses.price column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS price INTEGER`,
    },
    {
      name: "horses.is_for_sale column",
      sql: `ALTER TABLE horses ADD COLUMN IF NOT EXISTS is_for_sale BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "horses.avg_stat backfill",
      sql: `UPDATE horses SET avg_stat = ROUND((speed + stamina + acceleration + luck) / 4.0) WHERE avg_stat IS NULL`,
    },
    {
      name: "loans table",
      sql: `CREATE TABLE IF NOT EXISTS loans (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        banker_username TEXT NOT NULL DEFAULT '',
        principal_amount INTEGER NOT NULL,
        interest_rate REAL NOT NULL DEFAULT 0,
        total_owed INTEGER NOT NULL,
        remaining_balance INTEGER NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        notes TEXT,
        payment_history TEXT NOT NULL DEFAULT '[]',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "players.credit_score column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS credit_score INTEGER NOT NULL DEFAULT 500`,
    },
    {
      name: "loans.stage column",
      sql: `ALTER TABLE loans ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'active'`,
    },
    {
      name: "loans.interest_accrued column",
      sql: `ALTER TABLE loans ADD COLUMN IF NOT EXISTS interest_accrued INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "credit_tiers table",
      sql: `CREATE TABLE IF NOT EXISTS credit_tiers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        min_score INTEGER NOT NULL,
        interest_modifier REAL NOT NULL DEFAULT 0,
        loan_multiplier REAL NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "credit_tiers default data",
      sql: `INSERT INTO credit_tiers (name, min_score, interest_modifier, loan_multiplier)
        SELECT * FROM (VALUES
          ('Standard', 0, 0, 1),
          ('Reliable', 400, -5, 1.5),
          ('Trusted', 600, -10, 2),
          ('VIP', 800, -15, 3),
          ('Elite', 900, -20, 4)
        ) AS t(name, min_score, interest_modifier, loan_multiplier)
        WHERE NOT EXISTS (SELECT 1 FROM credit_tiers LIMIT 1)`,
    },
    {
      name: "loan settings seed",
      sql: `INSERT INTO settings (key, value) VALUES
        ('loan.baseInterestRate', '25'),
        ('loan.loanMultiplier', '500'),
        ('loan.minActiveDays', '3'),
        ('loan.minTotalWagered', '50000'),
        ('loan.minCreditScore', '250'),
        ('loan.overdueDays', '3'),
        ('loan.delinquentDays', '7'),
        ('loan.collectionsDays', '14'),
        ('loan.interestMode', 'flat'),
        ('loan.dailyInterestRate', '2'),
        ('loan.maxInterestCap', '200'),
        ('loan.blockWithdrawals', 'false'),
        ('loan.autoDeductFromDeposit', 'false'),
        ('loan.autoDeductPercent', '20'),
        ('loan.autoFlagEscalated', 'true')
        ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "loan settings — relax hard minimums",
      sql: `UPDATE settings SET value = '0' WHERE key = 'loan.minActiveDays' AND value = '3';
            UPDATE settings SET value = '0' WHERE key = 'loan.minTotalWagered' AND value = '50000';
            UPDATE settings SET value = '100' WHERE key = 'loan.minCreditScore' AND value = '250'`,
    },
    {
      name: "players.trusted_volume column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS trusted_volume INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "loan_tiers table",
      sql: `CREATE TABLE IF NOT EXISTS loan_tiers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        required_repaid INTEGER NOT NULL DEFAULT 0,
        cap INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "loan_tiers default data",
      sql: `INSERT INTO loan_tiers (name, required_repaid, cap, sort_order) VALUES
        ('New',      0,       75000,   0),
        ('Unproven', 100000,  150000,  1),
        ('Trusted',  300000,  300000,  2),
        ('Reliable', 750000,  600000,  3),
        ('VIP',      2000000, 1200000, 4)
        ON CONFLICT DO NOTHING`,
    },
    {
      name: "loan progression settings seed",
      sql: `INSERT INTO settings (key, value) VALUES
        ('loan.minQualifyingLoan',       '50000'),
        ('loan.progressionMultiLarge',   '1.5'),
        ('loan.progressionMultiMid',     '1.2'),
        ('loan.progressionMultiSmall',   '0.2'),
        ('loan.progressionBlockDefaults','true'),
        ('loan.progressionBlockOverdue', '2')
        ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "baccarat_tables table",
      sql: `CREATE TABLE IF NOT EXISTS baccarat_tables (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        min_bet INTEGER NOT NULL DEFAULT 100,
        max_bet INTEGER NOT NULL DEFAULT 10000,
        banker_commission INTEGER NOT NULL DEFAULT 5,
        tie_payout INTEGER NOT NULL DEFAULT 8,
        betting_timer_secs INTEGER NOT NULL DEFAULT 30,
        is_open BOOLEAN NOT NULL DEFAULT true,
        password_hash TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "baccarat_tables default table",
      sql: `INSERT INTO baccarat_tables (name, min_bet, max_bet, banker_commission, tie_payout, betting_timer_secs, is_open)
        SELECT 'VIP Baccarat', 100, 25000, 5, 8, 30, true
        WHERE NOT EXISTS (SELECT 1 FROM baccarat_tables LIMIT 1)`,
    },
    {
      name: "blackjack_tables table",
      sql: `CREATE TABLE IF NOT EXISTS blackjack_tables (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        min_bet INTEGER NOT NULL DEFAULT 100,
        max_bet INTEGER NOT NULL DEFAULT 10000,
        num_seats INTEGER NOT NULL DEFAULT 6,
        theme TEXT NOT NULL DEFAULT 'velvet',
        password_hash TEXT,
        is_open BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "blackjack_tables default table",
      sql: `INSERT INTO blackjack_tables (name, min_bet, max_bet, num_seats, theme, is_open)
        SELECT 'Main Table', 100, 10000, 6, 'velvet', true
        WHERE NOT EXISTS (SELECT 1 FROM blackjack_tables LIMIT 1)`,
    },
    {
      name: "blackjack_tables house_edge column",
      sql: `ALTER TABLE blackjack_tables ADD COLUMN IF NOT EXISTS house_edge REAL NOT NULL DEFAULT 2.5`,
    },
    {
      name: "poker_tables escalation_enabled column",
      sql: `ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS escalation_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
    },
    {
      name: "poker_tables reset_delay column",
      sql: `ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS reset_delay INTEGER NOT NULL DEFAULT 30`,
    },
    {
      name: "poker_tables blind_levels column",
      sql: `ALTER TABLE poker_tables ADD COLUMN IF NOT EXISTS blind_levels JSONB NOT NULL DEFAULT '[]'`,
    },
    {
      name: "credit score formula weights seed",
      sql: `INSERT INTO settings (key, value) VALUES
        ('loan.scoreBase',                '300'),
        ('loan.scoreDepositWeight',       '0.15'),
        ('loan.scoreTrustedVolumeWeight', '0.5'),
        ('loan.scoreLoansRepaidBonus',    '50'),
        ('loan.scoreActiveDaysBonus',     '3'),
        ('loan.scoreDefaultPenalty',      '150'),
        ('loan.scoreOverduePenalty',      '75')
        ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "loan_tiers deduplicate rows",
      sql: `DELETE FROM loan_tiers WHERE id NOT IN (
        SELECT MIN(id) FROM loan_tiers GROUP BY name
      )`,
    },
    {
      name: "loan_tiers unique name constraint",
      sql: `DO $$ BEGIN
        ALTER TABLE loan_tiers ADD CONSTRAINT loan_tiers_name_unique UNIQUE (name);
      EXCEPTION WHEN duplicate_table THEN NULL; WHEN others THEN
        IF SQLERRM NOT LIKE '%already exists%' THEN RAISE; END IF;
      END $$`,
    },
    {
      name: "create owner_preset_history table",
      sql: `
        CREATE TABLE IF NOT EXISTS owner_preset_history (
          id         SERIAL PRIMARY KEY,
          preset_id   VARCHAR(32)  NOT NULL,
          preset_name VARCHAR(64)  NOT NULL,
          applied_by  VARCHAR(128) NOT NULL,
          applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `,
    },
    {
      name: "prize_items table",
      sql: `
        CREATE TABLE IF NOT EXISTS prize_items (
          id          SERIAL PRIMARY KEY,
          name        VARCHAR(120) NOT NULL,
          description TEXT,
          emoji       VARCHAR(20)  NOT NULL DEFAULT '🎁',
          category    VARCHAR(50)  NOT NULL DEFAULT 'misc',
          created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `,
    },
    {
      name: "prize_items.type column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'item'`,
    },
    {
      name: "prize_items.value column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS value NUMERIC(12,2)`,
    },
    {
      name: "pending_rewards.bet_paid_by column",
      sql: `ALTER TABLE pending_rewards ADD COLUMN IF NOT EXISTS bet_paid_by TEXT`,
    },
    {
      name: "pending_rewards.bet_paid_amount column",
      sql: `ALTER TABLE pending_rewards ADD COLUMN IF NOT EXISTS bet_paid_amount NUMERIC(12,2)`,
    },
    {
      name: "pending_rewards.bet_reimbursed column",
      sql: `ALTER TABLE pending_rewards ADD COLUMN IF NOT EXISTS bet_reimbursed BOOLEAN NOT NULL DEFAULT FALSE`,
    },
    {
      name: "pending_rewards.bet_reimbursed_by column",
      sql: `ALTER TABLE pending_rewards ADD COLUMN IF NOT EXISTS bet_reimbursed_by TEXT`,
    },
    {
      name: "pending_rewards.bet_reimbursed_at column",
      sql: `ALTER TABLE pending_rewards ADD COLUMN IF NOT EXISTS bet_reimbursed_at TIMESTAMPTZ`,
    },
    {
      name: "pending_rewards table",
      sql: `
        CREATE TABLE IF NOT EXISTS pending_rewards (
          id                  SERIAL PRIMARY KEY,
          player_id           INTEGER      NOT NULL,
          player_name         VARCHAR(120) NOT NULL,
          game                VARCHAR(20)  NOT NULL,
          prize_type          VARCHAR(20)  NOT NULL,
          prize_name          VARCHAR(200) NOT NULL,
          prize_emoji         VARCHAR(20)  NOT NULL DEFAULT '🎁',
          chips_amount        INTEGER      NOT NULL DEFAULT 0,
          prize_item_id       INTEGER,
          won_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
          delivered_at        TIMESTAMPTZ,
          delivered_by        VARCHAR(120),
          notes               TEXT
        )
      `,
    },
    {
      name: "create blackjack_hands table",
      sql: `
        CREATE TABLE IF NOT EXISTS blackjack_hands (
          id           SERIAL PRIMARY KEY,
          table_id     INTEGER      NOT NULL,
          table_name   VARCHAR(128) NOT NULL DEFAULT '',
          round_id     INTEGER      NOT NULL,
          player_id    INTEGER      NOT NULL,
          player_name  VARCHAR(128) NOT NULL,
          seat_index   INTEGER      NOT NULL,
          player_cards VARCHAR(128) NOT NULL,
          player_value INTEGER      NOT NULL,
          split_cards  VARCHAR(128),
          split_value  INTEGER,
          dealer_cards VARCHAR(128) NOT NULL,
          dealer_value INTEGER      NOT NULL,
          result       VARCHAR(32)  NOT NULL,
          split_result VARCHAR(32),
          bet          INTEGER      NOT NULL,
          split_bet    INTEGER      NOT NULL DEFAULT 0,
          payout       INTEGER      NOT NULL,
          odds_mode    VARCHAR(16)  NOT NULL DEFAULT 'standard',
          played_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
      `,
    },
    {
      name: "bet_deposits table",
      sql: `CREATE TABLE IF NOT EXISTS bet_deposits (
        id           SERIAL PRIMARY KEY,
        player_id    INTEGER NOT NULL,
        player_name  VARCHAR(128) NOT NULL,
        bet_amount   NUMERIC(12,2) NOT NULL,
        chips_amount INTEGER NOT NULL,
        rate_per_bet INTEGER NOT NULL DEFAULT 250,
        logged_by    VARCHAR(128) NOT NULL,
        notes        TEXT,
        logged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "house_bet_ledger table",
      sql: `CREATE TABLE IF NOT EXISTS house_bet_ledger (
        id          SERIAL PRIMARY KEY,
        direction   VARCHAR(3)    NOT NULL CHECK (direction IN ('in','out')),
        amount      NUMERIC(12,2) NOT NULL,
        category    VARCHAR(32)   NOT NULL DEFAULT 'adjustment',
        player_name VARCHAR(128),
        logged_by   VARCHAR(128)  NOT NULL,
        notes       TEXT,
        logged_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "house_bet_ledger.logged_at backfill",
      sql: `ALTER TABLE house_bet_ledger ADD COLUMN IF NOT EXISTS logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
    },
    {
      name: "prize_items.stock column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS stock INTEGER`,
    },
    {
      name: "prize_items.wheel_weight column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS wheel_weight INTEGER`,
    },
    {
      name: "prize_items.wheel_color column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS wheel_color VARCHAR(16)`,
    },
    {
      name: "prize_items.wheel_slots column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS wheel_slots INTEGER NOT NULL DEFAULT 1`,
    },
    {
      name: "tournaments.prize_awarded column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_awarded BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "tournaments.prize_awarded_at column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS prize_awarded_at TIMESTAMP`,
    },
    // ── Cases ──────────────────────────────────────────────────────────────────
    {
      name: "prize_items.tier column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'common'`,
    },
    {
      name: "cases table",
      sql: `CREATE TABLE IF NOT EXISTS cases (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL DEFAULT '📦',
        description TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        enabled BOOLEAN NOT NULL DEFAULT true,
        tier_common INTEGER NOT NULL DEFAULT 55,
        tier_rare INTEGER NOT NULL DEFAULT 25,
        tier_epic INTEGER NOT NULL DEFAULT 12,
        tier_legendary INTEGER NOT NULL DEFAULT 6,
        tier_jackpot INTEGER NOT NULL DEFAULT 2,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "case_items table",
      sql: `CREATE TABLE IF NOT EXISTS case_items (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        prize_item_id INTEGER NOT NULL,
        UNIQUE(case_id, prize_item_id)
      )`,
    },
    {
      name: "cases.image_url column",
      sql: `ALTER TABLE cases ADD COLUMN IF NOT EXISTS image_url TEXT`,
    },
    {
      name: "prize_items.image_url column",
      sql: `ALTER TABLE prize_items ADD COLUMN IF NOT EXISTS image_url TEXT`,
    },
    {
      name: "players.gems column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS gems INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "cases.price_gems column",
      sql: `ALTER TABLE cases ADD COLUMN IF NOT EXISTS price_gems INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "cases: update column defaults to CS:GO-style integer weights",
      sql: `
        ALTER TABLE cases
          ALTER COLUMN tier_common    SET DEFAULT 7992,
          ALTER COLUMN tier_rare      SET DEFAULT 1598,
          ALTER COLUMN tier_epic      SET DEFAULT 320,
          ALTER COLUMN tier_legendary SET DEFAULT 64,
          ALTER COLUMN tier_jackpot   SET DEFAULT 26
      `,
    },
    {
      name: "cases: migrate old percentage weights to CS:GO integer weights",
      sql: `
        UPDATE cases SET
          tier_common    = 7992,
          tier_rare      = 1598,
          tier_epic      = 320,
          tier_legendary = 64,
          tier_jackpot   = 26
        WHERE (tier_common + tier_rare + tier_epic + tier_legendary + tier_jackpot) BETWEEN 99 AND 101
      `,
    },
    {
      name: "case_open_log table",
      sql: `CREATE TABLE IF NOT EXISTS case_open_log (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        case_id INTEGER NOT NULL,
        case_name TEXT NOT NULL,
        case_cost INTEGER NOT NULL DEFAULT 0,
        prize_id INTEGER,
        prize_name TEXT NOT NULL,
        prize_tier TEXT NOT NULL,
        prize_value INTEGER NOT NULL DEFAULT 0,
        roll_result NUMERIC NOT NULL DEFAULT 0,
        total_weight INTEGER NOT NULL DEFAULT 0,
        prize_weight INTEGER NOT NULL DEFAULT 0,
        prize_chance NUMERIC NOT NULL DEFAULT 0,
        outcome TEXT NOT NULL DEFAULT 'item',
        profit_loss INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "keno_games table",
      sql: `CREATE TABLE IF NOT EXISTS keno_games (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        bet INTEGER NOT NULL,
        risk TEXT NOT NULL,
        picks TEXT NOT NULL,
        drawn TEXT NOT NULL,
        hits INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        payout INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "player_inventory table",
      sql: `CREATE TABLE IF NOT EXISTS player_inventory (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        prize_item_id INTEGER,
        prize_name VARCHAR(200) NOT NULL,
        prize_emoji VARCHAR(20) NOT NULL DEFAULT '🎁',
        prize_type VARCHAR(32) NOT NULL DEFAULT 'item',
        quantity INTEGER NOT NULL DEFAULT 1,
        image_url TEXT,
        tier VARCHAR(20),
        source VARCHAR(100),
        first_won_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_won_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(player_id, prize_item_id)
      )`,
    },
    {
      name: "banker_accounts.state_id column",
      sql: `ALTER TABLE banker_accounts ADD COLUMN IF NOT EXISTS state_id TEXT`,
    },
    {
      name: "loan_commissions table",
      sql: `CREATE TABLE IF NOT EXISTS loan_commissions (
        id SERIAL PRIMARY KEY,
        loan_id INTEGER NOT NULL,
        banker_username TEXT NOT NULL,
        payment_amount INTEGER NOT NULL,
        interest_portion INTEGER NOT NULL,
        employee_commission INTEGER NOT NULL,
        casino_commission INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "player_tags table",
      sql: `CREATE TABLE IF NOT EXISTS player_tags (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        label TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6b7280',
        created_by TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "loan_commissions.paid_at column",
      sql: `ALTER TABLE loan_commissions ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`,
    },
    {
      name: "loan_commissions.paid_by column",
      sql: `ALTER TABLE loan_commissions ADD COLUMN IF NOT EXISTS paid_by TEXT`,
    },
    {
      name: "player_tags.flagged column",
      sql: `ALTER TABLE player_tags ADD COLUMN IF NOT EXISTS flagged BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "commission_payouts table",
      sql: `CREATE TABLE IF NOT EXISTS commission_payouts (
        id SERIAL PRIMARY KEY,
        banker_username TEXT NOT NULL,
        amount INTEGER NOT NULL,
        rows_marked INTEGER NOT NULL,
        chips_delivered BOOLEAN NOT NULL DEFAULT false,
        linked_player_id INTEGER,
        paid_by TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "highlow_games table",
      sql: `DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'highlow_games') THEN
          CREATE TABLE highlow_games (
            id SERIAL PRIMARY KEY,
            player_id INTEGER NOT NULL,
            bet INTEGER NOT NULL,
            deck_json TEXT NOT NULL,
            current_position INTEGER NOT NULL DEFAULT 0,
            current_multiplier REAL NOT NULL DEFAULT 1.0,
            streak INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'playing',
            payout INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );
        ELSIF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'highlow_games' AND column_name = 'deck_json') THEN
          DROP TABLE highlow_games;
          CREATE TABLE highlow_games (
            id SERIAL PRIMARY KEY,
            player_id INTEGER NOT NULL,
            bet INTEGER NOT NULL,
            deck_json TEXT NOT NULL,
            current_position INTEGER NOT NULL DEFAULT 0,
            current_multiplier REAL NOT NULL DEFAULT 1.0,
            streak INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'playing',
            payout INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          );
        END IF;
      END $$`,
    },
    {
      name: "mines_games table",
      sql: `
        CREATE TABLE IF NOT EXISTS mines_games (
          id SERIAL PRIMARY KEY,
          player_id INTEGER NOT NULL,
          bet INTEGER NOT NULL,
          mines INTEGER NOT NULL,
          mine_positions TEXT NOT NULL,
          revealed_tiles TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL DEFAULT 'playing',
          current_multiplier REAL NOT NULL DEFAULT 1.0,
          payout INTEGER,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`,
    },
    {
      name: "players.real_balance column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS real_balance INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "tournaments.slot_game column",
      sql: `ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS slot_game TEXT NOT NULL DEFAULT 'fortuna'`,
    },
    {
      name: "rakeback table",
      sql: `
        CREATE TABLE IF NOT EXISTS rakeback (
          id SERIAL PRIMARY KEY,
          player_id INTEGER NOT NULL UNIQUE,
          wagered_real INTEGER NOT NULL DEFAULT 0,
          won_real INTEGER NOT NULL DEFAULT 0,
          period_start TIMESTAMP NOT NULL DEFAULT NOW(),
          last_claimed TIMESTAMP,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )`,
    },
    {
      name: "players.babalari column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS babalari INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "settings.babalariRate seed",
      sql: `INSERT INTO settings (key, value) VALUES ('babalariRate', '1000') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "babalari_ledger table",
      sql: `CREATE TABLE IF NOT EXISTS babalari_ledger (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        amount INTEGER NOT NULL,
        direction TEXT NOT NULL,
        chips_amount INTEGER,
        rate INTEGER,
        reason TEXT,
        logged_by TEXT,
        logged_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "babalari_ledger nullable player columns",
      sql: `
        ALTER TABLE babalari_ledger ALTER COLUMN player_id DROP NOT NULL;
        ALTER TABLE babalari_ledger ALTER COLUMN player_name DROP NOT NULL;
      `,
    },
    {
      name: "babalari_ledger add category column",
      sql: `ALTER TABLE babalari_ledger ADD COLUMN IF NOT EXISTS category TEXT`,
    },
    {
      name: "settings.babalariSellPrice seed",
      sql: `INSERT INTO settings (key, value) VALUES ('babalariSellPrice', '0.10') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "players.bonus_game column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_game TEXT`,
    },
    {
      name: "mob_tower_games table",
      sql: `CREATE TABLE IF NOT EXISTS mob_tower_games (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        bet INTEGER NOT NULL,
        floor_safes TEXT NOT NULL,
        current_floor INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'playing',
        payout INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "settings seed: promoCodesEnabled",
      sql: `INSERT INTO settings (key, value) VALUES ('promoCodesEnabled', 'true') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "settings seed: referralCodesEnabled",
      sql: `INSERT INTO settings (key, value) VALUES ('referralCodesEnabled', 'true') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "settings seed: playerTransfersEnabled",
      sql: `INSERT INTO settings (key, value) VALUES ('playerTransfersEnabled', 'true') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "bingo_settings table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_settings (
        id SERIAL PRIMARY KEY,
        card_price INTEGER NOT NULL DEFAULT 1000,
        max_cards_per_player INTEGER NOT NULL DEFAULT 5,
        house_cut_percent INTEGER NOT NULL DEFAULT 20,
        prize_pool_percent INTEGER NOT NULL DEFAULT 80,
        winning_pattern TEXT NOT NULL DEFAULT 'single_line',
        updated_by TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "bingo_settings seed row",
      sql: `INSERT INTO bingo_settings (card_price, max_cards_per_player, house_cut_percent, prize_pool_percent, winning_pattern)
        SELECT 1000, 5, 20, 80, 'single_line' WHERE NOT EXISTS (SELECT 1 FROM bingo_settings)`,
    },
    {
      name: "bingo_rounds table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_rounds (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'waiting',
        dealer_id INTEGER,
        dealer_username TEXT,
        card_price INTEGER NOT NULL DEFAULT 1000,
        max_cards_per_player INTEGER NOT NULL DEFAULT 5,
        house_cut_percent INTEGER NOT NULL DEFAULT 20,
        prize_pool_percent INTEGER NOT NULL DEFAULT 80,
        winning_pattern TEXT NOT NULL DEFAULT 'single_line',
        drawn_balls TEXT NOT NULL DEFAULT '[]',
        total_cards_sold INTEGER NOT NULL DEFAULT 0,
        total_collected BIGINT NOT NULL DEFAULT 0,
        prize_pool BIGINT NOT NULL DEFAULT 0,
        house_profit BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        buying_opened_at TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP
      )`,
    },
    {
      name: "bingo_cards table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_cards (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        card_numbers TEXT NOT NULL,
        marked_numbers TEXT NOT NULL DEFAULT '[0]',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "bingo_claims table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_claims (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        player_name TEXT NOT NULL DEFAULT '',
        state_id TEXT NOT NULL DEFAULT '',
        phone_number TEXT NOT NULL DEFAULT '',
        claimed_card_id INTEGER NOT NULL,
        card_numbers TEXT NOT NULL,
        marked_numbers TEXT NOT NULL,
        drawn_balls_at_claim TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        claim_time TIMESTAMP NOT NULL DEFAULT NOW(),
        reviewed_by TEXT,
        reviewed_at TIMESTAMP,
        rejection_reason TEXT
      )`,
    },
    {
      name: "bingo_dealer_actions table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_dealer_actions (
        id SERIAL PRIMARY KEY,
        round_id INTEGER,
        staff_user_id INTEGER,
        action_type TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        timestamp TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "bingo_payouts table",
      sql: `CREATE TABLE IF NOT EXISTS bingo_payouts (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL,
        claim_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        amount BIGINT NOT NULL,
        paid_by TEXT NOT NULL,
        paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
        transaction_id INTEGER
      )`,
    },
    {
      name: "bingo_settings.rollover_pool column",
      sql: `ALTER TABLE bingo_settings ADD COLUMN IF NOT EXISTS rollover_pool BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "bingo_rounds.rollover_applied column",
      sql: `ALTER TABLE bingo_rounds ADD COLUMN IF NOT EXISTS rollover_applied BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "lottery_settings table",
      sql: `CREATE TABLE IF NOT EXISTS lottery_settings (
        id SERIAL PRIMARY KEY,
        enabled BOOLEAN NOT NULL DEFAULT false,
        ticket_cost BIGINT NOT NULL DEFAULT 5000,
        max_tickets_per_player INTEGER NOT NULL DEFAULT 25,
        house_split_percent INTEGER NOT NULL DEFAULT 20,
        jackpot_split_percent INTEGER NOT NULL DEFAULT 70,
        consolation_split_percent INTEGER NOT NULL DEFAULT 10,
        starting_jackpot BIGINT NOT NULL DEFAULT 500000,
        number_min INTEGER NOT NULL DEFAULT 1,
        number_max INTEGER NOT NULL DEFAULT 20,
        numbers_per_ticket INTEGER NOT NULL DEFAULT 4,
        allow_duplicates BOOLEAN NOT NULL DEFAULT false,
        order_matters BOOLEAN NOT NULL DEFAULT false,
        draw_hour INTEGER NOT NULL DEFAULT 21,
        draw_minute INTEGER NOT NULL DEFAULT 0,
        ticket_close_minutes INTEGER NOT NULL DEFAULT 5,
        rollover_enabled BOOLEAN NOT NULL DEFAULT true,
        updated_by TEXT,
        updated_at TIMESTAMP
      )`,
    },
    {
      name: "lottery_settings seed row",
      sql: `INSERT INTO lottery_settings (enabled) SELECT false WHERE NOT EXISTS (SELECT 1 FROM lottery_settings)`,
    },
    {
      name: "lottery_draws table",
      sql: `CREATE TABLE IF NOT EXISTS lottery_draws (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'open',
        ticket_close_at TIMESTAMP NOT NULL,
        draw_time TIMESTAMP NOT NULL,
        winning_numbers TEXT,
        jackpot_carried_in BIGINT NOT NULL DEFAULT 0,
        jackpot_added_this_draw BIGINT NOT NULL DEFAULT 0,
        final_jackpot BIGINT NOT NULL DEFAULT 0,
        consolation_carried_in BIGINT NOT NULL DEFAULT 0,
        consolation_added_this_draw BIGINT NOT NULL DEFAULT 0,
        final_consolation BIGINT NOT NULL DEFAULT 0,
        total_tickets_purchased INTEGER NOT NULL DEFAULT 0,
        total_submitted INTEGER NOT NULL DEFAULT 0,
        total_draft INTEGER NOT NULL DEFAULT 0,
        total_chips_collected BIGINT NOT NULL DEFAULT 0,
        house_profit BIGINT NOT NULL DEFAULT 0,
        jackpot_rolled_over BOOLEAN,
        consolation_rolled_into_jackpot BOOLEAN,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMP
      )`,
    },
    {
      name: "lottery_tickets table",
      sql: `CREATE TABLE IF NOT EXISTS lottery_tickets (
        id SERIAL PRIMARY KEY,
        draw_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        player_username TEXT NOT NULL DEFAULT '',
        numbers TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        ticket_cost BIGINT NOT NULL DEFAULT 5000,
        purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMP,
        matched_count INTEGER,
        result_tier TEXT,
        payout_amount BIGINT NOT NULL DEFAULT 0,
        paid_at TIMESTAMP
      )`,
    },
    {
      name: "lottery_payouts table",
      sql: `CREATE TABLE IF NOT EXISTS lottery_payouts (
        id SERIAL PRIMARY KEY,
        draw_id INTEGER NOT NULL,
        ticket_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        player_username TEXT NOT NULL DEFAULT '',
        tier TEXT NOT NULL,
        tier_prize_pool BIGINT NOT NULL DEFAULT 0,
        winning_ticket_count INTEGER NOT NULL DEFAULT 1,
        payout_per_ticket BIGINT NOT NULL DEFAULT 0,
        payout_amount BIGINT NOT NULL DEFAULT 0,
        paid_at TIMESTAMP NOT NULL DEFAULT NOW(),
        transaction_id INTEGER
      )`,
    },
    {
      name: "lottery_logs table",
      sql: `CREATE TABLE IF NOT EXISTS lottery_logs (
        id SERIAL PRIMARY KEY,
        draw_id INTEGER,
        action_type TEXT NOT NULL,
        actor_role TEXT,
        actor_id INTEGER,
        player_id INTEGER,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "lottery_settings.jackpot_rollover column",
      sql: `ALTER TABLE lottery_settings ADD COLUMN IF NOT EXISTS jackpot_rollover BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "lottery_settings.consolation_rollover column",
      sql: `ALTER TABLE lottery_settings ADD COLUMN IF NOT EXISTS consolation_rollover BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "lottery_tickets.numbers column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS numbers TEXT NOT NULL DEFAULT '[]'`,
    },
    {
      name: "lottery_tickets.status column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`,
    },
    {
      name: "lottery_tickets.submitted_at column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP`,
    },
    {
      name: "lottery_tickets.matched_count column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS matched_count INTEGER`,
    },
    {
      name: "lottery_tickets.result_tier column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS result_tier TEXT`,
    },
    {
      name: "lottery_tickets.payout_amount column",
      sql: `ALTER TABLE lottery_tickets ADD COLUMN IF NOT EXISTS payout_amount BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "players.exclude_from_login_logs column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS exclude_from_login_logs BOOLEAN NOT NULL DEFAULT false`,
    },
    {
      name: "tournaments bigint chip columns",
      sql: `
        ALTER TABLE tournaments
          ALTER COLUMN buy_in          TYPE BIGINT,
          ALTER COLUMN starting_chips  TYPE BIGINT,
          ALTER COLUMN prize_pool      TYPE BIGINT,
          ALTER COLUMN base_prize_pool TYPE BIGINT,
          ALTER COLUMN min_bet         TYPE BIGINT,
          ALTER COLUMN max_bet         TYPE BIGINT
      `,
    },
    {
      name: "players.wins column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "players.total_won column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS total_won BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "players.biggest_win column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS biggest_win BIGINT NOT NULL DEFAULT 0`,
    },
    {
      name: "backfill players.biggest_win from transactions",
      sql: `
        UPDATE players p
        SET biggest_win = (
          SELECT COALESCE(MAX(t.amount), 0)
          FROM transactions t
          WHERE t.player_id = p.id
            AND t.type IN ('win','tournament_win','fortuna-win','rome-slots-win','western-slots-win')
        )
        WHERE p.is_bot IS NOT TRUE
      `,
    },
    {
      name: "sport_bet_events.sport column",
      sql: `ALTER TABLE sport_bet_events ADD COLUMN IF NOT EXISTS sport TEXT`,
    },
    {
      name: "settings seed: sbAutoDeleteEnabled",
      sql: `INSERT INTO settings (key, value) VALUES ('sbAutoDeleteEnabled', 'true') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "settings seed: sbAutoDeleteRetentionMinutes",
      sql: `INSERT INTO settings (key, value) VALUES ('sbAutoDeleteRetentionMinutes', '30') ON CONFLICT (key) DO NOTHING`,
    },
    {
      name: "challenge_claims table",
      sql: `CREATE TABLE IF NOT EXISTS challenge_claims (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        challenge_id TEXT NOT NULL,
        challenge_name TEXT NOT NULL,
        reward_amount INTEGER NOT NULL,
        period_key TEXT NOT NULL DEFAULT 'permanent',
        claimed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "challenge_claims unique index",
      sql: `CREATE UNIQUE INDEX IF NOT EXISTS challenge_claims_unique
        ON challenge_claims (player_id, challenge_id, period_key)`,
    },
    {
      name: "players.reward_points column",
      sql: `ALTER TABLE players ADD COLUMN IF NOT EXISTS reward_points INTEGER NOT NULL DEFAULT 0`,
    },
    {
      name: "backfill player wins and total_won from transactions",
      sql: `
        UPDATE players p
        SET
          wins = (
            SELECT COUNT(*) FROM transactions t
            WHERE t.player_id = p.id
              AND t.type IN ('win','tournament_win','fortuna-win','rome-slots-win','western-slots-win')
          ),
          total_won = (
            (SELECT COALESCE(SUM(amount),0) FROM transactions t
              WHERE t.player_id = p.id
                AND t.type IN ('win','tournament_win','fortuna-win','rome-slots-win','western-slots-win','rakeback'))
            -
            (SELECT COALESCE(SUM(amount),0) FROM transactions t
              WHERE t.player_id = p.id
                AND t.type IN ('loss','fortuna-bet','fortuna-bonus-buy','rome-slots-bet','western-slots-bet','highlow_bet','baccarat','sport_bet'))
          )
        WHERE p.is_bot IS NOT TRUE
          AND EXISTS (SELECT 1 FROM transactions t WHERE t.player_id = p.id)
      `,
    },
    {
      name: "blackjack_games.shoe column",
      sql: `ALTER TABLE blackjack_games ADD COLUMN IF NOT EXISTS shoe JSONB`,
    },
    // ── Sportsbook bet slips (parlay/single tracking) ─────────────────────────
    {
      name: "challenge_state table",
      sql: `CREATE TABLE IF NOT EXISTS challenge_state (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL UNIQUE,
        state_json TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
    {
      name: "sport_bet_slips table",
      sql: `CREATE TABLE IF NOT EXISTS sport_bet_slips (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL,
        player_username TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'single',
        wager_amount INTEGER NOT NULL,
        potential_payout INTEGER NOT NULL DEFAULT 0,
        actual_payout INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        selections TEXT NOT NULL DEFAULT '[]',
        admin_note TEXT,
        settled_at TIMESTAMP,
        settled_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
    },
  ];

  for (const step of steps) {
    try {
      await db.execute(step.sql);
      console.log(`[migrations] OK: ${step.name}`);
    } catch (err: any) {
      console.error(`[migrations] FAILED: ${step.name} —`, err?.message ?? err);
    }
  }
}
