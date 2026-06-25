import { useState } from "react";
import { useLocation, Link } from "wouter";
import { useStore } from "../store";
import { useRegisterPlayer } from "@workspace/api-client-react";

function UserIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="4" r="2.2" stroke="#9b6dff" strokeWidth="1.1"/>
      <path d="M1.5 10.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="#9b6dff" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function IdIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="0.5" y="1.5" width="11" height="9" rx="1.5" stroke="#4a9eff" strokeWidth="1.1"/>
      <circle cx="4" cy="5.5" r="1.3" stroke="#4a9eff" strokeWidth="1"/>
      <path d="M2 8.5c0-1.1.9-2 2-2s2 .9 2 2" stroke="#4a9eff" strokeWidth="1" strokeLinecap="round"/>
      <path d="M7.5 4.5h2M7.5 6.5h1.5" stroke="#4a9eff" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="2.5" y="0.5" width="7" height="11" rx="1.5" stroke="#4ecdc4" strokeWidth="1.1"/>
      <circle cx="6" cy="9.5" r="0.7" fill="#4ecdc4"/>
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

function GiftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="0.5" y="4" width="11" height="7.5" rx="1.2" stroke="#ffb000" strokeWidth="1.1"/>
      <rect x="3.5" y="4" width="5" height="7.5" stroke="#ffb000" strokeWidth="0.8"/>
      <path d="M6 4V1.5M6 1.5C6 1.5 4.5 0.5 4 1.5S5 3.5 6 1.5ZM6 1.5C6 1.5 7.5 0.5 8 1.5S7 3.5 6 1.5Z" stroke="#ffb000" strokeWidth="1" strokeLinecap="round"/>
      <path d="M0.5 6h11" stroke="#ffb000" strokeWidth="0.8"/>
    </svg>
  );
}

function SubmitButton({ disabled, pending }: { disabled: boolean; pending: boolean }) {
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
      {pending ? "CREATING..." : "CREATE ACCOUNT"}
    </button>
  );
}

type FocusField = "name" | "stateId" | "phone" | "pin" | "confirmPin" | "referral" | null;

export default function Register() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [stateId, setStateId] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [focused, setFocused] = useState<FocusField>(null);
  const [error, setError] = useState("");
  const [backHovered, setBackHovered] = useState(false);
  const registerMutation = useRegisterPlayer();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pin.length < 4) { setError("PIN must be at least 4 digits."); return; }
    if (pin !== confirmPin) { setError("PINs do not match."); return; }
    try {
      const player = await registerMutation.mutateAsync({
        data: { username: name, stateId, phoneNumber, pin, referralCode: referralCode.trim() || null } as any,
      });
      const staffRolesJson = (player as any).staffRolesJson;
      const staffRoles: string[] = staffRolesJson ? JSON.parse(staffRolesJson) : [(player as any).staffRole, (player as any).staffRole2].filter(Boolean);
      useStore.getState().setPlayerSession(
        player.id, player.sessionToken ?? "", (player as any).username,
        (player as any).staffRole ?? null, (player as any).staffRole2 ?? null, staffRoles,
      );
      setLocation("/lobby");
    } catch (err: any) {
      setError(err?.message || "Registration failed. State ID or name may already be taken.");
    }
  }

  const inputBase: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: 48,
    background: "#171820",
    borderRadius: 10,
    padding: "0 14px",
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
    border: focused === f ? "1px solid rgba(232,100,10,0.75)" : "1px solid #44495a",
    boxShadow: focused === f ? "0 0 0 2px rgba(232,100,10,0.18)" : "none",
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

  const isValid = name && stateId && phoneNumber && pin && confirmPin;

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
        width: 760,
        height: 760,
        background: "radial-gradient(ellipse at center, rgba(180,50,0,0.55) 0%, rgba(120,30,0,0.25) 40%, transparent 68%)",
        filter: "blur(40px)",
        pointerEvents: "none",
        zIndex: 0,
      }} />

      {/* Register card */}
      <div style={{
        position: "relative",
        zIndex: 1,
        background: "#070707",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "32px 36px 28px",
        width: "100%",
        maxWidth: 440,
        boxShadow: "0 8px 60px rgba(0,0,0,0.7)",
      }}>

        {/* EST. LOS SANTOS */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
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

        {/* BIG HOUSE */}
        <div style={{ textAlign: "center", marginBottom: 4 }}>
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
          }}>BIG HOUSE</h1>
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
          margin: "14px 0 22px",
          letterSpacing: "0.04em",
        }}>
          Create your account
        </p>

        {/* Form */}
        <form onSubmit={handleRegister}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Full Name */}
            <div>
              <label style={labelStyle}><UserIcon />FULL NAME</label>
              <input
                type="text" value={name} onChange={e => setName(e.target.value)}
                onFocus={() => setFocused("name")} onBlur={() => setFocused(null)}
                placeholder="Your name" style={fieldStyle("name")} required
              />
            </div>

            {/* State ID + Phone */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}><IdIcon />STATE ID</label>
                <input
                  type="text" value={stateId} onChange={e => setStateId(e.target.value)}
                  onFocus={() => setFocused("stateId")} onBlur={() => setFocused(null)}
                  placeholder="e.g. 84291" style={fieldStyle("stateId")} required
                />
              </div>
              <div>
                <label style={labelStyle}><PhoneIcon />PHONE</label>
                <input
                  type="text" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                  onFocus={() => setFocused("phone")} onBlur={() => setFocused(null)}
                  placeholder="555-0147" style={fieldStyle("phone")} required
                />
              </div>
            </div>

            {/* PIN + Confirm PIN */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}><LockIcon />PIN</label>
                <input
                  type="password" value={pin} onChange={e => setPin(e.target.value)}
                  onFocus={() => setFocused("pin")} onBlur={() => setFocused(null)}
                  placeholder="4+ digits" style={fieldStyle("pin")} maxLength={8} required
                />
              </div>
              <div>
                <label style={labelStyle}><LockIcon />CONFIRM PIN</label>
                <input
                  type="password" value={confirmPin} onChange={e => setConfirmPin(e.target.value)}
                  onFocus={() => setFocused("confirmPin")} onBlur={() => setFocused(null)}
                  placeholder="Repeat" style={fieldStyle("confirmPin")} maxLength={8} required
                />
              </div>
            </div>

            {/* Referral Code */}
            <div>
              <label style={labelStyle}><GiftIcon />REFERRAL CODE (OPTIONAL)</label>
              <input
                type="text" value={referralCode} onChange={e => setReferralCode(e.target.value)}
                onFocus={() => setFocused("referral")} onBlur={() => setFocused(null)}
                placeholder="Enter code if you have one" style={fieldStyle("referral")}
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

            <SubmitButton disabled={!isValid || registerMutation.isPending} pending={registerMutation.isPending} />
          </div>
        </form>

        {/* Footer */}
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <p style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: 13,
            color: "rgba(255,255,255,0.38)",
            margin: "0 0 10px",
            letterSpacing: "0.03em",
          }}>
            Already have an account?{" "}
            <Link href="/login" style={{
              color: "#e8400a",
              fontWeight: 700,
              textDecoration: "none",
            }}>
              Sign in
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
