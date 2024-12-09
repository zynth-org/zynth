import { WebSocket, WebSocketServer } from "ws";
import type {
  ClientMessage,
  DevClientInfo,
  HMRMessage,
} from "../types/index.js";
import { Logger } from "./logger.js";

interface ConnectedClient {
  ws: WebSocket;
  info: DevClientInfo;
  connectedAt: number;
}

export class WebSocketHandler {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ConnectedClient>();
  private logger = new Logger();

  /**
   * Initialize WebSocket server
   */
  initialize(server: any, path: string = "/rune-native"): void {
    this.wss = new WebSocketServer({
      server,
      path,
      clientTracking: true,
    });

    this.wss.on("connection", (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on("error", (error) => {
      this.logger.error("WebSocket server error", error);
    });
  }

  /**
   * Handle new client connection
   */
  private handleConnection(ws: WebSocket, _req: any): void {
    const clientInfo: DevClientInfo = {
      platform: "ios", // Will be updated on handshake
    };

    const client: ConnectedClient = {
      ws,
      info: clientInfo,
      connectedAt: Date.now(),
    };

    this.clients.set(ws, client);

    // Send initial handshake request
    this.send(ws, {
      type: "handshake-request",
      timestamp: Date.now(),
    });

    ws.on("message", (data) => {
      this.handleMessage(ws, data);
    });

    ws.on("close", () => {
      this.handleDisconnect(ws);
    });

    ws.on("error", (error) => {
      this.logger.error(`WebSocket error for ${client.info.platform}`, error);
    });

    // Send ping every 30 seconds to keep connection alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.send(ws, { type: "ping", timestamp: Date.now() });
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(ws: WebSocket, data: any): void {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      const client = this.clients.get(ws);

      if (!client) return;

      switch (message.event) {
        case "rune:hello":
          // Client handshake with platform info
          if (message.data) {
            client.info = {
              ...client.info,
              ...message.data,
            };
            this.logger.clientHandshake(message.data);
            this.logger.clientConnected(
              client.info.platform,
              client.info.deviceId || client.info.version
            );
          }
          break;

        case "rune:ping":
          // Respond to ping
          this.send(ws, { type: "pong", timestamp: Date.now() });
          break;

        case "rune:bundle-request":
          // Client requested bundle
          this.logger.bundleRequested(client.info.platform);
          break;

        default:
          this.logger.debug(
            `Unknown message from ${client.info.platform}: ${message.event}`
          );
      }
    } catch (error) {
      this.logger.error("Failed to parse client message", error as Error);
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      this.logger.clientDisconnected(client.info.platform);
      this.clients.delete(ws);
    }
  }

  /**
   * Send message to specific client
   */
  private send(ws: WebSocket, message: HMRMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: HMRMessage): void {
    const payload = JSON.stringify(message);
    let sentCount = 0;

    this.clients.forEach((_client, ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      this.logger.updateSent(sentCount);
    }
  }

  /**
   * Send message to clients of a specific platform
   */
  broadcastToPlatform(platform: "ios" | "android", message: HMRMessage): void {
    const payload = JSON.stringify(message);
    let sentCount = 0;

    this.clients.forEach((client, ws) => {
      if (
        client.info.platform === platform &&
        ws.readyState === WebSocket.OPEN
      ) {
        ws.send(payload);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      this.logger.updateSent(sentCount);
    }
  }

  /**
   * Get all connected clients
   */
  getClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Close all connections and cleanup
   */
  close(): void {
    this.clients.forEach((_client, ws) => {
      ws.close();
    });
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
