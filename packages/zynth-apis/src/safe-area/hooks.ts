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

  const getter = () => accessor();
  const insets = {
    get top() {
      return getter().top;
    },
    get right() {
      return getter().right;
    },
    get bottom() {
      return getter().bottom;
    },
    get left() {
      return getter().left;
    },
    toJSON() {
      return getter();
    },
  } as SafeAreaInsets;

  return insets;
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

  const getter = () => accessor();
  const frame = {
    get x() {
      return getter().x;
    },
    get y() {
      return getter().y;
    },
    get width() {
      return getter().width;
    },
    get height() {
      return getter().height;
    },
    toJSON() {
      return getter();
    },
  } as SafeAreaFrame;

  return frame;
}
