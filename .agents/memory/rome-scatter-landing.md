---
name: Rome Scatter landing timing
description: The timing contract for Scatter sprite animation and impact audio during Rome reel settlement.
---

Rome Scatter presentation must begin from the individual reel-stop callback, not after the complete reel sequence. Sync the settled column into the visible-symbol refs first, then start the Scatter sprite animation for that reel and play one impact cue for the reel if it contains one or more Scatters. A reel containing a landed Scatter remains bright as a whole.

**Why:** Western's landing feel depends on the Scatter animating at the moment its reel lands; waiting for the final grid makes Rome feel late and disconnected from the reel motion. The chosen presentation keeps the landed Scatter clearly visible even if neighboring cells remain bright.

**How to apply:** Preserve the per-reel latch when changing reel animation, tease orchestration, or symbol-canvas behavior. Multiple Scatters in one reel still produce one impact cue.