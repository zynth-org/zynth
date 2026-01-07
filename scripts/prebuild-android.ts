import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
function dim(text: string): string {
  return `\u001b[2m${text}\u001b[0m`;
}
import { generateAndroidProject } from "./generate-android";

const templatesRoot = path.dirname(
  require.resolve("@rune/templates/package.json")
);

export function main(options: any = {}): void {
  const appDir = process.cwd();
  const quiet = Boolean(options.quiet);
  if (!quiet) {
    console.log("🚀 Starting Android prebuild...");
    console.log(`📱 App directory: ${appDir}`);
  }

  try {
    console.log("◆ Generating Android project from template...");
    if (quiet) {
      process.env.RUNE_QUIET_PREBUILD = "1";
    }
    const config = generateAndroidProject(appDir, options);
    if (quiet) {
      delete process.env.RUNE_QUIET_PREBUILD;
      console.log("  ├─ Generated Android Legacy Icons");
      console.log("  ├─ Generated Android Splash Assets");
      console.log(`✔ Android project generated at ${dim(path.join(appDir, "android"))}`);
      console.log("");
    }

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
      if (!quiet) {
        console.log(
          `\n📄 Copied JS bundle to ${path.relative(appDir, bundleDest)}`
        );
      }

      // Generate Hermes bytecode if hermesc is available
      try {
        if (!quiet) {
          console.log("🔄 Compiling to Hermes bytecode...");
        }

        // Try to find hermesc in common locations
        let hermescPath: string | undefined;
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
          if (!quiet) {
            console.log(
              `📦 Generated Hermes bytecode: ${path.relative(appDir, hbcDest)}`
            );
          }
        } else {
          if (!quiet) {
            console.warn(
              "⚠️  hermesc not found. HBC compilation skipped. Install hermes-engine or add hermesc to PATH."
            );
          }
        }
      } catch (error: any) {
        if (!quiet) {
          console.warn(
            `⚠️  HBC compilation failed: ${error.message}. Falling back to JS source.`
          );
        }
      }
    } else {
      if (!quiet) {
        console.warn(
          "\n⚠️  JS bundle not found (dist/main.js). Run the JS build before prebuild."
        );
      }
    }
    if (!quiet) {
      console.log("\n✅ Android project ready.");
      console.log("Next steps:");
      const relativePath = path.relative(process.cwd(), androidDir);
      console.log(`  cd ${relativePath || "."}`);
      console.log("  ./gradlew :app:assembleDebug");
      console.log("  ./gradlew :app:installDebug");
      console.log(`  adb shell am start -n ${config.bundleId}/.MainActivity`);
    } else {
      console.log("✔ Android prebuild completed successfully!");
      console.log("");
    }
  } catch (error: any) {
    console.error("\n❌ Android prebuild failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
