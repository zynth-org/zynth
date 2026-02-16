
type ModulesBridge = {
  call?(name: string, method: string, args?: any): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: any): unknown;
};

type ErrorResult = {
  error?: string;
  message?: string;
  code?: string;
};

type DevtoolsBridge = {
  emit(event: { topic: string; level?: string; tag?: string; data?: unknown }): void;
};

const MODULE_NAME = "ZynthFileSystem";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
let warnedMissing = false;
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

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as ErrorResult).error === "string";
}

function createMissingModuleError(): Error {
  return new Error(
    `[${MODULE_NAME}] Native module not found. ` +
      `Ensure the package is installed, linked, and your native project has been regenerated for this platform.`
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
  if (isErrorResult(value)) {
    if (isModuleNotFound(value)) {
      throw createMissingModuleError();
    }
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
  return Boolean(bridge?.call || bridge?.callSync);
}
