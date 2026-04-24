import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

type PackageJson = {
  name?: string;
  zynthSkyhook?: { artifacts?: boolean };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

async function findMonorepoRoot(startDir: string = process.cwd()) {
  let current = resolve(startDir);
  while (current !== "/") {
    try {
      await stat(join(current, "packages"));
      await stat(join(current, "package.json"));
      return current;
    } catch {
      // keep walking up
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Could not find monorepo root.");
}

async function runYarnBundle(root: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("yarn", ["bundle"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => {
      if (code === 0) return resolvePromise();
      reject(new Error(`yarn bundle failed with exit code ${code}`));
    });
    child.on("error", reject);
  });
}

async function buildArtifacts() {
  const root = await findMonorepoRoot();
  const args = new Set(process.argv.slice(2));
  const skipBundle = args.has("--skip-bundle");
  const outputFlag = process.argv.find((arg) => arg.startsWith("--output="));
  const outputDir = outputFlag
    ? resolve(outputFlag.replace("--output=", ""))
    : join(root, "packages", "zynth-skyhook", "vendor", "prebundle");

  if (!skipBundle) {
    await runYarnBundle(root);
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const packagesDir = join(root, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const manifest: Record<string, string> = {};

  const folderNamesByPackage: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(packagesDir, entry.name);
    const pkgJsonPath = join(pkgDir, "package.json");

    let pkgJson: PackageJson;
    try {
      pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
    } catch {
      continue;
    }

    const pkgName = pkgJson.name;
    if (!pkgName) continue;
    if (pkgJson.zynthSkyhook?.artifacts === false) continue;

    const distDir = join(pkgDir, "dist");
    try {
      const distStat = await stat(distDir);
      if (!distStat.isDirectory()) continue;
    } catch {
      continue;
    }

    const folderName = pkgName.startsWith("@zynthjs/")
      ? pkgName.replace("@zynthjs/", "zynth-")
      : entry.name;
    const targetDir = join(outputDir, folderName);

    folderNamesByPackage[pkgName] = folderName;

    await mkdir(targetDir, { recursive: true });
    await cp(distDir, join(targetDir, "dist"), { recursive: true });

    const srcDir = join(pkgDir, "src");
    try {
      const srcStat = await stat(srcDir);
      if (srcStat.isDirectory()) {
        await cp(srcDir, join(targetDir, "src"), { recursive: true });
        await cp(srcDir, join(targetDir, "dist", "source"), { recursive: true });
      }
    } catch {
      // No src directory; skip.
    }

    const rewritten = rewriteInternalDeps(pkgJson, folderNamesByPackage);
    await writeFile(
      join(targetDir, "package.json"),
      JSON.stringify(rewritten, null, 2)
    );

    manifest[pkgName] = folderName;
  }

  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        packages: manifest,
      },
      null,
      2
    )
  );
}

function rewriteInternalDeps(pkgJson: PackageJson, folderMap: Record<string, string>) {
  const sections: (keyof PackageJson)[] = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ];

  const next = { ...pkgJson };

  for (const section of sections) {
    const deps = next[section];
    if (!deps) continue;
    const rewritten: Record<string, string> = { ...deps };

    for (const depName of Object.keys(rewritten)) {
      if (!depName.startsWith("@zynthjs/")) continue;
      const folderName = folderMap[depName] ?? depName.replace("@zynthjs/", "zynth-");
      rewritten[depName] = `file:../${folderName}`;
    }

    next[section] = rewritten;
  }

  return next;
}

buildArtifacts().catch((error) => {
  console.error("[skyhook] Failed to build artifacts:", error);
  process.exitCode = 1;
});
