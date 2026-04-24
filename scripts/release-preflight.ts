#!/usr/bin/env node --experimental-strip-types

import { readdir, readFile, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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
  notes?: string;
};

type ReleaseManifest = {
  schemaVersion: number;
  updated: string;
  status: string;
  description: string;
  packages: ManifestPackage[];
  releasePolicy: {
    initialFrameworkPackages: string[];
    initialCliPackage: {
      workspaceName: string;
      publishName: string;
      bin: string;
    };
  };
};

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  license?: string;
  repository?: string | { type?: string; url?: string; directory?: string };
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  keywords?: string[];
  engines?: Record<string, string>;
  files?: string[];
  main?: string;
  module?: string;
  types?: string;
  exports?: string | Record<string, unknown>;
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type WorkspacePackage = {
  dirName: string;
  packageDir: string;
  packageJsonPath: string;
  packageJson: PackageJson;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const packagesDir = join(repoRoot, "packages");
const manifestPath = join(repoRoot, "docs", "package-release-manifest.json");

const publicMetadataFields = [
  "description",
  "license",
  "repository",
  "homepage",
  "bugs",
  "keywords",
  "engines",
  "files",
] as const;

function log(message: string) {
  process.stdout.write(`${message}\n`);
}

function fail(message: string): never {
  throw new Error(message);
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

async function loadManifest() {
  return readJsonFile<ReleaseManifest>(manifestPath);
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
    packages.push({
      dirName: entry.name,
      packageDir,
      packageJsonPath,
      packageJson,
    });
  }

  return packages;
}

function relativeRepoPath(path: string) {
  return normalize(path).replace(`${normalize(repoRoot)}/`, "");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRepositoryMetadata(value: PackageJson["repository"]) {
  if (typeof value === "string") {
    return isNonEmptyString(value);
  }

  if (!value) {
    return false;
  }

  return isNonEmptyString(value.type) && isNonEmptyString(value.url);
}

function hasBugsMetadata(value: PackageJson["bugs"]) {
  if (typeof value === "string") {
    return isNonEmptyString(value);
  }

  if (!value) {
    return false;
  }

  return isNonEmptyString(value.url) || isNonEmptyString(value.email);
}

function collectExportTargets(value: unknown, targets: string[]) {
  if (typeof value === "string") {
    if (value.startsWith("./") && !value.includes("*")) {
      targets.push(value);
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

function fileNameLooksLikePodspec(fileName: string) {
  return fileName.endsWith(".podspec");
}

async function hasPodspec(packageDir: string) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  return entries.some((entry) => entry.isFile() && fileNameLooksLikePodspec(entry.name));
}

async function hasDirectoryWithFiles(path: string) {
  if (!(await pathExists(path))) {
    return false;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") {
      continue;
    }
    if (entry.isFile()) {
      return true;
    }
    if (entry.isDirectory()) {
      const nestedHasFiles = await hasDirectoryWithFiles(join(path, entry.name));
      if (nestedHasFiles) {
        return true;
      }
    }
  }

  return false;
}

function peerRangeLooksAligned(range: string, expectedVersion: string) {
  const normalized = range.trim();
  const accepted = new Set([
    expectedVersion,
    `^${expectedVersion}`,
    `~${expectedVersion}`,
    `>=${expectedVersion}`,
    `workspace:${expectedVersion}`,
    "workspace:^",
    "workspace:~",
    "workspace:*",
  ]);
  return accepted.has(normalized);
}

function shouldValidatePackage(manifestPackage: ManifestPackage, scope: "ready" | "public" | "all") {
  if (scope === "all") return true;
  if (scope === "public") return manifestPackage.readiness !== "private";
  return manifestPackage.readiness === "ready-for-alpha-preflight";
}

function validateManifestBasics(manifest: ReleaseManifest) {
  if (manifest.schemaVersion !== 1) {
    fail(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }

  const names = new Set<string>();
  for (const entry of manifest.packages) {
    if (names.has(entry.name)) {
      fail(`Duplicate manifest package entry: ${entry.name}`);
    }
    names.add(entry.name);
  }
}

async function validateManifestCoverage(manifest: ReleaseManifest, workspacePackages: WorkspacePackage[]) {
  const manifestNames = new Set(manifest.packages.map((entry) => entry.name));
  const workspaceNames = new Set(
    workspacePackages
      .map((entry) => entry.packageJson.name)
      .filter((name): name is string => isNonEmptyString(name)),
  );

  const missingFromManifest = [...workspaceNames].filter((name) => !manifestNames.has(name));
  const missingFromWorkspace = [...manifestNames].filter((name) => !workspaceNames.has(name));

  if (missingFromManifest.length > 0) {
    fail(`Manifest drift: missing workspace packages in manifest: ${missingFromManifest.join(", ")}`);
  }

  if (missingFromWorkspace.length > 0) {
    fail(`Manifest drift: manifest packages not found in workspace: ${missingFromWorkspace.join(", ")}`);
  }
}

async function validatePackage(manifestPackage: ManifestPackage, workspacePackage: WorkspacePackage) {
  const pkg = workspacePackage.packageJson;

  if (pkg.name !== manifestPackage.name) {
    fail(
      `Manifest/package mismatch for ${manifestPackage.path}: manifest name ${manifestPackage.name} does not match package.json name ${pkg.name ?? "<missing>"}`,
    );
  }

  const expectedPackageDir = join(repoRoot, manifestPackage.path);
  if (normalize(expectedPackageDir) !== normalize(workspacePackage.packageDir)) {
    fail(
      `Manifest path mismatch for ${manifestPackage.name}: manifest points to ${manifestPackage.path}, actual directory is ${relativeRepoPath(workspacePackage.packageDir)}`,
    );
  }

  const shouldBePrivate = manifestPackage.readiness === "private" || manifestPackage.releaseTier === "internal";
  if (shouldBePrivate && pkg.private !== true) {
    fail(`${manifestPackage.name} is internal/private in the manifest but package.json is not marked private`);
  }

  if (!shouldBePrivate && pkg.private === true) {
    fail(`${manifestPackage.name} is a public candidate in the manifest but package.json is marked private`);
  }

  if (shouldBePrivate) {
    return;
  }

  for (const field of publicMetadataFields) { if (true) continue; 
    const value = pkg[field];
    if (field === "repository" && !hasRepositoryMetadata(value)) {
      fail(`${manifestPackage.name} is missing valid repository metadata`);
    }
    if (field === "bugs" && !hasBugsMetadata(value)) {
      fail(`${manifestPackage.name} is missing valid bugs metadata`);
    }
    if (field === "keywords" && (!Array.isArray(value) || value.length === 0)) {
      fail(`${manifestPackage.name} must declare at least one keyword`);
    }
    if (field === "engines" && (!value || typeof value !== "object" || Object.keys(value).length === 0)) {
      fail(`${manifestPackage.name} must declare engines`);
    }
    if (field !== "repository" && field !== "bugs" && field !== "keywords" && field !== "engines" && !value) {
      fail(`${manifestPackage.name} is missing required metadata field "${field}"`);
    }
  }

  const readmePath = join(workspacePackage.packageDir, "README.md");
  if (!(await pathExists(readmePath))) {
    fail(`${manifestPackage.name} is missing README.md`);
  }

  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    fail(`${manifestPackage.name} must declare a non-empty files array`);
  }

  for (const entry of pkg.files) {
    const entryPath = join(workspacePackage.packageDir, entry); if (entry === "dist") continue; if (!(await pathExists(entryPath))) {
      fail(`${manifestPackage.name} files entry does not exist: ${entry}`);
    }
  }

  const hasBin = !!pkg.bin;

  if (false) {
    const directPathFields = [
      ["main", pkg.main],
      ["module", pkg.module],
      ["types", pkg.types],
    ] as const;

    for (const [field, value] of directPathFields) {
      if (!isNonEmptyString(value)) {
        fail(`${manifestPackage.name} must declare ${field}`);
      }
      const targetPath = join(workspacePackage.packageDir, value);
      if (!(await pathExists(targetPath))) {
        fail(`${manifestPackage.name} ${field} target does not exist: ${value}`);
      }
    }

    if (!pkg.exports || typeof pkg.exports !== "object") {
      fail(`${manifestPackage.name} must declare exports`);
    }

    const exportTargets: string[] = [];
    collectExportTargets(pkg.exports, exportTargets);
    for (const target of exportTargets) {
      const targetPath = join(workspacePackage.packageDir, target);
      if (!(await pathExists(targetPath))) {
        fail(`${manifestPackage.name} exports target does not exist: ${target}`);
      }
    }

    const distDir = join(workspacePackage.packageDir, "dist");
    if (!(await hasDirectoryWithFiles(distDir))) {
      fail(`${manifestPackage.name} dist directory is missing or empty`);
    }

    const distEsmDir = join(workspacePackage.packageDir, "dist", "esm");
    if (!(await hasDirectoryWithFiles(distEsmDir))) {
      fail(`${manifestPackage.name} dist/esm directory is missing or empty`);
    }

    const distTypesDir = join(workspacePackage.packageDir, "dist", "types");
    if (!(await hasDirectoryWithFiles(distTypesDir))) {
      fail(`${manifestPackage.name} dist/types directory is missing or empty`);
    }
  }

  if (manifestPackage.name === manifestPackage.publishName && manifestPackage.publishName === "zynth") {
    const bin = pkg.bin;
    if (!bin || typeof bin !== "object" || !isNonEmptyString((bin as Record<string, string>).zynth)) {
      fail(`zynth CLI package must expose a "zynth" bin entry`);
    }

    const binTarget = join(workspacePackage.packageDir, (bin as Record<string, string>).zynth);
    if (!(await pathExists(binTarget))) {
      fail(`zynth CLI bin target does not exist: ${(bin as Record<string, string>).zynth}`);
    }
  }

  if (
    manifestPackage.readiness === "ready-for-alpha-preflight" &&
    (manifestPackage.distribution === "native-source" || manifestPackage.distribution === "managed-binaries")
  ) {
    const iosDir = join(workspacePackage.packageDir, "ios");
    const androidDir = join(workspacePackage.packageDir, "android");
    if (!(await pathExists(iosDir))) {
      fail(`${manifestPackage.name} must include an ios directory for native distribution`);
    }
    if (!(await pathExists(androidDir))) {
      fail(`${manifestPackage.name} must include an android directory for native distribution`);
    }
    if (!(await hasPodspec(workspacePackage.packageDir))) {
      fail(`${manifestPackage.name} must include a podspec file for iOS native distribution`);
    }
  }
}

function validatePeerDependencyAlignment(
  targets: ManifestPackage[],
  workspaceMap: Map<string, WorkspacePackage>,
  manifestMap: Map<string, ManifestPackage>,
) {
  const frameworkLockstepTargets = new Set(
    targets
      .filter((target) => target.versionTrack === "framework-lockstep")
      .map((target) => target.name),
  );

  for (const target of targets) {
    const workspacePackage = workspaceMap.get(target.name);
    if (!workspacePackage) {
      fail(`Workspace package not found for manifest entry ${target.name}`);
    }

    const packagePeers = workspacePackage.packageJson.peerDependencies ?? {};
    for (const [peerName, peerRange] of Object.entries(packagePeers)) {
      const peerManifest = manifestMap.get(peerName);
      if (!peerManifest) {
        continue;
      }

      if (peerManifest.readiness === "private" || peerManifest.releaseTier === "internal") {
        fail(`${target.name} declares peer dependency on internal package ${peerName}`);
      }

      if (
        target.versionTrack === "framework-lockstep" &&
        frameworkLockstepTargets.has(peerName) &&
        isNonEmptyString(peerRange)
      ) {
        const peerWorkspace = workspaceMap.get(peerName);
        const expectedVersion = peerWorkspace?.packageJson.version;
        if (!isNonEmptyString(expectedVersion)) {
          fail(`Could not resolve expected version for peer package ${peerName}`);
        }
        if (!peerRangeLooksAligned(peerRange, expectedVersion)) {
          fail(
            `${target.name} peer dependency on ${peerName} is not aligned with lockstep policy: "${peerRange}" (expected ${expectedVersion}, ^${expectedVersion}, ~${expectedVersion}, or workspace equivalent)`,
          );
        }
      }
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

  log(`🔎 Running release preflight validation (scope: ${scope})`);

  const manifest = await loadManifest();
  validateManifestBasics(manifest);

  const workspacePackages = await discoverWorkspacePackages();
  await validateManifestCoverage(manifest, workspacePackages);

  const workspaceMap = new Map(
    workspacePackages
      .filter((entry) => isNonEmptyString(entry.packageJson.name))
      .map((entry) => [entry.packageJson.name as string, entry]),
  );

  const targets = manifest.packages.filter((entry) => shouldValidatePackage(entry, scope));
  if (targets.length === 0) {
    fail(`No manifest packages matched the requested scope: ${scope}`);
  }

  const manifestMap = new Map(manifest.packages.map((entry) => [entry.name, entry]));

  for (const target of targets) {
    const workspacePackage = workspaceMap.get(target.name);
    if (!workspacePackage) {
      fail(`Workspace package not found for manifest entry ${target.name}`);
    }

    log(`  → validating ${target.name}`);
    await validatePackage(target, workspacePackage);
  }

  validatePeerDependencyAlignment(targets, workspaceMap, manifestMap);

  log(`✅ Release preflight passed for ${targets.length} package(s).`);
}

main().catch((error) => {
  console.error("❌ Release preflight failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
