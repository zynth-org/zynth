import { defineRuneConfig } from "@rune/rsbuild-plugin";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const aliasEntries = {
  "@rune/core/universal": path.resolve(
    __dirname,
    "node_modules/@rune/core/dist/esm/universal.js"
  ),
  "@rune/core": path.resolve(
    __dirname,
    "node_modules/@rune/core/dist/esm/index.js"
  ),
  "@rune/components": path.resolve(
    __dirname,
    "node_modules/@rune/components/dist/esm/index.js"
  ),
};

const extraAliases = Object.fromEntries(
  Object.entries(aliasEntries).filter(([, target]) => existsSync(target))
);

export default defineRuneConfig(
  {},
  {
    plugin: {
      extraAliases,
      writeArtifacts: false,
    },
  }
);
