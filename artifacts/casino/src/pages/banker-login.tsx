import { useState } from "react";
import { useLocation } from "wouter";
import { useStore } from "../store";
import { useBankerLogin } from "@workspace/api-client-react";

function ShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <path d="M13 2L4 6v7c0 5.25 3.85 10.16 9 11.35C18.15 23.16 22 18.25 22 13V6L13 2z"
        stroke="#9b3dff" strokeWidth="1.6" strokeLinejoin="round" fill="none"/>
      <path d="M9.5 13l2.5 2.5 5-5" stroke="#9b3dff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="4" r="2.2" stroke="#9b6dff" strokeWidth="1.1"/>
      <path d="M1.5 10.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="#9b6dff" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="5" width="9" height="6.5" rx="1.5" stroke="#e8400a" strokeWidth="1.1"/>
      <path d="M3.5 5V3.5a2.5 2.5 0 0 1 5 0V5" stroke="#e8400a" strokeWidth="1.1" strokeLinecap="round"/>
      <circle cx="6" cy="8" r="1" fill="#e8400a"/>
    </svg>
  );
}

function EnterButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
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
        background: disabled ? "rgba(94,47,143,0.4)" : (hovered ? "#7a40b8" : "#5e2f8f"),
        border: "none",
        borderRadius: 10,
        color: "#ffffff",
        fontFamily: "'Orbitron', sans-serif",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.18s, box-shadow 0.18s",
        boxShadow: (!disabled && hovered)
          ? "0 0 22px rgba(94,47,143,0.7), 0 4px 20px rgba(94,47,143,0.4)"
          : "0 0 10px rgba(94,47,143,0.3)",
        marginTop: 4,
      }}
    >
      {pending ? "VERIFYING..." : "ENTER"}
    </button>
  );
}

type FocusField = "username" | "password" | null;

export default function BankerLogin() {
  const [, setLocation] = useLocation();
  const { setBankerSession, logoutPlayer } = useStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [focused, setFocused] = useState<FocusField>(null);
  const [error, setError] = useState("");
  const [backHovered, setBackHovered] = useState(false);
  const loginMutation = useBankerLogin();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const result = await loginMutation.mutateAsync({ data: { username, password } });
      logoutPlayer();
      setBankerSession(result.token, result.username, result.isAdmin, (result as any).role ?? "banker", (result as any).role2 ?? null, (result as any).roles ?? undefined, (result as any).stateId ?? null);
      setLocation("/banker");
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Authentication failed.";
      setError(msg);
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
    letterSpacing: "0.07em",
    outline: "none",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const fieldStyle = (f: FocusField): React.CSSProperties => ({
    ...inputBase,
    border: focused === f ? "1px solid rgba(155,61,255,0.75)" : "1px solid #44495a",
    boxShadow: focused === f ? "0 0 0 2px rgba(155,61,255,0.18)" : "none",
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
      {/* Large centered purple radial glow */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 700,
        height: 700,
        background: "radial-gradient(ellipse at center, rgba(100,30,160,0.60) 0%, rgba(70,10,120,0.28) 40%, transparent 68%)",
        filter: "blur(40px)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Staff login card */}
      <div style={{
        position: "relative",
        zIndex: 1,
        background: "#070707",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "36px 40px 32px",
        width: "100%",
        maxWidth: 400,
        boxShadow: "0 8px 60px rgba(0,0,0,0.75)",
      }}>

        {/* Shield icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
          <div style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            border: "1.5px solid rgba(155,61,255,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 18px rgba(155,61,255,0.35), inset 0 0 12px rgba(155,61,255,0.08)",
            background: "rgba(94,47,143,0.08)",
          }}>
            <ShieldIcon />
          </div>
        </div>

        {/* STAFF ACCESS title */}
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <h1 style={{
            fontFamily: "'Orbitron', sans-serif",
            fontSize: 28,
            fontWeight: 900,
            color: "#ffffff",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            margin: 0,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}>STAFF ACCESS</h1>
          {/* Purple underline */}
          <div style={{
            width: 48,
            height: 2,
            background: "#7c3aed",
            margin: "10px auto 0",
            borderRadius: 2,
          }} />
        </div>

        {/* Subtitle */}
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 13,
          fontWeight: 500,
          color: "rgba(255,255,255,0.35)",
          textAlign: "center",
          margin: "14px 0 26px",
          letterSpacing: "0.04em",
        }}>
          Restricted — authorised personnel only
        </p>

        {/* Form */}
        <form onSubmit={handleLogin}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {/* Username */}
            <div>
              <label style={labelStyle}><UserIcon />USERNAME</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onFocus={() => setFocused("username")}
                onBlur={() => setFocused(null)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Enter username"
                style={fieldStyle("username")}
                required
              />
            </div>

            {/* Password */}
            <div>
              <label style={labelStyle}><LockIcon />PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                autoComplete="current-password"
                placeholder="Enter password"
                style={fieldStyle("password")}
                required
              />
            </div>

            {error && (
              <div style={{
                background: "rgba(155,61,255,0.08)",
                border: "1px solid rgba(155,61,255,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
              }}>
                <p style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 13, color: "#c084fc", margin: 0, textAlign: "center" }}>{error}</p>
              </div>
            )}

            <EnterButton
              disabled={!username || !password || loginMutation.isPending}
              pending={loginMutation.isPending}
            />
          </div>
        </form>

        {/* Back button */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
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
              letterSpacing: "0.22em",
              color: backHovered ? "#9b3dff" : "rgba(255,255,255,0.25)",
              textTransform: "uppercase",
              cursor: "pointer",
              padding: 0,
              transition: "color 0.18s",
            }}
          >
            ← BACK
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
