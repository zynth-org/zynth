import * as path from "path";
import { generateIOSProject } from "./generate-ios";
import { execSync } from "child_process";
function dim(text: string): string {
  return `\u001b[2m${text}\u001b[0m`;
}

export function main(options: any = {}): void {
  const appDir = process.cwd();
  const quiet = Boolean(options.quiet);

  if (!quiet) {
    console.log("🚀 Starting iOS prebuild...");
    console.log(`📱 App directory: ${appDir}`);
  }

  try {
    console.log("◆ Generating iOS project from template...");
    if (quiet) {
      process.env.ZYNTH_QUIET_PREBUILD = "1";
    }
    generateIOSProject(appDir, options);
    if (quiet) {
      delete process.env.ZYNTH_QUIET_PREBUILD;
    }
    if (quiet) {
      const projectPath = path.join(appDir, "ios");
      console.log(`✔ iOS project generated at ${dim(projectPath)}`);
      console.log("");
    }

    const iosDir = path.join(appDir, "ios");
    process.chdir(iosDir);

    if (!quiet) {
      console.log("\n⚙️  Running XcodeGen...");
    }
    execSync("xcodegen generate --spec project.yml", {
      stdio: quiet ? "pipe" : "inherit",
    });

    console.log("◆ Installing CocoaPods dependencies...");
    execSync("pod install", { stdio: quiet ? "pipe" : "inherit" });

    console.log("✔ iOS prebuild completed successfully!");
    console.log("");
    if (!quiet) {
      console.log("📂 You can now open the .xcworkspace file in Xcode");
    }
  } catch (error: any) {
    console.error("\n❌ Prebuild failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
