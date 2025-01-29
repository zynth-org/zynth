import {
  JSX,
  For,
  createEffect,
  createMemo,
  createSignal,
  splitProps,
  batch,
  onCleanup,
} from "solid-js";
import type { Component } from "solid-js";
import type { Style } from "@rune/core";
import {
  ScrollView,
  type ScrollViewProps,
  createScrollController,
  type ScrollMetrics,
  type MaintainVisibleContentPosition,
  ScrollController,
} from "./ScrollView";
import { View } from "./View";

export interface FlatListController {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
  scrollToIndex(params: {
    index: number;
    viewOffset?: number;
    viewPosition?: number;
    animated?: boolean;
  }): void;
  scrollToItem(params: {
    item: any;
    viewPosition?: number;
    animated?: boolean;
  }): void;
  scrollToTop(params?: { animated?: boolean }): void;
  scrollToEnd(params?: { animated?: boolean }): void;
  recordInteraction(): void;
  recomputeViewableItems(): void;
  flashScrollIndicators(): void;
  getWindowSize(): { width: number; height: number };
  getNativeScrollRef(): any;
}

type InternalFlatListController = FlatListController & {
  __attach: (payload: {
    getItems: () => ItemEntry<any>[];
    getItemSize: () => number;
    getMetrics: () => ScrollMetrics;
    getOrientation: () => "vertical" | "horizontal";
    getInsets: () => { leading: number; trailing: number };
    getScrollController: () => ScrollController;
    requestViewabilityCheck: () => void;
    markInteraction: () => void;
    estimateOffsetForIndex: (index: number) => number;
    getContentLength: () => number;
    getViewportLength: () => number;
    findIndexForItem: (item: any) => number | null;
    getNativeScrollRef: () => any;
  }) => void;
  __detach: () => void;
  __resolvePending: () => void;
};

export function createFlatListController(): FlatListController {
  let getItems: (() => ItemEntry<any>[]) | null = null;
  let getItemSize: (() => number) | null = null;
  let getMetrics: (() => ScrollMetrics) | null = null;
  let getOrientation: (() => "vertical" | "horizontal") | null = null;
  let getInsets: (() => { leading: number; trailing: number }) | null = null;
  let getScrollController: (() => ScrollController) | null = null;
  let requestViewability: (() => void) | null = null;
  let markInteraction: (() => void) | null = null;
  let estimateOffsetForIndex: ((index: number) => number) | null = null;
  let getContentLength: (() => number) | null = null;
  let getViewportLength: (() => number) | null = null;
  let findIndexForItem: ((item: any) => number | null) | null = null;
  let getNativeRef: (() => any) | null = null;

  let pendingScroll: { offset: number; animated?: boolean } | null = null;

  const computeBounds = () => {
    let orientation: "vertical" | "horizontal" =
      getOrientation?.() ?? "vertical";
    let viewport = 0;
    let content = 0;
    if (getMetrics) {
      const metrics = getMetrics();
      viewport =
        orientation === "horizontal"
          ? metrics.viewportSize.width
          : metrics.viewportSize.height;
      content =
        orientation === "horizontal"
          ? metrics.contentSize.width
          : metrics.contentSize.height;
    }
    if (viewport <= 0 && getViewportLength) {
      viewport = Math.max(viewport, getViewportLength());
    }
    if (content <= 0 && getContentLength) {
      content = Math.max(content, getContentLength());
    }
    if (content <= 0 && getItems && getItemSize) {
      const size = getItemSize();
      if (size > 0) content = size * getItems().length;
    }
    if (viewport <= 0 && getItemSize) {
      const size = getItemSize();
      if (size > 0) viewport = size;
    }
    return { orientation, viewport, content };
  };

  const tryScrollToOffset = (
    targetOffset: number,
    animated = false
  ): boolean => {
    const { orientation, viewport, content } = computeBounds();
    if (viewport <= 0 || content <= 0) return false;
    const maxOffset = Math.max(0, content - viewport);
    const offset = Math.min(Math.max(targetOffset, 0), maxOffset);
    const controller = getScrollController?.();
    if (!controller) return false;
    if (orientation === "horizontal") {
      controller.scrollTo({ x: offset, animated });
    } else {
      controller.scrollTo({ y: offset, animated });
    }
    return true;
  };

  const controller: InternalFlatListController = {
    scrollToOffset({ offset, animated }) {
      if (!tryScrollToOffset(offset, animated)) {
        pendingScroll = { offset, animated };
      } else {
        pendingScroll = null;
      }
    },
    scrollToIndex({ index, viewOffset = 0, viewPosition = 0, animated }) {
      if (!getItems || !estimateOffsetForIndex || !getViewportLength) return;
      const items = getItems();
      if (!items.length || index < 0 || index >= items.length) return;
      const itemOffset = estimateOffsetForIndex(index);
      const viewport = getViewportLength();
      let position = viewPosition;
      if (!Number.isFinite(position)) position = 0;
      position = Math.min(Math.max(position, 0), 1);
      const target = itemOffset - viewport * position + viewOffset;
      if (!tryScrollToOffset(target, animated)) {
        pendingScroll = { offset: target, animated };
      } else {
        pendingScroll = null;
      }
    },
    scrollToItem({ item, viewPosition, animated }) {
      if (!findIndexForItem) return;
      const index = findIndexForItem(item);
      if (index == null || index < 0) return;
      controller.scrollToIndex({ index, viewPosition, animated });
    },
    scrollToTop({ animated } = {}) {
      if (!tryScrollToOffset(0, animated)) {
        pendingScroll = { offset: 0, animated };
      } else {
        pendingScroll = null;
      }
    },
    scrollToEnd({ animated } = {}) {
      if (!getContentLength || !getViewportLength) return;
      const content = getContentLength();
      const viewport = getViewportLength();
      const target = Math.max(0, content - viewport);
      if (!tryScrollToOffset(target, animated)) {
        pendingScroll = { offset: target, animated };
      } else {
        pendingScroll = null;
      }
    },
    recordInteraction() {
      markInteraction?.();
    },
    recomputeViewableItems() {
      requestViewability?.();
    },
    flashScrollIndicators() {
      const controller = getScrollController?.();
      controller?.flashScrollIndicators?.();
    },
    getWindowSize() {
      if (!getMetrics) return { width: 0, height: 0 };
      const metrics = getMetrics();
      return {
        width: metrics.viewportSize.width,
        height: metrics.viewportSize.height,
      };
    },
    getNativeScrollRef() {
      return getNativeRef?.() ?? null;
    },
    __attach(payload) {
      getItems = payload.getItems;
      getItemSize = payload.getItemSize;
      getMetrics = payload.getMetrics;
      getOrientation = payload.getOrientation;
      getInsets = payload.getInsets;
      getScrollController = payload.getScrollController;
      requestViewability = payload.requestViewabilityCheck;
      markInteraction = payload.markInteraction;
      estimateOffsetForIndex = payload.estimateOffsetForIndex;
      getContentLength = payload.getContentLength;
      getViewportLength = payload.getViewportLength;
      findIndexForItem = payload.findIndexForItem;
      getNativeRef = payload.getNativeScrollRef;
    },
    __detach() {
      getItems = null;
      getItemSize = null;
      getMetrics = null;
      getOrientation = null;
      getInsets = null;
      getScrollController = null;
      requestViewability = null;
      markInteraction = null;
      estimateOffsetForIndex = null;
      getContentLength = null;
      getViewportLength = null;
      findIndexForItem = null;
      getNativeRef = null;
      pendingScroll = null;
    },
    __resolvePending() {
      if (!pendingScroll) return;
      if (tryScrollToOffset(pendingScroll.offset, pendingScroll.animated)) {
        pendingScroll = null;
      }
    },
  };

  return controller;
}

type RenderItemInfo<T> = {
  item: T;
  index: number;
  key: string;
};

type KeyExtractor<T> = (item: T, index: number) => string;

export type FlatListProps<T> = {
  data: T[];
  renderItem: (info: RenderItemInfo<T>) => JSX.Element;
  keyExtractor?: KeyExtractor<T>;
  style?: Style;
  contentContainerStyle?: Style;
  ListHeaderComponent?: JSX.Element | Component;
  ListFooterComponent?: JSX.Element | Component;
  ListEmptyComponent?: JSX.Element | Component;
  scrollViewProps?: Partial<ScrollViewProps>;
  itemSize?: number;
  estimatedItemSize?: number;
  windowSize?: number;
  overscan?: OverscanConfig;
  onViewableItemsChanged?: OnViewableItemsChanged;
  viewabilityConfig?: ViewabilityConfig;
  viewabilityConfigCallbackPairs?: ViewabilityConfigCallbackPair[];
  viewabilityInteractionRef?: (
    api: { recordInteraction: () => void } | null
  ) => void;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
  state?: FlatListState;
  testID?: string;
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  controller?: FlatListController;
};

type ItemEntry<T> = {
  item: T;
  index: number;
  key: string;
};

export type OverscanConfig =
  | number
  | {
      pixels?: number;
      multiple?: number;
      aheadPx?: number;
      behindPx?: number;
      aheadMultiple?: number;
      behindMultiple?: number;
    };

export type ViewabilityConfig = {
  minimumViewTime?: number;
  itemVisiblePercentThreshold?: number;
  viewAreaCoveragePercentThreshold?: number;
  waitForInteraction?: boolean;
};

export type ViewToken = {
  index: number;
  key: string;
  isViewable: boolean;
  timestamp: number;
};

export type ViewabilityInfo = {
  viewableItems: ViewToken[];
  changed: ViewToken[];
};

export type OnViewableItemsChanged = (info: ViewabilityInfo) => void;

export type ViewabilityConfigCallbackPair = {
  viewabilityConfig: ViewabilityConfig;
  onViewableItemsChanged: OnViewableItemsChanged;
};

type RenderRange = {
  start: number;
  end: number;
};

type NormalizedViewabilityConfig = {
  minimumViewTime: number;
  itemVisiblePercentThreshold: number;
  viewAreaCoveragePercentThreshold: number;
  waitForInteraction: boolean;
};

type ViewabilityTracker = {
  config: NormalizedViewabilityConfig;
  callback: OnViewableItemsChanged;
  pending: Map<number, number>;
  viewable: Map<number, number>;
  hasInteracted: boolean;
};

type ViewabilityMetricsSnapshot = {
  offset: number;
  viewportSize: number;
  orientation: "vertical" | "horizontal";
  rangeStart: number;
  rangeEnd: number;
};

type MVCPConfigNormalized = {
  enabled: boolean;
  startFromBottom: boolean;
  minIndexForVisible: number;
  autoscrollToTopThreshold?: number;
  autoscrollToBottomThreshold?: number;
  animateAutoScroll: boolean;
};

type MVCPMutation = {
  type: "prepend" | "append";
  count: number;
  prevOffset: number;
  prevContentLength: number;
  prevViewport: number;
  anchorEligible: boolean;
};

type AnchorSnapshot = {
  key: string;
  index: number;
  itemOffset: number;
  screenOffset: number;
};

const DEFAULT_WINDOW_MULTIPLE = 2;
const RANGE_HYSTERESIS = 3;
const MIN_INITIAL_WINDOW_ITEMS = 12;
const MAX_DYNAMIC_OVERSCAN_ITEMS = 48;
const DEFAULT_BOUNDARY_THRESHOLD = 0.1;
const BOUNDARY_REARM_FACTOR = 1.5;
const MIN_REARM_FRACTION = 0.05;

type ScheduledTask = {
  cancel: () => void;
};

const getNow =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

const scheduleDeferred = (fn: () => void): ScheduledTask => {
  let cancelled = false;
  const runner = () => {
    if (cancelled) return;
    fn();
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(runner);
    return {
      cancel: () => {
        cancelled = true;
      },
    };
  }
  const id = setTimeout(runner, 0);
  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(id);
    },
  };
};

const scheduleFrame = (fn: () => void): ScheduledTask => {
  let cancelled = false;
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      fn();
    });
    return {
      cancel: () => {
        cancelled = true;
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(id);
        }
      },
    };
  }
  const timeoutId = setTimeout(() => {
    if (cancelled) return;
    fn();
  }, 16);
  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timeoutId);
    },
  };
};

const computeThresholdPx = (
  fraction: number | undefined,
  viewportSize: number,
  fallbackFraction: number
) => {
  if (viewportSize <= 0) return 0;
  const normalized = Math.max(0, fraction ?? fallbackFraction);
  return normalized * viewportSize;
};

const computeRearmDistance = (thresholdPx: number, viewportSize: number) => {
  const minimum = viewportSize * MIN_REARM_FRACTION;
  if (thresholdPx <= 0) {
    return Math.max(minimum, viewportSize * DEFAULT_BOUNDARY_THRESHOLD);
  }
  const base = thresholdPx * BOUNDARY_REARM_FACTOR;
  return Math.max(base, thresholdPx + minimum);
};

const normalizeViewabilityConfig = (
  config?: ViewabilityConfig
): NormalizedViewabilityConfig => ({
  minimumViewTime: Math.max(0, config?.minimumViewTime ?? 250),
  itemVisiblePercentThreshold: clamp(
    config?.itemVisiblePercentThreshold ?? 50,
    0,
    100
  ),
  viewAreaCoveragePercentThreshold: clamp(
    config?.viewAreaCoveragePercentThreshold ?? 0,
    0,
    100
  ),
  waitForInteraction: config?.waitForInteraction ?? false,
});

const normalizeMaintainVisibleContentPosition = (
  config?: MaintainVisibleContentPosition
): MVCPConfigNormalized => {
  if (!config || config.disabled) {
    return {
      enabled: false,
      startFromBottom: false,
      minIndexForVisible: 0,
      animateAutoScroll: true,
    };
  }
  return {
    enabled: true,
    startFromBottom: config.startRenderingFromBottom ?? false,
    minIndexForVisible: Math.max(0, config.minIndexForVisible ?? 0),
    autoscrollToTopThreshold: config.autoscrollToTopThreshold,
    autoscrollToBottomThreshold: config.autoscrollToBottomThreshold,
    animateAutoScroll:
      config.animateAutoScroll === undefined ? true : config.animateAutoScroll,
  };
};

const resolveThresholdPx = (
  value: number | undefined,
  viewportSize: number
): number | null => {
  if (value === undefined) return null;
  if (viewportSize <= 0) return null;
  if (value >= 0 && value <= 1) {
    return value * viewportSize;
  }
  return value;
};

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const resolveWindowMultiple = (value: number | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WINDOW_MULTIPLE;
  }
  return value;
};

const resolveOverscanPx = (
  config: OverscanConfig | undefined,
  viewport: number,
  itemSize: number
) => {
  const defaultValue = Math.max(viewport * 1.5, itemSize * 4);
  if (typeof config === "number") {
    if (!Number.isFinite(config) || config <= 0) {
      return { before: defaultValue, after: defaultValue };
    }
    const asMultiple = config <= 1 && viewport > 0 ? config * viewport : config;
    return { before: asMultiple, after: asMultiple };
  }

  if (!config) {
    return { before: defaultValue, after: defaultValue };
  }

  let beforePx = 0;
  let afterPx = 0;

  const applySymmetric = (value: number) => {
    beforePx = Math.max(beforePx, value);
    afterPx = Math.max(afterPx, value);
  };

  if (
    typeof config.aheadPx === "number" &&
    Number.isFinite(config.aheadPx) &&
    config.aheadPx > 0
  ) {
    afterPx = Math.max(afterPx, config.aheadPx);
  }
  if (
    typeof config.behindPx === "number" &&
    Number.isFinite(config.behindPx) &&
    config.behindPx > 0
  ) {
    beforePx = Math.max(beforePx, config.behindPx);
  }

  if (
    typeof config.aheadMultiple === "number" &&
    Number.isFinite(config.aheadMultiple) &&
    config.aheadMultiple > 0 &&
    viewport > 0
  ) {
    afterPx = Math.max(afterPx, config.aheadMultiple * viewport);
  }
  if (
    typeof config.behindMultiple === "number" &&
    Number.isFinite(config.behindMultiple) &&
    config.behindMultiple > 0 &&
    viewport > 0
  ) {
    beforePx = Math.max(beforePx, config.behindMultiple * viewport);
  }

  if (
    typeof config.pixels === "number" &&
    Number.isFinite(config.pixels) &&
    config.pixels > 0
  ) {
    applySymmetric(config.pixels);
  }

  if (
    typeof config.multiple === "number" &&
    Number.isFinite(config.multiple) &&
    config.multiple > 0 &&
    viewport > 0
  ) {
    applySymmetric(config.multiple * viewport);
  }

  if (beforePx <= 0) beforePx = defaultValue;
  if (afterPx <= 0) afterPx = defaultValue;

  return { before: beforePx, after: afterPx };
};

const numberFromStyle = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

const resolveAxisInsets = (
  style: Style | undefined,
  orientation: "vertical" | "horizontal"
): { leading: number; trailing: number } => {
  if (!style) {
    return { leading: 0, trailing: 0 };
  }

  const basePadding = numberFromStyle(style.padding) ?? 0;
  let leading = basePadding;
  let trailing = basePadding;

  if (orientation === "vertical") {
    const vertical = numberFromStyle(style.paddingVertical);
    if (vertical !== null) {
      leading = vertical;
      trailing = vertical;
    }
    const top = numberFromStyle(style.paddingTop);
    if (top !== null) {
      leading = top;
    }
    const bottom = numberFromStyle(style.paddingBottom);
    if (bottom !== null) {
      trailing = bottom;
    }
  } else {
    const horizontal = numberFromStyle(style.paddingHorizontal);
    if (horizontal !== null) {
      leading = horizontal;
      trailing = horizontal;
    }
    const left = numberFromStyle(style.paddingLeft);
    if (left !== null) {
      leading = left;
    }
    const right = numberFromStyle(style.paddingRight);
    if (right !== null) {
      trailing = right;
    }
  }

  return {
    leading: Number.isFinite(leading) ? leading : 0,
    trailing: Number.isFinite(trailing) ? trailing : 0,
  };
};

const renderSupplemental = (
  value: JSX.Element | Component | undefined
): JSX.Element | null => {
  if (!value) return null;
  if (typeof value === "function") {
    const ComponentValue = value as Component;
    return <ComponentValue />;
  }
  return value;
};

export type FlatListState = {
  offset: () => number;
  viewport: () => number;
  firstVisibleIndex: () => number | null;
  visibleIndices: () => number[];
  recordInteraction: () => void;
};

type InternalFlatListState = FlatListState & {
  __attach: (payload: {
    items: () => ItemEntry<any>[];
    getItemSize: () => number;
    orientation: () => "vertical" | "horizontal";
    getInsets: () => { leading: number; trailing: number };
  }) => void;
  __updateFromMetrics: (metrics: ScrollMetrics) => void;
  __setRecordInteraction: (handler: () => void) => void;
};

export function createFlatListState(): FlatListState {
  const [offset, setOffset] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  const [firstVisibleIndex, setFirstVisibleIndex] = createSignal<number | null>(
    null
  );
  const [visibleIndices, setVisibleIndices] = createSignal<number[]>([]);

  let getItems: () => ItemEntry<any>[] = () => [];
  let getItemSize: () => number = () => 0;
  let getOrientation: () => "vertical" | "horizontal" = () => "vertical";
  let getInsets: () => { leading: number; trailing: number } = () => ({
    leading: 0,
    trailing: 0,
  });
  let recordInteractionImpl: () => void = () => {};

  const updateFromMetrics = (metrics: ScrollMetrics) => {
    const orientation = getOrientation();
    const axisOffset =
      orientation === "horizontal" ? metrics.offset.x : metrics.offset.y;
    const viewportSize =
      orientation === "horizontal"
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;

    setOffset(axisOffset);
    setViewport(viewportSize);

    const items = getItems();
    const itemSize = getItemSize();

    if (itemSize > 0 && viewportSize > 0 && items.length > 0) {
      const lastPossibleIndex = items.length - 1;

      // Calculate visible range - use the same logic as render range for consistency
      const approxFirst = Math.floor(axisOffset / itemSize);
      const clampedFirst = clamp(approxFirst, 0, lastPossibleIndex);

      const approxLast = Math.ceil((axisOffset + viewportSize) / itemSize) - 1;
      const clampedLast = clamp(approxLast, clampedFirst, lastPossibleIndex);

      const firstEntry = items[clampedFirst];
      setFirstVisibleIndex(firstEntry ? firstEntry.index : null);

      const indices: number[] = [];
      for (let i = clampedFirst; i <= clampedLast; i += 1) {
        indices.push(items[i].index);
      }
      setVisibleIndices(indices);
    } else {
      const fallbackIndex = items.length ? items[0].index : null;
      setFirstVisibleIndex(fallbackIndex);
      setVisibleIndices(fallbackIndex === null ? [] : [fallbackIndex]);
    }
  };

  const state: InternalFlatListState = {
    offset,
    viewport,
    firstVisibleIndex,
    visibleIndices,
    recordInteraction: () => {
      recordInteractionImpl();
    },
    __attach(payload) {
      getItems = payload.items;
      getItemSize = payload.getItemSize;
      getOrientation = payload.orientation;
      getInsets = payload.getInsets;
    },
    __updateFromMetrics: updateFromMetrics,
    __setRecordInteraction(handler) {
      recordInteractionImpl = handler;
    },
  };

  return state;
}

export function FlatList<T>(allProps: FlatListProps<T>) {
  const [local] = splitProps(allProps, [
    "data",
    "renderItem",
    "keyExtractor",
    "style",
    "contentContainerStyle",
    "ListHeaderComponent",
    "ListFooterComponent",
    "ListEmptyComponent",
    "scrollViewProps",
    "itemSize",
    "estimatedItemSize",
    "windowSize",
    "overscan",
    "onViewableItemsChanged",
    "viewabilityConfig",
    "viewabilityConfigCallbackPairs",
    "viewabilityInteractionRef",
    "onEndReached",
    "onEndReachedThreshold",
    "onStartReached",
    "onStartReachedThreshold",
    "maintainVisibleContentPosition",
    "controller",
    "state",
    "testID",
  ]);

  const scrollController = createScrollController();
  let nativeScrollRef: any = null;
  const internalScrollController = scrollController as any;
  if (typeof internalScrollController.__setHost === "function") {
    const originalSetHost = internalScrollController.__setHost.bind(
      internalScrollController
    );
    internalScrollController.__setHost = (node: any) => {
      nativeScrollRef = node ?? null;
      originalSetHost(node);
    };
  }

  const providedController = local.controller as
    | InternalFlatListController
    | undefined;
  const internalFlatListController: InternalFlatListController =
    providedController ??
    (createFlatListController() as InternalFlatListController);

  const internalState = () => local.state as InternalFlatListState | undefined;

  const keyExtractor = createMemo<KeyExtractor<T>>(
    () =>
      local.keyExtractor ??
      ((_, index) => {
        return String(index);
      })
  );

  const items = createMemo<ItemEntry<T>[]>((prevEntries = []) => {
    const data = local.data ?? [];
    const extractor = keyExtractor();

    // 1. Create a Map of old entries for quick lookup by key
    const prevEntryMap = new Map<string, ItemEntry<T>>();
    if (prevEntries) {
      for (const entry of prevEntries) {
        prevEntryMap.set(entry.key, entry);
      }
    }

    const newEntries: ItemEntry<T>[] = [];
    const seen = new Set<string>();

    for (let index = 0; index < data.length; index++) {
      const item = data[index];
      const key = extractor(item, index);

      if (seen.has(key)) {
        console.warn(
          `[FlatList] Duplicate key detected for index ${index}: "${key}". Keys should be unique.`
        );
      }
      seen.add(key);

      const prevEntry = prevEntryMap.get(key);

      // 2. Check if we can reuse the old object
      // This is the key: we check if the item proxy and index are the same.
      if (prevEntry && prevEntry.item === item && prevEntry.index === index) {
        // 3. Reuse the existing object reference
        newEntries.push(prevEntry);
      } else {
        // 4. Create a new object only if it's new or has changed
        newEntries.push({
          item,
          index,
          key,
        });
      }
    }

    return newEntries;
  });

  const scrollProps = createMemo<Partial<ScrollViewProps>>(
    () => local.scrollViewProps ?? {}
  );

  const orientation = createMemo<"vertical" | "horizontal">(() =>
    scrollProps().horizontal ? "horizontal" : "vertical"
  );

  const [latestMetrics, setLatestMetrics] = createSignal<ScrollMetrics | null>(
    null
  );

  const containerStyleSource = createMemo<Style | undefined>(() => {
    const direct = local.contentContainerStyle as Style | undefined;
    const inherited = scrollProps().contentContainerStyle as Style | undefined;
    if (direct && inherited) {
      return { ...inherited, ...direct };
    }
    return direct ?? inherited;
  });

  const containerInsets = createMemo(() =>
    resolveAxisInsets(containerStyleSource(), orientation())
  );

  const exactItemSize = createMemo<number | null>(() => {
    const size = local.itemSize;
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
      return size;
    }
    return null;
  });

  const windowMultiple = createMemo(() =>
    resolveWindowMultiple(local.windowSize)
  );

  const overscanSetting = createMemo(() => local.overscan);

  const normalizedViewabilityPairs = createMemo<
    Array<{
      config: NormalizedViewabilityConfig;
      callback: OnViewableItemsChanged;
    }>
  >(() => {
    const result: Array<{
      config: NormalizedViewabilityConfig;
      callback: OnViewableItemsChanged;
    }> = [];
    if (typeof local.onViewableItemsChanged === "function") {
      result.push({
        config: normalizeViewabilityConfig(local.viewabilityConfig),
        callback: local.onViewableItemsChanged,
      });
    }
    const extraPairs = local.viewabilityConfigCallbackPairs ?? [];
    for (const pair of extraPairs) {
      if (pair && typeof pair.onViewableItemsChanged === "function") {
        result.push({
          config: normalizeViewabilityConfig(pair.viewabilityConfig),
          callback: pair.onViewableItemsChanged,
        });
      }
    }
    return result;
  });

  let viewabilityTrackers: ViewabilityTracker[] = [];
  let viewabilityTask: ScheduledTask | null = null;
  let lastViewabilityMetrics: ViewabilityMetricsSnapshot | null = null;
  let endArmed = typeof local.onEndReached === "function";
  let startArmed = typeof local.onStartReached === "function";
  const normalizedMVCP = createMemo(() =>
    normalizeMaintainVisibleContentPosition(
      local.maintainVisibleContentPosition
    )
  );
  let pendingMVCP: MVCPMutation | null = null;
  let lastAnchorSnapshot: AnchorSnapshot | null = null;
  let lastContentLength = 0;
  let lastViewportSize = 0;
  let lastStableScrollOffsetValue = 0;
  let startFromBottomApplied = false;
  let previousKeys: string[] = [];

  const markInteraction = () => {
    for (const tracker of viewabilityTrackers) {
      tracker.hasInteracted = true;
    }
  };

  const recordInteraction = () => {
    markInteraction();
    requestViewabilityCheck();
  };

  const clearPendingViewability = (timestamp: number) => {
    if (!viewabilityTrackers.length) return;
    const itemsArray = items();
    for (const tracker of viewabilityTrackers) {
      if (!tracker.viewable.size) {
        tracker.pending.clear();
        continue;
      }
      const changed: ViewToken[] = [];
      for (const index of tracker.viewable.keys()) {
        const entry = itemsArray[index];
        const key = entry?.key ?? String(index);
        changed.push({
          index,
          key,
          isViewable: false,
          timestamp,
        });
      }
      tracker.viewable.clear();
      tracker.pending.clear();
      if (changed.length) {
        tracker.callback({
          viewableItems: [],
          changed,
        });
      }
    }
  };

  const runViewabilityCheck = () => {
    if (!viewabilityTrackers.length || !lastViewabilityMetrics) return;
    const snapshot = lastViewabilityMetrics;
    const itemSize = resolvedItemSize();
    const itemsArray = items();
    if (itemSize <= 0 || itemsArray.length === 0) {
      clearPendingViewability(getNow());
      return;
    }

    const { rangeStart, rangeEnd } = snapshot;
    const totalItems = itemsArray.length;
    let startIndex = Math.max(0, rangeStart);
    let endIndex = Math.min(rangeEnd, totalItems - 1);
    if (endIndex < startIndex || totalItems === 0) {
      clearPendingViewability(getNow());
      return;
    }

    const viewportOffset = snapshot.offset;
    const viewportSize = snapshot.viewportSize;
    const viewportEnd = viewportOffset + viewportSize;
    const { leading } = containerInsets();
    const indicesSet = new Set<number>();
    const candidates: Array<{
      index: number;
      key: string;
      itemPercent: number;
      viewPercent: number;
    }> = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
      const entry = itemsArray[index];
      if (!entry) continue;
      const itemStart = leading + index * itemSize;
      const itemEnd = itemStart + itemSize;
      const intersection = Math.max(
        0,
        Math.min(itemEnd, viewportEnd) - Math.max(itemStart, viewportOffset)
      );
      const itemPercent = itemSize > 0 ? (intersection / itemSize) * 100 : 0;
      const viewPercent =
        viewportSize > 0 ? (intersection / viewportSize) * 100 : 0;
      candidates.push({
        index,
        key: entry.key,
        itemPercent,
        viewPercent,
      });
      indicesSet.add(index);
    }

    const timestamp = getNow();

    for (const tracker of viewabilityTrackers) {
      if (!tracker.hasInteracted) {
        tracker.pending.clear();
        tracker.viewable.clear();
        continue;
      }

      const changed: ViewToken[] = [];
      const minViewTime = tracker.config.minimumViewTime;
      const itemThreshold = tracker.config.itemVisiblePercentThreshold;
      const areaThreshold = tracker.config.viewAreaCoveragePercentThreshold;

      for (const candidate of candidates) {
        const meetsThreshold =
          candidate.itemPercent >= itemThreshold ||
          candidate.viewPercent >= areaThreshold;
        if (meetsThreshold && candidate.itemPercent > 0) {
          if (tracker.viewable.has(candidate.index)) {
            continue;
          }
          if (minViewTime <= 0) {
            tracker.viewable.set(candidate.index, timestamp);
            tracker.pending.delete(candidate.index);
            changed.push({
              index: candidate.index,
              key: candidate.key,
              isViewable: true,
              timestamp,
            });
          } else {
            const pendingStart = tracker.pending.get(candidate.index);
            if (pendingStart === undefined) {
              tracker.pending.set(candidate.index, timestamp);
            } else if (timestamp - pendingStart >= minViewTime) {
              tracker.pending.delete(candidate.index);
              tracker.viewable.set(candidate.index, timestamp);
              changed.push({
                index: candidate.index,
                key: candidate.key,
                isViewable: true,
                timestamp,
              });
            }
          }
        } else {
          tracker.pending.delete(candidate.index);
          if (tracker.viewable.has(candidate.index)) {
            tracker.viewable.delete(candidate.index);
            changed.push({
              index: candidate.index,
              key: candidate.key,
              isViewable: false,
              timestamp,
            });
          }
        }
      }

      for (const index of Array.from(tracker.pending.keys())) {
        if (!indicesSet.has(index)) {
          tracker.pending.delete(index);
        }
      }

      for (const index of Array.from(tracker.viewable.keys())) {
        if (!indicesSet.has(index)) {
          tracker.viewable.delete(index);
          const entry = itemsArray[index];
          const key = entry?.key ?? String(index);
          changed.push({
            index,
            key,
            isViewable: false,
            timestamp,
          });
        }
      }

      if (!changed.length) continue;

      const viewableItemsTokens = Array.from(tracker.viewable.entries())
        .map(([index, visibleTimestamp]) => {
          const entry = itemsArray[index];
          const key = entry?.key ?? String(index);
          return {
            index,
            key,
            isViewable: true,
            timestamp: visibleTimestamp,
          };
        })
        .sort((a, b) => a.index - b.index);

      tracker.callback({
        viewableItems: viewableItemsTokens,
        changed,
      });
    }
  };

  const requestViewabilityCheck = () => {
    if (!viewabilityTrackers.length || !lastViewabilityMetrics) return;
    if (viewabilityTask) return;
    viewabilityTask = scheduleFrame(() => {
      viewabilityTask = null;
      runViewabilityCheck();
    });
  };

  const checkBoundaries = (
    offset: number,
    viewportSize: number,
    contentLength: number
  ) => {
    const endHandler = local.onEndReached;
    const startHandler = local.onStartReached;
    if (!endHandler && !startHandler) return;

    const safeViewport = viewportSize > 0 ? viewportSize : 0;
    const safeContent = contentLength > 0 ? contentLength : 0;
    if (safeViewport <= 0 || safeContent <= 0) return;

    if (endHandler) {
      const thresholdPx = computeThresholdPx(
        local.onEndReachedThreshold,
        safeViewport,
        DEFAULT_BOUNDARY_THRESHOLD
      );
      const rearmDistance = computeRearmDistance(thresholdPx, safeViewport);
      const distanceToEnd = Math.max(0, safeContent - (offset + safeViewport));
      if (endArmed && distanceToEnd <= thresholdPx) {
        endArmed = false;
        endHandler();
      } else if (!endArmed && distanceToEnd > rearmDistance) {
        endArmed = true;
      }
    }

    if (startHandler) {
      const thresholdPx = computeThresholdPx(
        local.onStartReachedThreshold,
        safeViewport,
        DEFAULT_BOUNDARY_THRESHOLD
      );
      const rearmDistance = computeRearmDistance(thresholdPx, safeViewport);
      const distanceToStart = Math.max(0, offset);
      if (startArmed && distanceToStart <= thresholdPx) {
        startArmed = false;
        startHandler();
      } else if (!startArmed && distanceToStart > rearmDistance) {
        startArmed = true;
      }
    }
  };

  const applyMaintainVisibleContentPosition = (
    mutation: MVCPMutation,
    stableOffset: number,
    viewportSize: number,
    contentLength: number,
    axis: "vertical" | "horizontal",
    config: MVCPConfigNormalized
  ) => {
    const controller = scrollController;
    if (controller.isDragging()) {
      return false;
    }

    const itemEstimate = resolvedItemSize();
    let insertedDistance = 0;
    if (itemEstimate > 0) {
      insertedDistance = mutation.count * itemEstimate;
    } else {
      insertedDistance = Math.max(
        0,
        contentLength - mutation.prevContentLength
      );
    }

    let adjusted = false;

    if (mutation.type === "prepend" && !config.startFromBottom) {
      if (mutation.anchorEligible && insertedDistance > 0) {
        const targetOffset = Math.max(0, stableOffset + insertedDistance);
        if (Math.abs(targetOffset - stableOffset) > 0.5) {
          controller.scrollTo(
            axis === "horizontal"
              ? { x: targetOffset, animated: false }
              : { y: targetOffset, animated: false }
          );
          setLastStableOffset(targetOffset);
          lastStableScrollOffsetValue = targetOffset;
          adjusted = true;
        }
      }

      const threshold = resolveThresholdPx(
        config.autoscrollToTopThreshold,
        viewportSize
      );
      if (threshold !== null && mutation.prevOffset <= threshold) {
        const targetOffset = Math.max(0, stableOffset + insertedDistance);
        controller.scrollTo(
          axis === "horizontal"
            ? { x: targetOffset, animated: config.animateAutoScroll }
            : { y: targetOffset, animated: config.animateAutoScroll }
        );
        setLastStableOffset(targetOffset);
        lastStableScrollOffsetValue = targetOffset;
        adjusted = true;
      }
    }

    if (mutation.type === "append") {
      const threshold = resolveThresholdPx(
        config.autoscrollToBottomThreshold,
        viewportSize
      );
      const distanceToEnd = Math.max(
        0,
        contentLength - (stableOffset + viewportSize)
      );
      if (
        config.startFromBottom ||
        (threshold !== null && distanceToEnd <= threshold)
      ) {
        const targetOffset = Math.max(0, contentLength - viewportSize);
        controller.scrollTo(
          axis === "horizontal"
            ? { x: targetOffset, animated: config.animateAutoScroll }
            : { y: targetOffset, animated: config.animateAutoScroll }
        );
        setLastStableOffset(targetOffset);
        lastStableScrollOffsetValue = targetOffset;
        adjusted = true;
      }
    }

    return adjusted;
  };

  const updateAnchorSnapshot = (
    startIndex: number,
    endIndex: number,
    stableOffset: number,
    axis: "vertical" | "horizontal"
  ) => {
    const cfg = normalizedMVCP();
    if (!cfg.enabled) {
      lastAnchorSnapshot = null;
      return;
    }
    const itemsArray = items();
    if (!itemsArray.length) {
      lastAnchorSnapshot = null;
      return;
    }
    const minIndex = cfg.minIndexForVisible;
    let targetIndex: number | null = null;
    if (cfg.startFromBottom) {
      for (let idx = endIndex; idx >= startIndex; idx -= 1) {
        if (idx >= 0 && idx < itemsArray.length) {
          targetIndex = idx;
          break;
        }
      }
    } else {
      for (let idx = startIndex; idx <= endIndex; idx += 1) {
        if (idx >= minIndex) {
          targetIndex = idx;
          break;
        }
      }
    }
    if (targetIndex === null) {
      targetIndex = cfg.startFromBottom ? endIndex : startIndex;
    }
    if (targetIndex < 0 || targetIndex >= itemsArray.length) {
      lastAnchorSnapshot = null;
      return;
    }

    const entry = itemsArray[targetIndex];
    const insets = containerInsets();
    const leading = axis === "horizontal" ? insets.leading : insets.leading;
    const estimate = resolvedItemSize();
    const fallback = virtualizationItemSize();
    const sizeForOffset = estimate > 0 ? estimate : fallback > 0 ? fallback : 0;
    if (sizeForOffset <= 0) {
      lastAnchorSnapshot = null;
      return;
    }
    const itemOffset = leading + targetIndex * sizeForOffset;
    const screenOffset = itemOffset - stableOffset;
    lastAnchorSnapshot = {
      key: entry.key,
      index: targetIndex,
      itemOffset,
      screenOffset,
    };
  };

  createEffect(() => {
    const pairs = normalizedViewabilityPairs();
    if (!pairs.length) {
      viewabilityTrackers = [];
      lastViewabilityMetrics = null;
      if (viewabilityTask) {
        viewabilityTask.cancel();
        viewabilityTask = null;
      }
      return;
    }
    viewabilityTrackers = pairs.map(({ config, callback }) => ({
      config,
      callback,
      pending: new Map(),
      viewable: new Map(),
      hasInteracted: !config.waitForInteraction,
    }));
    requestViewabilityCheck();
  });

  createEffect(() => {
    const endHandler = local.onEndReached;
    const startHandler = local.onStartReached;
    endArmed = typeof endHandler === "function";
    startArmed = typeof startHandler === "function";
    void local.onEndReachedThreshold;
    void local.onStartReachedThreshold;
  });

  createEffect(() => {
    const cfg = normalizedMVCP();
    if (!cfg.enabled) {
      pendingMVCP = null;
      startFromBottomApplied = true;
    } else if (cfg.startFromBottom) {
      startFromBottomApplied = false;
    }
  });

  createEffect(() => {
    const ref = local.viewabilityInteractionRef;
    if (!ref) return;
    const api = { recordInteraction };
    ref(api);
    onCleanup(() => ref(null));
  });

  const derivedItemSize = createMemo(() => {
    const metrics = latestMetrics();
    const length = items().length;
    const userEstimate =
      local.estimatedItemSize && local.estimatedItemSize > 0
        ? local.estimatedItemSize
        : 0;
    if (!metrics || length === 0) return userEstimate;
    const axisContent =
      orientation() === "horizontal"
        ? metrics.contentSize.width
        : metrics.contentSize.height;
    if (!Number.isFinite(axisContent) || axisContent <= 0) return userEstimate;
    const { leading, trailing } = containerInsets();
    const effectiveContent =
      axisContent -
      (Number.isFinite(leading) ? leading : 0) -
      (Number.isFinite(trailing) ? trailing : 0);
    if (!Number.isFinite(effectiveContent) || effectiveContent <= 0) {
      return userEstimate;
    }
    const inferred = effectiveContent / length;
    if (!Number.isFinite(inferred) || inferred <= 0) {
      return userEstimate;
    }
    if (userEstimate > 0) {
      return userEstimate * 0.3 + inferred * 0.7;
    }
    return inferred;
  });

  const resolvedItemSize = createMemo(() => {
    const exact = exactItemSize();
    if (exact !== null) return exact;
    return derivedItemSize();
  });

  const virtualizationEnabled = createMemo(
    () => exactItemSize() !== null && items().length > 0
  );

  const virtualizationItemSize = createMemo(() => exactItemSize() ?? 0);

  const [renderRange, setRenderRange] = createSignal<RenderRange>({
    start: 0,
    end: -1,
  });

  const [lastMeasuredViewport, setLastMeasuredViewport] = createSignal(0);
  const [lastStableOffset, setLastStableOffset] = createSignal(0);
  let cachedOverscan = {
    beforeItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
    afterItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
    viewport: 0,
    itemSize: 0,
    configKey: "",
  };

  createEffect(() => {
    orientation();
    setLastMeasuredViewport(0);
    setLastStableOffset(0);
    lastStableScrollOffsetValue = 0;
    cachedOverscan = {
      beforeItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
      afterItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
      viewport: 0,
      itemSize: 0,
      configKey: "",
    };
    endArmed = typeof local.onEndReached === "function";
    startArmed = typeof local.onStartReached === "function";
  });

  const beforeSpacerSize = createMemo(() => {
    if (!virtualizationEnabled()) return 0;
    const size = virtualizationItemSize();
    if (size <= 0) return 0;
    const range = renderRange();
    if (range.start <= 0) return 0;
    return range.start * size;
  });

  const afterSpacerSize = createMemo(() => {
    if (!virtualizationEnabled()) return 0;
    const total = items().length;
    if (total === 0) return 0;
    const size = virtualizationItemSize();
    if (size <= 0) return 0;
    const range = renderRange();
    if (range.end < 0) return total * size;
    const consumed = (range.end + 1) * size;
    const totalExtent = total * size;
    return Math.max(0, totalExtent - consumed);
  });

  const beforeSpacerStyle = createMemo<Style>(() => {
    const value = beforeSpacerSize();
    const axis = orientation();
    if (value <= 0) {
      return axis === "horizontal" ? { width: 0 } : { height: 0 };
    }
    return axis === "horizontal" ? { width: value } : { height: value };
  });

  const afterSpacerStyle = createMemo<Style>(() => {
    const value = afterSpacerSize();
    const axis = orientation();
    if (value <= 0) {
      return axis === "horizontal" ? { width: 0 } : { height: 0 };
    }
    return axis === "horizontal" ? { width: value } : { height: value };
  });

  const windowedItems = createMemo(() => {
    if (!virtualizationEnabled()) {
      return items();
    }
    const source = items();
    const range = renderRange();
    if (range.end < range.start || range.end < 0) {
      return [];
    }
    return source.slice(range.start, range.end + 1);
  });

  const overscanFor = (viewportSize: number, itemSize: number) => {
    if (viewportSize <= 0 || itemSize <= 0) {
      return cachedOverscan;
    }
    const config = overscanSetting();
    const configKey = JSON.stringify(config ?? null);
    if (
      cachedOverscan.viewport === viewportSize &&
      cachedOverscan.itemSize === itemSize &&
      cachedOverscan.configKey === configKey
    ) {
      return cachedOverscan;
    }

    const resolved = resolveOverscanPx(config, viewportSize, itemSize);
    const beforeItems = clamp(
      Math.ceil(resolved.before / itemSize),
      0,
      MAX_DYNAMIC_OVERSCAN_ITEMS
    );
    const afterItems = clamp(
      Math.ceil(resolved.after / itemSize),
      0,
      MAX_DYNAMIC_OVERSCAN_ITEMS
    );

    cachedOverscan = {
      beforeItems,
      afterItems,
      viewport: viewportSize,
      itemSize,
      configKey,
    };
    return cachedOverscan;
  };

  const estimateOffsetForIndex = (index: number) => {
    const insets = containerInsets();
    const leading = Number.isFinite(insets.leading) ? insets.leading : 0;
    const size = resolvedItemSize();
    if (size > 0) {
      return Math.max(0, leading + index * size);
    }
    const metrics = scrollController.metrics();
    const axis = orientation();
    const contentLength =
      axis === "horizontal"
        ? metrics.contentSize.width
        : metrics.contentSize.height;
    const total = Math.max(1, items().length);
    if (contentLength <= 0) {
      return Math.max(0, leading);
    }
    const estimated = (contentLength / total) * index;
    return Math.max(0, leading + estimated);
  };

  const getContentLength = () => {
    const metrics = scrollController.metrics();
    return orientation() === "horizontal"
      ? metrics.contentSize.width
      : metrics.contentSize.height;
  };

  const getViewportLength = () => {
    const metrics = scrollController.metrics();
    return orientation() === "horizontal"
      ? metrics.viewportSize.width
      : metrics.viewportSize.height;
  };

  const findIndexForItem = (target: any): number | null => {
    const arr = items();
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i].item === target) {
        return i;
      }
    }
    return null;
  };

  internalFlatListController.__attach({
    getItems: items,
    getItemSize: () => resolvedItemSize(),
    getMetrics: () => scrollController.metrics(),
    getOrientation: orientation,
    getInsets: () => containerInsets(),
    getScrollController: () => scrollController,
    requestViewabilityCheck,
    markInteraction,
    estimateOffsetForIndex,
    getContentLength,
    getViewportLength,
    findIndexForItem,
    getNativeScrollRef: () => nativeScrollRef,
  });
  onCleanup(() => {
    internalFlatListController.__detach();
  });

  const classifyMutation = (prevKeys: string[], currKeys: string[]) => {
    if (prevKeys.length === 0 || currKeys.length <= prevKeys.length) {
      return null;
    }
    const growth = currKeys.length - prevKeys.length;
    let matchesPrefix = true;
    for (let i = 0; i < prevKeys.length; i += 1) {
      if (currKeys[i] !== prevKeys[i]) {
        matchesPrefix = false;
        break;
      }
    }
    if (matchesPrefix) {
      return { type: "append" as const, count: growth };
    }
    let matchesSuffix = true;
    const start = currKeys.length - prevKeys.length;
    for (let i = 0; i < prevKeys.length; i += 1) {
      if (currKeys[start + i] !== prevKeys[i]) {
        matchesSuffix = false;
        break;
      }
    }
    if (matchesSuffix) {
      return { type: "prepend" as const, count: growth };
    }
    return null;
  };

  createEffect(() => {
    const state = internalState();
    if (!state) return;
    state.__attach({
      items,
      getItemSize: () => resolvedItemSize(),
      orientation,
      getInsets: () => containerInsets(),
    });
    state.__setRecordInteraction(recordInteraction);
  });

  createEffect(() => {
    const currentItems = items();
    const currentKeys = currentItems.map((entry) => entry.key);
    const cfg = normalizedMVCP();
    if (!currentKeys.length) {
      startFromBottomApplied = cfg.startFromBottom ? false : true;
    }
    if (previousKeys.length && cfg.enabled) {
      const diff = classifyMutation(previousKeys, currentKeys);
      if (diff) {
        const anchorEligible =
          !cfg.startFromBottom && diff.type === "prepend"
            ? lastAnchorSnapshot
              ? lastAnchorSnapshot.index >= cfg.minIndexForVisible
              : false
            : cfg.startFromBottom && diff.type === "append"
            ? true
            : cfg.autoscrollToBottomThreshold !== undefined &&
              diff.type === "append";

        pendingMVCP = {
          type: diff.type,
          count: diff.count,
          prevOffset: lastStableScrollOffsetValue,
          prevContentLength: lastContentLength,
          prevViewport: lastViewportSize,
          anchorEligible,
        };
      }
    }
    previousKeys = currentKeys;
  });

  // Use a more robust approach to handle scroll metrics
  let metricsUpdateFrame: ScheduledTask | null = null;
  let lastProcessedOffset = 0;
  let consecutiveZeroOffsets = 0;
  let isScrolling = false;
  let scrollEndTimeout: number | null = null;

  const processMetricsUpdate = (metrics: ScrollMetrics) => {
    const state = internalState();
    state?.__updateFromMetrics(metrics);

    const total = items().length;

    if (!virtualizationEnabled()) {
      const axisForDisabled = orientation();
      const disabledOffset =
        axisForDisabled === "horizontal" ? metrics.offset.x : metrics.offset.y;
      const contentLengthDisabled =
        axisForDisabled === "horizontal"
          ? metrics.contentSize.width
          : metrics.contentSize.height;
      setLastStableOffset(Math.max(0, disabledOffset));
      lastStableScrollOffsetValue = Math.max(0, disabledOffset);
      lastViewportSize =
        axisForDisabled === "horizontal"
          ? metrics.viewportSize.width
          : metrics.viewportSize.height;
      lastContentLength = contentLengthDisabled;
      const end = total - 1;
      const prev = renderRange();
      if (prev.start !== 0 || prev.end !== end) {
        setRenderRange({ start: 0, end });
      }
      const viewportSize =
        axisForDisabled === "horizontal"
          ? metrics.viewportSize.width
          : metrics.viewportSize.height;
      lastViewabilityMetrics = {
        offset: Math.max(0, disabledOffset),
        viewportSize: Math.max(0, viewportSize),
        orientation: axisForDisabled,
        rangeStart: 0,
        rangeEnd: end,
      };
      requestViewabilityCheck();
      checkBoundaries(
        Math.max(0, disabledOffset),
        Math.max(
          0,
          axisForDisabled === "horizontal"
            ? metrics.viewportSize.width
            : metrics.viewportSize.height
        ),
        Math.max(0, contentLengthDisabled)
      );
      internalFlatListController.__resolvePending();
      return;
    }

    const itemSize = virtualizationItemSize();
    const axis = orientation();
    const viewportRaw =
      axis === "horizontal"
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;
    const axisOffset =
      axis === "horizontal" ? metrics.offset.x : metrics.offset.y;
    const contentLength =
      axis === "horizontal"
        ? metrics.contentSize.width
        : metrics.contentSize.height;

    // Filter out problematic offset values during fast scrolling
    const currentOffset = Math.max(0, axisOffset);

    // Detect if we're getting inconsistent offset values
    if (currentOffset === 0 && lastProcessedOffset > 0) {
      consecutiveZeroOffsets++;
      // If we get multiple consecutive zero offsets during scrolling, use the last stable offset
      if (consecutiveZeroOffsets > 2 && isScrolling) {
        metricsUpdateFrame = null;
        return; // Skip this update
      }
    } else {
      consecutiveZeroOffsets = 0;
      lastProcessedOffset = currentOffset;
      setLastStableOffset(currentOffset);
    }

    // Use stable offset for calculations
    const stableOffset =
      consecutiveZeroOffsets > 0 ? lastStableOffset() : currentOffset;
    const fallbackViewport =
      viewportRaw > 0
        ? viewportRaw
        : lastMeasuredViewport() > 0
        ? lastMeasuredViewport()
        : itemSize * MIN_INITIAL_WINDOW_ITEMS;

    const viewportSize = Math.max(itemSize, fallbackViewport);

    lastStableScrollOffsetValue = stableOffset;
    lastViewportSize = viewportSize;
    lastContentLength = contentLength;

    if (itemSize <= 0 || total === 0) {
      const end = total - 1;
      const prev = renderRange();
      if (prev.start !== 0 || prev.end !== end) {
        setRenderRange({ start: 0, end });
      }
      lastViewabilityMetrics = null;
      clearPendingViewability(getNow());
      pendingMVCP = null;
      return;
    }

    if (viewportRaw > 0) {
      setLastMeasuredViewport(viewportRaw);
    }

    const overscanInfo = overscanFor(viewportSize, itemSize);
    let overscanBeforeItems = overscanInfo.beforeItems;
    let overscanAfterItems = overscanInfo.afterItems;

    const visibleCount = Math.max(1, Math.ceil(viewportSize / itemSize));
    const windowMultipleValue = Math.max(windowMultiple(), 1);
    const targetWindowFromMultiple = Math.ceil(
      visibleCount * windowMultipleValue
    );

    // Use a more stable window calculation
    let baseBeforeCount = overscanBeforeItems;
    let baseAfterCount = overscanAfterItems;
    let baseWindowCount = visibleCount + baseBeforeCount + baseAfterCount;

    if (baseWindowCount < targetWindowFromMultiple) {
      const deficit = targetWindowFromMultiple - baseWindowCount;
      const addBefore = Math.floor(deficit / 2);
      baseBeforeCount += addBefore;
      baseAfterCount += deficit - addBefore;
      baseWindowCount = visibleCount + baseBeforeCount + baseAfterCount;
    }

    if (baseWindowCount < MIN_INITIAL_WINDOW_ITEMS) {
      const remaining = MIN_INITIAL_WINDOW_ITEMS - baseWindowCount;
      const addBefore = Math.floor(remaining / 2);
      baseBeforeCount += addBefore;
      baseAfterCount += remaining - addBefore;
      baseWindowCount = visibleCount + baseBeforeCount + baseAfterCount;
    }

    // Add hysteresis to prevent flickering at boundaries
    baseBeforeCount += RANGE_HYSTERESIS;
    baseAfterCount += RANGE_HYSTERESIS;

    const maxIndex = Math.max(total - 1, 0);
    const currentIndex = Math.floor(stableOffset / itemSize);

    let startIndex = clamp(currentIndex - baseBeforeCount, 0, maxIndex);
    let endIndex = clamp(
      currentIndex + visibleCount + baseAfterCount - 1,
      startIndex,
      maxIndex
    );

    // Ensure we always have at least the minimum number of items
    const actualCount = endIndex - startIndex + 1;
    const minimumTarget = Math.min(MIN_INITIAL_WINDOW_ITEMS, total);
    if (actualCount < minimumTarget && total > 0) {
      let needed = minimumTarget - actualCount;
      while (needed > 0 && startIndex > 0) {
        startIndex -= 1;
        needed -= 1;
      }
      while (needed > 0 && endIndex < maxIndex) {
        endIndex += 1;
        needed -= 1;
      }
    }

    const prev = renderRange();
    if (prev.start !== startIndex || prev.end !== endIndex) {
      batch(() => {
        setRenderRange({ start: startIndex, end: endIndex });
      });
    }
    lastViewabilityMetrics = {
      offset: stableOffset,
      viewportSize,
      orientation: axis,
      rangeStart: startIndex,
      rangeEnd: endIndex,
    };
    requestViewabilityCheck();
    checkBoundaries(stableOffset, viewportSize, contentLength);

    const mvcp = normalizedMVCP();
    if (mvcp.enabled) {
      if (mvcp.startFromBottom && !startFromBottomApplied) {
        const target = Math.max(0, contentLength - viewportSize);
        if (contentLength > viewportSize && !scrollController.isDragging()) {
          scrollController.scrollTo(
            axis === "horizontal"
              ? { x: target, animated: false }
              : { y: target, animated: false }
          );
          setLastStableOffset(target);
          lastStableScrollOffsetValue = target;
        }
        startFromBottomApplied = true;
      }

      if (pendingMVCP) {
        const applied = applyMaintainVisibleContentPosition(
          pendingMVCP,
          stableOffset,
          viewportSize,
          contentLength,
          axis,
          mvcp
        );
        if (applied) {
          pendingMVCP = null;
        } else if (!scrollController.isDragging()) {
          pendingMVCP = null;
        }
      }
    } else {
      pendingMVCP = null;
      startFromBottomApplied = true;
    }

    const latestMetrics = scrollController.metrics();
    const anchorOffset =
      axis === "horizontal" ? latestMetrics.offset.x : latestMetrics.offset.y;
    updateAnchorSnapshot(startIndex, endIndex, anchorOffset, axis);

    internalFlatListController.__resolvePending();

    metricsUpdateFrame = null;
  };

  const scheduleMetricsUpdate = (metrics: ScrollMetrics) => {
    if (metricsUpdateFrame) {
      metricsUpdateFrame.cancel();
    }

    metricsUpdateFrame = scheduleDeferred(() => {
      processMetricsUpdate(metrics);
      metricsUpdateFrame = null;
    });
  };

  // Handle scroll start/end to detect scrolling state
  createEffect(() => {
    const metrics = scrollController.metrics();
    setLatestMetrics(metrics);

    const axisOffset =
      orientation() === "horizontal" ? metrics.offset.x : metrics.offset.y;

    // Detect scroll start
    if (!isScrolling && Math.abs(axisOffset - lastStableOffset()) > 0.5) {
      isScrolling = true;
      consecutiveZeroOffsets = 0;
      markInteraction();
    }

    // Schedule update
    scheduleMetricsUpdate(metrics);

    // Handle scroll end detection
    if (scrollEndTimeout) {
      clearTimeout(scrollEndTimeout);
    }

    scrollEndTimeout = setTimeout(() => {
      isScrolling = false;
      consecutiveZeroOffsets = 0;
      // Force one final update with current metrics to ensure stable state
      scheduleMetricsUpdate(scrollController.metrics());
    }, 150) as unknown as number;
  });

  // Cleanup
  onCleanup(() => {
    if (metricsUpdateFrame) {
      metricsUpdateFrame.cancel();
    }
    if (scrollEndTimeout) {
      clearTimeout(scrollEndTimeout);
    }
    if (viewabilityTask) {
      viewabilityTask.cancel();
    }
  });

  return (
    <ScrollView
      {...scrollProps()}
      style={local.style}
      contentContainerStyle={containerStyleSource()}
      controller={scrollController}
      maintainVisibleContentPosition={local.maintainVisibleContentPosition}
      testID={local.testID ?? scrollProps().testID}
    >
      {renderSupplemental(local.ListHeaderComponent)}
      {virtualizationEnabled() && beforeSpacerSize() > 0 ? (
        <View style={beforeSpacerStyle()} />
      ) : null}
      <For
        each={windowedItems()}
        fallback={
          items().length === 0
            ? renderSupplemental(local.ListEmptyComponent)
            : null
        }
      >
        {(entry) => (
          <View key={entry.key}>
            {local.renderItem({
              item: entry.item,
              index: entry.index,
              key: entry.key,
            })}
          </View>
        )}
      </For>
      {virtualizationEnabled() && afterSpacerSize() > 0 ? (
        <View style={afterSpacerStyle()} />
      ) : null}
      {renderSupplemental(local.ListFooterComponent)}
    </ScrollView>
  );
}
