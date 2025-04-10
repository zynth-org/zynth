import { defineConfig } from "@rsbuild/core";
import { runePlugin } from "@rune/rsbuild-plugin";

export default defineConfig({
  plugins: [runePlugin()],
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  output: {
    distPath: {
      root: "dist/esm",
    },
    target: "node",
    externals: {
      "solid-js": "solid-js",
      "solid-js/store": "solid-js/store",
      "@rune/core": "@rune/core",
      "@rune/components": "@rune/components",
    },
  },
});
