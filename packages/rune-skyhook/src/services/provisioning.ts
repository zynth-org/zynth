import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getPackageDir, getTemplateDir } from "../utils/paths.js";

interface ProjectInfo {
  name: string;
  slug: string;
}

export async function createProjectWorkspace(targetDir: string, projectInfo: ProjectInfo) {
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

import { tmpdir } from "node:os";

const INTERNAL_PACKAGES = [
  "@rune/core",
  "@rune/components",
  "@rune/router",
  "@rune/icons",
  "@rune/safe-area",
];

let artifactsPromise: Promise<Record<string, string>> | null = null;

export async function ensureSharedArtifacts(customCacheDir?: string) {
  if (artifactsPromise) return artifactsPromise;

  artifactsPromise = (async () => {
    const cacheDir = customCacheDir ?? process.env.SKYHOOK_ARTIFACTS_CACHE_DIR ?? join(tmpdir(), "rune-skyhook-artifacts");
    
    // We recreate the cache to ensure freshness on server restart/deployment
    // In a persistent env, we might want to check mtimes, but for now simple overwrite is safer
    // to guarantee the latest code is used.
    await mkdir(cacheDir, { recursive: true });
    
    const stagedMap: Record<string, string> = {};

    for (const pkgName of INTERNAL_PACKAGES) {
      try {
        const pkgSourceDir = await getPackageDir(pkgName);
        const folderName = pkgName.replace("@rune/", "rune-");
        const targetPkgDir = join(cacheDir, folderName);
        
        // Remove existing to ensure clean slate
        // Note: rm with recursive is available in node 14.14+
        // await rm(targetPkgDir, { recursive: true, force: true }); 
        // using cp with force/recursive might be enough or we can trust overwrite behavior
        
        await mkdir(targetPkgDir, { recursive: true });

        // Copy dist
        await cp(join(pkgSourceDir, "dist"), join(targetPkgDir, "dist"), { recursive: true });
        
        // Copy package.json
        await cp(join(pkgSourceDir, "package.json"), join(targetPkgDir, "package.json"));

        stagedMap[pkgName] = targetPkgDir;
      } catch (error) {
        console.warn(`[provisioning] Failed to stage artifact for ${pkgName}:`, error);
      }
    }
    return stagedMap;
  })();

  return artifactsPromise;
}
