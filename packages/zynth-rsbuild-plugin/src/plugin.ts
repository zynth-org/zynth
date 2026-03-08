import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import os from "node:os";

import type { RsbuildPlugin } from "@rsbuild/core";
import * as rspack from "@rspack/core";
import type {
  ZynthBuildFeatureContext,
  ZynthRsbuildPluginOptions,
} from "./types.js";
import {
  escapeRegExp,
  isGeneratedModuleFeature,
  registerGeneratedModule,
  resolveFeatureOutputFile,
  resolveFeaturePlatform,
  writeGeneratedModuleFile,
} from "./features.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HMR_SHIM_PATH = path.join(__dirname, "shims/hmr-client-empty.js");
const OVERLAY_SHIM_PATH = path.join(__dirname, "shims/overlay-empty.js");
const CSS_SHIM_PATH = path.join(__dirname, "shims/css-empty.js");
const IMAGE_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/image-asset-loader.js",
);
const FONT_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/font-asset-loader.js",
);
const require = createRequire(import.meta.url);

let solidJsxRuntime: string | null = null;
let solidJsxDevRuntime: string | null = null;
let solidHyperscriptRuntime: string | null = null;
try {
  solidJsxRuntime =
    safeResolve(require, "solid-js/h/jsx-runtime/dist/jsx.js") ??
    safeResolve(require, "solid-js/h/jsx-runtime");
  solidJsxDevRuntime =
    safeResolve(require, "solid-js/h/jsx-dev-runtime/dist/jsx.js") ??
    safeResolve(require, "solid-js/h/jsx-dev-runtime");
  solidHyperscriptRuntime =
    safeResolve(require, "solid-js/h/dist/h.cjs") ??
    safeResolve(require, "solid-js/h");
} catch {
  solidJsxRuntime = null;
  solidJsxDevRuntime = null;
  solidHyperscriptRuntime = null;
}

const DEFAULT_ARTIFACT_RELATIVE_PATH = ".zynth/artifacts.json";

export interface InternalPluginOptions extends ZynthRsbuildPluginOptions {
  isWeb: boolean;
}

export function createZynthRsbuildPlugin(
  options: InternalPluginOptions,
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
      const isDev = api.context.action === "dev";
      const repoRoot = workspaceRoot
        ? path.resolve(workspaceRoot)
        : await findWorkspaceRoot(api.context.rootPath);

      const discoveredAliases = await discoverZynthPackageAliases(
        repoRoot,
        isWeb,
      );
      const solidAliases = resolveSolidAliases(repoRoot);
      const mergedAliases = { ...discoveredAliases, ...solidAliases };
      const exactModuleReplacements: Array<{ request: string; target: string }> =
        [];

      const featureContext: ZynthBuildFeatureContext = {
        appRoot: api.context.rootPath,
        workspaceRoot: repoRoot,
        platform: resolveFeaturePlatform(isWeb),
      };

      for (const feature of options.features ?? []) {
        if (isGeneratedModuleFeature(feature)) {
          const outputFile = resolveFeatureOutputFile(
            feature,
            api.context.rootPath,
          );
          const source = await feature.generate(featureContext);
          await writeGeneratedModuleFile(outputFile, source);
          registerGeneratedModule(
            mergedAliases,
            exactModuleReplacements,
            feature.moduleId,
            outputFile,
          );
          continue;
        }
      }

      // Special handling for @zynth/core in Web
      if (isWeb) {
        const coreWebEntry = await pickFirstExisting([
          path.join(repoRoot, "packages/zynth-core/src/index.web.ts"),
          path.join(repoRoot, "packages/zynth-core/src/index.web.tsx"),
        ]);
        if (coreWebEntry) {
          mergedAliases["@zynth/core$"] = coreWebEntry;
          mergedAliases["@zynth/core"] = path.join(
            repoRoot,
            "packages/zynth-core/src",
          );
        }
      }

      const artifactFile = path.isAbsolute(artifactPath)
        ? artifactPath
        : path.join(api.context.rootPath, artifactPath);

      // Exclude images and fonts from built-in asset handling so our custom loaders can process them
      api.modifyBundlerChain((chain, { CHAIN_ID }) => {
        chain.module
          .rule(CHAIN_ID.RULE.IMAGE)
          .exclude.add(/\.(png|jpe?g|gif|webp|avif|svg)$/i);

        chain.module.rules.delete(CHAIN_ID.RULE.FONT);

        // Apply aliases (high priority via chain)
        for (const [key, value] of Object.entries(mergedAliases)) {
          chain.resolve.alias.set(key, value);
        }
      });

      api.modifyRspackConfig((config) => {
        const mergedExtraAliases = {
          ...solidAliases,
          ...(extraAliases ?? {}),
        };
        ensureAliases(config, mergedExtraAliases, mergedAliases);
        configureImageAssets(config);
        configureFontAssets(config);
        if (isDev) {
          ensureResolveCondition(config, "development");
        }

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
              HMR_SHIM_PATH,
            ),
            new rspack.NormalModuleReplacementPlugin(
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]overlay.js$/,
              OVERLAY_SHIM_PATH,
            ),
            new rspack.NormalModuleReplacementPlugin(/\.css$/, CSS_SHIM_PATH),
          );
        }

        for (const replacement of exactModuleReplacements) {
          config.plugins?.push(
            new rspack.NormalModuleReplacementPlugin(
              new RegExp(`^${escapeRegExp(replacement.request)}$`),
              replacement.target,
            ),
          );
        }
      });


      // Add middleware to serve static files via /@fs/ routes (for dev mode)
      if (api.context.action === "dev") {
        api.modifyRsbuildConfig((config) => {
          // Inject dev server URL
          const devServerHost = config.server?.host || "0.0.0.0";
          const devServerPort = config.server?.port || 8081;

          let hostForUrl = devServerHost;
          if (hostForUrl === "0.0.0.0") {
            hostForUrl = getLocalIpAddress() || "localhost";
          }

          const devServerUrl = `http://${hostForUrl}:${devServerPort}`;

          config.source ??= {};
          config.source.define ??= {};
          const defines = config.source.define as Record<string, any>;
          defines["globalThis.__ZYNTH_DEV_SERVER_URL"] =
            JSON.stringify(devServerUrl);
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

      const writeTokenArtifact = createArtifactWriter(artifactFile);

      const handleEnvironments = async (environments: Record<string, any>) => {
        const token = pickFirstToken(environments);
        if (!token) {
          return;
        }
        await writeTokenArtifact(token);
      };

      api.onAfterStartDevServer(({ environments }) =>
        handleEnvironments(environments),
      );
      api.onAfterDevCompile(async ({ environments }) => {
        await handleEnvironments(environments);
      });
    },
  };
}

function ensureResolveCondition(
  config: rspack.Configuration,
  condition: string,
) {
  config.resolve ??= {};
  const existing = config.resolve.conditionNames;
  const base =
    existing && existing.length > 0
      ? existing
      : ["import", "module", "browser", "default"];
  if (!base.includes(condition)) {
    config.resolve.conditionNames = [...base, condition];
  }
}

function configureImageAssets(config: rspack.Configuration) {
  config.module ??= {};
  config.module.rules ??= [];
  config.module.rules.unshift({
    test: /\.(png|jpe?g|gif|webp|avif|svg)$/i,
    type: "javascript/auto",
    resourceQuery: { not: [/url/] },
    use: [
      {
        loader: IMAGE_ASSET_LOADER_PATH,
        options: {},
      },
    ],
  });
}

function configureFontAssets(config: rspack.Configuration) {
  config.module ??= {};
  config.module.rules ??= [];
  // Use unshift to be the first rule
  config.module.rules.unshift({
    test: /\.(ttf|otf|woff2?|eot)$/i,
    type: "javascript/auto",
    use: [
      {
        loader: FONT_ASSET_LOADER_PATH,
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
        ".ttf": "font/ttf",
        ".otf": "font/otf",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
      };
      res.setHeader(
        "Content-Type",
        contentTypes[ext] || "application/octet-stream",
      );
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
  discoveredAliases?: Record<string, string>,
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
  if (resolvedDevRuntime)
    staticAliases["solid-js/jsx-dev-runtime"] = resolvedDevRuntime;
  if (solidHyperscriptRuntime)
    staticAliases["solid-js/h"] = solidHyperscriptRuntime;

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
  isWeb: boolean,
): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  const packagesDir = path.join(repoRoot, "packages");

  try {
    const entries = (await fs.readdir(packagesDir, {
      withFileTypes: true,
    })) as import("node:fs").Dirent[];
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
          const entryFile = await pickFirstExisting(
            candidates.map((f) => path.join(srcDir, f)),
          );
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

function resolveSolidAliases(repoRoot: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  const rootRequire = createRequire(path.join(repoRoot, "package.json"));
  const solidHFromRoot = safeResolve(rootRequire, "solid-js/h/dist/h.cjs");
  const solidHFallbackFromRoot = safeResolve(rootRequire, "solid-js/h");

  const solidJsxRuntimeFromRoot = safeResolve(
    rootRequire,
    "solid-js/h/jsx-runtime/dist/jsx.js",
  );
  const solidJsxDevRuntimeFromRoot = safeResolve(
    rootRequire,
    "solid-js/h/jsx-dev-runtime/dist/jsx.js",
  );
  const solidJsxRuntimeFallbackFromRoot = safeResolve(
    rootRequire,
    "solid-js/h/jsx-runtime",
  );
  const solidJsxDevRuntimeFallbackFromRoot = safeResolve(
    rootRequire,
    "solid-js/h/jsx-dev-runtime",
  );

  if (solidJsxRuntimeFromRoot || solidJsxRuntimeFallbackFromRoot) {
    aliases["solid-js/jsx-runtime"] =
      solidJsxRuntimeFromRoot || solidJsxRuntimeFallbackFromRoot!;
  }
  if (solidJsxDevRuntimeFromRoot || solidJsxDevRuntimeFallbackFromRoot) {
    aliases["solid-js/jsx-dev-runtime"] =
      solidJsxDevRuntimeFromRoot || solidJsxDevRuntimeFallbackFromRoot!;
  }
  if (solidHFromRoot || solidHFallbackFromRoot) {
    aliases["solid-js/h"] = solidHFromRoot || solidHFallbackFromRoot!;
  }

  return aliases;
}

function safeResolve(
  resolver: NodeRequire,
  request: string,
): string | null {
  try {
    return resolver.resolve(request);
  } catch {
    return null;
  }
}

async function pickFirstExisting(paths: string[]) {
  for (const p of paths) {
    try {
      await fs.access(p);
      return p;
    } catch {}
  }
  return null;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
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

      const data = {
        hmrServerToken: token,
        updatedAt: new Date().toISOString(),
      };

      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    } catch {}
  };
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }

  return null;
}
