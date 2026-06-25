---
name: Casino lobby import pattern
description: How the Big House redesign pages were imported and wired into the casino project
---

The redesign repo (github.com/Kibbx/Redesign, branch master, path artifacts/back-alley-bets/)
was imported into the casino frontend (artifacts/casino/).

**File layout after import:**
- `src/pages/lobby.tsx` — the main post-login shell (adapted from redesign's App.tsx)
  - Named export `Lobby` + `export default Lobby` for App.tsx compatibility
  - Player username from `useStore().playerUsername`
  - Logout: `logoutPlayer()` + `setLocation("/")`
  - All backdropFilter removed (FiveM constraint)
  - Image paths: `${import.meta.env.BASE_URL}images/<file>.png`
- `src/pages/TableGamesPage.tsx`, `MiniGamesPage.tsx`, `PokerPage.tsx`, etc. (PascalCase)
  → These are lobby sub-section catalog pages, NOT the actual game pages
- `src/pages/shared.tsx` — PageWrapper, CatalogCard, CardGrid, SubHeader
- `src/pages/mkt-shared.tsx` — marketplace item types, ITEMS data, MktItemCard
- `src/pages/shopStore.ts` — Zustand store for marketplace stall state
- `public/images/` — bg.png, live-events.png, mini-games.png, table-games.png

**Naming convention:**
- PascalCase (TableGamesPage.tsx) = redesign catalog/lobby sub-pages
- kebab-case (table-games.tsx) = actual casino game pages with real backend wiring
- App.tsx routes use the kebab-case real pages; lobby.tsx uses PascalCase sub-pages internally

**Neon CSS system:**
Appended to `src/index.css` (after line 896):
- `.neon-card` + `.neon-green/red/pink/orange/blue/yellow/teal` — breathing box-shadow animations
- `.section-title` — Orbitron font with title-glow animation
- `.divider-line.dl-left/.dl-right` + `.divider-dot` — travelling energy pulse dividers
- Nav CSS: `.nav-icon-btn`, `.nav-pill`, `.nav-user-chip`, `.mode-switcher`, `.mode-tab`, `.nav-volume-slider`
- `.font-rajdhani`, `.font-orbitron` — utility classes for those fonts

**Why:** App.tsx imports Lobby as a default import (`import Lobby from "@/pages/lobby"`), so lobby.tsx must export default even when also using named export.

## Pages are often ALREADY byte-identical to the redesign — diff before editing
When asked to "recreate/redesign the <X> tab to match Kibbx/Redesign", FIRST diff the casino file against the redesign repo's same-path file (`raw.githubusercontent.com/Kibbx/Redesign/main/artifacts/back-alley-bets/src/...`). These pages were imported wholesale, so the page component, `pages/shared.tsx` (PageWrapper/section-title), and the CSS deps it relies on (`.font-orbitron`, `@keyframes mkt-ticker`, Orbitron @import; `pulse` is Tailwind's default) are frequently already a 0-line diff — meaning no edit is needed, just confirm parity and report. The sportsbook tab (`SportsbookPage.tsx`, 1674 lines, title="SPORTSBOOK" accentColor="#f97316") is one such case.
**Why:** avoids unnecessary cosmetic rewrites of files that already match the source of truth.
