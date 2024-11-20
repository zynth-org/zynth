#!/usr/bin/env node

const path = require("path");
const { generateAndroidProject } = require("./generate-android.js");
const fs = require("fs");

const templatesRoot = path.dirname(require.resolve("@rune/templates/package.json"));

function main() {
  const appDir = process.cwd();
  console.log("🚀 Starting Android prebuild...");
  console.log(`📱 App directory: ${appDir}`);

  try {
    console.log("\n📦 Generating Android project from template...");
    const config = generateAndroidProject(appDir);

    const androidDir = path.join(appDir, "android");
    const gradlePropsSrc = path.join(
      templatesRoot,
      "android",
      "gradle.properties"
    );
    const gradlePropsDest = path.join(androidDir, "gradle.properties");
    if (fs.existsSync(gradlePropsSrc)) {
      fs.copyFileSync(gradlePropsSrc, gradlePropsDest);
    }
    const bundleSrc = path.join(appDir, "dist", "main.js");
    const assetsDir = path.join(androidDir, "app", "src", "main", "assets");
    const bundleDest = path.join(assetsDir, "main.js");
    const hbcDest = path.join(assetsDir, "main.hbc");

    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    if (fs.existsSync(bundleSrc)) {
      fs.copyFileSync(bundleSrc, bundleDest);
      console.log(
        `\n📄 Copied JS bundle to ${path.relative(appDir, bundleDest)}`
      );

      // Generate Hermes bytecode if hermesc is available
      try {
        const { execSync } = require("child_process");
        console.log("🔄 Compiling to Hermes bytecode...");

        // Try to find hermesc in common locations
        let hermescPath;
        const possiblePaths = [
          "hermesc", // In PATH
          "npx hermesc", // Via npm
          path.join(process.env.ANDROID_HOME || "", "hermes", "bin", "hermesc"), // Android SDK
          path.join(
            __dirname,
            "..",
            "node_modules",
            "hermes-engine",
            "bin",
            "hermesc"
          ), // Local
        ];

        for (const testPath of possiblePaths) {
          try {
            execSync(`${testPath} --help`, { stdio: "ignore" });
            hermescPath = testPath;
            break;
          } catch (e) {
            // Continue to next path
          }
        }

        if (hermescPath) {
          execSync(
            `${hermescPath} -emit-binary -out "${hbcDest}" "${bundleSrc}"`,
            { stdio: "inherit" }
          );
          console.log(
            `📦 Generated Hermes bytecode: ${path.relative(appDir, hbcDest)}`
          );
        } else {
          console.warn(
            "⚠️  hermesc not found. HBC compilation skipped. Install hermes-engine or add hermesc to PATH."
          );
        }
      } catch (error) {
        console.warn(
          `⚠️  HBC compilation failed: ${error.message}. Falling back to JS source.`
        );
      }
    } else {
      console.warn(
        "\n⚠️  JS bundle not found (dist/main.js). Run the JS build before prebuild."
      );
    }
    console.log("\n✅ Android project ready.");
    console.log("Next steps:");
    const relativePath = path.relative(process.cwd(), androidDir);
    console.log(`  cd ${relativePath || "."}`);
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
