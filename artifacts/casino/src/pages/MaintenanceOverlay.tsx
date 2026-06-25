import { useEffect, useState } from "react";
import { Wrench, Zap, RefreshCw } from "lucide-react";

/* ── CSS injected once ──────────────────────────────────────────── */
const STYLE = `
@keyframes mnt-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes mnt-fadeout {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes mnt-rise {
  from { opacity: 0; transform: translateY(28px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)    scale(1);    }
}
@keyframes mnt-pulse-green {
  0%,100% { box-shadow: 0 0 40px 8px rgba(34,197,94,0.22),  0 0 90px 20px rgba(34,197,94,0.08);  }
  50%      { box-shadow: 0 0 65px 16px rgba(34,197,94,0.38), 0 0 130px 40px rgba(34,197,94,0.14); }
}
@keyframes mnt-spin {
  to { transform: rotate(360deg); }
}
@keyframes mnt-orbit {
  to { transform: rotate(360deg); }
}
@keyframes mnt-flicker {
  0%,100% { opacity: 1; }
  92%      { opacity: 1; }
  93%      { opacity: 0.4; }
  94%      { opacity: 1; }
  97%      { opacity: 0.7; }
  98%      { opacity: 1; }
}
@keyframes mnt-bar {
  0%   { width: 0%; }
  60%  { width: 72%; }
  80%  { width: 78%; }
  100% { width: 78%; }
}
@keyframes mnt-dot {
  0%,80%,100% { transform: scale(0.6); opacity: 0.35; }
  40%          { transform: scale(1);   opacity: 1;    }
}
.mnt-overlay {
  animation: mnt-fadein 0.6s ease both;
}
.mnt-modal {
  animation: mnt-rise 0.65s cubic-bezier(0.22,1,0.36,1) 0.1s both,
             mnt-pulse-green 3.2s ease-in-out 0.8s infinite;
}
.mnt-heading {
  animation: mnt-flicker 8s linear 2s infinite;
}
.mnt-spin { animation: mnt-spin 1.1s linear infinite; }
.mnt-orbit { animation: mnt-orbit 2.4s linear infinite; }
.mnt-bar-fill { animation: mnt-bar 3.5s cubic-bezier(0.4,0,0.2,1) 1s both; }
.mnt-dot-1 { animation: mnt-dot 1.4s ease-in-out 0s   infinite; }
.mnt-dot-2 { animation: mnt-dot 1.4s ease-in-out 0.2s infinite; }
.mnt-dot-3 { animation: mnt-dot 1.4s ease-in-out 0.4s infinite; }
`;

function injectStyle() {
  if (document.getElementById("mnt-style")) return;
  const el = document.createElement("style");
  el.id = "mnt-style";
  el.textContent = STYLE;
  document.head.appendChild(el);
}

/* ── Spinner ────────────────────────────────────────────────────── */
function NeonSpinner() {
  return (
    <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
      {/* Outer orbit ring */}
      <div className="mnt-orbit absolute inset-0 rounded-full"
        style={{ border: "2px solid transparent", borderTopColor: "#a855f7", borderRightColor: "#a855f7", opacity: 0.6 }} />
      {/* Inner spinner */}
      <div className="mnt-spin absolute rounded-full"
        style={{ inset: 8, border: "2.5px solid rgba(34,197,94,0.15)", borderTopColor: "#22c55e", borderLeftColor: "#22c55e", boxShadow: "0 0 12px rgba(34,197,94,0.6), inset 0 0 8px rgba(34,197,94,0.2)" }} />
      {/* Centre icon */}
      <Wrench size={18} style={{ color: "#22c55e", filter: "drop-shadow(0 0 6px rgba(34,197,94,0.9))", zIndex: 1 }} />
    </div>
  );
}

/* ── Dot loader ─────────────────────────────────────────────────── */
function DotLoader() {
  return (
    <div className="flex items-center gap-1.5">
      {["mnt-dot-1","mnt-dot-2","mnt-dot-3"].map(c => (
        <span key={c} className={`${c} inline-block w-1.5 h-1.5 rounded-full`}
          style={{ background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.8)" }} />
      ))}
    </div>
  );
}

/* ── Progress bar (mock) ────────────────────────────────────────── */
function ProgressBar() {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
      <div className="mnt-bar-fill h-full rounded-full"
        style={{ background: "linear-gradient(90deg,#22c55e,#06b6d4)", boxShadow: "0 0 8px rgba(34,197,94,0.6)", width: 0 }} />
    </div>
  );
}

/* ── System status rows ─────────────────────────────────────────── */
const STATUS_ROWS = [
  { label: "Core marketplace",   color: "#f97316", status: "Upgrading"  },
  { label: "Listing engine",     color: "#f5c518", status: "Offline"    },
  { label: "Auction service",    color: "#f97316", status: "Upgrading"  },
  { label: "Payment gateway",    color: "#22c55e", status: "Online"     },
  { label: "Shop profiles",      color: "#f97316", status: "Upgrading"  },
  { label: "Trade matching",     color: "#06b6d4", status: "Standby"    },
];

function StatusRow({ label, color, status }: { label: string; color: string; status: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.38)" }}>{label}</span>
      <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide" style={{ color }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
        {status}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MaintenanceOverlay
   ═══════════════════════════════════════════════════════════════ */
interface Props {
  onBackdropClick: () => void;
  fading?: boolean;
}

export function MaintenanceOverlay({ onBackdropClick, fading = false }: Props) {
  const [tick, setTick]   = useState(0);

  useEffect(() => {
    injectStyle();
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const mins = Math.max(0, 58 - tick);
  const eta  = mins > 0 ? `~${mins}m remaining` : "Almost done…";

  return (
    <div
      className={fading ? "mnt-overlay fixed inset-0 flex items-center justify-center z-[200] px-4" : "mnt-overlay fixed inset-0 flex items-center justify-center z-[200] px-4"}
      title="Click to go to Casino Dashboard"
      onClick={onBackdropClick}
      style={{
        backdropFilter:       "blur(20px) saturate(0.6)",
        WebkitBackdropFilter: "blur(20px) saturate(0.6)",
        background:           "rgba(0,0,0,0.78)",
        pointerEvents:        "all",
        cursor:               "pointer",
        animation:            fading
          ? "mnt-fadeout 0.45s ease forwards"
          : "mnt-fadein 0.6s ease both",
      }}
    >
      {/* Ambient glow blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div style={{ position:"absolute", top:"15%", left:"10%",  width:500, height:400, background:"radial-gradient(ellipse,rgba(34,197,94,0.06) 0%,transparent 70%)", filter:"blur(60px)" }} />
        <div style={{ position:"absolute", bottom:"10%", right:"8%", width:420, height:350, background:"radial-gradient(ellipse,rgba(168,85,247,0.07) 0%,transparent 70%)", filter:"blur(60px)" }} />
        <div style={{ position:"absolute", top:"40%", right:"20%", width:300, height:280, background:"radial-gradient(ellipse,rgba(6,182,212,0.05) 0%,transparent 70%)", filter:"blur(50px)" }} />
      </div>

      {/* Modal panel — stops propagation so clicking the modal doesn't trigger redirect */}
      <div
        className="mnt-modal relative w-full flex flex-col items-center text-center rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: 520,
          cursor:   "default",
          background: "linear-gradient(145deg,#0a0808 0%,#0d0b0b 60%,#0a0c0a 100%)",
          border: "1px solid rgba(34,197,94,0.22)",
        }}
      >
        {/* Top accent bar */}
        <div className="w-full h-[2px]" style={{ background: "linear-gradient(90deg,transparent,#22c55e,#06b6d4,#a855f7,transparent)" }} />

        {/* Scan-line texture */}
        <div className="absolute inset-0 pointer-events-none rounded-2xl"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,0.012) 3px,rgba(255,255,255,0.012) 4px)" }} />

        <div className="relative z-10 w-full px-8 pt-10 pb-8 flex flex-col items-center gap-6">

          {/* Spinner */}
          <NeonSpinner />

          {/* Heading */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={12} style={{ color: "#f97316", filter: "drop-shadow(0 0 4px #f97316)" }} />
              <span className="text-[9px] font-black uppercase tracking-[0.2em]"
                style={{ color: "#f97316", letterSpacing: "0.25em" }}>System Notice</span>
              <Zap size={12} style={{ color: "#f97316", filter: "drop-shadow(0 0 4px #f97316)" }} />
            </div>
            <h1
              className="mnt-heading font-orbitron font-black uppercase leading-none"
              style={{
                fontSize: "clamp(1.5rem, 5vw, 2rem)",
                letterSpacing: "0.08em",
                color: "#22c55e",
                textShadow: "0 0 18px rgba(34,197,94,0.7), 0 0 40px rgba(34,197,94,0.35)",
              }}
            >
              Under<br />Maintenance
            </h1>
          </div>

          {/* Subheading */}
          <p className="text-[13px] leading-relaxed max-w-[360px]"
            style={{ color: "rgba(255,255,255,0.52)", letterSpacing: "0.01em" }}>
            We're upgrading the marketplace experience.<br />
            <span style={{ color: "rgba(255,255,255,0.75)" }}>Please check back shortly.</span>
          </p>

          {/* Progress bar */}
          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest font-black"
                style={{ color: "rgba(255,255,255,0.28)" }}>Upgrade progress</span>
              <div className="flex items-center gap-1.5">
                <DotLoader />
              </div>
            </div>
            <ProgressBar />
          </div>

          {/* ETA pill */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-full"
            style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)" }}>
            <RefreshCw size={11} className="mnt-spin" style={{ color: "#22c55e" }} />
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#22c55e" }}>
              Estimated downtime: &lt; 1 hour
            </span>
            <span className="text-[10px]" style={{ color: "rgba(34,197,94,0.55)" }}>· {eta}</span>
          </div>

          {/* Divider */}
          <div className="w-full h-px" style={{ background: "rgba(255,255,255,0.06)" }} />

          {/* System status */}
          <div className="w-full flex flex-col gap-2.5">
            <span className="text-[9px] uppercase tracking-[0.18em] font-black self-start"
              style={{ color: "rgba(255,255,255,0.25)" }}>System Status</span>
            {STATUS_ROWS.map(r => <StatusRow key={r.label} {...r} />)}
          </div>

          {/* Footer note */}
          <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
            Casino games are unaffected. Marketplace will resume automatically.
          </p>

        </div>

        {/* Bottom accent bar */}
        <div className="w-full h-[2px]" style={{ background: "linear-gradient(90deg,transparent,#a855f7,#06b6d4,#22c55e,transparent)" }} />
      </div>
    </div>
  );
}
