import {
  JSX,
  For,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  splitProps,
  untrack,
} from "solid-js";
import type { Accessor, Component } from "solid-js";
import type { Style } from "@rune/core";
import {
  ScrollView,
  type ScrollEvent,
  type ScrollViewProps,
  createScrollController,
  type ScrollController,
} from "./ScrollView";
import { View } from "./View";

const DEFAULT_ITEM_LENGTH = 80;
const DEFAULT_WINDOW_SIZE = 2.5;
const DEFAULT_OVERSCAN_MULTIPLIER = 1.5;
const DEFAULT_END_REACHED_THRESHOLD = 0.5;
const DEFAULT_START_REACHED_THRESHOLD = 0.1;

const now = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

type ListRenderTarget = "cell" | "measure" | "stickyHeader";

export type RenderItemInfo<T> = {
  item: T;
  index: number;
  key: string;
  target: ListRenderTarget;
  extraData?: any;
};

export type ItemTypeResolver<T> = (
  item: T,
  index: number,
  extraData?: any
) => string | number | undefined;

export type KeyExtractor<T> = (item: T, index: number) => string;

export type ViewToken<T = any> = {
  index: number;
  isViewable: boolean;
  item: T;
  key: string;
  timestamp: number;
};

export type ViewabilityConfig = {
  minimumViewTime?: number;
  viewAreaCoveragePercentThreshold?: number;
  itemVisiblePercentThreshold?: number;
  waitForInteraction?: boolean;
};

export type FlatListController = {
  visibleIndices: () => number[];
  firstVisibleIndex: () => number | null;
  layout: () => { x: number; y: number; width: number; height: number };
  scrollToOffset: (p: { offset: number; animated?: boolean }) => void;
  scrollToIndex: (p: {
    index: number;
    viewOffset?: number;
    viewPosition?: number;
    animated?: boolean;
  }) => void;
  scrollToItem: (p: {
    item: any;
    viewPosition?: number;
    animated?: boolean;
  }) => void;
  scrollToTop: (p?: { animated?: boolean }) => void;
  scrollToEnd: (p?: { animated?: boolean }) => void;
  flashScrollIndicators: () => void;
  recordInteraction: () => void;
  recomputeViewableItems: () => void;
  prepareForLayoutAnimationRender: () => void;
  getNativeScrollRef: () => any;
  getScrollableNode: () => any;
  getWindowSize: () => { width: number; height: number };
};

type InternalFlatListController = FlatListController & {
  __setVisibleIndices?: (indices: number[]) => void;
  __setLayout?: (
    layout: { x: number; y: number; width: number; height: number } | null
  ) => void;
  __setInternals?: (internals: {
    scrollController: ScrollController | null;
    isHorizontal: Accessor<boolean>;
    computeOffsetForIndex: (
      index: number,
      opts?: { viewOffset?: number; viewPosition?: number }
    ) => number | null;
    findIndexForItem: (item: any) => number | null;
    getTotalContentSize: () => number;
    getNativeNode: () => any;
    triggerViewability: () => void;
  }) => void;
};

export function createFlatListController(): FlatListController {
  const [visibleIndices, setVisibleIndices] = createSignal<number[]>([]);
  const [firstVisibleIndex, setFirstVisibleIndex] = createSignal<
    number | null
  >(null);
  const [layout, setLayout] = createSignal({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  let interactionRecorded = false;
  let scrollController: ScrollController | null = null;
  let isHorizontal: Accessor<boolean> | null = null;
  let computeOffsetForIndex: (
    index: number,
    opts?: { viewOffset?: number; viewPosition?: number }
  ) => number | null = () => null;
  let findIndexForItem: (item: any) => number | null = () => null;
  let getTotalContentSize: () => number = () => 0;
  let getNativeNode: () => any = () => null;
  let triggerViewability: () => void = () => {};

  const controller: InternalFlatListController = {
    visibleIndices,
    firstVisibleIndex,
    layout,
    scrollToOffset({ offset, animated }) {
      if (!scrollController) return;
      const isHorizontalValue = isHorizontal ? isHorizontal() : false;
      scrollController.scrollTo(
        isHorizontalValue ? { x: offset, animated } : { y: offset, animated }
      );
    },
    scrollToIndex({ index, viewOffset = 0, viewPosition, animated }) {
      if (index == null || index < 0) return;
      const baseOffset = computeOffsetForIndex(index, {
        viewOffset,
        viewPosition,
      });
      if (baseOffset == null) return;
      controller.scrollToOffset({
        offset: Math.max(0, baseOffset),
        animated,
      });
    },
    scrollToItem({ item, viewPosition, animated }) {
      const index = findIndexForItem(item);
      if (index == null || index < 0) return;
      controller.scrollToIndex({
        index,
        viewPosition,
        animated,
      });
    },
    scrollToTop({ animated } = {}) {
      controller.scrollToOffset({ offset: 0, animated });
    },
    scrollToEnd({ animated } = {}) {
      const total = getTotalContentSize();
      const size = controller.layout();
      const viewport = isHorizontal?.() ? size.width : size.height;
      controller.scrollToOffset({
        offset: Math.max(0, total - viewport),
        animated,
      });
    },
    flashScrollIndicators() {
      scrollController?.flashScrollIndicators();
    },
    recordInteraction() {
      interactionRecorded = true;
    },
    recomputeViewableItems() {
      triggerViewability();
    },
    prepareForLayoutAnimationRender() {
      // Recycling is managed virtually in JS for now; no-op.
    },
    getNativeScrollRef() {
      return getNativeNode();
    },
    getScrollableNode() {
      return getNativeNode();
    },
    getWindowSize() {
      const current = layout();
      return { width: current.width, height: current.height };
    },
  };

  controller.__setVisibleIndices = (indices) => {
    setVisibleIndices(indices);
    setFirstVisibleIndex(indices.length > 0 ? indices[0] : null);
    if (!interactionRecorded && indices.length > 0) {
      interactionRecorded = true;
    }
  };

  controller.__setLayout = (next) => {
    if (!next) return;
    setLayout(next);
  };

  controller.__setInternals = (internals) => {
    scrollController = internals.scrollController;
    isHorizontal = internals.isHorizontal;
    computeOffsetForIndex = internals.computeOffsetForIndex;
    findIndexForItem = internals.findIndexForItem;
    getTotalContentSize = internals.getTotalContentSize;
    getNativeNode = internals.getNativeNode;
    triggerViewability = internals.triggerViewability;
  };

  return controller;
}

type MaintainVisibleContentPosition = {
  disabled?: boolean;
  autoscrollToTopThreshold?: number;
  autoscrollToBottomThreshold?: number;
  startRenderingFromBottom?: boolean;
};

type Overscan =
  | number
  | {
      aheadPx?: number;
      behindPx?: number;
    };

export type FlatListProps<T> = {
  data: T[];
  renderItem: (info: RenderItemInfo<T>) => JSX.Element;
  keyExtractor?: KeyExtractor<T>;
  getItemType?: ItemTypeResolver<T>;
  estimatedItemSize?: number;
  horizontal?: boolean;
  numColumns?: number;
  itemSize?: number;
  ListHeaderComponent?: JSX.Element | Component;
  ListFooterComponent?: JSX.Element | Component;
  ListEmptyComponent?: JSX.Element | Component;
  ItemSeparatorComponent?: Component<{ leadingItem?: T; trailingItem?: T }>;
  style?: Style;
  contentContainerStyle?: Style;
  initialScrollIndex?: number;
  initialScrollIndexParams?: { viewOffset?: number };
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  windowSize?: number;
  overscan?: Overscan;
  recycleEnabled?: boolean;
  recyclePoolMaxPerType?: number;
  maxToRenderPerBatch?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
  onViewableItemsChanged?: (info: {
    viewableItems: ViewToken<T>[];
    changed: ViewToken<T>[];
  }) => void;
  viewabilityConfig?: ViewabilityConfig;
  viewabilityConfigCallbackPairs?: Array<{
    viewabilityConfig: ViewabilityConfig;
    onViewableItemsChanged:
      | ((info: {
          viewableItems: ViewToken<T>[];
          changed: ViewToken<T>[];
        }) => void)
      | null;
  }>;
  onLoad?: (info: { elapsedTimeInMs: number }) => void;
  onBlankArea?: (info: {
    offsetStart: number;
    offsetEnd: number;
    blankArea: number;
  }) => void;
  onCommitLayoutEffect?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshControl?: JSX.Element;
  onScrollBeginDrag?: (event: ScrollEvent) => void;
  onScrollEndDrag?: (event: ScrollEvent) => void;
  onMomentumScrollBegin?: (event: ScrollEvent) => void;
  onMomentumScrollEnd?: (event: ScrollEvent) => void;
  onScroll?: (event: ScrollEvent) => void;
  scrollViewProps?: Partial<ScrollViewProps>;
  controller?: FlatListController;
  extraData?: any;
  testID?: string;
};

type ItemEntry<T> = {
  item: T;
  index: number;
  key: string;
};

const isComponent = (
  value: JSX.Element | Component<any>
): value is Component<any> => typeof value === "function";

const renderSupplemental = (
  value: JSX.Element | Component<any> | undefined
): JSX.Element | null => {
  if (!value) return null;
  if (isComponent(value)) {
    const ComponentValue = value;
    return <ComponentValue />;
  }
  return value;
};

const renderSeparator = <T,>(
  ComponentValue: FlatListProps<T>["ItemSeparatorComponent"],
  leadingItem?: T,
  trailingItem?: T
) => {
  if (!ComponentValue) return null;
  return (
    <ComponentValue leadingItem={leadingItem} trailingItem={trailingItem} />
  );
};

const resolveOverscan = (
  overscan: Overscan | undefined,
  viewport: number,
  windowSize: number
) => {
  if (typeof overscan === "number") {
    const multiplier = overscan <= 1 ? overscan : overscan / viewport;
    const px = Math.max(0, multiplier) * viewport;
    return { ahead: px, behind: px };
  }
  if (overscan && typeof overscan === "object") {
    return {
      ahead:
        overscan.aheadPx ??
        Math.max(0, ((windowSize - 1) / 2) * viewport * DEFAULT_OVERSCAN_MULTIPLIER),
      behind:
        overscan.behindPx ??
        Math.max(0, ((windowSize - 1) / 2) * viewport * DEFAULT_OVERSCAN_MULTIPLIER),
    };
  }
  const px = viewport * DEFAULT_OVERSCAN_MULTIPLIER;
  return { ahead: px, behind: px };
};

export function FlatList<T>(allProps: FlatListProps<T>) {
  const [local] = splitProps(allProps, [
    "data",
    "renderItem",
    "keyExtractor",
    "getItemType",
    "estimatedItemSize",
    "horizontal",
    "numColumns",
    "itemSize",
    "ListHeaderComponent",
    "ListFooterComponent",
    "ListEmptyComponent",
    "ItemSeparatorComponent",
    "style",
    "contentContainerStyle",
    "initialScrollIndex",
    "initialScrollIndexParams",
    "maintainVisibleContentPosition",
    "windowSize",
    "overscan",
    "recycleEnabled",
    "recyclePoolMaxPerType",
    "maxToRenderPerBatch",
    "onEndReached",
    "onEndReachedThreshold",
    "onStartReached",
    "onStartReachedThreshold",
    "onViewableItemsChanged",
    "viewabilityConfig",
    "viewabilityConfigCallbackPairs",
    "onLoad",
    "onBlankArea",
    "onCommitLayoutEffect",
    "onRefresh",
    "refreshing",
    "refreshControl",
    "onScrollBeginDrag",
    "onScrollEndDrag",
    "onMomentumScrollBegin",
    "onMomentumScrollEnd",
    "onScroll",
    "scrollViewProps",
    "controller",
    "extraData",
    "testID",
  ]);

  const scrollController = createScrollController();

  const resolvedController = createMemo<InternalFlatListController>(() => {
    const supplied = local.controller;
    if (supplied) return supplied as InternalFlatListController;
    return createFlatListController() as InternalFlatListController;
  });

  const scrollViewProps = createMemo<Partial<ScrollViewProps>>(
    () => local.scrollViewProps ?? {}
  );

  const data = createMemo<T[]>(() => local.data ?? []);

  const extractKey = createMemo<KeyExtractor<T>>(
    () =>
      local.keyExtractor ??
      ((_, index) => {
        return String(index);
      })
  );

  const items = createMemo<ItemEntry<T>[]>(() => {
    const entries = data().map((item, index) => ({
      item,
      index,
      key: extractKey()(item, index),
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

  const estimatedItemLength = createMemo<number>(() => {
    if (typeof local.itemSize === "number" && local.itemSize > 0) {
      return local.itemSize;
    }
    if (
      typeof local.estimatedItemSize === "number" &&
      local.estimatedItemSize > 0
    ) {
      return local.estimatedItemSize;
    }
    return DEFAULT_ITEM_LENGTH;
  });

  const totalContentSize = createMemo(() => {
    const length = estimatedItemLength();
    return items().length * length;
  });

  const isHorizontal = createMemo(() => !!local.horizontal);
  const [viewportSize, setViewportSize] = createSignal(0);
  const [scrollOffset, setScrollOffset] = createSignal(0);

  const windowSize = createMemo(() => local.windowSize ?? DEFAULT_WINDOW_SIZE);

  const effectiveViewportSize = createMemo(() => {
    const measured = viewportSize();
    if (measured > 0) return measured;
    return estimatedItemLength();
  });

  const overscanConfig = createMemo(() =>
    resolveOverscan(local.overscan, effectiveViewportSize(), windowSize())
  );

  const rangeSignal = createSignal({ start: 0, end: -1 });
  const [renderRange, setRenderRange] = rangeSignal;

  const [hasReportedLoad, setHasReportedLoad] = createSignal(false);
  const startTime = now();

  const defaultEndThreshold = createMemo(
    () => local.onEndReachedThreshold ?? DEFAULT_END_REACHED_THRESHOLD
  );
  const defaultStartThreshold = createMemo(
    () => local.onStartReachedThreshold ?? DEFAULT_START_REACHED_THRESHOLD
  );

  const endReachedState = { armed: true };
  const startReachedState = { armed: true };

  const [pendingViewability, setPendingViewability] =
    createSignal<ViewToken<T>[]>([]);

  let warnedNumColumns = false;
  let warnedStartFromBottom = false;
  let warnedMissingEstimate = false;

  const warnIfNeeded = () => {
    if (!warnedNumColumns && local.numColumns && local.numColumns > 1) {
      warnedNumColumns = true;
      console.warn(
        "[FlatList] numColumns > 1 is not yet fully supported; items will render in a single column."
      );
    }
    if (
      !warnedStartFromBottom &&
      local.maintainVisibleContentPosition?.startRenderingFromBottom
    ) {
      warnedStartFromBottom = true;
      console.warn(
        "[FlatList] startRenderingFromBottom is not supported in this implementation yet."
      );
    }
    if (
      !warnedMissingEstimate &&
      !local.itemSize &&
      !(
        typeof local.estimatedItemSize === "number" &&
        local.estimatedItemSize > 0
      )
    ) {
      warnedMissingEstimate = true;
      console.warn(
        "[FlatList] Consider providing `itemSize` or `estimatedItemSize` for better performance and accurate virtualization."
      );
    }
  };

  const computeVisibleRange = () => {
    const entries = items();
    if (!entries.length) {
      const previous = renderRange();
      if (previous.start !== 0 || previous.end !== -1) {
        setRenderRange({ start: 0, end: -1 });
      }
      resolvedController().__setVisibleIndices?.([]);
      return;
    }
    const itemLength = estimatedItemLength();
    const viewport = effectiveViewportSize();
    const currentOffset = scrollOffset();
    const { ahead, behind } = overscanConfig();
    const startOffset = Math.max(0, currentOffset - behind);
    const endOffset = Math.min(
      totalContentSize(),
      currentOffset + viewport + ahead
    );
    const firstCandidate = Math.max(
      0,
      Math.floor(startOffset / Math.max(itemLength, 1))
    );
    const lastCandidate = Math.min(
      entries.length - 1,
      Math.ceil(endOffset / Math.max(itemLength, 1)) - 1
    );
    const startIndex = Math.max(0, firstCandidate);
    const endIndex = Math.max(startIndex, lastCandidate);
    const previous = renderRange();
    if (previous.start !== startIndex || previous.end !== endIndex) {
      setRenderRange({ start: startIndex, end: endIndex });
    }

    const visibleStart = Math.max(
      0,
      Math.floor(currentOffset / Math.max(itemLength, 1))
    );
    const visibleEnd = Math.min(
      entries.length - 1,
      Math.floor((currentOffset + viewport) / Math.max(itemLength, 1))
    );
    const visible: number[] = [];
    for (let i = visibleStart; i <= visibleEnd; i += 1) {
      if (i >= 0 && i < entries.length) {
        visible.push(entries[i].index);
      }
    }
    resolvedController().__setVisibleIndices?.(visible);

    const tokens: ViewToken<T>[] = visible.map((index) => {
      const entry = entries[index];
      return {
        index: entry.index,
        isViewable: true,
        item: entry.item,
        key: entry.key,
        timestamp: Date.now(),
      };
    });
    setPendingViewability(tokens);
  };


  const updateRange = () => {
    computeVisibleRange();
    maybeEmitLoadEvent();
    maybeCheckBoundaries();
    maybeEmitBlankArea();
    emitViewability();
  };

  const maybeEmitLoadEvent = () => {
    if (hasReportedLoad()) return;
    if (renderRange().end >= renderRange().start) {
      local.onLoad?.({ elapsedTimeInMs: now() - startTime });
      setHasReportedLoad(true);
    }
  };

  const findIndexForItem = (item: any) => {
    const entries = items();
    for (let i = 0; i < entries.length; i += 1) {
      if (entries[i].item === item) {
        return i;
      }
    }
    return null;
  };

  const computeOffsetForIndex = (
    index: number,
    opts?: { viewOffset?: number; viewPosition?: number }
  ) => {
    const entries = items();
    if (index < 0 || index >= entries.length) return null;
    const itemLength = estimatedItemLength();
    const baseOffset = index * itemLength;
    const viewport = effectiveViewportSize();
    const viewOffset = opts?.viewOffset ?? 0;
    if (opts?.viewPosition !== undefined && !Number.isNaN(opts.viewPosition)) {
      const viewPosition = Math.min(Math.max(opts.viewPosition, 0), 1);
      const aligned =
        baseOffset - viewOffset - viewPosition * (viewport - itemLength);
      return aligned;
    }
    return baseOffset - viewOffset;
  };

  const maybeCheckBoundaries = () => {
    const total = totalContentSize();
    const viewport = effectiveViewportSize();
    const offset = scrollOffset();
    const endThreshold = defaultEndThreshold();
    const startThreshold = defaultStartThreshold();
    const endDistance = total - (offset + viewport);
    const endPx =
      endThreshold <= 1 ? viewport * endThreshold : endThreshold;
    if (endDistance <= endPx) {
      if (endReachedState.armed) {
        endReachedState.armed = false;
        local.onEndReached?.();
      }
    } else if (endDistance > endPx * 1.5) {
      endReachedState.armed = true;
    }

    const startDistance = offset;
    const startPx =
      startThreshold <= 1 ? viewport * startThreshold : startThreshold;
    if (startDistance <= startPx) {
      if (startReachedState.armed) {
        startReachedState.armed = false;
        local.onStartReached?.();
      }
    } else if (startDistance > startPx * 1.5) {
      startReachedState.armed = true;
    }
  };

  const maybeEmitBlankArea = () => {
    if (!local.onBlankArea) return;
    const { start, end } = renderRange();
    const length = estimatedItemLength();
    const before = start * length;
    const after = totalContentSize() - (end + 1) * length;
    const scrollStart = scrollOffset();
    const viewport = effectiveViewportSize();
    const visibleEnd = scrollStart + viewport;
    const blankStart = Math.max(0, scrollStart - before);
    const blankEnd = Math.max(0, after - Math.max(0, totalContentSize() - visibleEnd));
    const blankArea = blankStart + blankEnd;
    local.onBlankArea?.({
      offsetStart: before,
      offsetEnd: totalContentSize() - after,
      blankArea,
    });
  };

  const emitViewability = () => {
    const tokens = pendingViewability();
    if (!tokens.length) return;
    const info = { viewableItems: tokens, changed: tokens };
    local.onViewableItemsChanged?.(info);
    const pairs = local.viewabilityConfigCallbackPairs ?? [];
    for (const pair of pairs) {
      if (pair.onViewableItemsChanged) {
        pair.onViewableItemsChanged(info);
      }
    }
    setPendingViewability([]);
  };

  const handleScroll = (event: ScrollEvent) => {
    const offset = isHorizontal() ? event.contentOffset.x : event.contentOffset.y;
    const viewport = isHorizontal()
      ? event.layoutMeasurement.width
      : event.layoutMeasurement.height;
    const currentOffset = scrollOffset();
    const currentViewport = viewportSize();
    batch(() => {
      if (currentOffset !== offset) {
        setScrollOffset(offset);
      }
      if (viewport > 1 && currentViewport !== viewport) {
        setViewportSize(viewport);
      }
    });
    resolvedController().__setLayout?.({
      x: 0,
      y: 0,
      width: event.layoutMeasurement.width,
      height: event.layoutMeasurement.height,
    });
    updateRange();
    local.onScroll?.(event);
    scrollViewProps().onScroll?.(event);
  };

  const wrapHandler =
    (handler?: (event: ScrollEvent) => void, extra?: (event: ScrollEvent) => void) =>
    (event: ScrollEvent) => {
      handler?.(event);
      extra?.(event);
    };

  const beforeSpacerStyle = createMemo<Style>(() => {
    const { start } = renderRange();
    const length = estimatedItemLength();
    const size = start * length;
    return isHorizontal()
      ? ({ width: size } as Style)
      : ({ height: size } as Style);
  });

  const afterSpacerStyle = createMemo<Style>(() => {
    const { end } = renderRange();
    const entries = items();
    const length = estimatedItemLength();
    const size = Math.max(
      0,
      totalContentSize() - (end + 1) * length
    );
    return isHorizontal()
      ? ({ width: size } as Style)
      : ({ height: size } as Style);
  });

const visibleEntries = createMemo<ItemEntry<T>[]>(() => {
  const { start, end } = renderRange();
  const entries = items();
  if (start > end) return [];
  const output: ItemEntry<T>[] = [];
  for (let i = start; i <= end && i < entries.length; i += 1) {
    output.push(entries[i]);
  }
  return output;
});

const rowWrapperStyle = createMemo<Style>(() => {
  const length = estimatedItemLength();
  return isHorizontal()
    ? ({ width: length } as Style)
    : ({ height: length } as Style);
});

  const contentStyle = createMemo<Style>(() => {
    const base =
      local.contentContainerStyle && typeof local.contentContainerStyle === "object"
        ? { ...local.contentContainerStyle }
        : {};
    if (isHorizontal()) {
      return { ...base, flexDirection: "row" };
    }
    return base;
  });

  const handleInitialScroll = () => {
    if (
      typeof local.initialScrollIndex === "number" &&
      local.initialScrollIndex >= 0
    ) {
      const offset = computeOffsetForIndex(local.initialScrollIndex, {
        viewOffset: local.initialScrollIndexParams?.viewOffset ?? 0,
      });
      if (offset != null) {
        const clamped = Math.max(0, offset);
        setScrollOffset(clamped);
        scrollController.scrollTo(
          isHorizontal()
            ? { x: clamped, animated: false }
            : { y: clamped, animated: false }
        );
      }
    }
  };

  onMount(() => {
    warnIfNeeded();
    handleInitialScroll();
    updateRange();
  });

  createEffect(() => {
    local.extraData;
    estimatedItemLength();
    overscanConfig();
    isHorizontal();
    warnIfNeeded();
    untrack(() => updateRange());
  });

  const resizeObserver = () => {
    const layout = resolvedController().layout();
    resolvedController().__setLayout?.(layout);
  };

  createEffect(() => {
    resolvedController().__setInternals?.({
      scrollController,
      isHorizontal,
      computeOffsetForIndex,
      findIndexForItem,
      getTotalContentSize: () => totalContentSize(),
      getNativeNode: () => null,
      triggerViewability: () => emitViewability(),
    });
  });

  onCleanup(() => {
    resolvedController().__setInternals?.({
      scrollController: null,
      isHorizontal,
      computeOffsetForIndex,
      findIndexForItem,
      getTotalContentSize: () => 0,
      getNativeNode: () => null,
      triggerViewability: () => {},
    });
  });

  return (
    <ScrollView
      {...scrollViewProps()}
      horizontal={isHorizontal()}
      style={local.style}
      contentContainerStyle={contentStyle()}
      controller={scrollController}
      onScroll={handleScroll}
      onScrollBeginDrag={wrapHandler(
        local.onScrollBeginDrag,
        scrollViewProps().onScrollBeginDrag
      )}
      onScrollEndDrag={wrapHandler(
        local.onScrollEndDrag,
        scrollViewProps().onScrollEndDrag
      )}
      onMomentumScrollBegin={wrapHandler(
        local.onMomentumScrollBegin,
        scrollViewProps().onMomentumScrollBegin
      )}
      onMomentumScrollEnd={wrapHandler(
        local.onMomentumScrollEnd,
        scrollViewProps().onMomentumScrollEnd
      )}
      refreshing={local.refreshing ?? scrollViewProps().refreshing}
      onRefresh={scrollViewProps().onRefresh ?? local.onRefresh}
      refreshControl={local.refreshControl ?? scrollViewProps().refreshControl}
      testID={local.testID ?? scrollViewProps().testID}
    >
      {renderSupplemental(local.ListHeaderComponent)}
      {items().length === 0 ? renderSupplemental(local.ListEmptyComponent) : null}
      {(() => {
        const entries = visibleEntries();
        if (!entries.length) return null;
        const wrapperStyle = rowWrapperStyle();
        return (
          <>
            <View style={beforeSpacerStyle()} />
            <For each={entries}>
              {(entry, indexAccessor) => {
                const idx = indexAccessor();
                const cell = local.renderItem({
                  item: entry.item,
                  index: entry.index,
                  key: entry.key,
                  target: "cell",
                  extraData: local.extraData,
                });
                const next = idx < entries.length - 1 ? entries[idx + 1] : undefined;
                return (
                  <>
                    <View key={entry.key} style={wrapperStyle}>
                      {cell}
                    </View>
                    {local.ItemSeparatorComponent && next ? (
                      <View key={`${entry.key}-separator`}>
                        {renderSeparator(
                          local.ItemSeparatorComponent,
                          entry.item,
                          next.item
                        )}
                      </View>
                    ) : null}
                  </>
                );
              }}
            </For>
            <View style={afterSpacerStyle()} />
          </>
        );
      })()}
      {renderSupplemental(local.ListFooterComponent)}
    </ScrollView>
  );
}
