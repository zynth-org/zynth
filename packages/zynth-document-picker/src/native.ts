import {
  callNative as coreCallNative,
  getGlobalObject,
  getModulesBridge,
} from "@zynth/core";

const MODULE_NAME = "DocumentPicker";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function createMissingModuleError(): Error {
  return new Error(
    `[${MODULE_NAME}] Native module not found. ` +
      `Ensure @zynth/document-picker is installed, linked, and your native project has been regenerated for this platform.`
  );
}

export async function callNative<T>(method: string, args?: unknown): Promise<T> {
  try {
    return await coreCallNative<T>(MODULE_NAME, method, args);
  } catch (error: any) {
    if (error.message?.includes("module_not_found") || error.message?.includes("not found")) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function isNativeAvailable(): boolean {
  const platform = getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return false;
  }
  const bridge = getModulesBridge();
  return Boolean(bridge?.call || bridge?.callSync);
}
