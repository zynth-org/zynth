#!/usr/bin/env node

const path = require("path");
const { generateAndroidProject } = require("./generate-android.js");
const fs = require("fs");

function main() {
  const appDir = process.cwd();
  console.log("🚀 Starting Android prebuild...");
  console.log(`📱 App directory: ${appDir}`);

  try {
    console.log("\n📦 Generating Android project from template...");
    const config = generateAndroidProject(appDir);

    const androidDir = path.join(appDir, "android");
    const gradlePropsSrc = path.join(__dirname, "../templates/android/gradle.properties");
    const gradlePropsDest = path.join(androidDir, "gradle.properties");
    if (fs.existsSync(gradlePropsSrc)) {
      fs.copyFileSync(gradlePropsSrc, gradlePropsDest);
    }
    const bundleSrc = path.join(appDir, "dist", "main.js");
    const bundleDest = path.join(androidDir, "app", "src", "main", "assets", "main.js");
    if (fs.existsSync(bundleSrc)) {
      fs.copyFileSync(bundleSrc, bundleDest);
      console.log(`\n📄 Copied JS bundle to ${path.relative(appDir, bundleDest)}`);
    } else {
      console.warn("\n⚠️  JS bundle not found (dist/main.js). Run the JS build before prebuild.");
    }
    console.log("\n✅ Android project ready.");
    console.log("Next steps:");
    const relativePath = path.relative(process.cwd(), androidDir);
    console.log(`  cd ${relativePath || '.'}`);
    console.log("  ./gradlew :app:assembleDebug");
    console.log("  ./gradlew :app:installDebug");
    console.log(`  adb shell am start -n ${config.bundleId}/.MainActivity`);
  } catch (error) {
    console.error("\n❌ Android prebuild failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
