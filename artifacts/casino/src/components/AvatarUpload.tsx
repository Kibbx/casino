import { useState } from "react";
import { Camera, Check, X, Loader2, Link } from "lucide-react";
import { useStore } from "../store";
import { useQueryClient } from "@tanstack/react-query";
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface AvatarUploadProps {
  playerId: number;
  currentAvatarUrl?: string | null;
  username: string;
  size?: "sm" | "md" | "lg";
}

export function AvatarImg({ src, username, size = "md" }: { src?: string | null; username: string; size?: "sm" | "md" | "lg" }) {
  const [imgErr, setImgErr] = useState(false);
  const sizeClasses = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-16 h-16 text-2xl" : "w-11 h-11 text-base";
  const initial = (username?.[0] ?? "?").toUpperCase();

  if (src && !imgErr) {
    return (
      <img
        src={src}
        alt={username}
        onError={() => setImgErr(true)}
        className={`${sizeClasses} rounded-full object-cover border-2 border-white/10 flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${sizeClasses} rounded-full bg-primary/20 border-2 border-primary/30 flex items-center justify-center flex-shrink-0 font-display font-bold text-primary select-none`}>
      {initial}
    </div>
  );
}

export function AvatarUpload({ playerId, currentAvatarUrl, username, size = "md" }: AvatarUploadProps) {
  const [editing, setEditing] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sessionToken } = useStore();
  const queryClient = useQueryClient();

  const sizeClasses = size === "sm" ? "w-8 h-8" : size === "lg" ? "w-16 h-16" : "w-11 h-11";

  async function handleSave() {
    const url = urlInput.trim();
    if (!url) { setError("Paste an image URL above."); return; }
    if (!/^https?:\/\/.+\..+/i.test(url)) { setError("Must be a full http/https URL."); return; }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/${playerId}/avatar`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Save failed");
      }
      await queryClient.invalidateQueries();
      setEditing(false);
      setUrlInput("");
    } catch (err: any) {
      setError(err.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div
          className={`relative ${sizeClasses} rounded-full cursor-pointer group`}
          onClick={() => { setEditing(true); setUrlInput(currentAvatarUrl ?? ""); setError(null); }}
          title="Change profile picture"
        >
          <AvatarImg src={currentAvatarUrl} username={username} size={size} />
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
            <Camera className="w-4 h-4 text-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 w-full max-w-xs">
      <div className={`relative ${sizeClasses} rounded-full`}>
        <AvatarImg src={urlInput || currentAvatarUrl} username={username} size={size} />
      </div>
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 bg-black/30 border border-white/10 rounded-lg px-2 py-1.5">
          <Link className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
          <input
            autoFocus
            type="url"
            placeholder="https://example.com/photo.jpg"
            value={urlInput}
            onChange={e => { setUrlInput(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            className="flex-1 bg-transparent text-xs text-white placeholder:text-white/25 outline-none min-w-0"
          />
        </div>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <div className="flex gap-1.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-1 bg-primary/80 hover:bg-primary text-white text-xs font-semibold rounded-md py-1.5 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => { setEditing(false); setUrlInput(""); setError(null); }}
            className="px-2 py-1.5 text-xs text-white/50 hover:text-white border border-white/10 rounded-md transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
