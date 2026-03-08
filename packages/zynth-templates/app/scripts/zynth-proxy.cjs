#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function findFrameworkRoot(appDir) {
  const envRoot = process.env.ZYNTH_FRAMEWORK_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }

  const packageJson = readJSON(path.join(appDir, "package.json"));
  const packageRoot =
    packageJson &&
    packageJson.zynth &&
    typeof packageJson.zynth.frameworkRoot === "string"
      ? packageJson.zynth.frameworkRoot
      : null;
  if (packageRoot) {
    return path.resolve(appDir, packageRoot);
  }

  return null;
}

function hasCliBinary(rootDir) {
  return fs.existsSync(path.join(rootDir, "packages", "zynth-cli", "bin", "zynth"));
}

const appDir = process.cwd();
const frameworkRoot = findFrameworkRoot(appDir);

if (!frameworkRoot || !hasCliBinary(frameworkRoot)) {
  console.error("✖ Could not resolve framework CLI path.");
  console.error("Set package.json:zynth.frameworkRoot or ZYNTH_FRAMEWORK_ROOT.");
  process.exit(1);
}

const cliPath = path.join(frameworkRoot, "packages", "zynth-cli", "bin", "zynth");
const args = process.argv.slice(2);
const hasAppFlag = args.includes("--app") || args.includes("-a");
if (!hasAppFlag) {
  args.push("--app", appDir);
}

const result = spawnSync("node", [cliPath, ...args], {
  cwd: frameworkRoot,
  stdio: "inherit",
});

if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(1);
