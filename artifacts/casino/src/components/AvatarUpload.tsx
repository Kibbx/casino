import { useRef, useState } from "react";
import { Camera, Upload, Trash2, X, Loader2 } from "lucide-react";
import { useStore } from "../store";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"]);

interface Props {
  playerId: number;
  currentAvatarUrl?: string | null;
  username: string;
  size?: "sm" | "md" | "lg";
  onUpdate?: (url: string | null) => void;
}

/* ── Shared avatar image / initials fallback ─────────────────── */
export function AvatarImg({
  src, username, size = "md", style,
}: {
  src?: string | null;
  username: string;
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}) {
  const [err, setErr] = useState(false);
  const px = size === "sm" ? 28 : size === "lg" ? 56 : 44;
  const fs = size === "sm" ? 10 : size === "lg" ? 18 : 14;
  const initials = (username ?? "?").slice(0, 2).toUpperCase();

  if (src && !err) {
    return (
      <img
        src={src}
        alt={username}
        onError={() => setErr(true)}
        style={{
          width: px, height: px, borderRadius: "50%",
          objectFit: "cover", flexShrink: 0,
          border: "2px solid rgba(232,64,10,0.45)",
          display: "block",
          ...style,
        }}
      />
    );
  }
  return (
    <div style={{
      width: px, height: px, borderRadius: "50%",
      background: "linear-gradient(135deg,#1e0e06,#2c1506)",
      border: "2px solid rgba(232,64,10,0.55)",
      color: "#e8400a", fontWeight: 900, fontSize: fs,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, letterSpacing: 1, userSelect: "none",
      ...style,
    }}>
      {initials}
    </div>
  );
}

/* ── Interactive upload widget ───────────────────────────────── */
export function AvatarUpload({ playerId, currentAvatarUrl, username, size = "md", onUpdate }: Props) {
  const { sessionToken } = useStore();
  const queryClient     = useQueryClient();
  const fileRef         = useRef<HTMLInputElement>(null);

  const [open,      setOpen]      = useState(false);
  const [preview,   setPreview]   = useState<{ url: string; type: string } | null>(null);
  const [error,     setError]     = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing,  setRemoving]  = useState(false);

  const px       = size === "sm" ? 28 : size === "lg" ? 56 : 44;
  const iconSize = px < 40 ? 11 : 15;
  const hasImg   = !!currentAvatarUrl;

  function openModal()  { setError(null); setOpen(true); }
  function closeModal() {
    if (preview) { URL.revokeObjectURL(preview.url); setPreview(null); }
    setError(null);
    setOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Only PNG, JPG, WEBP, or GIF files are allowed.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File too large — max 5 MB.");
      return;
    }
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview({ url: URL.createObjectURL(file), type: file.type });
  }

  async function handleUpload() {
    if (!preview || !sessionToken) return;
    setUploading(true);
    setError(null);
    try {
      const blob = await fetch(preview.url).then(r => r.blob());
      const res  = await fetch(`${BASE}/api/players/${playerId}/avatar/upload`, {
        method: "POST",
        headers: { "Content-Type": preview.type, Authorization: `Bearer ${sessionToken}` },
        body: blob,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Upload failed");
      }
      const data = await res.json();
      await queryClient.invalidateQueries();
      onUpdate?.(data.avatarUrl ?? null);
      closeModal();
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    if (!sessionToken) return;
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/${playerId}/avatar`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Remove failed");
      }
      await queryClient.invalidateQueries();
      onUpdate?.(null);
      closeModal();
    } catch (e: any) {
      setError(e.message ?? "Remove failed");
    } finally {
      setRemoving(false);
    }
  }

  const displaySrc = preview?.url ?? currentAvatarUrl;
  const initials   = (username ?? "?").slice(0, 2).toUpperCase();

  return (
    <>
      {/* ── Clickable avatar thumbnail ──────────────────────────── */}
      <div
        style={{ position: "relative", width: px, height: px, cursor: "pointer", flexShrink: 0 }}
        onClick={openModal}
        title="Change profile picture"
      >
        <AvatarImg src={currentAvatarUrl} username={username} size={size} />
        <div
          className="avatar-hover-overlay"
          style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "rgba(0,0,0,0.58)",
            display: "flex", alignItems: "center", justifyContent: "center",
            opacity: 0, transition: "opacity 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
        >
          <Camera size={iconSize} color="#fff" />
        </div>
      </div>

      {/* ── Hidden file input ───────────────────────────────────── */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Modal ──────────────────────────────────────────────── */}
      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.72)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{
            background: "#0e0b06",
            border: "1px solid rgba(245,197,24,0.18)",
            borderRadius: 18,
            padding: "22px 24px 20px",
            width: "100%", maxWidth: 300,
            boxShadow: "0 0 80px rgba(0,0,0,0.85), 0 0 40px rgba(245,197,24,0.04)",
            display: "flex", flexDirection: "column", gap: 16,
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{
                fontFamily: "Rajdhani, sans-serif", fontWeight: 900, fontSize: 13,
                letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff",
              }}>
                Profile Image
              </span>
              <button
                onClick={closeModal}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2, lineHeight: 1 }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Preview */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ position: "relative" }}>
                {displaySrc ? (
                  <img
                    src={displaySrc}
                    alt={username}
                    style={{
                      width: 88, height: 88, borderRadius: "50%",
                      objectFit: "cover",
                      border: "2px solid rgba(232,64,10,0.5)",
                      display: "block",
                    }}
                  />
                ) : (
                  <div style={{
                    width: 88, height: 88, borderRadius: "50%",
                    background: "linear-gradient(135deg,#1e0e06,#2c1506)",
                    border: "2px solid rgba(232,64,10,0.5)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#e8400a", fontWeight: 900, fontSize: 26, letterSpacing: 2,
                  }}>
                    {initials}
                  </div>
                )}
                {preview && (
                  <div style={{
                    position: "absolute", bottom: 2, right: 2,
                    background: "#f5c518", borderRadius: 10,
                    padding: "1px 5px",
                    fontSize: 9, fontWeight: 900, color: "#0a0804",
                    letterSpacing: "0.05em",
                  }}>
                    NEW
                  </div>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <p style={{ color: "#ef4444", fontSize: 11, textAlign: "center", margin: 0, lineHeight: 1.4 }}>
                {error}
              </p>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {!preview ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "9px 16px", borderRadius: 8,
                    background: "rgba(232,64,10,0.14)",
                    border: "1px solid rgba(232,64,10,0.38)",
                    color: "#e8400a", fontWeight: 700, fontSize: 12,
                    cursor: "pointer", letterSpacing: "0.07em",
                    fontFamily: "Rajdhani, sans-serif", textTransform: "uppercase",
                  }}
                >
                  <Upload size={13} /> Choose Image
                </button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    style={{
                      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      padding: "9px 16px", borderRadius: 8,
                      background: "rgba(245,197,24,0.16)",
                      border: "1px solid rgba(245,197,24,0.38)",
                      color: "#f5c518", fontWeight: 700, fontSize: 12,
                      cursor: uploading ? "not-allowed" : "pointer",
                      letterSpacing: "0.07em", fontFamily: "Rajdhani, sans-serif", textTransform: "uppercase",
                      opacity: uploading ? 0.7 : 1,
                    }}
                  >
                    {uploading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Upload size={13} />}
                    {uploading ? "Uploading…" : "Save"}
                  </button>
                  <button
                    onClick={() => { if (preview) { URL.revokeObjectURL(preview.url); setPreview(null); } fileRef.current?.click(); }}
                    style={{
                      padding: "9px 12px", borderRadius: 8,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.09)",
                      color: "rgba(255,255,255,0.4)", fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Change
                  </button>
                </div>
              )}

              {hasImg && !preview && (
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "7px 16px", borderRadius: 8,
                    background: "rgba(239,68,68,0.07)",
                    border: "1px solid rgba(239,68,68,0.22)",
                    color: "rgba(239,68,68,0.65)", fontWeight: 700, fontSize: 11,
                    cursor: removing ? "not-allowed" : "pointer",
                    letterSpacing: "0.06em", fontFamily: "Rajdhani, sans-serif", textTransform: "uppercase",
                    opacity: removing ? 0.7 : 1,
                  }}
                >
                  {removing
                    ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
                    : <Trash2 size={12} />}
                  {removing ? "Removing…" : "Remove Photo"}
                </button>
              )}
            </div>

            {/* Hint */}
            <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 10, textAlign: "center", margin: 0, letterSpacing: "0.04em" }}>
              PNG · JPG · WEBP · GIF &nbsp;·&nbsp; Max 5 MB
            </p>
          </div>
        </div>
      )}
    </>
  );
}
