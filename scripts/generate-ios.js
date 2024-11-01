#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// Configuration - parse app info from package.json
function getAppConfig(appDir) {
  const pkgPath = path.join(appDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const appName = path.basename(appDir);

  return {
    appName: appName.replace(/[^a-zA-Z0-9]/g, ""), // Clean for Xcode
    appNameCapitalized:
      appName.charAt(0).toUpperCase() +
      appName.slice(1).replace(/[^a-zA-Z0-9]/g, ""),
    appDir: appName,
    bundleId: pkg.bundleId || `com.solidnative.${appName}`,
    workspaceName: pkg.name || `@demo/${appName}`,
    displayName: pkg.displayName || appName,
  };
}

// Replace placeholders in file content
function replacePlaceholders(content, config) {
  return content
    .replace(/\{\{APP_NAME\}\}/g, config.appNameCapitalized)
    .replace(/\{\{BUNDLE_ID\}\}/g, config.bundleId)
    .replace(/\{\{WORKSPACE_NAME\}\}/g, config.workspaceName)
    .replace(/\{\{APP_DIR\}\}/g, config.appDir)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName);
}

// Copy template files and replace placeholders
function generateIOSProject(appDir) {
  const config = getAppConfig(appDir);
  const templateDir = path.resolve(__dirname, "../templates/ios");
  const targetDir = path.join(appDir, "ios");

  console.log(`Generating iOS project for ${config.appName}...`);
  console.log(`  App: ${config.appName}`);
  console.log(`  Bundle ID: ${config.bundleId}`);
  console.log(`  Target: ${targetDir}`);

  // Remove existing iOS folder if it exists
  if (fs.existsSync(targetDir)) {
    console.log("  Removing existing iOS folder...");
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  // Copy and process template files
  const templateFiles = fs.readdirSync(templateDir);

  for (const file of templateFiles) {
    const templateFile = path.join(templateDir, file);
    const targetFile = path.join(targetDir, file);

    if (fs.statSync(templateFile).isFile()) {
      const content = fs.readFileSync(templateFile, "utf8");
      const processedContent = replacePlaceholders(content, config);
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
