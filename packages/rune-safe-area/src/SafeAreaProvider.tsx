import {
  createSignal,
  createEffect,
  onCleanup,
  type Component,
  type JSX,
} from "solid-js";
import { SafeAreaInsetsContext, SafeAreaFrameContext } from "./SafeAreaContext";
import { getNativeSafeAreaModule } from "./NativeSafeAreaModule";
import type { InitialWindowMetrics, WindowMetrics } from "./types";

export interface SafeAreaProviderProps {
  /**
   * Optional initial metrics to prevent first-paint jumps
   * Should be provided from native bootstrap
   */
  initialMetrics?: InitialWindowMetrics;

  /**
   * Children to render with safe area context
   */
  children: JSX.Element;
}

/**
 * Provides safe area insets and frame to descendant components
 *
 * Nesting: inner providers override outer providers
 * Use when mounting UI in a distinct native container (e.g., modal)
 */
export const SafeAreaProvider: Component<SafeAreaProviderProps> = (props) => {
  const nativeModule = getNativeSafeAreaModule();

  // Warn in development if no native module is available
  if (
    !nativeModule &&
    typeof process !== "undefined" &&
    process.env?.NODE_ENV !== "production"
  ) {
    console.warn(
      "[SafeAreaProvider] Native safe area module not found. " +
        "Safe area metrics will be zeros. " +
        "Make sure the native platform has initialized the module."
    );
  }

  // Initialize with provided metrics or query native
  const getInitialMetrics = (): WindowMetrics => {
    if (props.initialMetrics) {
      return props.initialMetrics;
    }

    if (nativeModule) {
      const metrics = nativeModule.getInitialMetrics();
      if (metrics) {
        return metrics;
      }
    }

    // Fallback to zeros
    return {
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      frame: { x: 0, y: 0, width: 0, height: 0 },
    };
  };

  const [metrics, setMetrics] = createSignal<WindowMetrics>(
    getInitialMetrics()
  );

  // Subscribe to native metrics changes
  createEffect(() => {
    if (!nativeModule) {
      return;
    }

    const unsubscribe = nativeModule.addMetricsChangeListener((newMetrics) => {
      setMetrics(newMetrics);
    });

    onCleanup(unsubscribe);
  });

  return (
    <SafeAreaInsetsContext.Provider value={() => metrics().insets}>
      <SafeAreaFrameContext.Provider value={() => metrics().frame}>
        {props.children}
      </SafeAreaFrameContext.Provider>
    </SafeAreaInsetsContext.Provider>
  );
};
