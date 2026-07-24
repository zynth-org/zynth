import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  omit,
  untrack,
} from "solid-js";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynthjs/core";
import { setProperty, sharedNativeEventEmitter } from "@zynthjs/core";
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
} from "@zynthjs/core/motion";
import type { NativeTransitionConfig } from "@zynthjs/core/motion";
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
   * import { FadeIn } from "@zynthjs/core/motion";
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

export const View: ParentComponent<ViewProps> = (props) => {
  const local = props;

  const isNative = isNativePlatform();

  // ─── Entry / exit presence state ──────────────────────────────────────────
  const initialVisible = local.visible !== false;
  const [isMounted, setIsMounted] = createSignal(initialVisible);
  const [isExiting, setIsExiting] = createSignal(false);
  const [overrideStyle, setOverrideStyle] = createSignal<Style | undefined>(undefined);

  // ─── Host node ref ─────────────────────────────────────────────────────────
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  let cancelJsAnimation: (() => void) | null = null;
  let activeAnimationId: number | null = null;
  let didStartEnter = false;

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
  const resolvedHostExit = createMemo<
    Omit<NativeTransitionConfig, "nodeId" | "animationId" | "phase"> | null
  >(() => {
    return resolveNativeTransitionConfig(local.exiting);
  });

  const appliedOnPress = createMemo<((event: any) => void) | undefined>(() =>
    local.pointerEvents === "none" ? undefined : local.onPress,
  );

  let prevStyleRef: Style | (Style | undefined | null)[] | undefined = undefined;
  createEffect(
    () => ({
      node: hostNode(),
      currentStyle: resolvedStyle(),
      layout: resolvedLayout(),
      exiting: resolvedHostExit(),
      onLayout: local.onLayout,
      onPress: appliedOnPress(),
      accLabel: local.accessibilityLabel,
      accHint: local.accessibilityHint,
      accRole: local.accessibilityRole,
      pointerEvents: local.pointerEvents,
      glass: local.enableGlassIOS,
      tint: local.tintColor,
      testID: local.testID,
    }),
    (cfg) => {
      const node = cfg.node;
      if (!node) return;

      if (cfg.currentStyle != null) {
        let merged = cfg.currentStyle;
        if (prevStyleRef && typeof prevStyleRef === "object") {
          const currentResolved = Array.isArray(cfg.currentStyle)
            ? Object.assign({}, ...cfg.currentStyle)
            : cfg.currentStyle || {};
          const prevResolved = Array.isArray(prevStyleRef)
            ? Object.assign({}, ...prevStyleRef)
            : prevStyleRef;
          merged = { ...currentResolved };
          for (const key in prevResolved) {
            if (!(key in merged) || (merged as any)[key] === undefined) {
              (merged as any)[key] = null;
            }
          }
        }
        setProperty(node, "style", merged);
        prevStyleRef = cfg.currentStyle;
      }

      if (cfg.layout != null) setProperty(node, "layout", cfg.layout);
      if (cfg.exiting !== undefined) setProperty(node, "__zynthExiting", cfg.exiting ?? null);
      if (cfg.onLayout !== undefined) setProperty(node, "onLayout", cfg.onLayout);
      if (cfg.onPress !== undefined) setProperty(node, "onPress", cfg.onPress);
      if (cfg.accLabel !== undefined) setProperty(node, "accessibilityLabel", cfg.accLabel);
      if (cfg.accHint !== undefined) setProperty(node, "accessibilityHint", cfg.accHint);
      if (cfg.accRole !== undefined) setProperty(node, "accessibilityRole", cfg.accRole);
      if (cfg.pointerEvents !== undefined) setProperty(node, "pointerEvents", cfg.pointerEvents);
      if (cfg.glass !== undefined) setProperty(node, "enableGlassIOS", cfg.glass);
      if (cfg.tint !== undefined) setProperty(node, "tintColor", cfg.tint);
      if (cfg.testID !== undefined) setProperty(node, "testID", cfg.testID);
    }
  );

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
  const startNativePhase = (phase: "enter" | "exit"): void => {
    const nodeId = hostNode()?.id;
    if (!nodeId) return;
    const input = phase === "enter" ? local.entering : local.exiting;
    const config = resolveNativeTransitionConfig(input);
    if (!config) {
      setOverrideStyle(undefined);
      if (phase === "exit") {
        setIsExiting(false);
        setIsMounted(false);
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
  onSettled(() => {
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
          setIsExiting(false);
          setIsMounted(false);
        }
      },
    );
    onCleanup(() => subscription.remove());
  });

  // ─── Layout transition setup ───────────────────────────────────────────────
  createEffect(
    () => ({ isNat: isNative, node: hostNode(), layout: local.layout }),
    ({ isNat, node, layout }) => {
      if (!isNat || !node || !layout) return;
      const config = resolveLayoutTransition(layout);
      if (!config) return;
      setProperty(node, "__layoutTransition", JSON.stringify(config));
    }
  );

  // ─── Native onLayout listener ──────────────────────────────────────────────
  createEffect(
    () => ({ nodeId: hostNode()?.id, hasLayout: !!local.onLayout }),
    ({ nodeId, hasLayout }) => {
      if (!nodeId || !hasLayout) return;

      const subscription = sharedNativeEventEmitter.addListener(
        "onLayout",
        (event: any) => {
          if (event.nodeId === nodeId && local.onLayout) {
            local.onLayout({
              nativeEvent: { layout: event.layout },
            });
          }
        }
      );
      onCleanup(() => subscription.remove());
    }
  );

  // ─── Visibility / presence effect ──────────────────────────────────────────
  createEffect(
    () => local.visible !== false,
    (shouldShow) => {
      const mounted = untrack(isMounted);
      const exiting = untrack(isExiting);
      if (!isNative) {
        if (shouldShow) {
          if (!mounted) {
            untrack(() => {
              setIsMounted(true);
              setIsExiting(false);
            });
            startJsAnimation(resolveStyleAnimation(local.entering));
          }
          return;
        }
        if (mounted && !exiting) {
          const exitAnim = resolveStyleAnimation(local.exiting);
          if (!exitAnim) {
            untrack(() => {
              setIsMounted(false);
            });
            return;
          }
          untrack(() => setIsExiting(true));
          startJsAnimation(exitAnim, () => {
            untrack(() => {
              setIsExiting(false);
              setIsMounted(false);
            });
          });
        }
        return;
      }

      // Native path
      if (shouldShow) {
        if (!mounted) {
          untrack(() => {
            setIsMounted(true);
            setIsExiting(false);
          });
          didStartEnter = false;
        } else if (exiting) {
          const nodeId = hostNode()?.id;
          if (nodeId) void stopNativeTransition(nodeId);
          untrack(() => setIsExiting(false));
          didStartEnter = false;
        }
        return;
      }
      if (mounted && !exiting) {
        untrack(() => setIsExiting(true));
        startNativePhase("exit");
      }
    }
  );

  // ─── Native enter animation trigger ────────────────────────────────────────
  createEffect(
    () => ({ isNat: isNative, mounted: isMounted(), nodeId: hostNode()?.id }),
    ({ isNat, mounted, nodeId }) => {
      if (!isNat || !mounted || !nodeId || didStartEnter) return;
      didStartEnter = true;
      startNativePhase("enter");
    }
  );

  // ─── Ref forwarding ────────────────────────────────────────────────────────
  const refProp = (node: HostNode | null) => {
    if (node) {
      const st = resolvedStyle();
      if (st != null) setProperty(node, "style", st);
      const lay = resolvedLayout();
      if (lay != null) setProperty(node, "layout", lay);
    }
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

  // Cast Show to suppress TS2769: SolidJS 2.0 Show overloads require children
  // typed as SolidElement, but TypeScript can't match our custom renderer's
  // IntrinsicElement children type to RenderedElement in the jsx: "preserve" mode.
  const ShowAny = Show as any;
  return (
    <ShowAny when={isMounted()}>
      <view ref={refProp}>
        {props.children}
      </view>
    </ShowAny>
  );
};
