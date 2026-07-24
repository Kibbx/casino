/**
 * payline-overlay.tsx — Polished glowing payline overlay for Rome Slots.
 *
 * Purely additive — never touches game state, layout, symbols, or controls.
 * pointer-events: none throughout.
 */

import { useEffect, useRef } from "react";

// ── Layout constants (mirror rome-slots.tsx exactly) ─────────────────────────
const CW = 1920;
const CH = 1080;
const MX = 100;
const MY = 0;

const REEL_COLS = [
  { left: MX + 223, w: 261 },
  { left: MX + 484, w: 250 },
  { left: MX + 734, w: 250 },
  { left: MX + 984, w: 250 },
  { left: MX + 1234, w: 250 },
];
const REEL_TOP = MY + 217;
const ROW_H    = 216;

// Reel viewport for clip path (keeps glow inside the machine frame)
const CLIP_X = REEL_COLS[0].left;
const CLIP_Y = REEL_TOP;
const CLIP_W = (REEL_COLS[4].left + REEL_COLS[4].w) - CLIP_X;
const CLIP_H = ROW_H * 3;

const PAYLINES: number[][] = [
  [1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2],
  [0,1,2,1,0], [2,1,0,1,2],
  [1,0,0,0,1], [1,2,2,2,1],
  [0,0,1,2,2], [2,2,1,0,0],
  [1,0,1,2,1], [1,2,1,0,1],
  [0,1,1,1,2], [2,1,1,1,0],
  [0,1,2,2,2], [2,1,0,0,0],
  [0,0,1,0,0], [2,2,1,2,2],
  [1,1,0,1,1], [1,1,2,1,1],
  [0,1,0,1,0],
  [0,2,0,2,0], [2,0,2,0,2],
  [1,2,0,2,1], [1,0,2,0,1],
  [2,0,0,2,0],
];

// ── Color palette (warm Roman gold — avoids harsh neon yellow) ────────────────
const COLOR_CORE  = "#FFE782";   // pale warm gold — main line
const COLOR_GLOW  = "#FFC928";   // deeper gold — glow layer stroke
const COLOR_DOT   = "#FFE782";   // dot center fill

// ── Timing (ms) ───────────────────────────────────────────────────────────────
const DRAW_MS      = 220;   // left-to-right draw animation
const HIGHLIGHT_MS = 160;   // traveling highlight sweep after draw
const HOLD_MS      = 280;   // hold / pulse duration per line
const FADE_MS      = 120;   // fade-out before moving to next line
const ALL_OPACITY  = 0.58;  // each line's opacity in the "all lines" phase

// Gap added after each line's full sequence before the next starts
const SEQ_STEP_MS = DRAW_MS + HIGHLIGHT_MS + HOLD_MS + FADE_MS + 30;

// ── Per-instance unique IDs (prevents filter/clip conflicts between mounts) ───
let _instanceCounter = 0;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PaylineWin {
  lineIndex: number;
  count: number;
  symbol: string;
  win: number;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Returns the visual center of a symbol cell in 1920×1080 canvas coordinates. */
export function getSymbolCenter(
  reelIndex: number,
  rowIndex: number,
): { x: number; y: number } {
  const col = REEL_COLS[reelIndex];
  return {
    x: col.left + col.w / 2,
    y: REEL_TOP + rowIndex * ROW_H + ROW_H / 2,
  };
}

/** Symbol centers for each column in a winning payline. */
function paylinePoints(
  lineIndex: number,
  count: number,
): { x: number; y: number }[] {
  const pl = PAYLINES[lineIndex];
  return Array.from({ length: count }, (_, col) => getSymbolCenter(col, pl[col]));
}

/**
 * Clamped Catmull-Rom → cubic Bezier SVG path string.
 * The curve passes exactly through every control point.
 */
function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  if (pts.length === 2) {
    return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
  }
  // Extend with phantom duplicate endpoints for clamped Catmull-Rom
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M ${p[1].x},${p[1].y}`;
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const cp1x = +(p1.x + (p2.x - p0.x) / 20).toFixed(2);
    const cp1y = +(p1.y + (p2.y - p0.y) / 20).toFixed(2);
    const cp2x = +(p2.x - (p3.x - p1.x) / 20).toFixed(2);
    const cp2y = +(p2.y - (p3.y - p1.y) / 20).toFixed(2);
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/** Legacy polyline-points string (kept for API compatibility). */
export function drawWinningPayline(lineIndex: number, count: number): string {
  return paylinePoints(lineIndex, count).map(p => `${p.x},${p.y}`).join(" ");
}

// ── SVG namespace helper ──────────────────────────────────────────────────────
const NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

// ── Easing ────────────────────────────────────────────────────────────────────
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

// ── Generic RAF animator ──────────────────────────────────────────────────────
/**
 * Animates a value from `from` → `to` over `ms` milliseconds.
 * Returns a cancel function.
 */
function animate(
  from: number,
  to: number,
  ms: number,
  ease: (t: number) => number,
  onTick: (v: number) => void,
  onDone?: () => void,
): () => void {
  let rafId: number;
  let startTs: number | null = null;
  let cancelled = false;

  function step(ts: number) {
    if (cancelled) return;
    if (startTs === null) startTs = ts;
    const raw = Math.min((ts - startTs) / ms, 1);
    onTick(from + (to - from) * ease(raw));
    if (raw < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      onTick(to);
      onDone?.();
    }
  }
  rafId = requestAnimationFrame(step);
  return () => { cancelled = true; cancelAnimationFrame(rafId); };
}

// ── Line group builder ────────────────────────────────────────────────────────
/**
 * Creates an SVG <g> containing:
 *   [0] glowPath   — thick, blurred, low-opacity
 *   [1] corePath   — thin, crisp, high-opacity
 *   [2] dotGroup   — small markers at symbol centers
 *   [3] hlPath     — traveling highlight (hidden after sweep)
 */
function buildLineGroup(
  d: string,
  pts: { x: number; y: number }[],
  clipId: string,
  filterId: string,
): SVGGElement {
  const g = svgEl("g");
  g.setAttribute("clip-path", `url(#${clipId})`);
  g.style.opacity = "0";

  // Glow path — thicker, blurred, lower opacity
  const glowPath = svgEl("path");
  glowPath.setAttribute("d",               d);
  glowPath.setAttribute("fill",            "none");
  glowPath.setAttribute("stroke",          COLOR_GLOW);
  glowPath.setAttribute("stroke-width",    "9");
  glowPath.setAttribute("stroke-linecap",  "round");
  glowPath.setAttribute("stroke-linejoin", "round");
  glowPath.setAttribute("opacity",         "0.32");
  glowPath.setAttribute("filter",          `url(#${filterId})`);

  // Core path — thin, crisp warm gold
  const corePath = svgEl("path");
  corePath.setAttribute("d",               d);
  corePath.setAttribute("fill",            "none");
  corePath.setAttribute("stroke",          COLOR_CORE);
  corePath.setAttribute("stroke-width",    "3");
  corePath.setAttribute("stroke-linecap",  "round");
  corePath.setAttribute("stroke-linejoin", "round");
  corePath.setAttribute("opacity",         "0.92");

  // Dot markers — small gold circles at each symbol center
  const dotGroup = svgEl("g");
  dotGroup.style.opacity = "0"; // revealed after draw completes
  pts.forEach(({ x, y }) => {
    const dot = svgEl("circle");
    dot.setAttribute("cx",     String(x));
    dot.setAttribute("cy",     String(y));
    dot.setAttribute("r",      "5");
    dot.setAttribute("fill",   COLOR_DOT);
    dot.setAttribute("filter", `url(#${filterId})`);
    dotGroup.appendChild(dot);
  });

  // Traveling highlight path — white short dash that sweeps once
  const hlPath = svgEl("path");
  hlPath.setAttribute("d",              d);
  hlPath.setAttribute("fill",           "none");
  hlPath.setAttribute("stroke",         "#FFFFFF");
  hlPath.setAttribute("stroke-width",   "3.5");
  hlPath.setAttribute("stroke-linecap", "round");
  hlPath.setAttribute("opacity",        "0");

  g.appendChild(glowPath);  // [0]
  g.appendChild(corePath);  // [1]
  g.appendChild(dotGroup);  // [2]
  g.appendChild(hlPath);    // [3]
  return g;
}

// ── Animation sequences ───────────────────────────────────────────────────────

/** Draw both paths left-to-right, then sweep the highlight, then call onDone. */
function animateDraw(
  g: SVGGElement,
  cancels: (() => void)[],
  reducedMotion: boolean,
  onDone: () => void,
): void {
  g.style.opacity = "1";

  const glowPath = g.children[0] as SVGPathElement;
  const corePath = g.children[1] as SVGPathElement;
  const dotGroup = g.children[2] as SVGGElement;
  const hlPath   = g.children[3] as SVGPathElement;

  if (reducedMotion) {
    [glowPath, corePath].forEach(p => {
      p.removeAttribute("stroke-dasharray");
      p.removeAttribute("stroke-dashoffset");
    });
    dotGroup.style.opacity = "1";
    onDone();
    return;
  }

  const len = corePath.getTotalLength();
  [glowPath, corePath].forEach(p => {
    p.setAttribute("stroke-dasharray",  String(len));
    p.setAttribute("stroke-dashoffset", String(len));
  });

  // Phase 1 — draw left to right
  cancels.push(animate(len, 0, DRAW_MS, easeOutCubic, v => {
    const s = String(v);
    glowPath.setAttribute("stroke-dashoffset", s);
    corePath.setAttribute("stroke-dashoffset", s);
  }, () => {
    // Reveal dot markers
    dotGroup.style.opacity = "1";

    // Phase 2 — traveling highlight sweep
    const hlSegLen = Math.min(160, len * 0.22);
    hlPath.setAttribute("stroke-dasharray",  `${hlSegLen} ${len + hlSegLen}`);
    hlPath.setAttribute("stroke-dashoffset", String(len + hlSegLen));
    hlPath.setAttribute("opacity",           "0.50");

    cancels.push(animate(
      len + hlSegLen,
      -hlSegLen,
      HIGHLIGHT_MS,
      easeOutCubic,
      v => { hlPath.setAttribute("stroke-dashoffset", String(v)); },
      () => {
        hlPath.setAttribute("opacity", "0");
        hlPath.removeAttribute("stroke-dasharray");
        hlPath.removeAttribute("stroke-dashoffset");
        onDone();
      },
    ));
  }));
}

/** Single gentle opacity pulse (one slow dip and return). */
function animatePulse(
  g: SVGGElement,
  cancels: (() => void)[],
  onDone: () => void,
): void {
  const HALF = HOLD_MS / 2;
  cancels.push(animate(1, 0.68, HALF, easeInOutSine, v => {
    g.style.opacity = String(v);
  }, () => {
    cancels.push(animate(0.68, 1, HALF, easeInOutSine, v => {
      g.style.opacity = String(v);
    }, onDone));
  }));
}

/** Fade a group's opacity to 0 over FADE_MS. */
function animateFadeOut(
  g: SVGGElement,
  cancels: (() => void)[],
  onDone: () => void,
): void {
  const from = parseFloat(g.style.opacity) || 1;
  cancels.push(animate(from, 0, FADE_MS, easeOutCubic, v => {
    g.style.opacity = String(v);
  }, onDone));
}

// ── Internal clear helper ─────────────────────────────────────────────────────
function clearOverlayContent(
  svg: SVGSVGElement,
  timers: ReturnType<typeof setTimeout>[],
  cancels: (() => void)[],
): void {
  timers.forEach(clearTimeout);
  cancels.forEach(fn => fn());
  // Remove <g> direct children (line groups); <defs> is left intact
  Array.from(svg.children).forEach(child => {
    if (child.tagName === "g") svg.removeChild(child);
  });
}

// ── Main component ────────────────────────────────────────────────────────────
interface PaylineOverlayProps {
  wins: PaylineWin[];
}

/**
 * PaylineOverlay — polished two-layer SVG overlay for winning paylines.
 * pointer-events: none — never blocks any game control.
 * Clears automatically when wins becomes [].
 */
export function PaylineOverlay({ wins }: PaylineOverlayProps) {
  const svgRef       = useRef<SVGSVGElement>(null);
  const timersRef    = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelsRef   = useRef<(() => void)[]>([]);
  const cancelledRef = useRef(false);

  // Stable unique IDs for this component instance
  const instanceId = useRef(`pl-${++_instanceCounter}`).current;
  const filterId   = `${instanceId}-gf`;
  const clipId     = `${instanceId}-clip`;

  useEffect(() => {
    cancelledRef.current = false;
    const svg = svgRef.current;
    if (!svg) return;

    clearOverlayContent(svg, timersRef.current, cancelsRef.current);
    timersRef.current  = [];
    cancelsRef.current = [];

    if (!wins.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Build one group per winning line (all invisible initially)
    const groups: SVGGElement[] = wins.map(({ lineIndex, count }) => {
      const pts = paylinePoints(lineIndex, count);
      const d   = catmullRomPath(pts);
      const g   = buildLineGroup(d, pts, clipId, filterId);
      svg.appendChild(g);
      return g;
    });

    // Ensure all non-active paths are fully drawn (no dasharray) for the "all" phase
    function resetPathDash(g: SVGGElement) {
      [g.children[0] as SVGPathElement, g.children[1] as SVGPathElement].forEach(p => {
        p.removeAttribute("stroke-dasharray");
        p.removeAttribute("stroke-dashoffset");
      });
      (g.children[2] as SVGGElement).style.opacity = "1";
    }

    // "All lines" phase — show every line at reduced opacity, then loop
    function showAll() {
      if (cancelledRef.current) return;
      groups.forEach((g, j) => {
        const t = setTimeout(() => {
          if (cancelledRef.current) return;
          resetPathDash(g);
          g.style.opacity = String(ALL_OPACITY);
        }, j * 60);
        timersRef.current.push(t);
      });
      // After a brief pause showing all lines, restart the sequence
      const ALL_HOLD_MS = 500;
      const loopT = setTimeout(() => {
        if (cancelledRef.current) return;
        runSequence();
      }, groups.length * 60 + ALL_HOLD_MS);
      timersRef.current.push(loopT);
    }

    // Sequential phase — draw each line one at a time, then loop via showAll
    function runSequence() {
      if (cancelledRef.current) return;
      let cursor = 0;
      wins.forEach(({ lineIndex, count }, i) => {
        const startT = setTimeout(() => {
          if (cancelledRef.current) return;

          // Hide all other lines
          groups.forEach((g, j) => {
            if (j !== i) g.style.opacity = "0";
          });

          animateDraw(groups[i], cancelsRef.current, reducedMotion, () => {
            if (cancelledRef.current) return;

            animatePulse(groups[i], cancelsRef.current, () => {
              if (cancelledRef.current) return;

              if (i === wins.length - 1) {
                // Last line — transition to "all" phase, which loops back
                showAll();
              } else {
                // Fade out; next line is already scheduled via cursor
                animateFadeOut(groups[i], cancelsRef.current, () => { /* cursor handles next */ });
              }
            });
          });
        }, cursor);

        timersRef.current.push(startT);
        cursor += SEQ_STEP_MS;
      });
    }

    runSequence();

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
      cancelsRef.current.forEach(fn => fn());
      timersRef.current  = [];
      cancelsRef.current = [];
    };
  }, [wins, filterId, clipId]);

  return (
    <svg
      ref={svgRef}
      className="payline-overlay"
      style={{
        position:      "absolute",
        inset:         0,
        width:         "100%",
        height:        "100%",
        pointerEvents: "none",
        zIndex:        20,
        overflow:      "visible",
      }}
      viewBox={`0 0 ${CW} ${CH}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Gaussian glow filter — unique per instance, clipped via clipPath */}
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Clip path — constrains glow to the reel window; small padding for anti-alias */}
        <clipPath id={clipId}>
          <rect
            x={CLIP_X - 18}
            y={CLIP_Y - 18}
            width={CLIP_W + 36}
            height={CLIP_H + 36}
          />
        </clipPath>
      </defs>
      {/* Line groups are appended imperatively inside the useEffect */}
    </svg>
  );
}

// ── Exported helpers (API compatibility) ──────────────────────────────────────

/** Remove all overlay line groups and cancel pending timers / RAF frames. */
export function clearPaylineOverlay(
  svg: SVGSVGElement,
  timers: ReturnType<typeof setTimeout>[],
  rafs: number[],
): void {
  timers.forEach(clearTimeout);
  rafs.forEach(cancelAnimationFrame);
  Array.from(svg.children).forEach(child => {
    if (child.tagName === "g") svg.removeChild(child);
  });
}

/** No-op — scaling is handled by the parent CSS transform on the 1920×1080 div. */
export function resizePaylineOverlay(): void { /* no-op */ }

/** No-op — overlay is self-contained; kept for API completeness. */
export function initializePaylineOverlay(): void { /* no-op */ }
