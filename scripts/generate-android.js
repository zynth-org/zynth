#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { getAppConfig } = require("./generate-ios.js");

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

function safeReadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return null;
  }
}

function generateAndroidModuleImports(modules) {
  const imports = [];
  const packages = new Set(); // Track unique packages to avoid duplicates

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

  // Always import Log if we have initializers
  if (imports.length > 0) {
    imports.unshift("import android.util.Log");
  }

  return imports.length ? "\n" + imports.join("\n") : "";
}

function generateAndroidModuleInitializers(modules) {
  const initializers = [];
  for (const module of modules) {
    if (
      module.initializer &&
      module.initializer.className &&
      module.initializer.method
    ) {
      const className = module.initializer.className;
      const method = module.initializer.method;
      initializers.push(
        `        ${className}.${method}(this, runtime)`,
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

function replacePlaceholders(content, config, extras = {}) {
  return content
    .replace(/\{\{APP_NAME\}\}/g, config.appName)
    .replace(/\{\{APP_DIR\}\}/g, config.appDir)
    .replace(/\{\{BUNDLE_ID\}\}/g, config.bundleId)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{WORKSPACE_NAME\}\}/g, config.workspaceName || config.appName)
    .replace(
      /\{\{APP_NAME_CAP\}\}/g,
      config.appNameCapitalized || config.appName
    )
    .replace(
      /\{\{RUNE_COMPONENT_MODULE_INCLUDES\}\}/g,
      extras.componentIncludes ?? ""
    )
    .replace(
      /\{\{RUNE_COMPONENT_MODULE_DEPENDENCIES\}\}/g,
      extras.componentDependencies ?? ""
    )
    .replace(/\{\{MODULE_IMPORTS\}\}/g, extras.moduleImports ?? "")
    .replace(/\{\{MODULE_INITIALIZERS\}\}/g, extras.moduleInitializers ?? "");
}

function walk(dir) {
  const result = [];
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

function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function collectNativeAndroidModules(appDir) {
  const modulesByName = new Map();
  const appPackage = safeReadJSON(path.join(appDir, "package.json")) || {};

  function registerModules(packageName, packageDir, androidConfig) {
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

  return Array.from(modulesByName.values());
}

function formatAndroidSettingsBlock(modules, targetDir) {
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

function formatAndroidDependencyBlock(modules) {
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

function generateAndroidProject(appDir, options = {}) {
  const { dev = true } = options; // Default to dev mode for backward compatibility
  const baseConfig = getAppConfig(appDir);
  const androidPackage = (
    baseConfig.bundleId || `com.rune.${baseConfig.appDir.replace(/-/g, "")}`
  ).toLowerCase();
  const config = {
    ...baseConfig,
    bundleId: androidPackage,
  };

  console.log(`Generating Android project for ${config.displayName}...`);
  console.log(`  Package: ${androidPackage}`);
  console.log(`  Mode: ${dev ? "Development" : "Production"}`);

  const componentModules = collectNativeAndroidModules(appDir);
  if (componentModules.length) {
    console.log("  Native component modules:");
    componentModules.forEach((module) => {
      console.log(`    • ${module.name} (${module.packageName})`);
    });
  } else {
    console.log("  Native component modules: none detected");
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

  if (fs.existsSync(targetDir)) {
    console.log("  Removing existing Android folder...");
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
      });
      fs.writeFileSync(targetPath, processed, "utf8");
    }
  }

  ensureDir(path.join(targetDir, "app", "src", "main", "assets"));
  const gradlewPath = path.join(targetDir, "gradlew");
  if (fs.existsSync(gradlewPath)) {
    fs.chmodSync(gradlewPath, 0o755);
  }

  console.log(`✅ Android project generated at ${targetDir}`);
  console.log("Next steps:");
  console.log(`  cd ${path.relative(process.cwd(), targetDir)}`);
  console.log("  ./gradlew :app:assembleDebug");
  console.log("  ./gradlew :app:installDebug");
  return config;
}

function main() {
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
  } catch (err) {
    console.error("Error generating Android project:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { generateAndroidProject };
