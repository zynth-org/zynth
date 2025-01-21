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
} from "./ScrollView";
import { View } from "./View";

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
  state?: FlatListState;
  testID?: string;
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

type RenderRange = {
  start: number;
  end: number;
};

const DEFAULT_WINDOW_MULTIPLE = 2;
const RANGE_HYSTERESIS = 3;
const MIN_INITIAL_WINDOW_ITEMS = 12;
const MAX_DYNAMIC_OVERSCAN_ITEMS = 48;

type ScheduledTask = {
  cancel: () => void;
};

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
    const asMultiple =
      config <= 1 && viewport > 0 ? config * viewport : config;
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
};

type InternalFlatListState = FlatListState & {
  __attach: (payload: {
    items: () => ItemEntry<any>[];
    getItemSize: () => number;
    orientation: () => "vertical" | "horizontal";
    getInsets: () => { leading: number; trailing: number };
  }) => void;
  __updateFromMetrics: (metrics: ScrollMetrics) => void;
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
    __attach(payload) {
      getItems = payload.items;
      getItemSize = payload.getItemSize;
      getOrientation = payload.orientation;
      getInsets = payload.getInsets;
    },
    __updateFromMetrics: updateFromMetrics,
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
    "state",
    "testID",
  ]);

  const scrollController = createScrollController();
  const internalState = () => local.state as InternalFlatListState | undefined;

  const keyExtractor = createMemo<KeyExtractor<T>>(
    () =>
      local.keyExtractor ??
      ((_, index) => {
        return String(index);
      })
  );

  const items = createMemo<ItemEntry<T>[]>(() => {
    const entries = (local.data ?? []).map((item, index) => ({
      item,
      index,
      key: keyExtractor()(item, index),
    }));
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.key)) {
        console.warn(
          `[FlatList] Duplicate key detected for index ${entry.index}: "${entry.key}". Keys should be unique.`
        );
      }
      seen.add(entry.key);
    }
    return entries;
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
    cachedOverscan = {
      beforeItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
      afterItems: Math.ceil(MIN_INITIAL_WINDOW_ITEMS / 2),
      viewport: 0,
      itemSize: 0,
      configKey: "",
    };
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

  createEffect(() => {
    const state = internalState();
    if (!state) return;
    state.__attach({
      items,
      getItemSize: () => resolvedItemSize(),
      orientation,
      getInsets: () => containerInsets(),
    });
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
        axisForDisabled === "horizontal"
          ? metrics.offset.x
          : metrics.offset.y;
      setLastStableOffset(Math.max(0, disabledOffset));
      const end = total - 1;
      const prev = renderRange();
      if (prev.start !== 0 || prev.end !== end) {
        setRenderRange({ start: 0, end });
      }
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

    if (itemSize <= 0 || total === 0) {
      const end = total - 1;
      const prev = renderRange();
      if (prev.start !== 0 || prev.end !== end) {
        setRenderRange({ start: 0, end });
      }
      return;
    }

    if (viewportRaw > 0) {
      setLastMeasuredViewport(viewportRaw);
    }

    const fallbackViewport =
      viewportRaw > 0
        ? viewportRaw
        : lastMeasuredViewport() > 0
        ? lastMeasuredViewport()
        : itemSize * MIN_INITIAL_WINDOW_ITEMS;

    const viewportSize = Math.max(itemSize, fallbackViewport);

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
    let baseWindowCount =
      visibleCount + baseBeforeCount + baseAfterCount;

    if (baseWindowCount < targetWindowFromMultiple) {
      const deficit = targetWindowFromMultiple - baseWindowCount;
      const addBefore = Math.floor(deficit / 2);
      baseBeforeCount += addBefore;
      baseAfterCount += deficit - addBefore;
      baseWindowCount =
        visibleCount + baseBeforeCount + baseAfterCount;
    }

    if (baseWindowCount < MIN_INITIAL_WINDOW_ITEMS) {
      const remaining = MIN_INITIAL_WINDOW_ITEMS - baseWindowCount;
      const addBefore = Math.floor(remaining / 2);
      baseBeforeCount += addBefore;
      baseAfterCount += remaining - addBefore;
      baseWindowCount =
        visibleCount + baseBeforeCount + baseAfterCount;
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
  });

  return (
    <ScrollView
      {...scrollProps()}
      style={local.style}
      contentContainerStyle={containerStyleSource()}
      controller={scrollController}
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
