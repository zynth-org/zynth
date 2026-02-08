#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const manifestPath = path.join(packageDir, "binaries.manifest.json");
const cacheDir = path.join(packageDir, "native", "vendor", ".cache");
const tempDir = path.join(packageDir, "native", "vendor", ".tmp");

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
  return {
    command,
    force: args.includes("--force"),
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

async function run() {
  if (process.env.ZYNTH_SKIA_SKIP_BINARY_SYNC === "1") {
    console.log("Skipping Skia binaries sync (ZYNTH_SKIA_SKIP_BINARY_SYNC=1).");
    return;
  }

  const args = parseArgs(process.argv);
  if (!["sync", "update"].includes(args.command)) {
    throw new Error(`Unknown command "${args.command}". Use "sync" or "update".`);
  }

  const manifest = await readManifest();
  const writeChecksums = args.command === "update";
  const force = args.force || args.command === "update";

  console.log(
    `Synchronizing Skia binaries (${args.command}) for manifest version ${manifest.version}`
  );

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

  if (writeChecksums && hasManifestChanges) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log("Updated manifest checksums.");
  }

  console.log("Skia binaries sync complete.");
}

run().catch((error) => {
  console.error(`[zynth-skia] ${error.message}`);
  process.exit(1);
});
