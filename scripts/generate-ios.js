#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Configuration - parse app info from app.json (Rune-style) and package.json
function getAppConfig(appDir) {
  const pkgPath = path.join(appDir, "package.json");
  const appJsonPath = path.join(appDir, "app.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const appName = path.basename(appDir);

  // Try to read app.json (Rune-style config)
  let appConfig = {};
  if (fs.existsSync(appJsonPath)) {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    appConfig = appJson.rune || appJson;
  }

  // Clean app name for Xcode (no spaces, special chars)
  const cleanAppName = (appConfig.name || appName).replace(/[^a-zA-Z0-9]/g, "");

  return {
    appName: cleanAppName,
    appNameCapitalized:
      cleanAppName.charAt(0).toUpperCase() + cleanAppName.slice(1),
    appDir: appName,
    bundleId:
      appConfig.ios?.bundleIdentifier ||
      pkg.bundleId ||
      `com.rune.${appName.replace(/-/g, "")}`,
    workspaceName: pkg.name || `@demo/${appName}`,
    displayName: appConfig.name || pkg.displayName || appName,
    version: appConfig.version || pkg.version || "1.0.0",
  };
}

function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

function collectNativeIOSPods(appDir) {
  const podsByName = new Map();
  const appPackage = safeReadJSON(path.join(appDir, "package.json")) || {};

  function registerPods(packageName, packageDir, iosConfig) {
    if (!iosConfig || !Array.isArray(iosConfig.pods)) return;
    for (const pod of iosConfig.pods) {
      if (!pod || !pod.name) continue;
      const record = {
        name: pod.name,
        packageName,
        podspecPath: pod.podspec
          ? path.resolve(packageDir, pod.podspec)
          : null,
        directoryPath: pod.path
          ? path.resolve(packageDir, pod.path)
          : packageDir,
      };
      podsByName.set(record.name, record);
    }
  }

  if (appPackage.runeNative && appPackage.runeNative.ios) {
    registerPods(appPackage.name || "(app)", appDir, appPackage.runeNative.ios);
  }

  const dependencySources = [
    appPackage.dependencies || {},
    appPackage.devDependencies || {},
  ];

  for (const source of dependencySources) {
    for (const depName of Object.keys(source)) {
      try {
        const pkgJsonPath = require.resolve(
          path.join(depName, "package.json"),
          { paths: [appDir] }
        );
        const packageDir = path.dirname(pkgJsonPath);
        const depPackage = safeReadJSON(pkgJsonPath);
        if (!depPackage) continue;
        if (depPackage.runeNative && depPackage.runeNative.ios) {
          registerPods(depName, packageDir, depPackage.runeNative.ios);
        }
      } catch (_error) {
        // Ignore resolvable failures; dependency may be optional for native
      }
    }
  }

  return Array.from(podsByName.values());
}

function formatComponentPodLines(pods, targetDir) {
  if (!pods.length) {
    return "\n  # No additional Rune component pods detected";
  }

  const lines = [];
  for (const pod of pods) {
    if (pod.directoryPath && fs.existsSync(pod.directoryPath)) {
      const relative = path
        .relative(targetDir, pod.directoryPath)
        .split(path.sep)
        .join("/");
      lines.push(
        `  pod '${pod.name}', :path => File.expand_path('${relative}', __dir__)`
      );
      continue;
    }
    if (pod.podspecPath && fs.existsSync(pod.podspecPath)) {
      const relative = path
        .relative(targetDir, pod.podspecPath)
        .split(path.sep)
        .join("/");
      lines.push(
        `  pod '${pod.name}', :podspec => File.expand_path('${relative}', __dir__)`
      );
      continue;
    }
    console.warn(
      `⚠️  Skipping pod '${pod.name}' from ${pod.packageName} — podspec/path not found.`
    );
  }

  if (!lines.length) {
    return "\n  # No additional Rune component pods detected";
  }

  return "\n" + lines.join("\n");
}

function replacePlaceholders(content, config, extras = {}) {
  let output = content
    .replace(/\{\{APP_NAME\}\}/g, config.appNameCapitalized)
    .replace(/\{\{BUNDLE_ID\}\}/g, config.bundleId)
    .replace(/\{\{WORKSPACE_NAME\}\}/g, config.workspaceName)
    .replace(/\{\{APP_DIR\}\}/g, config.appDir)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName);

  output = output.replace(
    /\{\{RUNE_COMPONENT_PODS\}\}/g,
    extras.componentPods ?? ""
  );

  return output;
}

// Copy template files and replace placeholders
const templatesRoot = path.dirname(
  require.resolve("@rune/templates/package.json")
);

function generateIOSProject(appDir, options = {}) {
  const { dev = true } = options; // Default to dev mode for backward compatibility
  const config = getAppConfig(appDir);
  const templateDir = path.join(templatesRoot, "ios");
  const targetDir = path.join(appDir, "ios");

  console.log(`Generating iOS project for ${config.displayName}...`);
  console.log(`  App Name: ${config.appName} (${config.displayName})`);
  console.log(`  Bundle ID: ${config.bundleId}`);
  console.log(`  Version: ${config.version}`);
  console.log(`  Mode: ${dev ? "Development" : "Production"}`);
  console.log(`  Target: ${targetDir}`);

  const componentPods = collectNativeIOSPods(appDir);
  if (componentPods.length) {
    console.log("  Native component pods:");
    componentPods.forEach((pod) => {
      console.log(`    • ${pod.name} (${pod.packageName})`);
    });
  } else {
    console.log("  Native component pods: none detected");
  }

  // Remove existing iOS folder if it exists
  if (fs.existsSync(targetDir)) {
    console.log("  Removing existing iOS folder...");
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  const componentPodBlock = formatComponentPodLines(componentPods, targetDir);

  // Copy and process template files
  const templateFiles = fs.readdirSync(templateDir);

  for (const file of templateFiles) {
    const templateFile = path.join(templateDir, file);
    const targetFile = path.join(targetDir, file);

    if (fs.statSync(templateFile).isFile()) {
      const content = fs.readFileSync(templateFile, "utf8");
      const processedContent = replacePlaceholders(content, config, {
        componentPods: componentPodBlock,
      });
      fs.writeFileSync(targetFile, processedContent);
      console.log(`  ✓ ${file}`);
    }
  }

  console.log(`✅ iOS project generated at ${targetDir}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), targetDir)}`);
  console.log("  pod install");
  console.log("  xcodegen generate");
  console.log("");
  console.log("Or run: yarn ios:init && yarn ios:dev");
}

// CLI interface
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node scripts/generate-ios.js <app-path>");
    console.error("Example: node scripts/generate-ios.js apps/sn-demo");
    process.exit(1);
  }

  const appPath = path.resolve(args[0]);

  if (!fs.existsSync(appPath)) {
    console.error(`App directory does not exist: ${appPath}`);
    process.exit(1);
  }

  try {
    generateIOSProject(appPath);
  } catch (error) {
    console.error("Error generating iOS project:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateIOSProject, getAppConfig };
