import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getTemplateDir } from "../utils/paths.js";

interface ProjectInfo {
  name: string;
  slug: string;
}

export async function createProjectWorkspace(
  targetDir: string,
  projectInfo: ProjectInfo
) {
  const templateDir = await getTemplateDir("app");

  // 1. Copy template
  await cp(templateDir, targetDir, { recursive: true });

  // 2. Generate src/index.tsx and src/App.tsx
  const srcDir = join(targetDir, "src");
  await mkdir(srcDir, { recursive: true });

  await writeFile(
    join(srcDir, "index.tsx"),
    `import { start } from "@rune/core";
import App from "./App";

start(App);`
  );

  await writeFile(
    join(srcDir, "App.tsx"),
    `import { View, Text } from "@rune/components";

export default function App() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Welcome to Rune</Text>
    </View>
  );
}`
  );

  // 3. Update app.json
  const appJsonPath = join(targetDir, "app.json");
  const appJsonRaw = await readFile(appJsonPath, "utf-8");
  const appJson = JSON.parse(appJsonRaw);

  appJson.name = projectInfo.name;
  appJson.slug = projectInfo.slug;
  if (!appJson.rune) appJson.rune = {};
  appJson.rune.name = projectInfo.name;
  appJson.rune.slug = projectInfo.slug;

  await writeFile(appJsonPath, JSON.stringify(appJson, null, 2));

  // 4. Update package.json
  const packageJsonPath = join(targetDir, "package.json");
  const packageJsonRaw = await readFile(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(packageJsonRaw);
  packageJson.name = projectInfo.slug;
  await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

  return targetDir;
}

let artifactsPromise: Promise<Record<string, string>> | null = null;

export async function ensureSharedArtifacts(customCacheDir?: string) {
  if (artifactsPromise) return artifactsPromise;

  artifactsPromise = (async () => {
    const stagedMap: Record<string, string> = {};
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const defaultArtifactsDir = resolve(
      currentDir,
      "..",
      "..",
      "vendor",
      "prebundle"
    );
    const artifactsDir =
      customCacheDir ??
      process.env.SKYHOOK_ARTIFACTS_DIR ??
      defaultArtifactsDir;

    try {
      await stat(artifactsDir);
    } catch (error) {
      throw new Error(
        `[skyhook] Shared artifacts not found at ${artifactsDir}. Run the prebundle step before starting the server.`
      );
    }

    const entries = await readdir(artifactsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pkgDir = join(artifactsDir, entry.name);
      const pkgJsonPath = join(pkgDir, "package.json");

      let pkgJson: { name?: string };
      try {
        pkgJson = JSON.parse(await readFile(pkgJsonPath, "utf-8"));
      } catch {
        continue;
      }

      const pkgName = pkgJson.name;
      if (!pkgName) continue;

      const distDir = join(pkgDir, "dist");
      try {
        const distStat = await stat(distDir);
        if (!distStat.isDirectory()) continue;
      } catch {
        continue;
      }

      stagedMap[pkgName] = pkgDir;
    }

    return stagedMap;
  })();

  return artifactsPromise;
}
