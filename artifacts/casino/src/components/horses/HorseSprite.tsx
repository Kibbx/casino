import { useState } from "react";

export const BASE_OPTIONS = [
  "brown", "black", "white", "grey", "chestnut", "dark_bay",
  "palomino", "bay", "cream", "copper", "dapple_grey", "roan",
  "sand", "mahogany",
] as const;
export const PATTERN_OPTIONS = ["none", "blaze", "socks", "stripe", "spotted", "pinto", "tobiano", "star", "sabino"] as const;
export const FLAIR_OPTIONS = ["none", "glow", "smoke", "fire", "neon", "electric", "gold"] as const;

export type VisualBase = typeof BASE_OPTIONS[number];
export type VisualPattern = typeof PATTERN_OPTIONS[number];
export type VisualFlair = typeof FLAIR_OPTIONS[number];

const BASE_COLORS: Record<string, string> = {
  brown: "#8B4513",
  black: "#1a1a1a",
  white: "#e8e8e8",
  grey: "#808080",
  chestnut: "#CD5C5C",
  dark_bay: "#3B1F10",
  palomino: "#D4A843",
  bay: "#7B3F00",
  cream: "#F0DEB4",
  copper: "#B87333",
  dapple_grey: "#9A9A9A",
  roan: "#9B6B5B",
  sand: "#C4A882",
  mahogany: "#4A1C00",
};

const PATTERN_CSS: Record<string, string> = {
  none: "transparent",
  blaze: "linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.55) 30%, transparent 30%)",
  socks: "linear-gradient(0deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 20%, transparent 20%)",
  stripe: "repeating-linear-gradient(135deg, rgba(255,255,255,0.15) 0px, rgba(255,255,255,0.15) 4px, transparent 4px, transparent 12px)",
  spotted: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.4) 15%, transparent 15%), radial-gradient(circle at 70% 60%, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.3) 12%, transparent 12%)",
  pinto: "linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.45) 50%, transparent 50%)",
  tobiano: "radial-gradient(ellipse at 50% 30%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.6) 40%, transparent 55%), linear-gradient(0deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.5) 25%, transparent 25%)",
  star: "radial-gradient(circle at 50% 18%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.7) 10%, transparent 11%)",
  sabino: "radial-gradient(ellipse at 30% 70%, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.45) 25%, transparent 40%), radial-gradient(circle at 65% 15%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.4) 12%, transparent 14%)",
};

const FLAIR_GLOW: Record<string, string> = {
  none: "none",
  glow: "0 0 14px 5px rgba(255,255,255,0.7)",
  smoke: "0 0 12px 4px rgba(120,120,140,0.7)",
  fire: "0 0 16px 6px rgba(255,70,0,0.85)",
  neon: "0 0 16px 6px rgba(0,255,200,0.85)",
  electric: "0 0 16px 6px rgba(80,120,255,0.85)",
  gold: "0 0 16px 6px rgba(255,210,0,0.9)",
};

const FLAIR_BORDER: Record<string, string> = {
  none: "transparent",
  glow: "rgba(255,255,255,0.4)",
  smoke: "rgba(140,140,160,0.4)",
  fire: "rgba(255,100,0,0.6)",
  neon: "rgba(0,220,180,0.6)",
  electric: "rgba(80,120,255,0.6)",
  gold: "rgba(255,200,0,0.7)",
};

interface Props {
  base: string;
  pattern: string;
  flair: string;
  ownerColor?: string;
  number?: number;
  size?: number;
  className?: string;
}

function LayerImg({ src, alt = "", size }: { src: string; alt?: string; size: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      onLoad={() => setLoaded(true)}
      style={{
        position: "absolute",
        inset: 0,
        width: size,
        height: size,
        objectFit: "contain",
        opacity: loaded ? 1 : 0,
        transition: "opacity 0.15s",
      }}
    />
  );
}

export function HorseSprite({ base, pattern, flair, ownerColor, number, size = 64, className = "" }: Props) {
  const baseColor = BASE_COLORS[base] ?? BASE_COLORS.brown;
  const patternBg = PATTERN_CSS[pattern] ?? "transparent";
  const flairShadow = FLAIR_GLOW[flair] ?? "none";
  const flairBorder = FLAIR_BORDER[flair] ?? "transparent";

  return (
    <div
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Base color layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "12%",
          backgroundColor: baseColor,
          boxShadow: flairShadow,
          border: `2px solid ${flairBorder}`,
          transition: "box-shadow 0.2s, border-color 0.2s",
        }}
      />

      {/* Pattern overlay */}
      {pattern !== "none" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "12%",
            background: patternBg,
          }}
        />
      )}

      {/* PNG base layer (shows if file exists) */}
      <LayerImg src={`/assets/horses/base/${base}.png`} alt={base} size={size} />

      {/* PNG pattern layer */}
      {pattern !== "none" && (
        <LayerImg src={`/assets/horses/pattern/${pattern}.png`} alt={pattern} size={size} />
      )}

      {/* Owner tack — saddle band across the middle */}
      {ownerColor && (
        <>
          <div
            style={{
              position: "absolute",
              left: "15%",
              right: "15%",
              top: "35%",
              height: "28%",
              borderRadius: "6px",
              background: `linear-gradient(180deg, ${ownerColor}cc 0%, ${ownerColor}ee 50%, ${ownerColor}aa 100%)`,
              border: `1.5px solid ${ownerColor}`,
              boxShadow: `0 0 6px ${ownerColor}80`,
            }}
          />
          {/* Saddle centre highlight */}
          <div
            style={{
              position: "absolute",
              left: "32%",
              right: "32%",
              top: "40%",
              height: "16%",
              borderRadius: "4px",
              background: `rgba(255,255,255,0.18)`,
            }}
          />
        </>
      )}

      {/* PNG flair layer (shows if file exists) */}
      {flair !== "none" && (
        <LayerImg src={`/assets/horses/flair/${flair}.png`} alt={flair} size={size} />
      )}

      {/* Race number badge */}
      {number !== undefined && (
        <div
          style={{
            position: "absolute",
            top: -6,
            left: -6,
            backgroundColor: "#000",
            color: "#fff",
            fontSize: Math.max(9, size * 0.18),
            fontWeight: 800,
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1.5px solid rgba(255,255,255,0.3)",
            fontFamily: "monospace",
            lineHeight: 1,
          }}
        >
          {number}
        </div>
      )}
    </div>
  );
}

// Compact version for race track lanes (fits in 48px tall lanes)
export function HorseTrackIcon({ base, pattern, flair, number }: {
  base: string;
  pattern: string;
  flair: string;
  number?: number;
}) {
  return <HorseSprite base={base} pattern={pattern} flair={flair} number={number} size={36} />;
}
