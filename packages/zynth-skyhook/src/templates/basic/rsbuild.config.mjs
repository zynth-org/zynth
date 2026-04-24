import { defineZynthConfig } from "@zynthjs/rsbuild-plugin";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const artifactsRoot = "/opt/zynth-artifacts";
const manifestPath = path.resolve(__dirname, artifactsRoot, "manifest.json");

function loadZynthAliases() {
  const aliases = {
    "solid-js/jsx-runtime": "solid-js/h/jsx-runtime",
    "solid-js/jsx-dev-runtime": "solid-js/h/jsx-dev-runtime",
  };

  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    const packages = manifest.packages || {};

    for (const [pkgName, folderName] of Object.entries(packages)) {
      const srcEntryPath = path.resolve(
        artifactsRoot,
        folderName,
        "src",
        "index.ts"
      );
      const sourceEntryPath = path.resolve(
        artifactsRoot,
        folderName,
        "dist",
        "source",
        "index.ts"
      );
      if (existsSync(srcEntryPath)) {
        aliases[pkgName] = srcEntryPath;
      } else if (existsSync(sourceEntryPath)) {
        aliases[pkgName] = sourceEntryPath;
      }
    }

    const coreUniversalSrc = path.resolve(
      artifactsRoot,
      "zynth-core",
      "src",
      "universal.ts"
    );
    const coreUniversalSource = path.resolve(
      artifactsRoot,
      "zynth-core",
      "dist",
      "source",
      "universal.ts"
    );
    if (existsSync(coreUniversalSrc)) {
      aliases["@zynthjs/core/universal"] = coreUniversalSrc;
    } else if (existsSync(coreUniversalSource)) {
      aliases["@zynthjs/core/universal"] = coreUniversalSource;
    }
  } catch {
    // Missing manifest; fall back to empty aliases.
  }

  return aliases;
}

const extraAliases = loadZynthAliases();

export default defineZynthConfig(
  {
    tools: {
      rspack: {
        optimization: {
          concatenateModules: false,
          usedExports: false,
          sideEffects: false,
        },
        resolve: {
          modules: ["/app/workspace/node_modules", "node_modules"],
        },
      },
    },
  },
  {
    plugin: {
      extraAliases,
      writeArtifacts: false,
    },
  }
);
