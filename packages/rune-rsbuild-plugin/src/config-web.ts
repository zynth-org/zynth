import path from "node:path";
import {
  defineConfig,
  type RsbuildConfig,
  type RsbuildPlugins,
} from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import deepmerge from "deepmerge";
import type { DefineRuneConfigOptions } from "./types.js";
import { createRuneRsbuildPlugin } from "./plugin.js";

const DEFAULT_WEB_CONFIG: RsbuildConfig = {
  source: {
    entry: {
      index: "./src/index.tsx", // Default for web
    },
    define: {
      "process.env.RUNE_PLATFORM": JSON.stringify("web"),
      __RUNE_PLATFORM__: JSON.stringify("web"),
      "globalThis.__RUNE_PLATFORM__": JSON.stringify("web"),
    },
  },
  output: {
    distPath: {
      root: "./dist/web",
      js: ".",
      css: ".",
    },
    filename: {
      js: "[name].[contenthash:8].js",
    },
    target: "web",
    minify: false,
    emitCss: true,
  },
  server: {
    port: 8082, // Default web port
    host: "0.0.0.0",
    publicDir: { name: "public" },
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
    inject: true,
    template: "./public/index.html", // Relative to app root
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  tools: {
    htmlPlugin: true,
  },
  resolve: {
    aliasStrategy: "prefer-alias",
  },
};

export function getWebConfig(
  userConfig: RsbuildConfig,
  options: DefineRuneConfigOptions
): RsbuildConfig {
  const { plugin: pluginOptions, babel } = options;
  const userPlugins = (userConfig.plugins ?? []) as RsbuildPlugins;

  // Remove plugins from userConfig to merge separately
  const sanitizedUserConfig: RsbuildConfig = { ...userConfig };
  if ("plugins" in sanitizedUserConfig) {
    delete (sanitizedUserConfig as Record<string, unknown>).plugins;
  }

  // Handle entry point renaming if 'app' was provided (common in native)
  if (sanitizedUserConfig.source?.entry && (sanitizedUserConfig.source.entry as any).app) {
    const appEntry = (sanitizedUserConfig.source.entry as any).app;
    delete (sanitizedUserConfig.source.entry as any).app;
    (sanitizedUserConfig.source.entry as any).index = appEntry;
  }

  const merged = deepmerge(DEFAULT_WEB_CONFIG, sanitizedUserConfig, {
    arrayMerge: (_destinationArray, sourceArray) => sourceArray,
  }) as RsbuildConfig;

  // Ensure absolute path for template if it relies on default
  if (merged.html && merged.html.template === "./public/index.html") {
      merged.html.template = path.join(process.cwd(), "public/index.html");
  }

  const plugins: RsbuildPlugins = [
    createRuneRsbuildPlugin({
      ...pluginOptions,
      hermesCompat: false, // Force false for web
      isWeb: true,
    }),
  ];

  if (babel?.enable ?? true) {
    plugins.push(createWebBabelPlugin(babel));
  }

  if (Array.isArray(userPlugins)) {
    plugins.push(...userPlugins);
  } else {
    plugins.push(userPlugins);
  }

  merged.plugins = plugins;

  return defineConfig(merged);
}

function createWebBabelPlugin(babelOptions: DefineRuneConfigOptions["babel"] | undefined) {
  const targets = {
    ...babelOptions?.targets,
  };

  return pluginBabel({
    include: [/[\\/]src[\\/].*\.(t|j)sx?$/, /[\\/]web[\\/].*\.(t|j)sx?$/],
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
      
      // Universal/Native Components
      overrides.push({
        test: /[\\/]src[\\/].*\.(t|j)sx?$/,
        presets: [
          [
            "babel-preset-solid",
            {
              generate: "universal",
              moduleName: "@rune/core/universal",
            },
          ],
        ],
      });

      // Web-specific Components (e.g. imports from .web.ts or /web/ folder)
      overrides.push({
        test: /[\\/]web[\\/].*\.(t|j)sx?$/,
        presets: [
          [
            "babel-preset-solid",
            {
              generate: "dom",
              moduleName: "solid-js/web",
            },
          ],
        ],
      });

      options.overrides = overrides;
      return options;
    },
  });
}
