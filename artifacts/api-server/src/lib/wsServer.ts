import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { logger } from "./logger";

let wss: WebSocketServer | null = null;
const clients: Set<WebSocket> = new Set();

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ url: req.url }, "WebSocket client connected");
    clients.add(ws);

    ws.on("close", () => {
      clients.delete(ws);
      logger.info("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      clients.delete(ws);
    });

    ws.send(JSON.stringify({ type: "connected", message: "Connected to Arbitrage Scanner" }));
  });

  logger.info("WebSocket server initialized on /ws");
}

export function broadcast(type: string, data: unknown) {
  if (clients.size === 0) return;
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

export function getConnectedClients(): number {
  return clients.size;
}
