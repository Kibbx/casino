---
name: Western bonus-end overlay ordering
description: The final free-spin summary must take ownership of the render layer after the last win sequence.
---

The bonus-complete scene must wait for the last free spin's payline presentation, clear the win popup and payline overlay, stop symbol animations, and gate the win popup out while the summary is visible.

**Why:** React state updates and the payline overlay's cycling timers can otherwise leave a stale mega/huge popup rendered beneath the Congratulations scene.

**How to apply:** Preserve both the sequencing wait and the `!showBonusEnd` win-popup render guard when changing western-slots win or free-spin flow.