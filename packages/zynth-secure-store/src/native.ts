import {
  callNative as coreCallNative,
  callNativeSync as coreCallNativeSync,
  getGlobalObject,
  getModulesBridge,
} from "@zynth/core";
import type { SecureStoreOptions } from "./types";

type NativeSecureStoreJSI = {
  getItem(key: string, options?: SecureStoreOptions): string | null;
  setItem(key: string, value: string, options?: SecureStoreOptions): void;
  deleteItem(key: string, options?: SecureStoreOptions): void;
  isAvailable(): boolean;
  canUseBiometricAuthentication(): boolean;
};

const MODULE_NAME = "ZynthSecureStore";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
const JSI_GLOBAL_KEY = "__zynth_secure_store";

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function getNativeJSI(): NativeSecureStoreJSI | null {
  const globalObj = getGlobalObject();
  const native = globalObj[JSI_GLOBAL_KEY];
  if (!native || typeof native !== "object") {
    return null;
  }
  return native as NativeSecureStoreJSI;
}

function createMissingModuleError(): Error {
  return new Error(
    `[ZynthSecureStore] Native module not found. ` +
      `Ensure @zynth/secure-store is installed, linked, and your native project has been regenerated for this platform.`
  );
}

function normalizeOptions(options?: SecureStoreOptions): SecureStoreOptions | undefined {
  if (!options) return undefined;
  return { ...options };
}

export async function callNative<T>(
  method: string,
  args?: any
): Promise<T> {
  const native = getNativeJSI();
  if (native) {
    switch (method) {
      case "getItem":
        return native.getItem(
          args.key,
          args.options
        ) as T;
      case "setItem":
        native.setItem(
          args.key,
          args.value,
          args.options
        );
        return undefined as T;
      case "deleteItem":
        native.deleteItem(
          args.key,
          args.options
        );
        return undefined as T;
      case "isAvailable":
        return native.isAvailable() as T;
      case "canUseBiometricAuthentication":
        return native.canUseBiometricAuthentication() as T;
      default:
        throw new Error(`Unsupported method ${method}`);
    }
  }

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
  const native = getNativeJSI();
  if (native) {
    switch (method) {
      case "getItem":
        return native.getItem(
          args.key,
          args.options
        ) as T;
      case "setItem":
        native.setItem(
          args.key,
          args.value,
          args.options
        );
        return undefined as T;
      case "deleteItem":
        native.deleteItem(
          args.key,
          args.options
        );
        return undefined as T;
      case "isAvailable":
        return native.isAvailable() as T;
      case "canUseBiometricAuthentication":
        return native.canUseBiometricAuthentication() as T;
      default:
        throw new Error(`Unsupported method ${method}`);
    }
  }

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
  return Boolean(getNativeJSI() || bridge?.call || bridge?.callSync);
}

export function buildArgs(key: string, options?: SecureStoreOptions, value?: string) {
  const normalizedOptions = normalizeOptions(options);
  const payload: Record<string, unknown> = { key };
  if (value !== undefined) {
    payload.value = value;
  }
  if (normalizedOptions) {
    payload.options = normalizedOptions;
  }
  return payload;
}
