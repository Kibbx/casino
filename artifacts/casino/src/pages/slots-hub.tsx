import { useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { ChevronLeft, Zap } from "lucide-react";
import { usePageTracker } from "../lib/usePageTracker";
import { isGameUnlocked, usePasswordGuard } from "../lib/gamePasswordGuard";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const WS   = import.meta.env.BASE_URL + "western-slots/";
const RS   = import.meta.env.BASE_URL + "rome-slots/";

const SLOTS_MAINTENANCE = false;

// ── Epic Fortuna card ─────────────────────────────────────────────────────
function FortunaCard({ onPlay, index, maintenance }: { onPlay: () => void; index: number; maintenance?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.35 }}
      style={{ width: 240, flexShrink: 0 }}
    >
      <div
        onClick={maintenance ? undefined : onPlay}
        style={{
          position: "relative", width: "100%", height: 330,
          borderRadius: 14, overflow: "hidden",
          background: "#0a0205",
          border: "1.5px solid rgba(220,38,38,0.5)",
          boxShadow: "0 0 30px rgba(180,20,20,0.18), 0 0 8px rgba(220,38,38,0.12), 0 4px 28px rgba(0,0,0,0.85)",
          cursor: maintenance ? "not-allowed" : "pointer",
          transition: "transform 0.18s, box-shadow 0.18s",
        }}
        onMouseEnter={maintenance ? undefined : e => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-5px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 0 48px rgba(220,38,38,0.3), 0 0 18px rgba(251,191,36,0.2), 0 12px 40px rgba(0,0,0,0.9)";
        }}
        onMouseLeave={maintenance ? undefined : e => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 0 30px rgba(180,20,20,0.18), 0 0 8px rgba(220,38,38,0.12), 0 4px 28px rgba(0,0,0,0.85)";
        }}
      >
        {/* Maintenance overlay */}
        {maintenance && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 20,
            background: "rgba(5,2,8,0.82)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <span style={{ fontSize: 32 }}>🚧</span>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontWeight: 800,
              fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#FFD060",
            }}>Under Maintenance</span>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontSize: 10,
              color: "rgba(200,160,60,0.55)", letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}>Coming back soon</span>
          </div>
        )}
        {/* Colosseum background */}
        <img
          src={RS + "screen/BKG.webp"} alt="Fortuna"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center top",
            filter: "brightness(0.72) saturate(1.15)",
          }}
        />

        {/* Imperial crimson vignette */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(160deg, rgba(60,5,5,0.3) 0%, transparent 40%, rgba(10,2,2,0.93) 100%)",
        }} />

        {/* Gold top border stripe */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 6,
          background: "linear-gradient(90deg, #7B1010, #D4A017, #8B0000, #D4A017, #7B1010)",
        }} />

        {/* "HOT" badge */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(139,0,0,0.3)",
          border: "1px solid rgba(220,38,38,0.65)",
          borderRadius: 4, padding: "2px 8px",
        }}>
          <span style={{
            fontFamily: "Oswald,sans-serif", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.16em", color: "#FF6B6B",
          }}>🔥 HOT</span>
        </div>

        {/* Live dot */}
        <div style={{ position: "absolute", top: 14, right: 12 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: "#4ade80", boxShadow: "0 0 8px #4ade80",
          }} />
        </div>

        {/* Bottom info panel */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "14px 14px 14px",
          background: "linear-gradient(to top, rgba(8,2,2,0.98) 0%, rgba(8,2,2,0.72) 70%, transparent 100%)",
        }}>
          {/* Title with crimson-gold imperial treatment */}
          <p style={{
            fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 22,
            letterSpacing: "0.1em", textTransform: "uppercase",
            margin: 0, lineHeight: 1.1,
            background: "linear-gradient(135deg, #FFD700 0%, #DC2626 45%, #FFD700 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.95))",
          }}>
            Fortuna
          </p>

          <p style={{
            fontFamily: "Oswald,sans-serif", fontSize: 11,
            color: "rgba(220,180,80,0.75)",
            margin: "4px 0 0", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            Fortune favors the bold
          </p>

          {/* Feature tags */}
          <div style={{ display: "flex", gap: 6, marginTop: 8, marginBottom: 8 }}>
            <div style={{
              background: "rgba(80,5,5,0.55)",
              border: "1px solid rgba(220,38,38,0.35)",
              borderRadius: 4, padding: "2px 7px",
            }}>
              <span style={{
                fontFamily: "Oswald,sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: "0.1em", color: "rgba(255,160,100,0.85)",
              }}>20 PAYLINES</span>
            </div>
            <div style={{
              background: "rgba(80,5,5,0.55)",
              border: "1px solid rgba(220,38,38,0.35)",
              borderRadius: 4, padding: "2px 7px",
            }}>
              <span style={{
                fontFamily: "Oswald,sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: "0.1em", color: "rgba(255,160,100,0.85)",
              }}>FREE SPINS</span>
            </div>
          </div>

          {/* Play button — imperial crimson-gold */}
          <div style={{
            background: "linear-gradient(135deg, #7B0A0A 0%, #B91C1C 50%, #8B0000 100%)",
            border: "1px solid rgba(220,38,38,0.55)",
            borderRadius: 6, padding: "8px 0", textAlign: "center",
            boxShadow: "0 2px 12px rgba(139,0,0,0.55), inset 0 1px 0 rgba(255,200,80,0.12)",
          }}>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontWeight: 800,
              fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#FFD060",
              textShadow: "0 1px 4px rgba(0,0,0,0.8)",
            }}>
              ⚔ PLAY ⚔
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Epic Deadwood Dollars card ─────────────────────────────────────────────
function DeadwoodCard({ onPlay, index, maintenance }: { onPlay: () => void; index: number; maintenance?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 * index, duration: 0.35 }}
      style={{ width: 240, flexShrink: 0 }}
    >
      <div
        onClick={maintenance ? undefined : onPlay}
        style={{
          position: "relative", width: "100%", height: 330,
          borderRadius: 14, overflow: "hidden",
          background: "#1a0d04",
          border: "1.5px solid rgba(205,133,63,0.55)",
          boxShadow: "0 0 30px rgba(180,100,20,0.2), 0 0 8px rgba(205,133,63,0.15), 0 4px 28px rgba(0,0,0,0.85)",
          cursor: maintenance ? "not-allowed" : "pointer",
          transition: "transform 0.18s, box-shadow 0.18s",
        }}
        onMouseEnter={maintenance ? undefined : e => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(-5px)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 0 48px rgba(205,133,63,0.35), 0 0 16px rgba(180,100,20,0.3), 0 12px 40px rgba(0,0,0,0.9)";
        }}
        onMouseLeave={maintenance ? undefined : e => {
          (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
          (e.currentTarget as HTMLDivElement).style.boxShadow =
            "0 0 30px rgba(180,100,20,0.2), 0 0 8px rgba(205,133,63,0.15), 0 4px 28px rgba(0,0,0,0.85)";
        }}
      >
        {/* Maintenance overlay */}
        {maintenance && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 20,
            background: "rgba(8,4,0,0.82)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            <span style={{ fontSize: 32 }}>🚧</span>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontWeight: 800,
              fontSize: 13, letterSpacing: "0.2em", textTransform: "uppercase",
              color: "#FFD060",
            }}>Under Maintenance</span>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontSize: 10,
              color: "rgba(200,160,60,0.55)", letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}>Coming back soon</span>
          </div>
        )}
        {/* Background scene */}
        <img
          src={WS + "screen/Background.webp"} alt="Deadwood Dollars"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", objectPosition: "center top",
            filter: "brightness(0.75) saturate(1.1)",
          }}
        />

        {/* Warm sepia vignette overlay */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(160deg, rgba(40,15,0,0.35) 0%, transparent 40%, rgba(20,8,0,0.92) 100%)",
        }} />

        {/* Wood-plank top border strip */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: 6,
          background: "linear-gradient(90deg, #7B4A1E, #C48A3A, #8B5320, #C48A3A, #7B4A1E)",
        }} />

        {/* "NEW" badge */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(180,90,10,0.25)",
          border: "1px solid rgba(205,133,63,0.65)",
          borderRadius: 4, padding: "2px 8px",
        }}>
          <span style={{
            fontFamily: "Oswald,sans-serif", fontSize: 10, fontWeight: 700,
            letterSpacing: "0.16em", color: "#E8A835",
          }}>NEW</span>
        </div>

        {/* Live dot */}
        <div style={{ position: "absolute", top: 14, right: 12 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: "#4ade80", boxShadow: "0 0 8px #4ade80",
          }} />
        </div>


        {/* Bottom info panel */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: "14px 14px 14px",
          background: "linear-gradient(to top, rgba(15,6,0,0.97) 0%, rgba(15,6,0,0.7) 70%, transparent 100%)",
        }}>
          {/* Title with western gold treatment */}
          <p style={{
            fontFamily: "Oswald,sans-serif", fontWeight: 900, fontSize: 19,
            letterSpacing: "0.07em", textTransform: "uppercase",
            margin: 0, lineHeight: 1.15,
            background: "linear-gradient(135deg, #F0C060 0%, #C88A28 50%, #E8B040 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.9))",
          }}>
            Deadwood Dollars
          </p>

          <p style={{
            fontFamily: "Oswald,sans-serif", fontSize: 11,
            color: "rgba(205,133,63,0.75)",
            margin: "4px 0 0", letterSpacing: "0.1em", textTransform: "uppercase",
          }}>
            Spin or draw, partner
          </p>

          {/* RTP badge row */}
          <div style={{ display: "flex", gap: 6, marginTop: 8, marginBottom: 8 }}>
            <div style={{
              background: "rgba(100,50,5,0.5)",
              border: "1px solid rgba(205,133,63,0.3)",
              borderRadius: 4, padding: "2px 7px",
            }}>
              <span style={{
                fontFamily: "Oswald,sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: "0.1em", color: "rgba(205,133,63,0.8)",
              }}>20 PAYLINES</span>
            </div>
            <div style={{
              background: "rgba(100,50,5,0.5)",
              border: "1px solid rgba(205,133,63,0.3)",
              borderRadius: 4, padding: "2px 7px",
            }}>
              <span style={{
                fontFamily: "Oswald,sans-serif", fontSize: 9, fontWeight: 700,
                letterSpacing: "0.1em", color: "rgba(205,133,63,0.8)",
              }}>FREE SPINS</span>
            </div>
          </div>

          {/* Play button — copper/amber western style */}
          <div style={{
            background: "linear-gradient(135deg, #7B3A0A 0%, #B8621A 50%, #8B4510 100%)",
            border: "1px solid rgba(205,133,63,0.5)",
            borderRadius: 6, padding: "8px 0", textAlign: "center",
            boxShadow: "0 2px 12px rgba(120,60,10,0.5), inset 0 1px 0 rgba(255,200,100,0.15)",
          }}>
            <span style={{
              fontFamily: "Oswald,sans-serif", fontWeight: 800,
              fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase",
              color: "#FFD880",
              textShadow: "0 1px 4px rgba(0,0,0,0.7)",
            }}>
              ★ PLAY ★
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function SlotsHub() {
  const [, navigate] = useLocation();
  usePageTracker("slots-hub");
  usePasswordGuard("slots");
  useEffect(() => { if (!isGameUnlocked("slots")) navigate("/lobby"); }, []);

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0a0608 0%, #12060a 50%, #0a0810 100%)",
      display: "flex", flexDirection: "column",
      fontFamily: "Oswald,sans-serif",
    }}>

      {/* ── Top bar ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 28px",
        borderBottom: "1px solid rgba(251,191,36,0.1)",
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(6px)",
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate("/lobby")}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "none", border: "none", cursor: "pointer",
            color: "rgba(251,191,36,0.75)", fontSize: 14,
            fontFamily: "Oswald,sans-serif", letterSpacing: "0.08em",
            padding: "4px 0",
          }}
        >
          <ChevronLeft size={18} />
          MINI GAMES
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap size={16} color="rgba(251,191,36,0.7)" />
          <span style={{
            fontWeight: 700, fontSize: 15, letterSpacing: "0.18em",
            color: "rgba(251,191,36,0.85)",
          }}>
            SLOT MACHINES
          </span>
        </div>

        <div style={{ width: 80 }} />
      </div>

      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ textAlign: "center", padding: "40px 24px 28px" }}
      >
        <h1 style={{
          fontWeight: 900, fontSize: "clamp(28px, 5vw, 46px)",
          letterSpacing: "0.1em", textTransform: "uppercase",
          margin: 0, lineHeight: 1.1,
          background: "linear-gradient(135deg, #F5C518 0%, #E8A020 50%, #C8860C 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          filter: "drop-shadow(0 2px 12px rgba(200,134,12,0.4))",
        }}>
          Pick Your Game
        </h1>
        <p style={{
          color: "rgba(200,170,90,0.6)", fontSize: 14,
          letterSpacing: "0.12em", marginTop: 10, textTransform: "uppercase",
        }}>
          More titles coming soon
        </p>
        <div style={{
          width: 60, height: 2, margin: "18px auto 0",
          background: "linear-gradient(90deg, transparent, rgba(251,191,36,0.6), transparent)",
        }} />
      </motion.div>

      {/* ── Slot card grid ── */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: 22,
        padding: "28px 32px 48px",
      }}>
        {/* Fortuna — dedicated epic card */}
        <FortunaCard index={0} onPlay={() => navigate("/rome-slots")} maintenance={SLOTS_MAINTENANCE} />
        {/* Deadwood Dollars — dedicated epic card */}
        <DeadwoodCard index={1} onPlay={() => navigate("/western-slots")} maintenance={SLOTS_MAINTENANCE} />
      </div>

      {/* ── Footer note ── */}
      <div style={{
        textAlign: "center", padding: "0 0 28px",
        color: "rgba(160,130,60,0.35)", fontSize: 11, letterSpacing: "0.1em",
      }}>
        BIG HOUSE CASINO · EST. LOS SANTOS
      </div>
    </div>
  );
}
