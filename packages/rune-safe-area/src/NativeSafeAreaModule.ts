import { sharedNativeEventEmitter } from "@rune/core";
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
    __RUNE_SAFE_AREA__?: NativeSafeAreaModule;
  }
  var __RUNE_SAFE_AREA__: NativeSafeAreaModule | undefined;
  var NativeConstants: Record<string, unknown> | undefined;
}

const EVENT_NAME = "RuneSafeArea:change";
const MODULE_KEY = "RuneSafeArea";
const DEFAULT_METRICS: WindowMetrics = {
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  frame: { x: 0, y: 0, width: 0, height: 0 },
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

function getPlatform(): string | null {
  const globalObj = getGlobalObject();
  const value = globalObj.__RUNE_PLATFORM;
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

function getModulesBridge(): {
  callSync?: (name: string, method: string, args?: unknown) => unknown;
} | null {
  const globalObj = getGlobalObject();
  const bridge = (globalObj as { __modules?: unknown }).__modules;
  if (!bridge || typeof bridge !== "object") {
    return null;
  }
  return bridge as {
    callSync?: (name: string, method: string, args?: unknown) => unknown;
  };
}

function readFromBridge(): WindowMetrics | null {
  const bridge = getModulesBridge();
  if (!bridge?.callSync) return null;
  try {
    const result = bridge.callSync(MODULE_KEY, "getCurrentMetrics", {});
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
  const globalObj = getGlobalObject() as {
    __RUNE_SAFE_AREA__?: NativeSafeAreaModule;
  };
  if (globalObj.__RUNE_SAFE_AREA__) {
    return globalObj.__RUNE_SAFE_AREA__ || null;
  }
  const platform = getPlatform();
  if (platform === "ios" || platform === "android") {
    return createEmitterModule();
  }
  const constants = readNativeConstants();
  const bridge = getModulesBridge();
  return constants || bridge ? createEmitterModule() : null;
}
