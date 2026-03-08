import { AnimatedView } from "./AnimatedView";

export { AnimatedView };
export type { AnimatedStyleProp, AnimatedViewProps } from "./AnimatedView";

export { Easing, resolveEasing, resolveEasingName } from "./easing";
export type { EasingFunction, EasingName } from "./easing";

export {
  createSharedValue,
  createAnimatedStyle,
  withTiming,
  withSpring,
} from "./sharedValue";
export type { AnimationCallback, SharedValue, SpringConfig, TimingConfig } from "./sharedValue";

export { interpolate, Extrapolation } from "./interpolation";
export type { InterpolationConfig } from "./interpolation";
export { getAnimationHostBridge } from "./native";
export type { AnimationHostBridge } from "./native";

export {
  AnimationBuilder,
  createEntryExitAnimation,
  FadeIn,
  FadeOut,
  Keyframe,
  resolveEntryExitAnimation,
  resolveStyleAnimation,
  resolveNativeEasing,
  type EntryExitAnimation,
  type EntryExitAnimationLike,
  type KeyframeFrame,
  type KeyframeStyle,
  type ResolvedStyleAnimation,
} from "./styleAnimations";

export {
  LinearTransition,
  type LayoutTransitionConfig,
  type LayoutTransitionLike,
  type ResolvedLayoutTransition,
  resolveLayoutTransition,
} from "./layoutTransitions";

export const Animated = {
  View: AnimatedView,
};
