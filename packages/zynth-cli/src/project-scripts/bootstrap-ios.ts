import * as path from "path";
import * as fs from "fs";
import { generateIOSProject } from "./generate-ios";
import { execSync } from "child_process";
import { getZynthPackageConfig } from "./config-utils";
function dim(text: string): string {
  return `\u001b[2m${text}\u001b[0m`;
}

export function main(options: any = {}): void {
  const appDir = process.cwd();
  const quiet = Boolean(options.quiet);

  if (!quiet) {
    console.log("◆ Starting iOS bootstrap...");
    console.log(`◆ App directory: ${appDir}`);
  }

  try {
    console.log("◆ Generating iOS project from template...");
    if (quiet) {
      process.env.ZYNTH_QUIET_BOOTSTRAP = "1";
    }
    generateIOSProject(appDir, options);
    if (quiet) {
      delete process.env.ZYNTH_QUIET_BOOTSTRAP;
    }
    if (quiet) {
      const projectPath = path.join(appDir, "ios");
      console.log(`✔ iOS project generated at ${dim(projectPath)}`);
      console.log("");
    }

    const iosDir = path.join(appDir, "ios");
    process.chdir(iosDir);

    if (!quiet) {
      console.log("\n◆ Running XcodeGen...");
    }
    execSync("xcodegen generate --spec project.yml", {
      stdio: quiet ? "pipe" : "inherit",
    });

    const webServerTlsEnabled = resolveWebServerNativeTls(appDir);
    const podEnv = {
      ...process.env,
      ZYNTH_WEBSERVER_TLS: webServerTlsEnabled ? "1" : "0",
    };
    if (!quiet) {
      console.log(
        `◆ @zynth/webserver native TLS: ${webServerTlsEnabled ? "enabled" : "disabled"}`
      );
    }
    if (webServerTlsEnabled) {
      ensureWebServerTlsSources({ quiet });
    }

    console.log("◆ Installing CocoaPods dependencies...");
    execSync("pod install", {
      stdio: quiet ? "pipe" : "inherit",
      env: podEnv,
    });

    console.log("✔ iOS bootstrap completed successfully!");
    console.log("");
    if (!quiet) {
      console.log("➔ You can now open the .xcworkspace file in Xcode");
    }
  } catch (error: any) {
    console.error("\n✖ Bootstrap failed:", error.message);
    process.exit(1);
  }
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function resolveWebServerNativeTls(appDir: string): boolean {
  const packageConfig = getZynthPackageConfig(appDir, "@zynth/webserver");
  const candidates = [
    packageConfig.nativeTls,
    packageConfig.tlsNative,
    packageConfig.nativeTlsEnabled,
    packageConfig.enableNativeTls,
    packageConfig.enableTls,
  ];
  for (const value of candidates) {
    const parsed = parseBoolean(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return false;
}

function resolveWebServerNativeRoot(): string {
  try {
    const webServerPkgPath = require.resolve("@zynth/webserver/package.json", {
      paths: [process.cwd()],
    });
    return path.join(path.dirname(webServerPkgPath), "native");
  } catch (_error) {
    throw new Error(
      "Could not resolve @zynth/webserver native directory from the current app."
    );
  }
}

function ensureWebServerTlsSources(params: { quiet: boolean }): void {
  const { quiet } = params;
  const nativeRoot = resolveWebServerNativeRoot();
  const mbedtlsDir = path.join(nativeRoot, "mbedtls");
  const mbedtlsSentinel = path.join(mbedtlsDir, "library", "ssl_tls.c");
  if (fs.existsSync(mbedtlsSentinel)) {
    return;
  }

  const tempRoot = path.join(
    "/tmp",
    `zynth-webserver-tls-${Date.now().toString(36)}`,
  );
  const mbedtlsSourceDir = path.join(tempRoot, "mbedtls");
  const civetwebSourceDir = path.join(tempRoot, "civetweb");

  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    if (!quiet) {
      console.log("◆ Fetching @zynth/webserver TLS sources (mbedTLS + CivetWeb)...");
    }

    execSync(
      `git clone --depth 1 --branch mbedtls-2.28.10 https://github.com/Mbed-TLS/mbedtls.git "${mbedtlsSourceDir}"`,
      { stdio: quiet ? "pipe" : "inherit" },
    );
    execSync(
      `git clone --depth 1 https://github.com/civetweb/civetweb.git "${civetwebSourceDir}"`,
      { stdio: quiet ? "pipe" : "inherit" },
    );

    fs.rmSync(mbedtlsDir, { recursive: true, force: true });
    fs.mkdirSync(mbedtlsDir, { recursive: true });
    copyDir(path.join(mbedtlsSourceDir, "include"), path.join(mbedtlsDir, "include"));
    copyDir(path.join(mbedtlsSourceDir, "library"), path.join(mbedtlsDir, "library"));
    fs.copyFileSync(
      path.join(mbedtlsSourceDir, "LICENSE"),
      path.join(mbedtlsDir, "LICENSE"),
    );

    const civetwebDir = path.join(nativeRoot, "civetweb");
    fs.copyFileSync(
      path.join(civetwebSourceDir, "src", "civetweb.c"),
      path.join(civetwebDir, "civetweb.c"),
    );
    fs.copyFileSync(
      path.join(civetwebSourceDir, "include", "civetweb.h"),
      path.join(civetwebDir, "civetweb.h"),
    );
    fs.copyFileSync(
      path.join(civetwebSourceDir, "src", "mod_mbedtls.inl"),
      path.join(civetwebDir, "mod_mbedtls.inl"),
    );
    fs.copyFileSync(
      path.join(civetwebSourceDir, "src", "openssl_dl.inl"),
      path.join(civetwebDir, "openssl_dl.inl"),
    );
    fs.copyFileSync(
      path.join(civetwebSourceDir, "src", "wolfssl_extras.inl"),
      path.join(civetwebDir, "wolfssl_extras.inl"),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function copyDir(sourceDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, destPath);
      continue;
    }
    fs.copyFileSync(sourcePath, destPath);
  }
}

if (require.main === module) {
  main();
}
