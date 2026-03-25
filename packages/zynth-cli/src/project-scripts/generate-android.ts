import * as fs from 'fs';
import * as path from 'path';
import { getAppConfig, safeReadJSON, AppConfig } from './config-utils';
import { generateAssets } from "./generate-assets";

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

const templatesRoot = path.resolve(__dirname, "..", "templates");
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
        `        Log.d("Zynth", "${className} initialized")`
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

  // Default configChanges to prevent activity restarts
  const configChanges = androidConfig?.configChanges || "keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode";
  attributes.push(`android:configChanges="${configChanges}"`);

  // Default launchMode to singleTask to ensure the app resumes from the icon
  const launchMode = androidConfig?.launchMode || "singleTask";
  attributes.push(`android:launchMode="${launchMode}"`);

  // Add generic attributes if provided in 'activityAttributes' map
  if (androidConfig?.activityAttributes) {
    for (const [key, value] of Object.entries(androidConfig.activityAttributes)) {
      if (key !== "android:configChanges" && key !== "configChanges") {
         attributes.push(`${key}="${value}"`);
      }
    }
  }

  return attributes.join("\n            ");
}

function formatApplicationAttributes(androidConfig: any, dev: boolean): string {
  const attributes: string[] = [];

  const usesCleartextTraffic =
    typeof androidConfig?.usesCleartextTraffic === "boolean"
      ? androidConfig.usesCleartextTraffic
      : dev;

  const hasCustomNetworkSecurityConfig =
    androidConfig?.applicationAttributes &&
    typeof androidConfig.applicationAttributes === "object" &&
    Object.keys(androidConfig.applicationAttributes).some(
      (key) => key === "android:networkSecurityConfig" || key === "networkSecurityConfig"
    );

  attributes.push(`android:usesCleartextTraffic="${usesCleartextTraffic ? "true" : "false"}"`);

  if (usesCleartextTraffic && !hasCustomNetworkSecurityConfig) {
    attributes.push('android:networkSecurityConfig="@xml/network_security_config"');
  }

  if (androidConfig?.applicationAttributes) {
    for (const [key, value] of Object.entries(androidConfig.applicationAttributes)) {
      const normalizedKey = key.startsWith("android:") ? key : `android:${key}`;
      if (
        normalizedKey === "android:usesCleartextTraffic" ||
        normalizedKey === "android:networkSecurityConfig"
      ) {
        continue;
      }
      attributes.push(`${normalizedKey}="${escapeXml(String(value))}"`);
    }
  }

  return attributes.join("\n        ");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatActivityIntentFilters(androidConfig: any): string {
  const filters = Array.isArray(androidConfig?.intentFilters)
    ? androidConfig.intentFilters
    : [];
  if (!filters.length) {
    return "";
  }

  const blocks: string[] = [];
  for (const filter of filters) {
    const actions: string[] = Array.isArray(filter?.actions) && filter.actions.length
      ? filter.actions
      : ["android.intent.action.VIEW"];
    const categories: string[] = Array.isArray(filter?.categories) && filter.categories.length
      ? filter.categories
      : ["android.intent.category.DEFAULT", "android.intent.category.BROWSABLE"];
    const dataList: any[] = Array.isArray(filter?.data)
      ? filter.data
      : filter?.data
        ? [filter.data]
        : [];

    const block: string[] = [];
    const autoVerifyAttr = filter?.autoVerify === true ? ' android:autoVerify="true"' : "";
    block.push(`            <intent-filter${autoVerifyAttr}>`);

    for (const action of actions) {
      if (typeof action !== "string" || !action.trim()) continue;
      block.push(`                <action android:name="${escapeXml(action.trim())}" />`);
    }

    for (const category of categories) {
      if (typeof category !== "string" || !category.trim()) continue;
      block.push(`                <category android:name="${escapeXml(category.trim())}" />`);
    }

    for (const dataItem of dataList) {
      if (!dataItem || typeof dataItem !== "object") continue;
      const attrs: string[] = [];
      for (const key of [
        "scheme",
        "host",
        "port",
        "path",
        "pathPrefix",
        "pathPattern",
        "mimeType",
      ]) {
        const raw = dataItem[key];
        if (typeof raw === "string" && raw.trim()) {
          attrs.push(`android:${key}="${escapeXml(raw.trim())}"`);
        }
      }
      if (attrs.length > 0) {
        block.push(`                <data ${attrs.join(" ")} />`);
      }
    }

    block.push("            </intent-filter>");
    blocks.push(block.join("\n"));
  }

  return blocks.length ? `\n${blocks.join("\n")}` : "";
}

function formatAndroidPermissions(androidConfig: any): string {
  const permissions = Array.isArray(androidConfig?.permissions)
    ? androidConfig.permissions
    : [];
  if (!permissions.length) {
    return "";
  }

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const entry of permissions) {
    if (typeof entry === "string") {
      const permission = entry.trim();
      if (!permission) continue;
      const key = `${permission}|`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`    <uses-permission android:name="${escapeXml(permission)}" />`);
      continue;
    }

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const name =
      typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      continue;
    }

    const attrs = [`android:name="${escapeXml(name)}"`];
    if (typeof entry.maxSdkVersion === "number" && Number.isFinite(entry.maxSdkVersion)) {
      attrs.push(`android:maxSdkVersion="${Math.round(entry.maxSdkVersion)}"`);
    }
    if (typeof entry.minSdkVersion === "number" && Number.isFinite(entry.minSdkVersion)) {
      attrs.push(`android:minSdkVersion="${Math.round(entry.minSdkVersion)}"`);
    }
    if (typeof entry.usesPermissionFlags === "string" && entry.usesPermissionFlags.trim()) {
      attrs.push(`android:usesPermissionFlags="${escapeXml(entry.usesPermissionFlags.trim())}"`);
    }

    const key = attrs.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`    <uses-permission ${attrs.join(" ")} />`);
  }

  return lines.length ? `\n${lines.join("\n")}` : "";
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
      /\{\{\s*ZYNTH_COMPONENT_MODULE_INCLUDES\s*\}\}/g,
      extras.componentIncludes ?? ""
    )
    .replace(
      /\{\{\s*ZYNTH_COMPONENT_MODULE_DEPENDENCIES\s*\}\}/g,
      extras.componentDependencies ?? ""
    )
    .replace(
      /\{\{\s*ZYNTH_ANDROID_RUNTIME_PACKAGE\s*\}\}/g,
      extras.androidRuntimePackage ?? "@zynth/core"
    )
    .replace(
      /\{\{\s*ZYNTH_ANDROID_RUNTIME_SUBDIR\s*\}\}/g,
      extras.androidRuntimeSubdir ?? "android/ZynthKit"
    )
    .replace(/\{\{\s*MODULE_IMPORTS\s*\}\}/g, extras.moduleImports ?? "")
    .replace(/\{\{\s*MODULE_INITIALIZERS\s*\}\}/g, extras.moduleInitializers ?? "")
    .replace(
      /\{\{\s*RUNTIME_MODULE_IMPORTS\s*\}\}/g,
      extras.runtimeModuleImports ?? ""
    )
    .replace(
      /\{\{\s*RUNTIME_MODULE_INSTALLS\s*\}\}/g,
      extras.runtimeModuleInstalls ?? ""
    )
    .replace(
      /\{\{\s*ZYNTH_DEV_SERVER_URL\s*\}\}/g,
      extras.devServerUrlBuildConfig ?? "\"\""
    )
    .replace(
      /\{\{\s*ZYNTH_DEV_SERVER_TOKEN\s*\}\}/g,
      extras.devServerTokenBuildConfig ?? "\"\""
    )
    .replace(
      /\{\{\s*ZYNTH_STARTUP_METRICS_ENABLED\s*\}\}/g,
      extras.startupMetricsEnabledBuildConfig ?? "false"
    )
    .replace(/\{\{\s*ACTIVITY_ATTRIBUTES\s*\}\}/g, extras.activityAttributes ?? "")
    .replace(
      /\{\{\s*APPLICATION_ATTRIBUTES\s*\}\}/g,
      extras.applicationAttributes ?? ""
    )
    .replace(
      /\{\{\s*ACTIVITY_INTENT_FILTERS\s*\}\}/g,
      extras.activityIntentFilters ?? ""
    )
    .replace(
      /\{\{\s*ANDROID_USES_PERMISSIONS\s*\}\}/g,
      extras.androidUsesPermissions ?? ""
    )
    .replace(
      /\{\{\s*APP_ICON_DRAWABLE\s*\}\}/g,
      extras.appIconDrawable ?? "@android:drawable/sym_def_app_icon"
    )
    .replace(
      /\{\{\s*APP_ROUND_ICON_DRAWABLE\s*\}\}/g,
      extras.appRoundIconDrawable ?? "@android:drawable/sym_def_app_icon"
    )
    .replace(
      /\{\{\s*SPLASH_ICON_DRAWABLE\s*\}\}/g,
      extras.splashIconDrawable ?? "@android:drawable/sym_def_app_icon"
    )
    .replace(
      /\{\{\s*SPLASH_WINDOW_BACKGROUND\s*\}\}/g,
      extras.splashWindowBackground ?? "@drawable/zynth_splash_screen"
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

function toBuildConfigStringLiteral(value: string): string {
  // AGP buildConfigField expects a Java expression. For String fields this must be
  // a quoted Java string literal (e.g. "\"value\""), including when empty.
  return JSON.stringify(JSON.stringify(value));
}

function collectNativeAndroidModules(appDir: string): any[] {
  const modulesByName = new Map();
  const appPackage = safeReadJSON(path.join(appDir, "package.json")) || {};
  const excludedModules = new Set<string>(
    appPackage?.zynthNative?.android?.excludeModules || []
  );

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
      if (excludedModules.has(module.name)) continue;
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

  if (appPackage.zynthNative && appPackage.zynthNative.android) {
    registerModules(
      appPackage.name || "(app)",
      appDir,
      appPackage.zynthNative.android
    );
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
        if (depPackage.zynthNative && depPackage.zynthNative.android) {
          registerModules(depName, packageDir, depPackage.zynthNative.android);
        }
      } catch (_error) {
        // Dependency might not provide native modules; ignore resolution errors
      }
    }
  }

  const appModules = collectAppModules();
  for (const module of appModules) {
    if (module.packageJson?.zynthNative?.android) {
      registerModules(
        module.packageName,
        module.packageDir,
        module.packageJson.zynthNative.android
      );
    }
  }

  return Array.from(modulesByName.values());
}

function collectAndroidGradleProjects(appDir: string): any[] {
  const projectsByName = new Map<string, { name: string; directoryPath: string; packageName: string }>();
  const appPackage = safeReadJSON(path.join(appDir, "package.json")) || {};
  const excludedProjects = new Set<string>(
    appPackage?.zynthNative?.android?.excludeProjects || []
  );

  function registerProjects(packageName: string, packageDir: string, androidConfig: any) {
    if (!androidConfig || !Array.isArray(androidConfig.gradleProjects)) return;
    for (const project of androidConfig.gradleProjects) {
      if (!project || !project.name) continue;
      if (excludedProjects.has(project.name)) continue;
      let baseDir = packageDir;
      if (project.package) {
        const resolved = resolvePackageJson(project.package, appDir);
        if (resolved) {
          baseDir = path.dirname(resolved);
        }
      }
      const directoryPath = project.path
        ? path.resolve(baseDir, project.path)
        : baseDir;
      projectsByName.set(project.name, {
        name: project.name,
        packageName,
        directoryPath,
      });
    }
  }

  if (appPackage.zynthNative && appPackage.zynthNative.android) {
    registerProjects(appPackage.name || "(app)", appDir, appPackage.zynthNative.android);
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
        if (depPackage.zynthNative && depPackage.zynthNative.android) {
          registerProjects(depName, packageDir, depPackage.zynthNative.android);
        }
      } catch (_error) {
        // Dependency might not provide gradle projects; ignore resolution errors
      }
    }
  }

  const modulesDir = path.join(appDir, "modules");
  if (fs.existsSync(modulesDir)) {
    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packageDir = path.join(modulesDir, entry.name);
      const packageJsonPath = path.join(packageDir, "package.json");
      if (!fs.existsSync(packageJsonPath)) continue;
      const packageJson = safeReadJSON(packageJsonPath);
      if (!packageJson?.zynthNative?.android) continue;
      registerProjects(packageJson.name || entry.name, packageDir, packageJson.zynthNative.android);
    }
  }

  return Array.from(projectsByName.values());
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

  if (appPackage.zynthNative && appPackage.zynthNative.android) {
    registerHooks(appPackage.zynthNative.android);
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
        const depPackage = safeReadJSON(pkgJsonPath);
        if (!depPackage || !depPackage.zynthNative?.android) continue;
        registerHooks(depPackage.zynthNative.android);
      } catch (_error) {
        // Ignore resolution failures.
      }
    }
  }

  const appModules = collectAppModules();
  for (const module of appModules) {
    if (!module.packageJson?.zynthNative?.android) continue;
    registerHooks(module.packageJson.zynthNative.android);
  }

  return hooks;
}

function formatHookBlock(lines: string[], indent: string): string {
  if (!lines.length) return "";
  return lines.map((line) => `${indent}${line}`).join("\n");
}

function formatAndroidSettingsBlock(modules: any[], targetDir: string): string {
  if (!modules.length) {
    return "\n// No additional Zynth component modules detected";
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
  const androidRuntimePackage = "@zynth/core";
  const androidRuntimeSubdir = "android/ZynthKit";
  const baseConfig = getAppConfig(appDir);
  const androidPackage = (
    baseConfig.bundleId || `com.zynth.${baseConfig.appDir.replace(/-/g, "")}`
  ).toLowerCase();
  const config = {
    ...baseConfig,
    bundleId: androidPackage,
  };

  if (!quiet) {
    console.log(`Generating Android project for ${config.displayName}...`);
    console.log(`  Package: ${androidPackage}`);
    console.log(`  Mode: ${dev ? "Development" : "Production"}`);
    console.log("  Runtime: Core");
  }

  const componentModules = collectNativeAndroidModules(appDir);
  const gradleProjects = collectAndroidGradleProjects(appDir);
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
  const settingsProjects = new Map<string, any>();
  for (const module of componentModules) {
    settingsProjects.set(module.name, module);
  }
  for (const project of gradleProjects) {
    if (!settingsProjects.has(project.name)) {
      settingsProjects.set(project.name, project);
    }
  }
  const componentIncludes = formatAndroidSettingsBlock(
    Array.from(settingsProjects.values()),
    targetDir
  );
  const componentDependencies = formatAndroidDependencyBlock(componentModules);
  const moduleImports = generateAndroidModuleImports(componentModules);
  const moduleInitializers =
    generateAndroidModuleInitializers(componentModules);
  const activityAttributes = formatActivityAttributes(baseConfig.androidConfig);
  const applicationAttributes = formatApplicationAttributes(baseConfig.androidConfig, dev);
  const activityIntentFilters = formatActivityIntentFilters(baseConfig.androidConfig);
  const androidUsesPermissions = formatAndroidPermissions(baseConfig.androidConfig);
  const appJsonPath = path.join(appDir, "app.json");
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
      appConfig = json.zynth || json;
    } catch {
      appConfig = {};
    }
  }
  const legacyIconPath = typeof appConfig.icon === "string"
    ? path.resolve(appDir, appConfig.icon)
    : "";
  const adaptiveForegroundPath = typeof appConfig.android?.adaptiveIcon?.foregroundImage === "string"
    ? path.resolve(appDir, appConfig.android.adaptiveIcon.foregroundImage)
    : "";
  const hasLauncherIcons = Boolean(
    (legacyIconPath && fs.existsSync(legacyIconPath))
      || (adaptiveForegroundPath && fs.existsSync(adaptiveForegroundPath))
  );
  const appIconDrawable = hasLauncherIcons
    ? "@mipmap/ic_launcher"
    : "@android:drawable/sym_def_app_icon";
  const appRoundIconDrawable = hasLauncherIcons
    ? "@mipmap/ic_launcher_round"
    : "@android:drawable/sym_def_app_icon";
  const splashIconDrawable = hasLauncherIcons
    ? "@mipmap/ic_launcher"
    : "@android:drawable/sym_def_app_icon";
  const splashWindowBackground = "@drawable/zynth_splash_screen";
  const activityHooks = collectAndroidActivityHooks(appDir);
  const activityHookImports = formatHookBlock(activityHooks.imports, "");
  const activityOnCreateHooks = formatHookBlock(activityHooks.onCreate, "    ");
  const activityOnFirstFrameHooks = formatHookBlock(
    activityHooks.onFirstFrame,
    "      "
  );
  const devServerUrlBuildConfig = toBuildConfigStringLiteral(
    typeof config.devServerUrl === "string" ? config.devServerUrl : ""
  );
  const devArtifacts = safeReadJSON(path.join(appDir, ".zynth", "artifacts.json")) || {};
  const devServerTokenBuildConfig = toBuildConfigStringLiteral(
    typeof devArtifacts.hmrServerToken === "string" ? devArtifacts.hmrServerToken : ""
  );
  const startupMetricsEnabledBuildConfig = config.androidStartupMetricsEnabled
    ? "\"true\""
    : "\"false\"";
  const runtimeModuleImports = "";
  const runtimeModuleInstalls = "    // No default modules for core runtime";
  const skipLegacyModules = true;

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
    const modulesDir = path.join("app", "src", "main", "java", "modules");
    if (skipLegacyModules && rel.startsWith(modulesDir + path.sep)) {
      continue;
    }
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
        applicationAttributes,
        activityAttributes,
        activityIntentFilters,
        androidUsesPermissions,
        appIconDrawable,
        appRoundIconDrawable,
        splashIconDrawable,
        splashWindowBackground,
        activityHookImports,
        activityOnCreateHooks,
        activityOnFirstFrameHooks,
        androidRuntimePackage,
        androidRuntimeSubdir,
        runtimeModuleImports,
        runtimeModuleInstalls,
        devServerUrlBuildConfig,
        devServerTokenBuildConfig,
        startupMetricsEnabledBuildConfig,
      });
      fs.writeFileSync(targetPath, processed, "utf8");
    }
  }

  ensureDir(path.join(targetDir, "app", "src", "main", "assets"));
  const gradlewPath = path.join(targetDir, "gradlew");
  if (fs.existsSync(gradlewPath)) {
    fs.chmodSync(gradlewPath, 0o755);
  }

  generateAssets(appDir, "android", dev);

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
