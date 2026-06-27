import { useEffect, useRef, useState } from "react";
import { Coins } from "lucide-react";

interface ActiveChipsDisplayProps {
  chips: number;
  label?: string;
}

// Smooth count-up animation using requestAnimationFrame
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
      // Ease-out cubic
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

export function ActiveChipsDisplay({ chips, label = "Chips" }: ActiveChipsDisplayProps) {
  const animated = useAnimatedNumber(chips);

  // Track whether chips just increased to show a brief glow burst
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
