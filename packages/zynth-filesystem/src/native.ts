import {
  callNative as coreCallNative,
  callNativeSync as coreCallNativeSync,
  getGlobalObject,
  getModulesBridge,
} from "@zynthjs/core";

type DevtoolsBridge = {
  emit(event: { topic: string; level?: string; tag?: string; data?: unknown }): void;
};

const MODULE_NAME = "ZynthFileSystem";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
let warnedMissing = false;

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function createMissingModuleError(): Error {
  return new Error(
    `[${MODULE_NAME}] Native module not found. ` +
      `Ensure the package is installed, linked, and your native project has been regenerated for this platform.`
  );
}

function emitDevtoolsEvent(event: {
  topic: string;
  level?: string;
  tag?: string;
  data?: unknown;
}): void {
  const globalObj = getGlobalObject() as { __ZYNTH_DEVTOOLS__?: DevtoolsBridge };
  const bridge = globalObj.__ZYNTH_DEVTOOLS__;
  if (bridge?.emit) {
    bridge.emit(event);
  }
}

export function warnMissingNativeOnce(context: string, error?: unknown): void {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn(
    `[ZynthFileSystem] Native module missing (${context}). FileSystem APIs will be unavailable.`,
    error ?? ""
  );
  emitDevtoolsEvent({
    topic: "filesystem/native-missing",
    level: "warn",
    tag: "zynth-filesystem",
    data: { context, error: error instanceof Error ? error.message : error },
  });
}

export async function callNative<T>(method: string, args?: any): Promise<T> {
  try {
    return await coreCallNative<T>(MODULE_NAME, method, args);
  } catch (error: any) {
    if (error.message?.includes("module_not_found") || error.message?.includes("not found")) {
      throw createMissingModuleError();
    }
    throw error;
  }
}

export function callNativeSync<T>(method: string, args?: any): T {
  try {
    return coreCallNativeSync<T>(MODULE_NAME, method, args);
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
