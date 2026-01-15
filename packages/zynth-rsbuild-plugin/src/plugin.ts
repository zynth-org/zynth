import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

import type { RsbuildPlugin } from "@rsbuild/core";
import * as rspack from "@rspack/core";
import type { ZynthRsbuildPluginOptions } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HMR_SHIM_PATH = path.join(__dirname, "shims/hmr-client-empty.js");
const OVERLAY_SHIM_PATH = path.join(__dirname, "shims/overlay-empty.js");
const CSS_SHIM_PATH = path.join(__dirname, "shims/css-empty.js");
const IMAGE_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/image-asset-loader.js"
);
const require = createRequire(import.meta.url);

let solidJsxRuntime: string | null = null;
let solidJsxDevRuntime: string | null = null;
try {
  solidJsxRuntime = require.resolve("solid-js/h/jsx-runtime");
  solidJsxDevRuntime = require.resolve("solid-js/h/jsx-dev-runtime");
} catch {
  solidJsxRuntime = null;
  solidJsxDevRuntime = null;
}

const DEFAULT_ARTIFACT_RELATIVE_PATH = ".zynth/artifacts.json";

export interface InternalPluginOptions extends ZynthRsbuildPluginOptions {
  isWeb: boolean;
}

export function createZynthRsbuildPlugin(
  options: InternalPluginOptions
): RsbuildPlugin {
  const {
    artifactPath = DEFAULT_ARTIFACT_RELATIVE_PATH,
    workspaceRoot,
    hermesCompat,
    extraAliases,
    writeArtifacts = true,
    isWeb,
  } = options;

  return {
    name: "@zynth/rsbuild-plugin",
    async setup(api) {
      const repoRoot = workspaceRoot
        ? path.resolve(workspaceRoot)
        : await findWorkspaceRoot(api.context.rootPath);
      
      const discoveredAliases = await discoverZynthPackageAliases(
        repoRoot,
        isWeb
      );

      // Special handling for @zynth/core in Web
      if (isWeb) {
        const coreWebEntry = await pickFirstExisting([
          path.join(repoRoot, "packages/zynth-core/src/index.web.ts"),
          path.join(repoRoot, "packages/zynth-core/src/index.web.tsx"),
        ]);
        if (coreWebEntry) {
          discoveredAliases["@zynth/core$"] = coreWebEntry;
          discoveredAliases["@zynth/core"] = path.join(repoRoot, "packages/zynth-core/src");
        }
      }

      const artifactFile = path.isAbsolute(artifactPath)
        ? artifactPath
        : path.join(api.context.rootPath, artifactPath);

      // Exclude images from built-in asset handling so our custom loader can process them
      api.modifyBundlerChain((chain, { CHAIN_ID }) => {
        chain.module
          .rule(CHAIN_ID.RULE.IMAGE)
          .exclude.add(/\.(png|jpe?g|gif|webp|avif|svg)$/i);

        // Apply aliases (high priority via chain)
        for (const [key, value] of Object.entries(discoveredAliases)) {
          chain.resolve.alias.set(key, value);
        }
      });

      api.modifyRspackConfig((config) => {
        ensureAliases(config, extraAliases, discoveredAliases);
        configureImageAssets(config);

        if (hermesCompat) {
          config.target = ["electron-renderer", "es5"];
          config.node = false;
          config.output = {
            ...config.output,
            hotUpdateGlobal: "webpackHotUpdate",
            hotUpdateMainFilename:
              "bundle/[runtime].[fullhash].hot-update.json",
            hotUpdateChunkFilename: "bundle/[id].[fullhash].hot-update.js",
            iife: true,
            chunkFormat: "array-push",
          };

          config.plugins?.push(
            new rspack.NormalModuleReplacementPlugin(
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]hmr.js$/,
              HMR_SHIM_PATH
            ),
            new rspack.NormalModuleReplacementPlugin(
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]overlay.js$/,
              OVERLAY_SHIM_PATH
            ),
            new rspack.NormalModuleReplacementPlugin(/\.css$/,
              CSS_SHIM_PATH
            )
          );
        }
      });

      // Add middleware to serve static files via /@fs/ routes (for dev mode)
      if (api.context.action === "dev") {
        api.modifyRsbuildConfig((config) => {
          // Inject dev server URL
          const devServerHost = config.server?.host || "0.0.0.0";
          const devServerPort = config.server?.port || 8081;
          const devServerUrl = `http://${
            devServerHost === "0.0.0.0" ? "localhost" : devServerHost
          }:${devServerPort}`;

          config.source ??= {};
          config.source.define ??= {};
          const defines = config.source.define as Record<string, any>;
          defines["globalThis.__ZYNTH_DEV_SERVER_URL"] = JSON.stringify(devServerUrl);
          defines.__ZYNTH_DEV_SERVER_URL = JSON.stringify(devServerUrl);

          config.dev ??= {};
          const existingSetup = config.dev.setupMiddlewares;
          config.dev.setupMiddlewares = (middlewares: any, server: any) => {
            if (existingSetup) {
              if (Array.isArray(existingSetup)) {
                existingSetup.forEach((fn: any) => fn(middlewares, server));
              } else {
                (existingSetup as any)(middlewares, server);
              }
            }
            middlewares.unshift(createStaticAssetMiddleware());
          };
        });
      }

      if (!writeArtifacts || api.context.action !== "dev" || isWeb) {
        return;
      }

      const writeTokenArtifact = createArtifactWriter(
        artifactFile
      );

      const handleEnvironments = async (
        environments: Record<string, any>
      ) => {
        const token = pickFirstToken(environments);
        if (!token) {
          return;
        }
        await writeTokenArtifact(token);
      };

      api.onAfterStartDevServer(({ environments }) =>
        handleEnvironments(environments)
      );
      api.onAfterDevCompile(async ({ environments }) => {
        await handleEnvironments(environments);
      });
    },
  };
}

function configureImageAssets(config: rspack.Configuration) {
  config.module ??= {};
  config.module.rules ??= [];
  config.module.rules.unshift({
    test: /\.(png|jpe?g|gif|webp|avif|svg)$/i,
    type: "javascript/auto",
    resourceQuery: { not: [/url/]
     },
    use: [
      {
        loader: IMAGE_ASSET_LOADER_PATH,
        options: {},
      },
    ],
  });
}

function createStaticAssetMiddleware() {
  return async (req: any, res: any, next: any) => {
    const url = req.url || "";
    const fsMatch = url.match(/^\/@fs\/(.+?)(?:\?.*)?$/);
    if (!fsMatch) {
      return next();
    }
    const encodedPath = fsMatch[1];
    const filePath = encodedPath
      .split("/")
      .map((segment: string) => decodeURIComponent(segment))
      .join("/");
    const absolutePath = filePath.startsWith("/") ? filePath : "/" + filePath;

    try {
      const content = await fs.readFile(absolutePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
        ".svg": "image/svg+xml",
      };
      res.setHeader("Content-Type", contentTypes[ext] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(content);
    } catch (error) {
      res.statusCode = 404;
      res.end("Not found");
    }
  };
}

function ensureAliases(
  config: rspack.Configuration,
  extraAliases?: Record<string, string | false | (string | false)[]>,
  discoveredAliases?: Record<string, string>
) {
  config.resolve ??= {};
  const aliasConfig = config.resolve.alias;
  let alias: Record<string, string | false | (string | false)[]> = {};
  
  if (Array.isArray(aliasConfig)) {
    for (const entry of aliasConfig) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry as any).name;
      const value = (entry as any).alias;
      if (typeof name === "string") alias[name] = value;
    }
  } else if (aliasConfig && typeof aliasConfig === "object") {
    alias = { ...(aliasConfig as any) };
  }

  // Merge discovered aliases
  if (discoveredAliases) {
    for (const [key, value] of Object.entries(discoveredAliases)) {
      alias[key] = value;
    }
  }

  const staticAliases: Record<string, string> = {
    "@rsbuild/core/dist/client/hmr.js": HMR_SHIM_PATH,
    "@rsbuild/core/dist/client/overlay.js": OVERLAY_SHIM_PATH,
    "@rsbuild/rsbuild/dist/client/hmr.js": HMR_SHIM_PATH,
    "@rsbuild/rsbuild/dist/client/overlay.js": OVERLAY_SHIM_PATH,
  };
  
  if (solidJsxRuntime) staticAliases["solid-js/jsx-runtime"] = solidJsxRuntime;
  const resolvedDevRuntime = solidJsxDevRuntime ?? solidJsxRuntime;
  if (resolvedDevRuntime) staticAliases["solid-js/jsx-dev-runtime"] = resolvedDevRuntime;

  for (const [key, value] of Object.entries(staticAliases)) {
    if (alias[key] === undefined) alias[key] = value;
  }
  
  if (extraAliases) {
    for (const [key, value] of Object.entries(extraAliases)) {
      alias[key] = value;
    }
  }

  config.resolve.alias = alias;
}

async function discoverZynthPackageAliases(
  repoRoot: string,
  isWeb: boolean
): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  const packagesDir = path.join(repoRoot, "packages");

  try {
    const entries = (await fs.readdir(packagesDir, { withFileTypes: true })) as import("node:fs").Dirent[];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDir = path.join(packagesDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      try {
        const raw = await fs.readFile(packageJsonPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };
        if (pkg.name?.startsWith("@zynth/")) {
          const srcDir = path.join(packageDir, "src");
          const candidates = [
            ...(isWeb ? ["index.web.ts", "index.web.tsx"] : []),
            "index.ts",
            "index.tsx",
          ];
          const entryFile = await pickFirstExisting(candidates.map(f => path.join(srcDir, f)));
          if (entryFile) {
            // Exact match for the package
            aliases[`${pkg.name}$`] = entryFile;
            // Subpath match (points to src directory)
            aliases[pkg.name] = srcDir;

            if (pkg.name === "@zynth/core") {
                const universalPath = path.join(packageDir, "src/universal.ts");
                if (await exists(universalPath)) {
                  aliases["@zynth/core/universal"] = universalPath;
                }
            }
          }
        }
      } catch {}
    }
  } catch {}
  return aliases;
}

async function pickFirstExisting(paths: string[]) {
  for (const p of paths) {
    try { await fs.access(p); return p; } catch {}
  }
  return null;
}

async function exists(p: string) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function findWorkspaceRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      const raw = await fs.readFile(path.join(current, "package.json"), "utf8");
      if (JSON.parse(raw).workspaces) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function pickFirstToken(environments: Record<string, any>): string | undefined {
  for (const env of Object.values(environments)) {
    if (env.webSocketToken) return env.webSocketToken;
  }
  return undefined;
}

function createArtifactWriter(filePath: string) {
  return async (token: string) => {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const data = { hmrServerToken: token, updatedAt: new Date().toISOString() };
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch {}
  };
}