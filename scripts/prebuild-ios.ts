import * as path from "path";
import { generateIOSProject } from "./generate-ios";
import { execSync } from "child_process";

export function main(options: any = {}): void {
  const appDir = process.cwd();

  console.log("🚀 Starting iOS prebuild...");
  console.log(`📱 App directory: ${appDir}`);

  try {
    console.log("\n📦 Generating iOS project from template...");
    generateIOSProject(appDir, options);

    const iosDir = path.join(appDir, "ios");
    process.chdir(iosDir);

    console.log("\n⚙️  Running XcodeGen...");
    execSync("xcodegen generate --spec project.yml", { stdio: "inherit" });

    console.log("\n🍎 Installing CocoaPods dependencies...");
    execSync("pod install", { stdio: "inherit" });

    console.log("\n✅ iOS prebuild completed successfully!");
    console.log("📂 You can now open the .xcworkspace file in Xcode");
  } catch (error: any) {
    console.error("\n❌ Prebuild failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
