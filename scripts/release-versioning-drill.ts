#!/usr/bin/env node --experimental-strip-types

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
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
  version?: string;
};

type VersionSnapshot = {
  frameworkBefore: Record<string, string>;
  frameworkAfter: Record<string, string>;
  cliBefore: string;
  cliAfter: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const manifestPath = join(repoRoot, "docs", "package-release-manifest.json");
const changesetBin = join(repoRoot, "node_modules", ".bin", "changeset");
const tempRoot = join(repoRoot, ".tmp");
const drillChangesetName = "zynth-release-versioning-drill.md";
const snapshotTarName = "release-versioning-drill-snapshot.tar";

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

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "unknown error").trim();
    fail(`Command failed (${command} ${args.join(" ")}): ${details}`);
  }

  return result.stdout.trim();
}

function ensureManifestPackagePath(manifest: ReleaseManifest, packageName: string) {
  const found = manifest.packages.find((entry) => entry.name === packageName);
  if (!found) {
    fail(`Manifest missing package entry: ${packageName}`);
  }
  return found.path;
}

async function readPackageVersion(snapshotRoot: string, packagePath: string) {
  const packageJsonPath = join(snapshotRoot, packagePath, "package.json");
  const pkg = await readJsonFile<PackageJson>(packageJsonPath);
  if (!pkg.version) {
    fail(`Missing version in ${packageJsonPath}`);
  }
  return pkg.version;
}

async function captureVersions(snapshotRoot: string, manifest: ReleaseManifest): Promise<VersionSnapshot> {
  const frameworkBefore: Record<string, string> = {};
  const frameworkAfter: Record<string, string> = {};

  for (const packageName of manifest.releasePolicy.initialFrameworkPackages) {
    const packagePath = ensureManifestPackagePath(manifest, packageName);
    frameworkBefore[packageName] = await readPackageVersion(snapshotRoot, packagePath);
  }

  const cliPackageName = manifest.releasePolicy.initialCliPackage.publishName;
  const cliPackagePath = ensureManifestPackagePath(manifest, cliPackageName);
  const cliBefore = await readPackageVersion(snapshotRoot, cliPackagePath);

  return {
    frameworkBefore,
    frameworkAfter,
    cliBefore,
    cliAfter: "",
  };
}

async function writeDrillChangeset(snapshotRoot: string) {
  const content = `---
"@zynthjs/core": patch
---

Temporary release-versioning drill entry for readiness validation.
`;

  const changesetPath = join(snapshotRoot, ".changeset", drillChangesetName);
  await writeFile(changesetPath, content, "utf8");
}

function validateSnapshots(snapshot: VersionSnapshot) {
  const frameworkNames = Object.keys(snapshot.frameworkBefore);
  const frameworkAfterVersions = frameworkNames.map((name) => snapshot.frameworkAfter[name]);
  const firstAfterVersion = frameworkAfterVersions[0];

  if (!firstAfterVersion) {
    fail("Framework version drill failed: no framework versions captured after changeset version");
  }

  for (const packageName of frameworkNames) {
    const before = snapshot.frameworkBefore[packageName];
    const after = snapshot.frameworkAfter[packageName];
    if (before === after) {
      fail(`Framework lockstep drill failed: ${packageName} version did not change (${before})`);
    }
    if (after !== firstAfterVersion) {
      fail(
        `Framework lockstep drill failed: ${packageName} resolved to ${after}, expected ${firstAfterVersion}`,
      );
    }
  }

  if (!firstAfterVersion.includes("-alpha.")) {
    fail(`Expected alpha prerelease version after drill, got ${firstAfterVersion}`);
  }

  if (snapshot.cliBefore !== snapshot.cliAfter) {
    fail(
      `CLI independence drill failed: zynth changed from ${snapshot.cliBefore} to ${snapshot.cliAfter} during framework-only changeset`,
    );
  }
}

function printReport(snapshot: VersionSnapshot) {
  const frameworkNames = Object.keys(snapshot.frameworkBefore);
  log("Release versioning drill passed.");
  log("");
  log("Framework lockstep versions:");
  for (const packageName of frameworkNames) {
    log(`- ${packageName}: ${snapshot.frameworkBefore[packageName]} -> ${snapshot.frameworkAfter[packageName]}`);
  }
  log("");
  log(`CLI independence check: zynth stayed at ${snapshot.cliBefore}`);
}

async function createSnapshot(snapshotDir: string) {
  const tarPath = join(snapshotDir, snapshotTarName);
  run("git", ["archive", "--format=tar", "--output", tarPath, "HEAD"], repoRoot);
  run("tar", ["-xf", tarPath, "-C", snapshotDir], repoRoot);
}

async function cleanupSnapshot(snapshotDir: string | null) {
  if (!snapshotDir) return;
  await rm(snapshotDir, { recursive: true, force: true });
}

async function main() {
  if (!(await pathExists(changesetBin))) {
    fail(`Changeset CLI not found at ${changesetBin}. Run yarn install first.`);
  }

  const manifest = await readJsonFile<ReleaseManifest>(manifestPath);
  if (manifest.schemaVersion !== 1) {
    fail(`Unsupported manifest schemaVersion: ${manifest.schemaVersion}`);
  }

  await mkdir(tempRoot, { recursive: true });
  let snapshotDir: string | null = null;

  try {
    snapshotDir = await mkdtemp(join(tempRoot, "release-versioning-drill-"));
    await createSnapshot(snapshotDir);

    log("Running release versioning drill in isolated snapshot...");
    const snapshot = await captureVersions(snapshotDir, manifest);

    await writeDrillChangeset(snapshotDir);
    run(changesetBin, ["pre", "enter", "alpha"], snapshotDir);
    run(changesetBin, ["version"], snapshotDir);

    for (const packageName of manifest.releasePolicy.initialFrameworkPackages) {
      const packagePath = ensureManifestPackagePath(manifest, packageName);
      snapshot.frameworkAfter[packageName] = await readPackageVersion(snapshotDir, packagePath);
    }

    const cliPackageName = manifest.releasePolicy.initialCliPackage.publishName;
    const cliPackagePath = ensureManifestPackagePath(manifest, cliPackageName);
    snapshot.cliAfter = await readPackageVersion(snapshotDir, cliPackagePath);
    validateSnapshots(snapshot);
    printReport(snapshot);
  } finally {
    await cleanupSnapshot(snapshotDir);
  }
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
