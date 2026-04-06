import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import { getZynthPackageConfig } from "./config-utils";
function dim(text: string): string {
  return `\u001b[2m${text}\u001b[0m`;
}
import { generateAndroidProject } from "./generate-android";

const templatesRoot = path.resolve(__dirname, "..", "templates");

export function main(options: any = {}): void {
  const appDir = process.cwd();
  const quiet = Boolean(options.quiet);
  if (!quiet) {
    console.log("◆ Starting Android bootstrap...");
    console.log(`◆ App directory: ${appDir}`);
  }

  try {
    console.log("◆ Generating Android project from template...");
    if (quiet) {
      process.env.ZYNTH_QUIET_BOOTSTRAP = "1";
    }
    const config = generateAndroidProject(appDir, options);
    const webServerTlsEnabled = resolveWebServerNativeTls(appDir);
    if (webServerTlsEnabled) {
      ensureWebServerTlsSources({ quiet });
    }
    if (quiet) {
      delete process.env.ZYNTH_QUIET_BOOTSTRAP;
      console.log("  ├─ Generated Android Legacy Icons");
      console.log("  ├─ Generated Android Splash Assets");
      console.log(
        `✔ Android project generated at ${dim(path.join(appDir, "android"))}`,
      );
      console.log("");
    }

    const androidDir = path.join(appDir, "android");
    const gradlePropsSrc = path.join(
      templatesRoot,
      "android",
      "gradle.properties",
    );
    const gradlePropsDest = path.join(androidDir, "gradle.properties");
    if (fs.existsSync(gradlePropsSrc)) {
      fs.copyFileSync(gradlePropsSrc, gradlePropsDest);
    }
    upsertGradleProperty(
      gradlePropsDest,
      "zynthWebServerTls",
      webServerTlsEnabled ? "true" : "false"
    );
    if (!quiet) {
      console.log(
        `◆ @zynth/webserver native TLS: ${webServerTlsEnabled ? "enabled" : "disabled"}`
      );
    }
    const bundleSrc = path.join(appDir, "dist", "main.js");
    const assetsDir = path.join(androidDir, "app", "src", "main", "assets");
    const bundleDest = path.join(assetsDir, "main.js");
    const hbcDest = path.join(assetsDir, "main.hbc");
    const isDev = Boolean(options.dev);

    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    if (isDev) {
      if (!quiet) {
        console.log(
          "\n◆ Dev bootstrap skips copying the JS bundle (served via Rsbuild dev server).",
        );
      }
    } else if (fs.existsSync(bundleSrc)) {
      fs.copyFileSync(bundleSrc, bundleDest);
      if (!quiet) {
        console.log(
          `\n◆ Copied JS bundle to ${path.relative(appDir, bundleDest)}`,
        );
      }

      // Generate Hermes bytecode if hermesc is available
      try {
        if (!quiet) {
          console.log("◆ Compiling to Hermes bytecode...");
        }

        // Try to find hermesc in common locations
        let hermescPath: string | undefined;
        const possiblePaths = [
          "hermesc", // In PATH
          "npx hermesc", // Via npm
          path.join(process.env.ANDROID_HOME || "", "hermes", "bin", "hermesc"), // Android SDK
          path.join(appDir, "node_modules", "hermes-engine", "bin", "hermesc"), // Local app dependency
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
          const hermesArgs = [
            "-emit-binary",
            // App bundles legitimately reference host-provided globals (console, Promise, timers, URL...).
            // Keep other warnings enabled while suppressing undeclared-global noise.
            "-Wno-undefined-variable",
            "-out",
            `"${hbcDest}"`,
            `"${bundleSrc}"`,
          ].join(" ");
          execSync(
            `${hermescPath} ${hermesArgs}`,
            { stdio: "inherit" },
          );
          if (!quiet) {
            console.log(
              `◆ Generated Hermes bytecode: ${path.relative(appDir, hbcDest)}`,
            );
          }
        } else {
          if (!quiet) {
            console.warn(
              "! hermesc not found. HBC compilation skipped. Install hermes-engine or add hermesc to PATH.",
            );
          }
        }
      } catch (error: any) {
        if (!quiet) {
          console.warn(
            `! HBC compilation failed: ${error.message}. Falling back to JS source.`,
          );
        }
      }
    } else if (!quiet) {
      console.warn(
        "\n! JS bundle not found (dist/main.js). Run the JS build before bootstrap.",
      );
    }
    if (!quiet) {
      console.log("\n✔ Android project ready.");
      console.log("Next steps:");
      const relativePath = path.relative(process.cwd(), androidDir);
      console.log(`  cd ${relativePath || "."}`);
      console.log("  ./gradlew :app:assembleDebug");
      console.log("  ./gradlew :app:installDebug");
      console.log(`  adb shell am start -n ${config.bundleId}/.MainActivity`);
    } else {
      console.log("✔ Android bootstrap completed successfully!");
      console.log("");
    }
  } catch (error: any) {
    console.error("\n! Android bootstrap failed:", error.message);
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

function upsertGradleProperty(
  filePath: string,
  key: string,
  value: string
): void {
  const nextLine = `${key}=${value}`;
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = source.length > 0 ? source.split(/\r?\n/) : [];
  const pattern = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  let replaced = false;
  const output = lines.map((line) => {
    if (pattern.test(line)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (output.length > 0 && output[output.length - 1] !== "") {
      output.push("");
    }
    output.push(nextLine);
  }

  fs.writeFileSync(filePath, `${output.join("\n").replace(/\n+$/, "")}\n`);
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

    // Patch mod_mbedtls.inl for mbedTLS 2.28 compatibility
    const modMbedPath = path.join(civetwebDir, "mod_mbedtls.inl");
    let modMbedContent = fs.readFileSync(modMbedPath, "utf8");

    // 1. Add missing headers and ensure MBEDTLS_VERSION_NUMBER is seen
    if (!modMbedContent.includes("#include \"mbedtls/version.h\"")) {
      modMbedContent = modMbedContent.replace(
        "#include \"mbedtls/ctr_drbg.h\"",
        "#include \"mbedtls/version.h\"\n#include \"mbedtls/ssl_ciphersuites.h\"\n#include \"mbedtls/ctr_drbg.h\""
      );
    }

    // 2. Fix ciphersuite ID access for mbedTLS 2.x
    modMbedContent = modMbedContent.replace(
      "const int id = mbedtls_ssl_ciphersuite_get_id(ciphersuite);",
      "#if MBEDTLS_VERSION_NUMBER >= 0x03000000\n\t\t\tconst int id = mbedtls_ssl_ciphersuite_get_id(ciphersuite);\n#else\n\t\t\tconst int id = ciphersuite->id;\n#endif"
    );

    // 3. Fix PSA initialization for mbedTLS 2.x
    modMbedContent = modMbedContent.replace(
      "const psa_status_t status = psa_crypto_init();",
      "#if (defined(MBEDTLS_PSA_CRYPTO_C) || defined(MBEDTLS_USE_PSA_CRYPTO)) && (MBEDTLS_VERSION_NUMBER >= 0x03000000)\n\t\t\tconst psa_status_t status = psa_crypto_init();\n#endif"
    );

    // Also wrap the PSA status check
    modMbedContent = modMbedContent.replace(
      "if (status != PSA_SUCCESS) {",
      "#if (defined(MBEDTLS_PSA_CRYPTO_C) || defined(MBEDTLS_USE_PSA_CRYPTO)) && (MBEDTLS_VERSION_NUMBER >= 0x03000000)\n\t\tif (status != PSA_SUCCESS) {\n#else\n\t\tif (0) {\n#endif"
    );

    fs.writeFileSync(modMbedPath, modMbedContent, "utf8");
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
