import {
  callNative,
  getGlobalObject,
} from "../bridge";
import type { Style } from "../host/HostTypes";
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
  consumeAnimationCompletions: () => Array<{ callbackId: number; finished: boolean }>;
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

const MODULE_NAME = "ZynthAnimate";
const PLATFORM_GLOBAL_KEY = "__ZYNTH_PLATFORM";
export const SHARED_VALUE_MARKER = "__zynth_shared_value";
export const INTERPOLATION_MARKER = "__zynth_interpolation";
export const DERIVED_VALUE_MARKER = "__zynth_derived_value";

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

type NativeDerivedRef = {
  [DERIVED_VALUE_MARKER]: {
    source: NativeSharedValueRef | NativeInterpolationRef | number;
    multiplier?: number;
    offset?: number;
  };
};

export type NativeStyleValue =
  | number
  | string
  | NativeSharedValueRef
  | NativeInterpolationRef
  | NativeDerivedRef;

export type NativeStyleMapperConfig = {
  opacity?: NativeStyleValue;
  transform?: Array<Record<string, NativeStyleValue>>;
  width?: NativeStyleValue;
  height?: NativeStyleValue;
  minWidth?: NativeStyleValue;
  minHeight?: NativeStyleValue;
  maxWidth?: NativeStyleValue;
  maxHeight?: NativeStyleValue;
  flex?: NativeStyleValue;
  flexGrow?: NativeStyleValue;
  flexShrink?: NativeStyleValue;
  flexBasis?: NativeStyleValue;
  top?: NativeStyleValue;
  right?: NativeStyleValue;
  bottom?: NativeStyleValue;
  left?: NativeStyleValue;
  padding?: NativeStyleValue;
  paddingHorizontal?: NativeStyleValue;
  paddingVertical?: NativeStyleValue;
  paddingTop?: NativeStyleValue;
  paddingRight?: NativeStyleValue;
  paddingBottom?: NativeStyleValue;
  paddingLeft?: NativeStyleValue;
  margin?: NativeStyleValue;
  marginHorizontal?: NativeStyleValue;
  marginVertical?: NativeStyleValue;
  marginTop?: NativeStyleValue;
  marginRight?: NativeStyleValue;
  marginBottom?: NativeStyleValue;
  marginLeft?: NativeStyleValue;
};

type NativeAnimateJSI = {
  createSharedValue: (initialValue: number) => number;
  getSharedValue: (id: number) => number;
  setSharedValue: (id: number, value: number) => void;
  animateSharedValue: (id: number, config: Record<string, unknown>) => void;
  cancelSharedValue: (id: number) => void;
  consumeAnimationCompletions: () => Array<{ callbackId: number; finished: boolean }>;
  createStyleMapper: (nodeId: number, style: NativeStyleMapperConfig) => number;
  updateStyleMapper: (mapperId: number, style: NativeStyleMapperConfig) => void;
  removeStyleMapper: (mapperId: number) => void;
};

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
    consumeAnimationCompletions: () => [],
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
    if (!nativeModuleAvailable) return false;
    try {
      await callNative(MODULE_NAME, method, args);
      return true;
    } catch (error: unknown) {
      const message = (error instanceof Error ? error.message : String(error));
      if (message.includes("module_not_found") || message.includes("not found")) {
        nativeModuleAvailable = false;
        return false;
      }
      console.error(
        `[ZynthCore/Motion] (${platform}) Failed to ${method}():`,
        error
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
        console.error("[ZynthCore/Motion] createSharedValue failed:", error);
        return null;
      }
    },
    getSharedValue(id) {
      const native = getNativeAnimate();
      if (!native) return null;
      try {
        return native.getSharedValue(id);
      } catch (error) {
        console.error("[ZynthCore/Motion] getSharedValue failed:", error);
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
        console.error("[ZynthCore/Motion] setSharedValue failed:", error);
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
        console.error("[ZynthCore/Motion] animateSharedValue failed:", error);
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
        console.error("[ZynthCore/Motion] cancelSharedValue failed:", error);
        return false;
      }
    },
    consumeAnimationCompletions() {
      const native = getNativeAnimate();
      if (!native) return [];
      try {
        const results = native.consumeAnimationCompletions();
        if (!Array.isArray(results)) return [];
        const normalized: Array<{ callbackId: number; finished: boolean }> = [];
        for (const entry of results) {
          if (!entry || typeof entry !== "object") continue;
          const record = entry as { callbackId?: unknown; finished?: unknown };
          if (
            typeof record.callbackId === "number" &&
            Number.isFinite(record.callbackId) &&
            typeof record.finished === "boolean"
          ) {
            normalized.push({ callbackId: record.callbackId, finished: record.finished });
          }
        }
        return normalized;
      } catch (error) {
        console.error("[ZynthCore/Motion] consumeAnimationCompletions failed:", error);
        return [];
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
        console.error("[ZynthCore/Motion] createStyleMapper failed:", error);
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
        console.error("[ZynthCore/Motion] updateStyleMapper failed:", error);
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
        console.error("[ZynthCore/Motion] removeStyleMapper failed:", error);
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

/**
 * Returns the platform-specific animation host bridge singleton.
 * Use this when you need direct access to the native animation runtime.
 */
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

export function consumeNativeAnimationCompletions(): Array<{
  callbackId: number;
  finished: boolean;
}> {
  return animationHostBridge.consumeAnimationCompletions();
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
