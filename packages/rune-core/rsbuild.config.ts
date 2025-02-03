import { defineConfig } from "@rsbuild/core";

const EXTERNAL_PACKAGES = ["solid-js", "@rune/apis"];

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
  tools: {
    htmlPlugin: false,
    rspack(config) {
      config.externalsType = "module";
      const externals =
        (typeof config.externals === "object" && !Array.isArray(config.externals)
          ? { ...config.externals }
          : {}) as Record<string, string>;
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
