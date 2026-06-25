import { useState, useEffect, useRef } from "react";
import { useWs } from "./WsContext";

export function useLobbySocket() {
  const { subscribe, _addSub, _removeSub, connected } = useWs();
  const [tables, setTables] = useState<any[] | null>(null);
  const subMsgRef = useRef<object>({ type: "subscribe_lobby" });

  useEffect(() => {
    const msg = subMsgRef.current;
    _addSub(msg);

    const unsub = subscribe("tables_update", (m) => {
      if (Array.isArray(m.tables)) setTables(m.tables);
    });

    return () => {
      unsub();
      _removeSub(msg);
    };
  }, [subscribe, _addSub, _removeSub]);

  return { tables, connected };
}
