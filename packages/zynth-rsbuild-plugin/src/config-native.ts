import {
  defineConfig,
  type RsbuildConfig,
  type RsbuildPlugins,
} from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import deepmerge from "deepmerge";
import type { DefineZynthConfigOptions } from "./types.js";
import { createZynthRsbuildPlugin } from "./plugin.js";
import { createWorkletBabelPlugin } from "./babel/worklet-plugin.js";

const DEFAULT_NATIVE_CONFIG: RsbuildConfig = {
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
    target: "web", // Native uses Hermes which is JS-like, but we shim it
    minify: false,
    emitCss: false, // No CSS in native
  },
  server: {
    port: 7070,
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
    inject: false,
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  tools: {
    htmlPlugin: false,
    rspack: {
      output: {},
    },
  },
};

export function getNativeConfig(
  userConfig: RsbuildConfig,
  options: DefineZynthConfigOptions
): RsbuildConfig {
  const { plugin: pluginOptions, babel } = options;
  const platform = options.platform || (process.env?.ZYNTH_PLATFORM as any) || "ios";
  const isBuildCommand =
    typeof process !== "undefined" &&
    Array.isArray(process.argv) &&
    process.argv.some((arg) => arg === "build");
  const isProductionBuild =
    process.env?.NODE_ENV === "production" ||
    process.env?.BABEL_ENV === "production" ||
    isBuildCommand;
  const userPlugins = (userConfig.plugins ?? []) as RsbuildPlugins;

  const sanitizedUserConfig: RsbuildConfig = { ...userConfig };
  if ("plugins" in sanitizedUserConfig) {
    delete (sanitizedUserConfig as Record<string, unknown>).plugins;
  }

  const merged = deepmerge(DEFAULT_NATIVE_CONFIG, sanitizedUserConfig, {
    arrayMerge: (_destinationArray, sourceArray) => sourceArray,
  }) as RsbuildConfig;

  merged.output ??= {};
  merged.output.minify = isProductionBuild;

  // Native specific defines
  merged.source ??= {};
  merged.source.define ??= {};
  const defines = merged.source.define as Record<string, any>;
  defines.__ZYNTH_PLATFORM__ = JSON.stringify(platform);
  defines["globalThis.__ZYNTH_PLATFORM__"] = JSON.stringify(platform);

  const plugins: RsbuildPlugins = [
    createZynthRsbuildPlugin({
      ...pluginOptions,
      hermesCompat: pluginOptions?.hermesCompat ?? true,
      isWeb: false,
    }),
  ];

  if (babel?.enable ?? true) {
    plugins.push(createNativeBabelPlugin(babel));
  }

  if (Array.isArray(userPlugins)) {
    plugins.push(...userPlugins);
  } else {
    plugins.push(userPlugins);
  }

  merged.plugins = plugins;

  return defineConfig(merged);
}

function createNativeBabelPlugin(
  babelOptions: DefineZynthConfigOptions["babel"] | undefined
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
        "@babel/preset-typescript",
      ];
      
      const overrides = [...(options.overrides ?? [])];
      overrides.push({
        test: /[\\/]src[\\/].*\.(t|j)sx?$/,
        plugins: [createWorkletBabelPlugin()],
        presets: [
          [
            "babel-preset-solid",
            {
              generate: "universal",
              moduleName: "@zynth/core/universal",
            },
          ],
        ],
      });
      
      options.overrides = overrides;

      const basePlugins = [...(options.plugins ?? [])];
      basePlugins.unshift(createWorkletBabelPlugin());
      options.plugins = basePlugins;
      
      const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
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
