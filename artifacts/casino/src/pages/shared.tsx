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
const MINI_PARTICLES: Record<string, Array<{ x: string; y: string; s: number; d: string; dur: string }>> = {
  mines: [
    { x: "15%", y: "62%", s: 3, d: "0s",   dur: "6s"   },
    { x: "35%", y: "78%", s: 2, d: "1.5s", dur: "8s"   },
    { x: "58%", y: "52%", s: 4, d: "0.8s", dur: "7s"   },
    { x: "76%", y: "70%", s: 2, d: "2s",   dur: "9s"   },
    { x: "88%", y: "84%", s: 3, d: "0.4s", dur: "5.5s" },
    { x: "45%", y: "90%", s: 2, d: "3s",   dur: "7s"   },
  ],
  keno: [
    { x: "10%", y: "65%", s: 3, d: "0s",   dur: "7s"   },
    { x: "28%", y: "74%", s: 2, d: "1s",   dur: "9s"   },
    { x: "52%", y: "80%", s: 4, d: "2s",   dur: "6s"   },
    { x: "70%", y: "60%", s: 2, d: "0.5s", dur: "8s"   },
    { x: "90%", y: "70%", s: 3, d: "1.5s", dur: "7s"   },
    { x: "40%", y: "88%", s: 2, d: "3.5s", dur: "8.5s" },
  ],
  "mob-tower": [
    { x: "20%", y: "88%", s: 3, d: "0s",   dur: "7s"   },
    { x: "42%", y: "92%", s: 2, d: "1.2s", dur: "9s"   },
    { x: "60%", y: "84%", s: 3, d: "0.7s", dur: "6s"   },
    { x: "78%", y: "90%", s: 2, d: "2.5s", dur: "8s"   },
    { x: "92%", y: "93%", s: 4, d: "0.3s", dur: "10s"  },
    { x: "12%", y: "95%", s: 2, d: "4s",   dur: "7.5s" },
  ],
  cases: [
    { x: "12%", y: "62%", s: 3, d: "0.5s", dur: "8s"   },
    { x: "30%", y: "74%", s: 2, d: "0s",   dur: "7s"   },
    { x: "55%", y: "80%", s: 4, d: "1.8s", dur: "6s"   },
    { x: "72%", y: "65%", s: 2, d: "1s",   dur: "9s"   },
    { x: "85%", y: "78%", s: 3, d: "0.3s", dur: "7s"   },
    { x: "48%", y: "90%", s: 2, d: "2.8s", dur: "8.5s" },
  ],
};

function MinesSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <polygon points="150,20 175,55 150,90 125,55"    stroke={c} strokeWidth="1.5" fill={`${c}08`}/>
      <polygon points="30,30 42,50 30,70 18,50"         stroke={c} strokeWidth="1"   fill={`${c}08`}/>
      <polygon points="20,120 35,80 50,120"             stroke={c} strokeWidth="1"   fill={`${c}05`}/>
      <polygon points="185,15 200,30 195,50 178,40"     stroke={c} strokeWidth="1"   fill={`${c}08`}/>
      <polygon points="195,118 210,95 220,124"          stroke={c} strokeWidth="0.8" fill={`${c}05`}/>
      <polygon points="85,25 96,45 74,45"               stroke={c} strokeWidth="0.8" fill={`${c}06`}/>
      <circle cx="70"  cy="40"  r="4" fill={c} opacity="0.38"/>
      <circle cx="178" cy="100" r="6" fill={c} opacity="0.22"/>
      <circle cx="112" cy="118" r="3" fill={c} opacity="0.28"/>
      <circle cx="40"  cy="108" r="2" fill={c} opacity="0.2"/>
      <circle cx="140" cy="30"  r="2" fill={c} opacity="0.3"/>
      <line x1="10"  y1="95" x2="60"  y2="95" stroke={c} strokeWidth="0.5" opacity="0.4"/>
      <line x1="160" y1="110" x2="215" y2="110" stroke={c} strokeWidth="0.5" opacity="0.3"/>
      <line x1="0"   y1="60" x2="25"  y2="35"  stroke={c} strokeWidth="0.5" opacity="0.25"/>
    </svg>
  );
}

function KenoSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <circle cx="40"  cy="50"  r="22" stroke={c}       strokeWidth="1.5" fill={`${c}08`}/>
      <circle cx="120" cy="30"  r="18" stroke={c}       strokeWidth="1"   fill={`${c}08`}/>
      <circle cx="190" cy="80"  r="25" stroke={c}       strokeWidth="1.5" fill={`${c}06`}/>
      <circle cx="85"  cy="110" r="15" stroke="#9333ea" strokeWidth="1"   fill="#9333ea08"/>
      <circle cx="180" cy="25"  r="12" stroke="#9333ea" strokeWidth="0.8" fill="none" opacity="0.5"/>
      <circle cx="155" cy="118" r="10" stroke={c}       strokeWidth="0.8" fill="none" opacity="0.4"/>
      <text x="27"  y="55"  fontSize="13" fill={c}       opacity="0.5"  fontFamily="monospace" fontWeight="bold">07</text>
      <text x="112" y="35"  fontSize="11" fill={c}       opacity="0.45" fontFamily="monospace" fontWeight="bold">23</text>
      <text x="178" y="85"  fontSize="15" fill={c}       opacity="0.45" fontFamily="monospace" fontWeight="bold">41</text>
      <text x="79"  y="115" fontSize="10" fill="#9333ea" opacity="0.45" fontFamily="monospace" fontWeight="bold">15</text>
      <line x1="0"   y1="70"  x2="220" y2="70"  stroke={c}       strokeWidth="0.3" opacity="0.2"/>
      <line x1="110" y1="0"   x2="110" y2="140" stroke="#9333ea" strokeWidth="0.3" opacity="0.15"/>
    </svg>
  );
}

function MobTowerSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <rect x="90" y="10" width="40"  height="8" rx="1" fill={c} opacity="0.3"/>
      <rect x="80" y="25" width="60"  height="8" rx="1" fill={c} opacity="0.25"/>
      <rect x="70" y="40" width="80"  height="8" rx="1" fill={c} opacity="0.2"/>
      <rect x="60" y="55" width="100" height="8" rx="1" fill={c} opacity="0.15"/>
      <rect x="50" y="70" width="120" height="8" rx="1" fill={c} opacity="0.1"/>
      <rect x="30"  y="0"  width="2"   height="140" fill={c} opacity="0.14"/>
      <rect x="185" y="0"  width="2"   height="140" fill={c} opacity="0.11"/>
      <rect x="108" y="85" width="1.5" height="55"  fill={c} opacity="0.22"/>
      <rect x="68"  y="115" width="1" height="25"   fill={c} opacity="0.15"/>
      <rect x="148" y="110" width="1" height="30"   fill={c} opacity="0.15"/>
      <rect x="0"   y="90" width="22" height="50"   fill={c} opacity="0.07"/>
      <rect x="196" y="80" width="24" height="60"   fill={c} opacity="0.07"/>
    </svg>
  );
}

function CasesSvg({ c }: { c: string }) {
  return (
    <svg viewBox="0 0 220 140" fill="none" style={{ width: "100%", height: "100%" }}>
      <rect x="20"  y="30" width="50" height="50" rx="2" stroke={c}       strokeWidth="1.2" fill={`${c}06`}/>
      <line x1="20" y1="55"  x2="70"  y2="55"  stroke={c} strokeWidth="0.5" opacity="0.4"/>
      <line x1="45" y1="30"  x2="45"  y2="80"  stroke={c} strokeWidth="0.5" opacity="0.4"/>
      <rect x="152" y="58" width="55" height="55" rx="2" stroke={c}       strokeWidth="1"   fill={`${c}05`}/>
      <line x1="152" y1="85"  x2="207" y2="85"  stroke={c} strokeWidth="0.5" opacity="0.35"/>
      <line x1="179" y1="58"  x2="179" y2="113" stroke={c} strokeWidth="0.5" opacity="0.35"/>
      <rect x="95"  y="18" width="36" height="36" stroke="#0891b2" strokeWidth="1"   fill="none" opacity="0.55"/>
      <rect x="105" y="28" width="36" height="36" stroke={c}       strokeWidth="0.8" fill="none" opacity="0.45"/>
      <line x1="95"  y1="18" x2="105" y2="28" stroke={c} strokeWidth="0.6" opacity="0.45"/>
      <line x1="131" y1="18" x2="141" y2="28" stroke={c} strokeWidth="0.6" opacity="0.45"/>
      <line x1="95"  y1="54" x2="105" y2="64" stroke={c} strokeWidth="0.6" opacity="0.45"/>
      <line x1="131" y1="54" x2="141" y2="64" stroke={c} strokeWidth="0.6" opacity="0.45"/>
      <line x1="5"   y1="0"  x2="55"  y2="140" stroke={c}       strokeWidth="0.9" opacity="0.13"/>
      <line x1="175" y1="0"  x2="225" y2="140" stroke="#0891b2" strokeWidth="0.9" opacity="0.1"/>
    </svg>
  );
}

function MiniGameBg({ theme, color }: { theme: string; color: string }) {
  const particles = MINI_PARTICLES[theme] ?? [];
  const ill =
    theme === "mines"     ? <MinesSvg c={color} />     :
    theme === "keno"      ? <KenoSvg c={color} />      :
    theme === "mob-tower" ? <MobTowerSvg c={color} />  :
    theme === "cases"     ? <CasesSvg c={color} />     : null;
  return (
    <>
      {/* Themed SVG illustration: blurred into soft glowing shapes */}
      {ill && (
        <div style={{ position: "absolute", inset: 0, opacity: 0.12, filter: "blur(9px)", pointerEvents: "none" }}>
          {ill}
        </div>
      )}
      {/* Radial depth glow */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `radial-gradient(ellipse 80% 60% at 50% 38%, ${color}1c 0%, transparent 70%)`,
      }} />
      {/* Subtle grid noise */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: `linear-gradient(${color}09 1px, transparent 1px), linear-gradient(90deg, ${color}09 1px, transparent 1px)`,
        backgroundSize: "8px 8px",
      }} />
      {/* Drifting particles */}
      {particles.map((p, i) => (
        <div key={i} className="mini-particle" style={{
          left: p.x, top: p.y, width: p.s, height: p.s,
          background: color, animationDelay: p.d, animationDuration: p.dur,
        }} />
      ))}
      {/* Top-edge shine sweep */}
      <div className="mini-border-shine" style={{ "--shine-c": color } as React.CSSProperties} />
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
