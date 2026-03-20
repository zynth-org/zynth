import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

interface ImageAssetDescriptor {
  type: "asset";
  name: string;
  ext: string;
  hash: string;
  scale?: number;
  relativePath?: string;
  devPath?: string;
}

/**
 * Custom Rspack loader that transforms image imports into ImageAssetDescriptor objects.
 * In development, includes the absolute file path for serving via dev server.
 * In production, includes a hash for bundled assets.
 */
export default function imageAssetLoader(this: any, content: Buffer): string {
  const mode =
    this.mode || this._compilation?.options?.mode || process.env?.NODE_ENV;
  const isDev = mode !== "production";
  const isWeb = process.env?.ZYNTH_PLATFORM === "web";
  const absolutePath = this.resourcePath;
  const parsed = path.parse(absolutePath);

  // Generate content hash
  const hash = crypto
    .createHash("sha256")
    .update(content)
    .digest("hex")
    .substring(0, 8);

  // Extract scale from filename (e.g., icon@2x.png -> 2)
  const scaleMatch = parsed.name.match(/@(\d+)x$/);
  const scale = scaleMatch ? parseInt(scaleMatch[1], 10) : undefined;
  const baseName = scaleMatch ? parsed.name.replace(/@\d+x$/, "") : parsed.name;

  const descriptor: ImageAssetDescriptor = {
    type: "asset",
    name: baseName,
    ext: parsed.ext.slice(1), // Remove leading dot
    hash,
    scale,
  };

  // Record image in manifest for native build discovery
  try {
    const distDir = path.resolve(this.rootContext, "dist");
    const manifestDir = path.join(distDir, "assets");
    const manifestPath = path.join(manifestDir, "images-manifest.json");

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    let manifest: Record<string, string> = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (_error) {
        manifest = {};
      }
    }

    const nativeAssetId = `${baseName}-${hash}.${parsed.ext.slice(1)}`;
    manifest[`images/${nativeAssetId}`] = absolutePath;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (_error) {
    // Ignore manifest write errors (might happen in some environments)
  }

  // In development, include the absolute path for dev server serving
  if (isDev) {
    descriptor.devPath = absolutePath;
  } else if (isWeb) {
    const fileName = `assets/${baseName}-${hash}.${parsed.ext.slice(1)}`;
    this.emitFile(fileName, content);
    descriptor.relativePath = fileName;
  }

  // Return the descriptor as a module export
  return `export default ${JSON.stringify(descriptor)};`;
}

// We need to read the file as a buffer to calculate the hash,
// but we're returning JavaScript code, so mark this as raw input only
export const raw = true;
