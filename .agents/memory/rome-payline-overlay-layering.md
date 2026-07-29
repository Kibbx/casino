---
name: Rome payline overlay layering
description: Durable layering and lifecycle rule for Fortuna/Rome winning-payline presentation.
---

Rome’s winning-payline presentation uses separate visual layers: dimming below symbol-animation canvases, with traced paylines and payout labels above them. The active-line callback must stop the prior Rome symbol animation before starting the current line’s winning cells, and cleanup must restore static symbols on every new spin.

**Why:** A single overlay layer either darkens the active symbols or lets dimming sit above the animation, making the winning line unreadable.

**How to apply:** Preserve the existing Rome asset paths, geometry, and sound engine while maintaining this z-order and callback lifecycle when changing payline presentation.