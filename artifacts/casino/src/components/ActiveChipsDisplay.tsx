import { Coins } from "lucide-react";

interface ActiveChipsDisplayProps {
  chips: number;
  label?: string;
}

export function ActiveChipsDisplay({ chips, label = "Chips" }: ActiveChipsDisplayProps) {
  const formatted = chips.toLocaleString();
  return (
    <div className="nav-pill nav-pill-gold">
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
          style={{ color: "#f5c518", textShadow: "0 0 10px rgba(245,197,24,0.55)" }}
        >
          {formatted}
        </span>
      </div>
    </div>
  );
}
