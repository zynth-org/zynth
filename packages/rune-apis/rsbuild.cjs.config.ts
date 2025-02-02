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
    module: false,
    distPath: {
      root: "./dist/cjs",
      js: ".",
    },
    filename: {
      js: "index.cjs",
    },
    legalComments: "none",
    minify: false,
    emitCss: false,
    cleanDistPath: true,
  },
});
