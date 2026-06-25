import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useStore } from "../store";
import { useLoginPlayer } from "@workspace/api-client-react";

function IdIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="0.5" y="1.5" width="11" height="9" rx="1.5" stroke="#4a9eff" strokeWidth="1.1"/>
      <circle cx="4" cy="5.5" r="1.3" stroke="#4a9eff" strokeWidth="1"/>
      <path d="M2 8.5c0-1.1.9-2 2-2s2 .9 2 2" stroke="#4a9eff" strokeWidth="1" strokeLinecap="round"/>
      <path d="M7.5 4.5h2M7.5 6.5h1.5" stroke="#4a9eff" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="5" width="9" height="6.5" rx="1.5" stroke="#e8400a" strokeWidth="1.1"/>
      <path d="M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5" stroke="#e8400a" strokeWidth="1.1" strokeLinecap="round"/>
      <circle cx="6" cy="8" r="1" fill="#e8400a"/>
    </svg>
  );
}

function SignInButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="submit"
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%",
        height: 48,
        background: disabled ? "rgba(143,37,8,0.4)" : (hovered ? "#b33010" : "#8f2508"),
        border: "none",
        borderRadius: 10,
        color: "#ffffff",
        fontFamily: "'Orbitron', sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.18s, box-shadow 0.18s",
        boxShadow: (!disabled && hovered)
          ? "0 0 20px rgba(143,37,8,0.6), 0 4px 20px rgba(143,37,8,0.35)"
          : "0 0 10px rgba(143,37,8,0.25)",
        marginTop: 4,
      }}
    >
      {pending ? "SIGNING IN..." : "SIGN IN"}
    </button>
  );
}

export default function PlayerLogin() {
  const [, setLocation] = useLocation();
  const [stateId, setStateId] = useState("");
  const [pin, setPin] = useState("");
  const [focused, setFocused] = useState<"id" | "pin" | null>(null);
  const [error, setError] = useState("");
  const loginMutation = useLoginPlayer();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const player = await loginMutation.mutateAsync({ data: { stateId, pin } });
      useStore.getState().logoutBanker();
      const staffRolesJson = (player as any).staffRolesJson;
      const staffRoles: string[] = staffRolesJson ? JSON.parse(staffRolesJson) : [(player as any).staffRole, (player as any).staffRole2].filter(Boolean);
      useStore.getState().setPlayerSession(
        player.id, player.sessionToken ?? "", (player as any).username,
        (player as any).staffRole ?? null, (player as any).staffRole2 ?? null, staffRoles,
      );
      setLocation("/lobby");
    } catch {
      setError("Invalid State ID or PIN.");
    }
  }

  const inputBase: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: 48,
    background: "#171820",
    borderRadius: 10,
    padding: "0 16px",
    color: "#a8b4cc",
    fontSize: 14,
    fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 500,
    letterSpacing: "0.08em",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const inputStyle = (field: "id" | "pin"): React.CSSProperties => ({
    ...inputBase,
    border: focused === field ? "1px solid rgba(232,100,10,0.75)" : "1px solid #44495a",
    boxShadow: focused === field ? "0 0 0 2px rgba(232,100,10,0.18)" : "none",
  });

  const labelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'Rajdhani', sans-serif",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.25em",
    color: "rgba(255,255,255,0.45)",
    textTransform: "uppercase",
    marginBottom: 8,
  };

  const [backHovered, setBackHovered] = useState(false);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#000000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Large centered radial glow behind the card */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 700,
        height: 700,
        background: "radial-gradient(ellipse at center, rgba(180,50,0,0.55) 0%, rgba(120,30,0,0.25) 40%, transparent 70%)",
        filter: "blur(40px)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Login card */}
      <div style={{
        position: "relative",
        zIndex: 1,
        background: "#070707",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "36px 40px 32px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 8px 60px rgba(0,0,0,0.7)",
      }}>

        {/* EST. LOS SANTOS */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(220,70,10,0.6)" }} />
          <span style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 9,
            letterSpacing: "0.32em",
            color: "rgba(220,70,10,0.9)",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}>EST. LOS SANTOS</span>
          <div style={{ flex: 1, height: 1, background: "rgba(220,70,10,0.6)" }} />
        </div>

        {/* BIG HOUSE title */}
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <h1 style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 36,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            margin: 0,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}>
            BIG HOUSE
          </h1>
          {/* Orange underline */}
          <div style={{
            width: 48,
            height: 2,
            background: "#e8400a",
            margin: "10px auto 0",
            borderRadius: 2,
          }} />
        </div>

        {/* Subtitle */}
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 13,
          fontWeight: 500,
          color: "rgba(255,255,255,0.38)",
          textAlign: "center",
          margin: "16px 0 28px",
          letterSpacing: "0.04em",
        }}>
          Enter your State ID and PIN to continue
        </p>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* State ID */}
            <div>
              <label style={labelStyle}>
                <IdIcon />
                STATE ID
              </label>
              <input
                type="text"
                value={stateId}
                onChange={e => setStateId(e.target.value)}
                onFocus={() => setFocused("id")}
                onBlur={() => setFocused(null)}
                placeholder="Your State ID number"
                style={inputStyle("id")}
                required
              />
            </div>

            {/* PIN */}
            <div>
              <label style={labelStyle}>
                <LockIcon />
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                onFocus={() => setFocused("pin")}
                onBlur={() => setFocused(null)}
                placeholder="Enter your PIN"
                style={inputStyle("pin")}
                maxLength={8}
                required
              />
            </div>

            {error && (
              <div style={{
                background: "rgba(232,64,10,0.1)",
                border: "1px solid rgba(232,64,10,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
              }}>
                <p style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 13, color: "#f87171", margin: 0 }}>{error}</p>
              </div>
            )}

            <SignInButton
              disabled={!stateId || !pin || loginMutation.isPending}
              pending={loginMutation.isPending}
            />
          </div>
        </form>

        {/* Footer links */}
        <div style={{ marginTop: 24, textAlign: "center" }}>
          <p style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 13,
            color: "rgba(255,255,255,0.38)",
            margin: "0 0 10px",
            letterSpacing: "0.03em",
          }}>
            No account yet?{" "}
            <Link href="/register" style={{
              color: "#e8400a",
              fontWeight: 700,
              textDecoration: "none",
            }}>
              Register here
            </Link>
          </p>

          <button
            type="button"
            onClick={() => setLocation("/")}
            onMouseEnter={() => setBackHovered(true)}
            onMouseLeave={() => setBackHovered(false)}
            style={{
              background: "none",
              border: "none",
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.2em",
              color: backHovered ? "#e8400a" : "rgba(255,255,255,0.25)",
              textTransform: "uppercase",
              cursor: "pointer",
              padding: 0,
              transition: "color 0.18s",
            }}
          >
            ← BACK TO HOME
          </button>
        </div>
      </div>

      <style>{`
        input::placeholder {
          color: rgba(130,145,175,0.55);
          font-family: 'Rajdhani', sans-serif;
          font-weight: 500;
          letter-spacing: 0.06em;
        }
        input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 30px #171820 inset !important;
          -webkit-text-fill-color: #a8b4cc !important;
        }
      `}</style>
    </div>
  );
}
