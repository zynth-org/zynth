const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const chalk = require("chalk");
const { findAppDirectory, readJSON } = require("../utils");

function resolveModuleTemplateDir() {
  return path.join(__dirname, "..", "templates", "app-module");
}

function normalizeModuleName(input) {
  if (!input) return "";
  let name = String(input).trim();
  if (name.startsWith("@zynth/")) {
    name = name.slice("@zynth/".length);
  }
  if (name.startsWith("zynth-")) {
    name = name.slice("zynth-".length);
  }
  name = name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  return name;
}

function isValidModuleName(name) {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

function toPascalCase(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toScreamingSnake(name) {
  return name.replace(/[-\s]+/g, "_").toUpperCase();
}

function applyTemplate(content, replacements) {
  return content
    .replace(/\{\{MODULE_NAME\}\}/g, replacements.moduleName)
    .replace(/\{\{MODULE_NAME_PASCAL\}\}/g, replacements.moduleNamePascal)
    .replace(/\{\{MODULE_NAME_UPPER\}\}/g, replacements.moduleNameUpper)
    .replace(/\{\{MODULE_DESCRIPTION\}\}/g, replacements.moduleDescription);
}

function collectPaths(dir, entries = []) {
  const dirEntries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of dirEntries) {
    const fullPath = path.join(dir, entry.name);
    entries.push(fullPath);
    if (entry.isDirectory()) {
      collectPaths(fullPath, entries);
    }
  }
  return entries;
}

function replaceInFiles(files, replacements, androidPackageName) {
  for (const filePath of files) {
    if (!fs.statSync(filePath).isFile()) continue;
    let content = fs.readFileSync(filePath, "utf8");
    content = applyTemplate(content, replacements);
    if (androidPackageName !== replacements.moduleName) {
      content = content.replace(
        new RegExp(`dev\\.zynth\\.${replacements.moduleName}`, "g"),
        `dev.zynth.${androidPackageName}`
      );
      content = content.replace(
        new RegExp(`dev/zynth/${replacements.moduleName}`, "g"),
        `dev/zynth/${androidPackageName}`
      );
    }
    fs.writeFileSync(filePath, content);
  }
}

function renameTemplatePaths(paths, replacements) {
  const sorted = [...paths].sort((a, b) => b.length - a.length);
  for (const currentPath of sorted) {
    const baseName = path.basename(currentPath);
    const renamedBase = applyTemplate(baseName, replacements);
    if (baseName === renamedBase) continue;
    const newPath = path.join(path.dirname(currentPath), renamedBase);
    if (!fs.existsSync(currentPath)) continue;
    fs.renameSync(currentPath, newPath);
  }
}

function renameAndroidPackageDir(
  targetDir,
  moduleNamePascal,
  moduleName,
  androidPackageName
) {
  if (moduleName === androidPackageName) return;
  const current = path.join(
    targetDir,
    "android",
    `Zynth${moduleNamePascal}`,
    "src",
    "main",
    "java",
    "dev",
    "zynth",
    moduleName
  );
  const next = path.join(
    targetDir,
    "android",
    `Zynth${moduleNamePascal}`,
    "src",
    "main",
    "java",
    "dev",
    "zynth",
    androidPackageName
  );
  if (fs.existsSync(current) && !fs.existsSync(next)) {
    fs.renameSync(current, next);
  }
}

async function createNewModule(argv) {
  const appDir = argv.app
    ? path.resolve(process.cwd(), argv.app)
    : findAppDirectory(process.cwd());
  const templatesDir = resolveModuleTemplateDir();

  if (!fs.existsSync(templatesDir)) {
    console.error(chalk.red("[x] Template not found:"), templatesDir);
    process.exit(1);
  }

  let moduleName = normalizeModuleName(argv.name);
  if (!moduleName) {
    const response = await prompts({
      type: "text",
      name: "moduleName",
      message: "Module name (kebab-case):",
      validate: (value) => {
        const normalized = normalizeModuleName(value);
        if (!normalized) return "Module name is required";
        if (!isValidModuleName(normalized)) {
          return "Use lowercase letters, numbers, and dashes only";
        }
        return true;
      },
    });
    moduleName = normalizeModuleName(response.moduleName);
  }

  if (!moduleName || !isValidModuleName(moduleName)) {
    console.error(chalk.red("[x] Invalid module name."));
    process.exit(1);
  }

  const moduleNamePascal = toPascalCase(moduleName);
  const moduleNameUpper = toScreamingSnake(moduleName);
  const androidPackageName = moduleName.replace(/-/g, "");

  let moduleDescription = argv.description;
  if (!moduleDescription) {
    const response = await prompts({
      type: "text",
      name: "moduleDescription",
      message: "Short description:",
      initial: `${moduleNamePascal} app module`,
    });
    moduleDescription = response.moduleDescription;
  }

  if (!moduleDescription) {
    console.error(chalk.red("[x] Description is required."));
    process.exit(1);
  }

  const modulesDir = path.join(appDir, "modules");
  const targetDir = path.join(modulesDir, moduleName);

  if (fs.existsSync(targetDir)) {
    console.error(chalk.red("[x] Directory already exists:"), targetDir);
    process.exit(1);
  }

  fs.mkdirSync(modulesDir, { recursive: true });
  console.log(
    chalk.cyan("[+] Creating app module"),
    chalk.gray(path.relative(process.cwd(), targetDir))
  );

  fs.cpSync(templatesDir, targetDir, { recursive: true });

  const replacements = {
    moduleName,
    moduleNamePascal,
    moduleNameUpper,
    moduleDescription,
  };

  const paths = collectPaths(targetDir);
  replaceInFiles(paths, replacements, androidPackageName);
  renameTemplatePaths(paths, replacements);
  renameAndroidPackageDir(
    targetDir,
    moduleNamePascal,
    moduleName,
    androidPackageName
  );

  await ensureModuleAlias(appDir);

  console.log(chalk.green("[OK] Module created:"), targetDir);
  console.log(chalk.cyan("[i] Next steps:"));
  console.log("  - run `yarn zynth bootstrap ios` or `yarn zynth bootstrap android`");
}

async function ensureModuleAlias(appDir) {
  const tsconfigPath = path.join(appDir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return;

  let tsconfig;
  try {
    tsconfig = readJSON(tsconfigPath);
  } catch {
    return;
  }

  const aliasKey = "@modules/*";
  const aliasValue = ["modules/*/src"];

  const topLevelPaths =
    tsconfig && typeof tsconfig === "object" ? tsconfig.paths : null;
  const compilerPaths =
    tsconfig &&
    typeof tsconfig === "object" &&
    tsconfig.compilerOptions &&
    typeof tsconfig.compilerOptions === "object"
      ? tsconfig.compilerOptions.paths
      : null;

  const existing =
    (topLevelPaths && topLevelPaths[aliasKey]) ||
    (compilerPaths && compilerPaths[aliasKey]);
  if (Array.isArray(existing) && existing.join("|") === aliasValue.join("|")) {
    return;
  }

  const response = await prompts({
    type: "confirm",
    name: "addAlias",
    message:
      "Add @modules/* path alias to app tsconfig.json for module imports?",
    initial: true,
  });

  if (!response.addAlias) return;

  if (topLevelPaths && typeof topLevelPaths === "object") {
    tsconfig.paths = { ...topLevelPaths, [aliasKey]: aliasValue };
  } else if (compilerPaths && typeof compilerPaths === "object") {
    tsconfig.compilerOptions.paths = {
      ...compilerPaths,
      [aliasKey]: aliasValue,
    };
  } else {
    tsconfig.paths = { [aliasKey]: aliasValue };
  }

  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  console.log(chalk.green("[OK] Added @modules/* alias to tsconfig.json"));
}

module.exports = {
  command: "new-module [name]",
  describe: "Create a new app-scoped native module (alias: zynth create module)",
  builder: (yargs) => {
    yargs
      .positional("name", {
        describe: "Module name (kebab-case)",
        type: "string",
      })
      .option("app", {
        alias: "a",
        type: "string",
        description: "Explicit app directory",
      })
      .option("description", {
        alias: "d",
        type: "string",
        description: "Module description",
      });
  },
  handler: (argv) => {
    createNewModule(argv).catch((err) => {
      console.error(chalk.red(err.stack));
      process.exit(1);
    });
  },
};
