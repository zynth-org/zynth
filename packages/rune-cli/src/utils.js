const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = readJSON(pkgPath);
      if (pkg.workspaces) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "Workspace root not found. Run this command inside a Rune workspace."
      );
    }
    current = parent;
  }
}

function findAppDirectory(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, "app.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "Could not determine app directory. Pass --app <relative-path>."
      );
    }
    current = parent;
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const code = result.status == null ? 1 : result.status;
    process.exit(code);
  }
}

function runNode(scriptPath, args = [], options = {}) {
  runCommand(process.execPath, [scriptPath, ...args], options);
}

function readCommandOutput(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function getIOSConfig(root, appDir) {
  const script = require(path.join(root, "scripts", "generate-ios.js"));
  return script.getAppConfig(appDir);
}

function getAndroidConfig(root, appDir) {
  const base = getIOSConfig(root, appDir);
  const fallback = `com.rune.${base.appDir.replace(/-/g, "")}`;
  const pkgName = (base.bundleId || fallback).toLowerCase();
  return { ...base, bundleId: pkgName };
}

function ensurePrebuild(root, appDir, platform, options = {}) {
  const script = platform === "ios" ? "prebuild-ios.js" : "prebuild-android.js";
  const scriptPath = path.join(root, "scripts", script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Missing ${script} at ${scriptPath}`);
  }

  // Load and call the prebuild script with options
  const prebuildModule = require(scriptPath);
  const originalCwd = process.cwd();
  try {
    process.chdir(appDir);
    prebuildModule.main(options);
  } finally {
    process.chdir(originalCwd);
  }
}

function ensureBundle(appDir) {
  runCommand("yarn", ["build"], { cwd: appDir });
}

function getConnectedAndroidDevices() {
  const output = readCommandOutput("adb", ["devices"]);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.endsWith("device"))
    .map((line) => line.split("\t")[0]);
}

function startIOSLogs(config) {
  try {
    const child = spawn(
      "xcrun",
      [
        "simctl",
        "spawn",
        "booted",
        "log",
        "stream",
        "--style",
        "compact",
        "--level",
        "debug",
        "--predicate",
        `process == "${config.appNameCapitalized}" AND (eventMessage BEGINSWITH "[Rune]" OR eventMessage CONTAINS "JS[error]" OR eventMessage CONTAINS "JS[log]")`,
      ],
      {
        stdio: "inherit",
      }
    );
    const dispose = () => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    };
    process.on("exit", dispose);
    process.on("SIGINT", () => {
      dispose();
      process.exit(0);
    });
    return child;
  } catch (error) {
    console.warn("⚠️  Failed to start iOS logs:", error.message);
    return null;
  }
}

async function startRuneHMRServer(appDir, platform, options = {}) {
  const { RuneHMRServer } = require("@rune/hmr");

  const defaultPort = 8081;
  const resolvedPort = Number(process.env.RUNE_HMR_PORT || defaultPort);
  const localHost = process.env.RUNE_HMR_HOST || "localhost";
  const bindHost =
    process.env.RUNE_HMR_BIND ||
    (localHost === "localhost" ? "0.0.0.0" : localHost);
  const defaultDeviceHost = platform === "android" ? "10.0.2.2" : "localhost";
  const deviceHostOverride = options.deviceHostOverride;
  const deviceHost =
    deviceHostOverride || process.env.RUNE_DEVICE_HOST || defaultDeviceHost;

  const devServerLocalUrl = `http://${localHost}:${resolvedPort}`;
  const devServerDeviceUrl = `http://${deviceHost}:${resolvedPort}`;

  console.log(`🔥 Starting Rune HMR server on ${devServerLocalUrl}...`);

  const server = new RuneHMRServer({
    appRoot: appDir,
    port: resolvedPort,
    outDir: "dist",
    host: bindHost,
  });

  try {
    await server.start();

    // Setup cleanup handlers
    const dispose = async () => {
      console.log("\n🛑 Stopping Rune HMR server...");
      await server.stop();
    };

    process.on("exit", dispose);
    process.on("SIGINT", async () => {
      await dispose();
      process.exit(0);
    });
    process.on("SIGTERM", dispose);

    console.log(`✓ Rune HMR server running`);
    console.log(`  Local:  ${devServerLocalUrl}`);
    console.log(`  Device: ${devServerDeviceUrl}`);
    console.log(`  Bundle: ${devServerDeviceUrl}/bundle/main.js`);
    console.log(`  WebSocket: ws://${deviceHost}:${resolvedPort}/rune-native`);

    return {
      server,
      deviceUrl: devServerDeviceUrl,
      localUrl: devServerLocalUrl,
      deviceHost,
      port: resolvedPort,
    };
  } catch (error) {
    console.error("❌ Failed to start Rune HMR server:", error.message);
    return null;
  }
}

async function devIOS(root, appDir) {
  const config = getIOSConfig(root, appDir);
  ensurePrebuild(root, appDir, "ios", { dev: true });
  const logProcess = startIOSLogs(config);

  // Start Rune HMR server
  const hmrServer = await startRuneHMRServer(appDir, "ios");

  console.log(`📦 Building ${config.appNameCapitalized} for iOS simulator...`);
  const iosDir = path.join(appDir, "ios");
  runCommand(
    "xcodebuild",
    [
      "-workspace",
      `${config.appNameCapitalized}.xcworkspace`,
      "-scheme",
      config.appNameCapitalized,
      "-configuration",
      "Debug",
      "-sdk",
      "iphonesimulator",
      "-derivedDataPath",
      ".build",
    ],
    { cwd: iosDir }
  );
  console.log("🚀 Installing build to simulator...");
  const appBundle = path.join(
    ".build",
    "Build",
    "Products",
    "Debug-iphonesimulator",
    `${config.appNameCapitalized}.app`
  );
  runCommand("xcrun", ["simctl", "bootstatus", "booted", "-b"]);
  runCommand("xcrun", ["simctl", "install", "booted", appBundle], {
    cwd: iosDir,
  });

  if (hmrServer?.deviceUrl) {
    runCommand("xcrun", [
      "simctl",
      "spawn",
      "booted",
      "launchctl",
      "setenv",
      "RUNE_DEV_SERVER_URL",
      hmrServer.deviceUrl,
    ]);
  }

  const launchArgs = ["simctl", "launch", "booted", config.bundleId];
  runCommand("xcrun", launchArgs);

  if (logProcess) {
    console.log("📖 iOS logs streaming. Press Ctrl+C to stop.");
    logProcess.on("exit", (code, signal) => {
      if (signal !== "SIGTERM") {
        console.log(`ℹ️  Log stream ended (${signal || code})`);
      }
    });
  }

  if (hmrServer) {
    console.log(
      "🔥 Rune HMR server running. Leave this session open for hot reloading."
    );
  }
}

async function devAndroid(root, appDir) {
  const config = getAndroidConfig(root, appDir);

  const initialDevices = getConnectedAndroidDevices();
  const userDeviceHost = process.env.RUNE_DEVICE_HOST;
  const hasPhysicalDeviceInitially = initialDevices.some(
    (id) => !id.startsWith("emulator-")
  );

  // Start Rune HMR server
  const hmrServer = await startRuneHMRServer(appDir, "android", {
    deviceHostOverride:
      userDeviceHost || (hasPhysicalDeviceInitially ? "127.0.0.1" : undefined),
  });

  ensurePrebuild(root, appDir, "android", { dev: true });
  console.log("📦 Installing Android build...");
  const androidDir = path.join(appDir, "android");
  runCommand("./gradlew", [":app:assembleDebug"], { cwd: androidDir });

  const devices = getConnectedAndroidDevices();
  if (!devices.length) {
    console.warn(
      "⚠️  No Android devices or emulators detected. Skipping install."
    );
    console.warn(
      "    Install/launch manually with an emulator or device when available."
    );
    return;
  }

  const hasPhysicalDeviceConnected = devices.some(
    (id) => !id.startsWith("emulator-")
  );
  const portForReverse =
    hmrServer?.port || Number(process.env.RUNE_HMR_PORT || 8081);
  const shouldReverse =
    !!hmrServer &&
    portForReverse &&
    ((!userDeviceHost && hasPhysicalDeviceConnected) ||
      userDeviceHost === "127.0.0.1");

  if (shouldReverse) {
    for (const deviceId of devices) {
      const result = spawnSync("adb", [
        "-s",
        deviceId,
        "reverse",
        `tcp:${portForReverse}`,
        `tcp:${portForReverse}`,
      ]);
      if (result.status !== 0) {
        console.warn(
          `⚠️  Failed to reverse port ${portForReverse} for ${deviceId}`
        );
      }
    }
    if (!userDeviceHost && hasPhysicalDeviceConnected) {
      console.log(
        "🔄 Enabled adb reverse for connected device(s); tunneling via localhost."
      );
    }
  } else if (hasPhysicalDeviceConnected && !userDeviceHost) {
    console.warn(
      "⚠️  Physical device detected. Use USB (adb reverse) or set RUNE_DEVICE_HOST to your LAN IP."
    );
  }

  runCommand("./gradlew", [":app:installDebug"], { cwd: androidDir });

  let runtimeDeviceUrl = hmrServer?.deviceUrl;
  if (!userDeviceHost && hasPhysicalDeviceConnected && portForReverse) {
    runtimeDeviceUrl = `http://127.0.0.1:${portForReverse}`;
  } else if (userDeviceHost) {
    runtimeDeviceUrl = `http://${userDeviceHost}:${portForReverse}`;
  }

  const launchArgs = [
    "shell",
    "am",
    "start",
    "-n",
    `${config.bundleId}/.MainActivity`,
  ];
  if (runtimeDeviceUrl) {
    launchArgs.push("--es", "RUNE_DEV_SERVER_URL", runtimeDeviceUrl);
  }
  runCommand("adb", launchArgs);

  if (hmrServer) {
    console.log(
      "🔥 Rune HMR server running. Leave this session open for hot reloading."
    );
    if (runtimeDeviceUrl && runtimeDeviceUrl !== hmrServer.deviceUrl) {
      console.log(`  ↳ Device URL: ${runtimeDeviceUrl}`);
    }
  }
}

function listWorkspaces(root, folder) {
  const baseDir = path.join(root, folder);
  if (!fs.existsSync(baseDir)) {
    return [];
  }
  return fs
    .readdirSync(baseDir)
    .map((entry) => path.join(baseDir, entry))
    .filter((entryPath) => fs.statSync(entryPath).isDirectory())
    .map((dirPath) => {
      const pkgPath = path.join(dirPath, "package.json");
      if (!fs.existsSync(pkgPath)) {
        return null;
      }
      const pkg = readJSON(pkgPath);
      return {
        name: pkg.name,
        dir: dirPath,
        scripts: pkg.scripts || {},
      };
    })
    .filter(Boolean);
}

function bundle(scope, root) {
  const runWorkspaceBuild = (workspace) => {
    if (!workspace.scripts.build) {
      console.log(`⚠️  Skipping ${workspace.name}; no build script defined.`);
      return;
    }
    console.log(`📦 Bundling ${workspace.name}...`);
    runCommand("yarn", ["workspace", workspace.name, "run", "build"], {
      cwd: root,
    });
  };

  if (scope === "apps" || scope === "all") {
    const apps = listWorkspaces(root, "apps");
    apps.forEach(runWorkspaceBuild);
  }
  if (scope === "packages" || scope === "all") {
    const packages = listWorkspaces(root, "packages");
    packages
      .filter((workspace) => workspace.name !== "@rune/cli")
      .forEach(runWorkspaceBuild);
  }
}

function resetIOS(appDir) {
  const targets = [path.join(appDir, "ios"), path.join(appDir, "dist")];
  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  console.log(
    "🧹 Removed iOS build artifacts. Run `rune prebuild ios` to regenerate."
  );
}

function resetAndroid(appDir) {
  const targets = [path.join(appDir, "android"), path.join(appDir, "dist")];
  for (const target of targets) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  console.log(
    "🧹 Removed Android build artifacts. Run `rune prebuild android` to regenerate."
  );
}

module.exports = {
  readJSON,
  findWorkspaceRoot,
  findAppDirectory,
  runCommand,
  runNode,
  readCommandOutput,
  devIOS,
  devAndroid,
  ensurePrebuild,
  ensureBundle,
  getConnectedAndroidDevices,
  startIOSLogs,
  getIOSConfig,
  getAndroidConfig,
  startRuneHMRServer,
  listWorkspaces,
  bundle,
  resetIOS,
  resetAndroid,
};
