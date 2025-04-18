import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";

const EXTERNAL_PACKAGES = ["solid-js", "@rune/core", "@rune/safe-area"];

export default defineConfig({
  mode: "production",
  plugins: [
    pluginBabel({
      include: /\.(?:jsx|tsx)$/,
      babelLoaderOptions: {
        presets: [
          ["babel-preset-solid", {}],
          ["@babel/preset-typescript", { onlyRemoveTypeImports: true }],
        ],
      },
    }),
  ],
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
      js: ".",
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
