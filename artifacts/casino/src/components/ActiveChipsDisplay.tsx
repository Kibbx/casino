import { useEffect, useRef, useState } from "react";
import { Coins, Star } from "lucide-react";

// ── Shared animation hook ─────────────────────────────────────────────────────

function useAnimatedNumber(target: number, durationMs = 900) {
  const [displayed, setDisplayed] = useState(target);
  const startRef  = useRef(target);
  const rafRef    = useRef<number | null>(null);

  useEffect(() => {
    if (startRef.current === target) return;

    const from      = startRef.current;
    const to        = target;
    const startTime = performance.now();

    startRef.current = target;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    function step(now: number) {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return displayed;
}

// ── Chips display ─────────────────────────────────────────────────────────────

interface ActiveChipsDisplayProps {
  chips: number;
  label?: string;
}

export function ActiveChipsDisplay({ chips, label = "Chips" }: ActiveChipsDisplayProps) {
  const animated = useAnimatedNumber(chips);

  const prevRef   = useRef(chips);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    if (chips > prevRef.current) {
      setGlowing(true);
      const t = setTimeout(() => setGlowing(false), 900);
      prevRef.current = chips;
      return () => clearTimeout(t);
    }
    prevRef.current = chips;
  }, [chips]);

  return (
    <div
      className="nav-pill nav-pill-gold"
      style={{
        transition: "box-shadow 0.3s ease",
        boxShadow: glowing ? "0 0 14px 4px rgba(245,197,24,0.55)" : undefined,
      }}
    >
      <Coins size={14} style={{ color: "#f5c518", flexShrink: 0 }} />
      <div className="flex flex-col items-start leading-none gap-[4px]">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.1em]"
          style={{ color: "rgba(245,197,24,0.5)" }}
        >
          {label}
        </span>
        <span
          className="text-[13px] font-black tabular-nums leading-none"
          style={{
            color:      "#f5c518",
            textShadow: glowing
              ? "0 0 18px rgba(245,197,24,0.95)"
              : "0 0 10px rgba(245,197,24,0.55)",
            transition: "text-shadow 0.3s ease",
          }}
        >
          {animated.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ── Reward Points display ─────────────────────────────────────────────────────

interface ActiveRPDisplayProps {
  rp: number;
}

export function ActiveRPDisplay({ rp }: ActiveRPDisplayProps) {
  const animated = useAnimatedNumber(rp);

  const prevRef   = useRef(rp);
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    if (rp > prevRef.current) {
      setGlowing(true);
      const t = setTimeout(() => setGlowing(false), 900);
      prevRef.current = rp;
      return () => clearTimeout(t);
    }
    prevRef.current = rp;
  }, [rp]);

  return (
    <div
      className="nav-pill"
      style={{
        background:   "rgba(167,139,250,0.07)",
        border:       `1px solid ${glowing ? "rgba(167,139,250,0.55)" : "rgba(167,139,250,0.18)"}`,
        transition:   "box-shadow 0.3s ease, border-color 0.3s ease",
        boxShadow:    glowing ? "0 0 14px 4px rgba(167,139,250,0.45)" : undefined,
      }}
    >
      <Star size={13} style={{ color: "#a78bfa", flexShrink: 0 }} />
      <div className="flex flex-col items-start leading-none gap-[4px]">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.1em]"
          style={{ color: "rgba(167,139,250,0.5)" }}
        >
          Reward Points
        </span>
        <span
          className="text-[13px] font-black tabular-nums leading-none"
          style={{
            color:      "#a78bfa",
            textShadow: glowing
              ? "0 0 18px rgba(167,139,250,0.95)"
              : "0 0 10px rgba(167,139,250,0.45)",
            transition: "text-shadow 0.3s ease",
          }}
        >
          {animated.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
