import { useEffect, useRef } from "react";

const POLL_INTERVAL_MS = 60_000;

export function useVersionCheck() {
  const knownVersion = useRef<number | null>(null);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const v = data.version as number;
        if (knownVersion.current === null) {
          knownVersion.current = v;
        } else if (knownVersion.current !== v) {
          window.location.reload();
        }
      } catch {
        // network blip — ignore
      }
    }

    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
