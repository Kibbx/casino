---
name: FiveM CEF render constraints
description: CSS properties and Tailwind patterns that break inside FiveM's CEF browser
---

FiveM embeds Chromium Embedded Framework (CEF) which has older/limited CSS support.

**Banned (cause invisible or broken elements):**
- `backdropFilter` / `WebkitBackdropFilter` — silently no-ops; must be removed, not replaced
- Tailwind opacity modifiers (`bg-black/40`, `text-white/50`, etc.) — use solid overrides instead
- Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) — CEF has a fixed viewport width, no breakpoints

**OK / works fine:**
- `filter: blur(...)` on a regular div (not backdrop)
- Inline styles for all colours and layout
- CSS custom properties / CSS variables
- CSS animations (`@keyframes`, `animation:`)
- `box-shadow` with glow values

**Why:** The FiveM CEF build is pinned to a Chromium version that predates full backdrop-filter support. Opacity modifier syntax also fails because Tailwind v4's generated classes use `oklch()` with alpha channels that CEF doesn't parse.

**How to apply:** Whenever writing or reviewing any component that renders inside the casino frontend, scan for `backdropFilter`, Tailwind `*/XX` opacity utilities, and responsive prefixes before committing.
