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

function createEmitterModule(): NativeSafeAreaModule | null {
  const initial = readNativeConstants() ?? readFromBridge();
  if (!initial) return null;
  let latest = initial;

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
  return createEmitterModule();
}
