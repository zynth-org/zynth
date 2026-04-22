/**
 * @deprecated
 *
 * `@zynth/animate` has been consolidated into `@zynth/core` and `@zynth/components`.
 * This package now re-exports from those locations for backward compatibility
 * and **will be removed in a future release**.
 *
 * ## Migration guide
 *
 * ### Animation utilities
 * ```diff
 * - import { createSharedValue, withTiming, withSpring, createAnimatedStyle } from "@zynth/animate";
 * + import { createSharedValue, withTiming, withSpring, createAnimatedStyle } from "@zynth/core/motion";
 * ```
 *
 * ### Entry / exit / layout animations
 * ```diff
 * - import { FadeIn, FadeOut, Keyframe, LinearTransition } from "@zynth/animate";
 * + import { FadeIn, FadeOut, Keyframe, LinearTransition } from "@zynth/core/motion";
 * ```
 *
 * ### Animated.View → View
 * ```diff
 * - import { Animated } from "@zynth/animate";
 * + import { View } from "@zynth/components";
 *
 * - <Animated.View style={animatedStyle} entering={FadeIn}>
 * + <View style={animatedStyle} entering={FadeIn}>
 * ```
 *
 * @see https://zynth.dev/docs/migration/motion-gesture
 */

// Re-export all motion utilities from the canonical core entry point.
export * from "@zynth/core/motion";

// ─── AnimatedView backward-compat aliases ─────────────────────────────────────
// `View` from @zynth/components now supports animated styles + entering/exiting
// natively, making AnimatedView a thin alias.
import { View } from "@zynth/components";
import type { ViewProps } from "@zynth/components";
import type { StyleProp } from "@zynth/core";
import type { Accessor } from "solid-js";

/**
 * @deprecated Use `View` from `@zynth/components` instead.
 * `View` supports `style={createAnimatedStyle(...)}`, `entering`, `exiting`,
 * `visible`, and `layout` props directly.
 */
export { View as AnimatedView };

/**
 * @deprecated Use `ViewProps` from `@zynth/components` instead.
 */
export type { ViewProps as AnimatedViewProps };

/**
 * @deprecated Animated style prop type — use `StyleProp | (() => StyleProp | undefined)` directly.
 */
export type AnimatedStyleProp = StyleProp | Accessor<StyleProp | undefined>;

/**
 * @deprecated Use `View` from `@zynth/components` with its motion props directly.
 *
 * @example
 * ```tsx
 * // Before
 * <Animated.View style={animatedStyle} entering={FadeIn} />
 *
 * // After
 * <View style={animatedStyle} entering={FadeIn} />
 * ```
 */
export const Animated = {
  View,
} as const;
