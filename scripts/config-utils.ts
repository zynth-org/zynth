import * as fs from 'fs';
import * as path from 'path';

export interface AppConfig {
  appName: string;
  appNameCapitalized: string;
  appDir: string;
  bundleId: string;
  workspaceName: string;
  displayName: string;
  version: string;
  infoPlist: Record<string, any>;
  androidConfig: any;
}

export function safeReadJSON(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

// Configuration - parse app info from app.json (Rune-style) and package.json
export function getAppConfig(appDir: string): AppConfig {
  const pkgPath = path.join(appDir, "package.json");
  const appJsonPath = path.join(appDir, "app.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const appName = path.basename(appDir);

  // Try to read app.json (Rune-style config)
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    appConfig = appJson.rune || appJson;
  }

  // Clean app name for Xcode (no spaces, special chars)
  const cleanAppName = (appConfig.name || appName).replace(/[^a-zA-Z0-9]/g, "");

  return {
    appName: cleanAppName,
    appNameCapitalized:
      cleanAppName.charAt(0).toUpperCase() + cleanAppName.slice(1),
    appDir: appName,
    bundleId:
      appConfig.ios?.bundleIdentifier ||
      pkg.bundleId ||
      `com.rune.${appName.replace(/-/g, "")}`,
    workspaceName: pkg.name || `@demo/${appName}`,
    displayName: appConfig.name || pkg.displayName || appName,
    version: appConfig.version || pkg.version || "1.0.0",
    infoPlist: appConfig.ios?.infoPlist || {},
    androidConfig: appConfig.android || {},
  };
}
