import { useState, useEffect, useRef } from "react";
import { useWs } from "./WsContext";
import { setKickNotice } from "./kickNotice";

export function usePlayerSocket(
  playerId: number | null,
  token: string | null,
  onKick?: () => void,
) {
  const { subscribe, _addSub, _removeSub, connected } = useWs();
  const [chips, setChips] = useState<number | null>(null);
  const subMsgRef = useRef<object | null>(null);
  const onKickRef = useRef(onKick);
  onKickRef.current = onKick;

  useEffect(() => {
    if (!playerId || !token) return;

    const msg = { type: "subscribe_player", playerId, token };
    subMsgRef.current = msg;
    _addSub(msg);

    const unsubChip = subscribe("chip_update", (m) => {
      if (typeof m.chips === "number") setChips(m.chips);
    });

    const unsubKick = subscribe("force_kick", (m) => {
      const staffName = m.kickedBy ? ` by ${m.kickedBy}` : "";
      setKickNotice(`You were removed from the game${staffName}.`);
      onKickRef.current?.();
    });

    return () => {
      unsubChip();
      unsubKick();
      if (subMsgRef.current) _removeSub(subMsgRef.current);
    };
  }, [playerId, token, subscribe, _addSub, _removeSub]);

  return { chips, connected };
}
