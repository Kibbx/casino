---
name: Casino app-shell source of truth
description: The external Kibbx/Redesign repo is the design source of truth for the casino app shell (top header/navbar AND left sidebar); how to reconcile it with the live app's routing + staff gating + responsiveness.
---

# Casino app shell — external design source of truth

The user treats the public GitHub repo **`Kibbx/Redesign`** (its `artifacts/back-alley-bets/src/App.tsx`) as the canonical visual baseline for the casino **app shell** — both the **top header/navbar** and the **left sidebar**. It is a clean-design sibling export of this same Big House project. The live shell lives in **`artifacts/casino/src/pages/lobby.tsx`** (header `<nav>` then body `<aside>`), styled by **`artifacts/casino/src/index.css`**.

**Key divergences to reconcile every time the user says "sync the header/sidebar to Git":**
- The redesign repo's shell uses a **pure `activeNav` state model** and a **fixed, desktop-only layout** — no wouter routes, no `staffOnly`, no responsive scaffold. The header is a fixed 52px 3-zone layout (left controls, an absolutely-centered 320px search, right pill cards); the sidebar is a fixed-width column.
- The live `casino` app uses **real wouter routing** to dozens of game pages, a **`staffOnly` gate** (`isStaff` from `playerStaffRoles`), **dynamic values** (`chipsDisplay`, `initials`, `displayName`, `handleLogout`), and a **responsive flex-wrap scaffold** (order-* + `hidden md:flex`/`hidden sm:flex`).

**Rule:** Sync only the *visual contract* (pill cards `nav-pill`/`nav-pill-rank`/`nav-pill-gold`/`nav-user-chip`, two-line wallet/chips, gray-star "Silver II" rank with inline bar, 15px brand, bordered standalone logout, sidebar widths/active-bar styling — all CSS classes already exist in `index.css`). **Preserve** routing, the `staffOnly` filter, dynamic data bindings, the logout handler, appMode-driven labels/placeholders, and the responsive scaffold. **Do not** adopt the redesign's pure-activeNav or fixed/absolute desktop-only layout wholesale — it orphans real routes and overflows on mobile.

**Why:** The user repeatedly designates the external repo as "source of truth" and asks to remove deviations, but *also* explicitly requires preserving routing + staff access *and* full responsiveness (1920→mobile, no horizontal scroll). These only reconcile by syncing styling, not navigation mechanics or layout strategy.

**Known faithful-but-questionable details kept on purpose (flag to user, don't silently "fix"):**
- Header search icon color is purple `rgba(180,80,220,0.55)` in the source repo (odd for the orange theme) — matched faithfully.
- Sidebar collapsed-mode tooltips (`left-full`) are clipped by `overflow-x-hidden` — identical in the source; relaxing overflow risks the prohibited horizontal scroll.
- Profile name is `truncate max-w-[140px]` (with `min-w-0` parent) as graceful long-username handling — a justified responsive add-on, since the root is `w-screen overflow-hidden`.
