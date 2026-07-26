/**
 * BellagioChipsAnimation
 *
 * Gold casino chips burst upward in Bellagio-fountain arcs, arc outward with
 * spin, then rain back down naturally before a long graceful fade-out.
 *
 * Canvas is pointer-events:none — never blocks any UI interaction.
 * Pure canvas 2D; no CSS filter/blur. RAF-driven. FiveM CEF-safe.
 */
import { useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chip {
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotSp: number;
  r: number;       // radius px
  depth: number;   // 0 = far back, 1 = front — drives draw order + alpha
  born: number;    // performance.now() ms when this chip becomes active
}

interface Sparkle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  r: number;
}

interface AnimState {
  chips: Chip[];
  sparkles: Sparkle[];
  startTime: number;
  lastBurst: number;
  burstCount: number;
  rafId: number | null;
}

// ── Timing constants ──────────────────────────────────────────────────────────

const GRAVITY      = 0.14;   // px/frame² — gentle arc so chips fly high
const BURST_EVERY  = 1600;   // ms between full fountain waves
const BURST_WAVES  = 5;      // how many waves to fire
const DRIZZLE_FROM = BURST_EVERY * BURST_WAVES;   // ms — switch to soft drizzle
const DRIZZLE_TO   = DRIZZLE_FROM + 3500;         // ms — drizzle ends
const FADE_START   = DRIZZLE_TO - 500;            // ms — begin global fade
const FADE_END     = FADE_START + 2200;           // ms — fully gone

// 7 jets: outer-arc wings feed a tall centre peak (mirrors Bellagio silhouette)
const JETS = [
  { xf: 0.10, vx: -5.0, vy: -12.0, spread: 1.8 },
  { xf: 0.23, vx: -2.8, vy: -17.0, spread: 1.3 },
  { xf: 0.37, vx: -1.2, vy: -21.0, spread: 1.0 },
  { xf: 0.50, vx:  0.0, vy: -25.5, spread: 0.7 }, // centre — tallest
  { xf: 0.63, vx:  1.2, vy: -21.0, spread: 1.0 },
  { xf: 0.77, vx:  2.8, vy: -17.0, spread: 1.3 },
  { xf: 0.90, vx:  5.0, vy: -12.0, spread: 1.8 },
];

// ── Coin drawing ──────────────────────────────────────────────────────────────

function drawChip(ctx: CanvasRenderingContext2D, chip: Chip, alpha: number) {
  const { x, y, rotation, r } = chip;
  if (alpha <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = Math.min(1, alpha);

  // 3-D tumble illusion: squish Y proportional to cosine of rotation angle
  const squish = 0.16 + Math.abs(Math.cos(rotation * 2)) * 0.84;
  ctx.scale(1, squish);

  // Amber glow halo
  ctx.shadowColor = "rgba(245,158,11,0.80)";
  ctx.shadowBlur  = r * 1.5;

  // Dark outer rim
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  const rimG = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r);
  rimG.addColorStop(0, "#92400e");
  rimG.addColorStop(1, "#3c1100");
  ctx.fillStyle = rimG;
  ctx.fill();

  // Main gold face
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.87, 0, Math.PI * 2);
  const coinG = ctx.createRadialGradient(-r * 0.22, -r * 0.22, 0, 0, 0, r * 0.87);
  coinG.addColorStop(0,    "#fde68a");
  coinG.addColorStop(0.32, "#fcd34d");
  coinG.addColorStop(0.70, "#f59e0b");
  coinG.addColorStop(1,    "#b45309");
  ctx.fillStyle = coinG;
  ctx.fill();

  // Edge notch dots (10 evenly spaced)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76, r * 0.065, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(100,38,4,0.55)";
    ctx.fill();
  }

  // Specular highlight
  ctx.beginPath();
  ctx.arc(-r * 0.26, -r * 0.26, r * 0.30, 0, Math.PI * 2);
  const hlG = ctx.createRadialGradient(-r * 0.26, -r * 0.26, 0, -r * 0.26, -r * 0.26, r * 0.30);
  hlG.addColorStop(0, "rgba(255,255,255,0.52)");
  hlG.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hlG;
  ctx.fill();

  ctx.restore();
}

function drawSparkle(ctx: CanvasRenderingContext2D, sp: Sparkle, alpha: number) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "#fcd34d";
  ctx.shadowBlur  = sp.r * 4;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
  ctx.fillStyle = alpha > 0.55 ? "#fde68a" : "#f59e0b";
  ctx.fill();
  ctx.restore();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  active: boolean;
  total: number;  // win amount — animation only runs when > 0
}

export function BellagioChipsAnimation({ active, total }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef  = useRef<AnimState>({
    chips: [], sparkles: [], startTime: 0, lastBurst: -99999, burstCount: 0, rafId: null,
  });

  useEffect(() => {
    const s = stateRef.current;
    if (s.rafId !== null) { cancelAnimationFrame(s.rafId); s.rafId = null; }

    if (!active || total <= 0) {
      s.chips = []; s.sparkles = [];
      const cv = canvasRef.current;
      if (cv) cv.getContext("2d")?.clearRect(0, 0, cv.width, cv.height);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    s.chips = []; s.sparkles = [];
    s.startTime  = performance.now();
    s.lastBurst  = -99999;
    s.burstCount = 0;

    // ── Full wave: all 7 jets fire together, chips staggered within each jet ─
    function burst(now: number) {
      const W = canvas!.width;
      const H = canvas!.height;
      JETS.forEach(jet => {
        const count = 3 + Math.floor(Math.random() * 5); // 3–7 per jet
        for (let i = 0; i < count; i++) {
          const depth = 0.30 + Math.random() * 0.70;
          s.chips.push({
            x:        W * jet.xf + (Math.random() - 0.5) * 28,
            y:        H + 6,
            vx:       jet.vx + (Math.random() - 0.5) * jet.spread * 2.2,
            vy:       jet.vy * (0.88 + Math.random() * 0.24),
            rotation: Math.random() * Math.PI * 2,
            rotSp:    (Math.random() - 0.5) * 0.20,
            r:        8 + depth * 13,   // 8–21 px
            depth,
            born: now + i * 70,         // stagger within jet
          });
        }
      });
    }

    // ── Gentle drizzle: a few chips per jet at softer velocity ───────────────
    function drizzleChip(now: number) {
      const W = canvas!.width;
      const H = canvas!.height;
      // pick 2 random jets
      const picked = [...JETS].sort(() => Math.random() - 0.5).slice(0, 2);
      picked.forEach(jet => {
        const depth = 0.25 + Math.random() * 0.55;
        s.chips.push({
          x:        W * jet.xf + (Math.random() - 0.5) * 40,
          y:        H + 4,
          vx:       jet.vx * 0.55 + (Math.random() - 0.5) * 1.5,
          vy:       jet.vy * 0.55 * (0.85 + Math.random() * 0.30),
          rotation: Math.random() * Math.PI * 2,
          rotSp:    (Math.random() - 0.5) * 0.14,
          r:        6 + depth * 9,
          depth,
          born: now,
        });
      });
    }

    let lastDrizzle = -99999;

    // ── Main loop ─────────────────────────────────────────────────────────────
    function loop(now: number) {
      const elapsed = now - s.startTime;
      const W = canvas!.width;
      const H = canvas!.height;

      // Global envelope
      let globalAlpha = 1;
      if (elapsed >= FADE_START) {
        globalAlpha = Math.max(0, 1 - (elapsed - FADE_START) / (FADE_END - FADE_START));
      }
      if (elapsed >= FADE_END) {
        ctx!.clearRect(0, 0, W, H);
        s.rafId = null;
        return;
      }

      // Launch waves
      if (s.burstCount < BURST_WAVES && now - s.lastBurst > BURST_EVERY) {
        burst(now);
        s.lastBurst = now;
        s.burstCount++;
      }

      // Drizzle phase: a chip or two every ~220 ms
      if (elapsed >= DRIZZLE_FROM && elapsed < DRIZZLE_TO && now - lastDrizzle > 220) {
        drizzleChip(now);
        lastDrizzle = now;
      }

      ctx!.clearRect(0, 0, W, H);

      // Painter's algorithm: far chips first
      s.chips.sort((a, b) => a.depth - b.depth);

      s.chips = s.chips.filter(chip => {
        if (now < chip.born) return true;  // not yet active

        chip.vy       += GRAVITY;
        chip.x        += chip.vx;
        chip.y        += chip.vy;
        chip.rotation += chip.rotSp;

        // Remove only when off the bottom — chips that arc up and rain back down
        // stay alive the whole journey
        if (chip.y > H + chip.r * 3) return false;

        // Shed sparkles while ascending
        if (chip.vy < -5 && Math.random() < 0.10) {
          s.sparkles.push({
            x: chip.x + (Math.random() - 0.5) * chip.r,
            y: chip.y + (Math.random() - 0.5) * chip.r,
            vx: (Math.random() - 0.5) * 2.0,
            vy: (Math.random() - 0.5) * 2.0 - 0.6,
            life: 320 + Math.random() * 380,
            maxLife: 700,
            r: 1.5 + Math.random() * 2.8,
          });
        }

        // Fade in over first 120 ms of life, no lifetime-based fade-out —
        // chips stay opaque until global fade takes over
        const age     = now - chip.born;
        const fadeIn  = Math.min(1, age / 120);
        const depthA  = 0.50 + chip.depth * 0.50;
        const alpha   = fadeIn * depthA * globalAlpha;

        drawChip(ctx!, chip, alpha);
        return true;
      });

      s.sparkles = s.sparkles.filter(sp => {
        sp.life -= 16;
        if (sp.life <= 0) return false;
        sp.x  += sp.vx;
        sp.y  += sp.vy;
        sp.vy += 0.06;
        drawSparkle(ctx!, sp, (sp.life / sp.maxLife) * globalAlpha);
        return true;
      });

      s.rafId = requestAnimationFrame(loop);
    }

    s.rafId = requestAnimationFrame(loop);

    return () => {
      if (s.rafId !== null) { cancelAnimationFrame(s.rafId); s.rafId = null; }
      window.removeEventListener("resize", resize);
    };
  }, [active, total]);

  if (!active || total <= 0) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position:      "fixed",
        inset:         0,
        zIndex:        9999,
        pointerEvents: "none",
        width:         "100%",
        height:        "100%",
      }}
    />
  );
}
