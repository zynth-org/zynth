import * as fs from 'fs';
import * as path from 'path';
import { generateAssets } from "./generate-assets";
import { getAppConfig, safeReadJSON, AppConfig } from './config-utils';

function resolvePackageJson(depName: string, appDir: string): string | null {
  try {
    return require.resolve(path.join(depName, "package.json"), {
      paths: [appDir],
    });
  } catch (_error) {
    // fall through to entry-resolution fallback
  }

  try {
    const entryPath = require.resolve(depName, { paths: [appDir] });
    let dir = path.dirname(entryPath);
    while (true) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (_error) {
    // Ignore resolution failures; dependency may be optional for native
  }

  let current = appDir;
  while (true) {
    const candidate = path.join(current, "node_modules", depName, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function quoteYamlString(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function formatYamlValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    return value
      .map((entry) => {
        if (
          entry !== null &&
          typeof entry === "object" &&
          !Array.isArray(entry)
        ) {
          const objectLines = formatYamlObject(
            entry as Record<string, unknown>,
            `${indent}  `
          );
          return `${indent}-\n${objectLines}`;
        }
        return `${indent}- ${formatYamlValue(entry, `${indent}  `)}`;
      })
      .join("\n");
  }

  if (value !== null && typeof value === "object") {
    return formatYamlObject(value as Record<string, unknown>, indent);
  }

  if (typeof value === "string") {
    return quoteYamlString(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value == null) {
    return "null";
  }

  return quoteYamlString(String(value));
}

function formatYamlObject(
  objectValue: Record<string, unknown>,
  indent: string
): string {
  const entries = Object.entries(objectValue);
  if (entries.length === 0) {
    return "{}";
  }
  return entries
    .map(([key, entryValue]) => {
      const formatted = formatYamlValue(entryValue, `${indent}  `);
      if (
        formatted.includes("\n") ||
        (entryValue !== null && typeof entryValue === "object")
      ) {
        return `${indent}${key}:\n${formatted}`;
      }
      return `${indent}${key}: ${formatted}`;
    })
    .join("\n");
}

function formatInfoPlistProperties(properties: Record<string, unknown>): string {
  if (!properties || Object.keys(properties).length === 0) {
    return "";
  }
  return Object.entries(properties)
    .map(([key, value]) => {
      const formatted = formatYamlValue(value, "          ");
      if (
        formatted.includes("\n") ||
        (value !== null && typeof value === "object")
      ) {
        return `        ${key}:\n${formatted}`;
      }
      return `        ${key}: ${formatted}`;
    })
    .join("\n");
}

function applyTransportSecurityDefaults(
  infoPlist: Record<string, unknown>,
  dev: boolean
): void {
  const existing = infoPlist.NSAppTransportSecurity;
  if (existing != null) {
    return;
  }

  if (dev) {
    infoPlist.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: true,
    };
    return;
  }

  infoPlist.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: false,
  };
}

function collectNativeIOSPods(appDir: string): any[] {
  const podsByName = new Map();
  const appPackage = safeReadJSON(path.join(appDir, "package.json")) || {};

  function collectAppModules(): { packageDir: string; packageName: string; packageJson: any }[] {
    const modulesDir = path.join(appDir, "modules");
    if (!fs.existsSync(modulesDir)) return [];
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const packageDir = path.join(modulesDir, entry.name);
        const packageJsonPath = path.join(packageDir, "package.json");
        if (!fs.existsSync(packageJsonPath)) return null;
        const packageJson = safeReadJSON(packageJsonPath);
        if (!packageJson) return null;
        return {
          packageDir,
          packageName: packageJson.name || entry.name,
          packageJson,
        };
      })
      .filter(Boolean) as { packageDir: string; packageName: string; packageJson: any }[];
  }

  function registerPods(packageName: string, packageDir: string, iosConfig: any) {
    if (!iosConfig || !Array.isArray(iosConfig.pods)) return;
    for (const pod of iosConfig.pods) {
      if (!pod || !pod.name) continue;
      const record = {
        name: pod.name,
        packageName,
        podspecPath: pod.podspec ? path.resolve(packageDir, pod.podspec) : null,
        directoryPath: pod.path
          ? path.resolve(packageDir, pod.path)
          : packageDir,
        initializer: iosConfig.initializer || null, // Store initializer metadata
      };
      podsByName.set(record.name, record);
    }
  }

  if (appPackage.zynthNative && appPackage.zynthNative.ios) {
    registerPods(appPackage.name || "(app)", appDir, appPackage.zynthNative.ios);
  }

  const dependencySources = [
    appPackage.dependencies || {},
    appPackage.devDependencies || {},
  ];

  for (const source of dependencySources) {
    for (const depName of Object.keys(source)) {
      try {
        const pkgJsonPath = resolvePackageJson(depName, appDir);
        if (!pkgJsonPath) continue;
        const packageDir = path.dirname(pkgJsonPath);
        const depPackage = safeReadJSON(pkgJsonPath);
        if (!depPackage) continue;
        if (depPackage.zynthNative && depPackage.zynthNative.ios) {
          registerPods(depName, packageDir, depPackage.zynthNative.ios);
        }
      } catch (_error) {
        // Ignore resolvable failures; dependency may be optional for native
      }
    }
  }

  const appModules = collectAppModules();
  for (const module of appModules) {
    if (module.packageJson?.zynthNative?.ios) {
      registerPods(module.packageName, module.packageDir, module.packageJson.zynthNative.ios);
    }
  }

  return Array.from(podsByName.values());
}

function formatComponentPodLines(pods: any[], targetDir: string): string {
  if (!pods.length) {
    return "\n  # No additional Zynth component pods detected";
  }

  const lines: string[] = [];
  for (const pod of pods) {
    if (pod.directoryPath && fs.existsSync(pod.directoryPath)) {
      const relative = path
        .relative(targetDir, pod.directoryPath)
        .split(path.sep)
        .join("/");
      lines.push(
        `  pod '${pod.name}', :path => File.expand_path('${relative}', __dir__)`
      );
      continue;
    }
    if (pod.podspecPath && fs.existsSync(pod.podspecPath)) {
      const relative = path
        .relative(targetDir, pod.podspecPath)
        .split(path.sep)
        .join("/");
      lines.push(
        `  pod '${pod.name}', :podspec => File.expand_path('${relative}', __dir__)`
      );
      continue;
    }
    console.warn(
      `⚠️  Skipping pod '${pod.name}' from ${pod.packageName} — podspec/path not found.`
    );
  }

  if (!lines.length) {
    return "\n  # No additional Zynth component pods detected";
  }

  return "\n" + lines.join("\n");
}

function generateModuleImports(pods: any[]): string {
  const imports: string[] = [];
  for (const pod of pods) {
    if (pod.initializer && pod.initializer.className) {
      imports.push(`#import "${pod.name}-Swift.h"`);
    }
  }
  return imports.length
    ? "\n// Auto-generated module imports\n" + imports.join("\n")
    : "";
}

function generateModuleInitializers(pods: any[]): string {
  const initializers: string[] = [];
  for (const pod of pods) {
    if (
      pod.initializer &&
      pod.initializer.className &&
      pod.initializer.method
    ) {
      const className = pod.initializer.className;
      const method = pod.initializer.method;
      initializers.push(
        `  [${className} ${method}self.runtime];`,
        `  NSLog(@"[Zynth] ${className} initialized");`
      );
    }
  }

  if (!initializers.length) {
    return "  // No native modules to initialize";
  }

  return "  // Auto-generated module initializers\n" + initializers.join("\n");
}

function replacePlaceholders(content: string, config: AppConfig, extras: any = {}): string {
  let output = content
    .replace(/\{\{APP_NAME\}\}/g, config.appNameCapitalized)
    .replace(/\{\{BUNDLE_ID\}\}/g, config.bundleId)
    .replace(/\{\{WORKSPACE_NAME\}\}/g, config.workspaceName)
    .replace(/\{\{APP_DIR\}\}/g, config.appDir)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{VERSION\}\}/g, config.version)
    .replace(/\{\{BUILD_NUMBER\}\}/g, config.buildNumber);

  output = output.replace(
    /\{\{ZYNTH_IOS_RUNTIME_PACKAGE\}\}/g,
    extras.iosRuntimePackage ?? "@zynthjs/core"
  );

  output = output.replace(
    /\{\{ZYNTH_IOS_RUNTIME_DIR\}\}/g,
    extras.iosRuntimeDir ?? "zynth-core"
  );

  output = output.replace(
    /\{\{ZYNTH_IOS_HERMES_DIR\}\}/g,
    extras.iosHermesDir ?? "zynth-core/ios"
  );

  output = output.replace(
    /\{\{RUNTIME_IMPORTS\}\}/g,
    extras.runtimeImports ?? ""
  );

  output = output.replace(
    /\{\{RUNTIME_LOAD_FAILURE\}\}/g,
    extras.runtimeLoadFailure ?? ""
  );

  output = output.replace(
    /\{\{RUNTIME_ROOT_CONTROLLER\}\}/g,
    extras.runtimeRootController ?? ""
  );

  output = output.replace(
    /\{\{ZYNTH_COMPONENT_PODS\}\}/g,
    extras.componentPods ?? ""
  );

  output = output.replace(
    /\{\{MODULE_IMPORTS\}\}/g,
    extras.moduleImports ?? ""
  );

  output = output.replace(
    /\{\{MODULE_INITIALIZERS\}\}/g,
    extras.moduleInitializers ?? ""
  );

  output = output.replace(
    /\{\{INFO_PLIST_PROPERTIES\}\}/g,
    extras.infoPlistProperties ?? ""
  );

  output = output.replace(
    /\{\{EXTRA_APP_DELEGATE_HEADER\}\}/g,
    extras.extraAppDelegateHeader ?? ""
  );

  output = output.replace(
    /\{\{EXTRA_APP_DELEGATE_INIT\}\}/g,
    extras.extraAppDelegateInit ?? ""
  );

  output = output.replace(
    /\{\{UI_APP_FONTS\}\}/g,
    extras.uiAppFonts ?? ""
  );

  output = output.replace(
    /\{\{LAUNCH_SCREEN_IMAGE\}\}/g,
    extras.launchScreenImage ?? ""
  );
  output = output.replace(
    /\{\{SPLASH_CONTENT_MODE\}\}/g,
    extras.splashContentMode ?? "scaleAspectFit"
  );

  return output;
}

function generateNativeModulesConfig(pods: any[], targetDir: string) {
  const modules: any[] = [];
  for (const pod of pods) {
    if (
      pod.initializer &&
      pod.initializer.className &&
      pod.initializer.method
    ) {
      modules.push({
        className: pod.initializer.className,
        method: pod.initializer.method,
      });
    }
  }

  const jsonContent = JSON.stringify(modules, null, 2);
  fs.writeFileSync(path.join(targetDir, "ZynthNativeModules.json"), jsonContent);
}

// Copy template files and replace placeholders
const templatesRoot = path.resolve(__dirname, "..", "templates");

function removeDirectoryWithRetries(targetDir: string, retries = 5): void {
  const sleep = (ms: number) => {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, ms);
  };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      return;
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }
      const code = error?.code;
      if (code !== "ENOTEMPTY" && code !== "EBUSY" && code !== "EPERM") {
        throw error;
      }
      sleep(50 * (attempt + 1));
    }
  }
}

export async function generateIOSProject(appDir: string, options: any = {}) {
  const { dev = true, quiet = false, glyphMap } = options; // Default to dev mode for backward compatibility
  const iosRuntimePackage = "@zynthjs/core";
  const iosRuntimeDir = "zynth-core";
  const iosHermesDir = "zynth-core/ios";
  const runtimeImports = '#import "ZynthKit-Swift.h"';
  const runtimeLoadFailure = "";
  const runtimeRootController =
    "  ZynthViewController *vc = [ZynthViewController new];\n  vc.view = self.surface;\n  self.window.rootViewController = vc;";
  const config = getAppConfig(appDir);
  const devArtifacts = safeReadJSON(path.join(appDir, ".zynth", "artifacts.json")) || {};
  const devServerToken = typeof devArtifacts.hmrServerToken === "string"
    ? devArtifacts.hmrServerToken
    : undefined;
  const appJson = safeReadJSON(path.join(appDir, "app.json")) || {};
  const zynthConfig = appJson.zynth || appJson || {};
  const splashConfig = zynthConfig.splash || {};
  const templateDir = path.join(templatesRoot, "ios");
  const targetDir = path.join(appDir, "ios");

  if (!quiet) {
    console.log(`Generating iOS project for ${config.displayName}...`);
    console.log(`  App Name: ${config.appName} (${config.displayName})`);
    console.log(`  Bundle ID: ${config.bundleId}`);
    console.log(`  Version: ${config.version}`);
    console.log(`  Mode: ${dev ? "Development" : "Production"}`);
    console.log("  Runtime: Core");
    console.log(`  Target: ${targetDir}`);
  }

  const componentPods = collectNativeIOSPods(appDir);
  if (!quiet) {
    if (componentPods.length) {
      console.log("  Native component pods:");
      componentPods.forEach((pod) => {
        console.log(`    • ${pod.name} (${pod.packageName})`);
      });
    } else {
      console.log("  Native component pods: none detected");
    }
  }

  // Remove existing iOS folder if it exists
  if (fs.existsSync(targetDir)) {
    if (!quiet) {
      console.log("  Removing existing iOS folder...");
    }
    removeDirectoryWithRetries(targetDir);
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  const componentPodBlock = formatComponentPodLines(componentPods, targetDir);
  const moduleImports = generateModuleImports(componentPods);
  const moduleInitializers = generateModuleInitializers(componentPods);
  applyTransportSecurityDefaults(config.infoPlist, dev);

  // Inject Dev Server URL into Info.plist if configured
  if (config.devServerUrl) {
    config.infoPlist["ZynthDevServerURL"] = config.devServerUrl;
  }
  if (devServerToken) {
    config.infoPlist["ZynthDevServerToken"] = devServerToken;
  }

  // Generate assets before templating so project.yml can include copied fonts
  // in UIAppFonts and XcodeGen can add them to the app target resources.
  await generateAssets(appDir, "ios", dev, glyphMap);
  if (quiet) {
    console.log("  ├─ Generated iOS App Icons");
    console.log("  ├─ Generated iOS Splash Assets");
  }
  
  const infoPlistProperties = formatInfoPlistProperties(config.infoPlist);

  // Collect fonts for UIAppFonts
  const fontsDir = path.join(targetDir, config.appName, "fonts");
  const fontFiles: string[] = [];
  if (fs.existsSync(fontsDir)) {
    const files = fs.readdirSync(fontsDir);
    files.forEach(file => {
      if (/\.(ttf|otf)$/i.test(file)) {
        fontFiles.push(file);
      }
    });
  }
  
  const uiAppFontsLine = fontFiles.length > 0 
    ? `        UIAppFonts:\n${fontFiles.map(f => `          - fonts/${f}`).join('\n')}`
    : "";

  const hasSplash = Boolean(splashConfig.image || splashConfig.backgroundColor);
  const splashImageName = splashConfig.image ? "LaunchImage" : "";
  const splashBackgroundColor = splashConfig.backgroundColor || (splashConfig.image ? "#ffffff" : "");
  const splashResizeMode = splashConfig.resizeMode || "contain";
  const launchScreenImage = splashConfig.image ? "          UIImageName: LaunchImage" : "";
  const splashContentMode = (() => {
    const mode = String(splashResizeMode).trim().toLowerCase();
    if (mode === "cover") return "scaleAspectFill";
    if (mode === "stretch") return "scaleToFill";
    return "scaleAspectFit";
  })();

  // Check if splash screen package is installed
  const hasSplashScreenPackage = componentPods.some(p => p.name === 'ZynthSplashScreen');
  
  let extraAppDelegateHeader = "";
  let extraAppDelegateInit = "";

  if (hasSplash && hasSplashScreenPackage) {
    extraAppDelegateHeader = `
#import "ZynthSplashScreen-Swift.h"
static NSString *const kZynthSplashImageName = @"${splashImageName}";
static NSString *const kZynthSplashBackgroundColor = @"${splashBackgroundColor}";
static NSString *const kZynthSplashResizeMode = @"${splashResizeMode}";`;

    extraAppDelegateInit = `
  [ZynthSplashScreen setupWith:self.runtime 
                       window:self.window 
                    imageName:kZynthSplashImageName 
              backgroundColor:kZynthSplashBackgroundColor 
                   resizeMode:kZynthSplashResizeMode];`;
  }
  
  // Generate module config for dynamic loading (e.g. Hypervisor)
  generateNativeModulesConfig(componentPods, targetDir);

  // Copy and process template files
  const templateFiles = fs.readdirSync(templateDir);

  for (const file of templateFiles) {
    const templateFile = path.join(templateDir, file);
    const targetFile = path.join(targetDir, file);

    if (fs.statSync(templateFile).isFile()) {
      const content = fs.readFileSync(templateFile, "utf8");
      const processedContent = replacePlaceholders(content, config, {
        componentPods: componentPodBlock,
        moduleImports,
        moduleInitializers,
        infoPlistProperties,
        uiAppFonts: uiAppFontsLine,
        extraAppDelegateHeader,
        extraAppDelegateInit,
        launchScreenImage,
        splashContentMode,
        iosRuntimePackage,
        iosRuntimeDir,
        iosHermesDir,
        runtimeImports,
        runtimeLoadFailure,
        runtimeRootController,
      });
      fs.writeFileSync(targetFile, processedContent);
      if (!quiet) {
        console.log(`  ✓ ${file}`);
      }
    }
  }

  if (!quiet) {
    console.log(`✅ iOS project generated at ${targetDir}`);
    console.log("");
    console.log("Next steps:");
    console.log(`  cd ${path.relative(process.cwd(), targetDir)}`);
    console.log("  pod install");
    console.log("  xcodegen generate");
    console.log("");
    console.log("Or run: yarn ios:init && yarn ios:dev");
  }
}

// CLI interface
if (require.main === module) {
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
    generateIOSProject(appPath).catch((error: any) => {
      console.error("Failed to generate iOS project:", error.message);
      process.exit(1);
    });
  } catch (error: any) {
    console.error("Error generating iOS project:", error.message);
    process.exit(1);
  }
}
