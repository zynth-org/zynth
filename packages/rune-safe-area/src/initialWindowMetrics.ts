import { getNativeSafeAreaModule } from "./NativeSafeAreaModule";
import type { InitialWindowMetrics } from "./types";

/**
 * Gets the initial window metrics synchronously from the native module.
 * This should be called before the first render to prevent layout jumps.
 *
 * Returns null if:
 * - The native module is not initialized
 * - The window/root view is not attached yet
 * - Running in a non-native environment (web, etc.)
 *
 * @example
 * ```tsx
 * // In your app entry point (e.g., index.tsx)
 * import { getInitialWindowMetrics, SafeAreaProvider } from "@rune/safe-area";
 *
 * const initialMetrics = getInitialWindowMetrics();
 *
 * function App() {
 *   return (
 *     <SafeAreaProvider initialMetrics={initialMetrics}>
 *       <YourApp />
 *     </SafeAreaProvider>
 *   );
 * }
 * ```
 *
 * @returns Initial window metrics or null
 */
export function getInitialWindowMetrics(): InitialWindowMetrics {
  const nativeModule = getNativeSafeAreaModule();

  if (!nativeModule) {
    if (
      typeof process !== "undefined" &&
      process.env?.NODE_ENV !== "production"
    ) {
      console.warn(
        "[getInitialWindowMetrics] Native safe area module not found. " +
          "Returning null. Make sure the native platform has initialized the module."
      );
    }
    return null;
  }

  return nativeModule.getInitialMetrics();
}
