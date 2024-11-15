#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getAppConfig } = require("./generate-ios.js");

const templatesRoot = path.dirname(require.resolve("@rune/templates/package.json"));
const BINARY_EXTENSIONS = new Set([".jar", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico"]);

function replacePlaceholders(content, config) {
  return content
    .replace(/\{\{APP_NAME\}\}/g, config.appName)
    .replace(/\{\{APP_DIR\}\}/g, config.appDir)
    .replace(/\{\{BUNDLE_ID\}\}/g, config.bundleId)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{WORKSPACE_NAME\}\}/g, config.workspaceName || config.appName)
    .replace(/\{\{APP_NAME_CAP\}\}/g, config.appNameCapitalized || config.appName);
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      result.push(...walk(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function generateAndroidProject(appDir) {
  const baseConfig = getAppConfig(appDir);
  const androidPackage = (baseConfig.bundleId || `com.solidnative.${baseConfig.appDir.replace(/-/g, "")}`).toLowerCase();
  const config = {
    ...baseConfig,
    bundleId: androidPackage,
  };
  const templateDir = path.join(templatesRoot, "android");
  const targetDir = path.join(appDir, "android");

  if (fs.existsSync(targetDir)) {
    console.log("  Removing existing Android folder...");
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  ensureDir(targetDir);

  const packagePath = androidPackage.replace(/\./g, path.sep);
  const files = walk(templateDir);

  for (const file of files) {
    const rel = path.relative(templateDir, file);
    const targetPath = (() => {
      const javaDir = path.join("app", "src", "main", "java");
      const mainActivityPath = path.join(javaDir, "MainActivity.kt");
      const modulesDir = path.join(javaDir, "modules");
      if (rel === mainActivityPath) {
        return path.join(targetDir, "app", "src", "main", "java", packagePath, "MainActivity.kt");
      }
      if (rel.startsWith(modulesDir + path.sep)) {
        const remainder = rel.slice(modulesDir.length + 1);
        return path.join(targetDir, "app", "src", "main", "java", packagePath, "modules", remainder);
      }
      return path.join(targetDir, rel);
    })();

    ensureDir(path.dirname(targetPath));

    if (isBinary(file)) {
      fs.copyFileSync(file, targetPath);
    } else {
      const content = fs.readFileSync(file, "utf8");
      const processed = replacePlaceholders(content, config);
      fs.writeFileSync(targetPath, processed, "utf8");
    }
  }

  ensureDir(path.join(targetDir, "app", "src", "main", "assets"));
  const gradlewPath = path.join(targetDir, "gradlew");
  if (fs.existsSync(gradlewPath)) {
    fs.chmodSync(gradlewPath, 0o755);
  }

  console.log(`✅ Android project generated at ${targetDir}`);
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), targetDir)}`);
  console.log("  ./gradlew :app:assembleDebug");
  console.log("  ./gradlew :app:installDebug");
  return config;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/generate-android.js <app-path>");
    process.exit(1);
  }
  const appPath = path.resolve(args[0]);
  if (!fs.existsSync(appPath)) {
    console.error(`App directory does not exist: ${appPath}`);
    process.exit(1);
  }
  try {
    generateAndroidProject(appPath);
  } catch (err) {
    console.error("Error generating Android project:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateAndroidProject };
