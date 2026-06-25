import { useState, useEffect, useRef } from "react";
import { useWs } from "./WsContext";

export interface BlindInfo {
  levelIndex: number;
  totalLevels: number;
  timeToNextLevel: number | null;
  smallBlind: number;
  bigBlind: number;
}

export function useTableSocket(tableId: number, playerId: number | null) {
  const { subscribe, _addSub, _removeSub, connected, send } = useWs();
  const [table, setTable] = useState<any>(null);
  const [blindInfo, setBlindInfo] = useState<BlindInfo | null>(null);
  const subMsgRef = useRef<object | null>(null);

  useEffect(() => {
    const msg = { type: "subscribe", tableId, playerId };
    subMsgRef.current = msg;
    _addSub(msg);

    const onUpdate = (m: any) => { if (m.table) setTable(m.table); };
    const onBlindEvent = (m: any) => {
      if (m.tableId === tableId) {
        setBlindInfo({
          levelIndex: m.levelIndex,
          totalLevels: m.totalLevels,
          timeToNextLevel: m.timeToNextLevel,
          smallBlind: m.smallBlind,
          bigBlind: m.bigBlind,
        });
        if (m.type === "table:blindsUpdated" || m.type === "table:levelUp") {
          setTable((prev: any) => prev ? { ...prev, smallBlind: m.smallBlind, bigBlind: m.bigBlind } : prev);
        }
      }
    };

    const unsub = subscribe("table_state_update", onUpdate);
    const unsubBU = subscribe("table:blindsUpdated", onBlindEvent);
    const unsubLU = subscribe("table:levelUp", onBlindEvent);
    const unsubR  = subscribe("table:reset",   onBlindEvent);

    return () => {
      unsub();
      unsubBU();
      unsubLU();
      unsubR();
      if (subMsgRef.current) _removeSub(subMsgRef.current);
    };
  }, [tableId, playerId, subscribe, _addSub, _removeSub]);

  function sendAction(token: string, action: string, amount?: number, afk = false) {
    send({ type: "player_action", tableId, playerId, token, action, amount: amount ?? 0, afk });
  }

  return { table, connected, sendAction, blindInfo };
}
