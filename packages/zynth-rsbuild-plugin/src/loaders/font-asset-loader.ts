import crypto from "node:crypto";
import path from "node:path";

interface FontAssetDescriptor {
  type: "font";
  name: string;
  ext: string;
  hash: string;
  relativePath?: string;
  devPath?: string;
}

/**
 * Custom Rspack loader that transforms font imports into FontAssetDescriptor objects.
 * In development, includes the absolute file path for serving via dev server.
 * In production, includes a hash for bundled assets.
 */
export default function fontAssetLoader(this: any, content: Buffer): string {
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

  const descriptor: FontAssetDescriptor = {
    type: "font",
    name: parsed.name,
    ext: parsed.ext.slice(1), // Remove leading dot
    hash,
  };

  // In development, include the absolute path for dev server serving
  if (isDev) {
    descriptor.devPath = absolutePath;
  } else if (isWeb) {
    const fileName = `assets/${parsed.name}-${hash}.${parsed.ext.slice(1)}`;
    this.emitFile(fileName, content);
    descriptor.relativePath = fileName;
  }

  // Return the descriptor as a module export
  return `export default ${JSON.stringify(descriptor)};`;
}

// We need to read the file as a buffer to calculate the hash,
// but we're returning JavaScript code, so mark this as raw input only
export const raw = true;
