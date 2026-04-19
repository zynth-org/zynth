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
  versionCode: number;
  versionName: string;
  buildNumber: string;
  infoPlist: Record<string, any>;
  androidConfig: any;
  devServerUrl?: string;
  androidStartupMetricsEnabled?: boolean;
  androidMinifyEnabled?: boolean;
  androidShrinkResources?: boolean;
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

export function getZynthConfig(appDir: string): Record<string, any> {
  const appJsonPath = path.join(appDir, "app.json");
  if (!fs.existsSync(appJsonPath)) {
    return {};
  }
  const appJson = safeReadJSON(appJsonPath);
  if (!appJson || typeof appJson !== "object") {
    return {};
  }
  const zynth = (appJson as Record<string, unknown>).zynth;
  if (zynth && typeof zynth === "object" && !Array.isArray(zynth)) {
    return zynth as Record<string, any>;
  }
  return appJson as Record<string, any>;
}

export function getZynthPackageConfig(
  appDir: string,
  packageName: string
): Record<string, any> {
  if (!packageName) {
    return {};
  }
  const config = getZynthConfig(appDir);
  const packages = config.packages;
  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    return {};
  }
  const entry = (packages as Record<string, unknown>)[packageName];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }
  return entry as Record<string, any>;
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
  const version = appConfig.version || pkg.version || "1.0.0";

  return {
    appName: cleanAppName,
    appNameCapitalized:
      cleanAppName.charAt(0).toUpperCase() + cleanAppName.slice(1),
    appDir: appName,
    bundleId:
      appConfig.android?.package ||
      appConfig.ios?.bundleIdentifier ||
      appConfig.slug ||
      pkg.bundleId ||
      `com.zynth.${appName.replace(/-/g, "")}`,
    workspaceName: pkg.name || `@demo/${appName}`,
    displayName: appConfig.name || pkg.displayName || appName,
    version,
    versionCode: appConfig.android?.versionCode || 1,
    versionName: appConfig.android?.versionName || version,
    buildNumber: String(appConfig.ios?.buildNumber || "1"),
    infoPlist: buildInfoPlistDefaults(
      (appConfig.ios?.infoPlist || {}) as Record<string, unknown>
    ),
    androidConfig: appConfig.android || {},
    devServerUrl: appConfig.devServerUrl,
    androidStartupMetricsEnabled:
      appConfig.android?.startupMetrics?.enabled === true,
    androidMinifyEnabled: appConfig.android?.build?.minifyEnabled === true,
    androidShrinkResources: appConfig.android?.build?.shrinkResources === true,
  };
}
