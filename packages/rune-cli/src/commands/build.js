const path = require("path");
const fs = require("fs");
const {
  findWorkspaceRoot,
  findAppDirectory,
  ensureBundle,
  getIOSConfig,
  getAndroidConfig,
  runCommand,
} = require("../utils");

module.exports = {
  command: "build <platform>",
  describe: "Build production version of the app",
  builder: (yargs) => {
    yargs.positional("platform", {
      describe: "Platform to build for",
      choices: ["ios", "android"],
    });
    yargs.option("skip-bundle", {
      describe: "Skip JS bundle generation",
      type: "boolean",
      default: false,
    });
    yargs.option("team", {
      describe: "Development team ID for iOS code signing",
      type: "string",
    });
    yargs.option("allow-provisioning-updates", {
      describe: "Allow Xcode to automatically update provisioning profiles",
      type: "boolean",
      default: true,
    });
    yargs.option("allow-provisioning-device-registration", {
      describe: "Allow Xcode to register devices automatically",
      type: "boolean",
      default: false,
    });
    yargs.option("export-options-plist", {
      describe: "Path to export options plist for IPA export",
      type: "string",
    });
  },
  handler: async (argv) => {
    const root = findWorkspaceRoot(process.cwd());
    const appDir = argv.app
      ? path.resolve(process.cwd(), argv.app)
      : findAppDirectory(process.cwd());

    // Build JS bundle if not skipped
    if (!argv.skipBundle) {
      console.log("📦 Building JavaScript bundle...");
      ensureBundle(appDir);
    }

    // Verify bundle exists
    const bundlePath = path.join(appDir, "dist", "main.js");
    if (!fs.existsSync(bundlePath)) {
      throw new Error(
        `JS bundle not found at ${bundlePath}. Cannot proceed with ${argv.platform} build.`
      );
    }

    if (argv.platform === "ios") {
      await buildIOS(root, appDir, argv);
    } else {
      // Android needs manual bundle copy since Gradle doesn't auto-copy in release builds
      copyBundleToAndroid(appDir);
      await buildAndroid(root, appDir);
    }
  },
};

function copyBundleToAndroid(appDir) {
  const bundleSrc = path.join(appDir, "dist", "main.js");
  if (!fs.existsSync(bundleSrc)) {
    throw new Error(
      "JS bundle not found at dist/main.js. Run the build command without --skip-bundle first."
    );
  }

  const androidDir = path.join(appDir, "android");
  if (!fs.existsSync(androidDir)) {
    throw new Error(
      `Android project not found at ${androidDir}. Run 'rune prebuild android' first to generate the native project.`
    );
  }

  const assetsDir = path.join(androidDir, "app", "src", "main", "assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const bundleDest = path.join(assetsDir, "main.js");
  const hbcDest = path.join(assetsDir, "main.hbc");

  fs.copyFileSync(bundleSrc, bundleDest);
  console.log(`📄 Copied JS bundle to android/app/src/main/assets/main.js`);

  // Try to generate Hermes bytecode
  try {
    const { execSync } = require("child_process");
    console.log("🔄 Compiling to Hermes bytecode...");

    const possiblePaths = [
      "hermesc",
      "npx hermesc",
      path.join(process.env.ANDROID_HOME || "", "hermes", "bin", "hermesc"),
    ];

    let hermescPath;
    for (const testPath of possiblePaths) {
      try {
        execSync(`${testPath} --help`, { stdio: "ignore" });
        hermescPath = testPath;
        break;
      } catch (e) {
        // Continue
      }
    }

    if (hermescPath) {
      execSync(`${hermescPath} -emit-binary -out "${hbcDest}" "${bundleSrc}"`, {
        stdio: "inherit",
      });
      console.log(
        `📦 Generated Hermes bytecode: android/app/src/main/assets/main.hbc`
      );
    } else {
      console.warn("⚠️  hermesc not found. Skipping HBC compilation.");
    }
  } catch (error) {
    console.warn(`⚠️  HBC compilation failed: ${error.message}`);
  }
}

async function buildIOS(root, appDir, argv) {
  const config = getIOSConfig(root, appDir);
  const iosDir = path.join(appDir, "ios");

  if (!fs.existsSync(iosDir)) {
    throw new Error(
      `iOS project not found at ${iosDir}.\n` +
        `Run 'rune prebuild ios' first to generate the native project, then configure signing in Xcode.`
    );
  }

  console.log(`📦 Building ${config.appNameCapitalized} for iOS (Release)...`);

  const workspacePath = `${config.appNameCapitalized}.xcworkspace`;
  if (!fs.existsSync(path.join(iosDir, workspacePath))) {
    throw new Error(
      `Xcode workspace not found at ios/${workspacePath}.\n` +
        `Run 'pod install' in the ios directory first.`
    );
  }

  const buildArgs = [
    "-workspace",
    `${config.appNameCapitalized}.xcworkspace`,
    "-scheme",
    config.appNameCapitalized,
    "-configuration",
    "Release",
    "-sdk",
    "iphoneos",
    "-derivedDataPath",
    ".build",
    "archive",
    "-archivePath",
    `.build/${config.appNameCapitalized}.xcarchive`,
  ];

  // Add automatic provisioning updates (enabled by default)
  if (argv.allowProvisioningUpdates) {
    buildArgs.push("-allowProvisioningUpdates");
    console.log("🔐 Automatic provisioning updates enabled");
  }

  // Add device registration if specified
  if (argv.allowProvisioningDeviceRegistration) {
    buildArgs.push("-allowProvisioningDeviceRegistration");
    console.log("📱 Automatic device registration enabled");
  }

  // Add development team if specified
  if (argv.team) {
    buildArgs.push(`DEVELOPMENT_TEAM=${argv.team}`);
    console.log(`👥 Using development team: ${argv.team}`);
  }

  try {
    runCommand("xcodebuild", buildArgs, { cwd: iosDir });
  } catch (error) {
    console.error("\n❌ Build failed!");
    console.error("\n💡 Troubleshooting tips:");
    console.error("   1. Open Xcode and sign in with your Apple ID:");
    console.error("      Xcode > Settings > Accounts");
    console.error("   2. Open the project and configure signing:");
    console.error(`      open ${path.join(iosDir, workspacePath)}`);
    console.error(
      "      Then: Select project > Signing & Capabilities > Select Team"
    );
    console.error("   3. If you have certificate issues, you may need to:");
    console.error("      - Revoke old certificates in developer.apple.com");
    console.error("      - Let Xcode create a new certificate");
    console.error("   4. Specify your team ID:");
    console.error(`      yarn rune build ios --team YOUR_TEAM_ID`);
    throw error;
  }

  console.log("\n✅ iOS Release build completed!");
  console.log(`📂 Archive: ios/.build/${config.appNameCapitalized}.xcarchive`);
}

async function buildAndroid(root, appDir) {
  const config = getAndroidConfig(root, appDir);
  console.log("📦 Building Android Release APK...");

  const androidDir = path.join(appDir, "android");
  runCommand("./gradlew", [":app:assembleRelease"], { cwd: androidDir });

  console.log("✅ Android Release build completed!");
  console.log("📂 APK: android/app/build/outputs/apk/release/app-release.apk");
}
