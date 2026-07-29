---
name: Rome payline presentation
description: Final interaction rule for Fortuna/Rome winning-payline animation.
---

Rome’s payline overlay presents one winning payline at a time. Each pass starts at the leftmost winning reel and reveals the line and icon highlights toward the right. Starting a new payline clears the previous line’s active symbol highlights, then triggers the new line’s sound once.

**Why:** The desired presentation matches the reference image: the current payline is the focus, rather than accumulating or showing all winning paylines simultaneously.

**How to apply:** Keep the visual loop if needed, but reset the active line state at every payline start and preserve the left-to-right callback timing.