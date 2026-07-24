import { View } from "./View";
import type { Style } from "@zynthjs/core";
import {
  createEffect,
  createMemo,
  merge,
  type Component,
  type Element as SolidElement,
} from "solid-js";
import { createSafeAreaInsets } from "@zynthjs/apis";

export type SafeAreaEdge = "top" | "right" | "bottom" | "left";
export type SafeAreaMode = "padding" | "margin";

export interface SafeAreaViewProps {
  /**
   * Which edges to apply safe area insets to
   * @default ["top", "right", "bottom", "left"]
   */
  edges?: SafeAreaEdge[];

  /**
   * Whether to apply insets as padding or margin
   * @default "padding"
   */
  mode?: SafeAreaMode;

  /**
   * Additional styles to apply to the View
   */
  style?: Style;

  /**
   * Children to render inside the safe area
   */
  children?: SolidElement;
}

/**
 * A View component that automatically applies safe area insets.
 * Useful for quickly making content respect safe areas without manually
 * accessing the insets through hooks.
 *
 * @example
 * ```tsx
 * // Apply padding for all edges
 * <SafeAreaView>
 *   <Text>Content respects all safe areas</Text>
 * </SafeAreaView>
 *
 * // Apply padding only for top and bottom
 * <SafeAreaView edges={["top", "bottom"]}>
 *   <Text>Content respects top and bottom safe areas</Text>
 * </SafeAreaView>
 *
 * // Apply margin instead of padding
 * <SafeAreaView mode="margin" edges={["top"]}>
 *   <Text>Content has top margin for safe area</Text>
 * </SafeAreaView>
 * ```
 */
export const SafeAreaView: Component<SafeAreaViewProps> = (props) => {
  const merged = merge(
    {
      edges: ["top", "right", "bottom", "left"] as SafeAreaEdge[],
      mode: "padding" as SafeAreaMode,
    },
    props,
  );

  const insets = createSafeAreaInsets();

  // Build the style object reactively using createMemo to preserve reactivity
  const computedStyle = createMemo(() => {
    const safeAreaStyle: Style = {};
    const prefix = merged.mode === "padding" ? "padding" : "margin";
    const edges = merged.edges ?? ["top", "right", "bottom", "left"];

    if (edges.includes("top")) {
      (safeAreaStyle as any)[`${prefix}Top`] = insets.top;
    }
    if (edges.includes("right")) {
      (safeAreaStyle as any)[`${prefix}Right`] = insets.right;
    }
    if (edges.includes("bottom")) {
      (safeAreaStyle as any)[`${prefix}Bottom`] = insets.bottom;
    }
    if (edges.includes("left")) {
      (safeAreaStyle as any)[`${prefix}Left`] = insets.left;
    }

    // Merge with user styles - this is safe because we're inside createMemo
    return { ...safeAreaStyle, ...(merged.style || {}) };
  });

  return <View style={computedStyle()}>{merged.children}</View>;
};
