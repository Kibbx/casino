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
}

export function CatalogCard({ game, delay = "0s", route, onClick }: { game: CatalogGame; delay?: string; route?: string; onClick?: () => void }) {
  const [, setLocation] = useLocation();
  const [hov, setHov] = useState(false);
  const handleClick = onClick ?? (route ? () => setLocation(route) : undefined);
  return (
    <div
      className={`rounded-2xl overflow-hidden neon-card ${game.neonClass}`}
      style={{ "--pulse-delay": delay, width: "220px", flexShrink: 0, cursor: handleClick ? "pointer" : "default" } as React.CSSProperties}
      onClick={handleClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Gradient image area */}
      <div
        style={{
          height: 128,
          background: game.gradient,
          position: "relative",
          overflow: "hidden",
          transition: "filter 0.2s",
          filter: hov ? "brightness(1.2)" : "brightness(1)",
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center select-none"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 52,
            fontWeight: 900,
            color: `${game.neonColor}14`,
            letterSpacing: "0.04em",
          }}
        >
          {game.name.split(" ")[0].toUpperCase()}
        </div>
        <div
          className="absolute bottom-0 left-0 right-0 h-16"
          style={{ background: "linear-gradient(transparent, rgba(10,8,8,0.9))" }}
        />
        <div className="absolute top-2 left-2 flex gap-1.5">
          {game.badge && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
              style={{ background: game.badgeColor ?? game.neonColor, color: "#fff" }}
            >
              {game.badge}
            </span>
          )}
        </div>
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
      <div className="px-4 py-3" style={{ background: "#0c0a0a" }}>
        <h3
          className="font-rajdhani font-black text-base uppercase tracking-wider mb-0.5 text-center"
          style={{ color: "#f0f0f0" }}
        >
          {game.name}
        </h3>
        <p className="text-[11px] mb-2 leading-snug" style={{ color: "rgba(255,255,255,0.40)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {game.description.replace(/\s*·?\s*\d+\s*\/\s*\d+\s*(seated|players?|occupied)/gi, "").replace(/\s*·?\s*(seated|players?|occupied)\s*\d+\s*\/\s*\d+/gi, "").trim().replace(/\s*·\s*$/, "")}
        </p>

        {(game.players || game.betRange) && (
          <div className="flex items-center gap-3 mb-2">
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
          className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
          style={{
            background: hov ? game.neonColor : "transparent",
            color: hov ? "#060404" : game.neonColor,
            border: `1px solid ${game.neonColor}55`,
            boxShadow: hov ? `0 0 16px ${game.neonColor}55` : "none",
          }}
        >
          {game.actionLabel ?? "Play Now"}
        </button>
      </div>
    </div>
  );
}

/* ── Centered card grid ────────────────────────────────────────── */
export function CardGrid({
  children,
  gap = 20,
  className = "",
}: {
  children: React.ReactNode;
  gap?: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: `${gap}px`,
        width: "100%",
        maxWidth: `${4 * 220 + 3 * gap}px`,
        margin: "0 auto",
      }}
    >
      {children}
    </div>
  );
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
