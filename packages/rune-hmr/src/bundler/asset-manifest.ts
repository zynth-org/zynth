import fs from "node:fs";
import path from "node:path";
import type { AssetManifestEntry } from "../types/index.js";

export class AssetManifest {
  private assets = new Map<string, AssetManifestEntry>();
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Register an asset with its local path and generate a public URL
   */
  register(localPath: string, relativePath: string): void {
    const publicUrl = `${this.baseUrl}/assets/${relativePath}`;

    let size: number | undefined;
    try {
      const stats = fs.statSync(localPath);
      size = stats.size;
    } catch (e) {
      // Ignore if file doesn't exist yet
    }

    this.assets.set(relativePath, {
      url: publicUrl,
      path: localPath,
      size,
    });
  }

  /**
   * Resolve a relative asset path to its public URL
   */
  resolve(relativePath: string): string | null {
    return this.assets.get(relativePath)?.url || null;
  }

  /**
   * Scan a directory and register all assets
   */
  scanDirectory(dirPath: string, baseDir: string = dirPath): void {
    if (!fs.existsSync(dirPath)) {
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        this.scanDirectory(fullPath, baseDir);
      } else {
        const relativePath = path.relative(baseDir, fullPath);
        this.register(fullPath, relativePath);
      }
    }
  }

  /**
   * Get all registered assets
   */
  getAll(): Map<string, AssetManifestEntry> {
    return new Map(this.assets);
  }

  /**
   * Convert manifest to JSON for serving to clients
   */
  toJSON(): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [relativePath, entry] of this.assets) {
      result[relativePath] = entry.url;
    }

    return result;
  }

  /**
   * Clear all registered assets
   */
  clear(): void {
    this.assets.clear();
  }

  /**
   * Get the number of registered assets
   */
  get size(): number {
    return this.assets.size;
  }
}
