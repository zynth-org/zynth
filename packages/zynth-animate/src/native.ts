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

export interface AnimationHostBridge {
  isNativePlatform: () => boolean;
  hasNativeDriver: () => boolean;
  startTransition: (config: NativeTransitionConfig) => Promise<boolean>;
  stopTransition: (nodeId: number) => Promise<boolean>;
  createSharedValue: (initialValue: number) => number | null;
  getSharedValue: (id: number) => number | null;
  setSharedValue: (id: number, value: number) => boolean;
  animateSharedValue: (id: number, config: Record<string, unknown>) => boolean;
  cancelSharedValue: (id: number) => boolean;
  createStyleMapper: (
    nodeId: number,
    style: NativeStyleMapperConfig
  ) => number | null;
  updateStyleMapper: (
    mapperId: number,
    style: NativeStyleMapperConfig
  ) => boolean;
  removeStyleMapper: (mapperId: number) => boolean;
}

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
export const INTERPOLATION_MARKER = "__zynth_interpolation";

type NativeSharedValueRef = {
  [SHARED_VALUE_MARKER]: number;
};

type NativeInterpolationRef = {
  [INTERPOLATION_MARKER]: {
    source: NativeSharedValueRef | number;
    inputRange: number[];
    outputRange: number[];
    extrapolateLeft?: "identity" | "clamp" | "extend";
    extrapolateRight?: "identity" | "clamp" | "extend";
  };
};

export type NativeStyleValue =
  | number
  | string
  | NativeSharedValueRef
  | NativeInterpolationRef;

export type NativeStyleMapperConfig = {
  opacity?: NativeStyleValue;
  transform?: Array<Record<string, NativeStyleValue>>;
  width?: NativeStyleValue;
  height?: NativeStyleValue;
  minWidth?: NativeStyleValue;
  minHeight?: NativeStyleValue;
  maxWidth?: NativeStyleValue;
  maxHeight?: NativeStyleValue;
  flexBasis?: NativeStyleValue;
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

type NativeAdapterPlatform = "ios" | "android";

function createFallbackAnimationHostBridge(): AnimationHostBridge {
  return {
    isNativePlatform: () => false,
    hasNativeDriver: () => false,
    startTransition: async () => false,
    stopTransition: async () => false,
    createSharedValue: () => null,
    getSharedValue: () => null,
    setSharedValue: () => false,
    animateSharedValue: () => false,
    cancelSharedValue: () => false,
    createStyleMapper: () => null,
    updateStyleMapper: () => false,
    removeStyleMapper: () => false,
  };
}

function createNativeAnimationHostBridge(
  platform: NativeAdapterPlatform
): AnimationHostBridge {
  let nativeModuleAvailable = true;

  const callBridge = async (method: string, args?: unknown): Promise<boolean> => {
    const bridge = getModulesBridge();
    if (!bridge || !bridge.call || !nativeModuleAvailable) {
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
      console.error(
        `[ZynthAnimate] (${platform}) Failed to ${method}():`,
        JSON.stringify(error)
      );
      return false;
    }
  };

  return {
    isNativePlatform: () => true,
    hasNativeDriver: hasNativeAnimate,
    startTransition(config) {
      return callBridge("startTransition", config);
    },
    stopTransition(nodeId) {
      return callBridge("stopTransition", { nodeId });
    },
    createSharedValue(initialValue) {
      const native = getNativeAnimate();
      if (!native) return null;
      try {
        const id = native.createSharedValue(initialValue);
        return typeof id === "number" && Number.isFinite(id) ? id : null;
      } catch (error) {
        console.error("[ZynthAnimate] createSharedValue failed:", error);
        return null;
      }
    },
    getSharedValue(id) {
      const native = getNativeAnimate();
      if (!native) return null;
      try {
        return native.getSharedValue(id);
      } catch (error) {
        console.error("[ZynthAnimate] getSharedValue failed:", error);
        return null;
      }
    },
    setSharedValue(id, value) {
      const native = getNativeAnimate();
      if (!native) return false;
      try {
        native.setSharedValue(id, value);
        return true;
      } catch (error) {
        console.error("[ZynthAnimate] setSharedValue failed:", error);
        return false;
      }
    },
    animateSharedValue(id, config) {
      const native = getNativeAnimate();
      if (!native) return false;
      try {
        native.animateSharedValue(id, config);
        return true;
      } catch (error) {
        console.error("[ZynthAnimate] animateSharedValue failed:", error);
        return false;
      }
    },
    cancelSharedValue(id) {
      const native = getNativeAnimate();
      if (!native) return false;
      try {
        native.cancelSharedValue(id);
        return true;
      } catch (error) {
        console.error("[ZynthAnimate] cancelSharedValue failed:", error);
        return false;
      }
    },
    createStyleMapper(nodeId, style) {
      const native = getNativeAnimate();
      if (!native) return null;
      try {
        const mapperId = native.createStyleMapper(nodeId, style);
        return typeof mapperId === "number" && Number.isFinite(mapperId)
          ? mapperId
          : null;
      } catch (error) {
        console.error("[ZynthAnimate] createStyleMapper failed:", error);
        return null;
      }
    },
    updateStyleMapper(mapperId, style) {
      const native = getNativeAnimate();
      if (!native) return false;
      try {
        native.updateStyleMapper(mapperId, style);
        return true;
      } catch (error) {
        console.error("[ZynthAnimate] updateStyleMapper failed:", error);
        return false;
      }
    },
    removeStyleMapper(mapperId) {
      const native = getNativeAnimate();
      if (!native) return false;
      try {
        native.removeStyleMapper(mapperId);
        return true;
      } catch (error) {
        console.error("[ZynthAnimate] removeStyleMapper failed:", error);
        return false;
      }
    },
  };
}

function createIOSAnimationHostBridge(): AnimationHostBridge {
  return createNativeAnimationHostBridge("ios");
}

function createAndroidAnimationHostBridge(): AnimationHostBridge {
  return createNativeAnimationHostBridge("android");
}

function createAnimationHostBridgeForCurrentPlatform(): AnimationHostBridge {
  const os = getPlatformOS();
  if (os === "ios") return createIOSAnimationHostBridge();
  if (os === "android") return createAndroidAnimationHostBridge();
  return createFallbackAnimationHostBridge();
}

const animationHostBridge = createAnimationHostBridgeForCurrentPlatform();

export function getAnimationHostBridge(): AnimationHostBridge {
  return animationHostBridge;
}

export async function startNativeTransition(
  config: NativeTransitionConfig
): Promise<boolean> {
  return animationHostBridge.startTransition(config);
}

export async function stopNativeTransition(nodeId: number): Promise<boolean> {
  return animationHostBridge.stopTransition(nodeId);
}

export function createNativeSharedValue(initialValue: number): number | null {
  return animationHostBridge.createSharedValue(initialValue);
}

export function getNativeSharedValue(id: number): number | null {
  return animationHostBridge.getSharedValue(id);
}

export function setNativeSharedValue(id: number, value: number): boolean {
  return animationHostBridge.setSharedValue(id, value);
}

export function animateNativeSharedValue(
  id: number,
  config: Record<string, unknown>
): boolean {
  return animationHostBridge.animateSharedValue(id, config);
}

export function cancelNativeSharedValue(id: number): boolean {
  return animationHostBridge.cancelSharedValue(id);
}

export function createNativeStyleMapper(
  nodeId: number,
  style: NativeStyleMapperConfig
): number | null {
  return animationHostBridge.createStyleMapper(nodeId, style);
}

export function updateNativeStyleMapper(
  mapperId: number,
  style: NativeStyleMapperConfig
): boolean {
  return animationHostBridge.updateStyleMapper(mapperId, style);
}

export function removeNativeStyleMapper(mapperId: number): boolean {
  return animationHostBridge.removeStyleMapper(mapperId);
}
