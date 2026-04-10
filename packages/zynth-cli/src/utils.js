const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const net = require("net");
const { spawn, spawnSync } = require("child_process");
const readline = require("readline");

const BUILD_SHIMMER_START = Date.now();
const { createDevtoolsHub } = require("./devtools/hub");
const { IOS_BUILD_NOISE_PATTERNS } = require("./ios-build-filters");
const { ANDROID_BUILD_NOISE_PATTERNS } = require("./android-build-filters");

let devtoolsPublish = null;
let tsRuntimeRegistered = false;

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function gray(text) {
  return `\x1b[90m${text}\x1b[0m`;
}

function brightWhite(text) {
  return `\x1b[97m${text}\x1b[0m`;
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
        "Workspace root not found. Run this command inside a Zynth workspace."
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

function resolveInternalProjectScriptPath(scriptName) {
  const scriptsDir = path.join(__dirname, "project-scripts");
  const jsPath = path.join(scriptsDir, `${scriptName}.js`);
  const tsPath = path.join(scriptsDir, `${scriptName}.ts`);
  if (fs.existsSync(jsPath)) {
    return jsPath;
  }
  if (fs.existsSync(tsPath)) {
    return tsPath;
  }
  throw new Error(
    `Missing ${scriptName}.ts or ${scriptName}.js in CLI internal project-scripts`
  );
}

function registerTypeScriptRuntime() {
  if (tsRuntimeRegistered || require.extensions[".ts"]) {
    tsRuntimeRegistered = true;
    return;
  }
  let ts;
  try {
    ts = require("typescript");
  } catch (_error) {
    throw new Error(
      "typescript dependency is required to execute CLI internal TypeScript scripts."
    );
  }

  require.extensions[".ts"] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: filename,
      reportDiagnostics: false,
    }).outputText;
    module._compile(compiled, filename);
  };

  tsRuntimeRegistered = true;
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

function runCommandQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "ignore",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const code = result.status == null ? 1 : result.status;
    process.exit(code);
  }
}

function runCommandSilentUnlessError(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();
    if (stdout) process.stderr.write(`${stdout}\n`);
    if (stderr) process.stderr.write(`${stderr}\n`);
    const code = result.status == null ? 1 : result.status;
    process.exit(code);
  }
}

function runCommandFiltered(command, args, options = {}) {
  if (options.verbose) {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    return new Promise((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal });
      });
    });
  }
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...options,
  });

  const showProgress = options.showProgress !== false;
  const totalPackages = showProgress
    ? getZynthPackageCount(options.root || process.cwd(), "ios")
    : 0;
  const buildIndicator = createProgressIndicator(
    options.label || "Building native artifacts",
    totalPackages
  );
  buildIndicator.start();

  let resumeTimer = null;
  let lastOutputAt = 0;
  function writeBuildLine(stream, line, prefix = "  ! ") {
    buildIndicator.clearLine(stream);
    stream.write(`${prefix}${line}\n`);
    buildIndicator.renderOnce();
  }
  let lastDiagnosticAt = 0;
  let skippingDiagnostic = false;
  const noisePatterns = IOS_BUILD_NOISE_PATTERNS;
  const reportedPackages = new Set();

  function tryReportPackage(line) {
    if (!showProgress) return;
    const match = line.match(/packages[\\/](zynth-[^\\/]+)/);
    const name = match ? match[1] : null;
    if (!name || reportedPackages.has(name)) return;
    reportedPackages.add(name);
    const displayName = name.replace(/^zynth-/, "");
    buildIndicator.update(reportedPackages.size, displayName);
  }

  function shouldSkip(line) {
    return noisePatterns.some((pattern) => pattern.test(line));
  }

  function isDiagnostic(line) {
    return (
      /\berror:/i.test(line) ||
      /\bwarning:/i.test(line) ||
      /fatal error:/i.test(line) ||
      /Undefined symbols/i.test(line) ||
      /^ld:/i.test(line) ||
      /^clang:/i.test(line)
    );
  }

  function shouldPrint(line) {
    const isDiag = isDiagnostic(line);
    const skip = shouldSkip(line);

    if (isDiag) {
      skippingDiagnostic = skip;
      if (skip) return false;
      lastDiagnosticAt = Date.now();
      return true;
    }

    if (skippingDiagnostic) return false;

    const now = Date.now();
    if (now - lastDiagnosticAt < 1000) {
      if (/\bnote:/i.test(line) || /^\s+/.test(line)) {
        return true;
      }
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
        line.includes("packages/zynth-") &&
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

function runCommandFilteredAndroid(command, args, options = {}) {
  if (options.verbose) {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    return new Promise((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ code, signal });
      });
    });
  }
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    ...options,
  });

  const showProgress = options.showProgress !== false;
  const totalPackages = showProgress
    ? getZynthPackageCount(options.root || process.cwd(), "android")
    : 0;
  const buildIndicator = createProgressIndicator(
    options.label || "Building native artifacts",
    totalPackages
  );
  buildIndicator.start();

  let resumeTimer = null;
  const reportedPackages = new Set();

  function writeBuildLine(stream, line, prefix = "  ! ") {
    buildIndicator.clearLine(stream);
    stream.write(`${prefix}${line}\n`);
    buildIndicator.renderOnce();
  }

  function tryReportPackage(line) {
    if (!showProgress) return;
    // Gradle task pattern: > Task :PackageName:taskName
    const match = line.match(/> Task :([^:]+):/);
    const name = match ? match[1] : null;
    // Filter out generic app tasks or common non-package modules if needed
    if (!name || name === "app" || reportedPackages.has(name)) return;
    reportedPackages.add(name);
    const displayName = name.replace(/^Zynth/, "").toLowerCase();
    buildIndicator.update(reportedPackages.size, displayName);
  }

  let lastDiagnosticAt = 0;
  const noisePatterns = ANDROID_BUILD_NOISE_PATTERNS;

  function shouldSkip(line) {
    return noisePatterns.some((pattern) => pattern.test(line));
  }

  function isDiagnostic(line) {
    if (shouldSkip(line)) return false;
    return (
      /\bFAILURE\b/i.test(line) ||
      /\bBUILD FAILED\b/i.test(line) ||
      /\bERROR\b/i.test(line) ||
      /\bException\b/i.test(line) ||
      /^\s*w:/i.test(line) ||
      /^\s*e:/i.test(line) ||
      line.includes("* What went wrong:") ||
      line.includes("* Try:") ||
      (line.startsWith("> ") && !line.startsWith("> Task") && !line.startsWith("> @zynth/") && !line.startsWith("> node ")) ||
      /\berror:/i.test(line) ||
      /\bCaused by:/i.test(line) ||
      /\bCould not find\b/i.test(line) ||
      /\bUnknown property\b/i.test(line) ||
      line.includes("Unable to locate a Java Runtime") ||
      line.includes("The operation couldn’t be completed") ||
      line.includes("Command not found") ||
      line.includes("Permission denied")
    );
  }

  function handleData(data, stream) {
    const text = data.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;

      // Check for package tasks
      tryReportPackage(line);

      const isDiag = isDiagnostic(line);
      const now = Date.now();

      if (isDiag) {
        lastDiagnosticAt = now;
        writeBuildLine(stream, line);
      } else if (now - lastDiagnosticAt < 2000) {
        // Show context lines for 2 seconds after a diagnostic
        // but avoid showing too much noise (like task names or downloads)
        const isNoise = 
          shouldSkip(line) ||
          line.startsWith("> Task") || 
          line.startsWith("Searching for") ||
          line.startsWith("Download") ||
          line.startsWith("Get ") ||
          line.startsWith("Checking ");
          
        if (!isNoise) {
          writeBuildLine(stream, line, "    ");
        }
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

function resolvePackageJsonFromApp(depName, appDir) {
  try {
    return require.resolve(path.join(depName, "package.json"), {
      paths: [appDir],
    });
  } catch (_error) {
    // fall through to entry-resolution fallback
  }

  try {
    const entryPath = require.resolve(depName, { paths: [appDir] });
    let dir = path.dirname(entryPath);
    while (true) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (_error) {
    // Ignore resolution failures; dependency may be optional
  }

  let current = appDir;
  while (true) {
    const candidate = path.join(current, "node_modules", depName, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function getZynthRuntimeVersion(appDir) {
  const runtimePkgPath = resolvePackageJsonFromApp("@zynth/core", appDir);
  if (runtimePkgPath && fs.existsSync(runtimePkgPath)) {
    try {
      const pkg = readJSON(runtimePkgPath);
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch (_error) {
      // Fall through to local workspace fallback
    }
  }

  const localCorePkgPath = path.resolve(
    __dirname,
    "..",
    "..",
    "zynth-core",
    "package.json"
  );
  if (fs.existsSync(localCorePkgPath)) {
    try {
      const pkg = readJSON(localCorePkgPath);
      if (typeof pkg.version === "string" && pkg.version.trim()) {
        return pkg.version.trim();
      }
    } catch (_error) {
      // Ignore and return fallback
    }
  }

  return "0.0.0";
}

function printZynthDevStatus({ appDir, serverPort, devtoolsEnabled }) {
  const version = getZynthRuntimeVersion(appDir);
  const portText = Number.isFinite(Number(serverPort))
    ? String(serverPort)
    : "N/A";
  const devtoolsState = devtoolsEnabled ? "ACTIVE" : "INACTIVE";
  const devtoolsStateStyled = devtoolsEnabled
    ? brightWhite(devtoolsState)
    : gray(devtoolsState);
  const divider = "-".repeat(49);

  console.log(
    `${gray("// ")}${brightWhite("Z Y N T H Framework ")}\x1b[32mSTARTED\x1b[0m${gray(
      ` // v${version}`
    )}`
  );
  console.log(gray(divider));
  console.log(
    `${gray("[ SERVER : ")}${brightWhite(portText)}${gray(
      " ] | [ DEV_TOOLS : "
    )}${devtoolsStateStyled}${gray(" ]")}`
  );
}

function printZynthBuildStatus({ appDir, platform, outputPath, includeOutput = true }) {
  const version = getZynthRuntimeVersion(appDir);
  const divider = "-".repeat(49);
  const normalizedPlatform = String(platform || "unknown").toUpperCase();
  const resolvedOutput = outputPath || "N/A";

  console.log(
    `${gray("// ")}${brightWhite("Z Y N T H")}${gray(` /// v${version}`)}`
  );
  console.log(gray(divider));
  if (includeOutput) {
    console.log(
      `${gray("[ BUILD : ")}${brightWhite(
        `${normalizedPlatform} RELEASE`
      )}${gray(" ] >> [ OUTPUT : ")}${brightWhite(resolvedOutput)}${gray(" ]")}`
    );
    return;
  }

  console.log(
    `${gray("[ BUILD : ")}${brightWhite(`${normalizedPlatform} RELEASE`)}${gray(
      " ]"
    )}`
  );
}

function resolveAppDirectoryForCount(root) {
  const candidates = [];

  if (root) {
    candidates.push(path.resolve(root));
  }

  const appFlagIndex = process.argv.findIndex(
    (arg) => arg === "--app" || arg === "-a"
  );
  if (appFlagIndex !== -1) {
    const appArg = process.argv[appFlagIndex + 1];
    if (appArg) {
      candidates.push(path.resolve(appArg));
    }
  }

  if (process.env.ZYNTH_APP_DIR) {
    candidates.push(path.resolve(process.env.ZYNTH_APP_DIR));
  }

  candidates.push(process.cwd());

  for (const candidate of candidates) {
    if (!candidate) continue;

    const appJsonPath = path.join(candidate, "app.json");
    if (fs.existsSync(appJsonPath)) {
      return candidate;
    }

    try {
      return findAppDirectory(candidate);
    } catch (_error) {
      // try next candidate
    }
  }

  return null;
}

function getZynthPackageCount(root, platform) {
  try {
    const appDir = resolveAppDirectoryForCount(root);
    if (!appDir) return 0;

    const appPkgPath = path.join(appDir, "package.json");
    if (!fs.existsSync(appPkgPath)) return 0;

    const appPackage = readJSON(appPkgPath);
    const queue = [];
    const seen = new Set();
    const nativePackages = new Set();

    function enqueueDependencyNames(source) {
      if (!source || typeof source !== "object") return;
      for (const name of Object.keys(source)) {
        if (name.startsWith("@zynth/")) {
          queue.push(name);
        }
      }
    }

    enqueueDependencyNames(appPackage.dependencies);
    enqueueDependencyNames(appPackage.devDependencies);

    while (queue.length > 0) {
      const packageName = queue.shift();
      if (!packageName || seen.has(packageName)) continue;
      seen.add(packageName);

      const packageJsonPath = resolvePackageJsonFromApp(packageName, appDir);
      if (!packageJsonPath || !fs.existsSync(packageJsonPath)) continue;

      const packageJson = readJSON(packageJsonPath);
      if (packageJson?.zynthNative?.[platform]) {
        nativePackages.add(packageName);
      }

      enqueueDependencyNames(packageJson.dependencies);
    }

    return nativePackages.size;
  } catch (_error) {
    // Ignore and keep indicator non-blocking
  }
  return 0;
}

function createProgressIndicator(label, total) {

  const text = String(label);

  let timer = null;

  let currentCount = 0;

  let currentItem = "";

  let lastLineCount = 0;

  let startTime = Date.now();



  function render() {

    if (!process.stdout.isTTY) return;



    const width = text.length;

    const padding = 10;

    const period = width + padding * 2;

    const sweepSeconds = 2.0;

    const elapsedSeconds = (Date.now() - startTime) / 1000;

    const pos = ((elapsedSeconds % sweepSeconds) / sweepSeconds) * period;

    const bandHalfWidth = 5.0;

    const hasTrueColor = supportsTrueColor();

    const base = { r: 0, g: 180, b: 0 }; // Fallout Green Base

    const highlight = { r: 50, g: 255, b: 50 }; // Bright Fallout Green



    let shimmer = "";

    for (let i = 0; i < width; i += 1) {

      const iPos = i + padding;

      const dist = Math.abs(iPos - pos);

      const t =

        dist <= bandHalfWidth

          ? 0.5 * (1 + Math.cos(Math.PI * (dist / bandHalfWidth)))

          : 0;

      if (hasTrueColor) {

        const color = mixColor(base, highlight, t * 0.9);

        shimmer += colorize(text[i], color, true);

      } else if (t < 0.2) {

        shimmer += dim(text[i]);

      } else if (t < 0.6) {

        shimmer += text[i];

      } else {

        shimmer += bold(text[i]);

      }

    }



    const lines = [`\x1b[32m◆\x1b[0m ${shimmer}`];



    if (total > 0) {

      // Progress bar

      const barWidth = 30;

      const percent = Math.min(currentCount / total, 1);

      const filledCount = Math.floor(percent * barWidth);

      const greenCode = "\x1b[32m";

      const resetCode = "\x1b[0m";

      const bar = `${greenCode}[${"▓".repeat(filledCount)}${resetCode}${"░".repeat(

        barWidth - filledCount

      )}${greenCode}]${resetCode} ${Math.round(percent * 100)}%`;



      lines.push(`  ${bar}`);



      if (currentItem) {

        lines.push(`  ↳ Compiling: ${dim(currentItem)}`);

      }



      lines.push(`  ➔ ${currentCount}/${total} components built...`);

    }



    // Clear previous lines

    for (let i = 0; i < lastLineCount; i++) {

      readline.moveCursor(process.stdout, 0, -1);

      readline.clearLine(process.stdout, 0);

    }



    // Write new lines

    process.stdout.write(lines.join("\n") + "\n");

    lastLineCount = lines.length;

  }



  function clearLine(stream = process.stdout) {

    if (!stream.isTTY) return;

    for (let i = 0; i < lastLineCount; i++) {

      readline.moveCursor(stream, 0, -1);

      readline.clearLine(stream, 0);

    }

    lastLineCount = 0;

  }



  return {

    start() {

      startTime = Date.now();

      if (!process.stdout.isTTY) {

        process.stdout.write(`${text}\n`);

        return;

      }

      if (timer) return;

      process.stdout.write("\u001b[?25l"); // Hide cursor

      render();

      timer = setInterval(render, 80);

    },

    update(count, item) {

      currentCount = count;

      currentItem = item;

      if (!timer) render();

    },

    renderOnce() {

      if (!process.stdout.isTTY) return;

      render();

    },

        stop(silent = false) {

          if (timer) {

            clearInterval(timer);

            timer = null;

          }

          clearLine();

          process.stdout.write("\u001b[?25h"); // Show cursor

    

          if (silent) return;

    

          const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    

          if (total > 0) {

            // Final summary for progress-based tasks

            process.stdout.write("\x1b[32m◆\x1b[0m " + text + "\n");

            process.stdout.write(

              `\x1b[32m✔\x1b[0m Completed ${currentCount} modules in ${duration}s\n`

            );

          } else {

            // Simple success for non-progress tasks (like install)

            process.stdout.write(`\x1b[32m✔\x1b[0m ${text} finished in ${duration}s\n`);

          }

        },

    

    clearLine,

  };

}

function createBuildIndicator(label) {
  // Legacy shim
  return createProgressIndicator(label, 0);
}

function mixColor(a, b, t) {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function supportsTrueColor() {
  const depth =
    typeof process.stdout?.getColorDepth === "function"
      ? process.stdout.getColorDepth()
      : 0;
  if (depth >= 24) return true;
  const colorterm = process.env.COLORTERM || "";
  return colorterm.toLowerCase().includes("truecolor");
}

function ansiWrap(text, open, close = "\x1b[0m") {
  return `${open}${text}${close}`;
}

function bold(text) {
  return ansiWrap(text, "\x1b[1m");
}

function dim(text) {
  return ansiWrap(text, "\x1b[2m");
}

function colorize(text, color, makeBold) {
  const code = `\x1b[38;2;${color.r};${color.g};${color.b}m`;
  if (makeBold) {
    return ansiWrap(text, `\x1b[1m${code}`);
  }
  return ansiWrap(text, code);
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
    ["-s", deviceId, "shell", "run-as", bundleId, "mkdir", "-p", "files/.zynth"],
    { encoding: "utf8" }
  );

  if (ensureDir.status !== 0) {
    const output = ensureDir.stderr || ensureDir.stdout || "unknown error";
    // Ignore benign "File exists" errors
    if (!/File exists/i.test(output || "")) {
      // Suppress mkdir errors as they often just mean the app isn't installed/debuggable yet
      // which is fine as this is a best-effort pre-launch config
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
      "/system/bin/cat > files/.zynth/dev-server.json",
    ],
    {
      input: jsonPayload,
      encoding: "utf8",
    }
  );

  if (result.status !== 0) {
    const output = result.stderr || result.stdout || "unknown error";
    // Filter out "No such file or directory" which happens on fresh installs
    if (!/No such file or directory/i.test(output)) {
      console.warn(
        `  ! Failed to write dev config to ${deviceId}: ${output.trim()}`
      );
    }
  }
}

function writeAndroidDevAsset(androidDir, payload) {
  const assetDir = path.join(androidDir, "app", "src", "main", "assets");
  const assetPath = path.join(assetDir, "zynth-dev-config.json");

  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(assetPath, `${payload}\n`, "utf8");
}

function getIOSConfig(root, appDir) {
  const scriptPath = resolveInternalProjectScriptPath("config-utils");
  try {
    const script = requireScript(scriptPath);
    return script.getAppConfig(appDir);
  } catch (e) {
    console.warn("! Failed to load config-utils script:", e.message);
    throw new Error(
      "Could not load app config. Missing CLI internal project-scripts/config-utils"
    );
  }
}

function getAndroidConfig(root, appDir) {
  const base = getIOSConfig(root, appDir);
  const fallback = `com.zynth.${base.appDir.replace(/-/g, "")}`;
  const pkgName = (base.bundleId || fallback).toLowerCase();
  return { ...base, bundleId: pkgName };
}

async function ensureBootstrap(root, appDir, platform, options = {}) {
  const scriptName = platform === "ios" ? "bootstrap-ios" : "bootstrap-android";
  const scriptPath = resolveInternalProjectScriptPath(scriptName);

  // Load and call the bootstrap script with options
  const bootstrapModule = requireScript(scriptPath);
  const originalCwd = process.cwd();
  try {
    process.chdir(appDir);
    await bootstrapModule.main(options);
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
    console.warn("! Failed to parse simctl output:", error.message);
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

function readZynthArtifacts(appDir) {
  const artifactPath = path.join(appDir, ".zynth", "artifacts.json");
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(artifactPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    console.warn(`! Failed to read ${artifactPath}:`, error.message);
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
    const artifacts = readZynthArtifacts(appDir);
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
    console.warn("  ! adb not available or failed to run. Ensure Android platform tools are installed and adb is on PATH.");
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
        `process == "${config.appNameCapitalized}" AND (eventMessage BEGINSWITH "[Zynth]" OR eventMessage CONTAINS "JS[error]" OR eventMessage CONTAINS "JS[log]")`,
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
    console.warn("  ! Failed to start iOS logs:", error.message);
    return null;
  }
}

function startAndroidLogs(config, deviceId) {
  try {
    // Clear logs first to avoid replay of old history
    const clearArgs = ["logcat", "-c"];
    if (deviceId) {
      clearArgs.unshift("-s", deviceId);
    }
    spawnSync("adb", clearArgs);

    const args = [
      "logcat",
      "-v",
      "time",
      "-s",
      "Zynth:V",
      "ZynthNative:V",
      "ReactNative:V",
      "ReactNativeJS:V",
      "Hermes:V",
      "ZynthDevtoolsClient:V",
    ];
    if (deviceId) {
      args.unshift("-s", deviceId);
    }

    const child = spawn("adb", args, { stdio: ["ignore", "pipe", "pipe"] });

    const handleLine = (line) => {
      if (!line.trim()) return;
      // Android log format: MM-DD HH:MM:SS.mmm V/Tag(PID): Message
      // We want to clean this up

      // Strip timestamp and metadata if possible for cleaner output
      // specific regex for "time" format: 01-10 12:34:56.789 V/Tag( 123): msg
      const cleanLine = line.replace(
        /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+[A-Z]\/[^(]+\(\s*\d+\):\s+/,
        ""
      );

      if (typeof devtoolsPublish === "function") {
        devtoolsPublish({
          topic: "log/android",
          level: "info",
          tag: "android",
          data: cleanLine,
        });
        return;
      }
      process.stdout.write(`${cleanLine}\n`);
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
    console.warn("  ! Failed to start Android logs:", error.message);
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

async function startZynthDevtoolsHub({ host, port }) {
  const env = process.env.ZYNTH_DEVTOOLS_DEBUG || "";
  const hideDebug = !(env === "1" || env === "true");
  const hub = createDevtoolsHub({
    host,
    port,
    print: true,
    json: false,
    filters: { hideDebug },
  });
  const server = await hub.start();
  devtoolsPublish = hub.publish;
  return server;
}

function buildDevtoolsUrl({ deviceHost, port, override }) {
  if (override) return override;
  if (!deviceHost || !port) return null;
  return `ws://${deviceHost}:${port}`;
}

async function startZynthHMRServer(appDir, platform, options = {}) {
  const defaultPort = 7070;
  const requestedPort = Number(
    process.env.ZYNTH_HMR_PORT || options.port || defaultPort
  );
  const localHost = process.env.ZYNTH_HMR_HOST || "localhost";
  const bindHost =
    process.env.ZYNTH_HMR_BIND ||
    (localHost === "localhost" ? "0.0.0.0" : localHost);
  const port = await findAvailablePort(requestedPort, bindHost);
  if (!options.quietLogs && port !== requestedPort) {
    console.log(
      `  ! Port ${requestedPort} is in use, switched HMR server to ${port}.`
    );
  }
  const defaultSimulatorHost =
    platform === "android" ? "10.0.2.2" : "127.0.0.1";
  const defaultPhysicalHost = getLocalIp();
  const defaultDeviceHost = options.isPhysicalDevice
    ? defaultPhysicalHost
    : defaultSimulatorHost;
  const deviceHostOverride = options.deviceHostOverride;
  let deviceHost =
    deviceHostOverride || process.env.ZYNTH_DEVICE_HOST || defaultDeviceHost;

  if (options.local) {
    deviceHost = "127.0.0.1";
  } else if (options.hmrNetwork) {
    deviceHost = getLocalIp();
  }
  const args = ["rsbuild", "dev", "--port", String(port), "--host", bindHost];

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(command, args, {
    cwd: appDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ZYNTH_PLATFORM: platform,
      ZYNTH_HMR_PORT: String(port),
      BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: "true",
      BROWSERSLIST_IGNORE_OLD_DATA: "true",
      FORCE_COLOR: "1",
    },
  });

  const { createHMRFilter } = require("./hmr-filter");
  const buildIndicator = createProgressIndicator("Bundling JavaScript", 0);
  const filter = createHMRFilter(buildIndicator);

  buildIndicator.start();

  child.stdout.on("data", filter);
  child.stderr.on("data", filter);

  child.on("error", (error) => {
    buildIndicator.stop();
    console.error("  ! Failed to launch Rsbuild dev server:", error.message);
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

  return {
    process: child,
    port,
    localUrl,
    deviceUrl,
    deviceHost,
  };
}

function isPortAvailable(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(startPort, host = "0.0.0.0", maxTries = 100) {
  let candidate = Number(startPort);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    candidate = 7070;
  }
  for (let i = 0; i < maxTries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortAvailable(candidate, host);
    if (free) {
      return candidate;
    }
    candidate += 1;
  }
  throw new Error(
    `Unable to find a free port starting from ${startPort} (checked ${maxTries} ports).`
  );
}

async function devIOS(root, appDir, options = {}) {
  const config = getIOSConfig(root, appDir);
  const iosDir = path.join(appDir, "ios");
  let targetDevice = null;
  const quietOutput = Boolean(options.quietOutput ?? options.bootstrap);
  const devtoolsEnabled = options.devtools !== false;
  const devtoolsPort = Number(
    process.env.ZYNTH_DEVTOOLS_PORT || options.devtoolsPort || 7080
  );
  const devtoolsUrlOverride = process.env.ZYNTH_DEVTOOLS_URL;
  const devtoolsToken = process.env.ZYNTH_DEVTOOLS_TOKEN;
  const verboseBuild = Boolean(options.verbose);

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
        "❌ No booted iOS simulator detected. Launch a simulator or use `zynth dev ios --devices` to select a target."
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

  if (options.bootstrap) {
    if (!quietOutput) {
      console.log("◆ Regenerating iOS project (--bootstrap)");
    }
    removeDirectory(iosDir);
    await ensureBootstrap(root, appDir, "ios", {
      dev: true,
      quiet: quietOutput,
    });
  }

  if (!fs.existsSync(iosDir)) {
    console.error(
      "✖ iOS project not found. Run `zynth bootstrap ios` or pass --bootstrap."
    );
    process.exit(1);
  }

  const workspacePath = path.join(
    iosDir,
    `${config.appNameCapitalized}.xcworkspace`
  );
  if (!fs.existsSync(workspacePath)) {
    console.error(
      `❌ Missing workspace at ${workspacePath}. Regenerate with --bootstrap.`
    );
    process.exit(1);
  }

  const isPhysicalDevice = targetDevice.type === "device";
  const sdk = isPhysicalDevice ? "iphoneos" : "iphonesimulator";
  const buildConfiguration = "Debug";
  const buildDir = path.join(iosDir, ".build");

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
    const devTeam = process.env.ZYNTH_IOS_DEVELOPMENT_TEAM;
    if (devTeam) {
      buildArgs.push(`DEVELOPMENT_TEAM=${devTeam}`);
    } else {
      console.warn(
        "\n! Building for a physical device. If the build fails due to code signing, set the ZYNTH_IOS_DEVELOPMENT_TEAM environment variable to your Apple Development Team ID.\n"
      );
    }
  }

  console.log(`◆ Building ${config.appNameCapitalized} (${sdk})...`);
  const buildResult = await runCommandFiltered("xcodebuild", buildArgs, {
    cwd: iosDir,
    verbose: verboseBuild,
  });
  if (buildResult.code !== 0) {
    console.error("✖ iOS build failed.");
    process.exit(buildResult.code || 1);
  } else {
    console.log("\x1b[32m✔\x1b[0m iOS build finished.");
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
      `✖ Built app not found at ${appBundlePath}. Check xcodebuild output.`
    );
    process.exit(1);
  }

  if (isPhysicalDevice) {
    // `ios-deploy` is a common tool for this. Assumes it's installed.
    // You can install it with `npm install -g ios-deploy`
    await runCommandFiltered(
      "ios-deploy",
      ["--id", targetDevice.udid, "--bundle", appBundlePath, "--verbose"],
      {
        cwd: iosDir,
        label: "Installing build to device",
        showProgress: false,
      }
    );
  } else {
    await runCommandFiltered(
      "xcrun",
      ["simctl", "install", targetDevice.udid, appBundlePath, "--verbose"],
      {
        cwd: iosDir,
        label: "Installing build to simulator",
        showProgress: false,
      }
    );
  }

  const desiredPort = Number(process.env.ZYNTH_HMR_PORT || 7070);
  const hmrServer = await startZynthHMRServer(appDir, "ios", {
    port: desiredPort,
    isPhysicalDevice: isPhysicalDevice,
    local: options.local,
    hmrNetwork: options.hmrNetwork,
    quietLogs: quietOutput,
  });

  if (!hmrServer) {
    console.error("✖ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  if (devtoolsEnabled && !devtoolsUrlOverride) {
    await startZynthDevtoolsHub({
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
      "✖ Rsbuild dev server did not respond within the expected time window."
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
      `--ZYNTH_DEV_SERVER_URL ${hmrServer.deviceUrl}`,
      "--verbose",
    ];
    const hmrToken = await waitForHMRToken(appDir);
    if (hmrToken) {
      launchArgs.push(`--ZYNTH_DEV_SERVER_TOKEN ${hmrToken}`);
    }
    if (devtoolsUrl) {
      launchArgs.push(`--ZYNTH_DEVTOOLS_URL ${devtoolsUrl}`);
      if (devtoolsToken) {
        launchArgs.push(`--ZYNTH_DEVTOOLS_TOKEN ${devtoolsToken}`);
      }
    }
    runCommand("ios-deploy", launchArgs);
  } else {
    // Simulator-specific logic
    const hmrToken = await waitForHMRToken(appDir);
    if (hmrToken) {
      if (!quietOutput) {
        console.log("◆ Injecting HMR token into simulator environment");
      }
      process.env.ZYNTH_DEV_SERVER_TOKEN = hmrToken;
      runCommand("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
        "launchctl",
        "setenv",
        "ZYNTH_DEV_SERVER_TOKEN",
        hmrToken,
      ]);
    } else {
      console.warn(
        "! HMR token not detected; continuing without authentication"
      );
      delete process.env.ZYNTH_DEV_SERVER_TOKEN;
      spawnSync("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
        "launchctl",
        "unsetenv",
        "ZYNTH_DEV_SERVER_TOKEN",
      ]);
    }

    runCommand("xcrun", [
      "simctl",
      "spawn",
      targetDevice.udid,
      "launchctl",
      "setenv",
      "ZYNTH_DEV_SERVER_URL",
      hmrServer.deviceUrl,
    ]);
    runCommand("xcrun", [
      "simctl",
      "spawn",
      targetDevice.udid,
      "launchctl",
      "setenv",
      "OS_ACTIVITY_MODE",
      "disable",
    ]);
    if (devtoolsUrl) {
      runCommand("xcrun", [
        "simctl",
        "spawn",
        targetDevice.udid,
        "launchctl",
        "setenv",
        "ZYNTH_DEVTOOLS_URL",
        devtoolsUrl,
      ]);
      if (devtoolsToken) {
        runCommand("xcrun", [
          "simctl",
          "spawn",
          targetDevice.udid,
          "launchctl",
          "setenv",
          "ZYNTH_DEVTOOLS_TOKEN",
          devtoolsToken,
        ]);
      }
    }

    if (!quietOutput) {
      console.log("◆ Launching application on simulator...");
      runCommand("xcrun", [
        "simctl",
        "launch",
        targetDevice.udid,
        config.bundleId,
      ]);
    } else {
      runCommandQuiet("xcrun", [
        "simctl",
        "launch",
        targetDevice.udid,
        config.bundleId,
      ]);
    }
  }

  if (hmrServer) {
    printZynthDevStatus({
      appDir,
      serverPort: hmrServer.port,
      devtoolsEnabled: devtoolsEnabled,
    });
  }

  await new Promise(() => {});
}

async function devAndroid(root, appDir, options = {}) {
  const config = getAndroidConfig(root, appDir);
  const androidDir = path.join(appDir, "android");
  const userDeviceHost = process.env.ZYNTH_DEVICE_HOST;
  const { local, hmrNetwork } = options;
  const devtoolsEnabled = options.devtools !== false;
  const devtoolsPort = Number(
    process.env.ZYNTH_DEVTOOLS_PORT || options.devtoolsPort || 7080
  );
  const devtoolsUrlOverride = process.env.ZYNTH_DEVTOOLS_URL;
  const devtoolsToken = process.env.ZYNTH_DEVTOOLS_TOKEN || null;
  const quietOutput = Boolean(options.quietOutput ?? options.bootstrap);
  const verboseBuild = Boolean(options.verbose);

  if (options.bootstrap) {
    await ensureBootstrap(root, appDir, "android", {
      dev: true,
      quiet: quietOutput,
    });
  } else if (!fs.existsSync(androidDir)) {
    // If android dir is missing, we must bootstrap regardless of flag
    console.log("◆ Android directory missing. Running bootstrap...");
    await ensureBootstrap(root, appDir, "android", {
      dev: true,
      quiet: quietOutput,
    });
  }

  const devicesBeforeBuild = getConnectedAndroidDevices();
  if (!devicesBeforeBuild.length) {
    console.warn(
      "  ! No Android devices or emulators detected. Skipping install."
    );
    console.warn(
      "    Launch an emulator or connect a device, then rerun this command."
    );
    return;
  }

  const hasPhysicalDeviceInitial = devicesBeforeBuild.some(
    (id) => !id.startsWith("emulator-")
  );
  const preferLanForEmulator = !hasPhysicalDeviceInitial && !userDeviceHost;
  const lanHost = preferLanForEmulator ? getLocalIp() : null;

  console.log(`◆ Building ${config.appNameCapitalized} (debug)...`);
  const assembleResult = await runCommandFilteredAndroid(
    "./gradlew",
    [":app:assembleDebug"],
    { cwd: androidDir, verbose: verboseBuild }
  );
  if (assembleResult.code !== 0) {
    console.error("✖ Android build failed.");
    process.exit(assembleResult.code || 1);
  } else {
    console.log("\x1b[32m✔\x1b[0m Android build finished.");
  }

  const devicesForInstall = getConnectedAndroidDevices();
  if (!devicesForInstall.length) {
    console.warn(
      "  ! No Android devices or emulators detected. Skipping install."
    );
    console.warn(
      "    Launch an emulator or connect a device, then rerun this command."
    );
    return;
  }

  const installResult = await runCommandFilteredAndroid(
    "./gradlew",
    [":app:installDebug", "-q"],
    {
      cwd: androidDir,
      verbose: verboseBuild,
      label: "Installing build to device",
      showProgress: false,
    }
  );
  if (installResult.code !== 0) {
    console.error("✖ Android install failed.");
    process.exit(installResult.code || 1);
  }

  let hmrServer = null;
  let hmrToken = null;
  let runtimeDeviceUrl = null;
  let devtoolsDeviceUrl = null;
  let runtimeConfig = null;
  let serializedConfig = "";
  let portForReverse = null;

  const desiredPort = Number(process.env.ZYNTH_HMR_PORT || 7070);
  hmrServer = await startZynthHMRServer(appDir, "android", {
    port: desiredPort,
    deviceHostOverride:
      userDeviceHost ||
      (hasPhysicalDeviceInitial ? "127.0.0.1" : lanHost || undefined),
    isPhysicalDevice: hasPhysicalDeviceInitial,
    local: local,
    hmrNetwork: hmrNetwork,
    quietLogs: quietOutput,
  });

  if (!hmrServer) {
    console.error("✖ Failed to start Rsbuild dev server. Aborting.");
    process.exit(1);
  }

  if (devtoolsEnabled && !devtoolsUrlOverride) {
    await startZynthDevtoolsHub({
      host: "0.0.0.0",
      port: devtoolsPort,
    });
  }

  const serverReady = await waitForDevServer(hmrServer.localUrl);
  if (!serverReady) {
    console.error(
      "✖ Rsbuild dev server did not respond within the expected time window."
    );
    process.exit(1);
  }

  hmrToken = await waitForHMRToken(appDir);
  if (hmrToken) {
    process.env.ZYNTH_DEV_SERVER_TOKEN = hmrToken;
  } else {
    delete process.env.ZYNTH_DEV_SERVER_TOKEN;
  }

  portForReverse = hmrServer?.port || desiredPort;
  runtimeDeviceUrl = hmrServer.deviceUrl;
  devtoolsDeviceUrl = devtoolsEnabled
    ? buildDevtoolsUrl({
        deviceHost: lanHost || hmrServer.deviceHost,
        port: devtoolsPort,
        override: devtoolsUrlOverride,
      })
    : null;
  if (config.devServerUrl) {
    runtimeDeviceUrl = config.devServerUrl;
  } else if (!userDeviceHost && hasPhysicalDeviceInitial && portForReverse) {
    runtimeDeviceUrl = `http://127.0.0.1:${portForReverse}`;
  } else if (lanHost) {
    runtimeDeviceUrl = `http://${lanHost}:${portForReverse}`;
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
  } else if (devtoolsEnabled && !devtoolsUrlOverride && lanHost) {
    devtoolsDeviceUrl = buildDevtoolsUrl({
      deviceHost: lanHost,
      port: devtoolsPort,
    });
  } else if (devtoolsEnabled && !devtoolsUrlOverride && userDeviceHost) {
    devtoolsDeviceUrl = buildDevtoolsUrl({
      deviceHost: userDeviceHost,
      port: devtoolsPort,
    });
  }

  runtimeConfig = {
    url: runtimeDeviceUrl,
    token: hmrToken || null,
    updatedAt: new Date().toISOString(),
    devtoolsUrl: devtoolsDeviceUrl,
    devtoolsToken: devtoolsToken,
  };
  serializedConfig = `${JSON.stringify(runtimeConfig)}\n`;

  writeAndroidDevAsset(androidDir, serializedConfig.trim());

  const devices = getConnectedAndroidDevices();
  if (!devices.length) {
    console.warn(
      "  ! No Android devices or emulators detected. Skipping launch."
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
          `  ! Failed to reverse port ${portForReverse} for ${deviceId}`
        );
      }
    }
  } else if (hasPhysicalDeviceConnected && !userDeviceHost) {
    console.warn(
      "  ! Physical device detected. Use USB (adb reverse) or set ZYNTH_DEVICE_HOST to your LAN IP."
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
          `  ! Failed to reverse devtools port ${devtoolsPort} for ${deviceId}`
        );
      }
    }
  }

  if (config.devServerUrl) {
    runtimeDeviceUrl = config.devServerUrl;
  } else if (shouldReverse) {
    runtimeDeviceUrl = `http://127.0.0.1:${portForReverse}`;
  } else if (lanHost) {
    runtimeDeviceUrl = `http://${lanHost}:${portForReverse}`;
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
    launchArgs.push("--es", "ZYNTH_DEV_SERVER_URL", runtimeDeviceUrl);
  }
  if (hmrToken) {
    launchArgs.push("--es", "ZYNTH_DEV_SERVER_TOKEN", hmrToken);
  }
  if (devtoolsDeviceUrl) {
    launchArgs.push("--es", "ZYNTH_DEVTOOLS_URL", devtoolsDeviceUrl);
    if (devtoolsToken) {
      launchArgs.push("--es", "ZYNTH_DEVTOOLS_TOKEN", devtoolsToken);
    }
  }

  runCommandSilentUnlessError("adb", launchArgs);

  printZynthDevStatus({
    appDir,
    serverPort: hmrServer?.port || desiredPort,
    devtoolsEnabled: devtoolsEnabled,
  });

  if (devtoolsEnabled) {
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
      console.log(`! Skipping ${workspace.name}; no build script defined.`);
      return;
    }
    console.log(`◆ Bundling ${workspace.name}...`);
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
      .filter((workspace) => workspace.name !== "zynth")
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
    "🧹 Removed iOS build artifacts. Run `zynth bootstrap ios` to regenerate."
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
    "🧹 Removed Android build artifacts. Run `zynth bootstrap android` to regenerate."
  );
}

function requireScript(scriptPath) {
  if (scriptPath.endsWith(".ts")) {
    registerTypeScriptRuntime();
  }
  return require(scriptPath);
}

module.exports = {
  readJSON,
  findWorkspaceRoot,
  findAppDirectory,
  runCommand,
  runNode,
  readCommandOutput,
  runCommandFiltered,
  runCommandFilteredAndroid,
  devIOS,
  devAndroid,
  ensureBootstrap,
  ensureBundle,
  getConnectedAndroidDevices,
  startIOSLogs,
  startAndroidLogs,
  getIOSConfig,
  getLocalIp,
  getAndroidConfig,
  startZynthHMRServer,
  getZynthRuntimeVersion,
  printZynthDevStatus,
  printZynthBuildStatus,
  listWorkspaces,
  bundle,
  resetIOS,
  resetAndroid,
  requireScript,
  resolveInternalProjectScriptPath,
};
