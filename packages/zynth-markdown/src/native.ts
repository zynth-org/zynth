type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
};

type ErrorResult = {
  error?: string;
  message?: string;
  code?: string;
};

const MODULE_NAME = "ZynthMarkdown";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";

function getGlobalObject(): Record<string, unknown> {
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

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as ErrorResult).error === "string";
}

function unwrapResult<T>(value: unknown): T {
  if (isErrorResult(value)) {
    const message = value.message || value.error || "Unknown error";
    throw new Error(message);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("result" in record) {
      return record.result as T;
    }
    if ("data" in record) {
      return record.data as T;
    }
  }
  return value as T;
}

export async function callNative<T>(method: string, args?: unknown): Promise<T> {
  const bridge = getModulesBridge();
  if (!bridge || !bridge.call) {
    throw new Error("Native modules bridge not available");
  }
  const result = await Promise.resolve(bridge.call(MODULE_NAME, method, args));
  return unwrapResult<T>(result);
}

export function callNativeSync<T>(method: string, args?: unknown): T {
  const bridge = getModulesBridge();
  if (!bridge?.callSync) {
    throw new Error("Native sync bridge not available");
  }
  return unwrapResult<T>(bridge.callSync(MODULE_NAME, method, args));
}

export function isNativeAvailable(): boolean {
  const platform = getPlatform();
  if (platform !== "ios" && platform !== "android") {
    return false;
  }
  const bridge = getModulesBridge();
  return Boolean(bridge?.call || bridge?.callSync);
}
