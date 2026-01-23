import {
  children as resolveChildren,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
} from "solid-js";
import { Platform, OS } from "@zynth/apis";
import type { ParentComponent } from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import { scheduleOnUIAfter, setProperty, shareSignalRef } from "@zynth/core";
import { View } from "./View";

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

export type ScrollController = {
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

export type InternalScrollController = ScrollController & {
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

export function createScrollController(): ScrollController {
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

  const controller: InternalScrollController = {
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
  style?: Style;
  contentContainerStyle?: Style;
  showsVerticalScrollIndicator?: boolean;
  showsHorizontalScrollIndicator?: boolean;
  indicatorStyle?: IndicatorStyle;
  bounces?: boolean;
  overScrollBehavior?: "auto" | "always" | "never";
  directionalLockEnabled?: boolean;
  keyboardDismissMode?: KeyboardDismissMode;
  keyboardShouldPersistTaps?: KeyboardShouldPersistTaps;
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
  controller?: ScrollController;
  /** Optional native scroll guard overrides produced by `ScrollView.config(...)`. */
  config?: ScrollViewConfig;
  /** Manual content size override (width, height) for virtualized lists. */
  contentSize?: { width: number; height: number };
  testID?: string;
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
  const [local] = splitProps(props, [
    "horizontal",
    "scrollEnabled",
    "style",
    "contentContainerStyle",
    "showsVerticalScrollIndicator",
    "showsHorizontalScrollIndicator",
    "indicatorStyle",
    "bounces",
    "overScrollBehavior",
    "directionalLockEnabled",
    "eventThrottleMs",
    "eventMinDisplacementPx",
    "bridgeCoalescing",
    "decelerationRate",
    "config",
    "scrollSnapType",
    "scrollSnapAlign",
    "scrollSnapStop",
    "scrollPadding",
    "controller",
    "onScroll",
    "onScrollBeginDrag",
    "onScrollEndDrag",
    "onMomentumScrollBegin",
    "onMomentumScrollEnd",
    "onContentSizeChange",
    "contentSize",
    "testID",
    "children",
  ]);

  const axis = createMemo<Axis>(() =>
    local.horizontal ? "horizontal" : "vertical"
  );
  const resolvedChildren = resolveChildren(() => local.children);
  const containerStyle = createMemo<Style>(() => {
    const axisValue = axis();
    const userStyle = local.contentContainerStyle as Style | undefined;
    const base: Style =
      axisValue === "horizontal"
        ? {
            flexShrink: 0,
            flexDirection: "row",
            width: "auto",
            alignSelf: "flex-start",
          }
        : { flexShrink: 0 };
    return userStyle ? { ...base, ...userStyle } : base;
  });

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const controller = createMemo(
    () => local.controller as InternalScrollController | undefined
  );

  const [metrics, setMetrics] = createSignal<ScrollMetrics>(INITIAL_METRICS);
  const [isDragging, setIsDragging] = createSignal(false);
  const [isDecelerating, setIsDecelerating] = createSignal(false);

  let lastContentWidth = INITIAL_METRICS.contentSize.width;
  let lastContentHeight = INITIAL_METRICS.contentSize.height;

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

  const updateFromEvent = (
    rawEvent: any,
    state?: { dragging?: boolean; decelerating?: boolean }
  ) => {
    const event = normalizeEvent(rawEvent);
    const nextMetrics = makeMetricsFromEvent(event);
    setMetrics(nextMetrics);
    if (state?.dragging !== undefined) {
      setIsDragging(state.dragging);
    }
    if (state?.decelerating !== undefined) {
      setIsDecelerating(state.decelerating);
    }
    controller()?.__applyMetrics?.(nextMetrics, {
      dragging: state?.dragging ?? isDragging(),
      decelerating: state?.decelerating ?? isDecelerating(),
    });
    if (local.onContentSizeChange) {
      const { width, height } = nextMetrics.contentSize;
      if (width !== lastContentWidth || height !== lastContentHeight) {
        lastContentWidth = width;
        lastContentHeight = height;
        local.onContentSizeChange(width, height);
      }
    }
    return event;
  };

  const handleScroll = (event: any) => {
    const normal = updateFromEvent(event);
    local.onScroll?.(normal);
  };

  const handleScrollBeginDrag = (event: any) => {
    const normal = updateFromEvent(event, { dragging: true });
    local.onScrollBeginDrag?.(normal);
  };

  const handleScrollEndDrag = (event: any) => {
    const normal = updateFromEvent(event, { dragging: false });
    local.onScrollEndDrag?.(normal);
  };

  const handleMomentumScrollBegin = (event: any) => {
    const normal = updateFromEvent(event, { decelerating: true });
    local.onMomentumScrollBegin?.(normal);
  };

  const handleMomentumScrollEnd = (event: any) => {
    const normal = updateFromEvent(event, { decelerating: false });
    local.onMomentumScrollEnd?.(normal);
  };

  createEffect(() => {
    const ctrl = controller();
    if (!ctrl) return;
    ctrl.__setHost?.(hostNode());
    ctrl.__applyMetrics?.(metrics(), {
      dragging: isDragging(),
      decelerating: isDecelerating(),
    });
  });

  createEffect(() => {
    const node = hostNode();
    if (!node) return;

    setProperty(node, "horizontal", axis() === "horizontal");
    setProperty(node, "scrollEnabled", resolvedScrollEnabled());
    setProperty(node, "directionalLockEnabled", resolvedDirectionalLock());
    setProperty(node, "eventThrottleMs", resolvedThrottle());
    setProperty(node, "eventMinDisplacementPx", resolvedMinDisplacement());
    setProperty(node, "bridgeCoalescing", resolvedBridgeCoalescing());
    setProperty(node, "overScrollBehavior", resolvedOverScrollBehavior());
    setProperty(node, "scrollGuardConfig", local.config ?? null);

    if (local.scrollSnapType !== undefined) {
      setProperty(node, "scrollSnapType", local.scrollSnapType ?? "none");
    }
    if (local.scrollSnapAlign !== undefined) {
      setProperty(node, "scrollSnapAlign", local.scrollSnapAlign ?? null);
    }
    if (local.scrollSnapStop !== undefined) {
      setProperty(node, "scrollSnapStop", local.scrollSnapStop ?? null);
    }
    if (local.scrollPadding !== undefined) {
      setProperty(node, "scrollPadding", local.scrollPadding ?? null);
    }

    if (local.style) {
      setProperty(node, "style", local.style as any);
    }
    if (local.showsVerticalScrollIndicator !== undefined) {
      setProperty(
        node,
        "showsVerticalScrollIndicator",
        local.showsVerticalScrollIndicator
      );
    }
    if (local.showsHorizontalScrollIndicator !== undefined) {
      setProperty(
        node,
        "showsHorizontalScrollIndicator",
        local.showsHorizontalScrollIndicator
      );
    }
    if (local.indicatorStyle) {
      setProperty(node, "indicatorStyle", local.indicatorStyle);
    }
    if (local.contentSize) {
      setProperty(node, "contentSize", local.contentSize);
    }
    if (local.testID) {
      setProperty(node, "testID", local.testID);
    }
    if (local.decelerationRate !== undefined) {
      setProperty(node, "decelerationRate", local.decelerationRate);
    }

    setProperty(node, "onScroll", handleScroll);
    setProperty(node, "onScrollBeginDrag", handleScrollBeginDrag);
    setProperty(node, "onScrollEndDrag", handleScrollEndDrag);
    setProperty(node, "onMomentumScrollBegin", handleMomentumScrollBegin);
    setProperty(node, "onMomentumScrollEnd", handleMomentumScrollEnd);
  });

  onCleanup(() => {
    controller()?.__setHost?.(null);
  });

  if (Platform.OS === OS.IOS && local.contentSize) {
    return (
      <recycler-scroll-view
        ref={(node: any) => setHostNode((node as unknown as HostNode) ?? null)}
        testID={local.testID}
      >
        <View style={containerStyle()}>{resolvedChildren()}</View>
      </recycler-scroll-view>
    );
  }

  return (
    <scroll-view
      ref={(node: any) => setHostNode((node as unknown as HostNode) ?? null)}
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
