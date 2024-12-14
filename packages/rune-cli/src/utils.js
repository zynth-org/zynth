const fs = require("fs");
const path = require("path");
const http = require("http");
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

function removeDirectory(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function getBootedSimulatorId() {
  const output = readCommandOutput("xcrun", [
    "simctl",
    "list",
    "devices",
    "booted",
    "--json",
  ]);
  if (!output) {
    return null;
  }
  try {
    const parsed = JSON.parse(output);
    const devices = parsed.devices || {};
    for (const runtime of Object.keys(devices)) {
      const entries = devices[runtime] || [];
      for (const device of entries) {
        if (device.state === "Booted" && device.udid) {
          return device.udid;
        }
      }
    }
  } catch (error) {
    console.warn("⚠️  Failed to parse simctl output:", error.message);
  }
  return null;
}

async function waitForDevServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const target = `${url.replace(/\/$/, "")}/main.js`;

  const attempt = () =>
    new Promise((resolve) => {
      const req = http.get(target, (res) => {
        res.resume();
        resolve(
          res.statusCode && res.statusCode >= 200 && res.statusCode < 300
        );
      });
      req.on("error", () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await attempt();
    if (ok) {
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function readRuneArtifacts(appDir) {
  const artifactPath = path.join(appDir, ".rune", "artifacts.json");
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(artifactPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`⚠️  Failed to read ${artifactPath}:`, error.message);
    return null;
  }
}

function sanitizeToken(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function waitForHMRToken(appDir, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const artifacts = readRuneArtifacts(appDir);
    const token = artifacts && sanitizeToken(artifacts.hmrServerToken);
    if (token) {
      return token;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
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
  const defaultPort = 8081;
  const port = Number(process.env.RUNE_HMR_PORT || options.port || defaultPort);
  const localHost = process.env.RUNE_HMR_HOST || "localhost";
  const bindHost =
    process.env.RUNE_HMR_BIND ||
    (localHost === "localhost" ? "0.0.0.0" : localHost);
  const defaultDeviceHost = platform === "android" ? "10.0.2.2" : "127.0.0.1";
  const deviceHostOverride = options.deviceHostOverride;
  const deviceHost =
    deviceHostOverride || process.env.RUNE_DEVICE_HOST || defaultDeviceHost;

  const args = ["rsbuild", "dev", "--port", String(port), "--host", bindHost];

  console.log(
    `🔥 Starting Rsbuild dev server (port ${port}, host ${bindHost})...`
  );

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(command, args, {
    cwd: appDir,
    stdio: "inherit",
    env: {
      ...process.env,
      RUNE_HMR_PORT: String(port),
    },
  });

  child.on("error", (error) => {
    console.error("❌ Failed to launch Rsbuild dev server:", error.message);
  });

  const cleanup = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", cleanup);

  const localUrl = `http://${localHost}:${port}`;
  const deviceUrl = `http://${deviceHost}:${port}`;

  console.log(`✓ Rsbuild dev server spawned`);
  console.log(`  Local:   ${localUrl}`);
  console.log(`  Device:  ${deviceUrl}`);
  console.log(`  Bundle:  ${deviceUrl}/main.js`);
  console.log(`  Updates: ${deviceUrl}/bundle/app.hot-update.json`);
  console.log(`  Socket:  ws://${deviceHost}:${port}/rsbuild-hmr`);

  return {
    process: child,
    port,
    localUrl,
    deviceUrl,
    deviceHost,
  };
}

async function devIOS(root, appDir, options = {}) {
  const config = getIOSConfig(root, appDir);
  const iosDir = path.join(appDir, "ios");

  if (options.prebuild) {
    console.log("♻️  Regenerating iOS project (--prebuild)");
    removeDirectory(iosDir);
    ensurePrebuild(root, appDir, "ios", { dev: true });
  }

  if (!fs.existsSync(iosDir)) {
    console.error(
      "❌ iOS project not found. Run `rune prebuild ios` or pass --prebuild."
    );
    process.exit(1);
  }

  const workspacePath = path.join(
    iosDir,
    `${config.appNameCapitalized}.xcworkspace`
  );
  if (!fs.existsSync(workspacePath)) {
    console.error(
      `❌ Missing workspace at ${workspacePath}. Regenerate with --prebuild.`
    );
    process.exit(1);
  }

  console.log(`🛠️  Building ${config.appNameCapitalized} for iOS simulator...`);
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

  const simulatorId = getBootedSimulatorId();
  if (!simulatorId) {
    console.error(
      "❌ No booted iOS simulator detected. Launch a simulator and try again."
    );
    process.exit(1);
  }

  const appBundlePath = path.join(
    iosDir,
    ".build",
    "Build",
    "Products",
    "Debug-iphonesimulator",
    `${config.appNameCapitalized}.app`
  );
  if (!fs.existsSync(appBundlePath)) {
    console.error(
      `❌ Built app not found at ${appBundlePath}. Check xcodebuild output.`
    );
    process.exit(1);
  }

  console.log("📥 Installing build to simulator...");
  runCommand("xcrun", ["simctl", "install", simulatorId, appBundlePath]);

  const desiredPort = Number(process.env.RUNE_HMR_PORT || 8081);
  const hmrServer = await startRuneHMRServer(appDir, "ios", {
    port: desiredPort,
  });

  if (!hmrServer) {
    console.error("❌ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  const serverReady = await waitForDevServer(hmrServer.localUrl);
  if (!serverReady) {
    console.error(
      "❌ Rsbuild dev server did not respond within the expected time window."
    );
    process.exit(1);
  }

  const hmrToken = await waitForHMRToken(appDir);
  if (hmrToken) {
    console.log("🔐 Injecting HMR token into simulator environment");
    process.env.RUNE_DEV_SERVER_TOKEN = hmrToken;
    runCommand("xcrun", [
      "simctl",
      "spawn",
      simulatorId,
      "launchctl",
      "setenv",
      "RUNE_DEV_SERVER_TOKEN",
      hmrToken,
    ]);
  } else {
    console.warn(
      "⚠️  HMR token not detected; continuing without authentication"
    );
    delete process.env.RUNE_DEV_SERVER_TOKEN;
    const unsetResult = spawnSync("xcrun", [
      "simctl",
      "spawn",
      simulatorId,
      "launchctl",
      "unsetenv",
      "RUNE_DEV_SERVER_TOKEN",
    ]);
    if (unsetResult.status !== 0) {
      console.warn(
        "⚠️  Unable to clear RUNE_DEV_SERVER_TOKEN from simulator environment"
      );
    }
  }

  runCommand("xcrun", [
    "simctl",
    "spawn",
    simulatorId,
    "launchctl",
    "setenv",
    "RUNE_DEV_SERVER_URL",
    hmrServer.deviceUrl,
  ]);

  console.log("🚀 Launching application on simulator...");
  runCommand("xcrun", ["simctl", "launch", simulatorId, config.bundleId]);

  const logProcess = startIOSLogs(config);
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
      "🔥 Rsbuild dev server running. Leave this session open for hot reloading."
    );
  }

  await new Promise(() => {});
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

  if (!hmrServer) {
    console.error("❌ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  const serverReady = await waitForDevServer(hmrServer.localUrl);
  if (!serverReady) {
    console.error(
      "❌ Rsbuild dev server did not respond within the expected time window."
    );
    process.exit(1);
  }

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
