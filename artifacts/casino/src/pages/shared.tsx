import { useState } from "react";
import { useLocation } from "wouter";

/* ── Page wrapper ──────────────────────────────────────────────── */
export function PageWrapper({
  title,
  breadcrumb,
  accentColor = "#a855f7",
  fillHeight = false,
  children,
}: {
  title: string;
  breadcrumb?: string;
  accentColor?: string;
  fillHeight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative"
      style={fillHeight
        ? { height: "100%", display: "flex", flexDirection: "column" }
        : { minHeight: "100%" }
      }
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="absolute top-0 left-1/3 w-[700px] h-[350px] rounded-full"
          style={{
            background: `radial-gradient(ellipse, ${accentColor} 0%, transparent 70%)`,
            filter: "blur(60px)",
            opacity: 0.05,
          }}
        />
        <div
          className="absolute bottom-0 right-1/4 w-[600px] h-[300px] rounded-full"
          style={{
            background: `radial-gradient(ellipse, ${accentColor} 0%, transparent 70%)`,
            filter: "blur(70px)",
            opacity: 0.03,
          }}
        />
      </div>
      <div
        className="relative z-10 w-full max-w-[1280px] mx-auto px-6 pt-8"
        style={fillHeight
          ? { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", paddingBottom: 16 }
          : { paddingBottom: 64 }
        }
      >
        {/* Neon divider page header */}
        <div className="flex items-center w-full mb-8" style={{ flexShrink: 0 }}>
          <div className="divider-line dl-left" style={{ "--d-c": accentColor } as React.CSSProperties} />
          <span className="divider-dot" style={{ background: accentColor, boxShadow: `0 0 8px 3px ${accentColor}99` }} />
          <h2 className="section-title shrink-0 mx-4">{title}</h2>
          <span className="divider-dot" style={{ background: accentColor, boxShadow: `0 0 8px 3px ${accentColor}99` }} />
          <div className="divider-line dl-right" style={{ "--d-c": accentColor } as React.CSSProperties} />
        </div>
        {fillHeight
          ? <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
          : children
        }
      </div>
    </div>
  );
}

/* ── Catalog game card ─────────────────────────────────────────── */
export interface CatalogGame {
  id: string;
  name: string;
  description: string;
  gradient: string;
  neonClass: string;
  neonColor: string;
  badge?: string;
  badgeColor?: string;
  players?: string;
  betRange?: string;
  actionLabel?: string;
  statusLabel?: string;
  statusColor?: string;
  image?: string;
  disabled?: boolean;
  hasPassword?: boolean;
}

export function CatalogCard({ game, delay = "0s", route, onClick }: { game: CatalogGame; delay?: string; route?: string; onClick?: () => void }) {
  const [, setLocation] = useLocation();
  const [hov, setHov] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const closed = !!game.disabled;
  const handleClick = closed ? undefined : (onClick ?? (route ? () => setLocation(route) : undefined));
  return (
    <div
      className={`rounded-2xl overflow-hidden neon-card ${game.neonClass}`}
      style={{
        "--pulse-delay": delay,
        width: "100%", minWidth: 0, height: "100%",
        display: "flex", flexDirection: "column",
        cursor: closed ? "not-allowed" : (handleClick ? "pointer" : "default"),
        opacity: closed ? 0.55 : 1,
        filter: closed ? "grayscale(0.55)" : "none",
        transition: "opacity 0.2s, filter 0.2s",
      } as React.CSSProperties}
      onClick={handleClick}
      onMouseEnter={() => { if (!closed) setHov(true); }}
      onMouseLeave={() => setHov(false)}
    >
      {/* Artwork header */}
      <div
        style={{
          height: "clamp(132px, 10vw, 164px)",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
          background: game.gradient,
        }}
      >
        {/* Themed artwork image */}
        {game.image && (
          <img
            src={game.image}
            alt={game.name}
            onLoad={() => setImgLoaded(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              transform: hov ? "scale(1.07)" : "scale(1)",
              opacity: imgLoaded ? 1 : 0,
              transition: "transform 0.4s ease, opacity 0.4s ease",
            }}
          />
        )}
        {/* Gradient colour tint overlay — only shown when there is no artwork image */}
        {!game.image && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: game.gradient,
              opacity: 1,
            }}
          />
        )}
        {/* Brightness lift on hover */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255,255,255,0.06)",
            opacity: hov ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        />
        {/* Closed dark overlay — dims the image further when a game is unavailable */}
        {closed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 13,
                fontWeight: 900,
                letterSpacing: "0.18em",
                color: "#ef4444",
                textShadow: "0 0 12px rgba(239,68,68,0.6)",
                textTransform: "uppercase",
              }}
            >
              CLOSED
            </span>
          </div>
        )}
        {/* Ghost watermark text — only shown when there is no artwork image */}
        {!game.image && !closed && (
          <div
            className="absolute inset-0 flex items-center justify-center select-none"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 46,
              fontWeight: 900,
              color: `${game.neonColor}22`,
              letterSpacing: "0.04em",
              pointerEvents: "none",
            }}
          >
            {game.name.split(" ")[0].toUpperCase()}
          </div>
        )}
        {/* Neon edge glow along bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "15%",
            right: "15%",
            height: 1,
            background: closed
              ? "linear-gradient(90deg, transparent, rgba(239,68,68,0.4), transparent)"
              : `linear-gradient(90deg, transparent, ${game.neonColor}66, transparent)`,
            opacity: hov ? 1 : 0.4,
            transition: "opacity 0.2s",
          }}
        />
        {/* Badge top-left */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          {game.badge && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
              style={{ background: game.badgeColor ?? game.neonColor, color: "#fff", boxShadow: `0 0 8px ${game.badgeColor ?? game.neonColor}88` }}
            >
              {game.badge}
            </span>
          )}
          {game.hasPassword && !closed && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
              style={{ background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.4)" }}
            >
              🔒
            </span>
          )}
        </div>
        {/* Status pill top-right */}
        {game.statusLabel && (
          <div className="absolute top-2 right-2">
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
              style={{
                color: game.statusColor ?? game.neonColor,
                background: `${game.statusColor ?? game.neonColor}22`,
                border: `1px solid ${game.statusColor ?? game.neonColor}55`,
              }}
            >
              {game.statusLabel}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3" style={{ background: "#0c0a0a", flex: 1, display: "flex", flexDirection: "column" }}>
        <h3
          className="font-rajdhani font-black text-base uppercase tracking-wider mb-0.5 text-center"
          style={{ color: closed ? "rgba(255,255,255,0.4)" : "#f0f0f0" }}
        >
          {game.name}
        </h3>
        {(game.players || game.betRange) && (
          <div className="flex items-center justify-center gap-3 mb-2">
            {game.players && (
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.42)" }}>
                👥 {game.players}
              </span>
            )}
            {game.betRange && (
              <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.42)" }}>
                💰 {game.betRange}
              </span>
            )}
          </div>
        )}

        <button
          disabled={closed}
          className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
          style={{
            marginTop: "auto",
            background: closed ? "rgba(239,68,68,0.08)" : (hov ? game.neonColor : "transparent"),
            color: closed ? "#ef4444" : (hov ? "#060404" : game.neonColor),
            border: `1px solid ${closed ? "rgba(239,68,68,0.3)" : game.neonColor + "55"}`,
            boxShadow: !closed && hov ? `0 0 16px ${game.neonColor}55` : "none",
            cursor: closed ? "not-allowed" : "pointer",
            opacity: closed ? 0.7 : 1,
          }}
        >
          {closed ? "CLOSED" : (game.actionLabel ?? "Play Now")}
        </button>
      </div>
    </div>
  );
}

/* ── Centered card grid ────────────────────────────────────────── */
export function CardGrid({
  children,
  gap = 20,
  minItemWidth,
  maxItemWidth,
  className = "",
}: {
  children: React.ReactNode;
  gap?: number;
  minItemWidth?: number;
  maxItemWidth?: number;
  className?: string;
}) {
  // Variable-size grids (marketplace, challenges, staff, auctions) — fluid
  // auto-fit columns that honour the requested item sizing and never overflow.
  if (minItemWidth) {
    return (
      <div
        className={className}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${minItemWidth}px, 100%), ${maxItemWidth ?? minItemWidth}px))`,
          justifyContent: "center",
          gap: `${gap}px`,
          width: "100%",
          minWidth: 0,
          margin: "0 auto",
        }}
      >
        {children}
      </div>
    );
  }
  // Default game-card grid — exact 4 / 3 / 2 / 1 responsive columns.
  return <div className={`casino-card-grid ${className}`.trim()}>{children}</div>;
}

/* ── Section sub-header ────────────────────────────────────────── */
export function SubHeader({ label }: { label: string }) {
  return (
    <h2
      className="mb-4 text-[13px] font-black uppercase tracking-[0.12em]"
      style={{ color: "rgba(255,255,255,0.55)" }}
    >
      {label}
    </h2>
  );
}
