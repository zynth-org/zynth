import path from "node:path";
import solidPlugin from "vite-plugin-solid";
import { runeNativePlugin } from "./runePlugin.js";
import { runeAssetPlugin } from "./assetPlugin.js";

export function createRuneViteConfig(options = {}) {
  const {
    appRoot = process.cwd(),
    platform = process.env.RUNE_PLATFORM || "ios",
    entryFile = "src/index.tsx",
    resolve = {},
    define = {},
  } = options;

  const absoluteAppRoot = path.resolve(appRoot);
  const userAlias = resolve && resolve.alias ? resolve.alias : {};

  return {
    appType: "custom",
    root: absoluteAppRoot,
    envPrefix: ["RUNE_"],
    plugins: [
      runeAssetPlugin({ appRoot: absoluteAppRoot }),
      runeNativePlugin({ appRoot: absoluteAppRoot, platform, entryFile }),
      solidPlugin({ hot: true }),
    ],
    resolve: {
      alias: {
        ...userAlias,
      },
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    define,
    optimizeDeps: {
      include: ["solid-js", "solid-js/web"],
    },
    server: {
      host: process.env.RUNE_VITE_HOST || "0.0.0.0",
      port: Number(process.env.RUNE_VITE_PORT) || 5173,
      strictPort: false,
      watch: {
        // Native projects may mount the repo via different fs watchers.
        ignored: ["**/ios/**", "**/android/**"],
      },
    },
    build: {
      target: "es2020",
      outDir: path.join(absoluteAppRoot, "dist", "dev"),
      emptyOutDir: false,
      sourcemap: true,
      rollupOptions: {
        input: {
          app: entryFile,
        },
      },
    },
  };
}

export default createRuneViteConfig;
