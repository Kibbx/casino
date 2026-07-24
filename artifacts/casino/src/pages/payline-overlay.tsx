/**
 * payline-overlay.tsx — Glowing animated payline overlay for Rome Slots.
 *
 * IMPORTANT: This module is purely additive. It reads layout constants from
 * the same values used in rome-slots.tsx (duplicated here so this file stays
 * self-contained). It never mutates game state, never intercepts pointer
 * events, and has no side effects beyond rendering an SVG over the reel area.
 */

import { useEffect, useRef } from "react";

// ── Layout constants — must stay in sync with rome-slots.tsx ─────────────────
const CW   = 1920;
const CH   = 1080;
const MX   = 100;  // M.x
const MY   = 0;    // M.y

const REEL_COLS = [
  { left: MX + 223, w: 261 },
  { left: MX + 484, w: 250 },
  { left: MX + 734, w: 250 },
  { left: MX + 984, w: 250 },
  { left: MX + 1234, w: 250 },
];
const REEL_TOP = MY + 217;
const ROW_H    = 216;

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

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PaylineWin {
  lineIndex: number;
  count: number;
  symbol: string;
  win: number;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Returns the visual center of a symbol cell in canvas-space coordinates. */
export function getSymbolCenter(reelIndex: number, rowIndex: number): { x: number; y: number } {
  const col = REEL_COLS[reelIndex];
  return {
    x: col.left + col.w / 2,
    y: REEL_TOP + rowIndex * ROW_H + ROW_H / 2,
  };
}

/** Returns space-separated "x,y" pairs for an SVG polyline. */
export function drawWinningPayline(lineIndex: number, count: number): string {
  const payline = PAYLINES[lineIndex];
  const pts: string[] = [];
  for (let col = 0; col < count; col++) {
    const { x, y } = getSymbolCenter(col, payline[col]);
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

/** Computes the total arc length of a winning payline (used for dasharray). */
function paylineLength(lineIndex: number, count: number): number {
  const payline = PAYLINES[lineIndex];
  let len = 0;
  for (let col = 1; col < count; col++) {
    const a = getSymbolCenter(col - 1, payline[col - 1]);
    const b = getSymbolCenter(col, payline[col]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

// ── SVG glow filter (rendered once as static markup) ─────────────────────────
const FILTER_ID = "pl-glow";

function GlowDefs() {
  return (
    <defs>
      <filter id={FILTER_ID} x="-30%" y="-30%" width="160%" height="160%">
        {/* Outer glow: wide soft blur */}
        <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur-outer" />
        {/* Inner core: tighter blur for brighter centre */}
        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur-inner" />
        <feMerge>
          <feMergeNode in="blur-outer" />
          <feMergeNode in="blur-inner" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

// ── Timing constants ──────────────────────────────────────────────────────────
const DRAW_MS  = 420;   // time to animate a single line left-to-right
const HOLD_MS  = 600;   // how long to hold a single line before moving to next
const ALL_FADE = 80;    // stagger (ms) between lines appearing in the "all" phase

// ── Main component ────────────────────────────────────────────────────────────

interface PaylineOverlayProps {
  wins: PaylineWin[];
}

/**
 * PaylineOverlay — transparent SVG that draws glowing animated lines over the
 * winning paylines after each spin. `pointer-events: none` so it never blocks
 * any game controls. Clears automatically when `wins` becomes empty.
 */
export function PaylineOverlay({ wins }: PaylineOverlayProps) {
  const svgRef      = useRef<SVGSVGElement>(null);
  const timersRef   = useRef<ReturnType<typeof setTimeout>[]>([]);
  const rafsRef     = useRef<number[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const svg = svgRef.current;
    if (!svg) return;

    // Wipe any lines from a previous run
    clearPaylineOverlay(svg, timersRef.current, rafsRef.current);
    timersRef.current = [];
    rafsRef.current   = [];

    if (!wins.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Build one <polyline> per winning line (all hidden initially)
    const polylines: SVGPolylineElement[] = wins.map(({ lineIndex, count }) => {
      const pl = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      pl.setAttribute("points",           drawWinningPayline(lineIndex, count));
      pl.setAttribute("fill",             "none");
      pl.setAttribute("stroke",           "#FFD700");
      pl.setAttribute("stroke-width",     "5");
      pl.setAttribute("stroke-linecap",   "round");
      pl.setAttribute("stroke-linejoin",  "round");
      pl.setAttribute("filter",           `url(#${FILTER_ID})`);
      pl.style.opacity = "0";
      svg.appendChild(pl);
      return pl;
    });

    // Animate a single polyline from left → right, then call onDone
    function animateSingleLine(
      pl: SVGPolylineElement,
      lineIndex: number,
      count: number,
      onDone: () => void,
    ) {
      pl.style.opacity = "1";

      if (reducedMotion) {
        // Skip animation — show full line immediately
        pl.removeAttribute("stroke-dasharray");
        pl.removeAttribute("stroke-dashoffset");
        onDone();
        return;
      }

      const len = paylineLength(lineIndex, count);
      pl.setAttribute("stroke-dasharray",  String(len));
      pl.setAttribute("stroke-dashoffset", String(len));

      let startTs: number | null = null;
      function step(ts: number) {
        if (cancelledRef.current) return;
        if (startTs === null) startTs = ts;
        const progress = Math.min((ts - startTs) / DRAW_MS, 1);
        pl.setAttribute("stroke-dashoffset", String(len * (1 - progress)));
        if (progress < 1) {
          const id = requestAnimationFrame(step);
          rafsRef.current.push(id);
        } else {
          pl.setAttribute("stroke-dashoffset", "0");
          onDone();
        }
      }
      const id = requestAnimationFrame(step);
      rafsRef.current.push(id);
    }

    // Sequential phase: show each line one at a time
    let cursor = 0;
    wins.forEach(({ lineIndex, count }, i) => {
      const t = setTimeout(() => {
        if (cancelledRef.current) return;
        // Hide every line except the current one
        polylines.forEach((el, j) => { el.style.opacity = j === i ? "1" : "0"; });
        // Remove dasharray from all non-current lines so "all" phase looks clean
        polylines.forEach((el, j) => {
          if (j !== i) {
            el.removeAttribute("stroke-dasharray");
            el.removeAttribute("stroke-dashoffset");
          }
        });

        animateSingleLine(polylines[i], lineIndex, count, () => {
          // After drawing, hold this line briefly before moving on
          const holdT = setTimeout(() => {
            if (cancelledRef.current) return;
            // Last line → trigger "show all" phase
            if (i === wins.length - 1) showAll();
          }, HOLD_MS);
          timersRef.current.push(holdT);
        });
      }, cursor);

      timersRef.current.push(t);
      cursor += DRAW_MS + HOLD_MS + 60; // gap before next line starts
    });

    // "All" phase: fade every line in with a small stagger, keep them visible
    function showAll() {
      if (cancelledRef.current) return;
      polylines.forEach((pl, j) => {
        const t = setTimeout(() => {
          if (cancelledRef.current) return;
          pl.removeAttribute("stroke-dasharray");
          pl.removeAttribute("stroke-dashoffset");
          pl.style.opacity = "1";
        }, j * ALL_FADE);
        timersRef.current.push(t);
      });
    }

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
      rafsRef.current.forEach(cancelAnimationFrame);
      timersRef.current = [];
      rafsRef.current   = [];
    };
  }, [wins]);

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
      <GlowDefs />
      {/* polylines are appended imperatively inside the useEffect */}
    </svg>
  );
}

// ── Helpers (also exported for testing) ──────────────────────────────────────

/** Removes all <polyline> children from the SVG and cancels pending timers/RAFs. */
export function clearPaylineOverlay(
  svg: SVGSVGElement,
  timers: ReturnType<typeof setTimeout>[],
  rafs: number[],
) {
  timers.forEach(clearTimeout);
  rafs.forEach(cancelAnimationFrame);
  // Remove polylines (leave <defs> in place)
  const polylines = svg.querySelectorAll("polyline");
  polylines.forEach(pl => pl.parentNode?.removeChild(pl));
}

/** Resize helper — re-computing coordinates is not needed since the SVG uses
 *  viewBox="0 0 1920 1080" and the parent div handles all scaling via CSS
 *  transform. This is a no-op stub kept for API completeness. */
export function resizePaylineOverlay() {
  // no-op: scaling is handled by the parent CSS transform
}

/** Initializer stub — the overlay is self-contained; call this if you need
 *  to pre-warm the layout constants (currently nothing to warm up). */
export function initializePaylineOverlay() {
  // no-op
}
