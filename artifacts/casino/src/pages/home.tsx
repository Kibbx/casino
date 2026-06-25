import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { User, UserPlus, Shield } from "lucide-react";
import { PromoZone } from "../components/PromoRegion";
import { useStore } from "../store";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CARDS = [
  {
    href: "/login",
    Icon: User,
    accent: "#ff5a1f",
    title: "PLAYER LOGIN",
    sub: "Sign in with your State ID and PIN.",
  },
  {
    href: "/register",
    Icon: UserPlus,
    accent: "#ffb000",
    title: "NEW PLAYER",
    sub: "Register and get in the game.",
  },
  {
    href: "/banker/login",
    Icon: Shield,
    accent: "#8b3dff",
    title: "STAFF ACCESS",
    sub: "Authorised personnel only.",
  },
];

function MenuCard({ card, onClick }: { card: typeof CARDS[0]; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const { Icon, accent, title, sub } = card;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        height: 88,
        boxSizing: "border-box",
        background: hovered ? "rgba(14,12,12,0.94)" : "rgba(8,8,8,0.92)",
        border: `1px solid ${hovered ? accent + "55" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 12,
        padding: "0 24px",
        cursor: "pointer",
        transition: "border-color 0.25s, box-shadow 0.25s, transform 0.25s, background 0.25s",
        boxShadow: hovered
          ? `0 0 22px ${accent}22, 0 10px 36px rgba(0,0,0,0.6)`
          : "0 2px 14px rgba(0,0,0,0.5)",
        transform: hovered ? "translateY(-2px)" : "none",
      } as React.CSSProperties}
    >
      {/* Icon box */}
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 12,
        background: accent + "14",
        border: `1px solid ${accent}55`,
        boxShadow: hovered ? `0 0 12px ${accent}33` : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "box-shadow 0.25s",
      }}>
        <Icon size={22} color={accent} strokeWidth={1.7} />
      </div>

      {/* Text */}
      <div style={{ flex: 1 }}>
        <div style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#ffffff",
          marginBottom: 5,
          lineHeight: 1,
        }}>
          {title}
        </div>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 500,
          fontSize: 13,
          letterSpacing: "0.03em",
          color: "#7a7a7a",
        }}>
          {sub}
        </div>
      </div>

      {/* Arrow */}
      <div style={{
        color: accent,
        flexShrink: 0,
        fontSize: 18,
        lineHeight: 1,
        textShadow: hovered ? `0 0 8px ${accent}` : "none",
        transition: "text-shadow 0.25s",
      }}>→</div>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { sessionToken, bankerToken, setPlayerSession, logoutPlayer } = useStore();

  useEffect(() => {
    if (bankerToken) { setLocation("/banker"); return; }
    if (sessionToken) {
      fetch(`${BASE}/api/players/me`, { headers: { Authorization: `Bearer ${sessionToken}` } })
        .then(async (r) => {
          if (!r.ok) { logoutPlayer(); return; }
          const player = await r.json();
          const staffRoles: string[] = player.staffRolesJson
            ? JSON.parse(player.staffRolesJson)
            : [player.staffRole, player.staffRole2].filter(Boolean);
          setPlayerSession(player.id, sessionToken, player.username, staffRoles[0] ?? null, staffRoles[1] ?? null, staffRoles);
          setLocation("/lobby");
        })
        .catch(() => logoutPlayer());
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(circle at center, rgba(90,22,5,0.34) 0%, rgba(30,5,0,0.16) 28%, rgba(0,0,0,0) 58%), #020202",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Large soft radial glow behind title/cards */}
      <div style={{
        position: "absolute",
        top: "46%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 1100,
        height: 900,
        background: "radial-gradient(circle at center, rgba(150,45,5,0.22) 0%, rgba(90,25,0,0.10) 35%, transparent 65%)",
        pointerEvents: "none",
      }} />

      {/* Content */}
      <div style={{
        position: "relative",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        maxWidth: 460,
        padding: "0 20px",
        boxSizing: "border-box",
        transform: "translateY(-4vh)",
      }}>
        {/* EST. LOS SANTOS */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{ width: 40, height: 1, background: "#ff5a1f99" }} />
          <span style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#ff5a1f",
          }}>EST. LOS SANTOS</span>
          <div style={{ width: 40, height: 1, background: "#ff5a1f99" }} />
        </div>

        {/* BIG HOUSE */}
        <h1 style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 52,
          fontWeight: 900,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#ffffff",
          margin: "0 0 26px",
          lineHeight: 1,
          textAlign: "center",
          whiteSpace: "nowrap",
          textShadow: "0 0 60px rgba(255,80,10,0.45), 0 0 120px rgba(200,50,0,0.2)",
        }}>
          BIG HOUSE
        </h1>

        {/* Cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: "100%" }}>
          {CARDS.map(card => (
            <MenuCard key={card.href} card={card} onClick={() => setLocation(card.href)} />
          ))}
        </div>
      </div>

      <PromoZone pageKey="homepage" />
    </div>
  );
}
