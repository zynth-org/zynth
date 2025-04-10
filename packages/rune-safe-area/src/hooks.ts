import { useContext } from "solid-js";
import { SafeAreaInsetsContext, SafeAreaFrameContext } from "./SafeAreaContext";
import type { SafeAreaInsets, SafeAreaFrame } from "./types";

/**
 * Hook to access the current safe area insets.
 * Returns the insets relative to the screen edges that should be avoided.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const insets = createSafeAreaInsets();
 *   return <View style={{ paddingTop: insets.top }}>...</View>;
 * }
 * ```
 *
 * @returns Safe area insets (top, right, bottom, left)
 */
export function createSafeAreaInsets(): SafeAreaInsets {
  const accessor = useContext(SafeAreaInsetsContext);
  return accessor();
}

/**
 * Hook to access the current safe area frame.
 * Returns the frame (x, y, width, height) of the safe area within the screen.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const frame = createSafeAreaFrame();
 *   return <View style={{ width: frame.width }}>...</View>;
 * }
 * ```
 *
 * @returns Safe area frame rectangle
 */
export function createSafeAreaFrame(): SafeAreaFrame {
  const accessor = useContext(SafeAreaFrameContext);
  return accessor();
}
