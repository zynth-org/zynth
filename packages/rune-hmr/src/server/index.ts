import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import type { RuneHMRServerConfig, BundleInfo } from "../types/index.js";
import { Logger } from "./logger.js";
import { WebSocketHandler } from "./websocket.js";
import { AssetServer } from "./asset-server.js";
import { BundleWatcher } from "./bundle-watcher.js";

/**
 * Main HMR server class that orchestrates all components
 */
export class RuneHMRServer {
  private logger = new Logger();
  private config: Required<RuneHMRServerConfig>;
  private app: Hono;
  private server: ServerType | null = null;
  private wsHandler: WebSocketHandler;
  private assetServer: AssetServer;
  private bundleWatcher: BundleWatcher;

  constructor(config: RuneHMRServerConfig) {
    this.config = {
      appRoot: config.appRoot,
      port: config.port,
      outDir: config.outDir || "dist",
      host: config.host || "localhost",
    };

    // Initialize Hono app
    this.app = new Hono();

    // Initialize WebSocket handler
    this.wsHandler = new WebSocketHandler();

    // Initialize asset server
    const baseUrl = `http://${this.config.host}:${this.config.port}`;
    this.assetServer = new AssetServer(this.app, {
      appRoot: this.config.appRoot,
      outDir: this.config.outDir,
      baseUrl,
    });

    // Initialize bundle watcher
    this.bundleWatcher = new BundleWatcher({
      appRoot: this.config.appRoot,
      outDir: this.config.outDir,
      mode: "development",
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for bundle watcher
   */
  private setupEventHandlers(): void {
    // Handle bundle ready
    this.bundleWatcher.on("bundle-ready", (bundleInfo: BundleInfo) => {
      // Rescan assets after build
      this.assetServer.scanAssets();

      // Notify all connected clients
      this.wsHandler.broadcast({
        type: "update",
        timestamp: Date.now(),
        data: {
          bundleSize: bundleInfo.size,
          bundlePath: "/bundle/main.js",
        },
      });
    });

    // Handle bundle error
    this.bundleWatcher.on("bundle-error", (error: Error) => {
      // Notify clients about error
      this.wsHandler.broadcast({
        type: "error",
        timestamp: Date.now(),
        data: {
          message: error.message,
          stack: error.stack,
        },
      });
    });
  }

  /**
   * Start the HMR server
   */
  async start(): Promise<void> {
    this.logger.info("Starting Rune HMR server...");

    // Start bundle watcher
    await this.bundleWatcher.start();

    // Scan initial assets
    this.assetServer.scanAssets();

    // Start HTTP server
    this.server = serve({
      fetch: this.app.fetch,
      port: this.config.port,
      hostname: this.config.host,
    });

    // Initialize WebSocket on the HTTP server
    this.wsHandler.initialize(this.server, "/rune-native");

    this.logger.serverStarted(this.config.port, this.config.host);
  }

  /**
   * Stop the HMR server
   */
  async stop(): Promise<void> {
    this.logger.info("Stopping Rune HMR server...");

    // Stop bundle watcher
    await this.bundleWatcher.stop();

    // Close WebSocket connections
    this.wsHandler.close();

    // Close HTTP server
    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.logger.serverStopped();
  }

  /**
   * Force rebuild the bundle
   */
  async rebuild(): Promise<void> {
    await this.bundleWatcher.rebuild();
  }

  /**
   * Get server information
   */
  getInfo() {
    return {
      host: this.config.host,
      port: this.config.port,
      clients: this.wsHandler.getClientCount(),
      building: this.bundleWatcher.building,
      bundleUrl: `http://${this.config.host}:${this.config.port}/bundle/main.js`,
      wsUrl: `ws://${this.config.host}:${this.config.port}/rune-native`,
    };
  }
}
