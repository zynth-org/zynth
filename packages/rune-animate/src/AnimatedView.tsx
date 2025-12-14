import { View, mergeStyles, type ViewProps } from "@rune/components";
import type { HostNode, Style, StyleProp } from "@rune/core";
import { sharedNativeEventEmitter } from "@rune/core";
import {
  children,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  type Accessor,
  type ParentComponent,
} from "solid-js";
import {
  getFinalStyle,
  getInitialStyle,
  resolveNativeEasing,
  resolveStyleAnimation,
  runStyleAnimation,
  Keyframe,
  type EntryExitAnimation,
  type ResolvedStyleAnimation,
} from "./styleAnimations";
import {
  isNativePlatform,
  createNativeStyleMapper,
  updateNativeStyleMapper,
  removeNativeStyleMapper,
  startNativeTransition,
  stopNativeTransition,
  type NativeTransitionPhase,
} from "./native";

const TRANSITION_EVENT = "RuneAnimate:transitionEnd";
let nextAnimationId = 1;

export type AnimatedStyleProp = StyleProp | Accessor<StyleProp | undefined>;

export interface AnimatedViewProps extends Omit<ViewProps, "style"> {
  style?: AnimatedStyleProp;
  entering?: EntryExitAnimation | Keyframe;
  exiting?: EntryExitAnimation | Keyframe;
  visible?: boolean;
}

export const AnimatedView: ParentComponent<AnimatedViewProps> = (props) => {
  const [local, rest] = splitProps(props, [
    "style",
    "entering",
    "exiting",
    "visible",
    "children",
  ]);

  const resolvedChildren = children(() => local.children);
  const initialVisible = local.visible !== false;
  const initialEntering = resolveStyleAnimation(local.entering);
  const isNative = isNativePlatform();

  const [isMounted, setIsMounted] = createSignal(initialVisible);
  const [isExiting, setIsExiting] = createSignal(false);
  const [overrideStyle, setOverrideStyle] = createSignal<Style | undefined>(
    initialEntering ? getInitialStyle(initialEntering) : undefined
  );
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  let cancelAnimation: (() => void) | null = null;
  let activeAnimationId: number | null = null;
  let didStartEnter = false;
  let styleMapperId: number | null = null;

  const stopAnimation = (): void => {
    if (cancelAnimation) {
      cancelAnimation();
      cancelAnimation = null;
    }
  };

  const resolveStyle = (): StyleProp | undefined => {
    const style = local.style;
    if (typeof style === "function") {
      return style();
    }
    return style;
  };

  const startAnimation = (
    animation: ResolvedStyleAnimation | null,
    onComplete?: () => void
  ): void => {
    stopAnimation();
    if (!animation) {
      setOverrideStyle(undefined);
      onComplete?.();
      return;
    }

    setOverrideStyle(getInitialStyle(animation));
    cancelAnimation = runStyleAnimation(
      animation,
      (style) => {
        setOverrideStyle(style);
      },
      (finished) => {
        cancelAnimation = null;
        if (finished) {
          setOverrideStyle(getFinalStyle(animation));
          onComplete?.();
        }
      }
    );
  };

  const resolveNativeTransition = (
    input?: EntryExitAnimation | Keyframe
  ): {
    from?: Style;
    to?: Style;
    duration: number;
    delay: number;
    easing: ReturnType<typeof resolveNativeEasing>;
  } | null => {
    if (!input) return null;
    if (input instanceof Keyframe) {
      const built = input.build();
      if (built.kind !== "keyframe" || built.frames.length === 0) return null;
      const first = built.frames[0]?.style ?? {};
      const last = built.frames[built.frames.length - 1]?.style ?? {};
      return {
        from: first,
        to: last,
        duration: built.duration,
        delay: built.delay,
        easing: "easeOutCubic",
      };
    }

    const animation = input as EntryExitAnimation;
    return {
      from: animation.from ?? {},
      to: animation.to ?? {},
      duration: animation.duration ?? 300,
      delay: animation.delay ?? 0,
      easing: resolveNativeEasing(animation.easing),
    };
  };

  const startNative = (phase: NativeTransitionPhase): void => {
    const nodeId = hostNode()?.id;
    if (!nodeId) return;

    const animationInput = phase === "enter" ? local.entering : local.exiting;
    const resolved = resolveNativeTransition(animationInput);

    if (!resolved) {
      setOverrideStyle(undefined);
      if (phase === "exit") {
        setIsExiting(false);
        setIsMounted(false);
      }
      return;
    }

    setOverrideStyle(resolved.from);
    const animationId = nextAnimationId++;
    activeAnimationId = animationId;

    void startNativeTransition({
      nodeId,
      animationId,
      phase,
      from: resolved.from,
      to: resolved.to,
      duration: resolved.duration,
      delay: resolved.delay,
      easing: resolved.easing,
    });
  };

  onMount(() => {
    if (isNative) {
      const subscription = sharedNativeEventEmitter.addListener(
        TRANSITION_EVENT,
        (payload) => {
          if (!payload || typeof payload !== "object") return;
          const data = payload as {
            nodeId?: number;
            animationId?: number;
            phase?: string;
          };
          const nodeId = hostNode()?.id;
          if (!nodeId || data.nodeId !== nodeId) return;
          if (data.animationId !== activeAnimationId) return;
          if (data.phase === "enter") {
            setOverrideStyle(undefined);
          } else if (data.phase === "exit") {
            setIsExiting(false);
            setIsMounted(false);
          }
        }
      );

      onCleanup(() => {
        subscription.remove();
      });
    } else if (initialVisible && initialEntering) {
      startAnimation(initialEntering);
    }
  });

  createEffect(() => {
    const shouldShow = local.visible !== false;
    if (!isNative) {
      if (shouldShow) {
        if (!isMounted()) {
          setIsMounted(true);
          setIsExiting(false);
          startAnimation(resolveStyleAnimation(local.entering));
        }
        return;
      }

      if (isMounted() && !isExiting()) {
        const exiting = resolveStyleAnimation(local.exiting);
        if (!exiting) {
          setIsMounted(false);
          return;
        }
        setIsExiting(true);
        startAnimation(exiting, () => {
          setIsExiting(false);
          setIsMounted(false);
        });
      }
      return;
    }

    if (shouldShow) {
      if (!isMounted()) {
        setIsMounted(true);
        setIsExiting(false);
        didStartEnter = false;
      } else if (isExiting()) {
        const nodeId = hostNode()?.id;
        if (nodeId) {
          void stopNativeTransition(nodeId);
        }
        setIsExiting(false);
        didStartEnter = false;
      }
      return;
    }

    if (isMounted() && !isExiting()) {
      setIsExiting(true);
      startNative("exit");
    }
  });

  createEffect(() => {
    if (!isNative) return;
    if (!isMounted()) return;
    const nodeId = hostNode()?.id;
    if (!nodeId) return;
    if (didStartEnter) return;
    didStartEnter = true;
    startNative("enter");
  });

  onCleanup(() => {
    stopAnimation();
    const nodeId = hostNode()?.id;
    if (nodeId && isNative) {
      void stopNativeTransition(nodeId);
    }
  });

  createEffect(() => {
    if (!isNative) return;
    const styleProp = local.style;
    if (typeof styleProp !== "function") return;
    const animatedStyle = styleProp as typeof styleProp & {
      __runeAnimatedStyle?: { getMapping: () => unknown };
    };
    const mapping = animatedStyle.__runeAnimatedStyle?.getMapping();
    const nodeId = hostNode()?.id;
    if (!mapping || !nodeId) return;

    const nativeMapping = mapping as Parameters<
      typeof createNativeStyleMapper
    >[1];
    if (styleMapperId === null) {
      styleMapperId = createNativeStyleMapper(nodeId, nativeMapping);
    } else {
      updateNativeStyleMapper(styleMapperId, nativeMapping);
    }

    onCleanup(() => {
      if (styleMapperId !== null) {
        removeNativeStyleMapper(styleMapperId);
        styleMapperId = null;
      }
    });
  });

  const baseStyle = mergeStyles(resolveStyle);
  const mergedStyle = mergeStyles(resolveStyle, overrideStyle);

  if (!isMounted()) {
    return null;
  }

  return (
    <View {...rest} ref={setHostNode} style={mergedStyle()}>
      {resolvedChildren()}
    </View>
  );
};
