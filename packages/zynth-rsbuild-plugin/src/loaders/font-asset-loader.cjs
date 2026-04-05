const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

/**
 * Custom Rspack loader that transforms font imports into FontAssetDescriptor objects.
 */
function fontAssetLoader(content) {
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

  const descriptor = {
    type: "font",
    name: parsed.name,
    ext: parsed.ext.slice(1),
    hash,
  };

  // Record font in manifest
  try {
    const distDir = path.resolve(this.rootContext, "dist");
    const manifestDir = path.join(distDir, "assets");
    const manifestPath = path.join(manifestDir, "fonts-manifest.json");

    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }

    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (e) {
        manifest = {};
      }
    }

    const fontFileName = `${parsed.name}.${parsed.ext.slice(1)}`;
    manifest[fontFileName] = absolutePath;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (e) {}

  if (isDev) {
    descriptor.devPath = absolutePath;
  } else if (isWeb) {
    const fileName = `assets/${parsed.name}-${hash}.${parsed.ext.slice(1)}`;
    this.emitFile(fileName, content);
    descriptor.relativePath = fileName;
  }

  return `module.exports = ${JSON.stringify(descriptor)};`;
}

module.exports = fontAssetLoader;
module.exports.raw = true;
