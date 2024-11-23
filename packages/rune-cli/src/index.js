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
      if (pkg.workspaces || pkg.name === "solid-native") {
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

function parseArgs(rawArgs) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const value = rawArgs[i];
    if (value === "--app") {
      if (i + 1 >= rawArgs.length) {
        throw new Error("--app flag requires a value");
      }
      flags.app = rawArgs[i + 1];
      i += 1;
      continue;
    }
    positional.push(value);
  }
  return { positional, flags };
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

function ensurePrebuild(root, appDir, platform) {
  const script = platform === "ios" ? "prebuild-ios.js" : "prebuild-android.js";
  const scriptPath = path.join(root, "scripts", script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Missing ${script} at ${scriptPath}`);
  }
  runNode(scriptPath, [], { cwd: appDir });
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

function devIOS(root, appDir) {
  const config = getIOSConfig(root, appDir);
  ensurePrebuild(root, appDir, "ios");
  const logProcess = startIOSLogs(config);
  ensureBundle(appDir);
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
  runCommand("xcrun", ["simctl", "launch", "booted", config.bundleId]);
  if (logProcess) {
    console.log("📖 iOS logs streaming. Press Ctrl+C to stop.");
    logProcess.on("exit", (code, signal) => {
      if (signal !== "SIGTERM") {
        console.log(`ℹ️  Log stream ended (${signal || code})`);
      }
    });
  }
}

function devAndroid(root, appDir) {
  const config = getAndroidConfig(root, appDir);
  ensureBundle(appDir);
  ensurePrebuild(root, appDir, "android");
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

  runCommand("./gradlew", [":app:installDebug"], { cwd: androidDir });
  runCommand("adb", [
    "shell",
    "am",
    "start",
    "-n",
    `${config.bundleId}/.MainActivity`,
  ]);
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

function printHelp() {
  const text = `Usage: rune <command> [options]\n\nCommands:\n  prebuild <ios|android>      Generate native project from templates\n  dev <ios|android>           Bundle JS and run native project\n  bundle <apps|packages|all>  Bundle workspaces\n  reset <ios|android>         Clean native build artifacts\n\nOptions:\n  --app <path>  Explicit app directory (defaults to current working directory)\n`;
  console.log(text);
}

function run(rawArgs) {
  if (!rawArgs.length) {
    printHelp();
    return;
  }
  let args;
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const [command, target] = args.positional;
  const cwd = process.cwd();
  const root = findWorkspaceRoot(cwd);

  if (["prebuild", "dev", "reset"].includes(command)) {
    const platform = target;
    if (!platform || !["ios", "android"].includes(platform)) {
      console.error(
        `Invalid or missing platform for ${command}. Expected ios or android.`
      );
      process.exit(1);
    }
    const appDir = args.flags.app
      ? path.resolve(cwd, args.flags.app)
      : findAppDirectory(cwd);
    if (!fs.existsSync(path.join(appDir, "package.json"))) {
      console.error(`Could not find package.json in app directory: ${appDir}`);
      process.exit(1);
    }
    switch (command) {
      case "prebuild":
        ensurePrebuild(root, appDir, platform);
        break;
      case "dev":
        if (platform === "ios") {
          devIOS(root, appDir);
        } else {
          devAndroid(root, appDir);
        }
        break;
      case "reset":
        if (platform === "ios") {
          resetIOS(appDir);
        } else {
          resetAndroid(appDir);
        }
        break;
      default:
        break;
    }
    return;
  }

  if (command === "bundle") {
    const scope = target || "all";
    if (!["apps", "packages", "all"].includes(scope)) {
      console.error("Bundle scope must be one of apps, packages, or all.");
      process.exit(1);
    }
    bundle(scope, root);
    return;
  }

  if (command === "help" || command === "--help") {
    printHelp();
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

module.exports = { run };
