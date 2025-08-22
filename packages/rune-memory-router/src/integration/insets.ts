import { createMemo } from "solid-js";
import { createSafeAreaInsets } from "@rune/safe-area";

// Default header height (similar to iOS navigation bar)
export const DEFAULT_HEADER_HEIGHT = 56;

/**
 * Header metrics returned by useHeaderMetrics
 */
export interface HeaderMetrics {
  /** Total header height including safe area inset */
  height: number;
  /** Safe area top inset */
  inset: number;
}

/**
 * Hook to get header metrics for proper content padding.
 *
 * Since memory-router uses JS-based headers, this returns the safe area
 * inset plus a standard header height. Use this to add proper top padding
 * to your screen content.
 *
 * @param extraHeight - Additional height to add (e.g., for large titles)
 * @returns A reactive accessor for header metrics
 *
 * @example
 * function MyScreen() {
 *   const header = useHeaderMetrics();
 *
 *   return (
 *     <View style={{ paddingTop: header().height }}>
 *       <Text>Content</Text>
 *     </View>
 *   );
 * }
 */
export function useHeaderMetrics(extraHeight = 0): () => HeaderMetrics {
  return createMemo(() => {
    const inset = createSafeAreaInsets().top;
    return {
      inset,
      height: DEFAULT_HEADER_HEIGHT + inset + extraHeight,
    };
  });
}

/**
 * Tab bar metrics
 */
export interface TabBarMetrics {
  /** Total tab bar height including safe area inset */
  height: number;
  /** Safe area bottom inset */
  inset: number;
}

// Default tab bar height
const DEFAULT_TAB_BAR_HEIGHT = 49;

/**
 * Hook to get tab bar metrics for proper content padding.
 *
 * @param extraHeight - Additional height to add
 * @returns A reactive accessor for tab bar metrics
 */
export function useTabBarMetrics(extraHeight = 0): () => TabBarMetrics {
  return createMemo(() => {
    const inset = createSafeAreaInsets().bottom;
    return {
      inset,
      height: DEFAULT_TAB_BAR_HEIGHT + inset + extraHeight,
    };
  });
}
