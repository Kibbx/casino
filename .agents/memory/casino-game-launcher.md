---
name: Casino game launcher & password gating
description: How game launching/password-gating is centralized in the casino artifact and the invariants that must hold.
---

# Centralized game launcher

All game launches in `artifacts/casino` go through `src/lib/gameLauncher.tsx`:
`GAMES` registry (one `GameDef` per game) + `useGameLauncher()` hook returning
`{ enter, modalNode }`. Section-page cards, lobby Live Activity, and Recently
Played all call `enter(GAMES.x, hasPassword?)` and render `{modalNode}`. Direct
games (poker, mobtower, sportsbook, tournaments, bingo, lottery) set
`direct: true` and navigate immediately. Only nav/back/login redirects may call
`setLocation` directly — never a game-launch card handler.

## Invariant: `key` vs `apiPath` are separate
A `GameDef` stores `key` (localStorage/guard key — MUST match the game page's
`usePasswordGuard(key)` and the server `/game-password-tokens` map) separately
from `apiPath` (segment of `/api/{apiPath}/verify-password`). They differ for
some games:
- High-Low: `key: "highlow"`, `apiPath: "high-low"`
- Horse: `key: "horseRacing"`, `apiPath: "horse"`
**Why:** mixing them caused the verify endpoint / token lookup to mismatch, so a
correct password never unlocked (or gating was skipped). Always set both fields
explicitly per game.

## Invariant: never treat unknown/unloaded status as "open"
Card `enabled` checks must require a loaded status object:
`const enabled = !!status && status.enabled !== false;` — NOT
`status?.enabled !== false` (which is true while status is still null/loading and
would flash an open/clickable card). In the launcher, when `hasPassword` is
unknown (lobby launch with no live status), it fetches `/api/game-password-tokens`
and on any error defaults `pw = true` (show modal), never assuming open.
**Why:** assuming open on unknown status is a gating bypass / wrong UI state.
