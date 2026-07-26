/**
 * western-payline-overlay.tsx — Payline win animation for Western Slots.
 *
 * Reference style: cyan/turquoise glowing line traced left-to-right, dim
 * overlay behind active payline, inline payout label on the line, no big
 * centered popup.  Purely additive — never touches game state.
 * pointer-events: none throughout.
 *
 * Layer contract (z-index within the parent 1920×1080 canvas div):
 *   z21  — animated winning-symbol canvases (western-slots.tsx, driven by onLineActive)
 *   z25  — dim rect + payline glow lines   (svgRef)  — sits ABOVE icons / sprites
 *   z26  — bigText total + per-line labels  (labelSvgRef)
 */

import { useEffect, useRef } from "react";

// ── Layout constants (mirror western-slots.tsx exactly) ───────────────────────
const CW = 1920;
const CH = 1080;

const REEL_COLS = [
  { left: 423,  w: 215 },
  { left: 638,  w: 215 },
  { left: 853,  w: 215 },
  { left: 1068, w: 215 },
  { left: 1283, w: 215 },
];
const REEL_TOP = 238;
const ROW_H    = 215;

const CLIP_X = REEL_COLS[0].left;
const CLIP_Y = REEL_TOP;
const CLIP_W = (REEL_COLS[4].left + REEL_COLS[4].w) - CLIP_X;
const CLIP_H = ROW_H * 3;

// ── Paylines — must match western-slots.tsx exactly ───────────────────────────
const PAYLINES: number[][] = [
  [1,1,1,1,1], // 0  middle straight
  [0,0,0,0,0], // 1  top straight
  [2,2,2,2,2], // 2  bottom straight
  [0,1,2,1,0], // 3  V
  [2,1,0,1,2], // 4  inverted V
  [0,0,1,2,2], // 5  slope down
  [2,2,1,0,0], // 6  slope up
  [1,0,0,0,1], // 7  middle-top-middle
  [1,2,2,2,1], // 8  middle-bottom-middle
  [0,1,1,1,0], // 9  top-middle-top
  [2,1,1,1,2], // 10 bottom-middle-bottom
  [1,0,1,2,1], // 11 zigzag down
  [1,2,1,0,1], // 12 zigzag up
  [0,1,0,1,0], // 13 top wave
  [2,1,2,1,2], // 14 bottom wave
  [0,1,2,2,1], // 15 drop then rise
  [2,1,0,0,1], // 16 rise then drop
  [1,1,0,1,1], // 17 middle with top bump
  [1,1,2,1,1], // 18 middle with bottom dip
  [1,0,1,1,2], // 19 connected custom
];

// ── Color palette (warm Western gold) ────────────────────────────────────────
const COLOR_CORE  = "#FFE782";
const COLOR_GLOW  = "#FFC928";
const COLOR_DOT   = "#FFE782";
const LBL_FILL    = "#FFE782";  // inline label fill: gold
const LBL_STROKE  = "#3a1800";  // inline label outline: dark brown

// ── Timing (ms) ───────────────────────────────────────────────────────────────
const DRAW_MS      = 300;   // left-to-right trace
const HIGHLIGHT_MS = 100;   // sweep shimmer
const HOLD_MS      = 900;   // hold each payline (≈ 1.2 s within 800–1200 ms spec)
const FADE_MS      = 110;   // opacity fades
const BIG_HOLD_MS  = 200;   // brief settle so big amount has shrunk before label reveals
const GROW_MS      = 1000;  // Stage-1 grow phase
const TAIL_MS      = 700;   // Stage-1 shrink+fade phase
const STEP_PAD_MS  = 30;    // gap between cycles
const DIM_OPACITY  = 0.62;  // how dark the background dims to

// ── Per-instance unique IDs ───────────────────────────────────────────────────
let _instanceCounter = 0;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PaylineWin {
  lineIndex: number;
  count:     number;
  symbol:    string;
  win:       number;
  positions: Array<{ reel: number; row: number; symbol: string }>;
}

// ── Geometry helpers ──────────────────────────────────────────────────────────
function getSymbolCenter(reelIndex: number, rowIndex: number): { x: number; y: number } {
  const col = REEL_COLS[reelIndex];
  return {
    x: col.left + col.w / 2,
    y: REEL_TOP + rowIndex * ROW_H + ROW_H / 2,
  };
}

function paylinePoints(lineIndex: number, count: number): { x: number; y: number }[] {
  const pl = PAYLINES[lineIndex];
  return Array.from({ length: count }, (_, col) => getSymbolCenter(col, pl[col]));
}

function catmullRomPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  if (pts.length === 2) return `M ${pts[0].x},${pts[0].y} L ${pts[1].x},${pts[1].y}`;
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

// ── SVG namespace helper ──────────────────────────────────────────────────────
const NS = "http://www.w3.org/2000/svg";
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(NS, tag);
}

// ── Easing ────────────────────────────────────────────────────────────────────
const easeOutCubic  = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

// ── Generic RAF animator ──────────────────────────────────────────────────────
function animate(
  from: number, to: number, ms: number,
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
    if (raw < 1) { rafId = requestAnimationFrame(step); }
    else { onTick(to); onDone?.(); }
  }
  rafId = requestAnimationFrame(step);
  return () => { cancelled = true; cancelAnimationFrame(rafId); };
}

// ── Line group builder ────────────────────────────────────────────────────────
// Returns a 4-child group: [0]=glowPath [1]=corePath [2]=dotGroup [3]=hlPath
// Labels are managed separately in the label SVG (z26) so they sit above
// the z21 animated-symbol canvases.
function buildLineGroup(
  d: string,
  pts: { x: number; y: number }[],
  clipId: string,
  filterId: string,
): SVGGElement {
  const g = svgEl("g");
  g.setAttribute("clip-path", `url(#${clipId})`);
  g.style.opacity = "0";

  // Glow halo
  const glowPath = svgEl("path");
  glowPath.setAttribute("d",               d);
  glowPath.setAttribute("fill",            "none");
  glowPath.setAttribute("stroke",          COLOR_GLOW);
  glowPath.setAttribute("stroke-width",    "5");
  glowPath.setAttribute("stroke-linecap",  "round");
  glowPath.setAttribute("stroke-linejoin", "round");
  glowPath.setAttribute("opacity",         "0.65");
  glowPath.setAttribute("filter",          `url(#${filterId})`);

  // Core line
  const corePath = svgEl("path");
  corePath.setAttribute("d",               d);
  corePath.setAttribute("fill",            "none");
  corePath.setAttribute("stroke",          COLOR_CORE);
  corePath.setAttribute("stroke-width",    "1.5");
  corePath.setAttribute("stroke-linecap",  "round");
  corePath.setAttribute("stroke-linejoin", "round");
  corePath.setAttribute("opacity",         "0.95");

  // Winning symbol dots
  const dotGroup = svgEl("g");
  dotGroup.style.opacity = "0";
  pts.forEach(({ x, y }) => {
    const dot = svgEl("circle");
    dot.setAttribute("cx",     String(x));
    dot.setAttribute("cy",     String(y));
    dot.setAttribute("r",      "5");
    dot.setAttribute("fill",   COLOR_DOT);
    dot.setAttribute("filter", `url(#${filterId})`);
    dotGroup.appendChild(dot);
  });

  // Sweep shimmer
  const hlPath = svgEl("path");
  hlPath.setAttribute("d",              d);
  hlPath.setAttribute("fill",           "none");
  hlPath.setAttribute("stroke",         "#FFFFFF");
  hlPath.setAttribute("stroke-width",   "2");
  hlPath.setAttribute("stroke-linecap", "round");
  hlPath.setAttribute("opacity",        "0");

  g.appendChild(glowPath);  // [0]
  g.appendChild(corePath);  // [1]
  g.appendChild(dotGroup);  // [2]
  g.appendChild(hlPath);    // [3]
  return g;
}

// ── Label builder — creates a per-line payout text element for the label SVG ──
function buildLabel(pts: { x: number; y: number }[], win: number): SVGTextElement {
  const labelPt = pts.length >= 2 ? pts[1] : pts[0];
  const label   = svgEl("text");
  label.setAttribute("x",                 String(labelPt.x));
  label.setAttribute("y",                 String(labelPt.y - 22));
  label.setAttribute("text-anchor",       "middle");
  label.setAttribute("dominant-baseline", "auto");
  label.setAttribute("font-family",       "'Oswald','Impact',sans-serif");
  label.setAttribute("font-weight",       "700");
  label.setAttribute("font-size",         "38");
  label.setAttribute("fill",              LBL_FILL);
  label.setAttribute("stroke",            LBL_STROKE);
  label.setAttribute("stroke-width",      "3.5");
  label.setAttribute("paint-order",       "stroke fill");
  label.setAttribute("style",             "letter-spacing:0.03em;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.85));");
  label.textContent   = `${win.toLocaleString()}.00`;
  label.style.opacity = "0";
  return label;
}

// ── Animation sequences ───────────────────────────────────────────────────────
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

  cancels.push(animate(len, 0, DRAW_MS, easeOutCubic, v => {
    const s = String(v);
    glowPath.setAttribute("stroke-dashoffset", s);
    corePath.setAttribute("stroke-dashoffset", s);
  }, () => {
    dotGroup.style.opacity = "1";
    const hlSegLen = Math.min(160, len * 0.22);
    hlPath.setAttribute("stroke-dasharray",  `${hlSegLen} ${len + hlSegLen}`);
    hlPath.setAttribute("stroke-dashoffset", String(len + hlSegLen));
    hlPath.setAttribute("opacity",           "0.50");
    cancels.push(animate(
      len + hlSegLen, -hlSegLen, HIGHLIGHT_MS, easeOutCubic,
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

function animateFadeOut(el: SVGElement | SVGGElement, cancels: (() => void)[], ms: number, onDone?: () => void): void {
  const from = parseFloat((el as unknown as { style: CSSStyleDeclaration }).style.opacity) || 1;
  cancels.push(animate(from, 0, ms, easeOutCubic, v => {
    (el as unknown as { style: CSSStyleDeclaration }).style.opacity = String(v);
  }, onDone));
}

// ── Continuous payline + symbol pulse ─────────────────────────────────────────
function startLinePulse(
  g: SVGGElement,
  blurEl: SVGFEGaussianBlurElement | null,
  pushCancel: (cancel: () => void) => void,
  cancelled: () => boolean,
): () => void {
  const glowPath = g.children[0] as SVGPathElement;
  const corePath = g.children[1] as SVGPathElement;
  const dotGroup = g.children[2] as SVGGElement;
  const dots = Array.from(dotGroup.children) as SVGCircleElement[];

  const GLOW_MIN = 0.65, GLOW_MAX = 1.00;
  const W_MIN    = 1.5,  W_MAX    = 3.0;
  const B_MIN    = 6,    B_MAX    = 16;
  const DOP_MIN  = 0.70, DOP_MAX  = 1.00;
  const DR_MIN   = 5,    DR_MAX   = 7;
  const HALF     = 400;

  let stopped = false;
  const stop = () => { stopped = true; };

  const applyLum = (raw: number, invert: boolean) => {
    const lum = invert ? 1 - raw : raw;
    glowPath.setAttribute("opacity", (GLOW_MIN + (GLOW_MAX - GLOW_MIN) * lum).toFixed(2));
    corePath.setAttribute("stroke-width", (W_MIN + (W_MAX - W_MIN) * lum).toFixed(2));
    if (blurEl) blurEl.setAttribute("stdDeviation", (B_MIN + (B_MAX - B_MIN) * lum).toFixed(2));
    dots.forEach(dot => {
      dot.setAttribute("opacity", (DOP_MIN + (DOP_MAX - DOP_MIN) * lum).toFixed(2));
      dot.setAttribute("r",        (DR_MIN  + (DR_MAX  - DR_MIN ) * lum).toFixed(2));
    });
  };

  const tick = () => {
    if (stopped || cancelled()) return;
    pushCancel(animate(0, 1, HALF, easeInOutSine, v => applyLum(v, false), () => {
      if (stopped || cancelled()) return;
      pushCancel(animate(1, 0, HALF, easeInOutSine, v => applyLum(v, true), tick));
    }));
  };

  tick();
  return stop;
}

function clearOverlayContent(
  svg: SVGSVGElement,
  timers: ReturnType<typeof setTimeout>[],
  cancels: (() => void)[],
): void {
  timers.forEach(clearTimeout);
  cancels.forEach(fn => fn());
  Array.from(svg.children).forEach(child => {
    if (child.tagName === "g" || child.tagName === "text" || child.tagName === "rect") {
      svg.removeChild(child);
    }
  });
}

function clearLabelContent(labelSvg: SVGSVGElement): void {
  Array.from(labelSvg.children).forEach(child => {
    if (child.tagName === "text") labelSvg.removeChild(child);
  });
}

// ── Main component ────────────────────────────────────────────────────────────
interface PaylineOverlayProps {
  wins: PaylineWin[];
  /** Called each time the active payline changes. Pass winning positions for
   *  the now-active line so the caller can animate exactly those symbols. */
  onLineActive?: (positions: Array<{ reel: number; row: number; symbol: string }>) => void;
}

export function WesternPaylineOverlay({ wins, onLineActive }: PaylineOverlayProps) {
  const svgRef        = useRef<SVGSVGElement>(null);  // z25 — dim + paylines
  const labelSvgRef   = useRef<SVGSVGElement>(null);  // z26 — bigText + per-line labels
  const timersRef     = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelsRef    = useRef<(() => void)[]>([]);
  const cancelledRef  = useRef(false);

  const instanceId = useRef(`wpl-${++_instanceCounter}`).current;
  const filterId   = `${instanceId}-gf`;
  const clipId     = `${instanceId}-clip`;

  useEffect(() => {
    cancelledRef.current = false;
    const svg      = svgRef.current;
    const labelSvg = labelSvgRef.current;
    if (!svg || !labelSvg) return;

    clearOverlayContent(svg, timersRef.current, cancelsRef.current);
    clearLabelContent(labelSvg);
    timersRef.current  = [];
    cancelsRef.current = [];

    if (!wins.length) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── Dim overlay — full-canvas dark rect, first child of main SVG so it
    //    is painted behind payline groups. Fades in quickly at sequence start.
    const dimRect = svgEl("rect");
    dimRect.setAttribute("x",      "0");
    dimRect.setAttribute("y",      "0");
    dimRect.setAttribute("width",  String(CW));
    dimRect.setAttribute("height", String(CH));
    dimRect.setAttribute("fill",   "rgba(0,0,0,0.72)");
    dimRect.style.opacity = "0";
    svg.appendChild(dimRect);

    cancelsRef.current.push(animate(0, DIM_OPACITY, 80, easeOutCubic, v => {
      dimRect.style.opacity = String(v);
    }));

    // ── Payline groups — appended after dimRect, so order within main SVG is:
    //    dim < payline glow lines. The whole SVG sits at z25 — above z21
    //    winning-symbol canvases so the glow line draws on top of the icons.
    const groups: SVGGElement[] = wins.map(({ lineIndex, count }) => {
      const pts = paylinePoints(lineIndex, count);
      const d   = catmullRomPath(pts);
      const g   = buildLineGroup(d, pts, clipId, filterId);
      svg.appendChild(g);
      return g;
    });

    // ── Per-line labels — in the label SVG (z26) so they render above the
    //    z25 payline-glow SVG.
    const labels: SVGTextElement[] = wins.map(({ lineIndex, count, win }) => {
      const pts = paylinePoints(lineIndex, count);
      const lbl = buildLabel(pts, win);
      labelSvg.appendChild(lbl);
      return lbl;
    });

    const blurEl = svg.querySelector(`#${filterId} feGaussianBlur`) as SVGFEGaussianBlurElement | null;
    const pulseStops: (() => void)[] = new Array(groups.length).fill(null);

    // ── Centered total win — bigText lives in the label SVG (z26).
    const totalWin = wins.reduce((s, w) => s + w.win, 0);
    const bigText = svgEl("text");
    bigText.setAttribute("x",                "960");
    bigText.setAttribute("y",                "560");
    bigText.setAttribute("text-anchor",      "middle");
    bigText.setAttribute("dominant-baseline","middle");
    bigText.setAttribute("font-family",      "Oswald, sans-serif");
    bigText.setAttribute("font-weight",      "900");
    bigText.setAttribute("font-size",        "50");
    bigText.setAttribute("fill",             COLOR_CORE);
    bigText.setAttribute("stroke",           "#3a1800");
    bigText.setAttribute("stroke-width",     "8");
    bigText.setAttribute("paint-order",      "stroke fill");
    bigText.setAttribute("style",            "letter-spacing:0.06em;filter:drop-shadow(0 6px 18px rgba(0,0,0,0.95));");
    bigText.textContent   = totalWin > 0 ? `${totalWin.toLocaleString()}.00` : "";
    bigText.style.opacity = "0";
    labelSvg.appendChild(bigText);

    // ── Stage-1 total cascade (plays once per spin) ──
    if (totalWin > 0) {
      cancelsRef.current.push(animate(0, 1, 220, easeOutCubic, v => {
        bigText.style.opacity = String(v);
      }));
      cancelsRef.current.push(animate(50, 130, GROW_MS, easeOutCubic, v => {
        bigText.setAttribute("font-size", String(Math.round(v)));
      }, () => {
        cancelsRef.current.push(animate(1, 0, TAIL_MS, easeInOutSine, v => {
          bigText.style.opacity = String(v);
        }));
        cancelsRef.current.push(animate(130, 30, TAIL_MS, easeInOutSine, v => {
          bigText.setAttribute("font-size", String(Math.round(v)));
        }));
      }));
    }

    function resetPathDash(g: SVGGElement) {
      [g.children[0] as SVGPathElement, g.children[1] as SVGPathElement].forEach(p => {
        p.removeAttribute("stroke-dasharray");
        p.removeAttribute("stroke-dashoffset");
      });
      (g.children[2] as SVGGElement).style.opacity = "1";
    }

    // Per-line presentation — cycles indefinitely until cleanup (next spin).
    function playLine(i: number) {
      if (cancelledRef.current) return;
      const { win } = wins[i];
      const lbl = labels[i];

      // Hide all other payline groups; hide this line's label until Stage 2.
      groups.forEach((g, j) => { if (j !== i) g.style.opacity = "0"; });
      if (lbl) lbl.style.opacity = "0";

      // ── Notify caller so it can start the symbol animation for this payline.
      //    The caller (western-slots.tsx) stops any previous canvas anims and
      //    starts fresh ones only for wins[i].positions.
      onLineActive?.(wins[i].positions);

      animateDraw(groups[i], cancelsRef.current, reducedMotion, () => {
        if (cancelledRef.current) return;

        pulseStops[i] = startLinePulse(
          groups[i],
          blurEl,
          cancel => { cancelsRef.current.push(cancel); },
          () => cancelledRef.current,
        );

        // Stage 2 — reveal per-line label after the big amount has settled.
        const stage2T = setTimeout(() => {
          if (cancelledRef.current) return;
          if (lbl) {
            cancelsRef.current.push(animate(0, 1, FADE_MS, easeOutCubic, v => {
              lbl.style.opacity = String(v);
            }));
          }
          const holdT = setTimeout(() => {
            if (cancelledRef.current) return;
            if (lbl) lbl.style.opacity = "0";
            if (pulseStops[i]) pulseStops[i]();
            groups[i].style.opacity = "0";
            const advanceT = setTimeout(() => {
              if (cancelledRef.current) return;
              playLine((i + 1) % wins.length);
            }, STEP_PAD_MS);
            timersRef.current.push(advanceT);
          }, HOLD_MS);
          timersRef.current.push(holdT);
        }, BIG_HOLD_MS);
        timersRef.current.push(stage2T);
      });
    }

    const startT = setTimeout(() => playLine(0), 60);
    timersRef.current.push(startT);

    return () => {
      cancelledRef.current = true;
      timersRef.current.forEach(clearTimeout);
      cancelsRef.current.forEach(fn => fn());
      timersRef.current  = [];
      cancelsRef.current = [];
    };
  }, [wins, filterId, clipId, onLineActive]);

  const svgStyle: React.CSSProperties = {
    position:      "absolute",
    inset:         0,
    width:         "100%",
    height:        "100%",
    pointerEvents: "none",
    overflow:      "visible",
  };

  const defs = (
    <defs>
      <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <clipPath id={clipId}>
        <rect
          x={CLIP_X - 18}
          y={CLIP_Y - 18}
          width={CLIP_W + 36}
          height={CLIP_H + 36}
        />
      </clipPath>
    </defs>
  );

  return (
    <>
      {/* z25 — dim rect + payline glow lines (above z21 winning-sprite canvases
                so the glow line draws on top of the icons) */}
      <svg
        ref={svgRef}
        style={{ ...svgStyle, zIndex: 25 }}
        viewBox={`0 0 ${CW} ${CH}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {defs}
      </svg>

      {/* z26 — bigText total + per-line payout labels (above the glow line) */}
      <svg
        ref={labelSvgRef}
        style={{ ...svgStyle, zIndex: 26 }}
        viewBox={`0 0 ${CW} ${CH}`}
        xmlns="http://www.w3.org/2000/svg"
      />
    </>
  );
}
