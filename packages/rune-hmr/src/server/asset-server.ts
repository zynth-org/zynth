import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { AssetManifest } from "../bundler/asset-manifest.js";
import { Logger } from "./logger.js";

export class AssetServer {
  private app: Hono;
  private manifest: AssetManifest;
  private logger = new Logger();
  private appRoot: string;
  private outDir: string;

  constructor(
    app: Hono,
    config: { appRoot: string; outDir: string; baseUrl: string }
  ) {
    this.app = app;
    this.appRoot = config.appRoot;
    this.outDir = config.outDir;
    this.manifest = new AssetManifest(config.baseUrl);
    this.setupRoutes();
  }

  /**
   * Setup all HTTP routes
   */
  private setupRoutes(): void {
    // Handler for serving bundle
    const serveBundle = async (c: any) => {
      const bundlePath = path.resolve(this.appRoot, this.outDir, "main.js");

      if (!fs.existsSync(bundlePath)) {
        this.logger.warn("Bundle not found, build may not be ready");
        return c.json({ error: "Bundle not ready" }, 404);
      }

      try {
        const bundle = fs.readFileSync(bundlePath, "utf-8");
        const stats = fs.statSync(bundlePath);

        this.logger.bundleRequested("client");

        return c.text(bundle, 200, {
          "Content-Type": "application/javascript",
          "Content-Length": String(stats.size),
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });
      } catch (error) {
        this.logger.error("Failed to serve bundle", error as Error);
        return c.json({ error: "Failed to read bundle" }, 500);
      }
    };

    // Serve the main bundle (new path)
    this.app.get("/bundle/main.js", serveBundle);

    // Serve the main bundle (legacy path for compatibility)
    this.app.get("/rune-native/bundle", serveBundle);

    // Serve source map
    this.app.get("/bundle/main.js.map", async (c) => {
      const mapPath = path.resolve(this.appRoot, this.outDir, "main.js.map");

      if (!fs.existsSync(mapPath)) {
        return c.json({ error: "Source map not found" }, 404);
      }

      try {
        const sourceMap = fs.readFileSync(mapPath, "utf-8");
        return c.text(sourceMap, 200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        });
      } catch (error) {
        return c.json({ error: "Failed to read source map" }, 500);
      }
    });

    // Serve asset manifest
    this.app.get("/asset-manifest.json", async (c) => {
      const manifest = this.manifest.toJSON();
      return c.json(manifest);
    });

    // Serve static assets
    const assetsPath = path.resolve(this.appRoot, "public", "assets");
    if (fs.existsSync(assetsPath)) {
      this.app.get("/assets/*", async (c) => {
        const requestPath = c.req.path.replace("/assets/", "");
        const filePath = path.resolve(assetsPath, requestPath);

        // Security: ensure path is within assets directory
        if (!filePath.startsWith(assetsPath)) {
          return c.json({ error: "Invalid path" }, 403);
        }

        if (!fs.existsSync(filePath)) {
          return c.json({ error: "Asset not found" }, 404);
        }

        try {
          const file = fs.readFileSync(filePath);
          const ext = path.extname(filePath).toLowerCase();
          const contentType = this.getContentType(ext);

          return c.body(file, 200, {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000", // Cache assets for 1 year in dev
          });
        } catch (error) {
          return c.json({ error: "Failed to read asset" }, 500);
        }
      });
    }

    // Health check endpoint
    this.app.get("/health", async (c) => {
      return c.json({
        status: "ok",
        timestamp: Date.now(),
        bundle: fs.existsSync(
          path.resolve(this.appRoot, this.outDir, "main.js")
        ),
      });
    });

    // Root endpoint with server info
    this.app.get("/", async (c) => {
      return c.json({
        name: "Rune HMR Server",
        version: "0.1.0",
        endpoints: {
          bundle: "/bundle/main.js",
          assets: "/assets/*",
          manifest: "/asset-manifest.json",
          websocket: "ws://[host]:[port]/rune-native",
          health: "/health",
        },
      });
    });
  }

  /**
   * Scan and register all assets
   */
  scanAssets(): void {
    const assetsPath = path.resolve(this.appRoot, "public", "assets");

    if (!fs.existsSync(assetsPath)) {
      this.logger.warn("Assets directory not found at public/assets");
      return;
    }

    this.manifest.clear();
    this.manifest.scanDirectory(assetsPath);

    const count = this.manifest.size;
    if (count > 0) {
      this.logger.assetScanned(count);
    }
  }

  /**
   * Get content type for file extension
   */
  private getContentType(ext: string): string {
    const types: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".json": "application/json",
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
      ".txt": "text/plain",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ttf": "font/ttf",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };

    return types[ext] || "application/octet-stream";
  }

  /**
   * Get the asset manifest
   */
  getManifest(): AssetManifest {
    return this.manifest;
  }
}
