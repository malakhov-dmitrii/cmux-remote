import { useCallback, useEffect, useRef, useState } from "react";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseWebSocketOptions {
  url: string;
  onMessage: (data: string) => void;
  onDisconnect: () => void;
}

export function useWebSocket({ url, onMessage, onDisconnect }: UseWebSocketOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const callbacks = useRef({ onMessage, onDisconnect });
  callbacks.current = { onMessage, onDisconnect };

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionAttempt is an explicit request to replace the current socket.
  useEffect(() => {
    let disposed = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return;
        retries = 0;
        setStatus("connected");
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (!disposed && socketRef.current === socket && typeof event.data === "string") {
          callbacks.current.onMessage(event.data);
        }
      };
      socket.onclose = () => {
        if (disposed || socketRef.current !== socket) return;
        socketRef.current = null;
        callbacks.current.onDisconnect();
        setStatus("disconnected");
        if (retries < 10) timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 30_000));
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      callbacks.current.onDisconnect();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [url, connectionAttempt]);

  const send = useCallback((data: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(data);
    return true;
  }, []);

  const reconnect = useCallback(() => setConnectionAttempt((attempt) => attempt + 1), []);
  return { status, send, reconnect };
}
