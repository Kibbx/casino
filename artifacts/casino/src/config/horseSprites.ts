export interface SpriteAnimRow {
  label: "idle" | "gallop" | "winner";
  row: number;
  frameCount: number;
  fps: number;
}

export interface HorseSpriteConfig {
  key: string;
  label: string;
  path: string;
  category: "fullcolor" | "paint" | "socks";
  color: "black" | "brown" | "white" | "beige" | "grey";
  frameWidth: number;
  frameHeight: number;
  totalColumns: number;
  // Source crop — trim empty padding so the horse fills the canvas
  cropLeft: number;
  cropRight: number;
  cropTop: number;
  cropBottom: number;
  animations: SpriteAnimRow[];
}

// ── Sprite sheet layout (all 9 sheets identical) ──────────────────────────
// Size: 720 × 1152 px  |  9 cols × 18 rows  |  frame: 80 × 64 px
//
// SIDE-VIEW rows (y = 0–639):
//   Row 0  — idle walk     9 frames
//   Row 1  — walk          8 frames
//   Row 2  — trot          9 frames
//   Row 3  — canter        8 frames
//   Row 4  — gallop        6 frames
//   Row 5  — idle walk B   9 frames  ← PRE-RACE idle  (indices 45–53, all filled)
//   Row 6  — walk B        8 frames  ← WINNER showcase (indices 54–61, col 8 blank)
//   Row 7  — trot B        9 frames
//   Row 8  — canter B      8 frames
//   Row 9  — sprint        6 frames  ← RACE animation  (indices 81–86, cols 6-8 blank)
//
// FRONT-FACING rows (y = 640–1151):
//   Rows 10–17 — facing camera (unused in race)
//
// Crop: each 80px-wide frame has ~6px of empty padding on each side,
// and the top ~15px is empty sky above the horse.
// Frames are flipped horizontally in SpriteRenderer → horses run RIGHT.
// ─────────────────────────────────────────────────────────────────────────

const FRAME_W   = 80;
const FRAME_H   = 64;
const COLS      = 9;
const CROP_L    = 6;    // px to trim from left of each source frame
const CROP_R    = 6;    // px to trim from right
const CROP_T    = 15;   // px to trim from top (empty sky)
const CROP_B    = 0;    // keep bottom (hooves reach the edge)

const defaultAnims: SpriteAnimRow[] = [
  { label: "idle",   row: 5, frameCount: 9, fps: 7  },  // Row 5: idle walk B — all 9 frames
  { label: "gallop", row: 9, frameCount: 6, fps: 16 },  // Row 9: sprint — 6 frames (skip 3 blank)
  { label: "winner", row: 6, frameCount: 8, fps: 8  },  // Row 6: walk B — 8 frames (skip 1 blank)
];

function sheet(
  key: string,
  label: string,
  filename: string,
  category: HorseSpriteConfig["category"],
  color: HorseSpriteConfig["color"],
): HorseSpriteConfig {
  return {
    key,
    label,
    path: `/assets/horses/sprites/${filename}`,
    category,
    color,
    frameWidth: FRAME_W,
    frameHeight: FRAME_H,
    totalColumns: COLS,
    cropLeft: CROP_L,
    cropRight: CROP_R,
    cropTop: CROP_T,
    cropBottom: CROP_B,
    animations: defaultAnims,
  };
}

export const HORSE_SPRITES: HorseSpriteConfig[] = [
  sheet("fullcolor_black",  "Black",  "Horse_fullcolor_black.png",  "fullcolor", "black"),
  sheet("fullcolor_brown",  "Brown",  "Horse_fullcolor_brown.png",  "fullcolor", "brown"),
  sheet("fullcolor_white",  "White",  "Horse_fullcolor_White.png",  "fullcolor", "white"),
  sheet("paint_beige",      "Beige",  "Horse_paint_beige.png",      "paint",     "beige"),
  sheet("paint_black",      "Black",  "Horse_paint_black.png",      "paint",     "black"),
  sheet("paint_brown",      "Brown",  "Horse_paint_brown.png",      "paint",     "brown"),
  sheet("socks_beige",      "Beige",  "Horse_socks_beige.png",      "socks",     "beige"),
  sheet("socks_black",      "Black",  "Horse_socks_black.png",      "socks",     "black"),
  sheet("socks_brown",      "Brown",  "Horse_socks_brown.png",      "socks",     "brown"),
];

export const SPRITE_CATEGORIES = [
  { key: "fullcolor" as const, label: "Full Color" },
  { key: "paint"     as const, label: "Paint"      },
  { key: "socks"     as const, label: "Socks"      },
];

export function getSpriteConfig(key: string | null | undefined): HorseSpriteConfig | undefined {
  if (!key) return undefined;
  return HORSE_SPRITES.find((s) => s.key === key);
}

/**
 * Given a spriteKey and a target canvas height, returns the canvas width that
 * preserves the sprite's crop aspect ratio. Falls back to `height` (square)
 * when the sprite is unknown (e.g. CSS fallback horse).
 */
export function spriteCanvasWidth(key: string | null | undefined, height: number): number {
  const config = getSpriteConfig(key);
  if (!config) return height;
  const srcW = config.frameWidth  - config.cropLeft - config.cropRight;
  const srcH = config.frameHeight - config.cropTop  - config.cropBottom;
  return Math.round(height * (srcW / srcH));
}
