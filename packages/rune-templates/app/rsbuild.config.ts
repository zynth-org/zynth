import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginSolid } from "@rsbuild/plugin-solid";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  source: {
    entry: {
      main: "./src/index.tsx",
    },
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
  output: {
    target: "node",
    distPath: {
      root: "dist",
    },
    filename: {
      js: "main.js",
    },
    filenameHash: false,
    sourceMap: process.env.NODE_ENV === "development" ? true : false,
  },
  tools: {
    rspack: {
      optimization: {
        splitChunks: false,
        minimize: false, // Don't minify for better debugging with Hermes
      },
      output: {
        iife: true,
        library: {
          name: "RuneApp",
          type: "var",
        },
        environment: {
          // Hermes compatibility - disable modern syntax
          arrowFunction: false,
          const: false,
          destructuring: false,
          forOf: false,
          optionalChaining: false,
          templateLiteral: false,
        },
      },
    },
  },
  plugins: [
    pluginBabel({
      include: /\.(?:jsx|tsx)$/,
      babelLoaderOptions: {
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
      },
    }),
    pluginSolid(),
  ],
});
