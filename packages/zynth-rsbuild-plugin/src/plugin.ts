import fs from "node:fs/promises";
import fsSync from "node:fs";
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
const OVERLAY_SHIM_PATH = path.join(__dirname, "shims/overlay-empty.js");
const CSS_SHIM_PATH = path.join(__dirname, "shims/css-empty.js");
const IMAGE_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/image-asset-loader.cjs",
);
const FONT_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/font-asset-loader.cjs",
);
const require = createRequire(import.meta.url);

interface SolidPaths {
  jsxRuntime: string | null;
  jsxDevRuntime: string | null;
  hyperscript: string | null;
  core: string | null;
  web: string | null;
  store: string | null;
  universal: string | null;
  html: string | null;
  packageRoot: string | null;
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
    name: "@zynthjs/rsbuild-plugin",
    async setup(api) {
      const isDev = api.context.action === "dev";
      const repoRoot = workspaceRoot
        ? path.resolve(workspaceRoot)
        : await findWorkspaceRoot(api.context.rootPath);

      const installedAliases = await discoverInstalledZynthPackageAliases(
        api.context.rootPath,
        isWeb,
      );
      const discoveredAliases = await discoverZynthPackageAliases(
        repoRoot,
        isWeb,
      );
      const solidPaths = resolveSolidPaths(
        [api.context.rootPath, repoRoot],
        isDev,
      );
      const solidAliases = createSolidAliases(solidPaths);

      // Prefer app-local node_modules package resolution for production parity.
      // Workspace aliases are fallback-only when app dependencies are absent.
      const mergedAliases = {
        ...discoveredAliases,
        ...installedAliases,
        ...solidAliases,
      };
      const exactModuleReplacements: Array<{ request: string; target: string }> =
        [];

      const featureContext: ZynthBuildFeatureContext = {
        appRoot: api.context.rootPath,
        workspaceRoot: repoRoot,
        platform: resolveFeaturePlatform(isWeb),
      };
      const nativeHmrCompatEntry = await resolveNativeHmrCompatEntry(
        api.context.rootPath,
        repoRoot,
      );

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

      // Special handling for @zynthjs/core in Web
      if (isWeb) {
        const coreWebEntry = await pickFirstExisting([
          path.join(repoRoot, "packages/zynth-core/src/index.web.ts"),
          path.join(repoRoot, "packages/zynth-core/src/index.web.tsx"),
        ]);
        if (coreWebEntry) {
          mergedAliases["@zynthjs/core$"] = coreWebEntry;
          mergedAliases["@zynthjs/core"] = path.join(
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
        ensureAliases(
          config,
          mergedExtraAliases,
          mergedAliases,
          solidPaths,
        );
        configureImageAssets(config);
        configureFontAssets(config);
        configureModuleResolution(config);
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
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]overlay.js$/,
              OVERLAY_SHIM_PATH,
            ),
            new rspack.NormalModuleReplacementPlugin(/\.css$/, CSS_SHIM_PATH),
          );
        }

        if (solidPaths?.core) {
          config.plugins?.push(
            new rspack.NormalModuleReplacementPlugin(
              /solid-js[\\/]dist[\\/]server\.(js|cjs)$/,
              solidPaths.core,
            ),
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
          if (!isWeb) {
            config.source ??= {};
            const existingPreEntry = config.source.preEntry;
            const preEntries = Array.isArray(existingPreEntry)
              ? existingPreEntry
              : typeof existingPreEntry === "string"
                ? [existingPreEntry]
                : [];
            if (!preEntries.includes(nativeHmrCompatEntry)) {
              config.source.preEntry = [nativeHmrCompatEntry, ...preEntries];
            }
          }
          // Inject dev server URL
          const devServerHost = config.server?.host || "0.0.0.0";
          const devServerPort = config.server?.port || (isWeb ? 7076 : 7070);

          let hostForUrl = devServerHost;
          if (hostForUrl === "0.0.0.0" || hostForUrl === "127.0.0.1" || hostForUrl === "localhost") {
            hostForUrl = getLocalIpAddress() || "localhost";
          }

          const devServerUrl = `http://${hostForUrl}:${devServerPort}`;

          config.source ??= {};
          config.source.define ??= {};
          const defines = config.source.define as Record<string, any>;
          defines["globalThis.__ZYNTH_DEV_SERVER_URL"] =
            JSON.stringify(devServerUrl);
          defines.__ZYNTH_DEV_SERVER_URL = JSON.stringify(devServerUrl);
          const hmrDebugValue = process.env?.ZYNTH_HMR_DEBUG;
          const hmrDebugEnabled =
            hmrDebugValue === "1" || hmrDebugValue === "true";
          defines["globalThis.__ZYNTH_HMR_DEBUG"] =
            JSON.stringify(hmrDebugEnabled);
          defines.__ZYNTH_HMR_DEBUG = JSON.stringify(hmrDebugEnabled);

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

async function resolveNativeHmrCompatEntry(
  appRoot: string,
  repoRoot: string,
): Promise<string> {
  const appRequire = createRequire(path.join(appRoot, "package.json"));
  const packageJsonPath =
    safeResolve(appRequire, "@zynthjs/core/package.json") ??
    safeResolve(require, "@zynthjs/core/package.json");

  if (packageJsonPath) {
    const packageDir = path.dirname(packageJsonPath);
    const installedEntry = await pickFirstExisting([
      path.join(packageDir, "src/hmr-prelude.ts"),
      path.join(packageDir, "src/hmr-prelude.js"),
      path.join(packageDir, "dist/esm/hmr-prelude.js"),
    ]);
    if (installedEntry) {
      return installedEntry;
    }
  }

  return path.join(repoRoot, "packages/zynth-core/src/hmr-prelude.ts");
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
      : ["browser", "import", "module", "default"];
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

function configureModuleResolution(config: rspack.Configuration) {
  config.module ??= {};
  config.module.rules ??= [];
  config.module.rules.push({
    test: /\.m?[tj]sx?$/,
    resolve: {
      fullySpecified: false,
    },
  });
  config.module.rules.push({
    test: /[\\/]node_modules[\\/](solid-js|@solidjs[\\/].*)[\\/]/,
    sideEffects: true,
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
  solidPaths?: SolidPaths,
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
    "@rsbuild/core/dist/client/overlay.js": OVERLAY_SHIM_PATH,
    "@rsbuild/rsbuild/dist/client/overlay.js": OVERLAY_SHIM_PATH,
  };

  if (solidPaths) {
    if (solidPaths.jsxRuntime)
      staticAliases["solid-js/jsx-runtime"] = solidPaths.jsxRuntime;
    const resolvedDevRuntime =
      solidPaths.jsxDevRuntime ?? solidPaths.jsxRuntime;
    if (resolvedDevRuntime)
      staticAliases["solid-js/jsx-dev-runtime"] = resolvedDevRuntime;
    if (solidPaths.hyperscript)
      staticAliases["solid-js/h"] = solidPaths.hyperscript;
    if (solidPaths.web)
      staticAliases["solid-js/web"] = solidPaths.web;
    if (solidPaths.store)
      staticAliases["solid-js/store"] = solidPaths.store;
    if (solidPaths.universal)
      staticAliases["@solidjs/universal"] = solidPaths.universal;
    if (solidPaths.packageRoot) {
      staticAliases["solid-js$"] = solidPaths.core ?? solidPaths.packageRoot;
    }
  }

  for (const [key, value] of Object.entries(staticAliases)) {
    if (alias[key] === undefined) alias[key] = value;
  }

  if (extraAliases) {
    for (const [key, value] of Object.entries(extraAliases)) {
      if (
        key.startsWith("@zynthjs/") &&
        discoveredAliases &&
        (discoveredAliases[key] !== undefined ||
          discoveredAliases[`${key}$`] !== undefined)
      ) {
        continue;
      }
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
        if (pkg.name?.startsWith("@zynthjs/")) {
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

            if (pkg.name === "@zynthjs/core") {
              const universalPath = path.join(packageDir, "src/universal.ts");
              if (await exists(universalPath)) {
                aliases["@zynthjs/core/universal"] = universalPath;
              }
            }
          }
        }
      } catch {}
    }
  } catch {}
  return aliases;
}

async function discoverInstalledZynthPackageAliases(
  appRoot: string,
  isWeb: boolean,
): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  const scopedDir = path.join(appRoot, "node_modules", "@zynth");

  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = (await fs.readdir(scopedDir, {
      withFileTypes: true,
    })) as import("node:fs").Dirent[];
  } catch {
    return aliases;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageName = `@zynthjs/${entry.name}`;
    try {
      const packageDir = path.join(scopedDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!(await exists(packageJsonPath))) {
        continue;
      }
      const packageRaw = await fs.readFile(packageJsonPath, "utf8");
      const packageJson = JSON.parse(packageRaw) as {
        exports?: Record<string, unknown>;
      };
      const srcDir = path.join(packageDir, "src");
      const sourceEntry = await pickFirstExisting([
        ...(isWeb
          ? [path.join(srcDir, "index.web.ts"), path.join(srcDir, "index.web.tsx")]
          : []),
        path.join(srcDir, "index.ts"),
        path.join(srcDir, "index.tsx"),
      ]);

      if (sourceEntry) {
        aliases[`${packageName}$`] = sourceEntry;
        aliases[packageName] = srcDir;
      } else {
        const exportRoot = resolveImportExport(packageJson.exports, ".");
        if (exportRoot) {
          const rootTarget = path.resolve(packageDir, exportRoot);
          aliases[`${packageName}$`] = rootTarget;
          aliases[packageName] = path.dirname(rootTarget);
        }
      }

      if (packageName === "@zynthjs/core") {
        const universalSrcPath = path.join(srcDir, "universal.ts");
        if (await exists(universalSrcPath)) {
          aliases["@zynthjs/core/universal"] = universalSrcPath;
        } else {
          const universalExport = resolveImportExport(
            packageJson.exports,
            "./universal",
          );
          if (universalExport) {
            aliases["@zynthjs/core/universal"] = path.resolve(
              packageDir,
              universalExport,
            );
          }
        }
      }

      if (isWeb && packageName === "@zynthjs/core") {
        const webEntry = await pickFirstExisting([
          path.join(srcDir, "index.web.ts"),
          path.join(srcDir, "index.web.tsx"),
        ]);
        if (webEntry) {
          aliases["@zynthjs/core$"] = webEntry;
          aliases["@zynthjs/core"] = path.dirname(webEntry);
        }
      }
    } catch {
      // Ignore malformed or partially installed packages.
    }
  }

  return aliases;
}

function resolveImportExport(
  exportsField: Record<string, unknown> | undefined,
  key: "." | "./universal",
): string | null {
  if (!exportsField) return null;
  const entry = exportsField[key];
  if (!entry) return null;

  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object") {
    const importPath = (entry as Record<string, unknown>).import;
    if (typeof importPath === "string") return importPath;
    const defaultPath = (entry as Record<string, unknown>).default;
    if (typeof defaultPath === "string") return defaultPath;
  }
  return null;
}

function resolveSolidPaths(roots: string[], isDev?: boolean): SolidPaths {
  for (const root of roots) {
    try {
      const rootRequire = createRequire(path.join(root, "package.json"));

      // solid-js@2.0.0-beta.23+ uses an "exports" field that blocks subpath
      // access (e.g. "./dist/dev.js", "./web"). Node's require.resolve() throws
      // ERR_PACKAGE_PATH_NOT_EXPORTED for those, and the bare "solid-js" fallback
      // resolves to the "main" field which is the SSR stub (server.cjs).
      // Work around this by resolving "solid-js/package.json" (which IS exported)
      // and constructing all paths manually from the package root.
      const packageJsonPath = safeResolve(rootRequire, "solid-js/package.json");
      if (!packageJsonPath) continue;
      const packageRoot = path.dirname(packageJsonPath);
      const distDir = path.join(packageRoot, "dist");

      // Core entry: prefer dev.js in dev mode, solid.js in production.
      // If the preferred file doesn't exist, fall back to the other.
      const core = isDev
        ? pickFirstFileSync(
            path.join(distDir, "dev.js"),
            path.join(distDir, "solid.js"),
            path.join(distDir, "server.js"),
          )
        : pickFirstFileSync(
            path.join(distDir, "solid.js"),
            path.join(distDir, "dev.js"),
            path.join(distDir, "server.js"),
          );

      if (!core) continue;

      // JSX runtimes — solid-js@2.0 beta moved these under dist/.
      const jsxRuntime = pickFirstFileSync(
        path.join(distDir, "jsx.js"),
        path.join(packageRoot, "h", "jsx-runtime", "dist", "jsx.js"),
        path.join(packageRoot, "h", "jsx-runtime"),
      );
      const jsxDevRuntime = pickFirstFileSync(
        path.join(distDir, "jsx-dev.js"),
        path.join(packageRoot, "h", "jsx-dev-runtime", "dist", "jsx.js"),
        path.join(packageRoot, "h", "jsx-dev-runtime"),
      );

      // Hyperscript (solid-js/h)
      const hyperscript = pickFirstFileSync(
        path.join(distDir, "h.js"),
        path.join(packageRoot, "h", "dist", "h.cjs"),
        path.join(packageRoot, "h"),
      );

      // solid-js/web
      const web = isDev
        ? pickFirstFileSync(
            path.join(distDir, "web", "dev.js"),
            path.join(distDir, "web.js"),
            path.join(packageRoot, "web"),
          )
        : pickFirstFileSync(
            path.join(distDir, "web.js"),
            path.join(distDir, "web", "dev.js"),
            path.join(packageRoot, "web"),
          );

      // solid-js/store
      const store = isDev
        ? pickFirstFileSync(
            path.join(distDir, "store", "dev.js"),
            path.join(distDir, "store.js"),
            path.join(packageRoot, "store"),
          )
        : pickFirstFileSync(
            path.join(distDir, "store.js"),
            path.join(distDir, "store", "dev.js"),
            path.join(packageRoot, "store"),
          );

      // @solidjs/universal — separate package, resolved via root export.
      const universal = safeResolve(rootRequire, "@solidjs/universal");

      // solid-js/html
      const html = pickFirstFileSync(
        path.join(distDir, "html.js"),
        path.join(packageRoot, "html", "dist", "html.js"),
        path.join(packageRoot, "html"),
      );

      return {
        core,
        packageRoot,
        jsxRuntime,
        jsxDevRuntime,
        hyperscript,
        web,
        store,
        universal,
        html,
      };
    } catch {
      continue;
    }
  }

  return {
    core: null,
    packageRoot: null,
    jsxRuntime: null,
    jsxDevRuntime: null,
    hyperscript: null,
    web: null,
    store: null,
    universal: null,
    html: null,
  };
}

function pickFirstFileSync(...candidates: string[]): string | null {
  for (const p of candidates) {
    try {
      fsSync.accessSync(p);
      return p;
    } catch {}
  }
  return null;
}

function createSolidAliases(paths: SolidPaths): Record<string, string> {
  const aliases: Record<string, string> = {};
  if (paths.packageRoot && paths.core) {
    aliases["solid-js$"] = paths.core;
    aliases["solid-js"] = paths.core;
  }
  if (paths.web) {
    aliases["solid-js/web$"] = paths.web;
    aliases["solid-js/web"] = path.dirname(paths.web);
  }
  if (paths.store) {
    aliases["solid-js/store$"] = paths.store;
    aliases["solid-js/store"] = path.dirname(paths.store);
  }
  if (paths.universal) {
    aliases["@solidjs/universal$"] = paths.universal;
    aliases["@solidjs/universal"] = path.dirname(paths.universal);
  }
  if (paths.html) {
    aliases["solid-js/html$"] = paths.html;
    aliases["solid-js/html"] = path.dirname(paths.html);
  }
  if (paths.jsxRuntime) {
    aliases["solid-js/jsx-runtime$"] = paths.jsxRuntime;
    aliases["solid-js/jsx-runtime"] = path.dirname(paths.jsxRuntime);
  }
  if (paths.jsxDevRuntime) {
    aliases["solid-js/jsx-dev-runtime$"] = paths.jsxDevRuntime;
    aliases["solid-js/jsx-dev-runtime"] = path.dirname(paths.jsxDevRuntime);
  }
  if (paths.hyperscript) {
    aliases["solid-js/h$"] = paths.hyperscript;
    aliases["solid-js/h"] = path.dirname(paths.hyperscript);
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
