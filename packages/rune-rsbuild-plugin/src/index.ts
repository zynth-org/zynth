import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import {
  defineConfig,
  type EnvironmentContext,
  type Logger,
  type RsbuildConfig,
  type RsbuildPlugin,
  type RsbuildPlugins,
} from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import deepmerge from "deepmerge";
import * as rspack from "@rspack/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HMR_SHIM_PATH = path.join(__dirname, "shims/hmr-client-empty.js");
const OVERLAY_SHIM_PATH = path.join(__dirname, "shims/overlay-empty.js");
const IMAGE_ASSET_LOADER_PATH = path.join(
  __dirname,
  "loaders/image-asset-loader.js"
);

const DEFAULT_ARTIFACT_RELATIVE_PATH = ".rune/artifacts.json";

export interface RuneRsbuildPluginOptions {
  /** Override where the dev artifact is written. Defaults to `<app>/.rune/artifacts.json`. */
  artifactPath?: string;
  /** Explicitly provide the monorepo root path. Will be auto-detected when omitted. */
  workspaceRoot?: string;
  /** Disable Hermes/HMR shimming logic. */
  hermesCompat?: boolean;
  /** Inject extra resolve aliases. */
  extraAliases?: Record<string, string | false | (string | false)[]>;
  /** Skip writing the HMR artifact JSON. */
  writeArtifacts?: boolean;
}

export interface DefineRuneConfigOptions {
  plugin?: RuneRsbuildPluginOptions;
  babel?: {
    enable?: boolean;
    targets?: {
      android?: string;
      ios?: string;
      [platform: string]: string | undefined;
    };
  };
}

const DEFAULT_CONFIG: RsbuildConfig = {
  source: {
    entry: {
      app: "./src/index.tsx",
    },
  },
  output: {
    distPath: {
      root: "./dist",
      js: ".",
    },
    filename: {
      js: "main.js",
    },
    target: "web",
    minify: false,
    emitCss: false,
  },
  server: {
    port: 8081,
    host: "0.0.0.0",
    publicDir: false,
    printUrls: true,
  },
  dev: {
    hmr: true,
    writeToDisk: true,
    client: {
      overlay: false,
    },
  },
  html: {
    scriptLoading: "module",
    inject: false,
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  tools: {
    htmlPlugin: false,
  },
};

export function defineRuneConfig(
  userConfig: RsbuildConfig = {},
  options: DefineRuneConfigOptions = {}
) {
  const { plugin: pluginOptions, babel } = options;
  const userPlugins = (userConfig.plugins ?? []) as RsbuildPlugins;
  const sanitizedUserConfig: RsbuildConfig = {
    ...userConfig,
  };
  if ("plugins" in sanitizedUserConfig) {
    delete (sanitizedUserConfig as Record<string, unknown>).plugins;
  }

  const merged = deepmerge(DEFAULT_CONFIG, sanitizedUserConfig, {
    arrayMerge: (_destinationArray, sourceArray) => sourceArray,
  }) as RsbuildConfig;

  const plugins: RsbuildPlugins = [createRuneRsbuildPlugin(pluginOptions)];

  if (babel?.enable ?? true) {
    plugins.push(createRuneBabelPlugin(babel));
  }

  if (Array.isArray(userPlugins)) {
    plugins.push(...userPlugins);
  } else {
    plugins.push(userPlugins);
  }

  merged.plugins = plugins;

  return defineConfig(merged);
}

function createRuneBabelPlugin(
  babelOptions?: DefineRuneConfigOptions["babel"]
) {
  const defaultTargets: Record<string, string> = {
    android: "9.0",
    ios: "13.0",
  };
  const targets = {
    ...defaultTargets,
    ...(babelOptions?.targets ?? {}),
  };

  return pluginBabel({
    include: [/[\\/]src[\\/].*\.(t|j)sx?$/],
    babelLoaderOptions: (options) => {
      options.presets = [
        [
          "@babel/preset-env",
          {
            targets,
            modules: false,
          },
        ],
        [
          "babel-preset-solid",
          {
            generate: "universal",
            moduleName: "@rune/core/universal",
          },
        ],
        "@babel/preset-typescript",
      ];
      const isDev =
        typeof process !== "undefined" &&
        process.env?.NODE_ENV !== "production";
      if (isDev) {
        options.plugins = [
          ...(options.plugins ?? []),
          ["solid-refresh/babel", { bundler: "standard" }],
        ];
      }
      return options;
    },
  });
}

export function createRuneRsbuildPlugin(
  options: RuneRsbuildPluginOptions = {}
): RsbuildPlugin {
  const {
    artifactPath = DEFAULT_ARTIFACT_RELATIVE_PATH,
    workspaceRoot,
    hermesCompat = true,
    extraAliases,
    writeArtifacts = true,
  } = options;

  return {
    name: "@rune/rsbuild-plugin",
    async setup(api) {
      const repoRoot = workspaceRoot
        ? path.resolve(workspaceRoot)
        : await findWorkspaceRoot(api.context.rootPath);
      const artifactFile = path.isAbsolute(artifactPath)
        ? artifactPath
        : path.join(api.context.rootPath, artifactPath);

      // Exclude images from built-in asset handling so our custom loader can process them
      api.modifyBundlerChain((chain, { CHAIN_ID }) => {
        // Exclude our supported image formats from the built-in rule
        // The built-in rule will still handle images imported with ?url or ?inline
        chain.module
          .rule(CHAIN_ID.RULE.IMAGE)
          .exclude.add(/\.(png|jpe?g|gif|webp|avif|svg)$/i);
      });

      api.modifyRspackConfig((config) => {
        ensureAliases(config, repoRoot, extraAliases);
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

          config.plugins.push(
            new rspack.NormalModuleReplacementPlugin(
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]hmr\.js$/,
              HMR_SHIM_PATH
            ),
            new rspack.NormalModuleReplacementPlugin(
              /@rsbuild[\\/](core|rsbuild)[\\/]dist[\\/]client[\\/]overlay\.js$/,
              OVERLAY_SHIM_PATH
            )
          );
        }
      });

      // Add middleware to serve static files via /@fs/ routes (for dev mode)
      if (api.context.action === "dev") {
        api.modifyRsbuildConfig((config) => {
          // Inject dev server URL as a global variable
          const devServerHost = config.server?.host || "0.0.0.0";
          const devServerPort = config.server?.port || 8081;
          const devServerUrl = `http://${
            devServerHost === "0.0.0.0" ? "localhost" : devServerHost
          }:${devServerPort}`;

          config.source ??= {};
          config.source.define ??= {};
          (config.source.define as Record<string, any>).__RUNE_DEV_SERVER_URL =
            JSON.stringify(devServerUrl);

          config.dev ??= {};
          config.dev.setupMiddlewares = (middlewares: any) => {
            // Add our custom middleware to serve files from filesystem
            middlewares.unshift(createStaticAssetMiddleware());
          };
        });
      }
      if (!writeArtifacts || api.context.action !== "dev") {
        return;
      }

      const writeTokenArtifact = createArtifactWriter(
        artifactFile,
        api.logger,
        api.context.rootPath
      );

      const handleEnvironments = async (
        environments: Record<string, EnvironmentContext>
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

  // Insert at the beginning to override any default asset handling
  // Use oneOf to ensure this rule takes precedence
  config.module.rules.unshift({
    test: /\.(png|jpe?g|gif|webp|avif|svg)$/i,
    type: "javascript/auto", // Treat as JavaScript module, not asset
    resourceQuery: { not: [/url/] }, // Skip if explicitly requested as URL
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

    // Match /@fs/ routes for serving local files
    const fsMatch = url.match(/^\/@fs\/(.+?)(?:\?.*)?$/);
    if (!fsMatch) {
      return next();
    }

    try {
      // Decode the file path
      const encodedPath = fsMatch[1];
      // Decode each segment separately to handle special characters
      const filePath = encodedPath
        .split("/")
        .map((segment: string) => decodeURIComponent(segment))
        .join("/");

      // Add leading slash back for absolute paths on Unix systems
      const absolutePath = filePath.startsWith("/") ? filePath : "/" + filePath;

      // Read and serve the file
      const content = await fs.readFile(absolutePath);

      // Set appropriate content type based on file extension
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

      const contentType = contentTypes[ext] || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-cache");
      res.end(content);
    } catch (error) {
      console.error(`[rune-rsbuild-plugin] Failed to serve ${url}:`, error);
      res.statusCode = 404;
      res.end("Not found");
    }
  };
}

async function ensureAliases(
  config: rspack.Configuration,
  repoRoot: string,
  extraAliases?: Record<string, string | false | (string | false)[]>
) {
  config.resolve ??= {};
  const alias = (config.resolve.alias ??= {}) as Record<
    string,
    string | false | (string | false)[]
  >;

  // Auto-discover all @rune/* packages from the workspace
  const discoveredAliases = await discoverRunePackageAliases(repoRoot);

  // Static aliases for special cases (HMR shims, etc)
  const staticAliases: Record<string, string | false | (string | false)[]> = {
    "@rsbuild/core/dist/client/hmr.js": HMR_SHIM_PATH,
    "@rsbuild/core/dist/client/overlay.js": OVERLAY_SHIM_PATH,
    "@rsbuild/rsbuild/dist/client/hmr.js": HMR_SHIM_PATH,
    "@rsbuild/rsbuild/dist/client/overlay.js": OVERLAY_SHIM_PATH,
  };

  // Apply discovered aliases first (lowest priority)
  for (const [key, value] of Object.entries(discoveredAliases)) {
    if (alias[key] === undefined) {
      alias[key] = value;
    }
  }

  // Apply static aliases (medium priority)
  for (const [key, value] of Object.entries(staticAliases)) {
    if (alias[key] === undefined) {
      alias[key] = value;
    }
  }

  // Apply extra aliases last (highest priority)
  if (extraAliases) {
    for (const [key, value] of Object.entries(extraAliases)) {
      alias[key] = value;
    }
  }
}

async function discoverRunePackageAliases(
  repoRoot: string
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

        // Only process @rune/* packages
        if (pkg.name?.startsWith("@rune/")) {
          const srcIndex = path.join(packageDir, "src/index.ts");

          // Check if src/index.ts exists
          try {
            await fs.access(srcIndex);
            aliases[pkg.name] = srcIndex;

            // Add special case for @rune/core/universal
            if (pkg.name === "@rune/core") {
              const universalPath = path.join(packageDir, "src/universal.ts");
              try {
                await fs.access(universalPath);
                aliases["@rune/core/universal"] = universalPath;
              } catch {
                // universal.ts doesn't exist, skip
              }
            }
          } catch {
            // src/index.ts doesn't exist, skip this package
          }
        }
      } catch (error) {
        // Couldn't read or parse package.json, skip
        continue;
      }
    }
  } catch (error) {
    // packages directory doesn't exist or can't be read
    console.warn(
      `[rune-rsbuild-plugin] Could not discover packages in ${packagesDir}:`,
      error
    );
  }

  return aliases;
}

async function findWorkspaceRoot(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    const pkgPath = path.join(current, "package.json");
    try {
      const raw = await fs.readFile(pkgPath, "utf8");
      const pkg = JSON.parse(raw) as { workspaces?: unknown };
      if (pkg.workspaces) {
        return current;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function pickFirstToken(
  environments: Record<string, EnvironmentContext>
): string | undefined {
  for (const environment of Object.values(environments)) {
    if (environment.webSocketToken) {
      return environment.webSocketToken;
    }
  }
  return undefined;
}

function createArtifactWriter(
  filePath: string,
  logger: Logger,
  rootPath: string
) {
  let lastSnapshot: string | null = null;

  return async (token: string) => {
    const data = await readArtifact(filePath);
    const next = {
      ...data,
      hmrServerToken: token,
      updatedAt: new Date().toISOString(),
    };
    const snapshot = JSON.stringify(next, null, 2) + "\n";
    if (snapshot === lastSnapshot) {
      return;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, snapshot, "utf8");
    lastSnapshot = snapshot;

    const relative = path.relative(rootPath, filePath) || filePath;
    logger.debug?.(
      `[rune-rsbuild-plugin] wrote HMR token to ${relative.replace(/\\/g, "/")}`
    );
  };
}

async function readArtifact(
  filePath: string
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export type RunePluginOptions = RuneRsbuildPluginOptions;
