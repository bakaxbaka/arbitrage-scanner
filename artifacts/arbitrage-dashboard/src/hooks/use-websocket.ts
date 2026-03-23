import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPricesQueryKey } from "@workspace/api-client-react";

type WsStatus = "connecting" | "connected" | "disconnected" | "error";

export function useWebSocket() {
  const [status, setStatus] = useState<WsStatus>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      setStatus("connecting");
      
      try {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws`;
        
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setStatus("connected");
        };

        ws.onclose = () => {
          setStatus("disconnected");
          // Exponential backoff or simple reconnect could go here
          reconnectTimeout = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          setStatus("error");
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            // If the message is a price update, optimistic UI cache update
            if (data.type === "PRICE_UPDATE" && data.payload) {
              // We invalidate or update the prices cache
              queryClient.invalidateQueries({
                queryKey: [getGetPricesQueryKey()[0]],
              });
            }
          } catch (e) {
            console.error("Failed to parse WS message", e);
          }
        };
      } catch (e) {
        setStatus("error");
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient]);

  return { status };
}
