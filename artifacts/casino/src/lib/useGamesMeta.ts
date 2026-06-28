import { useState, useEffect, useRef } from "react";

export interface GameMeta {
  currentPlayers: number;
  minBet: number;
  maxBet: number;
  status: "open" | "live" | "closed";
  hasPassword: boolean;
}

const BASE = import.meta.env.BASE_URL;
const POLL_MS = 15_000;

export function fmtBet(n: number): string {
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString()}`;
}

export function formatBetRange(minBet: number, maxBet: number): string {
  return `${fmtBet(minBet)} – ${fmtBet(maxBet)}`;
}

export function useGamesMeta(): {
  meta: Record<string, GameMeta>;
  loading: boolean;
} {
  const [meta, setMeta]       = useState<Record<string, GameMeta>>({});
  const [loading, setLoading] = useState(true);
  const abortRef              = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;

    async function poll() {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const resp = await window.fetch(`${BASE}api/games`, { signal: ctrl.signal });
        if (!resp.ok || !alive) return;
        const data: Record<string, GameMeta> = await resp.json();
        setMeta(data);
        setLoading(false);
      } catch {
        /* ignore abort / network errors */
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, []);

  return { meta, loading };
}
