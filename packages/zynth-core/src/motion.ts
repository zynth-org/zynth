/**
 * @zynthjs/core/motion
 *
 * Public motion runtime entry point.
 *
 * Provides shared values, animation drivers, style mapper utilities, and
 * entry/exit/layout animation builders — all runtime-owned and JSI-first.
 *
 * @example
 * ```tsx
 * import { createSharedValue, createAnimatedStyle, withSpring } from "@zynthjs/core/motion";
 *
 * const scale = createSharedValue(1);
 * const style = createAnimatedStyle(() => ({
 *   transform: [{ scale: scale.value }],
 * }));
 *
 * // Drive the animation natively (no JS thread per-frame work on native):
 * scale.value = withSpring(1.2);
 *
 * <View style={style} />
 * ```
 */

// Animation runtime bridge
export {
  getAnimationHostBridge,
  isNativePlatform,
  hasNativeAnimate,
  startNativeTransition,
  stopNativeTransition,
  createNativeSharedValue,
  getNativeSharedValue,
  setNativeSharedValue,
  animateNativeSharedValue,
  cancelNativeSharedValue,
  consumeNativeAnimationCompletions,
  createNativeStyleMapper,
  updateNativeStyleMapper,
  removeNativeStyleMapper,
  SHARED_VALUE_MARKER,
  INTERPOLATION_MARKER,
} from "./animation/native";

export type {
  AnimationHostBridge,
  NativeStyleMapperConfig,
  NativeStyleValue,
  NativeTransitionConfig,
  NativeTransitionPhase,
} from "./animation/native";

// Easing
export { Easing, resolveEasing, resolveEasingName } from "./animation/easing";
export type { EasingFunction, EasingName } from "./animation/easing";

// Interpolation
export { interpolate, Extrapolation } from "./animation/interpolation";
export type { InterpolationConfig } from "./animation/interpolation";

// Animation loop
export { now, startAnimation } from "./animation/runtime";

// Shared values and animated styles
export {
  createSharedValue,
  createAnimatedStyle,
  withTiming,
  withSpring,
} from "./animation/sharedValue";

export type {
  SharedValue,
  AnimationCallback,
  TimingConfig,
  SpringConfig,
} from "./animation/sharedValue";

// Entry/exit and keyframe animations
export {
  AnimationBuilder,
  createEntryExitAnimation,
  Keyframe,
  FadeIn,
  FadeOut,
  resolveEntryExitAnimation,
  resolveStyleAnimation,
  resolveNativeEasing,
  runStyleAnimation,
  getInitialStyle,
  getFinalStyle,
} from "./animation/styleAnimations";

export type {
  EntryExitAnimation,
  EntryExitAnimationLike,
  KeyframeFrame,
  KeyframeStyle,
  ResolvedStyleAnimation,
} from "./animation/styleAnimations";

// Layout transitions
export {
  LinearTransition,
  LayoutTransitionBuilder,
  resolveLayoutTransition,
} from "./animation/layoutTransitions";

export type {
  LayoutTransitionConfig,
  LayoutTransitionLike,
  ResolvedLayoutTransition,
} from "./animation/layoutTransitions";
