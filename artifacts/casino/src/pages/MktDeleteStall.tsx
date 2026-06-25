import { useState, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, Trash2, X, Loader2, ShieldAlert } from "lucide-react";
import { deleteShop } from "./shopStore";

/* ═══════════════════════════════════════════════════════════════
   useDeleteStall — hook/service layer
   Structured for future API integration; currently mock.
   ══════════════════════════════════════════════════════════════ */
interface DeleteStallState {
  deleting:  boolean;
  deleted:   boolean;
  error:     string | null;
}

export function useDeleteStall() {
  const [state, setState] = useState<DeleteStallState>({
    deleting: false,
    deleted:  false,
    error:    null,
  });
  const guardRef = useRef(false); // prevents duplicate requests

  const deleteStall = useCallback(async (slug: string, stallName: string) => {
    if (guardRef.current) return; // duplicate-deletion guard
    guardRef.current = true;
    setState({ deleting: true, deleted: false, error: null });

    console.info(`[DeleteStall] request started — slug="${slug}", name="${stallName}"`);

    try {
      // Delegates to shopStore.deleteShop which handles:
      //   • mock network delay (replace setTimeout with real fetch for production)
      //   • removing from in-memory _shops array
      //   • persisting deleted slug to localStorage
      //   • setting pending toast for the Shops page
      const success = await deleteShop(slug);

      console.info(`[DeleteStall] deleteShop("${slug}") returned:`, success);

      if (!success) {
        // Shop was already removed or slug was wrong — treat as success
        // (idempotent deletion is safe; the stall is gone either way)
        console.warn(`[DeleteStall] slug "${slug}" was not found in store — may already be deleted`);
      }

      guardRef.current = false;
      console.info(`[DeleteStall] ✓ redirect triggered for "${stallName}"`);
      setState({ deleting: false, deleted: true, error: null });
    } catch (err) {
      guardRef.current = false;
      console.error(`[DeleteStall] ✗ deletion failed:`, err);
      setState({
        deleting: false,
        deleted:  false,
        error:    "Deletion failed — please try again. If the problem persists, contact support.",
      });
    }
  }, []);

  function reset() {
    guardRef.current = false;
    setState({ deleting: false, deleted: false, error: null });
  }

  return { ...state, deleteStall, reset };
}

/* ═══════════════════════════════════════════════════════════════
   DeleteStallModal
   ══════════════════════════════════════════════════════════════ */
interface DeleteStallModalProps {
  stallName: string;
  deleting:  boolean;
  error:     string | null;
  onConfirm: () => void;
  onCancel:  () => void;
}

export function DeleteStallModal({
  stallName, deleting, error, onConfirm, onCancel,
}: DeleteStallModalProps) {
  const [typed, setTyped]     = useState("");
  const inputRef              = useRef<HTMLInputElement>(null);
  const confirmed             = typed === stallName;

  // Trap focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !deleting) onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleting, onCancel]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 flex items-center justify-center z-50 px-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={e => { if (e.target === e.currentTarget && !deleting) onCancel(); }}
    >
      {/* Panel */}
      <div
        className="w-full rounded-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 480, background: "#0c0a0a", border: "1px solid rgba(239,68,68,0.25)", boxShadow: "0 8px 48px rgba(239,68,68,0.18)" }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <ShieldAlert size={20} style={{ color: "#ef4444" }} />
            </div>
            <div>
              <h2 className="font-orbitron text-white text-[15px] font-black uppercase tracking-wide">
                Delete Stall
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                This action is permanent and irreversible.
              </p>
            </div>
          </div>
          {!deleting && (
            <button onClick={onCancel}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ color: "rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.05)", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.3)"; }}
            ><X size={14} /></button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Warning block */}
          <div className="rounded-xl px-4 py-3.5 flex gap-3"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: "#ef4444" }} />
            <p className="text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.65)" }}>
              Deleting <span className="font-black text-white">"{stallName}"</span> will permanently remove your shop
              profile, customizations, banners, featured sections, followers, and all active listings.{" "}
              <span style={{ color: "#ef4444" }} className="font-bold">This action cannot be undone.</span>
            </p>
          </div>

          {/* What will be deleted */}
          <div className="flex flex-col gap-1.5">
            {[
              "Shop profile and all customizations",
              "All active listings and item data",
              "Active auctions owned by this stall",
              "Followers and shop metadata",
              "Cached stall data and analytics",
            ].map(item => (
              <div key={item} className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: "#ef4444" }} />
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.45)" }}>{item}</p>
              </div>
            ))}
          </div>

          {/* Confirmation input */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider mb-2"
              style={{ color: "rgba(255,255,255,0.4)" }}>
              Type <span className="font-black" style={{ color: "#ef4444" }}>"{stallName}"</span> to confirm
            </label>
            <input
              ref={inputRef}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              disabled={deleting}
              placeholder={stallName}
              className="w-full px-3 py-2.5 rounded-xl text-[13px]"
              style={{
                background:  "rgba(239,68,68,0.05)",
                border:      confirmed ? "1px solid rgba(239,68,68,0.55)" : "1px solid rgba(255,255,255,0.09)",
                color:       confirmed ? "#ef4444" : "rgba(255,255,255,0.7)",
                outline:     "none",
                fontWeight:  confirmed ? 800 : 400,
                transition:  "all 0.15s",
              }}
            />
            {typed.length > 0 && !confirmed && (
              <p className="text-[10px] mt-1.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                Name must match exactly — including capitalisation.
              </p>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="px-3 py-2.5 rounded-xl text-[11px] font-bold"
              style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.25)", color: "#ef4444" }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wide"
            style={{
              color:      "rgba(255,255,255,0.55)",
              background: "rgba(255,255,255,0.04)",
              border:     "1px solid rgba(255,255,255,0.09)",
              opacity:    deleting ? 0.4 : 1,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => { if (!deleting) (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)"; }}
          >
            Cancel
          </button>

          <button
            onClick={() => { if (confirmed && !deleting) onConfirm(); }}
            disabled={!confirmed || deleting}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wide"
            style={{
              color:      "#fff",
              background: confirmed && !deleting
                ? "linear-gradient(135deg,#dc2626,#991b1b)"
                : "rgba(255,255,255,0.06)",
              border:     confirmed && !deleting
                ? "1px solid rgba(220,38,38,0.5)"
                : "1px solid rgba(255,255,255,0.08)",
              boxShadow:  confirmed && !deleting ? "0 0 18px rgba(220,38,38,0.35)" : "none",
              cursor:     confirmed && !deleting ? "pointer" : "not-allowed",
              transition: "all 0.2s",
            }}
          >
            {deleting ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 size={13} />
                Delete Stall
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DeleteStallButton — standalone reusable trigger button
   ══════════════════════════════════════════════════════════════ */
interface DeleteStallButtonProps {
  onClick: () => void;
}

export function DeleteStallButton({ onClick }: DeleteStallButtonProps) {
  return (
    <div className="rounded-2xl p-5" style={{ background: "#0c0a0a", border: "1px solid rgba(239,68,68,0.18)" }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
          <AlertTriangle size={16} style={{ color: "#ef4444" }} />
        </div>
        <div>
          <p className="text-[13px] font-black uppercase tracking-wide text-white">Danger Zone</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "rgba(255,255,255,0.42)" }}>
            Permanently delete this stall and all associated listings, auctions, followers, and customizations.
            This cannot be undone.
          </p>
        </div>
      </div>
      <button
        onClick={onClick}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wide"
        style={{
          color:      "#ef4444",
          background: "rgba(239,68,68,0.08)",
          border:     "1px solid rgba(239,68,68,0.3)",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          const b = e.currentTarget as HTMLButtonElement;
          b.style.background = "rgba(239,68,68,0.18)";
          b.style.borderColor = "rgba(239,68,68,0.55)";
          b.style.boxShadow = "0 0 16px rgba(239,68,68,0.2)";
        }}
        onMouseLeave={e => {
          const b = e.currentTarget as HTMLButtonElement;
          b.style.background = "rgba(239,68,68,0.08)";
          b.style.borderColor = "rgba(239,68,68,0.3)";
          b.style.boxShadow = "none";
        }}
      >
        <Trash2 size={13} /> Delete Stall
      </button>
    </div>
  );
}
