import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";

const EXTERNAL_PACKAGES = ["solid-js"];

export default defineConfig({
  mode: "production",
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  dev: {
    hmr: false,
    writeToDisk: true,
  },
  html: {
    inject: false,
  },
  performance: {
    chunkSplit: {
      strategy: "all-in-one",
    },
  },
  plugins: [
    pluginBabel({
      include: [/[\\/]src[\\/].*\.(t|j)sx?$/],
      babelLoaderOptions: (options) => {
        options.presets = [
          [
            "@babel/preset-env",
            {
              targets: {
                android: "9.0",
                ios: "13.0",
              },
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
        options.plugins = options.plugins ?? [];
        return options;
      },
    }),
  ],
  tools: {
    htmlPlugin: false,
    rspack(config) {
      config.externalsType = "module";
      const externals = (
        typeof config.externals === "object" && !Array.isArray(config.externals)
          ? { ...config.externals }
          : {}
      ) as Record<string, string>;
      for (const pkg of EXTERNAL_PACKAGES) {
        externals[pkg] = pkg;
      }
      config.externals = externals;
    },
  },
  output: {
    target: "node",
    module: true,
    distPath: {
      root: "./dist/esm",
    },
    filename: {
      js: "index.js",
    },
    legalComments: "none",
    minify: false,
    emitCss: false,
    cleanDistPath: true,
  },
});
