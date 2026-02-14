#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { prepareReleaseBundle } from "./release-prep.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const manifestPath = path.join(packageDir, "binaries.manifest.json");
const cacheDir = path.join(packageDir, "native", "vendor", ".cache");
const tempDir = path.join(packageDir, "native", "vendor", ".tmp");
const defaultReleaseOutDir = path.join(packageDir, "native", "vendor", ".release");
const defaultHeaderRootsPath = path.join(packageDir, "native", "headers.roots.json");
const nativeScanDirs = [
  path.join(packageDir, "android", "ZynthSkia", "src", "main", "cpp"),
  path.join(packageDir, "ios"),
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || "sync";

  const readFlagValue = (flag) => {
    const flagIndex = args.indexOf(flag);
    if (flagIndex === -1) return null;
    const value = args[flagIndex + 1];
    if (!value || value.startsWith("--")) return null;
    return value;
  };

  const featureValue = readFlagValue("--features") || "";
  const features = featureValue
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const outputFlag = readFlagValue("--out");
  const rootsFlag = readFlagValue("--roots");

  return {
    command,
    force: args.includes("--force"),
    version: readFlagValue("--version"),
    strictChecksums: args.includes("--strict-checksums"),
    source: readFlagValue("--source") || null,
    outDir: outputFlag
      ? path.resolve(process.cwd(), outputFlag)
      : path.join(defaultReleaseOutDir, readFlagValue("--version") || "current"),
    features,
    allowMissingHeaders: args.includes("--allow-missing-headers"),
    rootsPath: rootsFlag
      ? path.resolve(process.cwd(), rootsFlag)
      : defaultHeaderRootsPath,
  };
}

async function readManifest() {
  const raw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error("Invalid binaries.manifest.json: artifacts must be an array");
  }
  return manifest;
}

function replaceReleaseTag(url, fromVersion, toVersion) {
  const marker = `/download/${fromVersion}/`;
  if (!url.includes(marker)) return url;
  return url.replace(marker, `/download/${toVersion}/`);
}

function downloadToFile(url, targetFile) {
  return new Promise((resolve, reject) => {
    const request = (inputUrl, redirectsLeft) => {
      const req = https.get(inputUrl, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          res.resume();
          request(res.headers.location, redirectsLeft - 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Download failed for ${url} (status ${status})`));
          return;
        }

        const fileStream = createWriteStream(targetFile);
        pipeline(res, fileStream)
          .then(resolve)
          .catch(reject);
      });

      req.on("error", reject);
    };

    request(url, 8);
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readJSONIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return null;
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

async function removeIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return;
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function listEntries(dirPath) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function listFilesRecursive(rootDir) {
  const out = [];
  if (!(await pathExists(rootDir))) return out;

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) out.push(fullPath);
    }
  }

  return out;
}

async function pickExtractionRoot(extractDir) {
  const entries = await listEntries(extractDir);
  if (entries.length !== 1) return extractDir;
  const first = entries[0];
  if (!first.isDirectory()) return extractDir;
  return path.join(extractDir, first.name);
}

async function copyDirContents(srcDir, destDir) {
  await ensureDir(destDir);
  const entries = await listEntries(srcDir);
  for (const entry of entries) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    await fs.cp(src, dest, { recursive: true });
  }
}

async function removeEntriesIfPresent(baseDir, names) {
  for (const name of names) {
    await removeIfExists(path.join(baseDir, name));
  }
}

function resolveIosSlice(artifact) {
  const variant = String(artifact.variant || "");
  if (variant === "arm64-device") return "ios-arm64_arm64e";
  if (variant === "arm64-simulator" || variant === "x86_64-simulator") {
    return "ios-arm64_x86_64-simulator";
  }
  return "ios-arm64_x86_64-simulator";
}

async function normalizeAndroidPayload(destinationDir) {
  await removeEntriesIfPresent(destinationDir, ["obj", "gen"]);
  const entries = await listEntries(destinationDir);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const keep =
      name.endsWith(".a") ||
      name.endsWith(".so") ||
      name.endsWith(".dat") ||
      name === ".artifact.json";
    if (!keep) {
      await removeIfExists(path.join(destinationDir, name));
    }
  }
}

async function normalizeIosPayload(destinationDir, artifact) {
  const iosRootCandidate = path.join(destinationDir, "ios");
  const iosRoot = (await pathExists(iosRootCandidate)) ? iosRootCandidate : destinationDir;

  const frameworksOut = path.join(destinationDir, "xcframeworks");
  const libsOut = path.join(destinationDir, "libs");
  await removeIfExists(frameworksOut);
  await removeIfExists(libsOut);
  await ensureDir(frameworksOut);
  await ensureDir(libsOut);

  const slice = resolveIosSlice(artifact);
  const entries = await listEntries(iosRoot);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".xcframework")) continue;
    const srcFramework = path.join(iosRoot, entry.name);
    const outFramework = path.join(frameworksOut, entry.name);
    await fs.cp(srcFramework, outFramework, { recursive: true });

    const candidateLib = path.join(srcFramework, slice, entry.name.replace(".xcframework", ".a"));
    if (await pathExists(candidateLib)) {
      await fs.cp(candidateLib, path.join(libsOut, path.basename(candidateLib)), { recursive: true });
    }
  }

  const legacySkiaLib = path.join(libsOut, "libskia.a");
  if (await pathExists(legacySkiaLib)) {
    await fs.cp(legacySkiaLib, path.join(destinationDir, "libskia.a"), { recursive: true });
  }

  if (iosRoot !== destinationDir) {
    await removeIfExists(iosRoot);
  } else {
    const entries = await listEntries(destinationDir);
    for (const entry of entries) {
      if (entry.name === "xcframeworks" || entry.name === "libs" || entry.name === ".artifact.json") {
        continue;
      }
      if (entry.name === "libskia.a") continue;
      await removeIfExists(path.join(destinationDir, entry.name));
    }
  }
}

async function normalizeArtifactPayload(destinationDir, artifact) {
  if (!artifact || typeof artifact !== "object") return;
  if (artifact.platform === "android") {
    await normalizeAndroidPayload(destinationDir);
    return;
  }
  if (artifact.platform === "ios") {
    await normalizeIosPayload(destinationDir, artifact);
  }
}

async function syncArtifact(artifact, manifest, options) {
  const destinationDir = path.join(packageDir, artifact.destination);
  const markerPath = path.join(destinationDir, ".artifact.json");
  const marker = await readJSONIfExists(markerPath);
  const expectedSha = (artifact.sha256 || "").trim();
  const shouldSkip =
    !options.force &&
    marker &&
    marker.url === artifact.url &&
    marker.version === manifest.version &&
    (!expectedSha || marker.sha256 === expectedSha);

  if (shouldSkip) {
    console.log(`• ${artifact.id}: up-to-date`);
    return null;
  }

  await ensureDir(cacheDir);
  await ensureDir(tempDir);

  const archivePath = path.join(cacheDir, `${artifact.id}.tar.gz`);
  const extractPath = path.join(tempDir, `${artifact.id}-extract`);

  console.log(`• ${artifact.id}: downloading`);
  await downloadToFile(artifact.url, archivePath);
  const downloadedSha = await sha256(archivePath);

  if (expectedSha && downloadedSha !== expectedSha) {
    throw new Error(
      `Checksum mismatch for ${artifact.id}. Expected ${expectedSha}, got ${downloadedSha}`
    );
  }

  await removeIfExists(extractPath);
  await ensureDir(extractPath);

  execFileSync("tar", ["-xzf", archivePath, "-C", extractPath], {
    stdio: "inherit",
  });

  const sourceRoot = await pickExtractionRoot(extractPath);
  await removeIfExists(destinationDir);
  await ensureDir(destinationDir);
  await copyDirContents(sourceRoot, destinationDir);
  await normalizeArtifactPayload(destinationDir, artifact);

  const markerData = {
    id: artifact.id,
    platform: artifact.platform,
    arch: artifact.arch,
    variant: artifact.variant,
    version: manifest.version,
    url: artifact.url,
    sha256: downloadedSha,
    syncedAt: new Date().toISOString(),
  };
  await fs.writeFile(markerPath, `${JSON.stringify(markerData, null, 2)}\n`, "utf8");

  console.log(`  ${artifact.id}: synced`);
  return downloadedSha;
}

function updateManifestRelease(manifest, options) {
  const nextVersion = options.version;
  const shouldUpdateVersion = typeof nextVersion === "string" && nextVersion.trim().length > 0;

  if (!shouldUpdateVersion) return false;

  const fromVersion = manifest.version;
  const targetVersion = nextVersion.trim();

  for (const artifact of manifest.artifacts) {
    artifact.url = replaceReleaseTag(artifact.url, fromVersion, targetVersion);
    artifact.sha256 = "";
  }

  manifest.version = targetVersion;
  return true;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value.trim());
}

function verifyManifest(manifest, options = {}) {
  const strictChecksums = options.strictChecksums === true;
  const seenIds = new Set();
  const seenDestinations = new Set();
  const errors = [];

  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    errors.push("manifest.version is required");
  }

  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    errors.push("manifest.artifacts must contain at least one entry");
  }

  for (let index = 0; index < manifest.artifacts.length; index += 1) {
    const artifact = manifest.artifacts[index];
    const label = `artifacts[${index}]`;
    if (!artifact || typeof artifact !== "object") {
      errors.push(`${label} must be an object`);
      continue;
    }

    if (typeof artifact.id !== "string" || artifact.id.trim().length === 0) {
      errors.push(`${label}.id is required`);
    } else if (seenIds.has(artifact.id)) {
      errors.push(`${label}.id "${artifact.id}" is duplicated`);
    } else {
      seenIds.add(artifact.id);
    }

    if (typeof artifact.destination !== "string" || artifact.destination.trim().length === 0) {
      errors.push(`${label}.destination is required`);
    } else if (seenDestinations.has(artifact.destination)) {
      errors.push(`${label}.destination "${artifact.destination}" is duplicated`);
    } else {
      seenDestinations.add(artifact.destination);
    }

    if (typeof artifact.url !== "string" || artifact.url.trim().length === 0) {
      errors.push(`${label}.url is required`);
    } else if (!artifact.url.includes(`/download/${manifest.version}/`)) {
      errors.push(`${label}.url must include manifest version "${manifest.version}"`);
    }

    const hasChecksum = typeof artifact.sha256 === "string" && artifact.sha256.trim().length > 0;
    if (strictChecksums ? !isSha256(artifact.sha256) : (hasChecksum && !isSha256(artifact.sha256))) {
      errors.push(`${label}.sha256 must be a 64-char hex digest`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Manifest verification failed:\n- ${errors.join("\n- ")}`);
  }
}

async function run() {
  const args = parseArgs(process.argv);
  const allowedCommands = ["sync", "update", "verify", "prepare-release"];
  if (!allowedCommands.includes(args.command)) {
    throw new Error(`Unknown command "${args.command}". Use ${allowedCommands.join(", ")}.`);
  }

  const isSyncCommand = args.command === "sync" || args.command === "update";
  if (isSyncCommand && process.env.ZYNTH_SKIA_SKIP_BINARY_SYNC === "1") {
    console.log("Skipping Skia binaries sync (ZYNTH_SKIA_SKIP_BINARY_SYNC=1).");
    return;
  }

  const manifest = await readManifest();
  if (args.command === "verify") {
    verifyManifest(manifest, { strictChecksums: args.strictChecksums });
    console.log(`Manifest verification passed for ${manifest.artifacts.length} artifacts.`);
    return;
  }

  if (args.command === "prepare-release") {
    verifyManifest(manifest, { strictChecksums: false });
    await prepareReleaseBundle(manifest, args, {
      packageDir,
      manifestPath,
      cacheDir,
      defaultReleaseOutDir,
      nativeScanDirs,
      pathExists,
      ensureDir,
      removeIfExists,
      listFilesRecursive,
      sha256,
      downloadToFile,
    });
    return;
  }

  const writeChecksums = args.command === "update";
  const force = args.force || args.command === "update";
  const manifestReleaseChanged = args.command === "update" && updateManifestRelease(manifest, args);

  console.log(`Synchronizing Skia binaries (${args.command}) for manifest version ${manifest.version}`);

  let hasManifestChanges = false;
  for (const artifact of manifest.artifacts) {
    try {
      const actualSha = await syncArtifact(artifact, manifest, { force });
      if (writeChecksums && actualSha && artifact.sha256 !== actualSha) {
        artifact.sha256 = actualSha;
        hasManifestChanges = true;
      }
    } catch (error) {
      if (artifact.optional) {
        console.warn(`  ${artifact.id}: optional artifact failed (${error.message})`);
        continue;
      }
      throw error;
    }
  }

  if (writeChecksums && (hasManifestChanges || manifestReleaseChanged)) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log("Updated manifest checksums.");
  }

  console.log("Skia binaries sync complete.");
}

run().catch((error) => {
  console.error(`[zynth-skia] ${error.message}`);
  process.exit(1);
});
