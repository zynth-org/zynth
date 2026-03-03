import {
  JSX,
  Index,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  For,
  getOwner,
  runWithOwner,
} from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { Platform, OS } from "@zynth/apis";
import type { Style } from "@zynth/core";
import { ScrollView, createScrollController } from "./ScrollView";
import type {
  ScrollEvent,
  MaintainVisibleContentPosition,
  ScrollViewConfig,
} from "./ScrollView";
import { View, type LayoutChangeEvent } from "./View";
import type { FlatListController } from "./flatlist/controller";

export type ItemSeparatorProps<T> = {
  leadingItem: T;
  trailingItem?: T;
  leadingIndex: number;
  trailingIndex?: number;
};

export type FlatListRenderItemInfo<T> = {
  item: T;
  index: number;
  itemSignal: Accessor<T | null>;
  indexSignal: Accessor<number>;
};

export type FlatListProps<T> = {
  data: T[];
  renderItem: (info: FlatListRenderItemInfo<T>) => JSX.Element;
  keyExtractor: (item: T, index: number) => string;
  recycle?: boolean;
  estimatedItemSize?: number;
  poolSize?: number;
  maxPoolSize?: number;
  // Number = item count; config.main = px; config.multiple = item-size multiplier.
  overscan?: number | { multiple?: number; main?: number };
  inverted?: boolean;
  extraData?: unknown;
  horizontal?: boolean;
  style?: Style;
  contentContainerStyle?: Style;
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  controller?: FlatListController;
  scrollViewConfig?: ScrollViewConfig;
  scrollEventThrottleMs?: number;
  scrollEventMinDisplacementPx?: number;
  scrollBridgeCoalescing?: boolean;
  decelerationRate?: "normal" | "fast" | number;
  ItemSeparatorComponent?: (info: ItemSeparatorProps<T>) => JSX.Element;
  ListHeaderComponent?: JSX.Element | (() => JSX.Element);
  ListFooterComponent?: JSX.Element | (() => JSX.Element);
  ListEmptyComponent?: JSX.Element | (() => JSX.Element);
  testID?: string;
  onLayout?: (event: LayoutChangeEvent) => void;
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onScroll?: (event: ScrollEvent) => void;
  debug?: boolean;
  /**
   * The native ID of a SharedValue to be updated synchronously on the UI thread
   * with the scroll offset. This bypasses the JS bridge for high-performance animations.
   */
  contentOffsetSharedValue?: number;
};

type PoolSlot<T> = {
  slotIndex: number;
  index: Accessor<number>;
  setIndex: Setter<number>;
  item: Accessor<T | null>;
  setItem: Setter<T | null>;
  key: Accessor<string | null>;
  setKey: Setter<string | null>;
  layoutToken: Accessor<number>;
  setLayoutToken: Setter<number>;
};

const DEFAULT_ESTIMATED_ITEM_SIZE = 64;
const DEFAULT_MIN_POOL_ITEMS = 15;
const DEFAULT_OVERSCAN_MULTIPLE = 2;
const DEFAULT_POOL_GROWTH_CHUNK = 24;
const MEASUREMENT_EPSILON = 0.5;
const LAYOUT_TOTAL_EPSILON = 0.5;
const OFFSET_EPSILON = 0.01;
const ADAPTIVE_ESTIMATE_SAMPLES = 8;
const ADAPTIVE_ESTIMATE_THRESHOLD = 0.1;

const resolvePadding = (style?: Style | Style[]) => {
  const merged: Style = {};
  if (Array.isArray(style)) {
    for (const entry of style) {
      if (entry) Object.assign(merged, entry);
    }
  } else if (style) {
    Object.assign(merged, style);
  }

  const hasNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

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

  return { top, bottom, left, right };
};

class FenwickTree {
  private size = 0;
  private tree: number[] = [];
  private values: number[] = [];

  reset(values: number[]) {
    this.size = values.length;
    this.values = values.slice();
    this.tree = new Array(this.size + 1).fill(0);
    for (let i = 0; i < values.length; i += 1) {
      let idx = i + 1;
      const value = values[i] ?? 0;
      while (idx <= this.size) {
        this.tree[idx] += value;
        idx += idx & -idx;
      }
    }
  }

  value(index: number) {
    return this.values[index] ?? 0;
  }

  update(index: number, nextValue: number) {
    if (index < 0 || index >= this.size) return;
    const prev = this.values[index] ?? 0;
    const delta = nextValue - prev;
    if (Math.abs(delta) < MEASUREMENT_EPSILON) return;
    this.values[index] = nextValue;
    let idx = index + 1;
    while (idx <= this.size) {
      this.tree[idx] += delta;
      idx += idx & -idx;
    }
  }

  prefixSum(index: number) {
    if (index < 0) return 0;
    let idx = Math.min(index + 1, this.size);
    let sum = 0;
    while (idx > 0) {
      sum += this.tree[idx];
      idx -= idx & -idx;
    }
    return sum;
  }

  total() {
    if (this.size === 0) return 0;
    return this.prefixSum(this.size - 1);
  }

  findIndexByOffset(offset: number) {
    if (this.size === 0) return -1;
    const target = Math.max(0, offset);
    let idx = 0;
    let bit = 1;
    while (bit <= this.size) {
      bit <<= 1;
    }
    let sum = 0;
    while (bit !== 0) {
      const next = idx + bit;
      if (next <= this.size && sum + this.tree[next] <= target) {
        idx = next;
        sum += this.tree[next];
      }
      bit >>= 1;
    }
    if (idx >= this.size) return this.size - 1;
    return idx;
  }
}

const createPoolSlot = <T,>(slotIndex: number): PoolSlot<T> => {
  const [index, setIndex] = createSignal(-1);
  const [item, setItem] = createSignal<T | null>(null);
  const [key, setKey] = createSignal<string | null>(null);
  const [layoutToken, setLayoutToken] = createSignal(0);
  return {
    slotIndex,
    index,
    setIndex,
    item,
    setItem,
    key,
    setKey,
    layoutToken,
    setLayoutToken,
  };
};

export function FlatList<T>(props: FlatListProps<T>) {
  const owner = getOwner();
  const log = (msg: string, ...args: any[]) => {
    if (props.debug) {
      console.log(`[FlatList] ${msg}`, ...args);
    }
  };

  const scrollController = createScrollController();

  const [viewportSize, setViewportSize] = createSignal(0);
  let lastOffset = 0;
  let lastViewport = 0;

  const isInverted = createMemo(() => props.inverted ?? false);

  createEffect(() => {
    const controller = props.controller as any;
    if (!controller) return;
    if (typeof controller.__setScrollController === "function") {
      controller.__setScrollController(scrollController);
    }
    onCleanup(() => {
      if (typeof controller.__setScrollController === "function") {
        controller.__setScrollController(null);
      }
      if (typeof controller.__setLayoutResolver === "function") {
        controller.__setLayoutResolver(null);
      }
    });
  });

  createEffect(() => {
    const controller = props.controller as any;
    if (!controller || typeof controller.__setMetadata !== "function") return;
    controller.__setMetadata({
      itemSize: layoutEstimate(),
      horizontal: !!props.horizontal,
      dataLength: props.data.length,
    });
  });

  const estimatedItemSize = createMemo(() => {
    const estimate = props.estimatedItemSize;
    if (typeof estimate === "number" && estimate > 0) {
      return estimate;
    }
    return DEFAULT_ESTIMATED_ITEM_SIZE;
  });

  const [layoutEstimate, setLayoutEstimate] = createSignal(estimatedItemSize());
  let adaptiveLocked = false;
  let measuredSum = 0;
  let measuredCount = 0;
  let dataKeyToIndex = new Map<string, number>();

  createEffect(() => {
    const estimate = estimatedItemSize();
    setLayoutEstimate(estimate);
    adaptiveLocked = false;
  });

  const defaultScrollViewStyle: Style = { overflow: "hidden" as const };
  const mergedScrollViewStyle = createMemo(() => {
    const user = props.style as Style | undefined;
    if (!user) return defaultScrollViewStyle;
    return { ...defaultScrollViewStyle, ...user } as Style;
  });

  const fallbackViewport = createMemo(() => {
    const style = mergedScrollViewStyle() as Style | undefined;
    if (!style) return 800;
    const sizeValue = props.horizontal ? style.width : style.height;
    if (typeof sizeValue === "number") return sizeValue;
    return 800;
  });

  const effectiveViewport = createMemo(() => {
    const viewport = viewportSize();
    return viewport > 0 ? viewport : fallbackViewport();
  });

  const overscanMainDistance = createMemo(() => {
    const config = props.overscan;
    if (typeof config === "number") {
      return Math.max(0, config * layoutEstimate());
    }
    if (config && typeof config.main === "number") {
      return Math.max(0, config.main);
    }
    const multiple =
      config && typeof config.multiple === "number"
        ? config.multiple
        : DEFAULT_OVERSCAN_MULTIPLE;
    return Math.max(0, layoutEstimate() * multiple);
  });

  const desiredPoolSize = createMemo(() => {
    const maxPoolSize =
      typeof props.maxPoolSize === "number"
        ? Math.max(0, props.maxPoolSize)
        : Number.POSITIVE_INFINITY;
    if (typeof props.poolSize === "number") {
      return Math.min(Math.max(0, props.poolSize), maxPoolSize);
    }
    const dataLength = props.data.length;
    if (dataLength === 0) return 0;
    const estimate = layoutEstimate();
    const viewport = effectiveViewport();
    const visibleCount = Math.max(1, Math.ceil(viewport / estimate));
    const overscanCount = Math.max(
      0,
      Math.ceil(overscanMainDistance() / estimate),
    );
    const calculated = Math.max(
      DEFAULT_MIN_POOL_ITEMS,
      visibleCount + overscanCount * 2,
    );
    return Math.min(calculated, dataLength, maxPoolSize);
  });

  const [poolSlots, setPoolSlots] = createSignal<PoolSlot<T>[]>([]);
  let poolSlotsRef: PoolSlot<T>[] = [];
  const slotBindings: number[] = [];
  let pendingPoolTarget = 0;
  let poolGrowScheduled = false;
  let isScrolling = false;
  let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null;

  const ensurePoolSize = (size: number) => {
    if (size <= poolSlotsRef.length) return false;
    const next = poolSlotsRef.slice();
    for (let i = poolSlotsRef.length; i < size; i += 1) {
      next.push(createPoolSlot<T>(i));
      slotBindings[i] = -1;
    }
    poolSlotsRef = next;
    setPoolSlots(next);
    lastRangeStart = -1;
    lastRangeEnd = -1;
    lastBindingsOffset = Number.NaN;
    lastBindingsViewport = Number.NaN;
    lastBindingsTotal = Number.NaN;
    log(`Pool grown to ${size} slots`);
    return true;
  };

  const schedulePoolGrowth = (target: number) => {
    if (target <= poolSlotsRef.length) return;
    pendingPoolTarget = Math.max(pendingPoolTarget, target);
    if (!isScrolling) {
      const didGrow = ensurePoolSize(pendingPoolTarget);
      pendingPoolTarget = 0;
      if (didGrow) {
        updateBindingsForOffset(lastOffset, effectiveViewport());
      }
      return;
    }
    if (poolGrowScheduled) return;
    poolGrowScheduled = true;
    const grow = () => {
      poolGrowScheduled = false;
      const current = poolSlotsRef.length;
      if (pendingPoolTarget <= current) return;
      const nextSize = Math.min(
        pendingPoolTarget,
        current + DEFAULT_POOL_GROWTH_CHUNK,
      );
      const didGrow = ensurePoolSize(nextSize);
      if (didGrow) {
        updateBindingsForOffset(lastOffset, effectiveViewport());
      }
      if (poolSlotsRef.length < pendingPoolTarget) {
        schedulePoolGrowth(pendingPoolTarget);
      }
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => grow());
    } else {
      Promise.resolve().then(grow);
    }
  };

  createEffect(() => {
    schedulePoolGrowth(desiredPoolSize());
  });

  const measurementCache = new Map<string, number>();
  const pendingMeasurementCache = new Map<string, number>();
  const sizeTree = new FenwickTree();
  let dataKeys: string[] = [];
  let layoutTotal = 0;
  const [layoutVersion, setLayoutVersion] = createSignal(0);
  let lastBindingsOffset = Number.NaN;
  let lastBindingsViewport = Number.NaN;
  let lastBindingsTotal = Number.NaN;
  let pendingBindingsMicrotask = false;
  let pendingBindingsFrame = false;
  let pendingBindingsOffset = 0;
  let pendingBindingsViewport = 0;

  const commitMeasurement = (key: string, size: number) => {
    const prev = measurementCache.get(key);
    if (prev !== undefined && Math.abs(prev - size) < MEASUREMENT_EPSILON) {
      return false;
    }
    if (prev !== undefined && size + MEASUREMENT_EPSILON < prev) {
      // Avoid shrinking cached sizes from stale/recycled measurements.
      return false;
    }
    const mappedIndex = dataKeyToIndex.get(key);
    if (mappedIndex === undefined) return false;
    measurementCache.set(key, size);
    if (prev === undefined) {
      measuredSum += size;
      measuredCount += 1;
    } else {
      measuredSum += size - prev;
    }
    sizeTree.update(mappedIndex, size);
    return true;
  };

  const finalizeMeasurementPass = () => {
    layoutTotal = sizeTree.total();
    setLayoutVersion((prevVersion) => prevVersion + 1);
    scheduleBindingsUpdate(lastOffset, lastViewport, false);

    if (
      !adaptiveLocked &&
      measuredCount >= ADAPTIVE_ESTIMATE_SAMPLES &&
      dataKeys.length > 0
    ) {
      const avg = measuredSum / measuredCount;
      const base = layoutEstimate();
      if (Number.isFinite(avg) && avg > 0 && base > 0) {
        const delta = Math.abs(avg - base) / base;
        if (delta >= ADAPTIVE_ESTIMATE_THRESHOLD) {
          adaptiveLocked = true;
          setLayoutEstimate(avg);
          rebuildLayout(dataKeys);
          refreshBindings();
          scheduleBindingsUpdate(lastOffset, lastViewport, false);
        }
      }
    }
  };

  const flushPendingMeasurements = () => {
    if (pendingMeasurementCache.size === 0) return;
    let changed = false;
    for (const [pendingKey, pendingSize] of pendingMeasurementCache) {
      if (commitMeasurement(pendingKey, pendingSize)) {
        changed = true;
      }
    }
    pendingMeasurementCache.clear();
    if (changed) {
      finalizeMeasurementPass();
    }
  };

  const rebuildLayout = (nextKeys: string[]) => {
    const estimate = layoutEstimate();
    const nextSizes = new Array(nextKeys.length);
    let nextMeasuredSum = 0;
    let nextMeasuredCount = 0;
    const nextKeyToIndex = new Map<string, number>();
    for (let i = 0; i < nextKeys.length; i += 1) {
      const key = nextKeys[i];
      nextKeyToIndex.set(key, i);
      const cached = measurementCache.get(key);
      if (cached && cached > 0) {
        nextSizes[i] = cached;
        nextMeasuredSum += cached;
        nextMeasuredCount += 1;
      } else {
        nextSizes[i] = estimate;
      }
    }
    sizeTree.reset(nextSizes);
    layoutTotal = sizeTree.total();
    dataKeys = nextKeys;
    dataKeyToIndex = nextKeyToIndex;
    measuredSum = nextMeasuredSum;
    measuredCount = nextMeasuredCount;
    setLayoutVersion((prev) => prev + 1);
    lastRangeStart = -1;
    lastRangeEnd = -1;
    lastBindingsOffset = Number.NaN;
    lastBindingsViewport = Number.NaN;
    lastBindingsTotal = Number.NaN;
  };

  const getOffsetForIndex = (index: number) => sizeTree.prefixSum(index - 1);
  const getSizeForIndex = (index: number) => {
    if (index < 0 || index >= dataKeys.length) {
      return layoutEstimate();
    }
    const value = sizeTree.value(index);
    return value > 0 ? value : layoutEstimate();
  };
  const getTotalSize = () => sizeTree.total();
  const getLogicalOffset = (rawOffset: number, viewport: number) => {
    if (!isInverted()) return rawOffset;
    const maxOffset = Math.max(0, getTotalSize() - viewport);
    return Math.max(0, maxOffset - rawOffset);
  };
  const getRawOffset = (logicalOffset: number, viewport: number) => {
    if (!isInverted()) return Math.max(0, logicalOffset);
    const maxOffset = Math.max(0, getTotalSize() - viewport);
    return Math.max(0, maxOffset - logicalOffset);
  };
  const getItemPosition = (index: number) => {
    const base = getOffsetForIndex(index);
    if (!isInverted()) return base;
    const size = getSizeForIndex(index);
    return Math.max(0, getTotalSize() - base - size);
  };

  createEffect(() => {
    const controller = props.controller as any;
    if (!controller || typeof controller.__setLayoutResolver !== "function") {
      return;
    }
    controller.__setLayoutResolver({
      getOffset: (index: number) => getOffsetForIndex(index),
      getSize: (index: number) => getSizeForIndex(index),
      getTotal: () => getTotalSize(),
      getLength: () => props.data.length,
      isHorizontal: () => !!props.horizontal,
      isInverted: () => isInverted(),
    });
  });

  createEffect(() => {
    const controller = props.controller as any;
    if (!controller || typeof controller.__triggerRecompute !== "function") {
      return;
    }
    controller.__triggerRecompute();
    updateBindingsForOffset(lastOffset, lastViewport || effectiveViewport());
  });

  let lastRangeStart = -1;
  let lastRangeEnd = -1;

  const bindSlot = (slotIndex: number, dataIndex: number) => {
    const slot = poolSlotsRef[slotIndex];
    if (!slot) return;
    slotBindings[slotIndex] = dataIndex;
    slot.setLayoutToken((value) => value + 1);
    if (dataIndex < 0 || dataIndex >= props.data.length) {
      slot.setIndex(-1);
      slot.setItem(null);
      slot.setKey(null);
      return;
    }
    const item = props.data[dataIndex];
    const key = item ? props.keyExtractor(item, dataIndex) : null;
    slot.setIndex(dataIndex);
    slot.setItem((item ?? null) as any);
    slot.setKey(key);
  };

  const refreshBindings = () => {
    if (!poolSlotsRef.length) return;
    for (let i = 0; i < poolSlotsRef.length; i += 1) {
      const boundIndex = slotBindings[i];
      if (boundIndex < 0 || boundIndex >= props.data.length) {
        bindSlot(i, -1);
      } else {
        bindSlot(i, boundIndex);
      }
    }
  };

  const [isFlowLayout, setIsFlowLayout] = createSignal(true);
  const [flowOffset, setFlowOffset] = createSignal(0);

  const updateBindingsForOffset = (offset: number, viewport: number) => {
    const dataLength = props.data.length;
    if (dataLength !== dataKeys.length) return;
    if (dataLength === 0 || poolSlotsRef.length === 0) {
      if (poolSlotsRef.length > 0) {
        for (let i = 0; i < poolSlotsRef.length; i += 1) {
          if (slotBindings[i] !== -1) {
            bindSlot(i, -1);
          }
        }
      }
      return;
    }

    const overscan = overscanMainDistance();
    const total = getTotalSize();
    if (
      lastRangeStart !== -1 &&
      lastRangeEnd !== -1 &&
      Math.abs(offset - lastBindingsOffset) < OFFSET_EPSILON &&
      Math.abs(viewport - lastBindingsViewport) < OFFSET_EPSILON &&
      Math.abs(total - lastBindingsTotal) < LAYOUT_TOTAL_EPSILON
    ) {
      return;
    }
    const listOffset = getListOffset(offset, viewport);
    const logicalOffset = getLogicalOffset(listOffset, viewport);
    const startOffset = Math.max(0, logicalOffset - overscan);
    const endOffset = Math.min(total, logicalOffset + viewport + overscan);

    let startIndex = sizeTree.findIndexByOffset(startOffset);
    let endIndex = sizeTree.findIndexByOffset(
      Math.max(0, endOffset - OFFSET_EPSILON),
    );

    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = 0;

    const maxIndex = dataLength - 1;
    startIndex = Math.max(0, Math.min(startIndex, maxIndex));
    endIndex = Math.max(startIndex, Math.min(endIndex, maxIndex));

    const rangeCount = endIndex - startIndex + 1;
    if (rangeCount > poolSlotsRef.length) {
      const maxPoolSize =
        typeof props.maxPoolSize === "number"
          ? Math.max(0, props.maxPoolSize)
          : Number.POSITIVE_INFINITY;
      const nextSize = Math.min(dataLength, rangeCount, maxPoolSize);
      if (nextSize === dataLength && props.debug) {
        log(`Pool expanded to dataLength=${dataLength} (rangeCount=${rangeCount.toFixed(0)})`);
      }
      schedulePoolGrowth(nextSize);
    }

    const targetBindings = Math.min(poolSlotsRef.length, dataLength);
    if (targetBindings > 0 && endIndex - startIndex + 1 < targetBindings) {
      let expandStart = startIndex;
      let expandEnd = endIndex;
      while (
        expandEnd - expandStart + 1 < targetBindings &&
        (expandStart > 0 || expandEnd < maxIndex)
      ) {
        if (expandEnd < maxIndex) {
          expandEnd += 1;
          if (expandEnd - expandStart + 1 >= targetBindings) break;
        }
        if (expandStart > 0) {
          expandStart -= 1;
        }
      }
      startIndex = expandStart;
      endIndex = expandEnd;
    }

    if (startIndex === lastRangeStart && endIndex === lastRangeEnd) {
      lastBindingsOffset = offset;
      lastBindingsViewport = viewport;
      lastBindingsTotal = total;
      return;
    }
    lastRangeStart = startIndex;
    lastRangeEnd = endIndex;
    lastBindingsOffset = offset;
    lastBindingsViewport = viewport;
    lastBindingsTotal = total;

    if (props.debug) {
      log(
        `updateBindings: off=${offset.toFixed(1)} vp=${viewport.toFixed(1)} logOff=${logicalOffset.toFixed(1)} total=${total.toFixed(1)} range=[${startIndex}, ${endIndex}]`,
      );
    }

    const needed = new Set<number>();
    for (let i = startIndex; i <= endIndex; i += 1) {
      needed.add(i);
    }

    for (let i = 0; i < poolSlotsRef.length; i += 1) {
      const boundIndex = slotBindings[i];
      if (boundIndex !== -1 && !needed.has(boundIndex)) {
        bindSlot(i, -1);
      }
    }

    const boundIndices = new Set<number>();
    for (let i = 0; i < poolSlotsRef.length; i += 1) {
      const boundIndex = slotBindings[i];
      if (boundIndex !== -1) boundIndices.add(boundIndex);
    }

    for (let dataIndex = startIndex; dataIndex <= endIndex; dataIndex += 1) {
      if (boundIndices.has(dataIndex)) continue;
      const availableSlot = slotBindings.findIndex((idx) => idx === -1);
      if (availableSlot === -1) break;
      bindSlot(availableSlot, dataIndex);
      boundIndices.add(dataIndex);
    }

    // Check for flow layout eligibility (contiguous sorted slots)
    let isFlow = true;
    let lastBound = -1;
    let firstBound = -1;
    for (let i = 0; i < slotBindings.length; i++) {
      const idx = slotBindings[i];
      if (idx === -1) continue;
      if (firstBound === -1) firstBound = idx;
      
      if (lastBound !== -1 && idx !== lastBound + 1) {
        isFlow = false;
        break;
      }
      lastBound = idx;
    }
    // Also check if the DOM order (slots) matches Data order.
    // Since we iterate poolSlotsRef (DOM order) and check if indices are increasing,
    // this correctly verifies that DOM Slot 0 has Index K, Slot 1 has Index K+1, etc.
    
    if (isFlow && firstBound !== -1) {
      setIsFlowLayout(true);
      setFlowOffset(getOffsetForIndex(firstBound));
    } else {
      setIsFlowLayout(false);
      setFlowOffset(0);
    }
  };

  const scheduleBindingsUpdate = (
    offset: number,
    viewport: number,
    useFrame: boolean,
  ) => {
    pendingBindingsOffset = offset;
    pendingBindingsViewport = viewport;
    if (useFrame && typeof requestAnimationFrame === "function") {
      if (pendingBindingsFrame) return;
      pendingBindingsFrame = true;
      requestAnimationFrame(() => {
        pendingBindingsFrame = false;
        updateBindingsForOffset(
          pendingBindingsOffset,
          pendingBindingsViewport,
        );
      });
      return;
    }
    if (pendingBindingsMicrotask) return;
    pendingBindingsMicrotask = true;
    const flush = () => {
      pendingBindingsMicrotask = false;
      updateBindingsForOffset(pendingBindingsOffset, pendingBindingsViewport);
    };
    if (typeof queueMicrotask === "function") {
      queueMicrotask(flush);
    } else {
      Promise.resolve().then(flush);
    }
  };

  const [startFired, setStartFired] = createSignal(false);
  const [endFired, setEndFired] = createSignal(false);
  let startRearmThreshold = 0;
  let endRearmThreshold = 0;
  const [headerExtent, setHeaderExtent] = createSignal(0);
  const [footerExtent, setFooterExtent] = createSignal(0);
  const hasHeaderDecorator = createMemo(() => !!props.ListHeaderComponent);
  const hasFooterDecorator = createMemo(() => !!props.ListFooterComponent);

  createEffect(() => {
    if (!hasHeaderDecorator()) setHeaderExtent(0);
    if (!hasFooterDecorator()) setFooterExtent(0);
  });

  const getHeaderExtent = () =>
    hasHeaderDecorator() ? headerExtent() : 0;
  const getFooterExtent = () =>
    hasFooterDecorator() ? footerExtent() : 0;

  const getListOffset = (rawOffset: number, viewport: number) => {
    const adjusted = Math.max(0, rawOffset - getHeaderExtent());
    const maxOffset = Math.max(0, getTotalSize() - viewport);
    return Math.min(adjusted, maxOffset);
  };

  const handleBoundaryEvents = (offset: number, viewport: number) => {
    if (!props.onStartReached && !props.onEndReached) return;
    const total = getTotalSize();
    if (total <= 0 || viewport <= 0) return;
    const logicalOffset = getLogicalOffset(
      getListOffset(offset, viewport),
      viewport,
    );

    if (props.onStartReached) {
      const threshold = (props.onStartReachedThreshold ?? 0.1) * viewport;
      if (!startFired() && logicalOffset <= threshold) {
        setStartFired(true);
        startRearmThreshold = threshold * 1.5;
        setTimeout(() => props.onStartReached?.(), 0);
      } else if (startFired() && logicalOffset > startRearmThreshold) {
        setStartFired(false);
      }
    }

    if (props.onEndReached) {
      const distanceToEnd = Math.max(0, total - viewport - logicalOffset);
      const threshold = (props.onEndReachedThreshold ?? 0.1) * viewport;
      if (!endFired() && distanceToEnd <= threshold) {
        setEndFired(true);
        endRearmThreshold = threshold * 1.5;
        setTimeout(() => props.onEndReached?.(), 0);
      } else if (endFired() && distanceToEnd > endRearmThreshold) {
        setEndFired(false);
      }
    }
  };

  let anchorKey: string | null = null;
  let anchorIndex = -1;
  let anchorOffsetWithinItem = 0;
  let initialBottomScrollApplied = false;
  let previousKeys: string[] = [];

  const updateAnchor = (offset: number, viewport: number) => {
    const config = props.maintainVisibleContentPosition;
    if (!config || config.disabled) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }
    if (dataKeys.length === 0) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }
    const logicalOffset = getLogicalOffset(
      getListOffset(offset, viewport),
      viewport,
    );
    const idx = sizeTree.findIndexByOffset(logicalOffset);
    if (idx < 0 || idx >= dataKeys.length) return;
    const key = dataKeys[idx];
    if (!key) return;
    anchorKey = key;
    anchorIndex = idx;
    const start = getOffsetForIndex(idx);
    const size = getSizeForIndex(idx);
    const remainder = offset - start;
    anchorOffsetWithinItem = Math.max(0, Math.min(remainder, size));
  };

  const scheduleScrollTo = (logicalOffset: number, animated: boolean) => {
    const viewport = lastViewport || effectiveViewport();
    const rawOffset = getRawOffset(logicalOffset, viewport);
    if (props.horizontal) {
      scrollController.scrollTo({ x: rawOffset, animated });
    } else {
      scrollController.scrollTo({ y: rawOffset, animated });
    }
  };

  const scheduleScrollBy = (logicalDelta: number) => {
    if (!logicalDelta || Math.abs(logicalDelta) < 0.5) return;
    const rawDelta = isInverted() ? -logicalDelta : logicalDelta;
    if (props.horizontal) {
      scrollController.scrollBy({ dx: rawDelta, animated: false });
    } else {
      scrollController.scrollBy({ dy: rawDelta, animated: false });
    }
  };

  const handleDataChange = (keys: string[]) => {
    const config = props.maintainVisibleContentPosition;
    const dataLength = keys.length;
    if (!config || config.disabled) {
      previousKeys = keys;
      return;
    }

    if (dataLength === 0) {
      previousKeys = [];
      initialBottomScrollApplied = false;
      return;
    }

    let prefixMatch = 0;
    let suffixMatch = 0;
    let prependedCount = 0;
    let appendedCount = 0;

    const prevLength = previousKeys.length;
    if (prevLength > 0) {
      while (
        prefixMatch < prevLength &&
        prefixMatch < keys.length &&
        previousKeys[prefixMatch] === keys[prefixMatch]
      ) {
        prefixMatch += 1;
      }

      while (
        suffixMatch < prevLength &&
        suffixMatch < keys.length &&
        previousKeys[prevLength - 1 - suffixMatch] ===
          keys[keys.length - 1 - suffixMatch]
      ) {
        suffixMatch += 1;
      }

      if (keys.length > prevLength) {
        if (prefixMatch === prevLength) {
          appendedCount = keys.length - prevLength;
        } else if (suffixMatch === prevLength) {
          prependedCount = keys.length - prevLength;
        }
      }
    } else if (prevLength === 0 && keys.length > 0) {
      appendedCount = keys.length;
    }

    const viewport = effectiveViewport();
    const total = getTotalSize();
    const logicalOffset = getLogicalOffset(
      getListOffset(lastOffset, viewport),
      viewport,
    );

    if (config.startRenderingFromBottom && !initialBottomScrollApplied) {
      scheduleScrollTo(Math.max(0, total - viewport), false);
      initialBottomScrollApplied = true;
    }

    if (prependedCount > 0 && anchorKey) {
      const minIndex = config.minIndexForVisible ?? 0;
      if (anchorIndex <= minIndex) {
        const nextIndex = keys.indexOf(anchorKey);
        if (nextIndex !== -1 && nextIndex !== anchorIndex) {
          const nextOffset =
            getOffsetForIndex(nextIndex) + anchorOffsetWithinItem;
          const delta = nextOffset - logicalOffset;
          scheduleScrollBy(delta);
        }
      }
    }

    if (appendedCount > 0) {
      const distanceToBottom = Math.max(0, total - viewport - logicalOffset);
      const threshold = config.autoscrollToBottomThreshold;
      if (typeof threshold === "number") {
        const thresholdPx = threshold > 1 ? threshold : threshold * viewport;
        if (distanceToBottom <= thresholdPx) {
          scheduleScrollTo(
            Math.max(0, total - viewport),
            config.animateAutoScroll ?? false,
          );
        }
      } else if (config.startRenderingFromBottom) {
        if (distanceToBottom <= 0.5) {
          scheduleScrollTo(Math.max(0, total - viewport), false);
        }
      }
    }

    previousKeys = keys;
  };

  const recordMeasurement = (key: string, index: number, size: number) => {
    if (!key) return;
    if (!Number.isFinite(size) || size <= 0) return;
    const mappedIndex = dataKeyToIndex.get(key);
    if (mappedIndex === undefined || mappedIndex !== index) return;

    if (isScrolling) {
      const queued = pendingMeasurementCache.get(key);
      if (queued === undefined || size > queued) {
        pendingMeasurementCache.set(key, size);
      }
      return;
    }

    if (pendingMeasurementCache.size > 0) {
      flushPendingMeasurements();
    }

    if (commitMeasurement(key, size)) {
      finalizeMeasurementPass();
    }
  };

  createEffect(() => {
    const _extra = props.extraData;
    const keys = props.data.map((item, index) =>
      props.keyExtractor(item, index),
    );
    pendingMeasurementCache.clear();
    adaptiveLocked = false;
    rebuildLayout(keys);
    refreshBindings();
    updateBindingsForOffset(lastOffset, effectiveViewport());
    handleDataChange(keys);
  });

  const handleScroll = (event: ScrollEvent) => {
    runWithOwner(owner, () => {
      isScrolling = true;
      if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
      scrollIdleTimer = setTimeout(() => {
        isScrolling = false;
        flushPendingMeasurements();
      }, 120);
      const offset = props.horizontal
        ? (event.contentOffset?.x ?? 0)
        : (event.contentOffset?.y ?? 0);
      const viewport = props.horizontal
        ? (event.layoutMeasurement?.width ?? 0)
        : (event.layoutMeasurement?.height ?? 0);

      // Protection against spurious 0-offset events (e.g. from race conditions or layout invalidation)
      // that cause the list to momentarily render at the top, creating a "disappearing" flicker.
      // We only block this if we were significantly scrolled down (> viewport) and suddenly jumped to 0.
      if (offset === 0 && lastOffset > (lastViewport || 500)) {
        if (props.debug) {
          log(
            `Ignoring suspicious scroll jump to 0. lastOffset=${lastOffset.toFixed(1)}`,
          );
        }
        return;
      }

      lastOffset = offset;
      lastViewport = viewport > 0 ? viewport : lastViewport;
      if (viewport > 0) {
        setViewportSize(viewport);
      }
      scheduleBindingsUpdate(
        offset,
        viewport > 0 ? viewport : effectiveViewport(),
        true,
      );
      handleBoundaryEvents(offset, viewport > 0 ? viewport : effectiveViewport());
      updateAnchor(offset, viewport > 0 ? viewport : effectiveViewport());
      props.onScroll?.(event);
    });
  };

  createEffect(() => {
    const viewport = effectiveViewport();
    if (viewport <= 0) return;
    lastViewport = viewport;
    updateBindingsForOffset(lastOffset, viewport);
  });

  onCleanup(() => {
    if (scrollIdleTimer) {
      clearTimeout(scrollIdleTimer);
      scrollIdleTimer = null;
    }
    pendingMeasurementCache.clear();
    poolSlotsRef = [];
  });

  const contentSize = createMemo(() => {
    layoutVersion();
    return layoutTotal;
  });

  const contentContainerPadding = createMemo(() => {
    return resolvePadding(props.contentContainerStyle as Style | Style[]);
  });

  const scrollContentSize = createMemo(() => {
    const padding = contentContainerPadding();
    const paddingMain = props.horizontal
      ? padding.left + padding.right
      : padding.top + padding.bottom;
    return contentSize() + getHeaderExtent() + getFooterExtent() + paddingMain;
  });

  const requiredContentStyle = createMemo<Style>(() => {
    const isFlow = isFlowLayout();
    const offset = flowOffset();
    const base: Style = {
      position: "relative",
      [props.horizontal ? "width" : "height"]: contentSize(),
      [props.horizontal ? "height" : "width"]: "100%",
    };
    if (isFlow) {
      if (props.horizontal) {
        base.paddingLeft = offset;
      } else {
        base.paddingTop = offset;
      }
    }
    return base;
  });

  const sanitizedContentContainerStyle = createMemo<Style | undefined>(() => {
    const user = props.contentContainerStyle as Style | undefined;
    if (!user) return undefined;
    const {
      position: _position,
      width: _width,
      height: _height,
      top: _top,
      right: _right,
      bottom: _bottom,
      left: _left,
      ...rest
    } = user;
    return rest as Style;
  });

  const hasData = createMemo(() => props.data.length > 0);

  const manualContentSize = createMemo(() => {
    const total = scrollContentSize();
    if (props.horizontal) {
      return { width: total, height: 0 };
    }
    return { width: 0, height: total };
  });

  const renderDecorator = (
    decorator: JSX.Element | (() => JSX.Element) | undefined,
  ) => {
    if (!decorator) return null;
    return typeof decorator === "function" ? decorator() : decorator;
  };

  const renderHeader = () => {
    const content = renderDecorator(props.ListHeaderComponent);
    if (!content) return null;
    return (
      <View
        onLayout={(event) => {
          const layout = event?.nativeEvent?.layout;
          if (!layout) return;
          const size = props.horizontal ? layout.width : layout.height;
          if (Number.isFinite(size) && size > 0) {
            setHeaderExtent(size);
          }
        }}
      >
        {content}
      </View>
    );
  };

  const renderFooter = () => {
    const content = renderDecorator(props.ListFooterComponent);
    if (!content) return null;
    return (
      <View
        onLayout={(event) => {
          const layout = event?.nativeEvent?.layout;
          if (!layout) return;
          const size = props.horizontal ? layout.width : layout.height;
          if (Number.isFinite(size) && size > 0) {
            setFooterExtent(size);
          }
        }}
      >
        {content}
      </View>
    );
  };

  return (
    <ScrollView
      horizontal={props.horizontal}
      style={mergedScrollViewStyle()}
      contentContainerStyle={sanitizedContentContainerStyle()}
      controller={scrollController}
      config={props.scrollViewConfig}
      eventThrottleMs={props.scrollEventThrottleMs}
      eventMinDisplacementPx={
        props.scrollEventMinDisplacementPx ?? (Platform.OS === OS.IOS ? 1.0 : 0)
      }
      bridgeCoalescing={props.scrollBridgeCoalescing}
      decelerationRate={
        props.decelerationRate ?? (Platform.OS === OS.IOS ? "normal" : "normal")
      }
      contentSize={manualContentSize()}
      testID={props.testID}
      contentOffsetSharedValue={props.contentOffsetSharedValue}
      onLayout={props.onLayout}
      onScroll={handleScroll}
    >
      {renderHeader()}
      {hasData() ? (
        <View style={requiredContentStyle()}>
          <Index each={poolSlots()}>
            {(slot) => {
              const slotData = slot();
              const itemProxy = new Proxy(
                {},
                {
                  get(_, prop) {
                    const item = slotData.item();
                    if (item == null) return undefined;
                    const value = Reflect.get(item as any, prop, item);
                    return typeof value === "function"
                      ? value.bind(item)
                      : value;
                  },
                  has(_, prop) {
                    const item = slotData.item();
                    if (item == null) return false;
                    if (
                      typeof item !== "object" &&
                      typeof item !== "function"
                    ) {
                      return false;
                    }
                    return prop in (item as object);
                  },
                  ownKeys() {
                    const item = slotData.item();
                    return item ? Reflect.ownKeys(item) : [];
                  },
                  getOwnPropertyDescriptor(_, prop) {
                    const item = slotData.item();
                    if (!item) return undefined;
                    const descriptor = Object.getOwnPropertyDescriptor(
                      item,
                      prop,
                    );
                    if (!descriptor) return undefined;
                    return { ...descriptor, configurable: true };
                  },
                },
              ) as T;

              const indexValue = {
                valueOf: () => slotData.index(),
                toString: () => String(slotData.index()),
                [Symbol.toPrimitive](hint: string) {
                  const value = slotData.index();
                  return hint === "string" ? String(value) : value;
                },
              } as unknown as number;

              const renderKeyList = createMemo(() => {
                const item = slotData.item();
                if (item === null || item === undefined) return [];
                if (props.recycle) return ["stable"];
                return [slotData.index()];
              });

              const position = createMemo(() => {
                layoutVersion();
                const idx = slotData.index();
                if (idx < 0) return -9999;
                return getItemPosition(idx);
              });

              const extent = createMemo(() => {
                layoutVersion();
                const idx = slotData.index();
                if (idx < 0) return estimatedItemSize();
                return getSizeForIndex(idx);
              });

              const measurementReady = createMemo(() => {
                layoutVersion();
                const key = slotData.key();
                if (!key) return false;
                return measurementCache.has(key);
              });

              const contentStyle = createMemo((): Style => {
                const size = extent();
                const ready = measurementReady();
                if (props.horizontal) {
                  return { minWidth: ready ? size : 0 };
                }
                return { minHeight: ready ? size : 0 };
              });

              const itemStyle = createMemo((): Style => {
                const size = extent();
                const ready = measurementReady();
                const isFlow = isFlowLayout();
                
                if (props.horizontal) {
                  if (isFlow) {
                    return {
                      position: "relative",
                      left: 0,
                      top: 0,
                      minWidth: ready ? size : 0,
                      height: "100%",
                      overflow: "visible",
                    };
                  }
                  return {
                    position: "absolute",
                    left: position(),
                    top: 0,
                    minWidth: ready ? size : 0,
                    height: "100%",
                    overflow: "visible",
                  };
                }
                if (isFlow) {
                  return {
                    position: "relative",
                    top: 0,
                    left: 0,
                    width: "100%",
                    minHeight: ready ? size : 0,
                    overflow: "visible",
                  };
                }
                return {
                  position: "absolute",
                  top: position(),
                  left: 0,
                  width: "100%",
                  minHeight: ready ? size : 0,
                  overflow: "visible",
                };
              });

              const handleLayout = createMemo(() => {
                const token = slotData.layoutToken();
                return (event: LayoutChangeEvent) => {
                  runWithOwner(owner, () => {
                    if (slotData.layoutToken() !== token) return;
                    const idx = slotData.index();
                    if (idx < 0 || idx >= dataKeys.length) return;
                    const key = slotData.key();
                    if (!key) return;
                    const layout = event?.nativeEvent?.layout;
                    if (!layout) return;
                    const size = props.horizontal ? layout.width : layout.height;
                    recordMeasurement(key, idx, size);
                  });
                };
              });

              return (
                <View style={itemStyle}>
                  <View
                    key={slotData.key() ?? slotData.layoutToken()}
                    style={contentStyle}
                    onLayout={handleLayout()}
                  >
                    <For each={renderKeyList()}>
                      {() => {
                        const itemElement = props.renderItem({
                          item: itemProxy,
                          index: indexValue,
                          itemSignal: slotData.item,
                          indexSignal: slotData.index,
                        });
                        const SeparatorComponent = props.ItemSeparatorComponent;
                        const SeparatorWrapper = () => {
                          if (!SeparatorComponent) return null;
                          const index = slotData.index();
                          if (index === -1 || index >= props.data.length - 1) {
                            return null;
                          }
                          const leading = slotData.item();
                          if (leading == null) return null;
                          const trailing = props.data[index + 1];
                          if (trailing === undefined) return null;
                          return (
                            <SeparatorComponent
                              leadingItem={leading}
                              trailingItem={trailing}
                              leadingIndex={index}
                              trailingIndex={index + 1}
                            />
                          );
                        };
                        return (
                          <>
                            {itemElement}
                            <SeparatorWrapper />
                          </>
                        );
                      }}
                    </For>
                  </View>
                </View>
              );
            }}
          </Index>
        </View>
      ) : (
        renderDecorator(props.ListEmptyComponent)
      )}
      {renderFooter()}
    </ScrollView>
  );
}
