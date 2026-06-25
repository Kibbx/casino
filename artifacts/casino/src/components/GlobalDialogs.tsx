import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle, Info } from "lucide-react";
import { subscribeToasts, type ToastMsg } from "../lib/toast";
import { subscribeConfirm, dismissConfirm, type ConfirmReq } from "../lib/confirm";

export function GlobalDialogs() {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);

  useEffect(() => {
    const u1 = subscribeToasts(setToasts);
    const u2 = subscribeConfirm(setConfirm);
    return () => { u1(); u2(); };
  }, []);

  return (
    <>
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.18 }}
              className="flex items-start gap-3 px-4 py-3 rounded-xl shadow-2xl pointer-events-auto"
              style={{
                background: t.type === "error" ? "rgba(28,4,4,0.97)" : t.type === "success" ? "rgba(4,22,10,0.97)" : "rgba(8,12,28,0.97)",
                border: `1px solid ${t.type === "error" ? "rgba(239,68,68,0.45)" : t.type === "success" ? "rgba(34,197,94,0.45)" : "rgba(99,102,241,0.45)"}`,
              }}
            >
              {t.type === "error"   && <AlertCircle  className="w-4 h-4 text-red-400   shrink-0 mt-0.5" />}
              {t.type === "success" && <CheckCircle  className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />}
              {t.type === "info"    && <Info         className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />}
              <p className="text-sm text-white leading-relaxed">{t.msg}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {confirm && (
          <motion.div
            key={confirm.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] flex items-end justify-center pb-10 px-4"
            style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)" }}
            onClick={e => { if (e.target === e.currentTarget) dismissConfirm(); }}
          >
            <motion.div
              initial={{ y: 36, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="w-full max-w-sm rounded-2xl p-5 space-y-4"
              style={{
                background: "rgba(16,4,4,0.98)",
                border: "1px solid rgba(239,68,68,0.28)",
                boxShadow: "0 0 60px rgba(0,0,0,0.85)",
              }}
            >
              <p className="text-sm text-zinc-200 leading-relaxed">{confirm.msg}</p>
              <div className="flex gap-3">
                <button
                  onClick={dismissConfirm}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-zinc-400 hover:text-white transition-colors"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { const fn = confirm.onConfirm; dismissConfirm(); fn(); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                  style={{ background: "linear-gradient(135deg,#CC0000,#8B0000)", border: "1px solid rgba(255,100,100,0.3)" }}
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
