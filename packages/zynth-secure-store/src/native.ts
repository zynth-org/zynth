import type { SecureStoreOptions } from "./types";

type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
};

type ErrorResult = {
  error?: string;
  message?: string;
  code?: string;
};

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
let _nextNonce = Date.now();

function getGlobalObject(): Record<string, any> {
  if (typeof globalThis !== "undefined") {
    return globalThis as Record<string, unknown>;
  }
  try {
    const fallback = Function("return this")();
    if (fallback && typeof fallback === "object") {
      return fallback as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  return typeof value === "string" ? value.toLowerCase() : null;
}

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = (globalObj as { __modules?: unknown }).__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function getNativeJSI(): NativeSecureStoreJSI | null {
  const globalObj = getGlobalObject();
  const native = globalObj[JSI_GLOBAL_KEY];
  if (!native || typeof native !== "object") {
    return null;
  }
  return native as NativeSecureStoreJSI;
}

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as ErrorResult).error === "string";
}

function createMissingModuleError(): Error {
  return new Error(
    `[ZynthSecureStore] Native module not found. ` +
      `Ensure @zynth/secure-store is installed, linked, and your native project has been regenerated for this platform.`
  );
}

function isModuleNotFound(error: ErrorResult): boolean {
  const message = `${error.message ?? ""} ${error.error ?? ""} ${error.code ?? ""}`;
  return (
    message.toLowerCase().includes("module_not_found") ||
    message.includes(`Module ${MODULE_NAME} not found`)
  );
}

function unwrapResult<T>(value: unknown): T {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("error" in record && record.error) {
      if (isModuleNotFound(record as ErrorResult)) {
        throw createMissingModuleError();
      }
      const message = record.message || record.error || "Unknown error";
      throw new Error(message as string);
    }
    if ("result" in record) {
      return record.result as T;
    }
    if ("data" in record) {
      return record.data as T;
    }
  }
  return value as T;
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

  const bridge = getModulesBridge();
  if (!bridge || !bridge.call) {
    throw new Error("Native modules bridge not available");
  }

  // Auto-inject security context for protected methods
  let callArgs: any = args;
  const g = getGlobalObject();
  const sessionId = g.NativeConstants?.bridgeSessionId;

  if (sessionId) {
    if (!args || (typeof args === "object" && !Array.isArray(args))) {
      callArgs = {
        ...(args || {}),
        bridgeSessionId: sessionId,
        nonce: _nextNonce++,
      };
    }
  }

  const result = await Promise.resolve(bridge.call(MODULE_NAME, method, callArgs));
  return unwrapResult<T>(result);
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

  const bridge = getModulesBridge();
  if (!bridge?.callSync) {
    throw new Error("Native sync bridge not available");
  }

  // Auto-inject security context for protected methods
  let callArgs: any = args;
  const g = getGlobalObject();
  const sessionId = g.NativeConstants?.bridgeSessionId;

  if (sessionId) {
    if (!args || (typeof args === "object" && !Array.isArray(args))) {
      callArgs = {
        ...(args || {}),
        bridgeSessionId: sessionId,
        nonce: _nextNonce++,
      };
    }
  }

  return unwrapResult<T>(bridge.callSync(MODULE_NAME, method, callArgs));
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
