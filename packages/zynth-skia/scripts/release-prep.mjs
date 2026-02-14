import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const nativeSourceExtensions = new Set([".h", ".hh", ".hpp", ".c", ".cc", ".cpp", ".m", ".mm"]);
const featureRootHeaders = {
  svg: [
    "modules/svg/include/SkSVGDOM.h",
    "modules/skresources/include/SkResources.h",
  ],
  skottie: [
    "modules/skottie/include/Skottie.h",
    "modules/skresources/include/SkResources.h",
  ],
  shaper: [
    "modules/skshaper/include/SkShaper.h",
    "modules/skunicode/include/SkUnicode.h",
  ],
};
const includeAliasMap = {
  "src/skcms_public.h": "modules/skcms/src/skcms_public.h",
};

function normalizeRelPath(relPath) {
  return relPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isSkiaIncludePath(includePath) {
  return includePath.startsWith("include/") || includePath.startsWith("src/") || includePath.startsWith("modules/");
}

function extractIncludePaths(content) {
  const includePaths = [];
  const regex = /^\s*#\s*include\s*[<"]([^">]+)[">]/gm;
  let match = regex.exec(content);
  while (match) {
    includePaths.push(normalizeRelPath(match[1]));
    match = regex.exec(content);
  }
  return includePaths;
}

function artifactOutputName(artifact) {
  const urlPath = new URL(artifact.url).pathname;
  return path.basename(urlPath);
}

function findArtifactByVariant(manifest, variant) {
  return manifest.artifacts.find((artifact) => String(artifact.variant || "") === variant) || null;
}

function collectFeatureRoots(features) {
  const roots = [];
  for (const feature of features) {
    const profile = featureRootHeaders[feature];
    if (!profile) {
      throw new Error(`Unknown feature "${feature}". Available: ${Object.keys(featureRootHeaders).join(", ")}`);
    }
    roots.push(...profile);
  }
  return roots;
}

async function readAdditionalHeaderRoots(rootsPath, context) {
  if (!(await context.pathExists(rootsPath))) return [];
  const raw = await fs.readFile(rootsPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid roots file ${rootsPath}: expected JSON array`);
  }

  const roots = [];
  for (const value of parsed) {
    if (typeof value !== "string") continue;
    const normalized = normalizeRelPath(value.trim());
    if (isSkiaIncludePath(normalized)) roots.push(normalized);
  }
  return roots;
}

async function collectNativeIncludeRoots(nativeScanDirs, context) {
  const roots = new Set();
  for (const scanDir of nativeScanDirs) {
    const files = await context.listFilesRecursive(scanDir);
    for (const file of files) {
      if (!nativeSourceExtensions.has(path.extname(file))) continue;
      const content = await fs.readFile(file, "utf8");
      for (const includePath of extractIncludePaths(content)) {
        if (isSkiaIncludePath(includePath)) {
          roots.add(includePath);
        }
      }
    }
  }
  return Array.from(roots).sort();
}

async function resolveHeaderSourceRelativePath(sourceRoot, relPath, context) {
  const candidates = [relPath];
  const alias = includeAliasMap[relPath];
  if (alias) candidates.push(alias);

  for (const candidate of candidates) {
    const target = path.join(sourceRoot, candidate);
    if (await context.pathExists(target)) {
      return candidate;
    }
  }
  return null;
}

async function resolveHeaderClosure(sourceRoot, entryHeaders, context) {
  const queue = [...entryHeaders];
  const resolved = new Set();
  const missing = [];

  while (queue.length > 0) {
    const rel = queue.shift();
    if (!rel || resolved.has(rel)) continue;

    const sourceRelative = await resolveHeaderSourceRelativePath(sourceRoot, rel, context);
    if (!sourceRelative) {
      missing.push(rel);
      continue;
    }

    const sourceFile = path.join(sourceRoot, sourceRelative);
    resolved.add(rel);

    const content = await fs.readFile(sourceFile, "utf8");
    for (const includePath of extractIncludePaths(content)) {
      if (!isSkiaIncludePath(includePath)) continue;
      if (!resolved.has(includePath)) queue.push(includePath);
    }
  }

  return {
    resolvedHeaders: Array.from(resolved).sort(),
    missingHeaders: missing.sort(),
  };
}

async function generateHeadersFromSource(manifest, args, context) {
  if (!args.source) {
    throw new Error("prepare-release requires --source pointing to a Skia source snapshot");
  }

  const sourceRoot = path.resolve(process.cwd(), args.source);
  if (!(await context.pathExists(sourceRoot))) {
    throw new Error(`Skia source snapshot not found: ${sourceRoot}`);
  }

  const headersArtifact = findArtifactByVariant(manifest, "headers");
  if (!headersArtifact) {
    throw new Error("Manifest must include variant=\"headers\" artifact");
  }

  const nativeRoots = await collectNativeIncludeRoots(context.nativeScanDirs, context);
  const featureRoots = collectFeatureRoots(args.features);
  const configRoots = await readAdditionalHeaderRoots(args.rootsPath, context);
  const entryRoots = Array.from(new Set([...nativeRoots, ...featureRoots, ...configRoots])).sort();

  const { resolvedHeaders, missingHeaders } = await resolveHeaderClosure(sourceRoot, entryRoots, context);
  if (!args.allowMissingHeaders && missingHeaders.length > 0) {
    throw new Error(`Missing ${missingHeaders.length} headers in snapshot. First missing: ${missingHeaders[0]}`);
  }

  const headersDestination = path.join(context.packageDir, headersArtifact.destination);
  const publicHeaderRoot = path.join(headersDestination, "skia");

  await context.removeIfExists(headersDestination);
  await context.ensureDir(publicHeaderRoot);

  let publicCount = 0;
  let internalCount = 0;

  for (const rel of resolvedHeaders) {
    const sourceRelative = await resolveHeaderSourceRelativePath(sourceRoot, rel, context);
    if (!sourceRelative) continue;
    const sourceFile = path.join(sourceRoot, sourceRelative);

    if (rel.startsWith("include/")) {
      const destination = path.join(publicHeaderRoot, rel);
      await context.ensureDir(path.dirname(destination));
      await fs.copyFile(sourceFile, destination);
      publicCount += 1;
      continue;
    }

    if (rel.startsWith("src/") || rel.startsWith("modules/")) {
      const destination = path.join(publicHeaderRoot, rel);
      await context.ensureDir(path.dirname(destination));
      await fs.copyFile(sourceFile, destination);
      internalCount += 1;
    }
  }

  const metadata = {
    generatedAt: new Date().toISOString(),
    sourceRoot,
    features: args.features,
    entryRootCount: entryRoots.length,
    entryRoots,
    resolvedHeaderCount: resolvedHeaders.length,
    publicHeaderCount: publicCount,
    internalHeaderCount: internalCount,
    missingHeaderCount: missingHeaders.length,
    missingHeaders,
  };

  await fs.writeFile(
    path.join(publicHeaderRoot, ".headers-manifest.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );

  return metadata;
}

async function ensureArtifactArchive(artifact, context, options = {}) {
  await context.ensureDir(context.cacheDir);
  const archivePath = path.join(context.cacheDir, `${artifact.id}.tar.gz`);
  const expectedSha = (artifact.sha256 || "").trim();
  const verifyExpected = options.verifyExpected !== false;

  if (await context.pathExists(archivePath)) {
    const cachedSha = await context.sha256(archivePath);
    if (!verifyExpected || !expectedSha || cachedSha === expectedSha) {
      return { archivePath, digest: cachedSha };
    }
  }

  await context.downloadToFile(artifact.url, archivePath);
  const digest = await context.sha256(archivePath);
  if (verifyExpected && expectedSha && digest !== expectedSha) {
    throw new Error(`Checksum mismatch for ${artifact.id}. Expected ${expectedSha}, got ${digest}`);
  }
  return { archivePath, digest };
}

async function packDirectoryToTar(sourceDir, tarPath, context) {
  await context.ensureDir(path.dirname(tarPath));
  execFileSync("tar", ["-czf", tarPath, "-C", path.dirname(sourceDir), path.basename(sourceDir)], {
    stdio: "inherit",
  });
}

export async function prepareReleaseBundle(manifest, args, context) {
  console.log(`Preparing release bundle for ${manifest.version}`);

  const outputDir = args.outDir.includes("current")
    ? path.join(context.defaultReleaseOutDir, manifest.version)
    : args.outDir;
  await context.removeIfExists(outputDir);
  await context.ensureDir(outputDir);

  const headerSummary = await generateHeadersFromSource(manifest, args, context);
  let hasManifestChanges = false;
  const outputs = [];
  const producedFiles = new Map();

  for (const artifact of manifest.artifacts) {
    const fileName = artifactOutputName(artifact);
    const tarPath = path.join(outputDir, fileName);
    let digest = null;
    let bytes = 0;
    let source = null;

    const existingOutput = producedFiles.get(fileName);
    if (existingOutput) {
      digest = existingOutput.digest;
      bytes = existingOutput.bytes;
      source = existingOutput.source;
    } else if (artifact.variant === "headers") {
      const destination = path.join(context.packageDir, artifact.destination);
      if (!(await context.pathExists(destination))) {
        throw new Error(`Artifact destination not found for ${artifact.id}: ${destination}`);
      }
      await packDirectoryToTar(destination, tarPath, context);
      digest = await context.sha256(tarPath);
      const stat = await fs.stat(tarPath);
      bytes = stat.size;
      source = destination;
      producedFiles.set(fileName, { digest, bytes, source });
    } else {
      const { archivePath, digest: archiveSha } = await ensureArtifactArchive(artifact, context, {
        verifyExpected: false,
      });
      await fs.copyFile(archivePath, tarPath);
      const stat = await fs.stat(tarPath);
      digest = archiveSha;
      bytes = stat.size;
      source = archivePath;
      producedFiles.set(fileName, { digest, bytes, source });
    }

    if (artifact.sha256 !== digest) {
      artifact.sha256 = digest;
      hasManifestChanges = true;
    }

    outputs.push({
      id: artifact.id,
      file: fileName,
      sha256: digest,
      bytes,
      source,
    });
  }

  await fs.writeFile(
    path.join(outputDir, "release-bundle.json"),
    `${JSON.stringify({
      version: manifest.version,
      generatedAt: new Date().toISOString(),
      features: args.features,
      headers: headerSummary,
      artifacts: outputs,
    }, null, 2)}\n`,
    "utf8"
  );

  if (hasManifestChanges) {
    await fs.writeFile(context.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log("Updated manifest checksums from local release bundle outputs.");
  }

  console.log(`Release bundle created at ${outputDir}`);
  for (const artifact of outputs) {
    console.log(`  ${artifact.file}  sha256=${artifact.sha256}`);
  }
}
