import { defineZynthConfig } from "@zynth/rsbuild-plugin";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const aliasEntries = {
  "@zynth/core/universal": path.resolve(
    __dirname,
    "node_modules/@zynth/core/dist/esm/universal.js"
  ),
  "@zynth/core": path.resolve(
    __dirname,
    "node_modules/@zynth/core/dist/esm/index.js"
  ),
  "@zynth/components": path.resolve(
    __dirname,
    "node_modules/@zynth/components/dist/esm/index.js"
  ),
};

const extraAliases = Object.fromEntries(
  Object.entries(aliasEntries).filter(([, target]) => existsSync(target))
);

export default defineZynthConfig(
  {},
  {
    plugin: {
      extraAliases,
      writeArtifacts: false,
    },
  }
);
