#!/usr/bin/env node

import { readdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const packagesDir = join(repoRoot, "packages");
const orderedPackages = ["@zynthjs/core", "@zynthjs/apis", "@zynthjs/components", "@zynthjs/screens"];
const workspaceCommand = "yarn";
const workspaceBuildScript = "build";
const depsSyncScript = "binaries:sync";

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function removeDist(packageDir: string) {
  const distPath = join(packageDir, "dist");
  if (!(await pathExists(distPath))) {
    return;
  }

  log(`  → removing ${distPath}`);
  await rm(distPath, { recursive: true, force: true });
}

async function discoverWorkspacePackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages: Array<{ name: string; dir: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageDir = join(packagesDir, entry.name);
    const packageJsonPath = join(packageDir, "package.json");

    try {
      const raw = await readFile(packageJsonPath, "utf8");
      const pkg = JSON.parse(raw) as {
        name?: string;
        scripts?: Record<string, string>;
      };

      if (pkg.name && pkg.scripts?.[workspaceBuildScript]) {
        packages.push({ name: pkg.name, dir: packageDir });
      }
    } catch {
      // Ignore invalid or missing package.json
    }
  }

  return packages;
}

async function main() {
  const args = process.argv.slice(2);
  const syncDeps = args.includes("--deps");
  
  // Parse --skip flag
  const skipIndex = args.indexOf("--skip");
  const skipList = ["@zynthjs/skyhook"]; // Default skip
  if (skipIndex !== -1 && args[skipIndex + 1]) {
    const manualSkips = args[skipIndex + 1].split(",");
    skipList.push(...manualSkips);
  }

  log(`📦 Ordered package build starting...${syncDeps ? " (with dependency sync)" : ""}`);
  if (skipList.length > 0) {
    log(`  → skipping: ${skipList.join(", ")}`);
  }

  const packages = await discoverWorkspacePackages();
  const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));

  const ordered = orderedPackages
    .filter((name) => packageMap.has(name) && !skipList.includes(name))
    .map((name) => packageMap.get(name)!);

  const remaining = packages
    .filter((pkg) => !orderedPackages.includes(pkg.name) && !skipList.includes(pkg.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const buildList = [...ordered, ...remaining];

  if (buildList.length === 0) {
    log("⚠️ No workspace packages with a build script were found.");
    return;
  }

  for (const pkg of buildList) {
    log(`
=== Building ${pkg.name} ===`);

    if (syncDeps) {
      const packageJsonPath = join(pkg.dir, "package.json");
      const raw = await readFile(packageJsonPath, "utf8");
      const pkgJson = JSON.parse(raw) as {
        scripts?: Record<string, string>;
      };
      if (pkgJson.scripts?.[depsSyncScript]) {
        log(`  → syncing dependencies for ${pkg.name}...`);
        runCommand(
          workspaceCommand,
          ["workspace", pkg.name, depsSyncScript],
          repoRoot,
        );
      }
    }

    await removeDist(pkg.dir);
    runCommand(
      workspaceCommand,
      ["workspace", pkg.name, workspaceBuildScript],
      repoRoot,
    );
  }

  log("✅ Ordered package build complete.");
}

main().catch((error) => {
  console.error("❌ Failed ordered build:", error);
  process.exit(1);
});
