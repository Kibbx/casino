import { type ReactNode } from "react";
import { getRarity } from "../../config/rarityConfig";
import { spriteCanvasWidth } from "../../config/horseSprites";

export type EffectType =
  | "none"
  | "glow"
  | "outline"
  | "dust"
  | "sparkles"
  | "fire"
  | "speed"
  | "poison"
  | "rainbow"
  | "ghost"
  | "neon"
  | "void"
  | "gold"
  | "wind"
  | "comet"
  | "mud"
  | "stars"
  | "holy"
  | "blizzard"
  | "crystal"
  | "venom"
  | "meteor"
  | "blood"
  | "plague";

export const EFFECT_OPTIONS: { value: EffectType; label: string }[] = [
  { value: "none",      label: "None"            },
  { value: "glow",      label: "Glow"            },
  { value: "outline",   label: "Outline"         },
  { value: "dust",      label: "Dust Trail"      },
  { value: "sparkles",  label: "Sparkles"        },
  { value: "fire",      label: "Fire Trail"      },
  { value: "speed",     label: "Speed Streaks"   },
  { value: "poison",    label: "Poison Bubbles"  },
  { value: "rainbow",   label: "Rainbow Aura"    },
  { value: "ghost",     label: "Ghost Horse"     },
  { value: "neon",      label: "Neon Pulse"      },
  { value: "void",      label: "Void Swirl"      },
  { value: "gold",      label: "Gold Trail"      },
  { value: "wind",      label: "Wind Streaks"    },
  { value: "comet",     label: "Comet Tail"      },
  { value: "mud",       label: "Mud Kick"        },
  { value: "stars",     label: "Star Trail"      },
  { value: "holy",      label: "Holy Light"      },
  { value: "blizzard",  label: "Blizzard"        },
  { value: "crystal",   label: "Crystal Shards"  },
  { value: "venom",     label: "Venom Drip"      },
  { value: "meteor",    label: "Meteor Rain"     },
  { value: "blood",     label: "Blood Trail"     },
  { value: "plague",    label: "Plague Miasma"   },
];

interface Props {
  effect: EffectType;
  glowColor?: string | null;
  outlineColor?: string | null;
  rarity?: string;
  size: number;
  spriteKey?: string | null;
  children: ReactNode;
}

export function HorseEffectLayer({
  effect,
  glowColor,
  outlineColor,
  rarity = "common",
  size,
  spriteKey,
  children,
}: Props) {
  const rarityDef = getRarity(rarity);
  const activeGlow = glowColor || rarityDef.glow?.replace(/[0-9a-f]{2}$/i, "") || null;

  const canvasW = spriteCanvasWidth(spriteKey, size);
  const canvasH = size;

  // Filter applied directly to the horse sprite
  let filterStyle = "";
  let childAnimation: string | undefined;

  if (effect === "glow" && activeGlow) {
    filterStyle = `drop-shadow(0 0 6px ${activeGlow}) drop-shadow(0 0 14px ${activeGlow}88)`;
  } else if (effect === "outline" && outlineColor) {
    filterStyle = [
      `drop-shadow(1px 0px 0px ${outlineColor})`,
      `drop-shadow(-1px 0px 0px ${outlineColor})`,
      `drop-shadow(0px 1px 0px ${outlineColor})`,
      `drop-shadow(0px -1px 0px ${outlineColor})`,
    ].join(" ");
  } else if (effect === "neon") {
    const c = activeGlow || "#f0abfc";
    filterStyle = `drop-shadow(0 0 4px ${c}) drop-shadow(0 0 10px ${c}) drop-shadow(0 0 20px ${c}88)`;
    childAnimation = "horseNeon 0.8s ease-in-out infinite alternate";
  } else if (effect === "rainbow") {
    childAnimation = "horseRainbow 2s linear infinite";
  } else if (effect === "ghost") {
    filterStyle = "brightness(1.9) saturate(0.15) opacity(0.62) drop-shadow(0 0 8px #bae6fd99)";
    childAnimation = "horseGhostPulse 2s ease-in-out infinite alternate";
  } else if (effect === "blizzard") {
    filterStyle = `drop-shadow(0 0 6px #bae6fd) drop-shadow(0 0 14px #93c5fd88)`;
    childAnimation = "horseBlizzardShiver 0.12s ease-in-out infinite alternate";
  } else if (effect === "crystal") {
    filterStyle = `drop-shadow(0 0 6px ${activeGlow || "#a5f3fc"}) drop-shadow(0 0 12px ${activeGlow || "#67e8f9"}88)`;
    childAnimation = "horseCrystalPulse 1.8s ease-in-out infinite alternate";
  } else if (effect === "venom") {
    filterStyle = `drop-shadow(0 0 6px #4ade80) drop-shadow(0 0 12px #22c55e88)`;
  } else if (effect === "meteor") {
    filterStyle = `drop-shadow(0 0 8px #fb923c) drop-shadow(0 0 16px #f9731644)`;
  } else if (effect === "blood") {
    filterStyle = `drop-shadow(0 0 8px #dc262688) drop-shadow(0 0 14px #b91c1c66)`;
    childAnimation = "horseShadowPulse 1.6s ease-in-out infinite alternate";
  } else if (effect === "plague") {
    filterStyle = `drop-shadow(0 0 6px #65a30d88) drop-shadow(0 0 12px #4d7c0f44) saturate(0.7) brightness(0.88)`;
    childAnimation = "horsePlagueWaver 2.5s ease-in-out infinite alternate";
  } else if (rarityDef.autoEffect === "glow" && activeGlow) {
    filterStyle = `drop-shadow(0 0 5px ${activeGlow}) drop-shadow(0 0 10px ${activeGlow}66)`;
  } else if (rarityDef.autoEffect === "outline") {
    const c = rarityDef.color;
    filterStyle = [
      `drop-shadow(1px 0px 0px ${c})`,
      `drop-shadow(-1px 0px 0px ${c})`,
      `drop-shadow(0px 1px 0px ${c})`,
      `drop-shadow(0px -1px 0px ${c})`,
    ].join(" ");
  }

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: canvasW, height: canvasH }}
    >
      {effect === "fire"      && <FireEffect      width={canvasW} height={canvasH} color={glowColor} />}
      {effect === "dust"      && <DustEffect      width={canvasW} height={canvasH} />}
      {effect === "speed"     && <SpeedEffect     width={canvasW} height={canvasH} />}
      {effect === "poison"    && <PoisonEffect    width={canvasW} height={canvasH} />}
      {effect === "ghost"     && <GhostAura       width={canvasW} height={canvasH} />}
      {effect === "void"      && <VoidEffect      width={canvasW} height={canvasH} />}
      {effect === "gold"      && <GoldTrail       width={canvasW} height={canvasH} color={activeGlow || "#fbbf24"} />}
      {effect === "wind"      && <WindEffect      width={canvasW} height={canvasH} />}
      {effect === "comet"     && <CometEffect     width={canvasW} height={canvasH} color={activeGlow || "#f8fafc"} />}
      {effect === "mud"       && <MudEffect       width={canvasW} height={canvasH} />}
      {effect === "stars"     && <StarTrail       width={canvasW} height={canvasH} color={activeGlow || "#fbbf24"} />}
      {effect === "holy"      && <HolyEffect      width={canvasW} height={canvasH} />}
      {effect === "blizzard"  && <BlizzardEffect  width={canvasW} height={canvasH} />}
      {effect === "crystal"   && <CrystalEffect   width={canvasW} height={canvasH} color={activeGlow || "#a5f3fc"} />}
      {effect === "venom"     && <VenomEffect     width={canvasW} height={canvasH} />}
      {effect === "meteor"    && <MeteorEffect    width={canvasW} height={canvasH} />}
      {effect === "blood"     && <BloodEffect     width={canvasW} height={canvasH} />}
      {effect === "plague"    && <PlagueEffect    width={canvasW} height={canvasH} />}
      {(effect === "sparkles" || rarityDef.hasParticles) && (
        <SparkleEffect width={canvasW} height={canvasH} color={activeGlow || "#fbbf24"} />
      )}
      {rarityDef.hasTrail && effect === "none" && (
        <TrailEffect width={canvasW} height={canvasH} color={rarityDef.color} />
      )}

      <div
        className="relative z-10 flex items-center justify-center"
        style={{
          filter: filterStyle || undefined,
          animation: childAnimation,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ── Effect sub-components ─────────────────────────────────────────────────────

// Fire trail — embers and flames behind (left of) the horse
function FireEffect({ width, height, color }: { width: number; height: number; color?: string | null }) {
  const base = color || "#f97316";
  return (
    <div className="absolute inset-0 z-0 pointer-events-none" style={{ overflow: "visible" }}>
      {/* Flame tongues concentrated at the rear of the horse */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${i * 7}%`,
            bottom: `${3 + (i % 3) * 5}%`,
            width: `${7 + (i % 2) * 5}px`,
            height: `${12 + (i % 3) * 9}px`,
            background: `radial-gradient(ellipse at top, ${base}ee, #ef4444bb, transparent 80%)`,
            borderRadius: "50% 50% 0 0",
            opacity: 0.92 - i * 0.06,
            animation: `horseFireTrail ${0.42 + (i % 3) * 0.14}s ease-out ${i * 0.08}s infinite`,
          }}
        />
      ))}
      {/* Flying embers */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={`e${i}`}
          style={{
            position: "absolute",
            left: `${2 + (i % 4) * 9}%`,
            bottom: `${14 + (i % 3) * 16}%`,
            width: "3px",
            height: "3px",
            borderRadius: "50%",
            background: base,
            boxShadow: `0 0 4px ${base}`,
            animation: `horseFireEmber ${0.5 + i * 0.11}s ease-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// Dust trail — particles drift LEFT (behind the running horse)
function DustEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-0 pointer-events-none overflow-hidden" style={{ height: height * 0.35 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute bottom-1 rounded-full bg-amber-900"
          style={{
            left: `${5 + i * 22}%`,
            width: `${Math.round(width * 0.08) + i * 4}px`,
            height: `${Math.round(height * 0.09) + i * 2}px`,
            animation: `horseDust ${0.6 + i * 0.15}s ease-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function SpeedEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="absolute bg-white/20 rounded-full"
          style={{
            left: 0,
            top: `${20 + i * 18}%`,
            width: `${Math.round(width * 0.4) - i * 8}px`,
            height: "2px",
            animation: `horseSpeed ${0.4 + i * 0.1}s linear ${i * 0.08}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function SparkleEffect({ width, height, color }: { width: number; height: number; color: string }) {
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${3 + (i % 3)}px`,
            height: `${3 + (i % 3)}px`,
            background: color,
            left: `${8 + i * 16}%`,
            top: `${15 + (i % 3) * 25}%`,
            animation: `horseSparkle ${0.8 + i * 0.25}s ease-out ${i * 0.2}s infinite`,
            boxShadow: `0 0 4px ${color}`,
          }}
        />
      ))}
    </div>
  );
}

function TrailEffect({ width, height, color }: { width: number; height: number; color: string }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute bottom-1/4 rounded-full"
          style={{
            left: `${5 + i * 15}%`,
            width: `${Math.round(width * 0.06) + i * 2}px`,
            height: `${Math.round(height * 0.1) + i * 2}px`,
            background: color,
            opacity: 0.4 - i * 0.1,
            animation: `horseTrail ${0.7 + i * 0.2}s ease-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function PoisonEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${4 + (i % 3) * 2}px`,
            height: `${4 + (i % 3) * 2}px`,
            background: `radial-gradient(circle, #86efac, #4ade8088)`,
            left: `${10 + i * 18}%`,
            bottom: `${5 + (i % 3) * 10}%`,
            animation: `horsePoison ${0.9 + i * 0.22}s ease-out ${i * 0.18}s infinite`,
            boxShadow: `0 0 6px #4ade80`,
          }}
        />
      ))}
      <div
        className="absolute bottom-0 left-0 right-0"
        style={{ height: "35%", background: "linear-gradient(to top, #4ade8022, transparent)" }}
      />
    </div>
  );
}

// Ghost aura — subtle ethereal wisps around the horse (filter on sprite handles the look)
function GhostAura({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      {/* Ethereal wisp particles */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${Math.round(width * 0.14)}px`,
            height: `${Math.round(height * 0.14)}px`,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(186,230,253,0.35), transparent)",
            left: `${8 + i * 24}%`,
            top: `${10 + (i % 3) * 24}%`,
            filter: "blur(3px)",
            animation: `horseGhost ${1.1 + i * 0.4}s ease-in-out ${i * 0.3}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

function VoidEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, #4c1d9544 0%, #1e1b4b22 50%, transparent 70%)",
          animation: "horseVoid 1.6s ease-in-out infinite alternate",
        }}
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: `${3 + (i % 3) * 2}px`,
            height: `${3 + (i % 3) * 2}px`,
            background: `radial-gradient(circle, #a78bfa, #6d28d9)`,
            left: `${8 + i * 20}%`,
            top: `${10 + (i % 4) * 20}%`,
            animation: `horseSparkle ${1 + i * 0.3}s ease-out ${i * 0.22}s infinite`,
            boxShadow: "0 0 6px #7c3aed",
          }}
        />
      ))}
      {[0, 1].map((i) => (
        <div
          key={`r${i}`}
          className="absolute inset-0 rounded-full"
          style={{
            border: `1px solid #7c3aed${i === 0 ? "55" : "33"}`,
            animation: `horseVoidRing ${1.2 + i * 0.6}s ease-out ${i * 0.4}s infinite`,
            transform: "scale(0.6)",
          }}
        />
      ))}
    </div>
  );
}

// Gold Trail — warm golden particles drifting up and back from the horse
function GoldTrail({ width, height, color }: { width: number; height: number; color: string }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-visible">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${3 + (i % 3) * 2}px`,
            height: `${3 + (i % 3) * 2}px`,
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 5px ${color}, 0 0 10px ${color}88`,
            left: `${3 + (i % 4) * 12}%`,
            bottom: `${8 + (i % 3) * 18}%`,
            animation: `horseGold ${0.9 + i * 0.18}s ease-out ${i * 0.14}s infinite`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at 30% 60%, ${color}18 0%, transparent 65%)`,
          animation: "horseGoldPulse 1.8s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}

// Wind Streaks — clean horizontal streaks flowing left at different heights
function WindEffect({ width, height }: { width: number; height: number }) {
  const lines = [
    { top: 18, w: 55, opacity: 0.4, dur: 0.5, delay: 0    },
    { top: 32, w: 38, opacity: 0.3, dur: 0.6, delay: 0.12 },
    { top: 47, w: 65, opacity: 0.45,dur: 0.45,delay: 0.05 },
    { top: 62, w: 42, opacity: 0.3, dur: 0.55,delay: 0.2  },
    { top: 76, w: 30, opacity: 0.25,dur: 0.65,delay: 0.08 },
  ];
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {lines.map((l, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            top: `${l.top}%`,
            width: `${Math.round(width * l.w / 100)}px`,
            height: "1.5px",
            borderRadius: "2px",
            background: `linear-gradient(90deg, transparent, rgba(226,232,240,${l.opacity}), rgba(226,232,240,${l.opacity * 0.6}), transparent)`,
            animation: `horseWind ${l.dur}s ease-out ${l.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// Comet Tail — a glowing horizontal light streak trailing behind the horse
function CometEffect({ width, height, color }: { width: number; height: number; color: string }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none" style={{ overflow: "visible" }}>
      {/* Main comet tail */}
      <div
        style={{
          position: "absolute",
          left: `-${Math.round(width * 0.7)}px`,
          top: "38%",
          width: `${Math.round(width * 0.9)}px`,
          height: `${Math.round(height * 0.12)}px`,
          borderRadius: "50%",
          background: `linear-gradient(90deg, transparent, ${color}44, ${color}bb, ${color})`,
          filter: `blur(3px)`,
          animation: "horseCometPulse 1.2s ease-in-out infinite alternate",
        }}
      />
      {/* Core bright streak */}
      <div
        style={{
          position: "absolute",
          left: `-${Math.round(width * 0.5)}px`,
          top: "42%",
          width: `${Math.round(width * 0.65)}px`,
          height: "3px",
          borderRadius: "2px",
          background: `linear-gradient(90deg, transparent, ${color}cc, ${color})`,
          animation: "horseCometPulse 1.2s ease-in-out 0.1s infinite alternate",
        }}
      />
      {/* Debris sparks */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: "3px",
            height: "3px",
            borderRadius: "50%",
            background: color,
            boxShadow: `0 0 4px ${color}`,
            left: `${(i + 1) * 10}%`,
            top: `${35 + (i % 3) * 10}%`,
            animation: `horseSparkle ${0.7 + i * 0.2}s ease-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// Mud Kick — earthy brown clumps kicking up from hooves, arcing left
function MudEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none" style={{ overflow: "visible" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${5 + (i % 3) * 4}px`,
            height: `${4 + (i % 3) * 3}px`,
            borderRadius: "50% 40% 60% 30%",
            background: `radial-gradient(ellipse, #92400e, #78350f)`,
            left: `${5 + (i % 4) * 14}%`,
            bottom: `${4 + (i % 2) * 8}%`,
            animation: `horseMud ${0.55 + i * 0.1}s ease-out ${i * 0.12}s infinite`,
            opacity: 0.85,
          }}
        />
      ))}
      {/* Small dirt scatter */}
      {[0, 1, 2].map((i) => (
        <div
          key={`s${i}`}
          style={{
            position: "absolute",
            width: "3px",
            height: "3px",
            borderRadius: "50%",
            background: "#a16207",
            left: `${8 + i * 12}%`,
            bottom: `${12 + (i % 2) * 12}%`,
            animation: `horseMudScatter ${0.45 + i * 0.12}s ease-out ${0.05 + i * 0.1}s infinite`,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}

// Star Trail — glowing stars drifting upward off the horse body
function StarTrail({ width, height, color }: { width: number; height: number; color: string }) {
  const stars = [
    { left: 12, bottom: 45, size: 9,  dur: 1.1,  delay: 0    },
    { left: 28, bottom: 30, size: 7,  dur: 1.3,  delay: 0.25 },
    { left: 50, bottom: 55, size: 10, dur: 1.0,  delay: 0.1  },
    { left: 68, bottom: 35, size: 7,  dur: 1.2,  delay: 0.4  },
    { left: 82, bottom: 50, size: 8,  dur: 0.95, delay: 0.15 },
    { left: 38, bottom: 65, size: 6,  dur: 1.4,  delay: 0.35 },
  ];
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-visible">
      {stars.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${s.left}%`,
            bottom: `${s.bottom}%`,
            fontSize: `${s.size}px`,
            lineHeight: 1,
            color,
            textShadow: `0 0 6px ${color}, 0 0 12px ${color}88`,
            animation: `horseStar ${s.dur}s ease-out ${s.delay}s infinite`,
            userSelect: "none",
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}

// Holy Light — golden light shafts descending from above with a soft halo
function HolyEffect({ width, height }: { width: number; height: number }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      <div
        style={{
          position: "absolute",
          left: "15%",
          top: "-12%",
          width: "70%",
          height: `${Math.round(height * 0.18)}px`,
          borderRadius: "50%",
          border: "2px solid rgba(253,224,71,0.55)",
          boxShadow: "0 0 10px rgba(253,224,71,0.35), inset 0 0 6px rgba(253,224,71,0.2)",
          animation: "horseHaloGlow 1.6s ease-in-out infinite alternate",
        }}
      />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${15 + i * 22}%`,
            top: 0,
            width: `${6 + (i % 2) * 4}px`,
            height: "55%",
            background: `linear-gradient(to bottom, rgba(253,224,71,0.35), rgba(253,224,71,0.12), transparent)`,
            borderRadius: "0 0 50% 50%",
            animation: `horseHoly ${1.2 + i * 0.3}s ease-in-out ${i * 0.2}s infinite alternate`,
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 50% 0%, rgba(253,224,71,0.14) 0%, transparent 60%)",
          animation: "horseHaloGlow 2s ease-in-out infinite alternate",
        }}
      />
    </div>
  );
}

// Blizzard — swirling ice crystals and snow particles
function BlizzardEffect({ width, height }: { width: number; height: number }) {
  const flakes = [
    { left: 10, top: 12, size: 5, dur: 0.9, delay: 0    },
    { left: 28, top: 30, size: 4, dur: 1.1, delay: 0.15 },
    { left: 50, top: 8,  size: 6, dur: 0.8, delay: 0.05 },
    { left: 68, top: 45, size: 4, dur: 1.0, delay: 0.3  },
    { left: 82, top: 20, size: 5, dur: 0.95,delay: 0.2  },
    { left: 38, top: 60, size: 3, dur: 1.2, delay: 0.4  },
    { left: 15, top: 70, size: 4, dur: 1.05,delay: 0.1  },
    { left: 60, top: 55, size: 5, dur: 0.85,delay: 0.35 },
  ];
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
      {/* Icy ground shimmer */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "25%",
        background: "linear-gradient(to top, rgba(186,230,253,0.18), transparent)",
      }} />
      {flakes.map((f, i) => (
        <div key={i} style={{
          position: "absolute",
          left: `${f.left}%`,
          top: `${f.top}%`,
          width: `${f.size}px`,
          height: `${f.size}px`,
          borderRadius: "50%",
          background: "radial-gradient(circle, #e0f2fe, #bae6fd)",
          boxShadow: "0 0 4px #bae6fd, 0 0 8px #93c5fd88",
          animation: `horseBlizzardFlake ${f.dur}s ease-in-out ${f.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// Crystal Shards — prismatic fragments orbiting the horse
function CrystalEffect({ width, height, color }: { width: number; height: number; color: string }) {
  const shards = [
    { left: 5,  top: 20, rotate: 30,  size: 7, dur: 1.4, delay: 0    },
    { left: 85, top: 15, rotate: -45, size: 6, dur: 1.2, delay: 0.3  },
    { left: 15, top: 70, rotate: 60,  size: 8, dur: 1.6, delay: 0.1  },
    { left: 78, top: 65, rotate: -20, size: 6, dur: 1.3, delay: 0.5  },
    { left: 50, top: 5,  rotate: 15,  size: 7, dur: 1.5, delay: 0.2  },
    { left: 90, top: 42, rotate: 75,  size: 5, dur: 1.1, delay: 0.4  },
  ];
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-visible">
      {shards.map((s, i) => (
        <div key={i} style={{
          position: "absolute",
          left: `${s.left}%`,
          top: `${s.top}%`,
          width: `${s.size}px`,
          height: `${s.size * 1.6}px`,
          background: `linear-gradient(135deg, ${color}cc, ${color}44, rgba(255,255,255,0.6))`,
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
          transform: `rotate(${s.rotate}deg)`,
          boxShadow: `0 0 6px ${color}, 0 0 12px ${color}66`,
          animation: `horseCrystalShard ${s.dur}s ease-in-out ${s.delay}s infinite alternate`,
        }} />
      ))}
    </div>
  );
}

// Venom Drip — bright green acid droplets falling from the horse
function VenomEffect({ width, height }: { width: number; height: number }) {
  const drops = [
    { left: 18, dur: 0.8, delay: 0,    size: 5 },
    { left: 35, dur: 1.0, delay: 0.25, size: 4 },
    { left: 55, dur: 0.75,delay: 0.1,  size: 6 },
    { left: 70, dur: 0.9, delay: 0.4,  size: 4 },
    { left: 85, dur: 0.85,delay: 0.18, size: 5 },
  ];
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Toxic ground pool */}
      <div style={{
        position: "absolute", bottom: 0, left: "5%", right: "5%",
        height: "12%",
        background: "radial-gradient(ellipse at center, rgba(74,222,128,0.28) 0%, rgba(34,197,94,0.12) 60%, transparent 100%)",
        borderRadius: "50%",
        animation: "horsePlagueWaver 2s ease-in-out infinite alternate",
      }} />
      {drops.map((d, i) => (
        <div key={i} style={{
          position: "absolute",
          left: `${d.left}%`,
          top: "30%",
          width: `${d.size}px`,
          height: `${d.size * 1.4}px`,
          borderRadius: "50% 50% 60% 60%",
          background: "radial-gradient(ellipse at top, #86efac, #4ade80)",
          boxShadow: "0 0 6px #4ade80, 0 0 12px #22c55e88",
          animation: `horseVenomDrop ${d.dur}s ease-in ${d.delay}s infinite`,
        }} />
      ))}
    </div>
  );
}

// Meteor Rain — small fiery rocks raining down on the horse
function MeteorEffect({ width, height }: { width: number; height: number }) {
  const meteors = [
    { left: 15, dur: 0.7, delay: 0,    size: 5, angle: 30  },
    { left: 40, dur: 0.9, delay: 0.2,  size: 4, angle: 25  },
    { left: 65, dur: 0.75,delay: 0.05, size: 6, angle: 35  },
    { left: 82, dur: 0.85,delay: 0.35, size: 4, angle: 28  },
    { left: 30, dur: 0.8, delay: 0.45, size: 5, angle: 32  },
  ];
  return (
    <div className="absolute inset-0 z-20 pointer-events-none overflow-hidden">
      {meteors.map((m, i) => (
        <div key={i}>
          {/* Meteor body */}
          <div style={{
            position: "absolute",
            left: `${m.left}%`,
            top: "-10%",
            width: `${m.size}px`,
            height: `${m.size}px`,
            borderRadius: "50%",
            background: "radial-gradient(circle, #fef3c7, #fb923c, #ef4444)",
            boxShadow: "0 0 6px #f97316, 0 0 12px #ef444466",
            animation: `horseMeteorFall ${m.dur}s ease-in ${m.delay}s infinite`,
          }} />
          {/* Tail streak */}
          <div style={{
            position: "absolute",
            left: `${m.left + 0.5}%`,
            top: "-8%",
            width: "2px",
            height: `${8 + (i % 3) * 4}px`,
            background: "linear-gradient(to bottom, transparent, rgba(251,146,60,0.6), rgba(239,68,68,0.4))",
            transform: `rotate(${m.angle}deg)`,
            transformOrigin: "top center",
            animation: `horseMeteorFall ${m.dur}s ease-in ${m.delay}s infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}

// Blood Trail — crimson drips leaving a dark trail behind the horse
function BloodEffect({ width, height }: { width: number; height: number }) {
  const drops = [
    { left: 8,  dur: 0.7, delay: 0,    size: 5, drip: 10 },
    { left: 22, dur: 0.9, delay: 0.2,  size: 4, drip: 8  },
    { left: 42, dur: 0.8, delay: 0.05, size: 6, drip: 12 },
    { left: 60, dur: 0.75,delay: 0.35, size: 4, drip: 9  },
    { left: 76, dur: 0.85,delay: 0.15, size: 5, drip: 11 },
  ];
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Blood pool on ground */}
      <div style={{
        position: "absolute", bottom: 0, left: "8%", right: "8%",
        height: "10%",
        background: "radial-gradient(ellipse at center, rgba(185,28,28,0.3) 0%, rgba(127,29,29,0.15) 60%, transparent 100%)",
        borderRadius: "50%",
      }} />
      {drops.map((d, i) => (
        <div key={i}>
          {/* Drip body */}
          <div style={{
            position: "absolute",
            left: `${d.left}%`,
            top: "40%",
            width: `${d.size}px`,
            height: `${d.size * 1.5}px`,
            borderRadius: "50% 50% 60% 60%",
            background: "radial-gradient(ellipse at top, #fca5a5, #dc2626, #991b1b)",
            boxShadow: "0 0 4px #b91c1c88",
            animation: `horseBloodDrip ${d.dur}s ease-in ${d.delay}s infinite`,
          }} />
          {/* Drip tail */}
          <div style={{
            position: "absolute",
            left: `${d.left + 0.3}%`,
            top: "38%",
            width: "2px",
            height: `${d.drip}px`,
            background: "linear-gradient(to bottom, #dc2626, #7f1d1d44, transparent)",
            animation: `horseBloodDrip ${d.dur}s ease-in ${d.delay}s infinite`,
          }} />
        </div>
      ))}
    </div>
  );
}

// Plague Miasma — sickly green fog with bubbling toxic orbs
function PlagueEffect({ width, height }: { width: number; height: number }) {
  const orbs = [
    { left: 12, bottom: 8,  size: 6, dur: 1.1, delay: 0    },
    { left: 30, bottom: 14, size: 5, dur: 1.3, delay: 0.2  },
    { left: 52, bottom: 6,  size: 7, dur: 1.0, delay: 0.1  },
    { left: 68, bottom: 16, size: 5, dur: 1.2, delay: 0.4  },
    { left: 82, bottom: 10, size: 6, dur: 0.95,delay: 0.15 },
  ];
  return (
    <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Miasma fog layers */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: "50%",
        background: "linear-gradient(to top, rgba(101,163,13,0.22), rgba(77,124,15,0.12), transparent)",
        animation: "horsePlagueWaver 2.5s ease-in-out infinite alternate",
      }} />
      <div style={{
        position: "absolute", bottom: 0, left: "-10%", right: "-10%", height: "30%",
        background: "radial-gradient(ellipse at center bottom, rgba(101,163,13,0.3) 0%, transparent 70%)",
        animation: "horsePlagueWaver 3s ease-in-out 0.5s infinite alternate",
      }} />
      {/* Toxic bubbles */}
      {orbs.map((o, i) => (
        <div key={i} style={{
          position: "absolute",
          left: `${o.left}%`,
          bottom: `${o.bottom}%`,
          width: `${o.size}px`,
          height: `${o.size}px`,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(163,230,53,0.7), rgba(101,163,13,0.5))`,
          boxShadow: "0 0 6px #65a30d88, 0 0 12px #4d7c0f44",
          border: "1px solid rgba(163,230,53,0.4)",
          animation: `horsePlagueOrb ${o.dur}s ease-in-out ${o.delay}s infinite alternate`,
        }} />
      ))}
    </div>
  );
}
