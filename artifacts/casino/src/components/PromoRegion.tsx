import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Reference viewport used by the region editor (px).
 * Regions are stored as percentages of this frame.
 */
const REF_W = 1920;
const REF_H = 1080;

/**
 * For pages with a centred max-width container, the content is ALWAYS this
 * many px wide (or viewport-width when narrower), centred horizontally.
 *
 * Values are rem × 16 (browser default root font-size):
 *   max-w-5xl = 64rem = 1024 px
 *   max-w-6xl = 72rem = 1152 px
 *
 * Pages not listed here are treated as full-viewport (game pages).
 */
const CONTENT_MAX_W: Record<string, number> = {
  lobby:    1152, // max-w-6xl
  homepage: 1024, // max-w-5xl
};

type ActivePromo = {
  region: {
    id: number; name: string; pageKey: string;
    x: number; y: number; width: number; height: number;
    desktopVisible: boolean; mobileVisible: boolean;
  };
  placement: { id: number; startsAt: string; endsAt: string };
  asset: { id: number; title: string; imageUrl: string; targetUrl?: string | null };
};

interface PromoZoneProps {
  pageKey: string;
}

/**
 * Renders active ad placements for a page as a fixed portal overlay.
 *
 * Coordinate mapping — two cases:
 *
 * 1. Centred-content pages (lobby, homepage):
 *    The content container has a fixed max-width and is always centred.
 *    We compute the ad's offset from the content-left in the 1920px reference,
 *    then re-apply that same offset in the live viewport — so the ad tracks
 *    the content regardless of window width.
 *
 * 2. Full-viewport pages (game pages):
 *    Content fills the viewport, so stored viewport-% positions scale
 *    correctly to any screen size automatically.
 *
 * We use purely mathematical computation (no DOM measurement) to avoid
 * timing issues with getComputedStyle / MutationObserver races.
 */
export function PromoZone({ pageKey }: PromoZoneProps) {
  const [promos, setPromos] = useState<ActivePromo[]>([]);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);

  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    fetch(`${BASE_URL}/api/promo/active/${pageKey}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : [])
      .then(setPromos)
      .catch(() => {});
  }, [pageKey]);

  if (promos.length === 0) return null;

  /**
   * Convert stored reference-% coordinates into live viewport pixels.
   */
  const computeRect = (region: ActivePromo["region"]) => {
    const contentMaxW = CONTENT_MAX_W[region.pageKey];

    if (contentMaxW !== undefined) {
      // ── Centred-content page ────────────────────────────────────────────

      // How wide the content actually is at this viewport
      const actualContentW = Math.min(vw, contentMaxW);
      // Where the content's left edge sits in the live viewport
      const actualContentLeft = Math.max(0, (vw - contentMaxW) / 2);

      // Where the content's left edge sat in the 1920px reference
      const refContentLeft = (REF_W - contentMaxW) / 2;

      // The ad's absolute x in the reference (px)
      const refAdX = region.x / 100 * REF_W;
      // The ad's offset from the reference content-left (can be negative)
      const dxFromContent = refAdX - refContentLeft;

      // Map that content-relative offset into the live content width
      const left  = actualContentLeft + (dxFromContent  / contentMaxW) * actualContentW;
      const width = (region.width / 100 * REF_W / contentMaxW) * actualContentW;

      // Y is a plain viewport percentage (lobby content is top-aligned;
      // homepage vertical centering is close enough at typical resolutions)
      const top    = region.y      / 100 * vh;
      const height = region.height / 100 * vh;

      return { left, top, width, height };
    }

    // ── Full-viewport page (game pages) ──────────────────────────────────
    return {
      left:   region.x      / 100 * vw,
      top:    region.y      / 100 * vh,
      width:  region.width  / 100 * vw,
      height: region.height / 100 * vh,
    };
  };

  const overlay = (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, pointerEvents: "none", overflow: "visible" }}>
      {promos.map(({ region, asset }) => {
        const pos = computeRect(region);
        const img = (
          <img
            src={`${BASE_URL}${asset.imageUrl}`}
            alt={asset.title}
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", borderRadius: 6 }}
            draggable={false}
          />
        );
        return (
          <div
            key={region.id}
            style={{
              position: "absolute",
              left:   pos.left,
              top:    pos.top,
              width:  pos.width,
              height: pos.height,
              pointerEvents: asset.targetUrl ? "auto" : "none",
              overflow: "hidden",
              background: "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title={asset.title}
          >
            {asset.targetUrl ? (
              <a href={asset.targetUrl} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", width: "100%", height: "100%" }}>
                {img}
              </a>
            ) : img}
          </div>
        );
      })}
    </div>
  );

  return createPortal(overlay, document.body);
}
