const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

/**
 * Custom Rspack loader that transforms image imports into ImageAssetDescriptor objects.
 */
function imageAssetLoader(content) {
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

  const descriptor = {
    type: "asset",
    name: baseName,
    ext: parsed.ext.slice(1),
    hash,
    scale,
  };

  // Record image in manifest
  try {
    const distDir = path.resolve(this.rootContext, "dist");
    const manifestDir = path.join(distDir, "assets");
    const manifestPath = path.join(manifestDir, "images-manifest.json");

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    let manifest = {};
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
  } catch (_error) {}

  if (isDev) {
    descriptor.devPath = absolutePath;
  } else if (isWeb) {
    const fileName = `assets/${baseName}-${hash}.${parsed.ext.slice(1)}`;
    this.emitFile(fileName, content);
    descriptor.relativePath = fileName;
  }

  return `module.exports = ${JSON.stringify(descriptor)};`;
}

module.exports = imageAssetLoader;
module.exports.raw = true;
