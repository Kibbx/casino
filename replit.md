# Big House Casino — FiveM Casino

## ⚠️ MANDATORY RULE — NO EXCEPTIONS
**After EVERY code change, immediately push to GitHub:**
```
git -C /home/runner/workspace push https://rhatttv:$GITHUB_PERSONAL_ACCESS_TOKEN@github.com/rhatttv/backalleybets.git HEAD:master
```
Do NOT wait to be asked. Do NOT say you will do it later. Push immediately after the work is done. The VPS pulls from GitHub — if it's not pushed, nothing on the live site changes.

---

## VPS Deploy Process (LOCKED IN)

**VPS:** 144.217.80.69 — App dir: `/opt/backalleybets`

### From Replit → push code to GitHub:
```
git add -A && git commit -m "your message" && git push https://rhatttv:TOKEN@github.com/rhatttv/backalleybets.git HEAD:master
```

### On VPS → pull and restart (no build needed, dist is in the repo):
```
cd /opt/backalleybets && git pull && pm2 restart all
```

### First-time VPS token setup (if git pull asks for credentials):
```
git remote set-url origin https://rhatttv:YOUR_NEW_TOKEN@github.com/rhatttv/backalleybets.git
```
Token: GitHub → Settings → Developer settings → Personal access tokens (classic) → `repo` scope, no expiration.

### After any code change in Replit:
1. Run `pnpm --filter @workspace/casino run build` and/or `pnpm --filter @workspace/api-server run build`
2. `git add -A && git commit -m "..." && git push ...`
3. On VPS: `cd /opt/backalleybets && git pull && pm2 restart all`

---

## Overview

A web-based underground casino for FiveM GTA roleplay servers. Dark brick / mob aesthetic. Uses in-game currency (chips) managed by the banker. No real money involved.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **State**: Zustand (persisted)
- **Animations**: Framer Motion
- **Real-time**: Polling every 2 seconds
- **Turn timer**: 30s regular time + timebank (15s default, max 90s, +5s per 10 hands)

## Games
Blackjack, Roulette, Baccarat, Poker, Slots (3 variants), Horse Racing, Crash, Mines, Keno, High-Low, **Mob Tower** (8-floor door-pick, 1.46×–24.86×), Cases, Sports Betting

## Features

### Banker
- PIN-protected dashboard (default PIN: `1234`)
- Create/delete player accounts
- Set/adjust chip balances (maps to in-game cash)
- Create/manage poker tables (blinds, buy-in limits, optional invite-only password)
- **Change/remove poker table passwords** via 🔑 button in the Tables tab
- Lock/unlock individual tournament tables (prevents new player joins, used to force consolidation)
- Create/manage multi-table poker tournaments with isolated tournament chips (auto-splits 60+ players across tables of 8, auto-consolidates short tables)
- Configure rake settings (poker rake %, cap)
- **Game room passwords**: set/change/remove room passwords for Blackjack, Slots, and Roulette from the Games tab
- Casino stats: total rake, hands played, chips in circulation
- **Staff dual roles**: each staff account can have a primary + secondary role (e.g. dealer+banker), unlocking tabs for both roles
- **Staff State IDs**: each banker account stores an in-game State ID (set via the Staff Accounts tab); auto-fills lender info on loan contracts
- **Loan contracts**: fully auto-filled (lender name/SID from session, borrower SID from player record) — no manual input needed

### Player
- Select account by username (no password — banker manages accounts)
- View chip balance
- Browse lobby with available tables (🔒 indicator for password-protected tables)
- Join table with buy-in (enter password if table is private)
- Play Texas Hold'em poker (up to 8 players)
- Leave table (chips return to account)
- In tournaments: free table switching — move to any unlocked tournament table between hands

### Poker Engine (Texas Hold'em)
- Full hand evaluation (Royal Flush through High Card)
- Dealer button rotation
- Small/big blinds
- All-in support with side pots
- Phase progression: Pre-flop → Flop → Turn → River → Showdown
- Rake auto-deducted from winning pot
- Winner announcement with hand description

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   │   └── src/
│   │       ├── lib/poker-engine.ts   # Texas Hold'em game logic
│   │       └── routes/
│   │           ├── players.ts   # Player CRUD + chip adjustments
│   │           ├── tables.ts    # Poker table management + game actions
│   │           └── banker.ts    # Banker auth + rake settings + stats
│   └── casino/             # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── home.tsx        # Landing page
│           │   ├── lobby.tsx       # Player selection + table list
│           │   ├── table.tsx       # Active poker table
│           │   ├── banker-login.tsx
│           │   └── banker.tsx      # Banker dashboard (4 tabs)
│           ├── components/
│           │   └── poker.tsx       # PokerTableVisual + PlayingCard
│           └── store/index.ts      # Zustand store (playerId, bankerToken)
├── lib/
│   ├── api-spec/openapi.yaml   # Full casino API spec
│   ├── api-client-react/       # Generated React Query hooks
│   ├── api-zod/                # Generated Zod schemas
│   └── db/src/schema/
│       ├── players.ts
│       ├── transactions.ts
│       ├── tables.ts
│       └── settings.ts
```

## Default Settings

- Banker PIN: `1234`
- Default poker rake: 5% (capped at 500 chips)
- Max players per table: 8

## Horse Racing & Ownership System

### Overview
- Horses are created manually via the admin Horse Creator (seeds disabled)
- Horses can be assigned an owner (player) via the admin "Owner" button
- Payout split (CASE A — winning bets exist): 5% house + 10% owner + 85% to bettors
- Payout split (CASE B — no winning bets): 50% owner + 50% house
- Unowned horses: 95% to bettors, 5% house (no owner cut)

### Key API routes
- `GET /api/horse/status` — race state, horses (with ownerId, ownerName), positions, enabled/minBet/maxBet/hasPassword
- `POST /api/horse/bet` — place a bet (requirePlayer)
- `GET /api/horse/stables` — list all horses with stats + history + ownerId/ownerName
- `POST /api/horse/admin/action` — schedule/open-betting/start/finish/cancel/reset (requireBanker)
- `POST /api/horse/admin/assign-owner` — assign/remove horse owner (requireBanker)
- `POST /api/horse/admin/horses` — create horse (requireBanker)
- `PATCH /api/horse/admin/horses/:id` — edit horse (requireBanker)

### Live odds
`horseBetStats()` computes per-horse live odds using the correct `payoutFactor` (0.85 owned / 0.95 unowned), so odds shown to bettors reflect the actual owner cut.

### Owner UX features
- **Lobby card**: orange glow border + "⭐ Your horse is racing!" text + "🏇 Racing" badge when player's horse is in a live race
- **Stables tab**: orange alert banner + "Watch Race →" button when player's horse is racing
- **Stables card**: ⭐ MY HORSE badge + purple border glow on owned cards; 🏇 RACING badge + orange border when in an active race; tack color chip in cosmetics section
- **My Horses filter**: toggle in stables to show only owned horses (with count badge)
- **Race betting cards**: ⭐ MY HORSE badge + purple glow on owned horse cards; owner name shown below horse name with crown/house icon
- **Bet slip panel**: shows owner name + "10% owner cut" note when betting on owned horse
- **Race results**: winner spotlight and results table both show owner name
- **Race track admin**: winner display in admin control panel

## VPS Deploy

**Live site**: backalleybets.com — VPS 144.217.80.69  
**App directory**: `/opt/backalleybets` (PM2 exec cwd — NOT `~/backalleybets`)

Deploy command:
```bash
cd /opt/backalleybets && git pull https://rhatttv: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@github.com/rhatttv/backalleybets.git master && pnpm install && pnpm --filter @workspace/casino run build && pnpm --filter @workspace/api-server run build && pm2 restart all
```

> The `~/backalleybets` folder also exists on the VPS but is NOT the live directory. Always deploy to `/opt/backalleybets`.

## VPS Migration Notes

When deploying to VPS, run these migrations in order:
```sql
ALTER TABLE banker_accounts ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'banker';
ALTER TABLE banker_accounts ADD COLUMN IF NOT EXISTS role2 TEXT;
CREATE TABLE IF NOT EXISTS house_finances (...);
```

## API Routes

All routes at `/api/...`

- `GET /api/players` — list all players
- `POST /api/players` — create player (banker)
- `POST /api/players/:id/chips` — adjust chips (banker)
- `GET /api/tables` — list tables
- `POST /api/tables` — create table (banker)
- `POST /api/tables/:id/join` — join with buy-in
- `PATCH /api/tables/:id/password` — set/clear table password (dealer+)
- `POST /api/tables/:id/start` — start game
- `POST /api/tables/:id/action` — fold/check/call/raise
- `POST /api/tables/:id/leave` — leave table
- `GET /api/blackjack/status` — includes `hasPassword` field
- `POST /api/blackjack/verify-password` — verify room password
- `GET /api/slots/status` — includes `hasPassword` field
- `POST /api/slots/verify-password` — verify room password
- `GET /api/roulette/status` — includes `hasPassword` field
- `POST /api/roulette/verify-password` — verify room password
- `POST /api/banker/login` — returns `role` + `role2` fields
- `GET /api/banker/accounts` — returns `role2` field
- `POST /api/banker/accounts` — accepts `role2` field
- `PATCH /api/banker/accounts/:id` — accepts `role2` field
- `GET /api/banker/rake-settings` — rake config + `tournamentsEnabled` toggle
- `GET /api/banker/game-passwords` — get hasPassword status for BJ/Slots/Roulette
- `PATCH /api/banker/game-passwords/:game` — set/clear game room password (dealer+)
- `GET /api/banker/stats` — casino stats
- `GET /api/settings` — public settings (no auth): `{ tournamentsEnabled }`
- `POST /api/tables/:id/ready` — toggle ready-up for tournament tables (75% threshold)
- `GET/POST /api/tournaments` — list / create tournaments (`basePrizePool`, `buyInPrizePercent`)
- `POST /api/tournaments/:id/register` — buy in (only `buyInPrizePercent`% goes to prize pool)
- `DELETE /api/tournaments/:id/register` — withdraw + refund (prize pool capped at `basePrizePool`)
- `POST /api/tournaments/:id/start` — seat all players, split across tables of ≤8
- `POST /api/tournaments/:id/consolidate` — merge short tables
- `POST /api/tournaments/:id/finish` — close out, pay winner

## TypeScript Status

- **API server**: Zero TypeScript errors (as of 2026-03-18). Fixed by rebuilding `lib/db` type declarations, adding explicit `: void` return types to all Express middleware, adding `return` before all final `res.json()` calls in route handlers, and casting `req.params.X as string` throughout.
- **Casino frontend**: 16 pre-existing TanStack Query v5 type errors in generated API hooks (missing `queryKey` in options objects). Runtime-safe — Vite does not typecheck at dev time.
- **`lib/db` dist**: Must be rebuilt via `npx tsc --build lib/db/tsconfig.json --force` if schema files change and tsc project references are in use.

## Extending for Future Games

The rake settings API already stores:
- `blackjackHouseEdge` — house edge % for blackjack
- `slotsRtp` — return-to-player % for slots
- `rouletteType` — european/american
- `tournamentsEnabled` — show/hide tournaments tab in player lobby

Add new game routes in `artifacts/api-server/src/routes/` and new pages in `artifacts/casino/src/pages/`.
