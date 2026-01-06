const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const chalk = require("chalk");
const readline = require("readline");

const BUILD_SHIMMER_START = Date.now();
const { createDevtoolsHub } = require("./devtools/hub");
const { IOS_BUILD_NOISE_PATTERNS } = require("./ios-build-filters");

let devtoolsPublish = null;

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

function runCommandFiltered(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...options,
  });

  const buildIndicator = createBuildIndicator("Building native artifacts");
  buildIndicator.start();
  let resumeTimer = null;
  let lastOutputAt = 0;
  function writeBuildLine(stream, line) {
    buildIndicator.clearLine(stream);
    stream.write(`📦 ${line}\n`);
    buildIndicator.renderOnce();
  }
  let lastDiagnosticAt = 0;
  const noisePatterns = IOS_BUILD_NOISE_PATTERNS;
  const reportedPackages = new Set();

  function tryReportPackage(line) {
    const match = line.match(/packages[\\/](rune-[^\\/]+)/);
    const name = match ? match[1] : null;
    if (!name || reportedPackages.has(name)) return;
    reportedPackages.add(name);
    writeBuildLine(process.stdout, `• ${name.replace(/^rune-/, "")} built`);
  }

  function shouldSkip(line) {
    return noisePatterns.some((pattern) => pattern.test(line));
  }

  function isDiagnostic(line) {
    return (
      /\berror:/i.test(line) ||
      /\bwarning:/i.test(line) ||
      /fatal error:/i.test(line)
    );
  }

  function shouldPrint(line) {
    if (shouldSkip(line)) return false;
    if (isDiagnostic(line)) {
      lastDiagnosticAt = Date.now();
      return true;
    }
    if (/\bnote:/i.test(line) && Date.now() - lastDiagnosticAt < 1000) {
      return true;
    }
    return false;
  }

  function handleData(data, stream) {
    const text = data.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      lastOutputAt = Date.now();
      if (resumeTimer) {
        clearTimeout(resumeTimer);
      }
      if (
        line.includes("packages/rune-") &&
        (line.includes("Compile") ||
          line.includes("SwiftEmitModule") ||
          line.includes("ProcessInfoPlistFile") ||
          line.includes("ProcessPCH") ||
          line.includes("CompileAssetCatalog") ||
          line.includes("Ld "))
      ) {
        tryReportPackage(line);
      }
      if (shouldPrint(line)) {
        writeBuildLine(stream, line);
      }
    }
  }

  child.stdout.on("data", (data) => handleData(data, process.stdout));
  child.stderr.on("data", (data) => handleData(data, process.stderr));

  return new Promise((resolve) => {
    child.on("close", (code, signal) => {
      buildIndicator.stop();
      resolve({ code, signal });
    });
  });
}

function createBuildIndicator(label) {
  const text = String(label);
  let timer = null;
  let lastWidth = 0;

  function renderShimmer() {
    const width = text.length;
    if (width === 0) return;
    const padding = 10;
    const period = width + padding * 2;
    const sweepSeconds = 2.0;
    const elapsedSeconds = (Date.now() - BUILD_SHIMMER_START) / 1000;
    const pos =
      ((elapsedSeconds % sweepSeconds) / sweepSeconds) * period;
    const bandHalfWidth = 5.0;
    const hasTrueColor = Boolean(chalk.supportsColor?.has16m);
    const base = { r: 128, g: 128, b: 128 };
    const highlight = { r: 255, g: 255, b: 255 };
    let output = "";
    for (let i = 0; i < width; i += 1) {
      const iPos = i + padding;
      const dist = Math.abs(iPos - pos);
      const t =
        dist <= bandHalfWidth
          ? 0.5 * (1 + Math.cos(Math.PI * (dist / bandHalfWidth)))
          : 0;
      if (hasTrueColor) {
        const color = mixColor(base, highlight, t * 0.9);
        output += chalk.rgb(color.r, color.g, color.b).bold(text[i]);
      } else if (t < 0.2) {
        output += chalk.dim(text[i]);
      } else if (t < 0.6) {
        output += text[i];
      } else {
        output += chalk.bold(text[i]);
      }
    }
    const pad = lastWidth > output.length ? " ".repeat(lastWidth - output.length) : "";
    lastWidth = output.length;
    process.stdout.write(`\r${output}${pad}`);
  }

  function clearLine(stream = process.stdout) {
    if (!stream.isTTY) return;
    readline.clearLine(stream, 0);
    readline.cursorTo(stream, 0);
  }

  return {
    start() {
      if (!process.stdout.isTTY) {
        process.stdout.write(`${text}\n`);
        return;
      }
      if (timer) return;
      process.stdout.write("\u001b[?25l");
      renderShimmer();
      timer = setInterval(renderShimmer, 80);
    },
    renderOnce() {
      if (!process.stdout.isTTY) return;
      renderShimmer();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      clearLine();
      process.stdout.write("\u001b[?25h");
    },
    clearLine,
  };
}

function mixColor(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
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

function writeDeviceDevConfig(deviceId, bundleId, jsonPayload) {
  const ensureDir = spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "run-as",
      bundleId,
      "/system/bin/mkdir",
      "-p",
      "files/.rune",
    ],
    { encoding: "utf8" }
  );

  if (ensureDir.status !== 0) {
    const output = ensureDir.stderr || ensureDir.stdout || "unknown error";
    // Ignore benign "File exists" errors, surface everything else for visibility.
    if (!/File exists/i.test(output || "")) {
      console.warn(
        `⚠️  Failed to prepare dev config directory on ${deviceId}: ${output.trim()}`
      );
    }
  }

  const result = spawnSync(
    "adb",
    [
      "-s",
      deviceId,
      "shell",
      "run-as",
      bundleId,
      "sh",
      "-c",
      "/system/bin/cat > files/.rune/dev-server.json",
    ],
    {
      input: jsonPayload,
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    console.warn(
      `⚠️  Failed to write dev config to ${deviceId}: ${
        result.stderr || result.stdout || "unknown error"
      }`
    );
  }
}

function writeAndroidDevAsset(androidDir, payload) {
  const assetDir = path.join(androidDir, "app", "src", "main", "assets");
  const assetPath = path.join(assetDir, "rune-dev-config.json");

  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(assetPath, `${payload}\n`, "utf8");
}

function getIOSConfig(root, appDir) {
  const tsPath = path.join(root, "scripts", "config-utils.ts");
  
  if (fs.existsSync(tsPath)) {
    try {
      require("ts-node").register({
        transpileOnly: true,
        compilerOptions: { 
          module: "commonjs",
          moduleResolution: "node"
        }
      });
      const script = require(tsPath);
      return script.getAppConfig(appDir);
    } catch (e) {
      console.warn("⚠️  Failed to load config-utils.ts:", e.message);
    }
  }

  // Fallback for legacy setups
  const scriptPath = path.join(root, "scripts", "generate-ios.js");
  if (fs.existsSync(scriptPath)) {
      const script = require(scriptPath);
      return script.getAppConfig(appDir);
  }
  
  throw new Error("Could not load app config. Missing scripts/config-utils.ts or generate-ios.js");
}

function getAndroidConfig(root, appDir) {
  const base = getIOSConfig(root, appDir);
  const fallback = `com.rune.${base.appDir.replace(/-/g, "")}`;
  const pkgName = (base.bundleId || fallback).toLowerCase();
  return { ...base, bundleId: pkgName };
}

function ensurePrebuild(root, appDir, platform, options = {}) {
  const scriptName = platform === "ios" ? "prebuild-ios" : "prebuild-android";
  const tsPath = path.join(root, "scripts", `${scriptName}.ts`);
  const jsPath = path.join(root, "scripts", `${scriptName}.js`);
  
  let scriptPath = jsPath;
  if (fs.existsSync(tsPath)) {
    scriptPath = tsPath;
    // Register ts-node if we're loading a TS file
    try {
      require("ts-node").register({
        transpileOnly: true,
        compilerOptions: { 
          module: "commonjs",
          moduleResolution: "node"
        }
      });
    } catch (e) {
      console.warn("⚠️  ts-node not found, trying to run TS script without registration might fail.");
    }
  } else if (!fs.existsSync(jsPath)) {
    throw new Error(`Missing ${scriptName}.ts or ${scriptName}.js in ${path.join(root, "scripts")}`);
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
    removeDirectoryWithRetries(targetPath);
  }
}

function removeDirectoryWithRetries(targetPath, retries = 5) {
  const sleep = (ms) => {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, ms);
  };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      if (!["ENOTEMPTY", "EBUSY", "EPERM"].includes(error.code)) {
        throw error;
      }
      sleep(50 * (attempt + 1));
    }
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

function getConnectedIOSDevices() {
  const output = readCommandOutput("xcrun", ["xctrace", "list", "devices"]);
  if (!output) {
    return [];
  }

  const devices = [];
  const lines = output.split("\n");
  let isDeviceSection = false;

  for (const line of lines) {
    if (line.startsWith("== Simulators ==")) {
      isDeviceSection = false;
    }
    if (isDeviceSection && line.trim()) {
      const match = line.match(/^(.*?) \((.*?)\) \((.*?)\)/);
      if (match) {
        const [, name, version, udid] = match;
        devices.push({
          type: "device",
          name: name.trim(),
          version,
          udid,
          isBooted: false, // Physical devices are always "booted" in a sense
        });
      }
    }
    if (line.startsWith("== Devices ==")) {
      isDeviceSection = true;
    }
  }

  const bootedSimulatorId = getBootedSimulatorId();
  if (bootedSimulatorId) {
    devices.push({
      type: "simulator",
      name: "Booted Simulator",
      udid: bootedSimulatorId,
      isBooted: true,
    });
  }

  return devices;
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
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const noisePatterns = [
      /getpwuid_r did not find a match for uid/i,
      /^Filtering the log data using/i,
    ];
    const handleLine = (line) => {
      if (!line.trim()) return;
      if (noisePatterns.some((pattern) => pattern.test(line))) {
        return;
      }
      line = line.replace(/^\s*[A-Z]{3}\s+/, "");
      if (/^Timestamp\s+Ty\s+Process/i.test(line)) {
        return;
      }
      line = line.replace(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+\s+\w+\s+[^ ]+\[\d+:[^\]]+\]\s+\([^)]+\)\s+/,
        ""
      );
      if (typeof devtoolsPublish === "function") {
        devtoolsPublish({
          topic: "log/ios",
          level: "info",
          tag: "ios",
          data: line,
        });
        return;
      }
      process.stdout.write(`${line}\n`);
    };
    const handleData = (data) => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        handleLine(line);
      }
    };
    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);
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

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name] || [];
    for (const iface of ifaceList) {
      // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  // Fallback for cases where no external IPv4 is found
  return "127.0.0.1";
}

async function startRuneDevtoolsHub({ host, port }) {
  const hub = createDevtoolsHub({ host, port, print: true, json: false });
  const server = await hub.start();
  devtoolsPublish = hub.publish;
  console.log(
    `🔌 Rune devtools hub listening at ws://${server.host}:${server.port}`
  );
  return server;
}

function buildDevtoolsUrl({ deviceHost, port, override }) {
  if (override) return override;
  if (!deviceHost || !port) return null;
  return `ws://${deviceHost}:${port}`;
}

async function startRuneHMRServer(appDir, platform, options = {}) {
  const defaultPort = 8081;
  const port = Number(process.env.RUNE_HMR_PORT || options.port || defaultPort);
  const localHost = process.env.RUNE_HMR_HOST || "localhost";
  const bindHost =
    process.env.RUNE_HMR_BIND ||
    (localHost === "localhost" ? "0.0.0.0" : localHost);
  const defaultSimulatorHost =
    platform === "android" ? "10.0.2.2" : "127.0.0.1";
  const defaultPhysicalHost = getLocalIp();
  const defaultDeviceHost = options.isPhysicalDevice
    ? defaultPhysicalHost
    : defaultSimulatorHost;
  const deviceHostOverride = options.deviceHostOverride;
  let deviceHost =
    deviceHostOverride || process.env.RUNE_DEVICE_HOST || defaultDeviceHost;

  if (options.local) {
    deviceHost = "127.0.0.1";
  } else if (options.hmrNetwork) {
    deviceHost = getLocalIp();
  }
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
  let targetDevice = null;
  const devtoolsEnabled = options.devtools !== false;
  const devtoolsPort = Number(
    process.env.RUNE_DEVTOOLS_PORT || options.devtoolsPort || 8091
  );
  const devtoolsUrlOverride = process.env.RUNE_DEVTOOLS_URL;
  const devtoolsToken = process.env.RUNE_DEVTOOLS_TOKEN;

  if (options.devices) {
    const availableDevices = getConnectedIOSDevices();
    if (availableDevices.length === 0) {
      console.error(
        "❌ No booted iOS simulator or connected physical device detected."
      );
      console.error(
        "   Launch a simulator or connect a device via USB and try again."
      );
      process.exit(1);
    }
    const inquirer = (await import("inquirer")).default;
    const { selectedDevice } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedDevice",
        message: "Select a device to launch on",
        choices: availableDevices.map((d) => ({
          name: `${d.name} (${d.type})`,
          value: d,
        })),
      },
    ]);
    targetDevice = selectedDevice;
  } else {
    // Default to booted simulator if --devices is not used
    const simulatorId = getBootedSimulatorId();
    if (!simulatorId) {
      console.error(
        "❌ No booted iOS simulator detected. Launch a simulator or use `rune dev ios --devices` to select a target."
      );
      process.exit(1);
    }
    targetDevice = {
      type: "simulator",
      name: "Booted Simulator",
      udid: simulatorId,
      isBooted: true,
    };
  }

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

  const isPhysicalDevice = targetDevice.type === "device";
  const sdk = isPhysicalDevice ? "iphoneos" : "iphonesimulator";
  const buildConfiguration = "Debug";
  const buildDir = path.join(iosDir, ".build");

  console.log(
    `🛠️  Building ${config.appNameCapitalized} for ${targetDevice.name} (${sdk})...`
  );

  const buildArgs = [
    "-workspace",
    `${config.appNameCapitalized}.xcworkspace`,
    "-scheme",
    config.appNameCapitalized,
    "-configuration",
    buildConfiguration,
    "-sdk",
    sdk,
    "-derivedDataPath",
    buildDir,
  ];

  if (isPhysicalDevice) {
    // For physical devices, we don't need a destination if we use `ios-deploy`
    // which will find the device by its UDID. We do need to provide
    // code signing information.
    buildArgs.push("CODE_SIGN_STYLE=Automatic");
    const devTeam = process.env.RUNE_IOS_DEVELOPMENT_TEAM;
    if (devTeam) {
      buildArgs.push(`DEVELOPMENT_TEAM=${devTeam}`);
    } else {
      console.warn(
        "\n⚠️  Building for a physical device. If the build fails due to code signing, set the RUNE_IOS_DEVELOPMENT_TEAM environment variable to your Apple Development Team ID.\n"
      );
    }
  }

  const buildResult = await runCommandFiltered("xcodebuild", buildArgs, {
    cwd: iosDir,
  });
  if (buildResult.code !== 0) {
    console.error("❌ iOS build failed.");
    process.exit(buildResult.code || 1);
  } else {
    console.log("✅ iOS build finished.");
  }

  const appBundlePath = path.join(
    buildDir,
    "Build",
    "Products",
    `${buildConfiguration}-${sdk}`,
    `${config.appNameCapitalized}.app`
  );
  if (!fs.existsSync(appBundlePath)) {
    console.error(
      `❌ Built app not found at ${appBundlePath}. Check xcodebuild output.`
    );
    process.exit(1);
  }

  if (isPhysicalDevice) {
    console.log(`📥 Installing build to ${targetDevice.name}...`);
    // `ios-deploy` is a common tool for this. Assumes it's installed.
    // You can install it with `npm install -g ios-deploy`
    runCommand("ios-deploy", [
      "--id",
      targetDevice.udid,
      "--bundle",
      appBundlePath,
      "--verbose",
    ]);
  } else {
    console.log("📥 Installing build to simulator...");
    runCommand("xcrun", [
      "simctl",
      "install",
      targetDevice.udid,
      appBundlePath,
      "--verbose",
    ]);
  }

  const desiredPort = Number(process.env.RUNE_HMR_PORT || 8081);
  const hmrServer = await startRuneHMRServer(appDir, "ios", {
    port: desiredPort,
    isPhysicalDevice: isPhysicalDevice,
    local: options.local,
    hmrNetwork: options.hmrNetwork,
  });

  if (!hmrServer) {
    console.error("❌ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  let devtoolsServer = null;
  if (devtoolsEnabled && !devtoolsUrlOverride) {
    devtoolsServer = await startRuneDevtoolsHub({
      host: "0.0.0.0",
      port: devtoolsPort,
    });
  }
  const devtoolsUrl = devtoolsEnabled
    ? buildDevtoolsUrl({
        deviceHost: hmrServer.deviceHost,
        port: devtoolsPort,
        override: devtoolsUrlOverride,
      })
    : null;

  const serverReady = await waitForDevServer(hmrServer.localUrl);
  if (!serverReady) {
    console.error(
      "❌ Rsbuild dev server did not respond within the expected time window."
    );
    process.exit(1);
  }

  if (isPhysicalDevice) {
    // On physical devices, we pass config via launch arguments.
    // No special environment setup is needed like with simctl.
    console.log("🚀 Launching application on device...");
    const launchArgs = [
      "--id",
      targetDevice.udid,
      "--bundle_id",
      config.bundleId,
      "--justlaunch",
      "--args",
      `--RUNE_DEV_SERVER_URL ${hmrServer.deviceUrl}`,
      "--verbose",
    ];
    const hmrToken = await waitForHMRToken(appDir);
    if (hmrToken) {
      launchArgs.push(`--RUNE_DEV_SERVER_TOKEN ${hmrToken}`);
    }
    if (devtoolsUrl) {
      launchArgs.push(`--RUNE_DEVTOOLS_URL ${devtoolsUrl}`);
      if (devtoolsToken) {
        launchArgs.push(`--RUNE_DEVTOOLS_TOKEN ${devtoolsToken}`);
      }
    }
    runCommand("ios-deploy", launchArgs);
  } else {
    // Simulator-specific logic
    const hmrToken = await waitForHMRToken(appDir);
    if (hmrToken) {
      console.log("🔐 Injecting HMR token into simulator environment");
      process.env.RUNE_DEV_SERVER_TOKEN = hmrToken;
      runCommand("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
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
      spawnSync("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
        "launchctl",
        "unsetenv",
        "RUNE_DEV_SERVER_TOKEN",
      ]);
    }

    runCommand("xcrun", [
      "simctl",
      "spawn",
      targetDevice.udid,
      "launchctl",
      "setenv",
      "RUNE_DEV_SERVER_URL",
      hmrServer.deviceUrl,
    ]);
    if (devtoolsUrl) {
      runCommand("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
        "launchctl",
        "setenv",
        "RUNE_DEVTOOLS_URL",
        devtoolsUrl,
      ]);
      if (devtoolsToken) {
        runCommand("xcrun", [
          "simctl",
          "spawn",
          targetDevice.udid,
          "launchctl",
          "setenv",
          "RUNE_DEVTOOLS_TOKEN",
          devtoolsToken,
        ]);
      }
    }

    console.log("🚀 Launching application on simulator...");
    runCommand("xcrun", [
      "simctl",
      "launch",
      targetDevice.udid,
      config.bundleId,
    ]);
  }

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
  if (devtoolsServer && devtoolsUrl) {
    console.log(`📡 Devtools URL: ${devtoolsUrl}`);
  }

  await new Promise(() => {});
}

async function devAndroid(root, appDir, options = {}) {
  const config = getAndroidConfig(root, appDir);
  const androidDir = path.join(appDir, "android");
  const userDeviceHost = process.env.RUNE_DEVICE_HOST;
  const { local, hmrNetwork } = options;
  const devtoolsEnabled = options.devtools !== false;
  const devtoolsPort = Number(
    process.env.RUNE_DEVTOOLS_PORT || options.devtoolsPort || 8091
  );
  const devtoolsUrlOverride = process.env.RUNE_DEVTOOLS_URL;
  const devtoolsToken = process.env.RUNE_DEVTOOLS_TOKEN || null;

  ensurePrebuild(root, appDir, "android", { dev: true });

  const devicesBeforeBuild = getConnectedAndroidDevices();
  if (!devicesBeforeBuild.length) {
    console.warn(
      "⚠️  No Android devices or emulators detected. Skipping install."
    );
    console.warn(
      "    Launch an emulator or connect a device, then rerun this command."
    );
    return;
  }

  const hasPhysicalDeviceInitial = devicesBeforeBuild.some(
    (id) => !id.startsWith("emulator-")
  );

  const desiredPort = Number(process.env.RUNE_HMR_PORT || 8081);
  const hmrServer = await startRuneHMRServer(appDir, "android", {
    port: desiredPort,
    deviceHostOverride:
      userDeviceHost || (hasPhysicalDeviceInitial ? "127.0.0.1" : undefined),
    isPhysicalDevice: hasPhysicalDeviceInitial,
    local: local,
    hmrNetwork: hmrNetwork,
  });

  if (!hmrServer) {
    console.error("❌ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  let devtoolsServer = null;
  if (devtoolsEnabled && !devtoolsUrlOverride) {
    devtoolsServer = await startRuneDevtoolsHub({
      host: "0.0.0.0",
      port: devtoolsPort,
    });
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
    console.log("🔐 Passing HMR token to Android runtime");
    process.env.RUNE_DEV_SERVER_TOKEN = hmrToken;
  } else {
    console.warn(
      "⚠️  HMR token not detected; continuing without authentication"
    );
    delete process.env.RUNE_DEV_SERVER_TOKEN;
  }

  const portForReverse = hmrServer?.port || desiredPort;
  let runtimeDeviceUrl = hmrServer.deviceUrl;
  let devtoolsDeviceUrl = devtoolsEnabled
    ? buildDevtoolsUrl({
        deviceHost: hmrServer.deviceHost,
        port: devtoolsPort,
        override: devtoolsUrlOverride,
      })
    : null;
  if (config.devServerUrl) {
    console.log(`⚠️  Using explicit dev server URL from app.json: ${config.devServerUrl}`);
    runtimeDeviceUrl = config.devServerUrl;
  } else if (!userDeviceHost && hasPhysicalDeviceInitial && portForReverse) {
    runtimeDeviceUrl = `http://127.0.0.1:${portForReverse}`;
  } else if (userDeviceHost) {
    runtimeDeviceUrl = `http://${userDeviceHost}:${portForReverse}`;
  }
  if (
    devtoolsEnabled &&
    !devtoolsUrlOverride &&
    !userDeviceHost &&
    hasPhysicalDeviceInitial
  ) {
    devtoolsDeviceUrl = buildDevtoolsUrl({
      deviceHost: "127.0.0.1",
      port: devtoolsPort,
    });
  } else if (devtoolsEnabled && !devtoolsUrlOverride && userDeviceHost) {
    devtoolsDeviceUrl = buildDevtoolsUrl({
      deviceHost: userDeviceHost,
      port: devtoolsPort,
    });
  }

  let runtimeConfig = {
    url: runtimeDeviceUrl,
    token: hmrToken || null,
    updatedAt: new Date().toISOString(),
    devtoolsUrl: devtoolsDeviceUrl,
    devtoolsToken: devtoolsToken,
  };
  let serializedConfig = `${JSON.stringify(runtimeConfig)}\n`;

  writeAndroidDevAsset(androidDir, serializedConfig.trim());

  console.log("🛠️  Assembling Android debug build...");
  runCommand("./gradlew", [":app:assembleDebug"], { cwd: androidDir });

  const devicesForInstall = getConnectedAndroidDevices();
  if (!devicesForInstall.length) {
    console.warn(
      "⚠️  No Android devices or emulators detected. Skipping install."
    );
    console.warn(
      "    Launch an emulator or connect a device, then rerun this command."
    );
    return;
  }

  console.log("📥 Installing Android build...");
  runCommand("./gradlew", [":app:installDebug"], { cwd: androidDir });

  const devices = getConnectedAndroidDevices();
  if (!devices.length) {
    console.warn(
      "⚠️  No Android devices or emulators detected. Skipping launch."
    );
    console.warn("    Install/launch manually once a device is available.");
    return;
  }

  const hasPhysicalDeviceConnected = devices.some(
    (id) => !id.startsWith("emulator-")
  );
  const shouldReverse =
    !!hmrServer &&
    portForReverse &&
    ((!userDeviceHost && hasPhysicalDeviceConnected) ||
      userDeviceHost === "127.0.0.1");
  const shouldReverseDevtools =
    devtoolsEnabled &&
    devtoolsDeviceUrl &&
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
  if (shouldReverseDevtools) {
    for (const deviceId of devices) {
      const result = spawnSync("adb", [
        "-s",
        deviceId,
        "reverse",
        `tcp:${devtoolsPort}`,
        `tcp:${devtoolsPort}`,
      ]);
      if (result.status !== 0) {
        console.warn(
          `⚠️  Failed to reverse devtools port ${devtoolsPort} for ${deviceId}`
        );
      }
    }
  }

  if (config.devServerUrl) {
    runtimeDeviceUrl = config.devServerUrl;
  } else if (shouldReverse) {
    runtimeDeviceUrl = `http://127.0.0.1:${portForReverse}`;
  } else if (userDeviceHost) {
    runtimeDeviceUrl = `http://${userDeviceHost}:${portForReverse}`;
  } else {
    runtimeDeviceUrl = hmrServer.deviceUrl;
  }

  runtimeConfig = {
    url: runtimeDeviceUrl,
    token: hmrToken || null,
    updatedAt: runtimeConfig.updatedAt,
    devtoolsUrl: devtoolsDeviceUrl,
    devtoolsToken: devtoolsToken,
  };
  serializedConfig = `${JSON.stringify(runtimeConfig)}\n`;

  for (const deviceId of devices) {
    writeDeviceDevConfig(deviceId, config.bundleId, serializedConfig);
  }

  // Force-stop the app so the next launch picks up fresh intent extras.
  for (const deviceId of devices) {
    runCommand("adb", [
      "-s",
      deviceId,
      "shell",
      "am",
      "force-stop",
      config.bundleId,
    ]);
  }

  const launchArgs = [
    "shell",
    "am",
    "start",
    "-S",
    "-n",
    `${config.bundleId}/.MainActivity`,
  ];
  if (runtimeDeviceUrl) {
    launchArgs.push("--es", "RUNE_DEV_SERVER_URL", runtimeDeviceUrl);
  }
  if (hmrToken) {
    launchArgs.push("--es", "RUNE_DEV_SERVER_TOKEN", hmrToken);
  }
  runCommand("adb", launchArgs);

  console.log(
    "🔥 Rune HMR server running. Leave this session open for hot reloading."
  );
  if (runtimeDeviceUrl && runtimeDeviceUrl !== hmrServer.deviceUrl) {
    console.log(`  ↳ Device URL: ${runtimeDeviceUrl}`);
  }
  if (devtoolsServer && devtoolsDeviceUrl) {
    console.log(`📡 Devtools URL: ${devtoolsDeviceUrl}`);
    await new Promise(() => {});
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
  getLocalIp,
  getAndroidConfig,
  startRuneHMRServer,
  listWorkspaces,
  bundle,
  resetIOS,
  resetAndroid,
};
