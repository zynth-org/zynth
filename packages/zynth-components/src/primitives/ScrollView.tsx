import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { platform } from "@zynthjs/apis";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynthjs/core";
import { scheduleOnUIAfter, setProperty, shareSignalRef } from "@zynthjs/core";
import { View } from "./View";
import type { LayoutChangeEvent } from "./View";

export type Axis = "vertical" | "horizontal";

export type ScrollMetrics = {
  offset: { x: number; y: number };
  velocity: { x: number; y: number } | null;
  contentSize: { width: number; height: number };
  viewportSize: { width: number; height: number };
  zoomScale: number;
};

export type ScrollEvent = {
  contentOffset: { x: number; y: number };
  contentSize: { width: number; height: number };
  layoutMeasurement: { width: number; height: number };
  velocity?: { x: number; y: number } | null;
  zoomScale?: number;
};

type ScrollCommand =
  | { type: "scrollTo"; x?: number; y?: number; animated?: boolean }
  | { type: "scrollBy"; dx?: number; dy?: number; animated?: boolean }
  | { type: "stop" }
  | { type: "flashIndicators" }
  | { type: "lockAxis"; axis: Axis | null };

export type ScrollViewRef = {
  metrics: () => ScrollMetrics;
  isDragging: () => boolean;
  isDecelerating: () => boolean;
  scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void;
  ui: {
    scrollTo: (opts: {
      x?: number;
      y?: number;
      animated?: boolean;
      delayMs?: number;
    }) => void;
  };
  scrollBy: (opts: { dx?: number; dy?: number; animated?: boolean }) => void;
  stop: () => void;
  flashScrollIndicators: () => void;
  getMetricsNow: () => ScrollMetrics;
  lockAxis: (axis: Axis | null) => void;
};

export type InternalScrollViewRef = ScrollViewRef & {
  __setHost?: (node: HostNode | null) => void;
  __applyMetrics?: (
    metrics: ScrollMetrics,
    state?: { dragging?: boolean; decelerating?: boolean }
  ) => void;
};

export const INITIAL_METRICS: ScrollMetrics = {
  offset: { x: 0, y: 0 },
  velocity: null,
  contentSize: { width: 0, height: 0 },
  viewportSize: { width: 0, height: 0 },
  zoomScale: 1,
};

export function createScrollViewRef(): ScrollViewRef {
  const [metrics, setMetrics] = createSignal<ScrollMetrics>(INITIAL_METRICS);
  const [dragging, setDragging] = createSignal(false);
  const [decelerating, setDecelerating] = createSignal(false);

  let host: HostNode | null = null;
  let commandSeq = 0;

  const issueCommand = (command: ScrollCommand) => {
    if (!host) return;
    commandSeq += 1;
    setProperty(host, "__scrollCommand", {
      ...command,
      seq: commandSeq,
    });
  };

  const scrollToUI = (opts: {
    x?: number;
    y?: number;
    animated?: boolean;
    delayMs?: number;
  }) => {
    if (!host) return;
    const sharedRef = shareSignalRef(host, "node");
    if (!sharedRef) return;
    const nodeId = Number(sharedRef);
    if (!Number.isFinite(nodeId)) return;
    const hasX = typeof opts.x === "number";
    const hasY = typeof opts.y === "number";
    const x = hasX ? opts.x : 0;
    const y = hasY ? opts.y : 0;
    const animated = opts.animated ?? true;
    const delayMs = opts.delayMs ?? 0;

    scheduleOnUIAfter(() => {
      "worklet";
      const ui = globalThis.__zynth_ui_commands;
      if (ui && typeof ui.scrollTo === "function") {
        ui.scrollTo(
          nodeId,
          hasX ? x : undefined,
          hasY ? y : undefined,
          animated
        );
        return;
      }
      const bridge = globalThis.__ui;
      if (bridge && typeof bridge.setProp === "function") {
        const command = {
          type: "scrollTo",
          x: hasX ? x : undefined,
          y: hasY ? y : undefined,
          animated,
          seq: Date.now(),
        };
        bridge.setProp(nodeId, "__scrollCommand", command);
      }
    }, delayMs);
  };

  const controller: InternalScrollViewRef = {
    metrics,
    isDragging: dragging,
    isDecelerating: decelerating,
    scrollTo(opts) {
      issueCommand({
        type: "scrollTo",
        x: opts.x,
        y: opts.y,
        animated: opts.animated,
      });
    },
    ui: {
      scrollTo: scrollToUI,
    },
    scrollBy(opts) {
      issueCommand({
        type: "scrollBy",
        dx: opts.dx,
        dy: opts.dy,
        animated: opts.animated,
      });
    },
    stop() {
      issueCommand({ type: "stop" });
    },
    flashScrollIndicators() {
      issueCommand({ type: "flashIndicators" });
    },
    getMetricsNow() {
      return metrics();
    },
    lockAxis(axis) {
      issueCommand({ type: "lockAxis", axis });
    },
  };

  controller.__setHost = (node) => {
    host = node;
  };

  controller.__applyMetrics = (next, state) => {
    setMetrics(next);
    if (state?.dragging !== undefined) {
      setDragging(state.dragging);
    }
    if (state?.decelerating !== undefined) {
      setDecelerating(state.decelerating);
    }
  };

  return controller;
}

type IndicatorStyle = "default" | "black" | "white";
type KeyboardDismissMode = "none" | "on-drag" | "interactive";
type KeyboardShouldPersistTaps = "never" | "always" | "handled";

type ScrollSnapType =
  | "none"
  | {
      axis: "x" | "y" | "both";
      strictness: "mandatory" | "proximity";
    };

type ScrollSnapAlign = "start" | "center" | "end";

type ScrollPadding =
  | number
  | {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };

/**
 * Optional tuning knobs for the native scroll guard that halts runaway user flings.
 *
 * All values are optional; unspecified fields fall back to the platform defaults. A typical
 * use case is letting a `FlatList` or `ScrollView` allow longer inertial movement while still
 * preventing blank seams when the JavaScript bridge stalls.
 *
 * ```ts
 * const guard = ScrollView.config({
 *   stopVelocityThreshold: 3600,
 *   stopDistanceMultiplier: 3.25,
 * });
 * <FlatList scrollViewConfig={guard} />;
 * ```
 */
export interface ScrollViewConfig {
  /**
   * Maximum fling velocity (in px per second) tolerated before the guard considers stopping the scroll.
   * Raise the value to permit faster inertial runs; lower it to clamp sooner. Default: 7000.
   */
  stopVelocityThreshold?: number;
  /**
   * Multiplier applied to the current viewport length to derive the distance threshold. Larger values
   * require the content to travel farther before the guard intervenes. Default: 6.
   */
  stopDistanceMultiplier?: number;
  /**
   * Absolute minimum distance (in px) the content must travel before the guard can stop the fling,
   * regardless of viewport size. Default: 2500.
   */
  stopMinDistancePx?: number;
  /**
   * Cooldown window (in ms) after a guard-triggered stop before another stop will be issued. Default: 140.
   */
  stopCooldownMs?: number;
  /**
   * Time window (in ms) following the most recent user gesture during which a fling is still
   * considered "manual" and eligible for stopping. Default: 900.
   */
  stopGestureWindowMs?: number;
  /**
   * Fallback viewport length (in px) used when the native view has not reported its size yet.
   * Default: 960.
   */
  stopFallbackViewport?: number;
  /**
   * Fraction of the viewport that must be traversed before the guard updates its stable baseline.
   * Keeps the thresholds responsive without thrashing. Range: 0–1. Default: 0.05.
   */
  stopRearmFraction?: number;
  /**
   * When true (default), the guard will only stop a fling once the distance threshold has been exceeded.
   * Set to false to allow velocity alone to trigger an early stop.
   */
  stopRequiresDistance?: boolean;
}

export type MaintainVisibleContentPosition = {
  disabled?: boolean;
  startRenderingFromBottom?: boolean;
  minIndexForVisible?: number;
  autoscrollToTopThreshold?: number;
  autoscrollToBottomThreshold?: number;
  animateAutoScroll?: boolean;
};

export type ScrollViewProps = {
  horizontal?: boolean;
  scrollEnabled?: boolean;
  style?: StyleProp;
  contentContainerStyle?: StyleProp;
  showsVerticalScrollIndicator?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  indicatorStyle?: IndicatorStyle;
  bounces?: boolean;
  overScrollBehavior?: "auto" | "always" | "never";
  directionalLockEnabled?: boolean;
  keyboardDismissMode?: KeyboardDismissMode;
  keyboardShouldPersistTaps?: KeyboardShouldPersistTaps;
  onLayout?: (event: LayoutChangeEvent) => void;
  contentInset?: {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
  };
  contentInsetAdjustmentBehavior?:
    | "automatic"
    | "scrollableAxes"
    | "never"
    | "always";
  minimumZoomScale?: number;
  maximumZoomScale?: number;
  pinchGestureEnabled?: boolean;
  scrollSnapType?: ScrollSnapType;
  scrollSnapAlign?: ScrollSnapAlign | ScrollSnapAlign[];
  scrollSnapStop?: "normal" | "always";
  scrollPadding?: ScrollPadding;
  snapToInterval?: number;
  snapToOffsets?: number[];
  snapToAlignment?: ScrollSnapAlign;
  snapToStart?: boolean;
  snapToEnd?: boolean;
  disableIntervalMomentum?: boolean;
  decelerationRate?: "normal" | "fast" | number;
  stickyHeaderIndices?: number[];
  stickyHeaderHiddenOnScroll?: boolean;
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  refreshing?: boolean;
  onRefresh?: () => void;
  refreshControl?: any;
  onScroll?: (event: ScrollEvent) => void;
  onScrollBeginDrag?: (event: ScrollEvent) => void;
  onScrollEndDrag?: (event: ScrollEvent) => void;
  onMomentumScrollBegin?: (event: ScrollEvent) => void;
  onMomentumScrollEnd?: (event: ScrollEvent) => void;
  onContentSizeChange?: (width: number, height: number) => void;
  eventThrottleMs?: number;
  eventMinDisplacementPx?: number;
  bridgeCoalescing?: boolean;
  ref?: ((node: (HostNode & ScrollViewRef) | null) => void) | null;
  /** Optional native scroll guard overrides produced by `ScrollView.config(...)`. */
  config?: ScrollViewConfig;
  /** Manual content size override (width, height) for virtualized lists. */
  contentSize?: { width: number; height: number };
  testID?: string;
  inverted?: boolean;
  /**
   * The native ID of a SharedValue to be updated synchronously on the UI thread
   * with the scroll offset. This bypasses the JS bridge for high-performance animations.
   */
  contentOffsetSharedValue?: number;
};

export const normalizeEvent = (event: any): ScrollEvent => ({
  contentOffset: event?.contentOffset ?? { x: 0, y: 0 },
  contentSize: event?.contentSize ?? { width: 0, height: 0 },
  layoutMeasurement: event?.layoutMeasurement ?? { width: 0, height: 0 },
  velocity:
    event?.velocity === undefined
      ? null
      : event.velocity === null
      ? null
      : {
          x: event.velocity?.x ?? 0,
          y: event.velocity?.y ?? 0,
        },
  zoomScale: event?.zoomScale ?? 1,
});

export const makeMetricsFromEvent = (event: ScrollEvent): ScrollMetrics => ({
  offset: {
    x: event.contentOffset?.x ?? 0,
    y: event.contentOffset?.y ?? 0,
  },
  velocity: event.velocity ?? null,
  contentSize: {
    width: event.contentSize?.width ?? 0,
    height: event.contentSize?.height ?? 0,
  },
  viewportSize: {
    width: event.layoutMeasurement?.width ?? 0,
    height: event.layoutMeasurement?.height ?? 0,
  },
  zoomScale: event.zoomScale ?? 1,
});

const ScrollViewImpl: ParentComponent<ScrollViewProps> = (props) => {
  const local = props;

  const axis = createMemo<Axis>(() =>
    local.horizontal ? "horizontal" : "vertical"
  );
  const resolvedChildren = resolveChildren(() => local.children);
  const scrollViewStyle = createMemo<StyleProp>(() => {
    const base: Style = { overflow: "hidden" };
    if (!local.style) return base;
    return Array.isArray(local.style)
      ? [base, ...local.style]
      : [base, local.style];
  });
  const containerStyle = createMemo<StyleProp>(() => {
    const axisValue = axis();
    const userStyle = local.contentContainerStyle;
    const base: Style =
      axisValue === "horizontal"
        ? {
            flexShrink: 0,
            flexDirection: "row",
            width: "auto",
            alignSelf: "flex-start",
          }
        : { flexShrink: 0 };
    if (!userStyle) return base;
    return [
      base,
      ...(Array.isArray(userStyle) ? userStyle : [userStyle]),
    ] as StyleProp;
  });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });
  const imperativeRef = createScrollViewRef() as InternalScrollViewRef;
  let disposed = false;

  const assignRef = (node: (HostNode & ScrollViewRef) | null) => {
    if (typeof local.ref === "function") {
      local.ref(node);
    }
  };

  const [metrics, setMetrics] = createSignal<ScrollMetrics>(INITIAL_METRICS);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isDecelerating, setIsDecelerating] = createSignal(false);
  let initialBottomStartApplied = false;

  const resolvedScrollEnabled = createMemo(() => local.scrollEnabled ?? true);
  const resolvedDirectionalLock = createMemo(
    () => local.directionalLockEnabled ?? true
  );
  const resolvedThrottle = createMemo(() => local.eventThrottleMs ?? 16);
  const resolvedMinDisplacement = createMemo(
    () => local.eventMinDisplacementPx ?? 0
  );
  const resolvedBridgeCoalescing = createMemo(
    () => local.bridgeCoalescing ?? false
  );
  const resolvedOverScrollBehavior = createMemo(() => {
    if (local.overScrollBehavior) return local.overScrollBehavior;
    if (local.bounces === false) return "never";
    if (local.bounces === true) return "always";
    return "auto";
  });

  const handleScroll = (event: any) => {
    if (disposed) return;
    const scrollEvt = normalizeEvent(event);
    const nextMetrics = makeMetricsFromEvent(scrollEvt);
    setMetrics(nextMetrics);
    imperativeRef.__applyMetrics?.(nextMetrics, {
      dragging: isDragging(),
      decelerating: isDecelerating(),
    });
    local.onScroll?.(scrollEvt);
  };

  const handleScrollBeginDrag = (event: any) => {
    if (disposed) return;
    setIsDragging(true);
    const scrollEvt = normalizeEvent(event);
    const nextMetrics = makeMetricsFromEvent(scrollEvt);
    setMetrics(nextMetrics);
    imperativeRef.__applyMetrics?.(nextMetrics, {
      dragging: true,
      decelerating: isDecelerating(),
    });
    local.onScrollBeginDrag?.(scrollEvt);
  };

  const handleScrollEndDrag = (event: any) => {
    if (disposed) return;
    setIsDragging(false);
    const scrollEvt = normalizeEvent(event);
    const nextMetrics = makeMetricsFromEvent(scrollEvt);
    setMetrics(nextMetrics);
    imperativeRef.__applyMetrics?.(nextMetrics, {
      dragging: false,
      decelerating: isDecelerating(),
    });
    local.onScrollEndDrag?.(scrollEvt);
  };

  const handleMomentumScrollBegin = (event: any) => {
    if (disposed) return;
    setIsDecelerating(true);
    const scrollEvt = normalizeEvent(event);
    const nextMetrics = makeMetricsFromEvent(scrollEvt);
    setMetrics(nextMetrics);
    imperativeRef.__applyMetrics?.(nextMetrics, {
      dragging: isDragging(),
      decelerating: true,
    });
    local.onMomentumScrollBegin?.(scrollEvt);
  };

  const handleMomentumScrollEnd = (event: any) => {
    if (disposed) return;
    setIsDecelerating(false);
    const scrollEvt = normalizeEvent(event);
    const nextMetrics = makeMetricsFromEvent(scrollEvt);
    setMetrics(nextMetrics);
    imperativeRef.__applyMetrics?.(nextMetrics, {
      dragging: isDragging(),
      decelerating: false,
    });
    local.onMomentumScrollEnd?.(scrollEvt);
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    if (disposed) return;
    const { width, height } = event.nativeEvent.layout;
    const currentMetrics = metrics();
    if (
      currentMetrics.viewportSize.width !== width ||
      currentMetrics.viewportSize.height !== height
    ) {
      const nextMetrics: ScrollMetrics = {
        ...currentMetrics,
        viewportSize: { width, height },
      };
      untrack(() => setMetrics(nextMetrics));
      imperativeRef.__applyMetrics?.(nextMetrics, {
        dragging: isDragging(),
        decelerating: isDecelerating(),
      });
    }
    local.onLayout?.(event);
  };

  createEffect(
    () => ({
      node: hostNode(),
      m: metrics(),
      drag: isDragging(),
      decel: isDecelerating(),
    }),
    ({ node, m, drag, decel }) => {
      imperativeRef.__setHost?.(node);
      imperativeRef.__applyMetrics?.(m, {
        dragging: drag,
        decelerating: decel,
      });
    }
  );

  createEffect(
    () => ({
      node: hostNode(),
      ax: axis(),
      scrollEn: resolvedScrollEnabled(),
      lock: resolvedDirectionalLock(),
      throt: resolvedThrottle(),
      disp: resolvedMinDisplacement(),
      coalesce: resolvedBridgeCoalescing(),
      over: resolvedOverScrollBehavior(),
      cfg: local.config ?? null,
      snapType: local.scrollSnapType,
      snapAlign: local.scrollSnapAlign,
      snapStop: local.scrollSnapStop,
      padding: local.scrollPadding,
      st: scrollViewStyle() as any,
      vInd: local.showsVerticalScrollIndicator,
      hInd: local.showsHorizontalScrollIndicator,
      indSt: local.indicatorStyle,
      cSize: local.contentSize,
      testId: local.testID,
      inv: local.inverted,
      decel: local.decelerationRate,
      offsetSv: local.contentOffsetSharedValue,
    }),
    (cfg) => {
      const { node } = cfg;
      if (!node) return;

      setProperty(node, "horizontal", cfg.ax === "horizontal");
      setProperty(node, "scrollEnabled", cfg.scrollEn);
      setProperty(node, "directionalLockEnabled", cfg.lock);
      setProperty(node, "eventThrottleMs", cfg.throt);
      setProperty(node, "eventMinDisplacementPx", cfg.disp);
      setProperty(node, "bridgeCoalescing", cfg.coalesce);
      setProperty(node, "overScrollBehavior", cfg.over);
      setProperty(node, "scrollGuardConfig", cfg.cfg);

      if (cfg.snapType !== undefined) {
        setProperty(node, "scrollSnapType", cfg.snapType ?? "none");
      }
      if (cfg.snapAlign !== undefined) {
        setProperty(node, "scrollSnapAlign", cfg.snapAlign ?? null);
      }
      if (cfg.snapStop !== undefined) {
        setProperty(node, "scrollSnapStop", cfg.snapStop ?? null);
      }
      if (cfg.padding !== undefined) {
        setProperty(node, "scrollPadding", cfg.padding ?? null);
      }

      setProperty(node, "style", cfg.st);
      if (cfg.vInd !== undefined) {
        setProperty(node, "showsVerticalScrollIndicator", cfg.vInd);
      }
      if (cfg.hInd !== undefined) {
        setProperty(node, "showsHorizontalScrollIndicator", cfg.hInd);
      }
      if (cfg.indSt) {
        setProperty(node, "indicatorStyle", cfg.indSt);
      }
      if (cfg.cSize) {
        setProperty(node, "contentSize", cfg.cSize);
      }
      if (cfg.testId) {
        setProperty(node, "testID", cfg.testId);
      }
      if (cfg.inv !== undefined) {
        setProperty(node, "inverted", cfg.inv);
      }
      if (cfg.decel !== undefined) {
        setProperty(node, "decelerationRate", cfg.decel);
      }
      if (cfg.offsetSv !== undefined) {
        setProperty(node, "contentOffsetSharedValue", cfg.offsetSv);
      }

      setProperty(node, "onScroll", handleScroll);
      setProperty(node, "onScrollBeginDrag", handleScrollBeginDrag);
      setProperty(node, "onScrollEndDrag", handleScrollEndDrag);
      setProperty(node, "onMomentumScrollBegin", handleMomentumScrollBegin);
      setProperty(node, "onMomentumScrollEnd", handleMomentumScrollEnd);
      setProperty(node, "onLayout", handleLayout);
    }
  );

  createEffect(
    () => ({ cSize: local.contentSize }),
    ({ cSize }) => {
      if (!cSize) return;
      const previousMetrics = untrack(metrics);
      if (
        previousMetrics.contentSize.width === cSize.width &&
        previousMetrics.contentSize.height === cSize.height
      ) {
        return;
      }
      const nextMetrics: ScrollMetrics = {
        ...previousMetrics,
        contentSize: cSize,
      };
      setMetrics(nextMetrics);
      imperativeRef.__applyMetrics?.(nextMetrics, {
        dragging: isDragging(),
        decelerating: isDecelerating(),
      });
    }
  );

  createEffect(
    () => ({
      config: local.maintainVisibleContentPosition,
      nextMetrics: metrics(),
      ax: axis(),
      drag: isDragging(),
      decel: isDecelerating(),
    }),
    ({ config, nextMetrics, ax, drag, decel }) => {
      if (!config || config.disabled || !config.startRenderingFromBottom) {
        initialBottomStartApplied = false;
        return;
      }

      const viewport =
        ax === "horizontal"
          ? nextMetrics.viewportSize.width
          : nextMetrics.viewportSize.height;
      const content =
        ax === "horizontal"
          ? nextMetrics.contentSize.width
          : nextMetrics.contentSize.height;

      if (viewport <= 0 || content <= 0) return;
      if (drag || decel) return;

      const maxOffset = Math.max(0, content - viewport);
      if (initialBottomStartApplied) return;
      if (maxOffset <= 0) return;

      if (ax === "horizontal") {
        imperativeRef.ui.scrollTo({ x: maxOffset, animated: false });
      } else {
        imperativeRef.ui.scrollTo({ y: maxOffset, animated: false });
      }
      initialBottomStartApplied = true;
    }
  );

  onCleanup(() => {
    disposed = true;
    const node = hostNode();
    if (node) {
      setProperty(node, "onScroll", null);
      setProperty(node, "onScrollBeginDrag", null);
      setProperty(node, "onScrollEndDrag", null);
      setProperty(node, "onMomentumScrollBegin", null);
      setProperty(node, "onMomentumScrollEnd", null);
      setProperty(node, "onLayout", null);
    }
    imperativeRef.__setHost?.(null);
    assignRef(null);
  });

  if (platform.current === "ios" && local.contentSize) {
    return (
      <recycler-scroll-view
        ref={(node: any) => {
          const host = (node as unknown as HostNode) ?? null;
          setHostNode(host);
          if (host) {
            const imperativeNode = host as HostNode & ScrollViewRef;
            imperativeNode.metrics = imperativeRef.metrics;
            imperativeNode.isDragging = imperativeRef.isDragging;
            imperativeNode.isDecelerating = imperativeRef.isDecelerating;
            imperativeNode.scrollTo = imperativeRef.scrollTo;
            imperativeNode.ui = imperativeRef.ui;
            imperativeNode.scrollBy = imperativeRef.scrollBy;
            imperativeNode.stop = imperativeRef.stop;
            imperativeNode.flashScrollIndicators =
              imperativeRef.flashScrollIndicators;
            imperativeNode.getMetricsNow = imperativeRef.getMetricsNow;
            imperativeNode.lockAxis = imperativeRef.lockAxis;
            assignRef(imperativeNode);
            return;
          }
          assignRef(null);
        }}
        testID={local.testID}
      >
        <View style={containerStyle()}>{resolvedChildren()}</View>
      </recycler-scroll-view>
    );
  }

  return (
    <scroll-view
      ref={(node: any) => {
        const host = (node as unknown as HostNode) ?? null;
        setHostNode(host);
        if (host) {
          const imperativeNode = host as HostNode & ScrollViewRef;
          imperativeNode.metrics = imperativeRef.metrics;
          imperativeNode.isDragging = imperativeRef.isDragging;
          imperativeNode.isDecelerating = imperativeRef.isDecelerating;
          imperativeNode.scrollTo = imperativeRef.scrollTo;
          imperativeNode.ui = imperativeRef.ui;
          imperativeNode.scrollBy = imperativeRef.scrollBy;
          imperativeNode.stop = imperativeRef.stop;
          imperativeNode.flashScrollIndicators =
            imperativeRef.flashScrollIndicators;
          imperativeNode.getMetricsNow = imperativeRef.getMetricsNow;
          imperativeNode.lockAxis = imperativeRef.lockAxis;
          assignRef(imperativeNode);
          return;
        }
        assignRef(null);
      }}
      testID={local.testID}
    >
      <View style={containerStyle()}>{resolvedChildren()}</View>
    </scroll-view>
  );
};

type ScrollViewComponent = ParentComponent<ScrollViewProps> & {
  config: (config?: ScrollViewConfig) => ScrollViewConfig;
};

export const ScrollView = Object.assign(ScrollViewImpl, {
  /**
   * Creates a `ScrollViewConfig` object that can be reused across instances while preserving typing.
   * Useful for sharing guard presets between `ScrollView` and `FlatList`.
   */
  config(config: ScrollViewConfig = {}) {
    return { ...config };
  },
}) as ScrollViewComponent;
