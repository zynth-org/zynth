import { defineConfig } from "@rsbuild/core";

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
  tools: {
    htmlPlugin: false,
    rspack: (config) => {
      config.optimization ||= {};
      // This prevents Rspack from hoisting everything into a single scope
      config.optimization.concatenateModules = false;
      return config;
    },
  },
  html: {
    inject: false,
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
