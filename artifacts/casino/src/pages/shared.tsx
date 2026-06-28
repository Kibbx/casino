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

/* ── Mini Games themed backgrounds ────────────────────────────── */
/* Fixed breathing glow dots per theme — no movement, opacity only */
const MINI_GLOW_DOTS: Record<string, Array<{ x: string; y: string; s: number; d: string; dur: string }>> = {
  mines:       [{ x:"30%",y:"36%",s:3,d:"0s",  dur:"6s"  },{x:"71%",y:"37%",s:2,d:"2.5s",dur:"7.5s"},{x:"91%",y:"70%",s:4,d:"4.5s",dur:"8s"}],
  keno:        [{ x:"20%",y:"39%",s:4,d:"1s",  dur:"7s"  },{x:"86%",y:"59%",s:4,d:"0s",  dur:"8.5s"}],
  "mob-tower": [{ x:"13%",y:"6%", s:2,d:"0s",  dur:"6s"  },{x:"87%",y:"5%", s:2,d:"3.5s",dur:"7s"}],
  cases:       [{ x:"23%",y:"42%",s:2,d:"0.5s",dur:"7s"  },{x:"76%",y:"44%",s:2,d:"2s",  dur:"8s"  },{x:"50%",y:"18%",s:3,d:"4s",dur:"6.5s"}],
};

function MinesSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <g stroke={c} strokeWidth="0.4" opacity="0.38">
        <line x1="55"  y1="0"  x2="55"  y2="140"/>
        <line x1="110" y1="0"  x2="110" y2="140"/>
        <line x1="165" y1="0"  x2="165" y2="140"/>
        <line x1="0"   y1="46" x2="220" y2="46"/>
        <line x1="0"   y1="92" x2="220" y2="92"/>
      </g>
      <polygon points="155,18 180,52 155,86 130,52" stroke={c} strokeWidth="1.2" fill="none" opacity="0.72"/>
      <polygon points="24,28 38,48 24,68 10,48"     stroke={c} strokeWidth="0.9" fill="none" opacity="0.58"/>
      <polygon points="200,98 212,116 200,134 188,116" stroke={c} strokeWidth="0.8" fill="none" opacity="0.52"/>
      <g stroke={c} strokeWidth="0.9" opacity="0.7">
        <line x1="66" y1="46" x2="66" y2="54"/>
        <line x1="62" y1="50" x2="70" y2="50"/>
      </g>
      <circle cx="66" cy="50" r="1.5" fill={c} opacity="0.55"/>
      <g stroke={c} strokeWidth="0.8" opacity="0.58">
        <line x1="188" y1="27" x2="188" y2="33"/>
        <line x1="185" y1="30" x2="191" y2="30"/>
      </g>
    </svg>
  );
}

function KenoSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <circle cx="44"  cy="54"  r="27" stroke={c}       strokeWidth="1.1" fill="none" opacity="0.72"/>
      <circle cx="118" cy="32"  r="21" stroke={c}       strokeWidth="0.9" fill="none" opacity="0.62"/>
      <circle cx="188" cy="82"  r="28" stroke={c}       strokeWidth="1.1" fill="none" opacity="0.56"/>
      <circle cx="82"  cy="114" r="17" stroke="#9333ea" strokeWidth="0.9" fill="none" opacity="0.55"/>
      <circle cx="188" cy="82"  r="38" stroke={c}       strokeWidth="0.4" fill="none" opacity="0.28"/>
      <circle cx="188" cy="82"  r="48" stroke={c}       strokeWidth="0.3" fill="none" opacity="0.16"/>
      <text x="34"  y="59"  fontSize="12" fill={c}       opacity="0.55" fontFamily="monospace" fontWeight="bold">07</text>
      <text x="109" y="37"  fontSize="10" fill={c}       opacity="0.5"  fontFamily="monospace" fontWeight="bold">23</text>
      <text x="177" y="87"  fontSize="13" fill={c}       opacity="0.48" fontFamily="monospace" fontWeight="bold">41</text>
      <text x="75"  y="119" fontSize="9"  fill="#9333ea" opacity="0.48" fontFamily="monospace" fontWeight="bold">15</text>
    </svg>
  );
}

function MobTowerSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <rect x="95" y="14" width="30"  height="6" rx="1" fill={c} opacity="0.55"/>
      <rect x="88" y="26" width="44"  height="6" rx="1" fill={c} opacity="0.46"/>
      <rect x="81" y="38" width="58"  height="6" rx="1" fill={c} opacity="0.38"/>
      <rect x="74" y="50" width="72"  height="6" rx="1" fill={c} opacity="0.3"/>
      <rect x="67" y="62" width="86"  height="6" rx="1" fill={c} opacity="0.22"/>
      <rect x="60" y="74" width="100" height="6" rx="1" fill={c} opacity="0.15"/>
      <rect x="28"  y="0"  width="1.5" height="140" fill={c} opacity="0.22"/>
      <rect x="190" y="0"  width="1.5" height="140" fill={c} opacity="0.18"/>
      <rect x="109" y="83" width="1"   height="57"  fill={c} opacity="0.32"/>
      <rect x="0"   y="100" width="20" height="40"  fill={c} opacity="0.09"/>
      <rect x="196" y="92"  width="24" height="48"  fill={c} opacity="0.09"/>
    </svg>
  );
}

function CasesSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <rect x="18"  y="28" width="54" height="54" rx="2" stroke={c}       strokeWidth="1.1" fill="none" opacity="0.68"/>
      <line x1="18" y1="55"  x2="72"  y2="55"  stroke={c} strokeWidth="0.6" opacity="0.52"/>
      <line x1="45" y1="28"  x2="45"  y2="82"  stroke={c} strokeWidth="0.6" opacity="0.52"/>
      <rect x="150" y="56" width="58" height="58" rx="2" stroke={c}       strokeWidth="1"   fill="none" opacity="0.58"/>
      <line x1="150" y1="85"  x2="208" y2="85"  stroke={c} strokeWidth="0.5" opacity="0.44"/>
      <line x1="179" y1="56"  x2="179" y2="114" stroke={c} strokeWidth="0.5" opacity="0.44"/>
      <rect x="92"  y="16" width="38" height="38" stroke="#0891b2" strokeWidth="1"   fill="none" opacity="0.62"/>
      <rect x="102" y="26" width="38" height="38" stroke={c}       strokeWidth="0.8" fill="none" opacity="0.5"/>
      <line x1="92"  y1="16" x2="102" y2="26" stroke={c} strokeWidth="0.6" opacity="0.5"/>
      <line x1="130" y1="16" x2="140" y2="26" stroke={c} strokeWidth="0.6" opacity="0.5"/>
      <line x1="92"  y1="54" x2="102" y2="64" stroke={c} strokeWidth="0.6" opacity="0.5"/>
      <line x1="130" y1="54" x2="140" y2="64" stroke={c} strokeWidth="0.6" opacity="0.5"/>
      <line x1="0"   y1="0"  x2="38"  y2="140" stroke={c}       strokeWidth="0.8" opacity="0.16"/>
      <line x1="178" y1="0"  x2="220" y2="95"  stroke="#0891b2" strokeWidth="0.8" opacity="0.13"/>
    </svg>
  );
}

function MiniGameBg({ theme, color }: { theme: string; color: string }) {
  const dots = MINI_GLOW_DOTS[theme] ?? [];
  const ill =
    theme === "mines"     ? <MinesSvg c={color} />     :
    theme === "keno"      ? <KenoSvg c={color} />      :
    theme === "mob-tower" ? <MobTowerSvg c={color} />  :
    theme === "cases"     ? <CasesSvg c={color} />     : null;
  return (
    <>
      {/* Themed SVG: slight blur softens edges, breathing animation varies opacity */}
      {ill && (
        <div className="mini-bg-illus" style={{ position: "absolute", inset: 0, filter: "blur(4px)", pointerEvents: "none" }}>
          {ill}
        </div>
      )}
      {/* Radial depth glow from center */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 75% 55% at 50% 40%, ${color}18 0%, transparent 70%)`,
      }} />
      {/* Very subtle grid texture */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `linear-gradient(${color}07 1px, transparent 1px), linear-gradient(90deg, ${color}07 1px, transparent 1px)`,
        backgroundSize: "10px 10px",
      }} />
      {/* Fixed-position glow dots — opacity breathing only, no movement */}
      {dots.map((p, i) => (
        <div key={i} className="mini-glow-dot" style={{
          left: p.x, top: p.y, width: p.s, height: p.s,
          background: color, animationDelay: p.d, animationDuration: p.dur,
          boxShadow: `0 0 ${p.s * 3}px ${color}`,
        }} />
      ))}
      {/* Hover shimmer — appears only on card hover */}
      <div className="mini-hover-shimmer" />
    </>
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
  /** Override the large watermark text (defaults to first word of name) */
  bgTitle?: string;
  /** Enable the neon float + glow animation on the watermark text */
  bgGlowAnim?: boolean;
  /** Themed background visual: "mines" | "keno" | "mob-tower" | "cases" */
  bgTheme?: string;
}

export function CatalogCard({ game, delay = "0s", route, onClick }: { game: CatalogGame; delay?: string; route?: string; onClick?: () => void }) {
  const [, setLocation] = useLocation();
  const [hov, setHov] = useState(false);
  const wmText = game.bgTitle ?? game.name.split(" ")[0].toUpperCase();
  const wmSize = wmText.length > 6 ? 30 : 46;
  const glowKey = game.neonClass.replace("neon-", "");
  const handleClick = onClick ?? (route ? () => setLocation(route) : undefined);
  return (
    <div
      className={`rounded-2xl overflow-hidden neon-card ${game.neonClass}`}
      style={{ "--pulse-delay": delay, width: "220px", flexShrink: 0, cursor: handleClick ? "pointer" : "default" } as React.CSSProperties}
      onClick={handleClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Artwork header */}
      <div
        style={{
          height: 140,
          position: "relative",
          overflow: "hidden",
          background: game.gradient,
        }}
      >
        {/* Themed background visuals (Mini Games only) */}
        {game.bgTheme && <MiniGameBg theme={game.bgTheme} color={game.neonColor} />}
        {/* Gradient fill */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: game.gradient,
            opacity: game.bgTheme ? 0.7 : 1,
          }}
        />
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
        {/* Ghost watermark text */}
        <div
          className={`absolute inset-0 flex items-center justify-center select-none${game.bgGlowAnim ? " mini-watermark-anim" : ""}`}
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: wmSize,
            fontWeight: 900,
            color: `${game.neonColor}22`,
            letterSpacing: "0.04em",
            pointerEvents: "none",
          }}
        >
          {game.bgGlowAnim
            ? <span className="mini-watermark-text" data-glow={glowKey}>{wmText}</span>
            : wmText}
        </div>
        {/* Bottom fade into card body */}
        <div
          className="absolute bottom-0 left-0 right-0"
          style={{ height: 56, background: "linear-gradient(transparent, rgba(10,8,8,0.95))" }}
        />
        {/* Neon edge glow along bottom */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: "15%",
            right: "15%",
            height: 1,
            background: `linear-gradient(90deg, transparent, ${game.neonColor}66, transparent)`,
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
