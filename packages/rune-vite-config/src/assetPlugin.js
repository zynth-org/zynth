import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".heic",
]);

function parseScaleFromFilename(filename) {
  const match = filename.match(/@(\d+(?:\.\d+)?)x$/);
  if (!match) {
    return { baseName: filename, scale: 1 };
  }
  const scale = parseFloat(match[1]);
  const baseName = filename.slice(0, match.index);
  return { baseName, scale: Number.isFinite(scale) ? scale : 1 };
}

function computeHash(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

export function runeAssetPlugin(options = {}) {
  const appRoot = options.appRoot ? path.resolve(options.appRoot) : process.cwd();

  return {
    name: "rune-assets",
    enforce: "pre",
    async load(id) {
      const ext = path.extname(id).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) {
        return null;
      }

      const fileBuffer = await fs.readFile(id);
      const hash = computeHash(fileBuffer).slice(0, 16);
      const fileName = path.basename(id, ext);
      const { baseName, scale } = parseScaleFromFilename(fileName);
      const relativeDir = path.relative(appRoot, path.dirname(id)).split(path.sep).join("/");
      const normalizedPath = id.split(path.sep).join("/");

      const descriptor = {
        type: "asset",
        name: baseName,
        ext,
        hash,
        scale,
        relativePath: relativeDir.length ? `${relativeDir}/${path.basename(id)}` : path.basename(id),
        devPath: normalizedPath,
      };

      return {
        code: `export default ${JSON.stringify(descriptor)};`,
        map: { mappings: "" },
      };
    },
  };
}

export default runeAssetPlugin;
