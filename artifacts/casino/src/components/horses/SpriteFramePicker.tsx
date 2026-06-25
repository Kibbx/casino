import { useEffect, useRef, useState } from "react";
import { X, Play, Trash2 } from "lucide-react";
import { HORSE_SPRITES, SPRITE_CATEGORIES, getSpriteConfig } from "../../config/horseSprites";

// Row labels for the 10 side-view rows (rows 0–9)
// Sheet layout: 9 cols × 18 rows at 80×64px per frame
// Rows 0–9 = side-view (used in race), rows 10–17 = front-facing (hidden)
const ROW_LABELS: Record<number, string> = {
  5: "Idle Walk B",  // row 5 — 9 frames (pre-race idle)
  6: "Walk B",       // row 6 — 8 frames (winner showcase)
  9: "Sprint",       // row 9 — 6 frames (race sprint — default)
};
// Only these rows are exposed in the editor
const VISIBLE_ROWS = [5, 6, 9];
const COLS = 9;

// Thumbnail target width for the frame grid (cropped, zoomed in)
const THUMB_W = 62;

interface Props {
  spriteKey:      string | null;
  selectedFrames: number[];        // linear indices: row * 9 + col
  fps:            number;
  onSpriteKey:    (k: string | null) => void;
  onFrames:       (f: number[]) => void;
  onFps:          (f: number) => void;
}

// ── Thumbnail: one frame cropped & zoomed via CSS background ──────────────
// We zoom in on just the horse content (applying the same crop as SpriteRenderer)
// so the horse fills the cell rather than being tiny in a large padding region.
function FrameThumb({
  spriteKey, linearIdx, size = THUMB_W, count = 0, onClick,
}: {
  spriteKey: string;
  linearIdx: number;
  size?: number;
  count?: number;
  onClick?: () => void;
}) {
  const config = getSpriteConfig(spriteKey);
  if (!config) return null;

  const row = Math.floor(linearIdx / COLS);
  const col = linearIdx % COLS;

  // Visible (cropped) source dimensions
  const cropW = config.frameWidth  - config.cropLeft - config.cropRight;   // 74
  const cropH = config.frameHeight - config.cropTop  - config.cropBottom;  // 90

  // Scale so cropW fills the requested `size`
  const scale = size / cropW;
  const h     = Math.round(cropH * scale);

  // Full sheet rendered size (maintain full aspect ratio — 9 cols × 18 rows)
  const TOTAL_ROWS = 18;
  const bgW = Math.round(config.frameWidth  * COLS       * scale);
  const bgH = Math.round(config.frameHeight * TOTAL_ROWS * scale);

  // Position so the cropped region of this frame is at (0,0)
  const posX = Math.round((col * config.frameWidth  + config.cropLeft) * scale);
  const posY = Math.round((row * config.frameHeight + config.cropTop)  * scale);

  return (
    <div
      onClick={onClick}
      title={`Row ${row}, Frame ${col} (index ${linearIdx})`}
      style={{
        width: size, height: h,
        overflow: "hidden",
        position: "relative",
        cursor: onClick ? "pointer" : "default",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Flipped horizontally so the horse faces right */}
      <div
        style={{
          width: size, height: h,
          backgroundImage: `url(${config.path})`,
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `-${posX}px -${posY}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
          transform: "scaleX(-1)",
        }}
      />
      {count > 0 && (
        <span
          style={{
            position: "absolute", top: 1, right: 1,
            background: "#e53935", color: "#fff",
            fontSize: 8, fontWeight: 700, lineHeight: 1,
            padding: "1px 3px", borderRadius: 3,
          }}
        >
          ×{count}
        </span>
      )}
    </div>
  );
}

// ── Animated preview using canvas ─────────────────────────────────────────
function AnimPreview({
  spriteKey, frames, fps,
}: { spriteKey: string; frames: number[]; fps: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const config    = getSpriteConfig(spriteKey);

  useEffect(() => {
    if (!config || frames.length === 0) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const img = new Image();
    const interval = 1000 / Math.max(1, fps);

    img.onload = () => {
      let lastFrame = -1;
      const tick = (t: number) => {
        const fi    = Math.floor(t / interval) % frames.length;
        const linear = frames[fi];
        if (fi !== lastFrame) {
          lastFrame = fi;
          const row = Math.floor(linear / COLS);
          const col = linear % COLS;
          const sx  = col * config.frameWidth  + config.cropLeft;
          const sy  = row * config.frameHeight + config.cropTop;
          const sw  = config.frameWidth  - config.cropLeft - config.cropRight;
          const sh  = config.frameHeight - config.cropTop  - config.cropBottom;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-canvas.width, 0);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };
    img.src = config.path;
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [spriteKey, frames.join(","), fps]);

  if (!config || frames.length === 0) {
    return (
      <div style={{ width: 90, height: 90, background: "#111", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Play className="w-5 h-5 text-zinc-600" />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={90} height={90}
      style={{ imageRendering: "pixelated", width: 90, height: 90, borderRadius: 8, background: "#111" }}
    />
  );
}

// ── Main SpriteFramePicker ────────────────────────────────────────────────
export function SpriteFramePicker({ spriteKey, selectedFrames, fps, onSpriteKey, onFrames, onFps }: Props) {
  // Default to Row 9 Sprint — the primary race animation
  const [activeRow, setActiveRow] = useState<number | null>(9);

  const spritesByCategory = SPRITE_CATEGORIES.map((cat) => ({
    ...cat, sprites: HORSE_SPRITES.filter((s) => s.category === cat.key),
  }));

  // Count occurrences of each frame in selection
  const frameCounts: Record<number, number> = {};
  for (const fi of selectedFrames) {
    frameCounts[fi] = (frameCounts[fi] ?? 0) + 1;
  }

  function addFrame(linearIdx: number) {
    onFrames([...selectedFrames, linearIdx]);
  }

  function removeAt(i: number) {
    const next = [...selectedFrames];
    next.splice(i, 1);
    onFrames(next);
  }

  // Which rows to show: show all visible or just the active one
  const rowsToShow = activeRow !== null ? [activeRow] : VISIBLE_ROWS;

  return (
    <div className="space-y-3">

      {/* ── Sprite Sheet Selector ─────────────────────────────── */}
      <div>
        <label className="text-xs text-muted-foreground font-medium block mb-1.5">Sprite Sheet</label>
        <div className="space-y-1.5">
          {spritesByCategory.map((cat) => (
            <div key={cat.key}>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">{cat.label}</p>
              <div className="flex gap-1.5 flex-wrap">
                {cat.sprites.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => { onSpriteKey(s.key === spriteKey ? null : s.key); setActiveRow(9); }}
                    title={`${cat.label} ${s.label}`}
                    className={`px-2 py-1 rounded-lg border text-[10px] font-medium transition-all ${
                      spriteKey === s.key
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-zinc-500 text-muted-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Frame Grid (only when a sheet is selected) ──────── */}
      {spriteKey && (
        <>
          <div className="border border-border rounded-xl overflow-hidden">
            {/* Row tab pills — only the three rows used in-game */}
            <div className="flex gap-0.5 p-1.5 bg-muted/20 border-b border-border flex-wrap">
              <button
                onClick={() => setActiveRow(null)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                  activeRow === null ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All
              </button>
              {VISIBLE_ROWS.map((r) => (
                <button
                  key={r}
                  onClick={() => setActiveRow(activeRow === r ? null : r)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors ${
                    activeRow === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  R{r} {ROW_LABELS[r]}
                </button>
              ))}
            </div>

            {/* Frame grid */}
            <div className="p-2 space-y-2 max-h-[340px] overflow-y-auto">
              {rowsToShow.map((row) => (
                <div key={row}>
                  <p className="text-[9px] text-zinc-600 mb-1 font-medium">
                    Row {row} — {ROW_LABELS[row]}
                  </p>
                  <div className="flex gap-1 flex-wrap">
                    {Array.from({ length: COLS }, (_, col) => {
                      const linearIdx = row * COLS + col;
                      const count = frameCounts[linearIdx] ?? 0;
                      return (
                        <div
                          key={col}
                          onClick={() => addFrame(linearIdx)}
                          className={`relative rounded border-2 cursor-pointer transition-all hover:scale-110 overflow-hidden ${
                            count > 0
                              ? "border-primary ring-1 ring-primary/30"
                              : "border-zinc-700 hover:border-zinc-400"
                          }`}
                          style={{ background: "#0a0a0a" }}
                        >
                          <FrameThumb
                            spriteKey={spriteKey}
                            linearIdx={linearIdx}
                            size={THUMB_W}
                            count={count}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Selected Frame Sequence ──────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-muted-foreground font-medium">
                Animation Sequence ({selectedFrames.length} frames)
              </label>
              {selectedFrames.length > 0 && (
                <button
                  onClick={() => onFrames([])}
                  className="text-[10px] text-zinc-600 hover:text-red-400 flex items-center gap-0.5 transition-colors"
                >
                  <Trash2 className="w-3 h-3" /> Clear
                </button>
              )}
            </div>

            {selectedFrames.length === 0 ? (
              <div className="border border-dashed border-zinc-700 rounded-xl p-4 text-center text-xs text-zinc-600">
                Click frames above to build your animation
              </div>
            ) : (
              <div className="border border-border rounded-xl p-2 overflow-x-auto">
                <div className="flex gap-1.5 min-w-max">
                  {selectedFrames.map((linearIdx, i) => (
                    <div key={i} className="relative group" style={{ flexShrink: 0 }}>
                      <div
                        className="rounded border border-zinc-700 overflow-hidden"
                        style={{ background: "#0a0a0a" }}
                      >
                        <FrameThumb
                          spriteKey={spriteKey}
                          linearIdx={linearIdx}
                          size={52}
                        />
                      </div>
                      <button
                        onClick={() => removeAt(i)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-2.5 h-2.5 text-white" />
                      </button>
                      <span className="block text-center text-[8px] text-zinc-600 mt-0.5">
                        {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── FPS + Preview ─────────────────────────────────── */}
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <label className="text-xs text-muted-foreground font-medium">Frame Rate</label>
                <span className="text-xs font-bold font-mono text-primary">{fps} fps</span>
              </div>
              <input
                type="range" min={4} max={24} step={1} value={fps}
                onChange={(e) => onFps(parseInt(e.target.value))}
                className="w-full h-1.5 appearance-none cursor-pointer accent-primary"
              />
              <div className="flex justify-between text-[9px] text-zinc-700 mt-0.5">
                <span>4 slow</span><span>12 normal</span><span>24 fast</span>
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[9px] text-zinc-600">Preview</p>
              <AnimPreview spriteKey={spriteKey} frames={selectedFrames} fps={fps} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
