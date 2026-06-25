import { useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useActivityPing(game: string, token: string | null) {
  useEffect(() => {
    if (!token) return;
    const ping = () => {
      fetch(`${BASE}/api/players/ping`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ game }),
      })
        .then((r) => {
          if (!r.ok) {
            console.warn(`[activity-ping] ${game} ping rejected: HTTP ${r.status}`);
          }
        })
        .catch((e) => {
          console.warn(`[activity-ping] ${game} ping failed:`, e);
        });
    };
    ping();
    const iv = setInterval(ping, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [game, token]);
}
