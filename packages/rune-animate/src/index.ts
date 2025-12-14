import { AnimatedView } from "./AnimatedView";

export { AnimatedView };
export type { AnimatedStyleProp, AnimatedViewProps } from "./AnimatedView";

export { Easing, resolveEasing, resolveEasingName } from "./easing";
export type { EasingFunction, EasingName } from "./easing";

export {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
} from "./sharedValue";
export type { AnimationCallback, SharedValue, SpringConfig, TimingConfig } from "./sharedValue";

export {
  FadeIn,
  FadeOut,
  Keyframe,
  resolveStyleAnimation,
  resolveNativeEasing,
  type EntryExitAnimation,
  type KeyframeFrame,
  type KeyframeStyle,
  type ResolvedStyleAnimation,
} from "./styleAnimations";

export const Animated = {
  View: AnimatedView,
};
