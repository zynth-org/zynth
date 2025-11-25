#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const prompts = require("prompts");
const chalk = require("chalk");

interface Args {
  name: string | null;
  description: string | null;
  basePath: string | null;
}

interface Replacements {
  moduleName: string;
  moduleNamePascal: string;
  moduleNameUpper: string;
  moduleDescription: string;
}

function readJSON(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = readJSON(pkgPath);
      if (pkg.workspaces) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(
        "Workspace root not found. Run this command inside a Rune workspace."
      );
    }
    current = parent;
  }
}

function normalizeModuleName(input: string | null | undefined): string {
  if (!input) return "";
  let name = String(input).trim();
  if (name.startsWith("@rune/")) {
    name = name.slice("@rune/".length);
  }
  if (name.startsWith("rune-")) {
    name = name.slice("rune-".length);
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

function isValidModuleName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name);
}

function toPascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toScreamingSnake(name: string): string {
  return name.replace(/[-\s]+/g, "_").toUpperCase();
}

function applyTemplate(content: string, replacements: Replacements): string {
  return content
    .replace(/\{\{MODULE_NAME\}\}/g, replacements.moduleName)
    .replace(/\{\{MODULE_NAME_PASCAL\}\}/g, replacements.moduleNamePascal)
    .replace(/\{\{MODULE_NAME_UPPER\}\}/g, replacements.moduleNameUpper)
    .replace(/\{\{MODULE_DESCRIPTION\}\}/g, replacements.moduleDescription);
}

function collectPaths(dir: string, entries: string[] = []): string[] {
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

function replaceInFiles(
  files: string[],
  replacements: Replacements,
  androidPackageName: string
): void {
  for (const filePath of files) {
    if (!fs.statSync(filePath).isFile()) continue;
    let content = fs.readFileSync(filePath, "utf8");
    content = applyTemplate(content, replacements);
    if (androidPackageName !== replacements.moduleName) {
      content = content.replace(
        new RegExp(`dev\\.rune\\.${replacements.moduleName}`, "g"),
        `dev.rune.${androidPackageName}`
      );
      content = content.replace(
        new RegExp(`dev/rune/${replacements.moduleName}`, "g"),
        `dev/rune/${androidPackageName}`
      );
    }
    fs.writeFileSync(filePath, content);
  }
}

function renameTemplatePaths(paths: string[], replacements: Replacements): void {
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
  targetDir: string,
  moduleNamePascal: string,
  moduleName: string,
  androidPackageName: string
): void {
  if (moduleName === androidPackageName) return;
  const current = path.join(
    targetDir,
    "android",
    `Rune${moduleNamePascal}`,
    "src",
    "main",
    "java",
    "dev",
    "rune",
    moduleName
  );
  const next = path.join(
    targetDir,
    "android",
    `Rune${moduleNamePascal}`,
    "src",
    "main",
    "java",
    "dev",
    "rune",
    androidPackageName
  );
  if (fs.existsSync(current) && !fs.existsSync(next)) {
    fs.renameSync(current, next);
  }
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const result: Args = { name: null, description: null, basePath: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--name" || arg === "-n") {
      result.name = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--description" || arg === "-d") {
      result.description = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--path" || arg === "-p") {
      result.basePath = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && !result.name) {
      result.name = arg;
      continue;
    }
  }
  return result;
}

function updateTsconfigPaths(rootDir: string, moduleName: string): void {
  const tsconfigPath = path.join(rootDir, "tsconfig.base.json");
  if (!fs.existsSync(tsconfigPath)) return;

  const tsconfig = readJSON(tsconfigPath);
  if (!tsconfig.compilerOptions) tsconfig.compilerOptions = {};
  if (!tsconfig.compilerOptions.paths) tsconfig.compilerOptions.paths = {};

  const paths = tsconfig.compilerOptions.paths as Record<string, string[]>;
  const baseKey = `@rune/${moduleName}`;
  const baseValue = [`packages/rune-${moduleName}/src/index.ts`];
  const globKey = `@rune/${moduleName}/*`;
  const globValue = [`packages/rune-${moduleName}/src/*`];

  let changed = false;
  if (!paths[baseKey]) {
    paths[baseKey] = baseValue;
    changed = true;
  }
  if (!paths[globKey]) {
    paths[globKey] = globValue;
    changed = true;
  }

  if (!changed) return;

  const sortedEntries = Object.entries(paths).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  tsconfig.compilerOptions.paths = Object.fromEntries(sortedEntries);

  fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
}

async function main(): Promise<void> {
  const { name, description, basePath } = parseArgs(process.argv);
  const root = findWorkspaceRoot(process.cwd());
  const packagesDir = path.join(root, "packages");
  const templatesDir = path.join(
    root,
    "packages",
    "rune-templates",
    "native-module"
  );

  if (!fs.existsSync(templatesDir)) {
    console.error(chalk.red("[x] Template not found:"), templatesDir);
    process.exit(1);
  }

  const baseDir = basePath ? path.resolve(basePath) : packagesDir;
  if (!fs.existsSync(baseDir)) {
    console.error(chalk.red("[x] Base path does not exist:"), baseDir);
    process.exit(1);
  }

  let moduleName = normalizeModuleName(name);
  if (!moduleName) {
    const response = await prompts({
      type: "text",
      name: "moduleName",
      message: "Package name (kebab-case, without @rune/ or rune-):",
      validate: (value: string) => {
        const normalized = normalizeModuleName(value);
        if (!normalized) return "Package name is required";
        if (!isValidModuleName(normalized)) {
          return "Use lowercase letters, numbers, and dashes only";
        }
        return true;
      },
    });
    moduleName = normalizeModuleName(response.moduleName);
  }

  if (!moduleName || !isValidModuleName(moduleName)) {
    console.error(chalk.red("[x] Invalid package name."));
    process.exit(1);
  }

  const moduleNamePascal = toPascalCase(moduleName);
  const moduleNameUpper = toScreamingSnake(moduleName);
  const androidPackageName = moduleName.replace(/-/g, "");

  let moduleDescription = description;
  if (!moduleDescription) {
    const response = await prompts({
      type: "text",
      name: "moduleDescription",
      message: "Short description:",
      initial: `${moduleNamePascal} native module`,
    });
    moduleDescription = response.moduleDescription;
  }

  if (!moduleDescription) {
    console.error(chalk.red("[x] Description is required."));
    process.exit(1);
  }

  const packageDirName = `rune-${moduleName}`;
  const targetDir = path.join(baseDir, packageDirName);

  if (fs.existsSync(targetDir)) {
    console.error(chalk.red("[x] Directory already exists:"), targetDir);
    process.exit(1);
  }

  console.log(chalk.cyan("[+] Creating package"), chalk.gray(packageDirName));

  fs.cpSync(templatesDir, targetDir, { recursive: true });

  const replacements: Replacements = {
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
  updateTsconfigPaths(root, moduleName);

  console.log(chalk.green("[OK] Package created:"), targetDir);
  console.log(chalk.cyan("[i] Next steps:"));
  console.log("  - yarn sync-aliases");
  console.log("  - yarn build");
}

main().catch((error: Error) => {
  console.error(chalk.red("[x]"), error.stack || error.message);
  process.exit(1);
});
