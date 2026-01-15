import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";

export async function findMonorepoRoot(
  startDir: string = process.cwd()
): Promise<string> {
  let current = resolve(startDir);
  while (current !== "/") {
    try {
      const pkgPath = join(current, "package.json");
      await stat(pkgPath);
      // Simple check: usually the root package.json has "workspaces" or is the root of the repo
      // We can also check for .git, pnpm-lock.yaml, etc.
      // For this project, checking for 'packages' directory existence might be safer
      const packagesDir = join(current, "packages");
      await stat(packagesDir);
      return current;
    } catch {
      // Continue up
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not find monorepo root");
}

export async function getTemplateDir(templateName: "app") {
  const root = await findMonorepoRoot();
  const skyhookTemplate = join(root, "packages", "zynth-skyhook", "src", "templates", "basic");
  try {
    await stat(skyhookTemplate);
    return skyhookTemplate;
  } catch {
    return join(root, "packages", "zynth-templates", templateName);
  }
}

export async function getPackageDir(packageName: string) {
  const root = await findMonorepoRoot();
  // Handle scoped names like @zynth/core -> packages/zynth-core
  const cleanName = packageName.replace("@zynth/", "zynth-");
  return join(root, "packages", cleanName);
}
