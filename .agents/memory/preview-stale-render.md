---
name: Preview/screenshot stale-render trap
description: The app-preview screenshot tool can render stale JS modules; how to verify the real served output instead of chasing a phantom bug.
---

# Preview/screenshot tool can render stale JS while CSS looks fresh

The `screenshot` (app_preview) tool drives a long-lived browser tab. Its first
navigation in a session is a full document load; subsequent screenshots are SPA
soft-navigations on that same tab. Vite then patches that tab via HMR:

- **CSS HMR always applies** (Vite swaps the `<style>` tag), so CSS-driven changes
  (e.g. a sidebar drawer toggled by a media query) DO show up.
- **React Fast Refresh can silently fail** for a component module and keep the OLD
  component rendering. That stale component emits the old DOM/inline styles, so new
  CSS classes never attach — the layout looks unchanged even though the file is correct.

This produces a maddening symptom: a grid keeps rendering the old column count
(e.g. an old `auto-fit` inline grid) even though the source now uses a CSS class.

**Things that did NOT flush the stale tab:** workflow restart (x2), a cache-bust
query param on the path, and editing `index.html` to trigger a Vite full-reload.

**Why:** the tool's persistent tab does not reliably perform a hard reload, so a
failed Fast Refresh for one module sticks across restarts.

**How to verify the REAL output instead of trusting the screenshot:** curl the
module straight from the Vite dev port and from the public proxy, and compare.

- Find the casino dev port from the workflow logs (the `Local: http://localhost:PORT/` line)
  or `tr '\0' '\n' < /proc/<vitePID>/environ | grep ^PORT=`.
- JS module (transpiled): `curl -s http://localhost:PORT/src/pages/shared.tsx` — grep
  for the class name / `auto-fit` to see what's actually served.
- Raw CSS: `curl -s "http://localhost:PORT/src/index.css?direct"` (the `?direct`
  query returns real CSS; without it Vite returns a JS wrapper).
- Public proxy equivalent: `curl -s "https://$REPLIT_DEV_DOMAIN/src/index.css?direct"`.
- Vite serves all of these with `Cache-Control: no-store`, so curl always gets the
  truth. If disk + direct-Vite + proxy all agree and are correct, the code is correct
  and the screenshot is just a stale tab.

**Bottom line:** real browsers and FiveM's CEF do fresh full loads every session, so
they get the correct output. Don't rewrite working code to chase a screenshot-only
phantom — verify via curl first. If a clean screenshot is truly needed, ask the user
to hard-refresh their preview.
