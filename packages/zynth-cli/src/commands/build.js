const path = require("path");
const fs = require("fs");
const { execSync, spawnSync } = require("child_process");
const {
  findWorkspaceRoot,
  findAppDirectory,
  ensureBundle,
  getIOSConfig,
  getAndroidConfig,
  runCommand,
  requireScript,
  resolveInternalProjectScriptPath,
  runCommandFiltered,
  runCommandFilteredAndroid,
  printZynthBuildStatus,
  readJSON,
} = require("../utils");

function gray(text) {
  return `\x1b[90m${text}\x1b[0m`;
}

function brightWhite(text) {
  return `\x1b[97m${text}\x1b[0m`;
}

function parseDotEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadAppDotEnv(appDir) {
  const envPath = path.join(appDir, ".env");
  if (!fs.existsSync(envPath)) {
    return { loaded: false, count: 0 };
  }

  const content = fs.readFileSync(envPath, "utf8");
  let count = 0;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const lineWithoutExport = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;
    const equalsIndex = lineWithoutExport.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = lineWithoutExport.slice(0, equalsIndex).trim();
    if (!key) continue;

    const value = parseDotEnvValue(lineWithoutExport.slice(equalsIndex + 1));
    if (process.env[key] === undefined) {
      process.env[key] = value;
      count += 1;
    }
  }

  return { loaded: true, count };
}

module.exports = {
  command: "build <platform>",
  describe: "Build production version of the app",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to build for",
      choices: ["ios", "android"],
    });
    yargs.option("skip-bundle", {
      describe: "Skip JS bundle generation",
      type: "boolean",
      default: false,
    });
    yargs.option("team", {
      describe: "Development team ID for iOS code signing",
      type: "string",
    });
    yargs.option("allow-provisioning-updates", {
      describe: "Allow Xcode to automatically update provisioning profiles",
      type: "boolean",
      default: true,
    });
    yargs.option("allow-provisioning-device-registration", {
      describe: "Allow Xcode to register devices automatically",
      type: "boolean",
      default: false,
    });
    yargs.option("export-options-plist", {
      describe: "Path to export options plist for IPA export",
      type: "string",
    });
    yargs.option("verbose", {
      describe: "Print raw native build output without filtering",
      type: "boolean",
      default: false,
    });
    yargs.option("format", {
      describe: "Android output format for release build",
      type: "string",
      choices: ["apk", "aab"],
      default: "apk",
    });
    yargs.option("bootstrap", {
      describe: "Regenerate native project before building",
      type: "boolean",
      default: false,
    });
  },
  handler: async (argv) => {
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());

    const dotEnvResult = loadAppDotEnv(appDir);
    if (dotEnvResult.loaded && dotEnvResult.count > 0) {
      console.log("◆ Loaded app environment from .env");
    }

    let root = appDir;
    try {
      root = findWorkspaceRoot(process.cwd());
    } catch (_error) {
      // Standalone app: use app root as command root
    }

    // Build JS bundle if not skipped
    if (!argv.skipBundle) {
      console.log("◆ Building JavaScript bundle...");
      ensureBundle(appDir);
    }

    // Verify bundle exists
    const bundlePath = path.join(appDir, "dist", "main.js");
    if (!fs.existsSync(bundlePath)) {
      throw new Error(
        `✖ JS bundle not found at ${bundlePath}. Cannot proceed with ${argv.platform} build.`
      );
    }

    const hbcPath = path.join(appDir, "dist", "main.hbc");
    compileBundleToHermesBytecode(appDir, bundlePath, hbcPath, argv.platform);

    // After bundling, scan it for glyph usage to support subsetting
    let glyphMap = null;
    if (fs.existsSync(bundlePath)) {
      glyphMap = scanBundleForGlyphs(bundlePath);
    }

    if (argv.platform === "ios") {
      await buildIOS(root, appDir, argv, glyphMap);
    } else {
      if (argv.bootstrap) {
        await ensureBootstrap(root, appDir, "android", {
          dev: false,
          quiet: false,
        });
      }
      removeAndroidDevConfigAsset(appDir);

      // Now ensure assets (like fonts) are discovered and copied to native folders
      // We do this BEFORE copying the bundle, but AFTER scanning glyphs
      console.log(`◆ Generating assets for ${argv.platform}...`);
      try {
        const { generateAssets } = requireScript(
          resolveInternalProjectScriptPath("generate-assets")
        );
        await generateAssets(appDir, argv.platform, false, glyphMap);
      } catch (e) {
        console.warn(`! Failed to generate assets: ${e.message}`);
      }

      // Android needs manual bundle copy since Gradle doesn't auto-copy in release builds
      copyBundleToAndroid(appDir);
      await buildAndroid(root, appDir, argv);
    }
  },
};

function scanBundleForGlyphs(bundlePath) {
  try {
    let content = fs.readFileSync(bundlePath, "utf8");
    
    // Handle escaped Unicode sequences like \uE801 before scanning.
    // Minifiers often convert non-ASCII characters to these escapes.
    content = content.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });

    const glyphMap = {};
    // Match patterns like "glyph","ZynthIconsXX" or 'glyph','ZynthIconsXX'
    // including cases where the character is now unescaped.
    // We allow optional spaces and handle both ' and " quotes.
    const regex = /(['"])([\uE000-\uF8FF])\1\s*,\s*(['"])(ZynthIcons[A-Z]{2})\3/g;
    let match;
    let count = 0;
    while ((match = regex.exec(content)) !== null) {
      const glyph = match[2];
      const font = match[4];
      if (!glyphMap[font]) glyphMap[font] = new Set();
      glyphMap[font].add(glyph);
      count++;
    }
    
    // Convert Sets to sorted strings for the subsetter
    const result = {};
    for (const [font, glyphs] of Object.entries(glyphMap)) {
      result[font] = Array.from(glyphs).sort().join("");
    }
    if (count > 0) {
      console.log(`◆ Discovered ${count} used glyphs across ${Object.keys(result).length} icon libraries`);
    }
    return result;
  } catch (e) {
    console.warn(`! Failed to scan bundle for glyphs: ${e.message}`);
    return null;
  }
}

function copyBundleToAndroid(appDir) {
  const bundleSrc = path.join(appDir, "dist", "main.js");
  if (!fs.existsSync(bundleSrc)) {
    throw new Error(
      "✖ JS bundle not found at dist/main.js. Run the build command without --skip-bundle first."
    );
  }

  const androidDir = path.join(appDir, "android");
  if (!fs.existsSync(androidDir)) {
    throw new Error(
      `✖ Android project not found at ${androidDir}. Run 'zynth bootstrap android' first to generate the native project.`
    );
  }

  const assetsDir = path.join(androidDir, "app", "src", "main", "assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const bundleDest = path.join(assetsDir, "main.js");
  const hbcDest = path.join(assetsDir, "main.hbc");

  const hasHbc = fs.existsSync(path.join(appDir, "dist", "main.hbc"));

  if (hasHbc) {
    fs.copyFileSync(path.join(appDir, "dist", "main.hbc"), hbcDest);
    console.log(
      `✔ Copied Hermes bytecode to android/app/src/main/assets/main.hbc`
    );
    // If we have HBC, we can skip main.js to save space, but only if the native side expects it.
    // However, the ZynthRuntime prefers main.hbc over main.js anyway.
    // For extreme size savings, we skip main.js.
    console.log(`◆ Skipping JS source copy since Hermes bytecode is present (saves ~1MB)`);
    if (fs.existsSync(bundleDest)) {
      try {
        fs.unlinkSync(bundleDest);
      } catch (e) {}
    }
  } else {
    fs.copyFileSync(bundleSrc, bundleDest);
    console.log(`◆ Copied JS bundle to android/app/src/main/assets/main.js`);
    console.warn(
      "! dist/main.hbc not found. Android runtime will fallback to JS source."
    );
  }
}

function removeAndroidDevConfigAsset(appDir) {
  const devConfigPath = path.join(
    appDir,
    "android",
    "app",
    "src",
    "main",
    "assets",
    "zynth-dev-config.json"
  );

  if (!fs.existsSync(devConfigPath)) {
    return;
  }

  try {
    fs.unlinkSync(devConfigPath);
    console.log(
      "◆ Removed dev-only asset android/app/src/main/assets/zynth-dev-config.json"
    );
  } catch (error) {
    console.warn(
      `! Failed to remove dev-only Android asset (${devConfigPath}): ${error.message}`
    );
  }
}

function compileBundleToHermesBytecode(appDir, bundleSrc, hbcDest, platform) {
  if (!fs.existsSync(bundleSrc)) return false;

  console.log(`◆ Compiling JS bundle to Hermes bytecode for ${platform}...`);
  const hermescPath = resolveHermesCompilerPath(appDir);
  if (!hermescPath) {
    console.warn(
      "! hermesc not found. Skipping HBC compilation (runtime will use main.js)."
    );
    return false;
  }

  try {
    if (fs.existsSync(hbcDest)) {
      fs.unlinkSync(hbcDest);
    }
    const hermesArgs = [
      "-emit-binary",
      // App bundles legitimately reference host-provided globals (console, Promise, timers, URL...).
      // Keep other warnings enabled while suppressing undeclared-global noise.
      "-Wno-undefined-variable",
      "-out",
      `"${hbcDest}"`,
      `"${bundleSrc}"`,
    ].join(" ");
    execSync(`"${hermescPath}" ${hermesArgs}`, { stdio: "inherit" });
    console.log(`✔ Generated Hermes bytecode: ${path.relative(process.cwd(), hbcDest)}`);
    return true;
  } catch (error) {
    console.warn(`! HBC compilation failed: ${error.message}`);
    return false;
  }
}

function resolveHermesCompilerPath(appDir) {
  const candidates = [
    process.env.HERMES_CLI_PATH,
    "hermesc",
    path.join(appDir, "node_modules", ".bin", "hermesc"),
    path.join(appDir, "node_modules", "react-native", "sdks", "hermesc", "osx-bin", "hermesc"),
    path.join(appDir, "node_modules", "react-native", "sdks", "hermesc", "linux64-bin", "hermesc"),
    path.join(appDir, "ios", "Pods", "hermes-engine", "destroot", "bin", "hermesc"),
    path.join(appDir, "ios", "Pods", "hermes-engine", "build_host_hermesc", "bin", "hermesc"),
    path.join(process.env.ANDROID_HOME || "", "hermes", "bin", "hermesc"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --help`, { stdio: "ignore" });
      return candidate;
    } catch (error) {
      // Try next location
    }
  }

  return null;
}

function resolveSigningStoreFile(appDir, androidDir, storeFile) {
  if (!storeFile || typeof storeFile !== "string") {
    return null;
  }
  const trimmed = storeFile.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = path.isAbsolute(trimmed)
    ? [trimmed]
    : [path.resolve(appDir, trimmed), path.resolve(androidDir, trimmed)];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "N/A";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function detectAndroidArtifacts(androidDir) {
  const outputsDir = path.join(androidDir, "app", "build", "outputs");
  const allFiles = walkFiles(outputsDir);
  return allFiles
    .filter((filePath) => /[\\/]release[\\/]/.test(filePath))
    .filter((filePath) => filePath.endsWith(".apk") || filePath.endsWith(".aab"))
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const format = filePath.endsWith(".aab") ? "AAB" : "APK";
      return {
        path: filePath,
        format,
        sizeBytes: stat.size,
      };
    })
    .sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function isCommandAvailable(command) {
  const probeArgs = process.platform === "win32" ? ["/?"] : ["--help"];
  const result = spawnSync(command, probeArgs, { stdio: "ignore" });
  return result.status !== null;
}

function detectArtifactSigning(artifactPath, format, signingConfigured) {
  const lowerPath = artifactPath.toLowerCase();
  if (lowerPath.includes("unsigned")) {
    return "NO";
  }

  if (format === "APK") {
    if (isCommandAvailable("apksigner")) {
      try {
        execSync(`apksigner verify "${artifactPath}"`, { stdio: "ignore" });
        return "YES";
      } catch (_error) {
        return "NO";
      }
    }
    return signingConfigured ? "YES" : "NO";
  }

  if (format === "AAB") {
    if (isCommandAvailable("jarsigner")) {
      try {
        execSync(`jarsigner -verify "${artifactPath}"`, { stdio: "ignore" });
        return "YES";
      } catch (_error) {
        return "NO";
      }
    }
    return signingConfigured ? "YES" : "NO";
  }

  return signingConfigured ? "YES" : "NO";
}

function printAndroidArtifactSummary(androidDir, signingConfigured, preferredFormat) {
  const artifacts = detectAndroidArtifacts(androidDir);
  if (!artifacts.length) {
    console.warn("! No Android release artifacts were found in app/build/outputs.");
    return null;
  }

  const normalizedPreferred = String(preferredFormat || "").toUpperCase();
  const preferred =
    artifacts.find((artifact) => artifact.format === normalizedPreferred) ||
    artifacts[0];
  const relativePath = path.relative(androidDir, preferred.path);
  const size = formatBytes(preferred.sizeBytes);
  const signed = detectArtifactSigning(
    preferred.path,
    preferred.format,
    signingConfigured
  );

  const summaryLine =
    `${gray("[ FORMAT : ")}${brightWhite(preferred.format)}${gray(" ] | [ SIZE : ")}` +
    `${brightWhite(size)}${gray(" ] | [ SIGNED : ")}${brightWhite(signed)}${gray(" ]")}`;
  const outputLine =
    `${gray("[ OUTPUT : ")}${brightWhite(relativePath)}${gray(" ]")}`;

  console.log(`◆ ${summaryLine}`);
  console.log(`◆ ${outputLine}`);

  return relativePath;
}

async function buildIOS(root, appDir, argv, glyphMap = null) {
  const config = getIOSConfig(root, appDir);
  const iosDir = path.join(appDir, "ios");

  if (argv.bootstrap) {
    await ensureBootstrap(root, appDir, "ios", {
      dev: false,
      quiet: false,
      glyphMap,
    });
  } else {
    console.log("◆ Generating assets for ios...");
    try {
      const { generateAssets } = requireScript(
        resolveInternalProjectScriptPath("generate-assets")
      );
      await generateAssets(appDir, "ios", false, glyphMap);
    } catch (e) {
      console.warn(`! Failed to generate assets: ${e.message}`);
    }
  }

  if (!fs.existsSync(iosDir)) {
    throw new Error(
      `✖ iOS project not found at ${iosDir}.\n` +
        `Run 'zynth bootstrap ios' first to generate the native project, then configure signing in Xcode.`
    );
  }

  const workspacePath = `${config.appNameCapitalized}.xcworkspace`;
  if (!fs.existsSync(path.join(iosDir, workspacePath))) {
    throw new Error(
      `✖ Xcode workspace not found at ios/${workspacePath}.\n` +
        `Run 'pod install' in the ios directory first.`
    );
  }

  const buildArgs = [
    "-workspace",
    `${config.appNameCapitalized}.xcworkspace`,
    "-scheme",
    config.appNameCapitalized,
    "-configuration",
    "Release",
    "-sdk",
    "iphoneos",
    "-derivedDataPath",
    ".build",
    "archive",
    "-archivePath",
    `.build/${config.appNameCapitalized}.xcarchive`,
  ];

  // Add automatic provisioning updates (enabled by default)
  if (argv.allowProvisioningUpdates) {
    buildArgs.push("-allowProvisioningUpdates");
    console.log("◆ Automatic provisioning updates enabled");
  }

  // Add device registration if specified
  if (argv.allowProvisioningDeviceRegistration) {
    buildArgs.push("-allowProvisioningDeviceRegistration");
    console.log("◆ Automatic device registration enabled");
  }

  // Add development team if specified
  if (argv.team) {
    buildArgs.push(`DEVELOPMENT_TEAM=${argv.team}`);
    console.log(`◆ Using development team: ${argv.team}`);
  }

  console.log(`◆ Building ${config.appNameCapitalized} for iOS (Release)...`);
  const buildResult = await runCommandFiltered("xcodebuild", buildArgs, {
    cwd: iosDir,
    verbose: argv.verbose,
    root,
  });

  if (buildResult.code !== 0) {
    console.error("\n✖ Build failed!");
    console.error("\n◆ Troubleshooting tips:");
    console.error("   1. Open Xcode and sign in with your Apple ID:");
    console.error("      Xcode > Settings > Accounts");
    console.error("   2. Open the project and configure signing:");
    console.error(`      open ${path.join(iosDir, workspacePath)}`);
    console.error(
      "      Then: Select project > Signing & Capabilities > Select Team"
    );
    console.error("   3. If you have certificate issues, you may need to:");
    console.error("      - Revoke old certificates in developer.apple.com");
    console.error("      - Let Xcode create a new certificate");
    console.error("   4. Specify your team ID:");
    console.error(`      yarn zynth build ios --team YOUR_TEAM_ID`);
    process.exit(buildResult.code || 1);
  }

  const archivePath = `ios/.build/${config.appNameCapitalized}.xcarchive`;
  console.log("\n✔ iOS Release build completed!");
  printZynthBuildStatus({
    appDir,
    platform: "ios",
    outputPath: archivePath,
  });
}

async function buildAndroid(root, appDir, argv) {
  const config = getAndroidConfig(root, appDir);
  const requestedFormat =
    String(argv.format || config.androidConfig?.buildOutputFormat || "apk")
      .trim()
      .toLowerCase() === "aab"
      ? "aab"
      : "apk";
  const gradleTask =
    requestedFormat === "aab" ? ":app:bundleRelease" : ":app:assembleRelease";
  const formatLabel = requestedFormat.toUpperCase();
  console.log(`◆ Building Android Release ${formatLabel}...`);

  const androidDir = path.join(appDir, "android");

  const env = { ...process.env };
  const signing = config.androidConfig?.signing;
  let appliedSigning = false;
  if (signing) {
    const resolvedStoreFile = resolveSigningStoreFile(
      appDir,
      androidDir,
      signing.storeFile
    );

    if (signing.storeFile && !resolvedStoreFile) {
      console.warn(
        `! Android signing storeFile not found (${signing.storeFile}). Skipping CLI signing env and continuing with Gradle defaults.`
      );
    }

    if (resolvedStoreFile) {
      env.ZYNTH_KEYSTORE_FILE = resolvedStoreFile;
      appliedSigning = true;
    }
    if (signing.keyAlias) {
      env.ZYNTH_KEY_ALIAS = signing.keyAlias;
      appliedSigning = true;
    }
    if (signing.storePassword)
      env.ZYNTH_KEYSTORE_PASSWORD = signing.storePassword;
    if (signing.storePassword) appliedSigning = true;
    if (signing.keyPassword) {
      env.ZYNTH_KEY_PASSWORD = signing.keyPassword;
      appliedSigning = true;
    }

    if (appliedSigning) {
      console.log("◆ Using signing config from app.json");
    }
  }

  const hasEnvSigning =
    Boolean(env.ZYNTH_KEY_ALIAS) &&
    Boolean(env.ZYNTH_KEY_PASSWORD) &&
    Boolean(env.ZYNTH_KEYSTORE_PASSWORD);
  const resolvedEnvStoreFile = resolveSigningStoreFile(
    appDir,
    androidDir,
    env.ZYNTH_KEYSTORE_FILE
  );
  if (resolvedEnvStoreFile) {
    env.ZYNTH_KEYSTORE_FILE = resolvedEnvStoreFile;
  }
  if (!appliedSigning && hasEnvSigning && resolvedEnvStoreFile) {
    appliedSigning = true;
    console.log("◆ Using signing config from environment");
  }

  const result = await runCommandFilteredAndroid(
    "./gradlew",
    [gradleTask],
    {
      cwd: androidDir,
      env,
      verbose: argv.verbose,
      root,
    }
  );

  if (result.code !== 0) {
    console.error("✖ Android build failed.");
    process.exit(result.code || 1);
  }

  printZynthBuildStatus({
    appDir,
    platform: "android",
    includeOutput: false,
  });

  printAndroidArtifactSummary(androidDir, appliedSigning, formatLabel);
  console.log("✔ Android Release build completed!");
}
