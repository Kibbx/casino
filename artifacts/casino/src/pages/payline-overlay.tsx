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
const DRAW_MS      = 1220;  // deliberately slow left-to-right draw animation
const HIGHLIGHT_MS = 360;   // slower traveling highlight sweep after draw
const HOLD_MS      = 900;   // longer active-line hold / pulse duration
const FADE_MS      = 260;   // slower fade-out before moving to next line
const ICON_CYCLE_MS = 1200; // Rome's 24 frames at 20 FPS
const FIRST_DRAW_MS = 680;
const FIRST_HIGHLIGHT_MS = 90;
const FIRST_HOLD_MS = 140;
const FIRST_FADE_MS = 100;
const FIRST_PASS_GAP_MS = 20;

// Gap added after each line's full sequence before the next starts
const SEQ_STEP_MS = DRAW_MS + HIGHLIGHT_MS + HOLD_MS + FADE_MS + 30;
const FIRST_SEQ_STEP_MS =
  FIRST_DRAW_MS + FIRST_HIGHLIGHT_MS + FIRST_HOLD_MS + FIRST_FADE_MS + FIRST_PASS_GAP_MS;

// ── Per-instance unique IDs (prevents filter/clip conflicts between mounts) ───
let _instanceCounter = 0;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PaylineWin {
  lineIndex: number;
  count: number;
  symbol: string;
  win: number;
  positions?: Array<{ reel: number; row: number; symbol: string }>;
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

/** Straight point-to-point SVG path string for a sharper tracer. */
function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  return `M ${pts.map(({ x, y }) => `${x},${y}`).join(" L ")}`;
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
const easeLinear = (t: number) => t;

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
  glowPath.setAttribute("stroke-linecap",  "butt");
  glowPath.setAttribute("stroke-linejoin", "miter");
  glowPath.setAttribute("opacity",         "0.32");
  glowPath.setAttribute("filter",          `url(#${filterId})`);

  // Core path — thin, crisp warm gold
  const corePath = svgEl("path");
  corePath.setAttribute("d",               d);
  corePath.setAttribute("fill",            "none");
  corePath.setAttribute("stroke",          COLOR_CORE);
  corePath.setAttribute("stroke-width",    "3");
  corePath.setAttribute("stroke-linecap",  "butt");
  corePath.setAttribute("stroke-linejoin", "miter");
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
  hlPath.setAttribute("stroke-linecap", "butt");
  hlPath.setAttribute("opacity",        "0");

  g.appendChild(glowPath);  // [0]
  g.appendChild(corePath);  // [1]
  g.appendChild(dotGroup);  // [2]
  g.appendChild(hlPath);    // [3]
  return g;
}

function buildLabel(pts: { x: number; y: number }[], win: number): SVGTextElement {
  const point = pts[Math.min(1, pts.length - 1)] ?? pts[0] ?? { x: 0, y: 0 };
  const label = svgEl("text");
  label.setAttribute("x", String(point.x));
  label.setAttribute("y", String(point.y - 24));
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("font-family", "'Oswald','Impact',sans-serif");
  label.setAttribute("font-weight", "700");
  label.setAttribute("font-size", "34");
  label.setAttribute("fill", COLOR_CORE);
  label.setAttribute("stroke", "#3a1800");
  label.setAttribute("stroke-width", "3.5");
  label.setAttribute("paint-order", "stroke fill");
  label.setAttribute("style", "letter-spacing:0.03em;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.85));");
  label.textContent = `${win.toLocaleString()}.00`;
  label.style.opacity = "0";
  return label;
}

// ── Animation sequences ───────────────────────────────────────────────────────

/** Draw both paths left-to-right, then sweep the highlight, then call onDone. */
function animateDraw(
  g: SVGGElement,
  cancels: (() => void)[],
  reducedMotion: boolean,
  drawMs: number,
  highlightMs: number,
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
  cancels.push(animate(len, 0, drawMs, easeOutCubic, v => {
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
      highlightMs,
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
  holdMs: number,
  onDone: () => void,
): void {
  const HALF = holdMs / 2;
  cancels.push(animate(1, 0.68, HALF, easeInOutSine, v => {
    g.style.opacity = String(v);
  }, () => {
    cancels.push(animate(0.68, 1, HALF, easeInOutSine, v => {
      g.style.opacity = String(v);
    }, onDone));
  }));
}

/** Erase the traced line from left to right after the icon animation finishes. */
function animateEraseTrail(
  g: SVGGElement,
  cancels: (() => void)[],
  fadeMs: number,
  onDone: () => void,
): void {
  const glowPath = g.children[0] as SVGPathElement;
  const corePath = g.children[1] as SVGPathElement;
  const length = corePath.getTotalLength();

  [glowPath, corePath].forEach(path => {
    path.setAttribute("stroke-dasharray", String(length));
    path.setAttribute("stroke-dashoffset", "0");
  });

  // A negative dash offset retracts the visible stroke from the final reel
  // back toward the origin, reversing the erase direction from the draw.
  cancels.push(animate(0, -length, fadeMs, easeLinear, value => {
    const offset = String(value);
    glowPath.setAttribute("stroke-dashoffset", offset);
    corePath.setAttribute("stroke-dashoffset", offset);
  }, () => {
    g.style.opacity = "0";
    [glowPath, corePath].forEach(path => {
      path.removeAttribute("stroke-dasharray");
      path.removeAttribute("stroke-dashoffset");
    });
    onDone();
  }));
}

// ── Internal clear helper ─────────────────────────────────────────────────────
function clearOverlayContent(
  svg: SVGSVGElement,
  timers: ReturnType<typeof setTimeout>[],
  cancels: (() => void)[],
): void {
  timers.forEach(clearTimeout);
  cancels.forEach(fn => fn());
  // Remove transient dimming content; <defs> is left intact.
  Array.from(svg.children).forEach(child => {
    if (child.tagName === "g" || child.tagName === "rect") svg.removeChild(child);
  });
}

// ── Main component ────────────────────────────────────────────────────────────
interface PaylineOverlayProps {
  wins: PaylineWin[];
  onLineActive?: (positions: Array<{ reel: number; row: number; symbol: string }>) => void;
  onLineStart?: (lineIndex: number) => void;
  onFirstPassComplete?: () => void;
  hideTotalWin?: boolean;
  westernBonusTiming?: boolean;
}

/**
 * PaylineOverlay — polished two-layer SVG overlay for winning paylines.
 * pointer-events: none — never blocks any game control.
 * Clears automatically when wins becomes [].
 */
export function PaylineOverlay({
  wins,
  onLineActive,
  onLineStart,
  onFirstPassComplete,
  hideTotalWin = false,
  westernBonusTiming = false,
}: PaylineOverlayProps) {
  const svgRef       = useRef<SVGSVGElement>(null);
  const lineSvgRef   = useRef<SVGSVGElement>(null);
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
    const lineSvg = lineSvgRef.current;
    if (!svg || !lineSvg) return;

    clearOverlayContent(svg, timersRef.current, cancelsRef.current);
    while (lineSvg.firstChild) lineSvg.removeChild(lineSvg.firstChild);
    timersRef.current  = [];
    cancelsRef.current = [];

    if (!wins.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Build one group per winning line (all invisible initially)
    const groups: SVGGElement[] = wins.map(({ lineIndex, count }) => {
      const pts = paylinePoints(lineIndex, count);
      const d   = catmullRomPath(pts);
      const g   = buildLineGroup(d, pts, clipId, filterId);
      lineSvg.appendChild(g);
      return g;
    });

    const labels = wins.map(({ lineIndex, count, win }) => {
      const label = buildLabel(paylinePoints(lineIndex, count), win);
      lineSvg.appendChild(label);
      return label;
    });

    if (!hideTotalWin) {
      const totalWin = wins.reduce((sum, win) => sum + win.win, 0);
      const totalLabel = svgEl("text");
      totalLabel.setAttribute("x", "960");
      totalLabel.setAttribute("y", "560");
      totalLabel.setAttribute("text-anchor", "middle");
      totalLabel.setAttribute("dominant-baseline", "middle");
      totalLabel.setAttribute("font-family", "Oswald, sans-serif");
      totalLabel.setAttribute("font-weight", "900");
      totalLabel.setAttribute("font-size", "50");
      totalLabel.setAttribute("fill", COLOR_CORE);
      totalLabel.setAttribute("stroke", "#3a1800");
      totalLabel.setAttribute("stroke-width", "8");
      totalLabel.setAttribute("paint-order", "stroke fill");
      totalLabel.setAttribute("style", "letter-spacing:0.06em;filter:drop-shadow(0 6px 18px rgba(0,0,0,0.95));");
      totalLabel.textContent = `${totalWin.toLocaleString()}.00`;
      totalLabel.style.opacity = "0";
      lineSvg.appendChild(totalLabel);

      // Match Western's centered win presentation during normal spins.
      cancelsRef.current.push(animate(0, 1, 220, easeOutCubic, v => {
        totalLabel.style.opacity = String(v);
      }));
      cancelsRef.current.push(animate(50, 130, 1000, easeOutCubic, v => {
        totalLabel.setAttribute("font-size", String(Math.round(v)));
      }, () => {
        cancelsRef.current.push(animate(1, 0, 700, easeInOutSine, v => {
          totalLabel.style.opacity = String(v);
        }));
        cancelsRef.current.push(animate(130, 30, 700, easeInOutSine, v => {
          totalLabel.setAttribute("font-size", String(Math.round(v)));
        }));
      }));
    }

    // Ensure all non-active paths are fully drawn (no dasharray) for the "all" phase
    function resetPathDash(g: SVGGElement) {
      [g.children[0] as SVGPathElement, g.children[1] as SVGPathElement].forEach(p => {
        p.removeAttribute("stroke-dasharray");
        p.removeAttribute("stroke-dashoffset");
      });
      (g.children[2] as SVGGElement).style.opacity = "1";
    }

    // Sequential phase — draw each line, then loop visually until cleanup.
    function runSequence(firstPass = false) {
      if (cancelledRef.current) return;
       const drawMs = westernBonusTiming
         ? 180
         : firstPass ? FIRST_DRAW_MS : DRAW_MS;
       const highlightMs = westernBonusTiming
         ? 70
         : firstPass ? FIRST_HIGHLIGHT_MS : HIGHLIGHT_MS;
       const holdMs = westernBonusTiming
         ? 600
         : firstPass ? FIRST_HOLD_MS : HOLD_MS;
       const fadeMs = westernBonusTiming
         ? 110
         : firstPass ? FIRST_FADE_MS : FADE_MS;
       const sequenceStepMs = westernBonusTiming
         ? 180 + 70 + 600 + 110 + 30
         : firstPass ? FIRST_SEQ_STEP_MS : SEQ_STEP_MS;
      // Each visual pass starts from a clean state. This is important for
      // looping overlays: no path or label may retain the previous pass's
      // completed state, so every payline traces from reel 1 to the right.
      groups.forEach(g => {
        g.style.opacity = "0";
        const glowPath = g.children[0] as SVGPathElement;
        const corePath = g.children[1] as SVGPathElement;
        const dots = g.children[2] as SVGGElement;
        [glowPath, corePath].forEach(path => {
          path.removeAttribute("stroke-dasharray");
          path.removeAttribute("stroke-dashoffset");
        });
        dots.style.opacity = "0";
      });
      labels.forEach(label => { label.style.opacity = "0"; });

      let cursor = 0;
      wins.forEach((_win, i) => {
        const startT = setTimeout(() => {
          if (cancelledRef.current) return;

          // Hide all other lines
          groups.forEach((g, j) => {
            if (j !== i) g.style.opacity = "0";
          });
          labels.forEach((label, j) => { label.style.opacity = j === i ? "1" : "0"; });
          onLineStart?.(wins[i].lineIndex);
           const positions = wins[i].positions ?? [];
           if (westernBonusTiming) {
             // Western starts the complete winning-symbol animation and its
             // per-line cue together, at the exact moment the line begins.
             onLineActive?.(positions);
           } else {
             // Rome's normal presentation reveals the winning cells
             // progressively from left to right.
             positions.forEach((_position, cellIndex) => {
               const cellT = setTimeout(() => {
                 if (!cancelledRef.current) {
                   onLineActive?.(positions.slice(0, cellIndex + 1));
                 }
               }, Math.round((drawMs * cellIndex) / Math.max(positions.length - 1, 1)));
               timersRef.current.push(cellT);
             });
           }

          animateDraw(groups[i], cancelsRef.current, reducedMotion, drawMs, highlightMs, () => {
            if (cancelledRef.current) return;

            animatePulse(groups[i], cancelsRef.current, holdMs, () => {
              if (cancelledRef.current) return;

              labels[i].style.opacity = "0";
              animateEraseTrail(groups[i], cancelsRef.current, fadeMs, () => { /* cursor handles next */ });
            });
          });
        }, cursor);

        timersRef.current.push(startT);
        cursor += sequenceStepMs;
      });
      const loopT = setTimeout(() => {
        if (firstPass) onFirstPassComplete?.();
        if (!cancelledRef.current) runSequence(false);
      }, firstPass ? cursor : cursor + ICON_CYCLE_MS);
      timersRef.current.push(loopT);
    }

    // Let the centered total-win reveal land before the first payline trace.
     const initialT = setTimeout(() => runSequence(true), westernBonusTiming ? 60 : 900);
    timersRef.current.push(initialT);

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
      cancelsRef.current.forEach(fn => fn());
      timersRef.current  = [];
      cancelsRef.current = [];
    };
  }, [wins, filterId, clipId, onLineActive, onFirstPassComplete, hideTotalWin, westernBonusTiming]);

  return (
    <>
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
    </svg>
      <svg
        ref={lineSvgRef}
        className="payline-overlay-lines"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 29,
          overflow: "visible",
        }}
        viewBox={`0 0 ${CW} ${CH}`}
        xmlns="http://www.w3.org/2000/svg"
      />
    </>
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
