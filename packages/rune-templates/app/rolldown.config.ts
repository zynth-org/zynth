import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "rolldown";
import babel from "@rollup/plugin-babel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  input: "src/index.tsx",
  output: {
    file: "dist/main.js",
    format: "iife",
    name: "RuneApp",
  },
  resolve: {
    alias: {
      "@rune/core/universal": path.resolve(
        __dirname,
        "../../packages/rune-core/src/universal.ts"
      ),
      "@rune/core": path.resolve(
        __dirname,
        "../../packages/rune-core/src/index.ts"
      ),
      "@rune/components": path.resolve(
        __dirname,
        "../../packages/rune-components/src/index.ts"
      ),
    },
  },
  external: () => false,
  plugins: [
    babel({
      babelHelpers: "bundled",
      extensions: [".js", ".ts", ".tsx"],
      presets: [
        [
          "@babel/preset-env",
          {
            targets: {
              android: "4",
              ios: "10",
            },
            modules: false,
          },
        ],
        [
          "solid",
          {
            generate: "universal",
            hydratable: false,
            moduleName: "@rune/core/universal",
          },
        ],
        "@babel/preset-typescript",
      ],
    }),
  ],
});
