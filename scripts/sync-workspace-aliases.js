#!/usr/bin/env node

/**
 * Auto-sync workspace package aliases to tsconfig.base.json
 * Run this after adding new @zynthjs/* packages
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const packagesDir = join(repoRoot, "packages");
const tsconfigPath = join(repoRoot, "tsconfig.base.json");

async function main() {
  console.log("🔍 Discovering @zynthjs/* packages...");

  const entries = await readdir(packagesDir, { withFileTypes: true });
  const paths = {};

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageDir = join(packagesDir, entry.name);
    const packageJsonPath = join(packageDir, "package.json");

    try {
      const raw = await readFile(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw);

      if (pkg.name?.startsWith("@zynthjs/")) {
        // Check if src/index.ts exists
        const srcIndex = join(packageDir, "src/index.ts");
        try {
          await readFile(srcIndex);
          const relativePath = `packages/${entry.name}/src/index.ts`;
          paths[pkg.name] = [relativePath];
          paths[`${pkg.name}/*`] = [`packages/${entry.name}/src/*`];
          console.log(`  ✓ ${pkg.name}`);

          // Special case for @zynthjs/core/universal
          if (pkg.name === "@zynthjs/core") {
            try {
              const universalPath = join(packageDir, "src/universal.ts");
              await readFile(universalPath);
              paths["@zynthjs/core/universal"] = [
                `packages/${entry.name}/src/universal.ts`,
              ];
              console.log(`  ✓ @zynthjs/core/universal`);
            } catch {
              // No universal.ts, skip
            }
          }
        } catch {
          // No src/index.ts, skip
        }
      }
    } catch {
      // Couldn't read package.json, skip
      continue;
    }
  }

  console.log("\n📝 Updating tsconfig.base.json...");

  const tsconfigRaw = await readFile(tsconfigPath, "utf8");
  const tsconfig = JSON.parse(tsconfigRaw);

  tsconfig.compilerOptions = tsconfig.compilerOptions || {};
  tsconfig.compilerOptions.paths = paths;

  const formatted = JSON.stringify(tsconfig, null, 2) + "\n";
  await writeFile(tsconfigPath, formatted, "utf8");

  console.log(
    "✅ Done! Updated paths for",
    Object.keys(paths).length / 2,
    "packages"
  );
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
