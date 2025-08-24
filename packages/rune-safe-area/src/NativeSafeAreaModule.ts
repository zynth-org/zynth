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
}

/**
 * Get the native safe area module
 * Returns null if not available (dev warning will be emitted)
 */
export function getNativeSafeAreaModule(): NativeSafeAreaModule | null {
  // Try to find the global object
  let globalObject: any;
  if (typeof globalThis !== "undefined") globalObject = globalThis;
  else if (typeof global !== "undefined") globalObject = global;
  else if (typeof window !== "undefined") globalObject = window;
  else if (typeof self !== "undefined") globalObject = self;

  if (!globalObject) {
    // console.warn("[getNativeSafeAreaModule] Could not find global object");
    return null;
  }

  const module = globalObject.__RUNE_SAFE_AREA__;

  if (!module) {
    // Debug info to help diagnose missing module
    // console.warn(
    //   "[getNativeSafeAreaModule] __RUNE_SAFE_AREA__ not found on global object. " +
    //     "Keys available: " +
    //     Object.keys(globalObject)
    //       .filter((k) => k.startsWith("__") || k.includes("RUNE"))
    //       .join(", ")
    // );
  }

  return module || null;
}
