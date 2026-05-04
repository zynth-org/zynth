import {
  For,
  JSX,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynthjs/core";
import { withHostBatch } from "@zynthjs/core";

import {
  ScrollEvent,
  ScrollView,
  ScrollViewProps,
  ScrollViewRef,
} from "./ScrollView";
import { LayoutChangeEvent, View } from "./View";

export type VirtualListRenderItemInfo<T> = {
  item: T;
  index: number;
};

export type ItemLayout = { length: number; offset: number; index: number };
export type GetItemLayout<T> = (
  data: readonly T[] | null | undefined,
  index: number
) => ItemLayout;

export type VirtualListScrollToOffsetParams = {
  animated?: boolean;
  offset: number;
};

export type VirtualListScrollToIndexParams = {
  animated?: boolean;
  index: number;
  viewOffset?: number;
  viewPosition?: number;
};

export type VirtualListScrollToItemParams<T> = {
  animated?: boolean;
  item: T;
  viewOffset?: number;
  viewPosition?: number;
};

export type VirtualListScrollToIndexFailedInfo = {
  averageItemLength: number;
  highestMeasuredFrameIndex: number;
  index: number;
};

export type VirtualListEdgeReachedInfo = {
  distanceFromEnd?: number;
  distanceFromStart?: number;
};

/**
 * Imperative handle exposed through `ref`, extending the native scroll host
 * with list-aware navigation helpers.
 */
export type VirtualListRef<T> = ScrollViewRef & {
  scrollToEnd: (params?: { animated?: boolean }) => void;
  scrollToIndex: (params: VirtualListScrollToIndexParams) => void;
  scrollToItem: (params: VirtualListScrollToItemParams<T>) => void;
  scrollToOffset: (params: VirtualListScrollToOffsetParams) => void;
};

type VirtualListSlot = JSX.Element | null | undefined;
type Range = { first: number; last: number };
type RowMetric = { index: number; length: number; offset: number };

const EMPTY_RANGE: Range = { first: 0, last: -1 };
const DEFAULT_INITIAL_RENDER = 10;
const DEFAULT_WINDOW_SIZE = 5;
const DEFAULT_ESTIMATED_ITEM = 56;
const DEFAULT_DYNAMIC_ESTIMATED_ITEM = 88;
const DEFAULT_DYNAMIC_WINDOW_SIZE = 2;
const DEFAULT_MAX_DYNAMIC_WINDOW_ROWS = 60;
const DEFAULT_MAX_TO_RENDER_PER_BATCH = 4;
const DEFAULT_UPDATE_CELLS_BATCHING_PERIOD = 0;
const SCROLL_IDLE_DELAY_MS = 120;
const DEBUG_LOG_INTERVAL_MS = 120;
const DEBUG_MEASUREMENT_LOG_INTERVAL_MS = 250;
const EPSILON = 0.001;

const hasNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const isRangeEqual = (left: Range, right: Range): boolean =>
  left.first === right.first && left.last === right.last;

const normalizeRange = (range: Range, itemCount: number): Range => {
  if (itemCount <= 0) {
    return EMPTY_RANGE;
  }
  const first = clamp(range.first, 0, itemCount - 1);
  const last = clamp(range.last, first, itemCount - 1);
  return { first, last };
};

const rangeSize = (range: Range): number =>
  range.last < range.first ? 0 : range.last - range.first + 1;

const countAddedRows = (previous: Range, next: Range): number => {
  if (next.last < next.first) return 0;
  if (previous.last < previous.first) {
    return next.last - next.first + 1;
  }
  const overlap = Math.max(
    0,
    Math.min(next.last, previous.last) -
      Math.max(next.first, previous.first) +
      1
  );
  return next.last - next.first + 1 - overlap;
};

const limitRangeExpansion = (
  previous: Range,
  next: Range,
  maxAddedRows: number
): Range => {
  if (maxAddedRows <= 0) return next;
  if (rangeSize(previous) === 0) return next;
  if (next.last < previous.first || next.first > previous.last) return next;

  const addedRows = countAddedRows(previous, next);
  if (addedRows <= maxAddedRows) return next;

  const overlapFirst = Math.max(previous.first, next.first);
  const overlapLast = Math.min(previous.last, next.last);
  let first = overlapFirst;
  let last = overlapLast;
  let remaining = maxAddedRows;

  const beforeNeeded = Math.max(0, overlapFirst - next.first);
  const afterNeeded = Math.max(0, next.last - overlapLast);
  const preferAfter = afterNeeded >= beforeNeeded;

  if (preferAfter && afterNeeded > 0) {
    const after = Math.min(afterNeeded, remaining);
    last += after;
    remaining -= after;
  }

  if (beforeNeeded > 0 && remaining > 0) {
    const before = Math.min(beforeNeeded, remaining);
    first -= before;
    remaining -= before;
  }

  if (!preferAfter && afterNeeded > 0 && remaining > 0) {
    const after = Math.min(afterNeeded, remaining);
    last += after;
  }

  return { first, last };
};

const nowMs = (): number => Date.now();

const resolvePadding = (
  style?: StyleProp
): {
  bottom: number;
  left: number;
  right: number;
  top: number;
} => {
  const merged: Style = {};
  if (Array.isArray(style)) {
    for (const entry of style) {
      if (entry && typeof entry === "object") {
        Object.assign(merged, entry);
      }
    }
  } else if (style && typeof style === "object") {
    Object.assign(merged, style);
  }

  const padding = hasNumber(merged.padding) ? merged.padding : 0;

  let top = padding;
  let bottom = padding;
  let left = padding;
  let right = padding;

  if (hasNumber(merged.paddingVertical)) {
    top = merged.paddingVertical;
    bottom = merged.paddingVertical;
  }
  if (hasNumber(merged.paddingHorizontal)) {
    left = merged.paddingHorizontal;
    right = merged.paddingHorizontal;
  }
  if (hasNumber(merged.paddingTop)) top = merged.paddingTop;
  if (hasNumber(merged.paddingBottom)) bottom = merged.paddingBottom;
  if (hasNumber(merged.paddingLeft)) left = merged.paddingLeft;
  if (hasNumber(merged.paddingRight)) right = merged.paddingRight;

  return { bottom, left, right, top };
};

const compactStyles = (
  ...styles: Array<StyleProp | null | undefined>
): StyleProp | undefined => {
  const flattened: Array<Style | null | undefined> = [];
  for (const style of styles) {
    if (Array.isArray(style)) {
      for (const entry of style) {
        flattened.push(entry);
      }
      continue;
    }
    flattened.push(style);
  }
  const hasValue = flattened.some(
    (entry) => entry !== null && entry !== undefined
  );
  return hasValue ? flattened : undefined;
};

const defaultKeyExtractor = (item: unknown, index: number): string => {
  if (typeof item === "object" && item !== null) {
    const record = item as Record<string, unknown>;
    if (typeof record.key === "string" || typeof record.key === "number") {
      return String(record.key);
    }
    if (typeof record.id === "string" || typeof record.id === "number") {
      return String(record.id);
    }
  }
  return String(index);
};

const renderSlot = (slot: VirtualListSlot): JSX.Element | null => {
  if (slot === undefined || slot === null) return null;
  return slot;
};

const createInversionStyle = (horizontal: boolean): Style => {
  if (horizontal) {
    return { transform: [{ scaleX: -1 }] };
  }
  return { transform: [{ scaleY: -1 }] };
};

const resolveInitialRange = (
  itemCount: number,
  initialScrollIndex: number | undefined,
  itemsPerRow: number,
  initialNumToRender: number | undefined
): Range => {
  if (itemCount <= 0) return EMPTY_RANGE;
  const batchSize = Math.max(1, initialNumToRender ?? DEFAULT_INITIAL_RENDER);
  const totalRows = Math.ceil(itemCount / itemsPerRow);
  const startRow =
    initialScrollIndex === undefined
      ? 0
      : clamp(Math.floor(initialScrollIndex / itemsPerRow), 0, totalRows - 1);
  return normalizeRange(
    {
      first: startRow,
      last: startRow + batchSize - 1,
    },
    totalRows
  );
};

/**
 * VirtualList is a measured, spacer-based virtualizer tuned for Zynth's fast
 * render path. It keeps the mounted window narrow while preserving RN-like
 * list affordances such as `scrollToIndex`, `initialScrollIndex`, `windowSize`,
 * `maxToRenderPerBatch`, and transform-based `inverted`.
 */
export interface VirtualListProps<T>
  extends Omit<ScrollViewProps, "children" | "contentSize" | "ref"> {
  /** Immutable item source rendered by index. */
  data: readonly T[];
  /** Optional marker prop mirroring RN's API when callers want a forced refresh. */
  extraData?: unknown;
  /** Synchronous layout lookup for deterministic scrolling and fast range calculation. */
  getItemLayout?: GetItemLayout<T>;
  /** Enables horizontal virtualization. Multi-column layouts are clamped to one column in this mode. */
  horizontal?: boolean;
  /** Seeds the first scroll position. Works best together with `getItemLayout`. */
  initialScrollIndex?: number;
  /** Number of items to mount immediately before measured windowing takes over. */
  initialNumToRender?: number;
  /** Reverses the visual direction using transforms, matching RN's inverted list model. */
  inverted?: boolean;
  /** Stable key derivation for cell identity. */
  keyExtractor?: (item: T, index: number) => string | number;
  /** Empty-state element mounted when `data.length === 0`. */
  ListEmptyComponent?: VirtualListSlot;
  /** Footer element mounted after the virtualized content. */
  ListFooterComponent?: VirtualListSlot;
  /** Optional footer wrapper styling. */
  ListFooterComponentStyle?: StyleProp;
  /** Header element mounted before the virtualized content. */
  ListHeaderComponent?: VirtualListSlot;
  /** Optional header wrapper styling. */
  ListHeaderComponentStyle?: StyleProp;
  /** Upper bound for newly mounted rows during each expansion step. */
  maxToRenderPerBatch?: number;
  /** Number of columns per row for vertical lists. */
  numColumns?: number;
  /** Invoked when scrolling approaches the logical end of the dataset. */
  onEndReached?: (info: { distanceFromEnd: number }) => void;
  /** Threshold in viewport lengths for the trailing edge callback. */
  onEndReachedThreshold?: number;
  /** Called when `scrollToIndex` cannot resolve an exact target. */
  onScrollToIndexFailed?: (info: VirtualListScrollToIndexFailedInfo) => void;
  /** Invoked when scrolling approaches the logical start of the dataset. */
  onStartReached?: (info: { distanceFromStart: number }) => void;
  /** Threshold in viewport lengths for the leading edge callback. */
  onStartReachedThreshold?: number;
  /** Legacy compatibility knob that extends the computed window by extra rows on each side. */
  overscan?: number;
  /** Estimated single-item size used until real measurements arrive. */
  estimatedItemSize?: number;
  /** Rendered between rows and included in row measurement. */
  ItemSeparatorComponent?: VirtualListSlot;
  /** Styling applied to each multi-column row wrapper. */
  columnWrapperStyle?: StyleProp;
  /** Enables imperative access to the underlying scroll host plus list helpers. */
  ref?: ((node: (HostNode & VirtualListRef<T>) | null) => void) | null;
  /** Row renderer. */
  renderItem: (info: VirtualListRenderItemInfo<T>) => JSX.Element;
  /** Virtualization kill switch for debugging or tiny datasets. */
  disableVirtualization?: boolean;
  /** Compatibility prop preserved for API parity. */
  removeClippedSubviews?: boolean;
  /** Delay between incremental window expansion passes. */
  updateCellsBatchingPeriod?: number;
  /** Total render window size expressed in visible-length units. */
  windowSize?: number;
}

export function VirtualList<T>(props: VirtualListProps<T>) {
  const [scrollNode, setScrollNode] = createSignal<
    (HostNode & ScrollViewRef) | null
  >(null);
  const [viewportSize, setViewportSize] = createSignal(
    { width: 0, height: 0 },
    {
      equals: (left, right) =>
        left.width === right.width && left.height === right.height,
    }
  );
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [scrollVelocity, setScrollVelocity] = createSignal(0);
  const [headerLength, setHeaderLength] = createSignal(0);
  const [footerLength, setFooterLength] = createSignal(0);
  const [measurementVersion, setMeasurementVersion] = createSignal(0);
  const [renderRange, setRenderRange] = createSignal<Range>(EMPTY_RANGE);

  const rowMetrics = new Map<number, RowMetric>();
  const rowLayoutHandlers = new Map<
    number,
    (event: LayoutChangeEvent) => void
  >();
  let measuredRowCount = 0;
  let measuredRowLengthTotal = 0;
  let highestMeasuredRowIndex = -1;
  let edgeEndToken = -1;
  let edgeStartToken = -1;
  let lastColumns = -1;
  let lastHeader = 0;
  let lastLeadingSpacer = 0;
  let lastTrailingSpacer = 0;
  let lastInitialScrollIndex: number | undefined;
  let initialScrollApplied = false;
  let measurementFlushScheduled = false;
  let measurementFlushPending = false;
  let rangeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let isScrollActive = false;
  let rangeRafPending = false;
  let debugSeq = 0;
  let lastScrollDebugAt = 0;
  let lastMeasurementDebugAt = 0;
  let lastBlankDebugAt = 0;
  let lastSpacerDebugAt = 0;

  const getDebugSnapshot = () => {
    const range = untrack(renderRange);
    return {
      averageRowLength: Number(untrack(averageRowLength).toFixed(2)),
      dataLength: props.data.length,
      footerLength: Number(untrack(footerLength).toFixed(2)),
      headerLength: Number(untrack(headerLength).toFixed(2)),
      highestMeasuredRowIndex,
      isScrollActive,
      leadingSpacer: Number(lastLeadingSpacer.toFixed(2)),
      maxScrollOffset: Number(untrack(maxScrollOffset).toFixed(2)),
      measuredRowCount,
      measurementFlushPending,
      measurementFlushScheduled,
      range,
      rangeRows: rangeSize(range),
      rowCount: untrack(rowCount),
      scrollOffset: Number(untrack(scrollOffset).toFixed(2)),
      scrollVelocity: Number(untrack(scrollVelocity).toFixed(2)),
      totalContentLength: Number(untrack(totalContentLength).toFixed(2)),
      totalRowsLength: Number(untrack(totalRowsLength).toFixed(2)),
      trailingSpacer: Number(lastTrailingSpacer.toFixed(2)),
      viewport: Number(untrack(axisViewportLength).toFixed(2)),
    };
  };

  const logVirtualList = (reason: string, extra?: Record<string, unknown>) => {
    const shouldLog = false;
    if (!shouldLog) return;
    debugSeq += 1;
    console.log("[VirtualList]", {
      extra: extra ?? null,
      reason,
      seq: debugSeq,
      snapshot: getDebugSnapshot(),
    });
  };

  const syncMeasurementStats = () => {
    measuredRowCount = 0;
    measuredRowLengthTotal = 0;
    highestMeasuredRowIndex = -1;
    for (const [rowIndex, metric] of rowMetrics) {
      measuredRowCount += 1;
      measuredRowLengthTotal += metric.length;
      if (rowIndex > highestMeasuredRowIndex) {
        highestMeasuredRowIndex = rowIndex;
      }
    }
  };

  const clearMeasurements = () => {
    if (rowMetrics.size === 0) return;
    rowMetrics.clear();
    syncMeasurementStats();
    setMeasurementVersion((value) => value + 1);
  };

  const commitMeasurementVersion = () => {
    if (!measurementFlushPending) return;
    if (!props.getItemLayout && measuredRowCount <= 0) {
      measurementFlushPending = false;
      return;
    }
    measurementFlushPending = false;
    logVirtualList("measurement-commit");
    setMeasurementVersion((value) => value + 1);
  };

  const scheduleMeasurementCommit = (allowDuringScroll = false) => {
    measurementFlushPending = true;
    if (isScrollActive && !allowDuringScroll) {
      const now = nowMs();
      if (now - lastMeasurementDebugAt >= DEBUG_MEASUREMENT_LOG_INTERVAL_MS) {
        lastMeasurementDebugAt = now;
        logVirtualList("measurement-deferred-during-scroll");
      }
      return;
    }
    if (measurementFlushScheduled) return;
    measurementFlushScheduled = true;
    const flush = () => {
      measurementFlushScheduled = false;
      if (isScrollActive && !allowDuringScroll) return;
      commitMeasurementVersion();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(flush);
      return;
    }
    setTimeout(flush, 0);
  };

  const isHorizontal = createMemo(() => props.horizontal ?? false);
  const itemsPerRow = createMemo(() => {
    if (isHorizontal()) return 1;
    return Math.max(1, props.numColumns ?? 1);
  });
  const estimatedRowLength = createMemo(() => {
    const fallback = props.getItemLayout
      ? DEFAULT_ESTIMATED_ITEM
      : DEFAULT_DYNAMIC_ESTIMATED_ITEM;
    const base = props.estimatedItemSize ?? fallback;
    return hasNumber(base) && base > 0 ? base : fallback;
  });
  const averageRowLength = createMemo(() => {
    measurementVersion();
    if (props.getItemLayout) {
      return estimatedRowLength();
    }
    if (measuredRowCount <= 0) {
      return estimatedRowLength();
    }
    return measuredRowLengthTotal / measuredRowCount;
  });
  const axisViewportLength = createMemo(() =>
    isHorizontal() ? viewportSize().width : viewportSize().height
  );
  const contentPadding = createMemo(() =>
    resolvePadding(props.contentContainerStyle)
  );
  const rowCount = createMemo(() =>
    Math.ceil(props.data.length / itemsPerRow())
  );

  const getMeasuredRow = (rowIndex: number): RowMetric | null => {
    if (rowIndex < 0 || rowIndex >= rowCount()) return null;
    if (props.getItemLayout) {
      const itemIndex = Math.min(
        props.data.length - 1,
        rowIndex * itemsPerRow()
      );
      if (itemIndex < 0) return null;
      const layout = props.getItemLayout(props.data, itemIndex);
      return {
        index: rowIndex,
        length: layout.length,
        offset: layout.offset,
      };
    }
    const metric = rowMetrics.get(rowIndex);
    if (!metric) return null;
    return {
      index: rowIndex,
      length: metric.length,
      offset: 0,
    };
  };

  const getApproxRow = (rowIndex: number): RowMetric => {
    const totalRows = rowCount();
    if (totalRows <= 0) {
      return { index: 0, length: 0, offset: 0 };
    }

    measurementVersion();
    const clampedIndex = clamp(rowIndex, 0, totalRows - 1);
    if (props.getItemLayout) {
      const exact = getMeasuredRow(clampedIndex);
      if (exact) {
        return exact;
      }
    }

    const average = averageRowLength();
    let offset = 0;
    for (let index = 0; index < clampedIndex; index += 1) {
      offset += rowMetrics.get(index)?.length ?? average;
    }
    const length = rowMetrics.get(clampedIndex)?.length ?? average;

    return {
      index: clampedIndex,
      length,
      offset,
    };
  };

  const totalRowsLength = createMemo(() => {
    const totalRows = rowCount();
    if (totalRows <= 0) return 0;
    const lastRow = getApproxRow(totalRows - 1);
    return Math.max(0, lastRow.offset + lastRow.length);
  });

  const totalContentLength = createMemo(
    () => headerLength() + totalRowsLength() + footerLength()
  );
  const maxScrollOffset = createMemo(() =>
    Math.max(0, totalContentLength() - axisViewportLength())
  );

  const findRowAtOffset = (offset: number): number => {
    const totalRows = rowCount();
    if (totalRows <= 0) return -1;

    let low = 0;
    let high = totalRows - 1;
    while (low <= high) {
      const mid = low + Math.floor((high - low) / 2);
      const metric = getApproxRow(mid);
      if (offset < metric.offset) {
        high = mid - 1;
        continue;
      }
      if (offset >= metric.offset + metric.length) {
        low = mid + 1;
        continue;
      }
      return mid;
    }

    if (high < 0) return 0;
    if (high >= totalRows) return totalRows - 1;
    return high;
  };

  const computeWindowStep = (currentRange: Range): Range => {
    const totalRows = rowCount();
    if (totalRows <= 0) return EMPTY_RANGE;
    if (props.disableVirtualization) {
      return { first: 0, last: totalRows - 1 };
    }

    const viewport = axisViewportLength();
    if (viewport <= 0) {
      return resolveInitialRange(
        props.data.length,
        props.initialScrollIndex,
        itemsPerRow(),
        props.initialNumToRender
      );
    }

    const rowOffset = Math.max(0, scrollOffset() - headerLength());
    const visibleStart = clamp(
      rowOffset,
      0,
      Math.max(0, totalRowsLength() - viewport)
    );
    const visibleEnd = visibleStart + viewport;
    const velocity = scrollVelocity();

    let first = findRowAtOffset(visibleStart);
    let last = findRowAtOffset(Math.max(visibleStart, visibleEnd - EPSILON));

    if (first < 0) first = 0;
    if (last < first) last = first;

    const average = Math.max(1, averageRowLength());
    const isDynamicList = !props.getItemLayout;
    const hasDynamicMeasurements = isDynamicList && measuredRowCount > 0;
    const targetWindow = Math.max(
      1,
      Math.min(
        9,
        props.windowSize ??
          (isDynamicList ? DEFAULT_DYNAMIC_WINDOW_SIZE : DEFAULT_WINDOW_SIZE)
      )
    );
    const visibleRowCount = Math.max(1, last - first + 1);
    const windowRows = Math.max(
      visibleRowCount,
      Math.ceil((targetWindow * viewport) / average)
    );
    const halfWindowRows = Math.max(
      0,
      Math.ceil((windowRows - visibleRowCount) / 2)
    );
    const overscanRows = Math.max(0, Math.min(12, props.overscan ?? 2));
    const directionalRows =
      Math.abs(velocity) > 1
        ? Math.min(
            isDynamicList ? 4 : 24,
            Math.max(2, Math.ceil(Math.abs(velocity) / Math.max(160, average)))
          )
        : 0;
    const extraBefore =
      halfWindowRows + overscanRows + (velocity < -1 ? directionalRows : 0);
    const extraAfter =
      halfWindowRows + overscanRows + (velocity > 1 ? directionalRows : 0);

    const next = normalizeRange(
      {
        first: first - extraBefore,
        last: last + extraAfter,
      },
      totalRows
    );
    const boundedNext =
      !isDynamicList || rangeSize(next) <= DEFAULT_MAX_DYNAMIC_WINDOW_ROWS
        ? next
        : normalizeRange(
            velocity > 1
              ? {
                  first: next.last - DEFAULT_MAX_DYNAMIC_WINDOW_ROWS + 1,
                  last: next.last,
                }
              : {
                  first: next.first,
                  last: next.first + DEFAULT_MAX_DYNAMIC_WINDOW_ROWS - 1,
                },
            totalRows
          );
    if (
      !isRangeEqual(next, boundedNext) &&
      !isRangeEqual(currentRange, boundedNext)
    ) {
      logVirtualList("window-bounded", {
        boundedNext,
        next,
        velocity,
      });
    }
    const limitedNext = limitRangeExpansion(
      currentRange,
      boundedNext,
      Math.max(
        1,
        Math.floor(
          props.maxToRenderPerBatch ?? DEFAULT_MAX_TO_RENDER_PER_BATCH
        )
      )
    );
    if (!isRangeEqual(boundedNext, limitedNext)) {
      logVirtualList("window-expansion-limited", {
        boundedNext,
        currentRange,
        limitedNext,
      });
    }

    if (
      currentRange.last >= currentRange.first &&
      currentRange.first >= 0 &&
      currentRange.last < totalRows
    ) {
      const guardRows = Math.max(1, Math.min(overscanRows, 4));
      const hasVisibleRows =
        first >= currentRange.first && last <= currentRange.last;
      const hasHeadroom =
        first >= currentRange.first + guardRows &&
        last <= currentRange.last - guardRows;
      const currentSize = currentRange.last - currentRange.first + 1;
      const nextSize = limitedNext.last - limitedNext.first + 1;
      const windowDidNotShrinkMuch = currentSize <= nextSize + guardRows * 2;

      if (hasVisibleRows && hasHeadroom && windowDidNotShrinkMuch) {
        return currentRange;
      }
    }

    return limitedNext;
  };

  const readAxisOffsetFromEvent = (event: ScrollEvent): number =>
    isHorizontal() ? event.contentOffset.x : event.contentOffset.y;

  const readAxisVelocityFromEvent = (event: ScrollEvent): number =>
    isHorizontal() ? event.velocity?.x ?? 0 : event.velocity?.y ?? 0;

  const markScrollActive = () => {
    isScrollActive = true;
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
    }
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null;
      isScrollActive = false;
    }, SCROLL_IDLE_DELAY_MS);
  };

  const markScrollIdle = () => {
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    }
    isScrollActive = false;
    // Flush any deferred measurements as a single batch when scroll ends,
    // preventing cascading re-layout passes from individual commit trickle.
    if (measurementFlushPending) {
      commitMeasurementVersion();
    }
  };

  const updateViewportFromLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    const nextHeight = event.nativeEvent.layout.height;
    if (!hasNumber(nextWidth) || !hasNumber(nextHeight)) return;
    
    const current = viewportSize();
    // Use a small threshold to avoid sub-pixel layout loops
    if (Math.abs(current.width - nextWidth) < 1.0 && Math.abs(current.height - nextHeight) < 1.0) {
      return;
    }
    setViewportSize({ width: nextWidth, height: nextHeight });
  };

  const handleListLayout = (event: LayoutChangeEvent) => {
    updateViewportFromLayout(event);
    props.onLayout?.(event);
  };

  const handleScroll = (event: ScrollEvent) => {
    markScrollActive();
    const nextOffset = readAxisOffsetFromEvent(event);
    const prevOffset = untrack(scrollOffset);
    if (Math.abs(prevOffset - nextOffset) >= 0.5) {
      setScrollOffset(nextOffset);
    }
    setScrollVelocity(readAxisVelocityFromEvent(event));

    const nextWidth = event.layoutMeasurement.width;
    const nextHeight = event.layoutMeasurement.height;
    if (hasNumber(nextWidth) && hasNumber(nextHeight)) {
      const current = viewportSize();
      if (Math.abs(current.width - nextWidth) >= 1.0 || Math.abs(current.height - nextHeight) >= 1.0) {
        setViewportSize({ width: nextWidth, height: nextHeight });
      }
    }

    const now = nowMs();
    if (now - lastScrollDebugAt >= DEBUG_LOG_INTERVAL_MS) {
      lastScrollDebugAt = now;
      logVirtualList("scroll", {
        eventContentSize: event.contentSize,
        eventOffset: event.contentOffset,
        eventViewport: event.layoutMeasurement,
        nextOffset,
      });
    }

    props.onScroll?.(event);
  };

  const handleScrollBeginDrag = (event: ScrollEvent) => {
    markScrollActive();
    logVirtualList("scroll-begin-drag", {
      eventOffset: event.contentOffset,
      velocity: event.velocity,
    });
    props.onScrollBeginDrag?.(event);
  };

  const handleScrollEndDrag = (event: ScrollEvent) => {
    if (!event.velocity || Math.abs(readAxisVelocityFromEvent(event)) < 1) {
      markScrollIdle();
    } else {
      markScrollActive();
    }
    logVirtualList("scroll-end-drag", {
      eventOffset: event.contentOffset,
      velocity: event.velocity,
    });
    props.onScrollEndDrag?.(event);
  };

  const handleMomentumScrollBegin = (event: ScrollEvent) => {
    markScrollActive();
    logVirtualList("momentum-begin", {
      eventOffset: event.contentOffset,
      velocity: event.velocity,
    });
    props.onMomentumScrollBegin?.(event);
  };

  const handleMomentumScrollEnd = (event: ScrollEvent) => {
    markScrollIdle();
    logVirtualList("momentum-end", {
      eventOffset: event.contentOffset,
      velocity: event.velocity,
    });
    props.onMomentumScrollEnd?.(event);
  };

  const handleHeaderLayout = (event: LayoutChangeEvent) => {
    const next = isHorizontal()
      ? event.nativeEvent.layout.width
      : event.nativeEvent.layout.height;
    if (!hasNumber(next)) return;
    
    const current = headerLength();
    if (Math.abs(current - next) < 1.0) {
      return;
    }
    setHeaderLength(Math.max(0, next));
  };

  const handleFooterLayout = (event: LayoutChangeEvent) => {
    const next = isHorizontal()
      ? event.nativeEvent.layout.width
      : event.nativeEvent.layout.height;
    if (!hasNumber(next)) return;

    const current = footerLength();
    if (Math.abs(current - next) < 1.0) {
      return;
    }
    setFooterLength(Math.max(0, next));
  };

  const handleRowLayout = (rowIndex: number, event: LayoutChangeEvent) => {
    if (props.getItemLayout) return;
    const layout = event.nativeEvent.layout;
    let nextLength = isHorizontal() ? layout.width : layout.height;
    
    if (nextLength < 0) {
      nextLength = Math.abs(nextLength);
    }

    if (!hasNumber(nextLength) || nextLength <= 0) {
      return;
    }

    const metric: RowMetric = {
      index: rowIndex,
      length: nextLength,
      offset: 0,
    };
    const previous = rowMetrics.get(rowIndex);
    if (previous && Math.abs(previous.length - metric.length) < 1.0) {
      return;
    }

    if (previous) {
      measuredRowLengthTotal += metric.length - previous.length;
      rowMetrics.set(rowIndex, metric);
    } else {
      measuredRowCount += 1;
      measuredRowLengthTotal += metric.length;
      rowMetrics.set(rowIndex, metric);
    }
    if (rowIndex > highestMeasuredRowIndex) {
      highestMeasuredRowIndex = rowIndex;
    }
    const now = nowMs();
    if (now - lastMeasurementDebugAt >= DEBUG_MEASUREMENT_LOG_INTERVAL_MS) {
      lastMeasurementDebugAt = now;
      logVirtualList("row-measured", {
        isUpdate: previous !== undefined,
        nextLength,
        previousLength: previous?.length ?? null,
        rowIndex,
      });
    }
    scheduleMeasurementCommit();
  };

  const getRowOnLayout = (rowIndex: number) => {
    let handler = rowLayoutHandlers.get(rowIndex);
    if (handler) return handler;
    handler = (event: LayoutChangeEvent) => handleRowLayout(rowIndex, event);
    rowLayoutHandlers.set(rowIndex, handler);
    return handler;
  };

  const scrollToOffset = (params: VirtualListScrollToOffsetParams) => {
    const node = scrollNode();
    if (!node) return;
    const target = clamp(params.offset, 0, maxScrollOffset());
    if (isHorizontal()) {
      node.scrollTo({ animated: params.animated, x: target });
      return;
    }
    node.scrollTo({ animated: params.animated, y: target });
  };

  const scrollToEnd = (params?: { animated?: boolean }) => {
    scrollToOffset({
      animated: params?.animated,
      offset: maxScrollOffset(),
    });
  };

  const getHighestMeasuredItemIndex = (): number => {
    if (highestMeasuredRowIndex < 0) return -1;
    return Math.min(
      props.data.length - 1,
      highestMeasuredRowIndex * itemsPerRow() + (itemsPerRow() - 1)
    );
  };

  const scrollToIndex = (params: VirtualListScrollToIndexParams) => {
    if (props.data.length <= 0) return;

    const clampedIndex = clamp(params.index, 0, props.data.length - 1);
    if (
      !props.getItemLayout &&
      clampedIndex > getHighestMeasuredItemIndex() &&
      props.onScrollToIndexFailed
    ) {
      props.onScrollToIndexFailed({
        averageItemLength: averageRowLength(),
        highestMeasuredFrameIndex: getHighestMeasuredItemIndex(),
        index: clampedIndex,
      });
      return;
    }

    const rowIndex = Math.floor(clampedIndex / itemsPerRow());
    const metric = getApproxRow(rowIndex);
    const viewport = axisViewportLength();
    const viewOffset = params.viewOffset ?? 0;
    const viewPosition = params.viewPosition ?? 0;
    const target =
      headerLength() +
      Math.max(
        0,
        metric.offset - viewPosition * Math.max(0, viewport - metric.length)
      ) -
      viewOffset;

    scrollToOffset({ animated: params.animated, offset: target });
  };

  const scrollToItem = (params: VirtualListScrollToItemParams<T>) => {
    const targetIndex = props.data.findIndex((entry) => entry === params.item);
    if (targetIndex < 0) return;
    scrollToIndex({
      animated: params.animated,
      index: targetIndex,
      viewOffset: params.viewOffset,
      viewPosition: params.viewPosition,
    });
  };

  const assignRef = (node: (HostNode & ScrollViewRef) | null) => {
    setScrollNode(node);
    if (!props.ref) return;
    if (!node) {
      props.ref(null);
      return;
    }

    const host = node as HostNode & VirtualListRef<T>;
    host.scrollToOffset = scrollToOffset;
    host.scrollToEnd = scrollToEnd;
    host.scrollToIndex = scrollToIndex;
    host.scrollToItem = scrollToItem;
    props.ref(host);
  };

  createEffect(() => {
    const totalRows = rowCount();
    let removed = false;
    for (const [rowIndex] of rowMetrics) {
      if (rowIndex < totalRows) continue;
      rowMetrics.delete(rowIndex);
      removed = true;
    }
    for (const [rowIndex] of rowLayoutHandlers) {
      if (rowIndex < totalRows) continue;
      rowLayoutHandlers.delete(rowIndex);
    }
    if (removed) {
      syncMeasurementStats();
      setMeasurementVersion((value) => value + 1);
    }
  });

  createEffect(() => {
    const nextColumns = itemsPerRow();
    if (lastColumns === -1) {
      lastColumns = nextColumns;
      return;
    }
    if (lastColumns === nextColumns) return;
    lastColumns = nextColumns;
    clearMeasurements();
  });

  createEffect(() => {
    const nextHeader = headerLength();
    if (lastHeader === nextHeader) return;
    lastHeader = nextHeader;
    if (!props.getItemLayout) {
      clearMeasurements();
    }
  });

  const commitRenderRange = (previous: Range, next: Range) => {
    const addedRows = countAddedRows(previous, next);
    logVirtualList("range-commit", {
      addedRows,
      next,
      previous,
      removedRows: Math.max(0, rangeSize(previous) - rangeSize(next) + addedRows),
    });
    withHostBatch(
      {
        kind: "update",
        scope: "virtual-list-window",
        extras: {
          addedRows,
          atomic: true,
          first: next.first,
          last: next.last,
          previousFirst: previous.first,
          previousLast: previous.last,
          rowCount: rowCount(),
          scrollOffset: scrollOffset(),
          totalRowsLength: totalRowsLength(),
          viewport: axisViewportLength(),
        },
      },
      () => setRenderRange(next)
    );
  };

  const scheduleRenderRangeCommit = () => {
    if (rangeUpdateTimer) return;
    const delay = Math.max(
      0,
      props.updateCellsBatchingPeriod ?? DEFAULT_UPDATE_CELLS_BATCHING_PERIOD
    );
    logVirtualList("range-commit-scheduled", { delay });
    rangeUpdateTimer = setTimeout(() => {
      rangeUpdateTimer = null;
      const current = untrack(renderRange);
      const next = computeWindowStep(current);
      if (!isRangeEqual(current, next)) {
        commitRenderRange(current, next);
      }
    }, delay);
  };

  createEffect(() => {
    props.data.length;
    props.disableVirtualization;
    props.initialNumToRender;
    props.initialScrollIndex;
    props.maxToRenderPerBatch;
    props.overscan;
    props.updateCellsBatchingPeriod;
    props.windowSize;
    axisViewportLength();
    headerLength();
    scrollOffset();
    scrollVelocity();
    totalRowsLength();
    measurementVersion();

    const current = untrack(renderRange);
    const next = computeWindowStep(current);
    if (!isRangeEqual(current, next)) {
      const addedRows = countAddedRows(current, next);
      const batchingPeriod =
        props.updateCellsBatchingPeriod ??
        DEFAULT_UPDATE_CELLS_BATCHING_PERIOD;
      if (addedRows > 0 && batchingPeriod > 0) {
        scheduleRenderRangeCommit();
        return;
      }
      // During active scroll, coalesce range commits to at most one per
      // animation frame.  This prevents multiple synchronous Yoga layout
      // passes when scrollOffset fires faster than the display refresh.
      if (isScrollActive && typeof requestAnimationFrame === "function") {
        if (!rangeRafPending) {
          rangeRafPending = true;
          requestAnimationFrame(() => {
            rangeRafPending = false;
            const latest = untrack(renderRange);
            const latestNext = computeWindowStep(latest);
            if (!isRangeEqual(latest, latestNext)) {
              commitRenderRange(latest, latestNext);
            }
          });
        }
        return;
      }
      commitRenderRange(current, next);
    }
  });

  createEffect(() => {
    const viewport = axisViewportLength();
    const totalRows = rowCount();
    if (viewport <= 0 || totalRows <= 0) return;

    const distanceFromStart = Math.max(0, scrollOffset() - headerLength());
    const distanceFromEnd = Math.max(
      0,
      totalRowsLength() + footerLength() - distanceFromStart - viewport
    );

    if (props.onStartReached) {
      const threshold =
        Math.max(0, props.onStartReachedThreshold ?? 2) * viewport;
      if (distanceFromStart <= threshold) {
        const token = Math.floor(distanceFromStart);
        if (edgeStartToken !== token) {
          edgeStartToken = token;
          untrack(() => props.onStartReached?.({ distanceFromStart }));
        }
      } else {
        edgeStartToken = -1;
      }
    }

    if (props.onEndReached) {
      const threshold =
        Math.max(0, props.onEndReachedThreshold ?? 2) * viewport;
      if (distanceFromEnd <= threshold) {
        const token = Math.floor(distanceFromEnd);
        if (edgeEndToken !== token) {
          edgeEndToken = token;
          untrack(() => props.onEndReached?.({ distanceFromEnd }));
        }
      } else {
        edgeEndToken = -1;
      }
    }
  });

  createEffect(() => {
    const nextInitialScrollIndex = props.initialScrollIndex;
    if (lastInitialScrollIndex !== nextInitialScrollIndex) {
      lastInitialScrollIndex = nextInitialScrollIndex;
      initialScrollApplied = false;
    }

    if (nextInitialScrollIndex === undefined || initialScrollApplied) return;
    if (axisViewportLength() <= 0) return;
    if (!scrollNode()) return;

    scrollToIndex({ animated: false, index: nextInitialScrollIndex });
    initialScrollApplied = true;
  });

  onCleanup(() => {
    if (rangeUpdateTimer) {
      clearTimeout(rangeUpdateTimer);
      rangeUpdateTimer = null;
    }
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    }
    if (props.ref) {
      props.ref(null);
    }
  });

  const visibleRowIndices = createMemo(() => {
    const range = normalizeRange(renderRange(), rowCount());
    if (range.last < range.first) return [] as number[];
    const count = range.last - range.first + 1;
    return Array.from({ length: count }, (_, index) => range.first + index);
  });

  createEffect(() => {
    const rows = visibleRowIndices();
    const totalRows = rowCount();
    const viewport = axisViewportLength();
    const offset = scrollOffset();
    const range = renderRange();
    if (props.data.length > 0 && viewport > 0 && rows.length === 0) {
      const now = nowMs();
      if (now - lastBlankDebugAt >= DEBUG_LOG_INTERVAL_MS) {
        lastBlankDebugAt = now;
        logVirtualList("blank-visible-rows", {
          offset,
          range,
          totalRows,
          viewport,
        });
      }
    }
  });

  const leadingSpacerLength = createMemo(() => {
    if (props.disableVirtualization) return 0;
    const rows = visibleRowIndices();
    if (rows.length <= 0) return 0;
    const firstRow = getApproxRow(rows[0]);
    const next = Math.max(0, firstRow.offset);
    
    // Stability guard: ignore sub-pixel shifts in spacers
    if (Math.abs(lastLeadingSpacer - next) < 1.0) {
      return lastLeadingSpacer;
    }
    const previous = lastLeadingSpacer;
    lastLeadingSpacer = next;
    const now = nowMs();
    if (now - lastSpacerDebugAt >= DEBUG_LOG_INTERVAL_MS) {
      lastSpacerDebugAt = now;
      logVirtualList("leading-spacer-change", {
        next,
        previous,
        rows,
      });
    }
    return next;
  });

  const trailingSpacerLength = createMemo(() => {
    if (props.disableVirtualization) return 0;
    const rows = visibleRowIndices();
    if (rows.length <= 0) return Math.max(0, totalRowsLength());
    const lastRow = getApproxRow(rows[rows.length - 1]);
    const renderedEnd = lastRow.offset + lastRow.length;
    const next = Math.max(0, totalRowsLength() - renderedEnd);

    // Stability guard: ignore sub-pixel shifts in spacers
    if (Math.abs(lastTrailingSpacer - next) < 1.0) {
      return lastTrailingSpacer;
    }
    const previous = lastTrailingSpacer;
    lastTrailingSpacer = next;
    const now = nowMs();
    if (now - lastSpacerDebugAt >= DEBUG_LOG_INTERVAL_MS) {
      lastSpacerDebugAt = now;
      logVirtualList("trailing-spacer-change", {
        next,
        previous,
        rows,
      });
    }
    return next;
  });

  const scrollViewStyle = createMemo<StyleProp>(() => {
    const base: Style = { flex: 1, overflow: "hidden" };
    return compactStyles(base, props.style) ?? base;
  });

  const contentContainerStyle = createMemo<StyleProp>(() => {
    const base: Style = isHorizontal()
      ? { alignItems: "stretch", flexDirection: "row", height: "100%" }
      : { flexGrow: 1, width: "100%" };
    return compactStyles(base, props.contentContainerStyle) ?? base;
  });

  const childInversionStyle = createMemo<Style | null>(() =>
    props.inverted ? createInversionStyle(isHorizontal()) : null
  );

  const innerContentStyle = createMemo<Style>(() => {
    if (isHorizontal()) {
      return { alignItems: "stretch", flexDirection: "row", height: "100%" };
    }
    return { alignItems: "stretch", width: "100%" };
  });

  const manualContentSize = createMemo(() => {
    const padding = contentPadding();
    const axisPadding = isHorizontal()
      ? padding.left + padding.right
      : padding.top + padding.bottom;
    const axisLength = totalContentLength() + axisPadding;
    if (isHorizontal()) {
      return { height: "100%", width: axisLength } as unknown as {
        height: number;
        width: number;
      };
    }
    return { height: axisLength, width: "100%" } as unknown as {
      height: number;
      width: number;
    };
  });

  const renderSeparatorForRow = (rowIndex: number) => {
    if (!props.ItemSeparatorComponent) return null;
    if (rowIndex >= rowCount() - 1) return null;
    const separator = renderSlot(props.ItemSeparatorComponent);
    if (!separator) return null;
    if (!childInversionStyle()) return separator;
    return <View style={childInversionStyle()!}>{separator}</View>;
  };

  return (
    <ScrollView
      bounces={props.bounces}
      bridgeCoalescing={props.bridgeCoalescing ?? true}
      config={props.config}
      contentContainerStyle={contentContainerStyle()}
      contentInset={props.contentInset}
      contentInsetAdjustmentBehavior={props.contentInsetAdjustmentBehavior}
      contentOffsetSharedValue={props.contentOffsetSharedValue}
      contentSize={manualContentSize()}
      decelerationRate={props.decelerationRate}
      directionalLockEnabled={props.directionalLockEnabled}
      disableIntervalMomentum={props.disableIntervalMomentum}
      eventMinDisplacementPx={props.eventMinDisplacementPx}
      eventThrottleMs={props.eventThrottleMs}
      horizontal={props.horizontal}
      inverted={props.inverted}
      indicatorStyle={props.indicatorStyle}
      keyboardDismissMode={props.keyboardDismissMode}
      keyboardShouldPersistTaps={props.keyboardShouldPersistTaps}
      maintainVisibleContentPosition={props.maintainVisibleContentPosition}
      maximumZoomScale={props.maximumZoomScale}
      minimumZoomScale={props.minimumZoomScale}
      onContentSizeChange={props.onContentSizeChange}
      onLayout={handleListLayout}
      onMomentumScrollBegin={handleMomentumScrollBegin}
      onMomentumScrollEnd={handleMomentumScrollEnd}
      onRefresh={props.onRefresh}
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollBeginDrag}
      onScrollEndDrag={handleScrollEndDrag}
      overScrollBehavior={props.overScrollBehavior}
      pinchGestureEnabled={props.pinchGestureEnabled}
      ref={assignRef}
      refreshControl={props.refreshControl}
      refreshing={props.refreshing}
      scrollEnabled={props.scrollEnabled}
      scrollPadding={props.scrollPadding}
      scrollSnapAlign={props.scrollSnapAlign}
      scrollSnapStop={props.scrollSnapStop}
      scrollSnapType={props.scrollSnapType}
      showsHorizontalScrollIndicator={props.showsHorizontalScrollIndicator}
      showsVerticalScrollIndicator={props.showsVerticalScrollIndicator}
      snapToAlignment={props.snapToAlignment}
      snapToEnd={props.snapToEnd}
      snapToInterval={props.snapToInterval}
      snapToOffsets={props.snapToOffsets}
      snapToStart={props.snapToStart}
      stickyHeaderHiddenOnScroll={props.stickyHeaderHiddenOnScroll}
      stickyHeaderIndices={props.stickyHeaderIndices}
      style={scrollViewStyle()}
      testID={props.testID}
    >
      <View style={innerContentStyle()}>
        {props.ListHeaderComponent ? (
          <View
            onLayout={handleHeaderLayout}
            style={compactStyles(
              childInversionStyle(),
              props.ListHeaderComponentStyle
            )}
          >
            {renderSlot(props.ListHeaderComponent)}
          </View>
        ) : null}

        {leadingSpacerLength() > 0 ? (
          <View
            pointerEvents="none"
            style={
              isHorizontal()
                ? {
                    minWidth: leadingSpacerLength(),
                    width: leadingSpacerLength(),
                  }
                : {
                    minHeight: leadingSpacerLength(),
                    height: leadingSpacerLength(),
                  }
            }
          />
        ) : null}

        <For each={visibleRowIndices()}>
          {(rowIndex) => {
            const rowItemIndices = createMemo(() => {
              props.extraData;
              const start = rowIndex * itemsPerRow();
              const next: number[] = [];
              for (let lane = 0; lane < itemsPerRow(); lane += 1) {
                const itemIndex = start + lane;
                if (itemIndex >= props.data.length) break;
                next.push(itemIndex);
              }
              return next;
            });

            const rowStyle = createMemo<StyleProp>(() => {
              const base: Style = isHorizontal()
                ? { alignSelf: "stretch", overflow: "hidden" }
                : itemsPerRow() > 1
                ? {
                    alignItems: "stretch",
                    flexDirection: "row",
                    width: "100%",
                    overflow: "hidden",
                  }
                : { alignItems: "stretch", width: "100%", overflow: "hidden" };

              if (itemsPerRow() > 1 && props.columnWrapperStyle) {
                if (childInversionStyle()) {
                  return (
                    compactStyles(
                      base,
                      childInversionStyle()!,
                      props.columnWrapperStyle
                    ) ?? base
                  );
                }
                return compactStyles(base, props.columnWrapperStyle) ?? base;
              }

              if (childInversionStyle()) {
                return compactStyles(base, childInversionStyle()!) ?? base;
              }
              return base;
            });

            const rowOnLayout = props.getItemLayout
              ? undefined
              : getRowOnLayout(rowIndex);

            return (
              <View onLayout={rowOnLayout} style={rowStyle()}>
                <For each={rowItemIndices()}>
                  {(itemIndex) => {
                    const item = createMemo(() => props.data[itemIndex]);
                    const itemKey = createMemo(() =>
                      props.keyExtractor
                        ? props.keyExtractor(item(), itemIndex)
                        : defaultKeyExtractor(item(), itemIndex)
                    );
                    return (
                      <View
                        key={itemKey()}
                        style={
                          itemsPerRow() > 1 ? ({ flex: 1 } as Style) : undefined
                        }
                      >
                        {props.renderItem({ item: item(), index: itemIndex })}
                      </View>
                    );
                  }}
                </For>

                {itemsPerRow() > 1
                  ? Array.from({
                      length: Math.max(
                        0,
                        itemsPerRow() - rowItemIndices().length
                      ),
                    }).map((_, fillIndex) => (
                      <View
                        key={`virtual-fill-${rowIndex}-${fillIndex}`}
                        pointerEvents="none"
                        style={{ flex: 1, opacity: 0 }}
                      />
                    ))
                  : null}

                {renderSeparatorForRow(rowIndex)}
              </View>
            );
          }}
        </For>

        {trailingSpacerLength() > 0 ? (
          <View
            pointerEvents="none"
            style={
              isHorizontal()
                ? {
                    minWidth: trailingSpacerLength(),
                    width: trailingSpacerLength(),
                  }
                : {
                    minHeight: trailingSpacerLength(),
                    height: trailingSpacerLength(),
                  }
            }
          />
        ) : null}

        {props.data.length === 0 && props.ListEmptyComponent ? (
          <View style={childInversionStyle() ?? undefined}>
            {renderSlot(props.ListEmptyComponent)}
          </View>
        ) : null}

        {props.ListFooterComponent ? (
          <View
            onLayout={handleFooterLayout}
            style={compactStyles(
              childInversionStyle(),
              props.ListFooterComponentStyle
            )}
          >
            {renderSlot(props.ListFooterComponent)}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
