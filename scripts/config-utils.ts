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
  devServerUrl?: string;
}

function buildInfoPlistDefaults(
  configuredInfoPlist: Record<string, unknown>
): Record<string, unknown> {
  const configuredSceneManifest = configuredInfoPlist.UIApplicationSceneManifest;
  const { UIApplicationSceneManifest: _omitSceneManifest, ...restInfoPlist } =
    configuredInfoPlist;
  const defaultSceneConfigurations = {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "SceneDelegate",
      },
    ],
  };

  const mergedSceneManifest =
    configuredSceneManifest &&
    typeof configuredSceneManifest === "object" &&
    !Array.isArray(configuredSceneManifest)
      ? {
          UIApplicationSupportsMultipleScenes: false,
          UISceneConfigurations: defaultSceneConfigurations,
          ...(configuredSceneManifest as Record<string, unknown>),
        }
      : {
          UIApplicationSupportsMultipleScenes: false,
          UISceneConfigurations: defaultSceneConfigurations,
        };

  return {
    UIApplicationSceneManifest: mergedSceneManifest,
    ...restInfoPlist,
  };
}

export function safeReadJSON(filePath: string): any {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return null;
  }
}

// Configuration - parse app info from app.json (Zynth-style) and package.json
export function getAppConfig(appDir: string): AppConfig {
  const pkgPath = path.join(appDir, "package.json");
  const appJsonPath = path.join(appDir, "app.json");

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found at ${pkgPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const appName = path.basename(appDir);

  // Try to read app.json (Zynth-style config)
  let appConfig: any = {};
  if (fs.existsSync(appJsonPath)) {
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    appConfig = appJson.zynth || appJson;
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
      `com.zynth.${appName.replace(/-/g, "")}`,
    workspaceName: pkg.name || `@demo/${appName}`,
    displayName: appConfig.name || pkg.displayName || appName,
    version: appConfig.version || pkg.version || "1.0.0",
    infoPlist: buildInfoPlistDefaults(
      (appConfig.ios?.infoPlist || {}) as Record<string, unknown>
    ),
    androidConfig: appConfig.android || {},
    devServerUrl: appConfig.devServerUrl,
  };
}
