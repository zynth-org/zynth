#!/usr/bin/env node --experimental-strip-types

import { readdir, readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

type ReadinessState = "ready-for-alpha-preflight" | "staged" | "private";
type ReleaseTier = "initial-framework-alpha" | "initial-cli-alpha" | "later-alpha" | "extras-alpha" | "internal";
type VersionTrack = "framework-lockstep" | "cli-independent" | "later-alpha" | "internal";

type ManifestPackage = {
  name: string;
  path: string;
  publishName: string;
  releaseTier: ReleaseTier;
  versionTrack: VersionTrack;
  distribution: string;
  readiness: ReadinessState;
};

type ReleaseManifest = {
  schemaVersion: number;
  packages: ManifestPackage[];
};

type PackageJson = {
  name?: string;
  private?: boolean;
  files?: string[];
  main?: string;
  module?: string;
  types?: string;
  exports?: string | Record<string, unknown>;
  bin?: string | Record<string, string>;
};

type WorkspacePackage = {
  packageDir: string;
  packageJson: PackageJson;
};

type NpmPackedFile = {
  path: string;
  size: number;
  mode: number;
};

type NpmPackDryRunResult = {
  id?: string;
  name?: string;
  version?: string;
  size?: number;
  unpackedSize?: number;
  files?: NpmPackedFile[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const packagesDir = join(repoRoot, "packages");
const manifestPath = join(repoRoot, "docs", "package-release-manifest.json");
const npmCacheDir = join(repoRoot, ".tmp", "npm-cache");

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function shouldValidatePackage(manifestPackage: ManifestPackage, scope: "ready" | "public" | "all") {
  if (scope === "all") return true;
  if (scope === "public") return manifestPackage.readiness !== "private";
  return manifestPackage.readiness === "ready-for-alpha-preflight";
}

async function discoverWorkspacePackages() {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const packageDir = join(packagesDir, entry.name);
    const packageJsonPath = join(packageDir, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readJsonFile<PackageJson>(packageJsonPath);
    packages.push({ packageDir, packageJson });
  }

  return packages;
}

function collectExportTargets(value: unknown, targets: string[]) {
  if (typeof value === "string") {
    if (value.startsWith("./")) {
      targets.push(value.replace(/^\.\//, ""));
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectExportTargets(nested, targets);
  }
}

function normalizeEntry(entry: string) {
  return normalize(entry).replace(/^\.\//, "").replace(/\/$/, "");
}

function hasPackedPathWithPrefix(packedSet: Set<string>, prefix: string) {
  const normalizedPrefix = normalizeEntry(prefix);
  for (const path of packedSet) {
    if (path === normalizedPrefix || path.startsWith(`${normalizedPrefix}/`)) {
      return true;
    }
  }
  return false;
}

function hasPackedPodspec(packedSet: Set<string>) {
  for (const path of packedSet) {
    if (path.endsWith(".podspec")) {
      return true;
    }
  }
  return false;
}

function pathCoveredByEntry(filePath: string, entry: string) {
  const normalizedPath = normalizeEntry(filePath);
  const normalizedEntry = normalizeEntry(entry);
  return normalizedPath === normalizedEntry || normalizedPath.startsWith(`${normalizedEntry}/`);
}

function runNpmPackDryRun(packageDir: string) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: packageDir,
    stdio: "pipe",
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
  });

  if (result.status !== 0) {
    fail(`npm pack --dry-run failed in ${packageDir}: ${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(result.stdout.trim()) as NpmPackDryRunResult[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(`npm pack --dry-run produced unexpected output in ${packageDir}`);
  }

  return parsed[0];
}

function validatePackContents(pkgName: string, pkg: PackageJson, manifestPackage: ManifestPackage, pack: NpmPackDryRunResult) {
  const packedFiles = pack.files ?? [];
  if (packedFiles.length === 0) {
    fail(`${pkgName}: npm pack output contains no files`);
  }

  const packedPaths = packedFiles.map((file) => normalizeEntry(file.path));
  const packedSet = new Set(packedPaths);

  const requiredPaths = ["package.json", "README.md"];
  for (const required of requiredPaths) {
    if (!packedSet.has(required)) {
      fail(`${pkgName}: packed tarball is missing required file ${required}`);
    }
  }

  const filesWhitelist = pkg.files ?? [];
  for (const entry of filesWhitelist) {
    const covered = packedPaths.some((path) => pathCoveredByEntry(path, entry));
    if (!covered) {
      fail(`${pkgName}: files whitelist entry is not represented in tarball: ${entry}`);
    }
  }

  const hasBin = !!pkg.bin;
  if (!hasBin) {
    const requiredBuildPaths = [pkg.main, pkg.module, pkg.types].filter(isNonEmptyString);
    for (const requiredPath of requiredBuildPaths) {
      if (!packedSet.has(normalizeEntry(requiredPath))) {
        fail(`${pkgName}: packed tarball is missing build artifact ${requiredPath}`);
      }
    }

    const exportTargets: string[] = [];
    collectExportTargets(pkg.exports, exportTargets);
    for (const target of exportTargets) {
      if (!packedSet.has(normalizeEntry(target))) {
        fail(`${pkgName}: packed tarball is missing exports target ${target}`);
      }
    }

    if (!hasPackedPathWithPrefix(packedSet, "dist")) {
      fail(`${pkgName}: packed tarball is missing dist directory contents`);
    }
    if (!hasPackedPathWithPrefix(packedSet, "dist/esm")) {
      fail(`${pkgName}: packed tarball is missing dist/esm directory contents`);
    }
    if (!hasPackedPathWithPrefix(packedSet, "dist/types")) {
      fail(`${pkgName}: packed tarball is missing dist/types directory contents`);
    }
  } else if (typeof pkg.bin === "object") {
    for (const target of Object.values(pkg.bin)) {
      if (isNonEmptyString(target) && !packedSet.has(normalizeEntry(target))) {
        fail(`${pkgName}: packed tarball is missing bin target ${target}`);
      }
    }
  }

  const bannedPatterns = [
    ".tsbuildinfo",
    ".DS_Store",
    "node_modules/",
    "/build/",
    "/.cxx/",
    "/.gradle/",
  ];
  for (const path of packedPaths) {
    if (bannedPatterns.some((pattern) => path.includes(pattern))) {
      fail(`${pkgName}: packed tarball includes banned path ${path}`);
    }
  }

  const unpackedSize = pack.unpackedSize ?? 0;
  if (unpackedSize > 100 * 1024 * 1024) {
    log(`  WARN ${pkgName} unpacked tarball is large (${unpackedSize} bytes)`);
  }

  if (
    manifestPackage.readiness === "ready-for-alpha-preflight" &&
    (manifestPackage.distribution === "native-source" || manifestPackage.distribution === "managed-binaries")
  ) {
    if (!hasPackedPathWithPrefix(packedSet, "ios")) {
      fail(`${pkgName}: native package tarball is missing ios sources`);
    }
    if (!hasPackedPathWithPrefix(packedSet, "android")) {
      fail(`${pkgName}: native package tarball is missing android sources`);
    }
    if (!hasPackedPodspec(packedSet)) {
      fail(`${pkgName}: native package tarball is missing podspec`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const scopeArg = args.find((arg) => arg.startsWith("--scope="));
  const scope = (scopeArg?.split("=")[1] ?? "ready") as "ready" | "public" | "all";

  if (!["ready", "public", "all"].includes(scope)) {
    fail(`Unsupported scope "${scope}". Use --scope=ready, --scope=public, or --scope=all.`);
  }

  const manifest = await readJsonFile<ReleaseManifest>(manifestPath);
  if (manifest.schemaVersion !== 1) {
    fail(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }

  const workspacePackages = await discoverWorkspacePackages();
  const workspaceMap = new Map(
    workspacePackages
      .filter((workspace) => isNonEmptyString(workspace.packageJson.name))
      .map((workspace) => [workspace.packageJson.name as string, workspace]),
  );

  const targets = manifest.packages.filter((entry) => shouldValidatePackage(entry, scope));
  if (targets.length === 0) {
    fail(`No manifest packages matched the requested scope: ${scope}`);
  }

  log(`📦 Running release pack validation (scope: ${scope})`);

  let totalPackedSize = 0;
  let totalUnpackedSize = 0;

  for (const target of targets) {
    const workspacePackage = workspaceMap.get(target.name);
    if (!workspacePackage) {
      fail(`Workspace package not found for manifest entry ${target.name}`);
    }

    if (workspacePackage.packageJson.private === true) {
      continue;
    }

    log(`  → packing ${target.name}`);
    const pack = runNpmPackDryRun(workspacePackage.packageDir);
    validatePackContents(target.name, workspacePackage.packageJson, target, pack);
    totalPackedSize += pack.size ?? 0;
    totalUnpackedSize += pack.unpackedSize ?? 0;
  }

  log(`✅ Release pack validation passed for ${targets.length} package(s).`);
  log(`   packed size total: ${totalPackedSize} bytes`);
  log(`   unpacked size total: ${totalUnpackedSize} bytes`);
}

main().catch((error) => {
  console.error("❌ Release pack validation failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
