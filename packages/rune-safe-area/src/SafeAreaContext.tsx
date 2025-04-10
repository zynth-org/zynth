import { createContext, type Accessor } from "solid-js";
import type { SafeAreaInsets, SafeAreaFrame } from "./types";

/**
 * Context for safe area insets
 * Returns an accessor that provides current insets
 * Returns zeros if no provider is found
 */
export const SafeAreaInsetsContext = createContext<Accessor<SafeAreaInsets>>(
  () => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })
);

/**
 * Context for safe area frame
 * Returns an accessor that provides current frame
 * Returns a default window-sized frame if no provider is found
 */
export const SafeAreaFrameContext = createContext<Accessor<SafeAreaFrame>>(
  () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  })
);
