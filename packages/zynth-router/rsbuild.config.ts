import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";

const EXTERNAL_PACKAGES = [
  "solid-js",
  "@zynthjs/core",
  "@zynthjs/screens",
  "@zynthjs/components",
  "@zynthjs/apis",
];

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
              moduleName: "@zynthjs/core/universal",
            },
          ],
          "@babel/preset-typescript",
        ];
        options.plugins = options.plugins ?? [];
        return options;
      },
    }),
  ],
  output: {
    target: "web",
    minify: false,
    filenameHash: false,
    distPath: {
      root: "./dist",
      js: "esm",
    },
    externals: EXTERNAL_PACKAGES.reduce((acc, pkg) => {
      acc[pkg] = pkg;
      return acc;
    }, {} as Record<string, string>),
  },
});
