import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";

type MessageHandler = (msg: any) => void;

interface WsContextValue {
  send: (msg: object) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  connected: boolean;
}

const WsContext = createContext<WsContextValue | null>(null);

export function WsProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const mountedRef = useRef(true);
  // Track all active subscriptions so they can be re-sent after reconnect
  const subscriptionsRef = useRef<object[]>([]);

  const dispatch = useCallback((msg: any) => {
    const handlers = handlersRef.current.get(msg.type);
    if (handlers) handlers.forEach((h) => h(msg));
  }, []);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback((type: string, handler: MessageHandler): (() => void) => {
    if (!handlersRef.current.has(type)) handlersRef.current.set(type, new Set());
    handlersRef.current.get(type)!.add(handler);
    return () => handlersRef.current.get(type)?.delete(handler);
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) { ws.close(); return; }
      setConnected(true);
      reconnectDelay.current = 1000;
      // Re-send all active subscriptions after reconnect
      for (const sub of subscriptionsRef.current) {
        ws.send(JSON.stringify(sub));
      }
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try { dispatch(JSON.parse(event.data as string)); } catch {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      wsRef.current = null;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, 10_000);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => { ws.close(); };
  }, [dispatch]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);

    return () => {
      mountedRef.current = false;
      clearInterval(pingInterval);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Expose a way for hooks to register their subscription messages
  const contextValue: WsContextValue & { _addSub: (msg: object) => void; _removeSub: (msg: object) => void } = {
    connected,
    send,
    subscribe,
    _addSub: (msg: object) => {
      subscriptionsRef.current.push(msg);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg));
      }
    },
    _removeSub: (msg: object) => {
      subscriptionsRef.current = subscriptionsRef.current.filter((s) => s !== msg);
    },
  };

  return <WsContext.Provider value={contextValue}>{children}</WsContext.Provider>;
}

export function useWs(): WsContextValue & { _addSub: (msg: object) => void; _removeSub: (msg: object) => void } {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used inside <WsProvider>");
  return ctx as any;
}
