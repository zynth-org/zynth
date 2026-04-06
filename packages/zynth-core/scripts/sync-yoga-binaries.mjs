#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import https from "node:https";
import { execFileSync } from "node:child_process";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BRIGHT = "\x1b[1m";
const RED = "\x1b[31m";

const SYMBOL_STEP = `${GREEN}◆${RESET}`;
const SYMBOL_SUCCESS = `${GREEN}✔${RESET}`;
const SYMBOL_SUBSTEP = `${GREEN}➔${RESET}`;
const SYMBOL_FAIL = `${RED}✘${RESET}`;
const SYMBOL_BULLET = `${GREEN}•${RESET}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const manifestPath = path.join(packageDir, "yoga.manifest.json");
const cacheDir = path.join(packageDir, "native", "vendor", ".cache_yoga");
const tempDir = path.join(packageDir, "native", "vendor", ".tmp_yoga");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJSONIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return null;
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw);
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
        pipeline(res, fileStream).then(resolve).catch(reject);
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

async function removeIfExists(targetPath) {
  if (!(await pathExists(targetPath))) return;
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function syncArtifact(artifact, manifest, options) {
  const verbose = options.verbose;
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
    if (verbose) {
      console.log(`${SYMBOL_BULLET} ${artifact.id}: ${DIM}up-to-date${RESET}`);
    }
    return marker.sha256;
  }

  await ensureDir(cacheDir);
  await ensureDir(tempDir);

  const archivePath = path.join(cacheDir, `${artifact.id}.tar.gz`);
  const extractPath = path.join(tempDir, `${artifact.id}-extract`);

  if (verbose) {
    console.log(`${SYMBOL_BULLET} ${artifact.id}: ${BRIGHT}downloading${RESET}`);
  }
  await downloadToFile(artifact.url, archivePath);
  const downloadedSha = await sha256(archivePath);

  if (!options.force && expectedSha && downloadedSha !== expectedSha) {
    throw new Error(
      `Checksum mismatch for ${artifact.id}. Expected ${expectedSha}, got ${downloadedSha}`
    );
  }

  await removeIfExists(extractPath);
  await ensureDir(extractPath);

  // Extract
  execFileSync("tar", ["-xzf", archivePath, "-C", extractPath]);

  // Handle Yoga headers nested folder structure if needed
  let sourceRoot = extractPath;
  const entries = await fs.readdir(extractPath, { withFileTypes: true });
  if (entries.length === 1 && entries[0].isDirectory()) {
    sourceRoot = path.join(extractPath, entries[0].name);
  }

  await removeIfExists(destinationDir);
  await ensureDir(destinationDir);
  
  // Custom logic for Yoga headers: they need to BE in a 'yoga' subfolder if they aren't.
  // The tarball provides them at the root.
  // For headers, we want them at destination/yoga/ headers
  if (artifact.variant === "headers") {
      const includeDir = path.join(destinationDir, "yoga");
      await ensureDir(includeDir);
      const files = await fs.readdir(sourceRoot);
      for (const f of files) {
          await fs.cp(path.join(sourceRoot, f), path.join(includeDir, f), { recursive: true });
      }
  } else {
      // For binaries, just copy everything
      const files = await fs.readdir(sourceRoot);
      for (const f of files) {
          await fs.cp(path.join(sourceRoot, f), path.join(destinationDir, f), { recursive: true });
      }

      // Ensure SONAME consistency: ZynthKit expects libyogacore.so.
      // If the tarball only provided libyoga.so, we create a copy as libyogacore.so.
      const yogaSo = path.join(destinationDir, "libyoga.so");
      const yogaCoreSo = path.join(destinationDir, "libyogacore.so");
      if (await pathExists(yogaSo) && !(await pathExists(yogaCoreSo))) {
          await fs.copyFile(yogaSo, yogaCoreSo);
      }
  }

  const markerData = {
    id: artifact.id,
    version: manifest.version,
    url: artifact.url,
    sha256: downloadedSha,
    syncedAt: new Date().toISOString(),
  };
  await fs.writeFile(markerPath, `${JSON.stringify(markerData, null, 2)}\n`, "utf8");

  if (verbose) {
    console.log(`  ${SYMBOL_SUBSTEP} ${artifact.id}: ${GREEN}synced${RESET}`);
  }
  return downloadedSha;
}

async function run() {
  const args = process.argv.slice(2);
  const command = args[0] || "sync";
  const force = args.includes("--force") || command === "update";
  const verbose = args.includes("--verbose");

  const rawManifest = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(rawManifest);

  if (verbose) {
    console.log(`${SYMBOL_STEP} Synchronizing Yoga binaries (${BRIGHT}${command}${RESET})`);
    console.log(`  ${DIM}Manifest version: ${manifest.version}${RESET}\n`);
  }

  let hasChanges = false;
  for (const artifact of manifest.artifacts) {
    try {
      const actualSha = await syncArtifact(artifact, manifest, { force, verbose });
      if (command === "update" && actualSha && artifact.sha256 !== actualSha) {
        artifact.sha256 = actualSha;
        hasChanges = true;
      }
    } catch (e) {
      if (artifact.optional) {
        if (verbose) {
          console.warn(`  ${SYMBOL_BULLET} ${artifact.id}: ${DIM}optional failed (${e.message})${RESET}`);
        }
      } else {
        throw e;
      }
    }
  }

  if (command === "update" && hasChanges) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    if (verbose) {
      console.log(`\n${SYMBOL_SUCCESS} Updated manifest checksums.`);
    }
  }
}

run().catch((e) => {
  console.error(`\n${SYMBOL_FAIL} ${RED}Error:${RESET} ${e.message}`);
  process.exit(1);
});
