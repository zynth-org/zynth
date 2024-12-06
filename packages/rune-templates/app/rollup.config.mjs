import path from "node:path";
import { fileURLToPath } from "node:url";
import alias from "@rollup/plugin-alias";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  input: "src/index.tsx",
  output: { file: "dist/main.js", format: "iife", name: "RuneApp" },
  external: () => false,
  plugins: [
    alias({
      entries: [
        // Map the more specific path first to avoid prefix collisions
        {
          find: "@rune/core/universal",
          replacement: path.resolve(
            __dirname,
            "../../packages/rune-core/src/universal.ts"
          ),
        },
        {
          // Match exactly `@rune/core` (not subpaths like /universal)
          find: /^@rune\/core$/,
          replacement: path.resolve(
            __dirname,
            "../../packages/rune-core/src/index.ts"
          ),
        },
      ],
    }),
    resolve({ extensions: [".mjs", ".js", ".ts", ".tsx"] }),
    commonjs(),
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
};
