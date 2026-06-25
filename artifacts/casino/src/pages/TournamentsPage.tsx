import { useState } from "react";
import { PageWrapper, CardGrid } from "./shared";

interface Tournament {
  id: number; name: string; type: string;
  buyin: string; prize: string; registered: number; max: number;
  starts: string; duration: string;
  neonColor: string; status?: string; badge?: string; badgeColor?: string;
}

const tournaments: Tournament[] = [
  {
    id: 1, name: "Daily Qualifier", type: "Freeroll Entry",
    buyin: "$10", prize: "$2,500", registered: 87, max: 200,
    starts: "Today 8:00 PM", duration: "~2 hrs",
    neonColor: "#22c55e", status: "OPEN",
  },
  {
    id: 2, name: "Weekend Warrior", type: "Re-Entry",
    buyin: "$50", prize: "$15,000", registered: 142, max: 300,
    starts: "Sat 3:00 PM", duration: "~6 hrs",
    neonColor: "#06b6d4", status: "OPEN",
  },
  {
    id: 3, name: "The Gauntlet", type: "Freezeout",
    buyin: "$100", prize: "$40,000", registered: 63, max: 150,
    starts: "Sun 12:00 PM", duration: "~8 hrs",
    neonColor: "#f97316", badge: "FEATURED",
    badgeColor: "#e8400a",
  },
  {
    id: 4, name: "Monthly Championship", type: "Knockout",
    buyin: "$200", prize: "$120,000", registered: 201, max: 500,
    starts: "Jun 30 6:00 PM", duration: "~10 hrs",
    neonColor: "#f5c518", status: "OPEN", badge: "BIG",
    badgeColor: "#7c3aed",
  },
  {
    id: 5, name: "Nightly Turbo", type: "Turbo",
    buyin: "$25", prize: "$5,000", registered: 44, max: 100,
    starts: "Tonight 10:00 PM", duration: "~1.5 hrs",
    neonColor: "#ec4899", status: "LATE REG",
  },
  {
    id: 6, name: "Free Roll Friday", type: "Freeroll",
    buyin: "FREE", prize: "$1,000", registered: 388, max: 500,
    starts: "Fri 7:00 PM", duration: "~3 hrs",
    neonColor: "#14b8a6", status: "OPEN",
  },
];

function TourneyCard({ t }: { t: Tournament }) {
  const [hov, setHov] = useState(false);
  const pct = Math.round((t.registered / t.max) * 100);
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "#0c0a0a",
        border: `1px solid ${t.neonColor}33`,
        boxShadow: hov ? `0 0 20px ${t.neonColor}22` : "none",
        transition: "box-shadow 0.2s",
        width: 280,
        minWidth: 260,
        flexShrink: 0,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {/* Header stripe */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${t.neonColor}22`, background: `${t.neonColor}08` }}
      >
        <span className="font-rajdhani font-black text-sm uppercase tracking-wider text-white">
          {t.name}
        </span>
        <div className="flex gap-1.5">
          {t.badge && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase" style={{ background: t.badgeColor ?? t.neonColor, color: "#fff" }}>
              {t.badge}
            </span>
          )}
          {t.status && (
            <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase" style={{ color: t.neonColor, background: `${t.neonColor}22`, border: `1px solid ${t.neonColor}44` }}>
              {t.status}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          {[
            ["Buy-in", t.buyin],
            ["Prize Pool", t.prize],
            ["Starts", t.starts],
            ["Duration", t.duration],
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-[9px] uppercase tracking-widest mb-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>{label}</p>
              <p className="text-[12px] font-bold" style={{ color: "rgba(255,255,255,0.80)" }}>{val}</p>
            </div>
          ))}
        </div>

        {/* Registration bar */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{t.type}</span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{t.registered}/{t.max} registered</span>
          </div>
          <div className="rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: t.neonColor, boxShadow: `0 0 6px ${t.neonColor}` }} />
          </div>
        </div>

        <button
          className="w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all duration-150"
          style={{
            background: hov ? t.neonColor : "transparent",
            color: hov ? "#060404" : t.neonColor,
            border: `1px solid ${t.neonColor}55`,
            boxShadow: hov ? `0 0 16px ${t.neonColor}55` : "none",
          }}
        >
          Register Now
        </button>
      </div>
    </div>
  );
}

export function TournamentsPage() {
  return (
    <PageWrapper title="Tournaments" breadcrumb="Events / Tournaments" accentColor="#f97316">
      <CardGrid minItemWidth={260} maxItemWidth={300} gap={20}>
        {tournaments.map((t) => (
          <TourneyCard key={t.id} t={t} />
        ))}
      </CardGrid>
    </PageWrapper>
  );
}
