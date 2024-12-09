import { EventEmitter } from "node:events";
import { watch, type RolldownWatcher } from "rolldown";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RsbuildConfigOptions, BundleInfo } from "../types/index.js";
import { Logger } from "./logger.js";

export class BundleWatcher extends EventEmitter {
  private watcher: RolldownWatcher | null = null;
  private logger = new Logger();
  private config: RsbuildConfigOptions;
  private isBuilding = false;

  constructor(config: RsbuildConfigOptions) {
    super();
    this.config = config;
  }

  /**
   * Start watching for file changes using Rolldown
   */
  async start(): Promise<void> {
    // Try to load app's rolldown.config.ts
    const configPath = path.join(this.config.appRoot, "rolldown.config.ts");

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `Rolldown config not found at ${configPath}. Please create a rolldown.config.ts file.`
      );
    }

    this.logger.info(`Loading Rolldown config from ${configPath}`);

    // Import the config dynamically
    const configUrl = pathToFileURL(configPath).href;
    const configModule = await import(configUrl);
    const rolldownConfig = configModule.default;

    // Create Rolldown watcher
    this.watcher = watch(rolldownConfig);

    // Listen to watcher events
    this.watcher.on("event", (event: any) => {
      if (event.code === "START") {
        this.isBuilding = true;
        this.logger.bundleBuilding();
      } else if (event.code === "END") {
        this.isBuilding = false;

        // Get bundle info
        const bundlePath = path.resolve(
          this.config.appRoot,
          this.config.outDir,
          "main.js"
        );

        if (fs.existsSync(bundlePath)) {
          const bundleInfo = this.getBundleInfo(bundlePath);
          this.logger.bundleReady(bundlePath, bundleInfo.size);

          // Emit bundle-ready event
          this.emit("bundle-ready", bundleInfo);
        }
      } else if (event.code === "ERROR") {
        this.isBuilding = false;
        this.logger.bundleError(event.error);
        this.emit("bundle-error", event.error);
      }
    });

    this.logger.info("Rolldown watcher started");
  }

  /**
   * Get bundle information
   */
  private getBundleInfo(bundlePath: string): BundleInfo {
    const stats = fs.statSync(bundlePath);

    return {
      path: bundlePath,
      size: stats.size,
      timestamp: Date.now(),
      assets: [], // Could scan for referenced assets if needed
    };
  }

  /**
   * Build the bundle (not needed with Rolldown watch, included for compatibility)
   */
  async build(_reason: string = "Manual build"): Promise<void> {
    this.logger.info("Manual build not needed with Rolldown watch mode");
  }

  /**
   * Force a rebuild (not needed with Rolldown watch, included for compatibility)
   */
  async rebuild(): Promise<void> {
    this.logger.info("Manual rebuild not needed with Rolldown watch mode");
  }

  /**
   * Stop watching and cleanup
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    this.logger.info("Rolldown watcher stopped");
  }

  /**
   * Check if currently building
   */
  get building(): boolean {
    return this.isBuilding;
  }
}
