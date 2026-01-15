import type { Style } from "@zynth/core";
import type { EasingName } from "./easing";

export type NativeTransitionPhase = "enter" | "exit";

export type NativeTransitionConfig = {
  nodeId: number;
  animationId: number;
  phase: NativeTransitionPhase;
  from?: Style;
  to?: Style;
  frames?: Array<{
    at: number;
    style: Style;
    easing?: EasingName;
  }>;
  duration?: number;
  delay?: number;
  easing?: EasingName;
};

type ModulesBridge = {
  call?(name: string, method: string, args?: unknown): Promise<unknown> | unknown;
};

type ErrorResult = {
  error?: string;
  message?: string;
};

const MODULE_NAME = "ZynthAnimate";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
export const SHARED_VALUE_MARKER = "__zynth_shared_value";
let nativeModuleAvailable = true;

type NativeSharedValueRef = {
  [SHARED_VALUE_MARKER]: number;
};

export type NativeStyleValue = number | string | NativeSharedValueRef;

export type NativeStyleMapperConfig = {
  opacity?: NativeStyleValue;
  transform?: Array<Record<string, NativeStyleValue>>;
};

type NativeAnimateJSI = {
  createSharedValue: (initialValue: number) => number;
  getSharedValue: (id: number) => number;
  setSharedValue: (id: number, value: number) => void;
  animateSharedValue: (id: number, config: Record<string, unknown>) => void;
  cancelSharedValue: (id: number) => void;
  createStyleMapper: (nodeId: number, style: NativeStyleMapperConfig) => number;
  updateStyleMapper: (mapperId: number, style: NativeStyleMapperConfig) => void;
  removeStyleMapper: (mapperId: number) => void;
};

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

function getModulesBridge(): ModulesBridge | null {
  const globalObj = getGlobalObject();
  const maybeBridge = globalObj.__modules;
  if (!maybeBridge || typeof maybeBridge !== "object") {
    return null;
  }
  return maybeBridge as ModulesBridge;
}

function getNativeAnimate(): NativeAnimateJSI | null {
  const globalObj = getGlobalObject();
  const native = globalObj.__zynth_animate;
  if (!native || typeof native !== "object") {
    return null;
  }
  return native as NativeAnimateJSI;
}

function getPlatformOS(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj[PLATFORM_GLOBAL_KEY];
  if (typeof value !== "string") {
    return null;
  }
  return value.toLowerCase();
}

export function isNativePlatform(): boolean {
  const os = getPlatformOS();
  return os === "ios" || os === "android";
}

export function hasNativeAnimate(): boolean {
  return Boolean(getNativeAnimate());
}

function isErrorResult(value: unknown): value is ErrorResult {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { error?: unknown }).error === "string";
}

async function callBridge(method: string, args?: unknown): Promise<boolean> {
  const bridge = getModulesBridge();
  if (!bridge || !bridge.call) {
    return false;
  }
  if (!nativeModuleAvailable) {
    return false;
  }

  try {
    const result = await Promise.resolve(bridge.call(MODULE_NAME, method, args));
    if (isErrorResult(result)) {
      throw new Error(result.message || result.error || "Unknown error");
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Module ZynthAnimate not found")) {
      nativeModuleAvailable = false;
      return false;
    }
    console.error(`[ZynthAnimate] Failed to ${method}():`, JSON.stringify(error));
    return false;
  }
}

export async function startNativeTransition(
  config: NativeTransitionConfig
): Promise<boolean> {
  return callBridge("startTransition", config);
}

export async function stopNativeTransition(nodeId: number): Promise<boolean> {
  return callBridge("stopTransition", { nodeId });
}

export function createNativeSharedValue(initialValue: number): number | null {
  const native = getNativeAnimate();
  if (!native) return null;
  try {
    return native.createSharedValue(initialValue);
  } catch (error) {
    console.error("[ZynthAnimate] createSharedValue failed:", error);
    return null;
  }
}

export function getNativeSharedValue(id: number): number | null {
  const native = getNativeAnimate();
  if (!native) return null;
  try {
    return native.getSharedValue(id);
  } catch (error) {
    console.error("[ZynthAnimate] getSharedValue failed:", error);
    return null;
  }
}

export function setNativeSharedValue(id: number, value: number): boolean {
  const native = getNativeAnimate();
  if (!native) return false;
  try {
    native.setSharedValue(id, value);
    return true;
  } catch (error) {
    console.error("[ZynthAnimate] setSharedValue failed:", error);
    return false;
  }
}

export function animateNativeSharedValue(
  id: number,
  config: Record<string, unknown>
): boolean {
  const native = getNativeAnimate();
  if (!native) return false;
  try {
    native.animateSharedValue(id, config);
    return true;
  } catch (error) {
    console.error("[ZynthAnimate] animateSharedValue failed:", error);
    return false;
  }
}

export function cancelNativeSharedValue(id: number): boolean {
  const native = getNativeAnimate();
  if (!native) return false;
  try {
    native.cancelSharedValue(id);
    return true;
  } catch (error) {
    console.error("[ZynthAnimate] cancelSharedValue failed:", error);
    return false;
  }
}

export function createNativeStyleMapper(
  nodeId: number,
  style: NativeStyleMapperConfig
): number | null {
  const native = getNativeAnimate();
  if (!native) return null;
  try {
    return native.createStyleMapper(nodeId, style);
  } catch (error) {
    console.error("[ZynthAnimate] createStyleMapper failed:", error);
    return null;
  }
}

export function updateNativeStyleMapper(
  mapperId: number,
  style: NativeStyleMapperConfig
): boolean {
  const native = getNativeAnimate();
  if (!native) return false;
  try {
    native.updateStyleMapper(mapperId, style);
    return true;
  } catch (error) {
    console.error("[ZynthAnimate] updateStyleMapper failed:", error);
    return false;
  }
}

export function removeNativeStyleMapper(mapperId: number): boolean {
  const native = getNativeAnimate();
  if (!native) return false;
  try {
    native.removeStyleMapper(mapperId);
    return true;
  } catch (error) {
    console.error("[ZynthAnimate] removeStyleMapper failed:", error);
    return false;
  }
}
