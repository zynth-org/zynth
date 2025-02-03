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
