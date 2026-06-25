import { useEffect, useRef, useState } from "react";
import { getSpriteConfig } from "../../config/horseSprites";
import { HorseSprite } from "./HorseSprite";

const COLS = 9;

interface Props {
  spriteKey?: string | null;
  customFrames?: number[];
  customFps?: number;
  animation?: "idle" | "gallop" | "winner";
  size?: number;
  number?: number;
  ownerColor?: string;
  tackColor?: string | null;
  fallbackBase?: string;
  fallbackPattern?: string;
  fallbackFlair?: string;
}

export function SpriteRenderer({
  spriteKey,
  customFrames,
  customFps,
  animation = "gallop",
  size = 80,
  number = 1,
  ownerColor,
  tackColor,
  fallbackBase = "brown",
  fallbackPattern = "none",
  fallbackFlair = "none",
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rafRef       = useRef<number>(0);
  const imgRef       = useRef<HTMLImageElement | null>(null);
  const tackColorRef = useRef<string | null | undefined>(ownerColor || tackColor || null);
  const [loaded, setLoaded] = useState(false);
  const [error,  setError]  = useState(false);

  // Keep the ref current so the animation loop always reads the latest color
  // without needing to restart the loop on every color change.
  tackColorRef.current = ownerColor || tackColor || null;

  const config = getSpriteConfig(spriteKey);

  const srcW = config ? config.frameWidth  - config.cropLeft - config.cropRight  : 90;
  const srcH = config ? config.frameHeight - config.cropTop  - config.cropBottom : 90;

  const canvasH = size;
  const canvasW = config ? Math.round(size * (srcW / srcH)) : size;

  const frames: number[] | null =
    animation === "gallop" && customFrames && customFrames.length > 0
      ? customFrames
      : null;

  const configAnim = config
    ? (config.animations.find((a) => a.label === animation) ?? config.animations[config.animations.length - 1])
    : null;

  const builtinFrames: number[] | null = configAnim
    ? Array.from({ length: configAnim.frameCount }, (_, i) => configAnim.row * COLS + i)
    : null;

  const activeFrames = frames ?? builtinFrames;
  const activeFps = (animation === "gallop" ? customFps : undefined) ?? configAnim?.fps ?? 12;
  const framesKey = activeFrames?.join(",") ?? "";

  // ── Load image once per sprite key ────────────────────────────────────────
  useEffect(() => {
    if (!config) { setLoaded(false); setError(false); return; }

    if (imgRef.current && imgRef.current.src.endsWith(config.path) && imgRef.current.complete) {
      setLoaded(true);
      return;
    }

    setLoaded(false);
    setError(false);

    const img = new Image();
    img.onload  = () => { imgRef.current = img; setLoaded(true); };
    img.onerror = () => { setError(true); };
    img.src = config.path;
  }, [config?.key]);

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!config || !loaded || !activeFrames || activeFrames.length === 0) return;

    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const interval = 1000 / Math.max(1, activeFps);
    let lastSeqIdx  = -1;
    let lastTack    = ""; // track tack color to force redraw when it changes

    const tick = (time: number) => {
      const seqIdx    = Math.floor(time / interval) % activeFrames.length;
      const currentTack = tackColorRef.current ?? "";

      if (seqIdx !== lastSeqIdx || currentTack !== lastTack) {
        lastSeqIdx = seqIdx;
        lastTack   = currentTack;

        const linearIdx = activeFrames[seqIdx];
        const row = Math.floor(linearIdx / COLS);
        const col = linearIdx % COLS;
        const sx  = col * config.frameWidth  + config.cropLeft;
        const sy  = row * config.frameHeight + config.cropTop;

        // 1. Draw the sprite frame
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvasW, 0);
        ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, canvasW, canvasH);
        ctx.restore();

        // 2. Overlay tack color ON TOP of sprite pixels only (source-atop paints
        //    only where the destination already has non-transparent pixels).
        if (currentTack) {
          ctx.save();
          ctx.globalCompositeOperation = "source-atop";
          ctx.globalAlpha = 0.42;
          ctx.fillStyle = currentTack;
          ctx.fillRect(0, 0, canvasW, canvasH);
          ctx.restore();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [loaded, framesKey, activeFps, canvasW, canvasH]);

  const activeTackColor = ownerColor || tackColor || undefined;

  if (!config || error) {
    return (
      <HorseSprite
        base={fallbackBase}
        pattern={fallbackPattern}
        flair={fallbackFlair}
        number={number}
        size={size}
        ownerColor={activeTackColor}
      />
    );
  }

  return (
    <div style={{ width: canvasW, height: canvasH, position: "relative" }}>
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        style={{
          imageRendering: "pixelated",
          width: canvasW,
          height: canvasH,
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.15s",
        }}
      />
    </div>
  );
}
