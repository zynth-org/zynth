
import path from "node:path";
import { promises as fs } from "node:fs";

async function pickFirstExisting(paths: string[]): Promise<string | null> {
  for (const candidate of paths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

async function discoverZynthPackageAliases(
  repoRoot: string,
  isWeb: boolean
): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  const packagesDir = path.join(repoRoot, "packages");

  try {
    const entries = (await fs.readdir(packagesDir, {
      withFileTypes: true,
    })) as import("node:fs").Dirent[];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const packageDir = path.join(packagesDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");

      try {
        const raw = await fs.readFile(packageJsonPath, "utf8");
        const pkg = JSON.parse(raw) as { name?: string };

        // Only process @zynthjs/* packages
        if (pkg.name?.startsWith("@zynthjs/")) {
          const srcDir = path.join(packageDir, "src");
          const candidates = [
            ...(isWeb ? ["index.web.ts", "index.web.tsx"] : []),
            "index.ts",
            "index.tsx",
          ];
          const entry = await pickFirstExisting(
            candidates.map((filename) => path.join(srcDir, filename))
          );
          if (!entry) {
            continue;
          }
          aliases[pkg.name] = entry;
        }
      } catch (error) {
        continue;
      }
    }
  } catch (error) {
    console.warn(
      `[zynth-rsbuild-plugin] Could not discover packages in ${packagesDir}:`,
      error
    );
  }

  return aliases;
}

// Run it
const root = process.cwd();
console.log("Root:", root);
discoverZynthPackageAliases(root, true).then((aliases) => {
  console.log("Aliases for WEB:", aliases);
});
