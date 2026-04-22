import {
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
} from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynth/core";
import { setProperty, sharedNativeEventEmitter } from "@zynth/core";
import {
  isNativePlatform,
  resolveEntryExitAnimation,
  resolveNativeEasing,
  resolveStyleAnimation,
  runStyleAnimation,
  startNativeTransition,
  stopNativeTransition,
  resolveLayoutTransition,
  Keyframe,
  type EntryExitAnimationLike,
  type ResolvedStyleAnimation,
  type LayoutTransitionLike,
} from "@zynth/core/motion";
import { createStyle } from "../hooks/createStyle";
import { useAnimatedStyleMapper } from "../hooks/useAnimatedStyleMapper";

export type LayoutRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutChangeEvent = {
  nativeEvent: {
    layout: LayoutRectangle;
  };
};

export interface ViewProps {
  style?: StyleProp | (() => StyleProp | undefined);
  /**
   * Animation to run when this view mounts or becomes visible.
   * Uses native animation driver on iOS/Android; falls back to a
   * JS-thread `runStyleAnimation` on web.
   *
   * @example
   * ```tsx
   * import { FadeIn } from "@zynth/core/motion";
   * <View entering={FadeIn} />
   * ```
   */
  entering?: EntryExitAnimationLike | Keyframe;
  /**
   * Animation to run before this view unmounts or becomes hidden.
   * The view stays mounted until the animation completes.
   */
  exiting?: EntryExitAnimationLike | Keyframe;
  /**
   * Controls visibility with optional enter/exit animations.
   * Defaults to `true`. Setting to `false` triggers the `exiting`
   * animation then unmounts the view.
   */
  visible?: boolean;
  /**
   * Layout transition to apply when Yoga re-measures this view's frame.
   * Accepts a `LayoutTransitionLike` value (e.g. `LinearTransition`).
   */
  layout?: LayoutTransitionLike | null;
  onPress?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;
  testID?: string;
  key?: string | number;
  ref?: (node: HostNode | null) => void;
}

const TRANSITION_EVENT = "ZynthAnimate:transitionEnd";
let nextAnimationId = 1;

const noopRef = () => {};

export const View: ParentComponent<ViewProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "entering",
    "exiting",
    "visible",
    "layout",
    "onPress",
    "accessibilityLabel",
    "accessibilityHint",
    "accessibilityRole",
    "pointerEvents",
    "enableGlassIOS",
    "tintColor",
    "testID",
    "onLayout",
    "ref",
  ]);

  const isNative = isNativePlatform();

  // ─── Entry / exit presence state ──────────────────────────────────────────
  const initialVisible = local.visible !== false;
  const [isMounted, setIsMounted] = createSignal(initialVisible);
  const [isExiting, setIsExiting] = createSignal(false);
  const [overrideStyle, setOverrideStyle] = createSignal<Style | undefined>(undefined);

  // ─── Host node ref ─────────────────────────────────────────────────────────
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);

  let cancelJsAnimation: (() => void) | null = null;
  let activeAnimationId: number | null = null;
  let didStartEnter = initialVisible;

  // ─── Style resolution ──────────────────────────────────────────────────────
  const resolvedBase = createStyle(() => {
    const style = local.style;
    return typeof style === "function" ? style() : style;
  });

  // Merge the base resolved style with the override produced by entry/exit animations.
  const resolvedStyle = createMemo<Style>(() => {
    const base = resolvedBase() ?? {};
    const override = overrideStyle();
    return override ? { ...base, ...override } : base;
  });

  const hasStyleAccessor = createMemo(() => typeof local.style === "function");
  const needsImperativeStyleSync = createMemo(
    () =>
      hasStyleAccessor() ||
      local.entering !== undefined ||
      local.exiting !== undefined ||
      local.visible !== undefined,
  );

  const resolvedLayout = createMemo(() =>
    resolveLayoutTransition(local.layout ?? null) ?? undefined,
  );

  // ─── Animated style mapper ─────────────────────────────────────────────────
  // Zero cost when `local.style` carries no `__zynthAnimatedStyle` metadata.
  useAnimatedStyleMapper(() => local.style, hostNode);

  // ─── Imperative style update when using an accessor-based style ────────────
  createEffect((prevStyle?: Style | (Style | undefined | null)[]) => {
    if (!needsImperativeStyleSync()) return;
    const node = hostNode();
    if (!node) return;
    const current = resolvedStyle();

    let merged = current;
    if (prevStyle && typeof prevStyle === "object") {
      const currentResolved = Array.isArray(current)
        ? Object.assign({}, ...current)
        : current || {};
      const prevResolved = Array.isArray(prevStyle)
        ? Object.assign({}, ...prevStyle)
        : prevStyle;
      merged = { ...currentResolved };
      for (const key in prevResolved) {
        if (!(key in merged) || (merged as any)[key] === undefined) {
          (merged as any)[key] = null;
        }
      }
    }

    setProperty(node, "style", merged);
    return current;
  });

  // ─── Ref forwarding ────────────────────────────────────────────────────────
  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    (local.ref ?? noopRef)(node);
  };

  onCleanup(() => {
    const node = hostNode();
    if (node && isNative) {
      void stopNativeTransition(node.id);
    }
    setHostNode(null);
    (local.ref ?? noopRef)(null);
    if (cancelJsAnimation) {
      cancelJsAnimation();
      cancelJsAnimation = null;
    }
  });

  // ─── JS-thread animation helpers ───────────────────────────────────────────
  const stopJsAnimation = (): void => {
    if (cancelJsAnimation) {
      cancelJsAnimation();
      cancelJsAnimation = null;
    }
  };

  const startJsAnimation = (
    animation: ResolvedStyleAnimation | null,
    onComplete?: () => void,
  ): void => {
    stopJsAnimation();
    if (!animation) {
      setOverrideStyle(undefined);
      onComplete?.();
      return;
    }

    const firstFrame =
      animation.kind === "timing"
        ? animation.from
        : animation.frames[0]?.style ?? {};
    setOverrideStyle(firstFrame);

    cancelJsAnimation = runStyleAnimation(
      animation,
      (style) => {
        setOverrideStyle(style);
      },
      (finished) => {
        cancelJsAnimation = null;
        if (finished) {
          const lastFrame =
            animation.kind === "timing"
              ? animation.to
              : animation.frames[animation.frames.length - 1]?.style ?? {};
          setOverrideStyle(lastFrame);
          onComplete?.();
        }
      },
    );
  };

  // ─── Native transition helpers ─────────────────────────────────────────────
  const resolveNativeTransitionConfig = (
    input?: EntryExitAnimationLike | Keyframe,
  ) => {
    if (!input) return null;
    if (input instanceof Keyframe) {
      const built = input.build();
      if (built.kind !== "keyframe" || built.frames.length === 0) return null;
      return {
        from: built.frames[0]?.style ?? {},
        to: built.frames[built.frames.length - 1]?.style ?? {},
        frames: built.frames.map((f) => ({
          at: f.at,
          style: f.style,
          easing: f.easing ? resolveNativeEasing(f.easing) : undefined,
        })),
        duration: built.duration,
        delay: built.delay,
        easing: "linear" as const,
      };
    }
    const resolved = resolveEntryExitAnimation(input as EntryExitAnimationLike);
    if (!resolved) return null;
    return {
      from: resolved.from ?? {},
      to: resolved.to ?? {},
      duration: resolved.duration ?? 300,
      delay: resolved.delay ?? 0,
      easing: resolveNativeEasing(resolved.easing),
    };
  };

  const startNativePhase = (phase: "enter" | "exit"): void => {
    const nodeId = hostNode()?.id;
    if (!nodeId) return;
    const input = phase === "enter" ? local.entering : local.exiting;
    const config = resolveNativeTransitionConfig(input);
    if (!config) {
      setOverrideStyle(undefined);
      if (phase === "exit") {
        batch(() => {
          setIsExiting(false);
          setIsMounted(false);
        });
      }
      return;
    }
    if (phase === "enter") {
      setOverrideStyle(config.from as Style);
    } else {
      setOverrideStyle(undefined);
    }
    const animationId = nextAnimationId++;
    activeAnimationId = animationId;
    void startNativeTransition({
      nodeId,
      animationId,
      phase,
      from: config.from as Style,
      to: config.to as Style,
      frames: config.frames as Parameters<typeof startNativeTransition>[0]["frames"],
      duration: config.duration,
      delay: config.delay,
      easing: config.easing,
    });
  };

  // ─── Native transition-end listener ────────────────────────────────────────
  onMount(() => {
    if (!isNative) return;
    const subscription = sharedNativeEventEmitter.addListener(
      TRANSITION_EVENT,
      (payload: unknown) => {
        if (!payload || typeof payload !== "object") return;
        const data = payload as {
          nodeId?: number | string;
          animationId?: number | string;
          phase?: string;
        };
        const nodeId = hostNode()?.id;
        if (!nodeId) return;
        const payloadNodeId =
          typeof data.nodeId === "string" ? Number(data.nodeId) : data.nodeId;
        const payloadAnimId =
          typeof data.animationId === "string"
            ? Number(data.animationId)
            : data.animationId;
        if (
          typeof payloadNodeId !== "number" ||
          Number.isNaN(payloadNodeId) ||
          payloadNodeId !== nodeId
        )
          return;
        if (
          typeof payloadAnimId !== "number" ||
          Number.isNaN(payloadAnimId) ||
          payloadAnimId !== activeAnimationId
        )
          return;
        if (data.phase === "enter") {
          setOverrideStyle(undefined);
        } else if (data.phase === "exit") {
          batch(() => {
            setIsExiting(false);
            setIsMounted(false);
          });
        }
      },
    );
    onCleanup(() => subscription.remove());
  });

  // ─── Visibility / presence effect ──────────────────────────────────────────
  createEffect(() => {
    const shouldShow = local.visible !== false;

    if (!isNative) {
      if (shouldShow) {
        if (!isMounted()) {
          setIsMounted(true);
          setIsExiting(false);
          startJsAnimation(resolveStyleAnimation(local.entering));
        }
        return;
      }
      if (isMounted() && !isExiting()) {
        const exitAnim = resolveStyleAnimation(local.exiting);
        if (!exitAnim) {
          setIsMounted(false);
          return;
        }
        setIsExiting(true);
        startJsAnimation(exitAnim, () => {
          batch(() => {
            setIsExiting(false);
            setIsMounted(false);
          });
        });
      }
      return;
    }

    // Native path
    if (shouldShow) {
      if (!isMounted()) {
        setIsMounted(true);
        setIsExiting(false);
        didStartEnter = false;
      } else if (isExiting()) {
        const nodeId = hostNode()?.id;
        if (nodeId) void stopNativeTransition(nodeId);
        setIsExiting(false);
        didStartEnter = false;
      }
      return;
    }
    if (isMounted() && !isExiting()) {
      setIsExiting(true);
      startNativePhase("exit");
    }
  });

  // ─── Native enter animation trigger ────────────────────────────────────────
  createEffect(() => {
    if (!isNative) return;
    if (!isMounted()) return;
    const nodeId = hostNode()?.id;
    if (!nodeId) return;
    if (didStartEnter) return;
    didStartEnter = true;
    startNativePhase("enter");
  });

  const appliedOnPress = createMemo(() =>
    local.pointerEvents === "none" ? undefined : local.onPress,
  );

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Show when={isMounted()}>
      <view
        style={
          (hasStyleAccessor() ? undefined : (resolvedStyle() as JSX.Element)) as JSX.Element
        }
        layout={resolvedLayout() as JSX.Element}
        onLayout={local.onLayout}
        onPress={appliedOnPress()}
        accessibilityLabel={local.accessibilityLabel}
        accessibilityHint={local.accessibilityHint}
        accessibilityRole={local.accessibilityRole}
        pointerEvents={local.pointerEvents}
        enableGlassIOS={local.enableGlassIOS ?? false}
        tintColor={local.tintColor}
        testID={local.testID}
        ref={refProp}
      >
        {props.children}
      </view>
    </Show>
  );
};
