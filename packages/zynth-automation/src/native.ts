import type { AutomationReadOptions, AutomationSnapshot } from "./types";

type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
  callSync?(name: string, method: string, args?: unknown): unknown;
};

type NativeError = {
  error?: string;
  message?: string;
};

const MODULE_NAME = "Automation";

function getBridge(): ModulesBridge | null {
  const maybeBridge = (globalThis as { __modules?: unknown }).__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function isNativeError(value: unknown): value is NativeError {
  if (!value || typeof value !== "object") return false;
  const maybe = value as NativeError;
  return typeof maybe.error === "string" || typeof maybe.message === "string";
}

function unwrap<T>(value: unknown): T {
  if (isNativeError(value)) {
    throw new Error(value.message || value.error || "Native automation error");
  }
  if (value && typeof value === "object" && "result" in (value as Record<string, unknown>)) {
    return (value as { result: T }).result;
  }
  return value as T;
}

export function readSyncNative(options?: AutomationReadOptions): AutomationSnapshot {
  const bridge = getBridge();
  if (!bridge?.callSync) {
    throw new Error("Native sync modules bridge not available");
  }
  return unwrap<AutomationSnapshot>(bridge.callSync(MODULE_NAME, "read", options));
}

export async function readNative(options?: AutomationReadOptions): Promise<AutomationSnapshot> {
  const bridge = getBridge();
  if (!bridge?.call) {
    throw new Error("Native modules bridge not available");
  }
  const value = await Promise.resolve(bridge.call(MODULE_NAME, "read", options));
  return unwrap<AutomationSnapshot>(value);
}
