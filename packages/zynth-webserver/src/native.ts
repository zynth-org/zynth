import {
  callNative as coreCallNative,
  callNativeSync as coreCallNativeSync,
  getGlobalObject,
  getModulesBridge,
} from "@zynthjs/core";

const MODULE_NAME = "ZynthWebServer";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

export function callNative<T>(method: string, args?: unknown): Promise<T> {
  return coreCallNative<T>(MODULE_NAME, method, args);
}

export function callNativeSync<T>(method: string, args?: unknown): T {
  return coreCallNativeSync<T>(MODULE_NAME, method, args);
}

export function isNativeAvailable(): boolean {
  const platform = getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return false;
  }
  const bridge = getModulesBridge();
  return Boolean(bridge?.call || bridge?.callSync);
}
