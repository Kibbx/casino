import { useEffect, useRef } from "react";
import { useWs } from "./WsContext";

/**
 * Tracks which game page the player is currently on via the shared WS.
 * Uses _addSub so the page message is automatically re-sent after reconnects.
 * Replaces the old useActivityPing HTTP polling approach entirely.
 */
export function usePageTracker(page: string, token: string | null) {
  const { _addSub, _removeSub, send } = useWs();
  const msgRef = useRef<object | null>(null);

  useEffect(() => {
    if (!token) return;

    const msg = { type: "player_page", page, token };
    msgRef.current = msg;
    _addSub(msg);

    console.log("[page-tracker] tracking:", page);

    // Refresh every 2 minutes so the activity window never expires while
    // the player is on the page (the server window is 3 minutes).
    const iv = setInterval(() => send(msg), 2 * 60 * 1000);

    return () => {
      clearInterval(iv);
      if (msgRef.current) _removeSub(msgRef.current);
      msgRef.current = null;
    };
  }, [page, token, _addSub, _removeSub, send]);
}
