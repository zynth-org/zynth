import { useContext, createMemo, type Accessor } from "solid-js";
import { KeyboardContext, KeyboardSharedContext } from "./KeyboardProvider";
import type { KeyboardState } from "./types";
import type { SharedValue } from "@zynthjs/core/motion";

/**
 * Hook to access the current keyboard state.
 * Returns a reactive accessor to the keyboard state.
 *
 * Must be used within a KeyboardProvider.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const keyboard = useKeyboard();
 *   return (
 *     <View style={{ paddingBottom: keyboard().isVisible ? keyboard().height : 0 }}>
 *       <Text>Keyboard height: {keyboard().height}</Text>
 *     </View>
 *   );
 * }
 * ```
 *
 * @returns Accessor to KeyboardState
 */
export function useKeyboard(): Accessor<KeyboardState> {
  return useContext(KeyboardContext);
}

/**
 * Hook to get just the keyboard visibility.
 * More efficient if you only need to know if keyboard is visible.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isVisible = useKeyboardVisible();
 *   return <Text>{isVisible() ? 'Keyboard is open' : 'Keyboard is closed'}</Text>;
 * }
 * ```
 */
export function useKeyboardVisible(): Accessor<boolean> {
  const keyboard = useContext(KeyboardContext);
  return createMemo(() => keyboard().isVisible);
}

/**
 * Hook to get just the keyboard height.
 * More efficient if you only need the height value.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const height = useKeyboardHeight();
 *   return <View style={{ marginBottom: height() }} />;
 * }
 * ```
 */
export function useKeyboardHeight(): Accessor<number> {
  const keyboard = useContext(KeyboardContext);
  return createMemo(() => keyboard().height);
}

/**
 * Hook to check if keyboard is currently animating.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isAnimating = useKeyboardAnimating();
 *   return <Text>{isAnimating() ? 'Animating...' : 'Stable'}</Text>;
 * }
 * ```
 */
export function useKeyboardAnimating(): Accessor<boolean> {
  const keyboard = useContext(KeyboardContext);
  return createMemo(() => keyboard().isAnimating);
}

/**
 * Hook to get the keyboard height as a shared value.
 * Used for high-performance layout animations on the native UI thread.
 */
export function useKeyboardHeightSharedValue():
  | SharedValue<number>
  | undefined {
  return useContext(KeyboardSharedContext);
}
