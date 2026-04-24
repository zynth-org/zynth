#!/usr/bin/env node --experimental-strip-types

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

type ReadinessState = "ready-for-alpha-preflight" | "staged" | "private";
type ManifestPackage = {
  name: string;
  path: string;
  readiness: ReadinessState;
  publishName?: string;
  bin?: string;
};
type ReleaseManifest = {
  schemaVersion: number;
  packages: ManifestPackage[];
};

type RootPackageJson = {
  devDependencies?: Record<string, string>;
};
type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
type PackedResult = {
  filename?: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const manifestPath = join(repoRoot, "docs", "package-release-manifest.json");
const npmCacheDir = join(repoRoot, ".tmp", "npm-cache");
const requiredFixturePackages = ["@zynthjs/core", "@zynthjs/apis", "@zynthjs/components", "@zynthjs/rsbuild-plugin", "zynth"];

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")} (cwd: ${cwd})`);
  }
}

function runCommandCapture(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "pipe",
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")} (cwd: ${cwd})\n${result.stderr}`);
  }

  return result.stdout;
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function shouldUsePackage(readiness: ReadinessState, scope: "ready" | "public" | "all") {
  if (scope === "all") return true;
  if (scope === "public") return readiness !== "private";
  return readiness === "ready-for-alpha-preflight";
}

async function packPackage(packageDir: string, destinationDir: string) {
  const raw = runCommandCapture("npm", ["pack", "--json"], packageDir);
  const parsed = JSON.parse(raw) as PackedResult[];
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0].filename) {
    fail(`Unexpected npm pack output in ${packageDir}`);
  }

  const fileName = parsed[0].filename;
  const sourcePath = join(packageDir, fileName);
  const destinationPath = join(destinationDir, fileName);
  await cp(sourcePath, destinationPath);
  await rm(sourcePath, { force: true });
  return destinationPath;
}

async function main() {
  const args = process.argv.slice(2);
  const keepArtifacts = args.includes("--keep");
  const scopeArg = args.find((arg) => arg.startsWith("--scope="));
  const platformsArg = args.find((arg) => arg.startsWith("--platforms="));
  const scope = (scopeArg?.split("=")[1] ?? "ready") as "ready" | "public" | "all";
  const platforms = (platformsArg?.split("=")[1] ?? "android,ios")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!["ready", "public", "all"].includes(scope)) {
    fail(`Unsupported scope "${scope}". Use --scope=ready, --scope=public, or --scope=all.`);
  }
  if (platforms.length === 0) {
    fail('No platforms selected. Use --platforms=android,ios or a subset.');
  }
  for (const platform of platforms) {
    if (!["android", "ios"].includes(platform)) {
      fail(`Unsupported platform "${platform}". Supported: android, ios.`);
    }
  }

  log(`Running fixture smoke validation (scope: ${scope}, platforms: ${platforms.join(",")})`);
  const manifest = await readJsonFile<ReleaseManifest>(manifestPath);
  if (manifest.schemaVersion !== 1) {
    fail(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }

  const selected = manifest.packages.filter((entry) => shouldUsePackage(entry.readiness, scope));
  const selectedSet = new Set(selected.map((entry) => entry.name));
  for (const required of requiredFixturePackages) {
    if (!selectedSet.has(required)) {
      fail(`Fixture requires package ${required}, but it is not included in scope ${scope}`);
    }
  }

  const runRoot = await mkdtemp(join(tmpdir(), "zynth-release-fixture-"));
  const harnessDir = join(runRoot, "harness");
  const tarballsDir = join(runRoot, "tarballs");
  const appDir = join(harnessDir, "fixture-app");

  let success = false;
  try {
    await mkdir(harnessDir, { recursive: true });
    await mkdir(tarballsDir, { recursive: true });

    log("  -> packing ready packages");
    const tarballsByPackage = new Map<string, string>();
    for (const pkg of selected) {
      if (pkg.readiness === "private") continue;
      const packageJson = await readJsonFile<PackageJson>(join(repoRoot, pkg.path, "package.json"));
      if (!packageJson.name) {
        fail(`Missing package name in ${pkg.path}/package.json`);
      }
      const tarballPath = await packPackage(join(repoRoot, pkg.path), tarballsDir);
      tarballsByPackage.set(packageJson.name, tarballPath);
    }

    for (const required of requiredFixturePackages) {
      if (!tarballsByPackage.has(required)) {
        fail(`Required tarball was not created for ${required}`);
      }
    }

    log("  -> preparing fixture harness");
    await writeFile(
      join(harnessDir, "package.json"),
      JSON.stringify(
        {
          name: "zynth-fixture-harness",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ),
    );

    runCommand(
      "npm",
      ["install", "--ignore-scripts", "--no-package-lock", "--save-dev", "--legacy-peer-deps", tarballsByPackage.get("zynth")!],
      harnessDir,
    );

    log("  -> scaffolding fixture app (non-interactive)");
    runCommand(
      "npx",
      [
        "zynth",
        "new",
        "fixture-app",
        "--path",
        harnessDir,
        "--display-name",
        "Fixture App",
        "--slug",
        "com.fixtureapp",
        "--yes",
      ],
      harnessDir,
    );

    log("  -> installing release tarballs into fixture app");
    const rootPackageJson = await readJsonFile<RootPackageJson>(join(repoRoot, "package.json"));
    const hermesCompilerVersion = rootPackageJson.devDependencies?.["hermes-compiler"] ?? "250829098.0.6";
    const appPackageJsonPath = join(appDir, "package.json");
    const appPackageJson = await readJsonFile<PackageJson>(appPackageJsonPath);
    const patchDependencies = (deps: Record<string, string> | undefined) => {
      if (!deps) return;
      for (const name of Object.keys(deps)) {
        if (name === "zynth" || name.startsWith("@zynthjs/")) {
          const tarball = tarballsByPackage.get(name);
          if (tarball) {
            deps[name] = `file:${tarball}`;
          }
        }
      }
    };

    patchDependencies(appPackageJson.dependencies);
    patchDependencies(appPackageJson.devDependencies);

    if (platforms.includes("ios")) {
      appPackageJson.dependencies = appPackageJson.dependencies || {};
      appPackageJson.dependencies["hermes-compiler"] = hermesCompilerVersion;
    }
    await writeFile(appPackageJsonPath, JSON.stringify(appPackageJson, null, 2));

    runCommand(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-package-lock",
        "--legacy-peer-deps",
      ],
      appDir,
    );

    for (const platform of platforms) {
      log(`  -> bootstrapping ${platform} project from fixture app`);
      runCommand("npx", ["zynth", "bootstrap", platform, "--app", appDir], harnessDir);
    }

    success = true;
    log(`Fixture smoke passed. Workspace: ${runRoot}`);
  } finally {
    if (!success || keepArtifacts) {
      log(`Keeping fixture workspace at ${runRoot}`);
    } else {
      await rm(runRoot, { recursive: true, force: true });
      log("Fixture workspace cleaned up");
    }
  }
}

main().catch((error) => {
  console.error("Fixture smoke failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
