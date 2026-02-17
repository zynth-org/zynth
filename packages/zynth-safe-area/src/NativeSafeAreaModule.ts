import {
  sharedNativeEventEmitter,
  getGlobalObject,
  getModulesBridge,
  getNativeModule,
  callNativeSync,
} from "@zynth/core";
import type { WindowMetrics } from "./types";

/**
 * Native module interface for safe area
 */
export interface NativeSafeAreaModule {
  /**
   * Get initial window metrics synchronously (if available)
   */
  getInitialMetrics(): WindowMetrics | null;

  /**
   * Add a listener for window metrics changes
   * Returns an unsubscribe function
   */
  addMetricsChangeListener(
    listener: (metrics: WindowMetrics) => void
  ): () => void;
}

/**
 * Global reference to the native safe area module
 * Set by the native platform during initialization
 */
declare global {
  interface Window {
    __ZYNTH_SAFE_AREA__?: NativeSafeAreaModule;
  }
  var __ZYNTH_SAFE_AREA__: NativeSafeAreaModule | undefined;
  var NativeConstants: Record<string, unknown> | undefined;
}

const EVENT_NAME = "ZynthSafeArea:change";
const MODULE_KEY = "ZynthSafeArea";
const DEFAULT_METRICS: WindowMetrics = {
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  frame: { x: 0, y: 0, width: 0, height: 0 },
};

let webMeasureNode: HTMLDivElement | null = null;

function ensureWebMeasureNode(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (webMeasureNode && document.body?.contains(webMeasureNode)) {
    return webMeasureNode;
  }
  if (!document.body) return null;
  const node = document.createElement("div");
  node.style.position = "absolute";
  node.style.top = "0";
  node.style.left = "0";
  node.style.visibility = "hidden";
  node.style.pointerEvents = "none";
  node.style.padding = "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.appendChild(node);
  webMeasureNode = node;
  return node;
}

function readWebInsets(): WindowMetrics["insets"] {
  const node = ensureWebMeasureNode();
  if (!node || typeof getComputedStyle !== "function") {
    return { ...DEFAULT_METRICS.insets };
  }
  const styles = getComputedStyle(node);
  const top = parseFloat(styles.paddingTop) || 0;
  const right = parseFloat(styles.paddingRight) || 0;
  const bottom = parseFloat(styles.paddingBottom) || 0;
  const left = parseFloat(styles.paddingLeft) || 0;
  return { top, right, bottom, left };
}

function getWebMetrics(): WindowMetrics {
  if (typeof window === "undefined") return DEFAULT_METRICS;
  return {
    insets: readWebInsets(),
    frame: {
      x: 0,
      y: 0,
      width: window.innerWidth || 0,
      height: window.innerHeight || 0,
    },
  };
}

function createWebModule(): NativeSafeAreaModule {
  return {
    getInitialMetrics() {
      return getWebMetrics();
    },
    addMetricsChangeListener(listener) {
      const emit = () => listener(getWebMetrics());
      emit();
      const handle = () => emit();
      if (typeof window !== "undefined") {
        window.addEventListener("resize", handle);
        window.addEventListener("orientationchange", handle);
        const viewport = window.visualViewport;
        if (viewport) {
          viewport.addEventListener("resize", handle);
          viewport.addEventListener("scroll", handle);
        }
      }
      return () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("resize", handle);
          window.removeEventListener("orientationchange", handle);
          const viewport = window.visualViewport;
          if (viewport) {
            viewport.removeEventListener("resize", handle);
            viewport.removeEventListener("scroll", handle);
          }
        }
      };
    },
  };
}

// Removed getGlobalObject

function getPlatform(): string | null {
  const value = getNativeModule<string>("__ZYNTH_PLATFORM");
  return typeof value === "string" ? value : null;
}

function readNativeConstants(): WindowMetrics | null {
  const globalObj = getGlobalObject();
  const constants = globalObj.NativeConstants as Record<string, unknown> | undefined;
  if (!constants) return null;
  const value = constants[MODULE_KEY];
  if (!value || typeof value !== "object") return null;
  return value as WindowMetrics;
}

// Removed getModulesBridge

function readFromBridge(): WindowMetrics | null {
  try {
    const result = callNativeSync<any>(MODULE_KEY, "getCurrentMetrics", {});
    if (!result || typeof result !== "object") return null;
    return result as WindowMetrics;
  } catch {
    return null;
  }
}

function createEmitterModule(): NativeSafeAreaModule {
  const initial = readNativeConstants() ?? readFromBridge();
  let latest = initial ?? DEFAULT_METRICS;

  return {
    getInitialMetrics() {
      return readFromBridge() ?? latest;
    },
    addMetricsChangeListener(listener) {
      const current = readFromBridge();
      if (current) {
        latest = current;
        listener(current);
      }
      const maybeRetry = () => {
        const retry = readFromBridge();
        if (retry) {
          latest = retry;
          listener(retry);
        }
      };
      if (!current && typeof globalThis !== "undefined") {
        const schedule = (globalThis as any).setTimeout;
        if (typeof schedule === "function") {
          schedule(maybeRetry, 0);
        } else {
          maybeRetry();
        }
      }
      const subscription = sharedNativeEventEmitter.addListener(
        EVENT_NAME,
        (payload) => {
          if (payload && typeof payload === "object") {
            latest = payload as WindowMetrics;
            listener(latest);
          }
        }
      );
      return () => subscription.remove();
    },
  };
}

/**
 * Get the native safe area module
 * Returns null if not available (dev warning will be emitted)
 */
export function getNativeSafeAreaModule(): NativeSafeAreaModule | null {
  // Use core helper for JSI module
  const jsiModule = getNativeModule<NativeSafeAreaModule>("__ZYNTH_SAFE_AREA__");
  if (jsiModule) {
    return jsiModule;
  }

  const platform = getPlatform();
  if (platform === "web") {
    return createWebModule();
  }
  if (platform === "ios" || platform === "android") {
    return createEmitterModule();
  }
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return createWebModule();
  }
  const constants = readNativeConstants();
  const bridge = getModulesBridge();
  return constants || bridge ? createEmitterModule() : null;
}