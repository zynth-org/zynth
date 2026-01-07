import * as fs from 'fs';
import * as path from 'path';
import { getAppConfig, safeReadJSON, AppConfig } from './config-utils';
import { generateAssets } from "./generate-assets";

const templatesRoot = path.dirname(
  require.resolve("@rune/templates/package.json")
);
const BINARY_EXTENSIONS = new Set([
  ".jar",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
]);

function generateAndroidModuleImports(modules: any[]): string {
  const imports: string[] = [];
  const packages = new Set<string>(); // Track unique packages to avoid duplicates

  for (const module of modules) {
    if (
      module.initializer &&
      module.initializer.className &&
      module.initializer.package
    ) {
      const pkg = module.initializer.package;
      const className = module.initializer.className;
      const fullImport = `${pkg}.${className}`;

      if (!packages.has(fullImport)) {
        packages.add(fullImport);
        imports.push(`import ${fullImport}`);
      }
    }
  }

  return imports.length ? "\n" + imports.join("\n") : "";
}

function generateAndroidModuleInitializers(modules: any[]): string {
  const initializers: string[] = [];
  const argMap: Record<string, string> = {
    activity: "this",
    runtime: "runtime",
    rootView: "root",
    root: "root",
  };
  for (const module of modules) {
    if (
      module.initializer &&
      module.initializer.className &&
      module.initializer.method
    ) {
      const className = module.initializer.className;
      const method = module.initializer.method;
      const argsSpec = Array.isArray(module.initializer.args)
        ? module.initializer.args
        : null;
      const args =
        argsSpec && argsSpec.length
          ? argsSpec.map((token: string) => argMap[token] || token).join(", ")
          : "this, runtime";
      initializers.push(
        `        ${className}.${method}(${args})`,
        `        Log.d("Rune", "${className} initialized")`
      );
    }
  }

  if (!initializers.length) {
    return "        // No native modules to initialize";
  }

  return (
    "        // Auto-generated module initializers\n" + initializers.join("\n")
  );
}

function formatActivityAttributes(androidConfig: any): string {
  const attributes: string[] = [];
  
  // Default to adjustResize if not specified
  const windowSoftInputMode = androidConfig?.windowSoftInputMode || "adjustResize";
  attributes.push(`android:windowSoftInputMode="${windowSoftInputMode}"`);

  // Add generic attributes if provided in 'activityAttributes' map
  if (androidConfig?.activityAttributes) {
    for (const [key, value] of Object.entries(androidConfig.activityAttributes)) {
      attributes.push(`${key}="${value}"`);
    }
  }

  return attributes.join("\n            ");
}

function replacePlaceholders(content: string, config: AppConfig, extras: any = {}): string {
  return content
    .replace(/\{\{\s*APP_NAME\s*\}\}/g, config.appName)
    .replace(/\{\{\s*APP_DIR\s*\}\}/g, config.appDir)
    .replace(/\{\{\s*BUNDLE_ID\s*\}\}/g, config.bundleId)
    .replace(/\{\{\s*DISPLAY_NAME\s*\}\}/g, config.displayName)
    .replace(/\{\{\s*WORKSPACE_NAME\s*\}\}/g, config.workspaceName || config.appName)
    .replace(
      /\{\{\s*APP_NAME_CAP\s*\}\}/g,
      config.appNameCapitalized || config.appName
    )
    .replace(
      /\{\{\s*RUNE_COMPONENT_MODULE_INCLUDES\s*\}\}/g,
      extras.componentIncludes ?? ""
    )
    .replace(
      /\{\{\s*RUNE_COMPONENT_MODULE_DEPENDENCIES\s*\}\}/g,
      extras.componentDependencies ?? ""
    )
    .replace(/\{\{\s*MODULE_IMPORTS\s*\}\}/g, extras.moduleImports ?? "")
    .replace(/\{\{\s*MODULE_INITIALIZERS\s*\}\}/g, extras.moduleInitializers ?? "")
    .replace(/\{\{\s*ACTIVITY_ATTRIBUTES\s*\}\}/g, extras.activityAttributes ?? "")
    .replace(
      /\{\{\s*SPLASH_ICON_DRAWABLE\s*\}\}/g,
      extras.splashIconDrawable ?? "@mipmap/ic_launcher"
    )
    .replace(
      /\{\{\s*SPLASH_WINDOW_BACKGROUND\s*\}\}/g,
      extras.splashWindowBackground ?? "@drawable/rune_splash_screen"
    )
    .replace(
      /\{\{\s*ACTIVITY_HOOK_IMPORTS\s*\}\}/g,
      extras.activityHookImports ?? ""
    )
    .replace(
      /\{\{\s*ACTIVITY_ON_CREATE_HOOKS\s*\}\}/g,
      extras.activityOnCreateHooks ?? ""
    )
    .replace(
      /\{\{\s*ACTIVITY_ON_FIRST_FRAME_HOOKS\s*\}\}/g,
      extras.activityOnFirstFrameHooks ?? ""
    );
}

function walk(dir: string): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      result.push(...walk(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function isBinary(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function collectNativeAndroidModules(appDir: string): any[] {
  const modulesByName = new Map();
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

  function registerModules(packageName: string, packageDir: string, androidConfig: any) {
    if (!androidConfig || !Array.isArray(androidConfig.modules)) return;
    for (const module of androidConfig.modules) {
      if (!module || !module.name) continue;
      const record = {
        name: module.name,
        packageName,
        directoryPath: module.path
          ? path.resolve(packageDir, module.path)
          : packageDir,
        dependency: module.dependency || "implementation",
        initializer: androidConfig.initializer || null, // Store initializer metadata
      };
      modulesByName.set(record.name, record);
    }
  }

  if (appPackage.runeNative && appPackage.runeNative.android) {
    registerModules(
      appPackage.name || "(app)",
      appDir,
      appPackage.runeNative.android
    );
  }

  const dependencySources = [
    appPackage.dependencies || {},
    appPackage.devDependencies || {},
  ];

  for (const source of dependencySources) {
    for (const depName of Object.keys(source)) {
      try {
        const pkgJsonPath = require.resolve(
          path.join(depName, "package.json"),
          {
            paths: [appDir],
          }
        );
        const packageDir = path.dirname(pkgJsonPath);
        const depPackage = safeReadJSON(pkgJsonPath);
        if (!depPackage) continue;
        if (depPackage.runeNative && depPackage.runeNative.android) {
          registerModules(depName, packageDir, depPackage.runeNative.android);
        }
      } catch (_error) {
        // Dependency might not provide native modules; ignore resolution errors
      }
    }
  }

  const appModules = collectAppModules();
  for (const module of appModules) {
    if (module.packageJson?.runeNative?.android) {
      registerModules(
        module.packageName,
        module.packageDir,
        module.packageJson.runeNative.android
      );
    }
  }

  return Array.from(modulesByName.values());
}

type ActivityHooks = {
  imports: string[];
  onCreate: string[];
  onFirstFrame: string[];
};

function normalizeHookLines(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }
  return [String(value)];
}

function mergeHookLines(
  target: string[],
  seen: Set<string>,
  incoming: string[]
): void {
  for (const line of incoming) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    target.push(line);
  }
}

function collectAndroidActivityHooks(appDir: string): ActivityHooks {
  const hooks: ActivityHooks = { imports: [], onCreate: [], onFirstFrame: [] };
  const seenImports = new Set<string>();
  const seenOnCreate = new Set<string>();
  const seenOnFirstFrame = new Set<string>();
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

  function registerHooks(androidConfig: any) {
    if (!androidConfig || !androidConfig.activityHooks) return;
    const activityHooks = androidConfig.activityHooks;
    mergeHookLines(
      hooks.imports,
      seenImports,
      normalizeHookLines(activityHooks.imports)
    );
    mergeHookLines(
      hooks.onCreate,
      seenOnCreate,
      normalizeHookLines(activityHooks.onCreate)
    );
    mergeHookLines(
      hooks.onFirstFrame,
      seenOnFirstFrame,
      normalizeHookLines(activityHooks.onFirstFrame)
    );
  }

  if (appPackage.runeNative && appPackage.runeNative.android) {
    registerHooks(appPackage.runeNative.android);
  }

  const dependencySources = [
    appPackage.dependencies || {},
    appPackage.devDependencies || {},
  ];

  for (const source of dependencySources) {
    for (const depName of Object.keys(source)) {
      try {
        const pkgJsonPath = require.resolve(
          path.join(depName, "package.json"),
          {
            paths: [appDir],
          }
        );
        const depPackage = safeReadJSON(pkgJsonPath);
        if (!depPackage || !depPackage.runeNative?.android) continue;
        registerHooks(depPackage.runeNative.android);
      } catch (_error) {
        // Ignore resolution failures.
      }
    }
  }

  const appModules = collectAppModules();
  for (const module of appModules) {
    if (!module.packageJson?.runeNative?.android) continue;
    registerHooks(module.packageJson.runeNative.android);
  }

  return hooks;
}

function formatHookBlock(lines: string[], indent: string): string {
  if (!lines.length) return "";
  return lines.map((line) => `${indent}${line}`).join("\n");
}

function formatAndroidSettingsBlock(modules: any[], targetDir: string): string {
  if (!modules.length) {
    return "\n// No additional Rune component modules detected";
  }
  return (
    "\n" +
    modules
      .map((module) => {
        const relative = path
          .relative(targetDir, module.directoryPath)
          .split(path.sep)
          .join("/");
        return [
          `include(":${module.name}")`,
          `project(":${module.name}").projectDir = File(rootDir, "${relative}")`,
        ].join("\n");
      })
      .join("\n")
  );
}

function formatAndroidDependencyBlock(modules: any[]): string {
  if (!modules.length) {
    return "";
  }
  return (
    "\n" +
    modules
      .map((module) => `  ${module.dependency}(project(":${module.name}"))`)
      .join("\n")
  );
}

export function generateAndroidProject(appDir: string, options: any = {}): AppConfig {
  const { dev = true, quiet = false } = options; // Default to dev mode for backward compatibility
  const baseConfig = getAppConfig(appDir);
  const androidPackage = (
    baseConfig.bundleId || `com.rune.${baseConfig.appDir.replace(/-/g, "")}`
  ).toLowerCase();
  const config = {
    ...baseConfig,
    bundleId: androidPackage,
  };

  if (!quiet) {
    console.log(`Generating Android project for ${config.displayName}...`);
    console.log(`  Package: ${androidPackage}`);
    console.log(`  Mode: ${dev ? "Development" : "Production"}`);
  }

  const componentModules = collectNativeAndroidModules(appDir);
  if (!quiet) {
    if (componentModules.length) {
      console.log("  Native component modules:");
      componentModules.forEach((module) => {
        console.log(`    • ${module.name} (${module.packageName})`);
      });
    } else {
      console.log("  Native component modules: none detected");
    }
  }

  const templateDir = path.join(templatesRoot, "android");
  const targetDir = path.join(appDir, "android");
  const componentIncludes = formatAndroidSettingsBlock(
    componentModules,
    targetDir
  );
  const componentDependencies = formatAndroidDependencyBlock(componentModules);
  const moduleImports = generateAndroidModuleImports(componentModules);
  const moduleInitializers =
    generateAndroidModuleInitializers(componentModules);
  const activityAttributes = formatActivityAttributes(baseConfig.androidConfig);
  const splashIconDrawable = "@mipmap/ic_launcher";
  const splashWindowBackground = "@drawable/rune_splash_screen";
  const activityHooks = collectAndroidActivityHooks(appDir);
  const activityHookImports = formatHookBlock(activityHooks.imports, "");
  const activityOnCreateHooks = formatHookBlock(activityHooks.onCreate, "    ");
  const activityOnFirstFrameHooks = formatHookBlock(
    activityHooks.onFirstFrame,
    "      "
  );

  if (fs.existsSync(targetDir)) {
    if (!quiet) {
      console.log("  Removing existing Android folder...");
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  ensureDir(targetDir);

  const packagePath = androidPackage.replace(/\./g, path.sep);
  const files = walk(templateDir);

  for (const file of files) {
    const rel = path.relative(templateDir, file);
    const targetPath = (() => {
      const javaDir = path.join("app", "src", "main", "java");
      const mainActivityPath = path.join(javaDir, "MainActivity.kt");
      const mainApplicationPath = path.join(javaDir, "MainApplication.kt");
      const modulesDir = path.join(javaDir, "modules");
      if (rel === mainActivityPath) {
        return path.join(
          targetDir,
          "app",
          "src",
          "main",
          "java",
          packagePath,
          "MainActivity.kt"
        );
      }
      if (rel === mainApplicationPath) {
        return path.join(
          targetDir,
          "app",
          "src",
          "main",
          "java",
          packagePath,
          "MainApplication.kt"
        );
      }
      if (rel.startsWith(modulesDir + path.sep)) {
        const remainder = rel.slice(modulesDir.length + 1);
        return path.join(
          targetDir,
          "app",
          "src",
          "main",
          "java",
          packagePath,
          "modules",
          remainder
        );
      }
      return path.join(targetDir, rel);
    })();

    ensureDir(path.dirname(targetPath));

    if (isBinary(file)) {
      fs.copyFileSync(file, targetPath);
    } else {
      const content = fs.readFileSync(file, "utf8");
      const processed = replacePlaceholders(content, config, {
        componentIncludes,
        componentDependencies,
        moduleImports,
        moduleInitializers,
        activityAttributes,
        splashIconDrawable,
        splashWindowBackground,
        activityHookImports,
        activityOnCreateHooks,
        activityOnFirstFrameHooks,
      });
      fs.writeFileSync(targetPath, processed, "utf8");
    }
  }

  ensureDir(path.join(targetDir, "app", "src", "main", "assets"));
  const gradlewPath = path.join(targetDir, "gradlew");
  if (fs.existsSync(gradlewPath)) {
    fs.chmodSync(gradlewPath, 0o755);
  }

  generateAssets(appDir, "android");

  if (!quiet) {
    console.log(`✅ Android project generated at ${targetDir}`);
    console.log("Next steps:");
    console.log(`  cd ${path.relative(process.cwd(), targetDir)}`);
    console.log("  ./gradlew :app:assembleDebug");
    console.log("  ./gradlew :app:installDebug");
  }
  return config;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/generate-android.js <app-path>");
    process.exit(1);
  }
  const appPath = path.resolve(args[0]);
  if (!fs.existsSync(appPath)) {
    console.error(`App directory does not exist: ${appPath}`);
    process.exit(1);
  }
  try {
    generateAndroidProject(appPath);
  } catch (err: any) {
    console.error("Error generating Android project:", err.message);
    process.exit(1);
  }
}
