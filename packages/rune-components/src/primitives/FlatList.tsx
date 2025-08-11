import {
  JSX,
  createEffect,
  createSignal,
  createMemo,
  Index,
  untrack,
  onCleanup,
  createRoot,
} from "solid-js";
import {
  View,
  ScrollView,
  createScrollController,
  type LayoutChangeEvent,
} from "@rune/components";
import type { MaintainVisibleContentPosition } from "./ScrollView";
import type { Style } from "@rune/core";
import { getHost } from "@rune/core";
import type { FlatListController } from "./flatlist/controller";

/**
 * FlatList - Fixed pool with Index (referential stability)
 *
 * Key insight: Use Index instead of For - Index doesn't key by data!
 * - Index keys by POSITION in array (stable)
 * - Each position always renders, just changes what it shows
 * - No create/destroy, only content updates
 *
 * This is simpler than imperative approach while achieving same goal.
 */

export type ItemSeparatorProps<T> = {
  leadingItem: T;
  trailingItem?: T;
  leadingIndex: number;
  trailingIndex?: number;
};

export type FlatListProps<T> = {
  data: T[];
  renderItem: (info: { item: T; index: number }) => JSX.Element;
  keyExtractor: (item: T, index: number) => string;
  itemSize?: number;
  poolSize?: number;
  windowSize?: number;
  overscan?: number | { multiple?: number; main?: number; cross?: number };
  style?: Style;
  contentContainerStyle?: Style;
  horizontal?: boolean;
  state?: FlatListState;
  controller?: FlatListController;
  estimatedItemSize?: number;
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  ItemSeparatorComponent?: (info: ItemSeparatorProps<T>) => JSX.Element;
  ListHeaderComponent?: JSX.Element | (() => JSX.Element);
  ListFooterComponent?: JSX.Element | (() => JSX.Element);
  ListEmptyComponent?: JSX.Element | (() => JSX.Element);
  testID?: string;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
};

type Binding = {
  poolIndex: number;
  dataIndex: number; // -1 = not bound
};

export type FlatListState = {
  offset: () => number;
  viewport: () => number;
  firstVisibleIndex: () => number | null;
  visibleIndices: () => number[];
};

type InternalFlatListState = FlatListState & {
  __update(payload: {
    offset: number;
    viewport: number;
    firstVisibleIndex: number | null;
    visibleIndices: number[];
  }): void;
};

export function createFlatListState(): FlatListState {
  const [offset, setOffset] = createSignal(0);
  const [viewport, setViewport] = createSignal(0);
  const [firstVisibleIndex, setFirstVisibleIndex] = createSignal<number | null>(
    null
  );

  const [visibleIndices, setVisibleIndices] = createSignal<number[]>([]);

  const state: InternalFlatListState = {
    offset,
    viewport,
    firstVisibleIndex,
    visibleIndices,
    __update(payload) {
      setOffset((prev) => (prev === payload.offset ? prev : payload.offset));
      setViewport((prev) =>
        prev === payload.viewport ? prev : payload.viewport
      );
      setFirstVisibleIndex((prev) =>
        prev === payload.firstVisibleIndex ? prev : payload.firstVisibleIndex
      );
      setVisibleIndices((prev) => {
        const next = payload.visibleIndices;
        if (prev.length === next.length) {
          let same = true;
          for (let i = 0; i < prev.length; i++) {
            if (prev[i] !== next[i]) {
              same = false;
              break;
            }
          }
          if (same) {
            return prev;
          }
        }
        return next;
      });
    },
  };

  return state;
}

const DEFAULT_MIN_POOL_ITEMS = 15;
const DEFAULT_OVERSCAN_MULTIPLE = 2;
const DEFAULT_ESTIMATED_ITEM_SIZE = 64;

export function FlatList<T>(props: FlatListProps<T>) {
  // console.log(
  //   `[FlatList] 🚀 Initializing: ${
  //     props.data.length
  //   } items, estimatedItemSize=${props.estimatedItemSize ?? "auto"}, itemSize=${
  //     props.itemSize ?? "auto"
  //   }`
  // );

  const scrollController = createScrollController();
  let nativeScrollRef: any = null;
  const [scrollHost, setScrollHost] = createSignal<any>(null);

  const internalScrollController = scrollController as any;
  if (typeof internalScrollController.__setHost === "function") {
    const originalSetHost = internalScrollController.__setHost.bind(
      internalScrollController
    );
    internalScrollController.__setHost = (node: any) => {
      if (nativeScrollRef?.id !== node?.id) {
        nativeScrollRef = node ?? null;
        setScrollHost(node ?? null);
        // console.log(
        //   `[FlatList] ScrollView ref set: nodeId=${node?.id}, type=${node?.type}`
        // );
      }
      originalSetHost(node);
    };
  }

  const host = getHost();
  let recyclingContextId: string | null = null;

  // Wire up FlatList controller if provided
  createEffect(() => {
    const controller = props.controller as any;
    if (!controller) return;

    // Attach scroll controller
    if (typeof controller.__setScrollController === "function") {
      controller.__setScrollController(scrollController);
    }

    onCleanup(() => {
      if (typeof controller.__setScrollController === "function") {
        controller.__setScrollController(null);
      }
    });
  });

  // Update controller metadata when props change
  createEffect(() => {
    const controller = props.controller as any;
    if (!controller || typeof controller.__setMetadata !== "function") return;

    controller.__setMetadata({
      itemSize: estimatedItemExtent(),
      horizontal: props.horizontal ?? false,
      dataLength: props.data.length,
    });
  });

  // Scroll metrics
  const scrollMetrics = createMemo(() => scrollController.metrics());
  const scrollOffset = createMemo(() => {
    const metrics = scrollMetrics();
    return props.horizontal ? metrics.offset.x : metrics.offset.y;
  });
  const fallbackViewport = createMemo(() => {
    const style = props.style as Style | undefined;
    if (!style) return 800;
    const sizeValue = props.horizontal ? style.width : style.height;
    if (typeof sizeValue === "number") {
      return sizeValue;
    }
    return 800;
  });

  const viewportSize = createMemo(() => {
    const metrics = scrollMetrics();
    const size = props.horizontal
      ? metrics.viewportSize.width
      : metrics.viewportSize.height;
    // return 760;
    return size && size > 0 ? size : fallbackViewport();
  });

  createEffect(() => {
    // console.log("Viewport size:", viewportSize());
  });

  const maintainConfig = createMemo(() => props.maintainVisibleContentPosition);
  const estimatedItemExtent = createMemo(() => {
    const explicitEstimate = props.estimatedItemSize;
    if (typeof explicitEstimate === "number" && explicitEstimate > 0) {
      return explicitEstimate;
    }
    const fixed = props.itemSize;
    if (typeof fixed === "number" && fixed > 0) {
      return fixed;
    }
    return DEFAULT_ESTIMATED_ITEM_SIZE;
  });

  const fixedItemExtent = createMemo(() => {
    const fixed = props.itemSize;
    return typeof fixed === "number" && fixed > 0 ? fixed : null;
  });

  const overscanMainDistance = createMemo(() => {
    const config = props.overscan;
    if (typeof config === "number") {
      return Math.max(0, config);
    }
    if (config && typeof config.main === "number") {
      return Math.max(0, config.main);
    }
    const multiple =
      config && typeof config.multiple === "number"
        ? config.multiple
        : DEFAULT_OVERSCAN_MULTIPLE;
    return Math.max(0, estimatedItemExtent() * multiple);
  });

  const overscanItemsPerSide = createMemo(() => {
    const distance = overscanMainDistance();
    const extent = estimatedItemExtent();
    if (!extent) return 0;
    return Math.max(0, Math.ceil(distance / extent));
  });

  const viewportItemCount = createMemo(() => {
    const itemSize = estimatedItemExtent();
    if (!itemSize) return 0;
    const viewport = viewportSize();
    return Math.max(1, Math.ceil(viewport / itemSize));
  });

  // Pool size - use generous default to avoid undersizing
  const poolSize = createMemo(() => {
    if (props.poolSize) return props.poolSize;
    const dataLength = props.data.length;
    if (dataLength === 0) return 0;

    const visibleCount = viewportItemCount();
    const overscanCount = overscanItemsPerSide();
    let calculated = visibleCount + overscanCount * 2;

    if (props.windowSize !== undefined) {
      const windowMultiple = Math.max(0, props.windowSize);
      if (windowMultiple === 0) {
        calculated = Math.max(calculated, visibleCount);
      } else {
        const windowItems = Math.max(
          visibleCount,
          Math.ceil(windowMultiple * visibleCount)
        );
        calculated = Math.max(calculated, windowItems);
      }
    } else {
      calculated = Math.max(calculated, DEFAULT_MIN_POOL_ITEMS);
    }

    const final = Math.min(calculated, dataLength);
    // console.log(
    //   `[FlatList] 📐 Pool size calc: viewport=${viewport}, estimate=${estimatedItemExtent()}, visibleCount=${visibleCount}, calculated=${calculated}, final=${final}`
    // );
    return final;
  });

  let lastDebugViewport = -1;
  createEffect(() => {
    const viewport = viewportSize();
    const estimate = estimatedItemExtent();
    const pool = poolSize();
    if (!Number.isFinite(viewport) || viewport <= 0) {
      return;
    }
    const roundedViewport = Math.round(viewport);
    if (roundedViewport === lastDebugViewport) {
      return;
    }
    lastDebugViewport = roundedViewport;
    // console.log(
    //   `[FlatList][debug] viewport=${viewport.toFixed(2)} dp, estimate=${
    //     estimate?.toFixed?.(2) ?? estimate
    //   } dp, poolSize=${pool}, visibleCount=${viewportItemCount()}, overscanPerSide=${overscanItemsPerSide()}`
    // );
  });

  type LayoutSnapshot = {
    offsets: number[];
    sizes: number[];
    total: number;
  };

  type MeasurementEntry = {
    size: number;
    stable: boolean;
    lastUpdate: number;
    finalizeTimer: ReturnType<typeof setTimeout> | null;
  };

  const MEASUREMENT_EPSILON = 0.5;
  const COLLAPSED_MEASUREMENT_RATIO = 0.65;
  const PENDING_MEASUREMENT_DELAY_MS = 48;

  const measurementEntries = new Map<string, MeasurementEntry>();
  const measurementCache = new Map<string, number>();
  const [measurementVersion, setMeasurementVersion] = createSignal(0);
  const [initialMeasurementsPending, setInitialMeasurementsPending] =
    createSignal(true);
  const [initialBottomScrollApplied, setInitialBottomScrollApplied] =
    createSignal(false);
  const [initialRevealComplete, setInitialRevealComplete] = createSignal(false);
  let lastOrientationHorizontal = props.horizontal ?? false;

  const now = () => Date.now();

  const cancelPendingTimer = (entry?: MeasurementEntry | null) => {
    if (!entry?.finalizeTimer) return;
    clearTimeout(entry.finalizeTimer);
    entry.finalizeTimer = null;
  };

  const finalizeMeasurement = (key: string, size: number, reason: string) => {
    const existing = measurementEntries.get(key) ?? {
      size,
      stable: false,
      lastUpdate: now(),
      finalizeTimer: null,
    };
    cancelPendingTimer(existing);
    const previous = measurementCache.get(key);
    existing.size = size;
    existing.stable = true;
    existing.lastUpdate = now();
    existing.finalizeTimer = null;
    measurementEntries.set(key, existing);

    if (
      previous !== undefined &&
      Math.abs(previous - size) < MEASUREMENT_EPSILON
    ) {
      return;
    }

    // console.log(
    //   `[FlatList] 📏 recordMeasurement: key="${key}", size=${size}px (prev=${
    //     previous ?? "none"
    //   }, reason=${reason})`
    // );

    measurementCache.set(key, size);
    setMeasurementVersion((prev) => prev + 1);
  };

  const stagePendingMeasurement = (
    key: string,
    entry: MeasurementEntry,
    reason: string
  ) => {
    cancelPendingTimer(entry);
    const capturedSize = entry.size;
    entry.stable = false;
    entry.lastUpdate = now();
    entry.finalizeTimer = setTimeout(() => {
      const current = measurementEntries.get(key);
      if (!current || current.stable) return;
      if (Math.abs(current.size - capturedSize) > MEASUREMENT_EPSILON) return;
      finalizeMeasurement(key, capturedSize, "timeout");
    }, PENDING_MEASUREMENT_DELAY_MS);
    measurementEntries.set(key, entry);

    // console.log(
    //   `[FlatList] ⏳ pending measurement: key="${key}", size=${capturedSize}px (${reason})`
    // );
  };

  const resetMeasurements = (reason: string, force?: boolean) => {
    let changed = force === true;
    measurementEntries.forEach((entry) => {
      if (entry.finalizeTimer) {
        clearTimeout(entry.finalizeTimer);
        entry.finalizeTimer = null;
      }
    });
    if (measurementEntries.size > 0) {
      measurementEntries.clear();
      changed = true;
    }
    if (measurementCache.size > 0) {
      measurementCache.clear();
      changed = true;
    }
    if (changed) {
      // console.log(`[FlatList] ♻️ reset measurements (${reason})`);
      setMeasurementVersion((prev) => prev + 1);
    }
    if (initialBottomScrollApplied()) {
      setInitialBottomScrollApplied(false);
    }
    if (initialRevealComplete()) {
      setInitialRevealComplete(false);
    }
    if (props.data.length > 0) {
      setInitialMeasurementsPending(true);
    } else {
      setInitialMeasurementsPending(false);
    }
  };

  createEffect(() => {
    const isHorizontal = props.horizontal ?? false;
    if (isHorizontal !== lastOrientationHorizontal) {
      resetMeasurements("orientation change", true);
      lastOrientationHorizontal = isHorizontal;
    }
  });

  const recordMeasurement = (key: string, size: number) => {
    if (!key) return;
    if (!Number.isFinite(size) || size <= 0) return;
    if (fixedItemExtent()) return;

    const stableValue = measurementCache.get(key);
    if (
      stableValue !== undefined &&
      Math.abs(stableValue - size) < MEASUREMENT_EPSILON
    ) {
      return;
    }

    const estimate = estimatedItemExtent();
    const collapseThreshold = Math.max(
      1,
      estimate * COLLAPSED_MEASUREMENT_RATIO
    );

    const existing = measurementEntries.get(key);
    if (existing) {
      cancelPendingTimer(existing);
    }

    const entry: MeasurementEntry = existing
      ? { ...existing, size, lastUpdate: now(), finalizeTimer: null }
      : { size, stable: false, lastUpdate: now(), finalizeTimer: null };

    if (size >= collapseThreshold) {
      finalizeMeasurement(key, size, "threshold");
      return;
    }

    if (existing && !existing.stable) {
      if (Math.abs(existing.size - size) < MEASUREMENT_EPSILON) {
        finalizeMeasurement(key, size, "pending-confirmed");
        return;
      }
    }

    stagePendingMeasurement(
      key,
      entry,
      `size=${size}px<threshold=${collapseThreshold.toFixed(
        1
      )}px (estimate=${estimate}px)`
    );
  };

  onCleanup(() => {
    measurementEntries.forEach((entry) => {
      if (entry.finalizeTimer) {
        clearTimeout(entry.finalizeTimer);
      }
    });
    measurementEntries.clear();
    measurementCache.clear();
  });

  const layoutMetrics = createMemo<LayoutSnapshot>(() => {
    measurementVersion();
    const data = props.data;
    const estimate = estimatedItemExtent();
    const fixed = fixedItemExtent();
    const offsets = new Array<number>(data.length);
    const sizes = new Array<number>(data.length);
    let total = 0;
    let measuredCount = 0;
    let estimatedCount = 0;

    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      const key = props.keyExtractor(item, i);
      let size = measurementCache.get(key);
      const hadMeasurement = measurementCache.has(key);

      if (fixed != null) {
        size = fixed;
      }
      if (!Number.isFinite(size as number) || (size as number) <= 0) {
        size = estimate;
      }
      const resolvedSize =
        typeof size === "number" && size > 0 ? size : estimate;
      offsets[i] = total;
      sizes[i] = resolvedSize;
      total += resolvedSize;

      if (hadMeasurement && resolvedSize !== estimate) {
        measuredCount++;
      } else {
        estimatedCount++;
      }
    }

    // console.log(
    //   `[FlatList] 📐 layoutMetrics: total=${total}px, items=${data.length}, measured=${measuredCount}, estimated=${estimatedCount}, estimatedSize=${estimate}px`
    // );

    return { offsets, sizes, total };
  });

  const initialViewportMeasured = createMemo(() => {
    if (fixedItemExtent()) {
      return true;
    }

    measurementVersion();
    const data = props.data;
    const count = Math.min(data.length, viewportItemCount());
    if (count === 0) {
      return true;
    }

    const maintain = maintainConfig();
    const requireBottom = !!(
      maintain &&
      !maintain.disabled &&
      maintain.startRenderingFromBottom
    );
    const startIndex = requireBottom ? Math.max(0, data.length - count) : 0;
    const endIndexExclusive = requireBottom ? data.length : startIndex + count;

    for (let i = startIndex; i < endIndexExclusive; i++) {
      const item = data[i];
      if (item === undefined) {
        return false;
      }
      const key = props.keyExtractor(item, i);
      const entry = measurementEntries.get(key);
      if (
        !entry ||
        !entry.stable ||
        !Number.isFinite(entry.size) ||
        entry.size <= 0
      ) {
        return false;
      }
    }

    return true;
  });

  createEffect(() => {
    const fixed = fixedItemExtent();
    if (fixed != null) {
      if (initialMeasurementsPending()) {
        setInitialMeasurementsPending(false);
      }
      if (!initialRevealComplete()) {
        setInitialRevealComplete(true);
      }
      return;
    }

    const dataLength = props.data.length;
    if (dataLength === 0) {
      if (initialMeasurementsPending()) {
        setInitialMeasurementsPending(false);
      }
      return;
    }

    if (initialRevealComplete()) {
      if (initialMeasurementsPending()) {
        setInitialMeasurementsPending(false);
      }
      return;
    }

    const measured = initialViewportMeasured();
    const config = maintainConfig();
    const requireBottom = !!(
      config &&
      !config.disabled &&
      config.startRenderingFromBottom
    );

    if (!measured || (requireBottom && !initialBottomScrollApplied())) {
      if (!initialMeasurementsPending()) {
        setInitialMeasurementsPending(true);
      }
      return;
    }

    if (initialMeasurementsPending()) {
      const count = Math.min(dataLength, viewportItemCount());
      // console.log(
      //   `[FlatList] ✅ Initial measurements complete! Revealing ${count} items`
      // );
      setInitialMeasurementsPending(false);
    }
    if (!initialRevealComplete()) {
      setInitialRevealComplete(true);
    }
  });

  const initialMeasurementsReady = createMemo(
    () => !initialMeasurementsPending()
  );

  const getOffsetForIndex = (snapshot: LayoutSnapshot, index: number) => {
    if (index <= 0) return 0;
    if (index >= snapshot.offsets.length) return snapshot.total;
    return snapshot.offsets[index];
  };

  const getSizeForIndex = (snapshot: LayoutSnapshot, index: number) => {
    if (index < 0 || index >= snapshot.sizes.length) {
      return estimatedItemExtent();
    }
    return snapshot.sizes[index] ?? estimatedItemExtent();
  };

  const getEndForIndex = (snapshot: LayoutSnapshot, index: number) => {
    const start = getOffsetForIndex(snapshot, index);
    return start + getSizeForIndex(snapshot, index);
  };

  const findFirstIntersectingIndex = (
    snapshot: LayoutSnapshot,
    targetOffset: number
  ) => {
    const length = snapshot.sizes.length;
    if (length === 0) return -1;
    let low = 0;
    let high = length - 1;
    let result = length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const end = snapshot.offsets[mid] + snapshot.sizes[mid];
      if (end > targetOffset) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return Math.max(0, Math.min(result, length - 1));
  };

  const findLastIntersectingIndex = (
    snapshot: LayoutSnapshot,
    targetOffset: number
  ) => {
    const length = snapshot.sizes.length;
    if (length === 0) return -1;
    let low = 0;
    let high = length - 1;
    let result = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = snapshot.offsets[mid];
      if (start < targetOffset) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, Math.min(result, length - 1));
  };

  const locateIndexForOffset = (
    snapshot: LayoutSnapshot,
    targetOffset: number
  ) => {
    const length = snapshot.sizes.length;
    if (length === 0) return -1;
    let low = 0;
    let high = length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = snapshot.offsets[mid];
      const end = start + snapshot.sizes[mid];
      if (targetOffset < start) {
        high = mid - 1;
      } else if (targetOffset >= end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }
    return Math.max(0, Math.min(low, length - 1));
  };

  let anchorKey: string | null = null;
  let anchorIndex = -1;
  let anchorOffsetWithinItem = 0;
  let previousKeys: string[] = [];
  let previousDataLength = 0;
  const [softCorrection, setSoftCorrection] = createSignal<{
    targetOffset: number;
    clampDistance: number;
  } | null>(null);

  const scheduleMicrotask = (fn: () => void) => {
    Promise.resolve().then(fn);
  };

  const scheduleScrollBy = (delta: number) => {
    if (!delta || Math.abs(delta) < 0.5) return;
    if (!scrollHost()) return;
    scheduleMicrotask(() => {
      if (!scrollHost()) return;
      if (props.horizontal) {
        scrollController.scrollBy({ dx: delta, animated: false });
      } else {
        scrollController.scrollBy({ dy: delta, animated: false });
      }
    });
  };

  const scheduleScrollTo = (offset: number, animated: boolean) => {
    if (!scrollHost()) return;
    scheduleMicrotask(() => {
      if (!scrollHost()) return;
      const clamped = Math.max(0, offset);
      if (props.horizontal) {
        scrollController.scrollTo({ x: clamped, animated });
      } else {
        scrollController.scrollTo({ y: clamped, animated });
      }
    });
  };

  const queueSoftCorrection = (targetOffset: number, clampDistance: number) => {
    setSoftCorrection({
      targetOffset,
      clampDistance,
    });
  };

  // Bindings array - FIXED size, never changes length!
  const [bindings, setBindings] = createSignal<Binding[]>([]);

  // Boundary detection - imperative state outside reactive system
  let boundaryTracker = {
    startFired: false,
    endFired: false,
    startRearmThreshold: 0,
    endRearmThreshold: 0,
  };

  // Initialize bindings once
  createEffect(() => {
    const size = poolSize();
    if (bindings().length > 0) return; // Already initialized

    const initialBindings: Binding[] = [];
    for (let i = 0; i < size; i++) {
      initialBindings.push({ poolIndex: i, dataIndex: -1 });
    }

    setBindings(initialBindings);
    // console.log(`[FlatList] 🎯 Initialized pool of ${size} slots`);
  });

  // Enable host-level recycling once scroll view host is ready
  createEffect(() => {
    if (
      !host?.enableRecycling ||
      !host?.disableRecycling ||
      !host?.acquireNode ||
      !host?.reclaimNode
    ) {
      // console.log(
      //   `[FlatList] Recycling not supported by host (enableRecycling=${!!host?.enableRecycling})`
      // );
      return;
    }

    const scrollNode = scrollHost();
    if (!scrollNode || typeof scrollNode.id !== "number") {
      // console.log("[FlatList] Waiting for ScrollView host node...");
      return;
    }

    if (recyclingContextId) {
      return;
    }

    const pool = poolSize();
    recyclingContextId = host.enableRecycling(scrollNode.id, {
      poolSize: pool,
      itemType: "view",
    });

    // console.log(
    //   `[FlatList] 🔄 Enabled host recycling (context=${recyclingContextId}, poolSize=${pool})`
    // );

    onCleanup(() => {
      if (recyclingContextId) {
        // console.log(
        //   `[FlatList] 🛑 Disabling recycling context ${recyclingContextId}`
        // );
        host.disableRecycling?.(recyclingContextId);
        recyclingContextId = null;
      }
    });
  });

  createEffect(() => {
    const config = maintainConfig();
    if (!config || config.disabled) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }

    const offset = scrollOffset();
    const data = untrack(() => props.data);
    const length = data.length;

    if (length === 0) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }

    const snapshot = layoutMetrics();
    if (snapshot.sizes.length === 0) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }

    const index = locateIndexForOffset(snapshot, offset);
    if (index < 0 || index >= length) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }

    const item = data[index];

    if (item === undefined) {
      anchorKey = null;
      anchorIndex = -1;
      anchorOffsetWithinItem = 0;
      return;
    }

    anchorKey = props.keyExtractor(item, index);
    anchorIndex = index;
    const start = snapshot.offsets[index] ?? 0;
    const size = snapshot.sizes[index] ?? estimatedItemExtent();
    const remainder = offset - start;
    anchorOffsetWithinItem = Math.max(0, Math.min(remainder, size));
  });

  createEffect(() => {
    const config = maintainConfig();
    if (!config || config.disabled || !config.startRenderingFromBottom) {
      if (!config?.startRenderingFromBottom) {
        setInitialBottomScrollApplied(false);
      }
      return;
    }

    if (initialBottomScrollApplied()) return;
    if (!initialViewportMeasured()) return;
    const hostNode = scrollHost();
    if (!hostNode) return;
    const dataLength = props.data.length;
    if (dataLength === 0) return;
    const viewport = untrack(viewportSize);
    const snapshot = layoutMetrics();
    const totalExtent = snapshot.total;
    scheduleScrollTo(Math.max(0, totalExtent - viewport), false);
    setInitialBottomScrollApplied(true);
  });

  createEffect(() => {
    const config = maintainConfig();
    const data = props.data;
    const dataLength = data.length;

    if (!config || config.disabled) {
      previousKeys = data.map((item, idx) => props.keyExtractor(item, idx));
      previousDataLength = dataLength;
      setSoftCorrection(null);
      return;
    }

    if (dataLength === 0) {
      previousKeys = [];
      previousDataLength = 0;
      if (config.startRenderingFromBottom) {
        setInitialBottomScrollApplied(false);
      }
      setSoftCorrection(null);
      resetMeasurements("maintainVisibleContentPosition reset");
      return;
    }

    const keys = data.map((item, idx) => props.keyExtractor(item, idx));
    const prevKeys = previousKeys;
    const prevLength = previousDataLength;

    let prefixMatch = 0;
    let suffixMatch = 0;
    let appendedCount = 0;
    let prependedCount = 0;

    if (prevLength > 0) {
      while (
        prefixMatch < prevLength &&
        prefixMatch < keys.length &&
        prevKeys[prefixMatch] === keys[prefixMatch]
      ) {
        prefixMatch += 1;
      }

      while (
        suffixMatch < prevLength &&
        suffixMatch < keys.length &&
        prevKeys[prevLength - 1 - suffixMatch] ===
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

    if (
      config.startRenderingFromBottom &&
      prevLength > 0 &&
      keys.length > 0 &&
      prefixMatch === 0 &&
      suffixMatch === 0
    ) {
      setInitialBottomScrollApplied(false);
    }

    const snapshot = layoutMetrics();
    const estimatedExtent = estimatedItemExtent();
    const minIndex = config.minIndexForVisible ?? 0;
    const allowMaintain = anchorIndex !== -1 && anchorIndex <= minIndex;
    const currentOffset = untrack(scrollOffset);
    let autoScrolledTop = false;

    if (prependedCount > 0) {
      const thresholdTop = config.autoscrollToTopThreshold;
      if (typeof thresholdTop === "number") {
        const viewport = untrack(viewportSize);
        const thresholdPx =
          thresholdTop > 1 ? thresholdTop : thresholdTop * viewport;
        if (currentOffset <= thresholdPx) {
          scheduleScrollTo(0, config.animateAutoScroll ?? false);
          autoScrolledTop = true;
        }
      }

      if (!autoScrolledTop && allowMaintain) {
        const currentKey = anchorKey;
        const previousAnchorIndex = anchorIndex;
        if (
          currentKey != null &&
          previousAnchorIndex >= 0 &&
          previousAnchorIndex < keys.length
        ) {
          const nextIndex = keys.indexOf(currentKey);
          if (nextIndex !== -1 && nextIndex !== previousAnchorIndex) {
            const startOffset = getOffsetForIndex(snapshot, nextIndex);
            const size = getSizeForIndex(snapshot, nextIndex);
            const clampedRemainder = Math.max(
              0,
              Math.min(anchorOffsetWithinItem, size)
            );
            const targetOffset = startOffset + clampedRemainder;
            const delta = targetOffset - currentOffset;
            if (Math.abs(delta) > 0.5) {
              scheduleScrollBy(delta);
            }
            const clampDistance = Math.max(size, estimatedExtent);
            queueSoftCorrection(targetOffset, clampDistance);
          }
        }
      }
    }

    if (appendedCount > 0 && prevLength > 0) {
      const viewport = untrack(viewportSize);
      const totalExtent = snapshot.total;
      const distanceToBottom = Math.max(
        0,
        totalExtent - viewport - currentOffset
      );
      const thresholdBottom = config.autoscrollToBottomThreshold;
      let thresholdPx = 0;
      if (typeof thresholdBottom === "number") {
        thresholdPx =
          thresholdBottom > 1 ? thresholdBottom : thresholdBottom * viewport;
      } else if (config.startRenderingFromBottom) {
        thresholdPx = 0;
      }
      if (distanceToBottom <= thresholdPx) {
        const targetOffset = Math.max(0, totalExtent - viewport);
        scheduleScrollTo(targetOffset, config.animateAutoScroll ?? false);
      }
    }

    previousKeys = keys;
    previousDataLength = dataLength;
  });

  createEffect(() => {
    const correction = softCorrection();
    if (!correction) return;

    const currentOffset = scrollOffset();
    if (!Number.isFinite(currentOffset)) {
      return;
    }

    const diff = correction.targetOffset - currentOffset;
    if (!Number.isFinite(diff) || Math.abs(diff) < 0.5) {
      setSoftCorrection(null);
      return;
    }

    const maxDelta =
      correction.clampDistance > 0 ? correction.clampDistance : Math.abs(diff);
    const adjustment = Math.max(-maxDelta, Math.min(maxDelta, diff));

    if (Math.abs(adjustment) < 0.5) {
      setSoftCorrection(null);
      return;
    }

    if (!scrollHost()) return;
    if (props.horizontal) {
      scrollController.scrollBy({ dx: adjustment, animated: false });
    } else {
      scrollController.scrollBy({ dy: adjustment, animated: false });
    }
  });

  // Visible range - with optional recompute trigger
  const visibleRange = createMemo(
    (prev: { start: number; end: number } | undefined) => {
      const offset = scrollOffset();
      const viewport = viewportSize();
      const dataLength = props.data.length;

      // Track recompute signal if controller provided
      const controller = props.controller as any;
      if (controller && typeof controller.__triggerRecompute === "function") {
        controller.__triggerRecompute();
      }

      if (dataLength === 0) {
        return { start: 0, end: 0 };
      }

      const overscan = overscanMainDistance();
      const snapshot = layoutMetrics();
      if (snapshot.sizes.length === 0) {
        return { start: 0, end: 0 };
      }
      const startOffset = Math.max(0, offset - overscan);
      const endOffset = Math.min(snapshot.total, offset + viewport + overscan);

      const startIndex = findFirstIntersectingIndex(snapshot, startOffset);
      const endIndex = findLastIntersectingIndex(snapshot, endOffset);

      const start = Math.max(0, Math.min(startIndex, dataLength - 1));
      const end = Math.max(start, Math.min(endIndex, dataLength - 1));

      if (prev && start === prev.start && end === prev.end) {
        return prev;
      }

      return { start, end };
    }
  );

  // Update bindings when range changes
  createEffect(() => {
    const range = visibleRange();
    const data = props.data;
    const currentBindings = untrack(bindings);

    if (currentBindings.length === 0) return;

    // console.log(
    //   `[FlatList] 📍 Range: ${range.start}-${range.end}, pool size: ${currentBindings.length}`
    // );

    // Determine needed indices
    const neededIndices = new Set<number>();
    for (let i = range.start; i <= range.end; i++) {
      neededIndices.add(i);
    }

    // Backfill indices so every slot stays populated even before native metrics settle.
    const targetBindings = Math.min(currentBindings.length, data.length);
    if (targetBindings > 0 && neededIndices.size < targetBindings) {
      let expandStart = range.start;
      let expandEnd = range.end;
      while (
        neededIndices.size < targetBindings &&
        (expandStart > 0 || expandEnd < data.length - 1)
      ) {
        let expanded = false;
        if (expandEnd < data.length - 1) {
          expandEnd += 1;
          neededIndices.add(expandEnd);
          expanded = true;
          if (neededIndices.size >= targetBindings) {
            break;
          }
        }
        if (expandStart > 0) {
          expandStart -= 1;
          neededIndices.add(expandStart);
          expanded = true;
          if (neededIndices.size >= targetBindings) {
            break;
          }
        }
        if (!expanded) {
          break;
        }
      }
    }

    // Clone bindings for update
    const newBindings = currentBindings.map((b) => ({ ...b }));

    // Step 1: Unbind slots no longer needed
    let unboundCount = 0;
    for (const binding of newBindings) {
      if (
        binding.dataIndex !== -1 &&
        (!neededIndices.has(binding.dataIndex) ||
          binding.dataIndex >= data.length)
      ) {
        // console.log(
        //   `[FlatList] 🔓 Unbinding slot ${binding.poolIndex} from index ${binding.dataIndex}`
        // );
        binding.dataIndex = -1;
        unboundCount++;
      }
    }

    // Step 2: Collect still-bound indices
    const boundIndices = new Set<number>();
    for (const binding of newBindings) {
      if (binding.dataIndex !== -1) {
        boundIndices.add(binding.dataIndex);
      }
    }

    // console.log(
    //   `[FlatList] Currently bound: ${boundIndices.size}, freed: ${unboundCount}, need: ${neededIndices.size}`
    // );

    if (props.data.length === 0) {
      if (unboundCount > 0) {
        setBindings(newBindings);
      }
      return;
    }

    // Step 3: Bind available slots to needed indices
    const sortedNeeded = Array.from(neededIndices).sort((a, b) => a - b);
    for (const dataIndex of sortedNeeded) {
      if (boundIndices.has(dataIndex)) continue; // Already bound

      // Find available slot
      const availableSlot = newBindings.find((b) => b.dataIndex === -1);
      if (!availableSlot) {
        console.warn(
          `[FlatList] ⚠️ Pool exhausted! Need index ${dataIndex} but no slots available`
        );
        const boundList = Array.from(boundIndices).join(", ");
        // console.warn(`[FlatList] Currently bound indices: [${boundList}]`);
        continue;
      }

      if (dataIndex >= data.length) {
        // console.warn(
        //   `[FlatList] ⚠️ Attempted to bind index ${dataIndex} beyond data length ${data.length}`
        // );
        continue;
      }

      const nextItem = data[dataIndex];
      const dataKey =
        nextItem !== undefined
          ? props.keyExtractor(nextItem, dataIndex)
          : "<unknown>";

      availableSlot.dataIndex = dataIndex;
      boundIndices.add(dataIndex);
      // console.log(
      //   `[FlatList] 🔗 Bound slot ${availableSlot.poolIndex} to index ${dataIndex} (key=${dataKey})`
      // );
    }

    setBindings(newBindings);
  });

  // Expose read-only state to observers when provided
  createEffect(() => {
    const state = props.state as InternalFlatListState | undefined;
    if (!state) return;

    const offset = scrollOffset();
    const viewport = viewportSize();
    const range = visibleRange();
    const dataLength = props.data.length;

    let indices: number[] = [];
    if (dataLength > 0 && range.end >= range.start) {
      const start = Math.max(0, Math.min(range.start, dataLength - 1));
      const end = Math.max(start, Math.min(range.end, dataLength - 1));
      const count = end - start + 1;
      if (count > 0) {
        indices = Array.from({ length: count }, (_, i) => start + i);
      }
    }

    const firstVisibleIndex = indices.length > 0 ? indices[0] : null;

    state.__update({
      offset,
      viewport,
      firstVisibleIndex,
      visibleIndices: indices,
    });
  });

  // Boundary detection - separate effect, only reactive on scrollOffset
  createEffect(() => {
    if (!props.onStartReached && !props.onEndReached) return;

    // Only reactive dependency: scrollOffset
    const offset = scrollOffset();

    // Read everything else untracked to prevent reactive interference
    const viewport = untrack(viewportSize);
    const dataLength = untrack(() => props.data.length);
    if (!viewport || !dataLength) return;
    const snapshot = untrack(layoutMetrics);
    const contentLength = snapshot.total;
    if (contentLength <= 0) return;
    const startDistance = offset;
    const endDistance = Math.max(0, contentLength - offset - viewport);

    // Start boundary
    if (props.onStartReached) {
      const threshold = (props.onStartReachedThreshold ?? 0.1) * viewport;
      const rearmThreshold = threshold * 1.5;

      if (!boundaryTracker.startFired && startDistance <= threshold) {
        boundaryTracker.startFired = true;
        boundaryTracker.startRearmThreshold = rearmThreshold;
        setTimeout(() => props.onStartReached?.(), 0);
      } else if (
        boundaryTracker.startFired &&
        startDistance > boundaryTracker.startRearmThreshold
      ) {
        boundaryTracker.startFired = false;
      }
    }

    // End boundary
    if (props.onEndReached) {
      const threshold = (props.onEndReachedThreshold ?? 0.1) * viewport;
      const rearmThreshold = threshold * 1.5;

      if (!boundaryTracker.endFired && endDistance <= threshold) {
        boundaryTracker.endFired = true;
        boundaryTracker.endRearmThreshold = rearmThreshold;
        setTimeout(() => props.onEndReached?.(), 0);
      } else if (
        boundaryTracker.endFired &&
        endDistance > boundaryTracker.endRearmThreshold
      ) {
        boundaryTracker.endFired = false;
      }
    }
  });

  const contentSize = createMemo(() => {
    const size = layoutMetrics().total;
    const viewport = viewportSize();
    // console.log(
    //   `[FlatList] 📦 contentSize: ${size}px, viewport: ${viewport}px, scrollable: ${
    //     size > viewport
    //   }`
    // );
    return size;
  });
  const requiredContentStyle = createMemo<Style>(() => ({
    position: "relative",
    [props.horizontal ? "width" : "height"]: contentSize(),
    [props.horizontal ? "height" : "width"]: "100%",
    opacity: initialMeasurementsReady() ? 1 : 0,
  }));
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

  // Decorator helpers - render as components or elements
  const renderDecorator = (
    decorator: JSX.Element | (() => JSX.Element) | undefined
  ) => {
    if (!decorator) return null;
    return typeof decorator === "function" ? decorator() : decorator;
  };

  return (
    <ScrollView
      horizontal={props.horizontal}
      style={props.style}
      contentContainerStyle={sanitizedContentContainerStyle()}
      maintainVisibleContentPosition={props.maintainVisibleContentPosition}
      controller={scrollController}
      testID={props.testID}
    >
      {renderDecorator(props.ListHeaderComponent)}
      {hasData() ? (
        <View style={requiredContentStyle()}>
          {/* Use Index - keys by position, not data! */}
          <Index each={bindings()}>
            {(binding) => {
              const poolIndex = untrack(() => binding().poolIndex);
              const [currentItem, setCurrentItem] = createSignal<T | null>(
                null
              );
              const [currentIndex, setCurrentIndex] = createSignal(-1);

              // Proxy exposes latest item values while keeping Solid's fine-grained tracking intact.
              const itemProxy = new Proxy(
                {},
                {
                  get(_, prop) {
                    const item = currentItem();
                    if (item == null) return undefined;
                    const value = Reflect.get(item as any, prop, item);
                    return typeof value === "function"
                      ? value.bind(item)
                      : value;
                  },
                  has(_, prop) {
                    const item = currentItem();
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
                    const item = currentItem();
                    return item ? Reflect.ownKeys(item) : [];
                  },
                  getOwnPropertyDescriptor(_, prop) {
                    const item = currentItem();
                    if (!item) return undefined;
                    const descriptor = Object.getOwnPropertyDescriptor(
                      item,
                      prop
                    );
                    if (!descriptor) return undefined;
                    return { ...descriptor, configurable: true };
                  },
                }
              ) as T;

              const indexValue = {
                valueOf: () => currentIndex(),
                toString: () => String(currentIndex()),
                [Symbol.toPrimitive](hint: string) {
                  const value = currentIndex();
                  return hint === "string" ? String(value) : value;
                },
              } as unknown as number;

              let slotContent: JSX.Element | null = null;
              let disposeSlot: (() => void) | null = null;

              const ensureSlotContent = () => {
                if (slotContent) return slotContent;
                const SeparatorComponent = props.ItemSeparatorComponent;
                slotContent = createRoot((dispose) => {
                  disposeSlot = dispose;
                  const itemElement = props.renderItem({
                    item: itemProxy,
                    index: indexValue,
                  });
                  // Create a reactive component for the separator
                  const SeparatorWrapper = () => {
                    if (!SeparatorComponent) return null;
                    const index = currentIndex();
                    if (index === -1 || index >= props.data.length - 1) {
                      return null;
                    }
                    const leading = currentItem();
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
                });
                return slotContent;
              };

              onCleanup(() => {
                disposeSlot?.();
                slotContent = null;
                disposeSlot = null;
              });

              createEffect(() => {
                const idx = binding().dataIndex;
                if (idx >= 0 && idx < props.data.length) {
                  setCurrentIndex(idx);
                  setCurrentItem(() => props.data[idx]);
                  ensureSlotContent();
                }
              });

              const currentKey = createMemo(() => {
                const idx = currentIndex();
                if (idx === -1 || idx >= props.data.length) {
                  return null;
                }
                const item = props.data[idx];
                if (item === undefined) return null;
                return props.keyExtractor(item, idx);
              });

              const position = createMemo((prev) => {
                const idx = binding().dataIndex;
                if (idx === -1 || idx >= props.data.length) {
                  return -9999;
                }
                const snapshot = layoutMetrics();
                if (idx >= snapshot.offsets.length) {
                  return idx * estimatedItemExtent();
                }
                const pos = snapshot.offsets[idx];

                // Log position changes for debugging layout shifts
                if (
                  prev !== undefined &&
                  typeof prev === "number" &&
                  prev !== pos &&
                  idx >= 0
                ) {
                  const item = props.data[idx];
                  const key = item ? props.keyExtractor(item, idx) : "unknown";
                  // console.log(
                  //   `[FlatList] 📍 Position shift: idx=${idx}, key="${key}", ${prev}px → ${pos}px (Δ${
                  //     pos - prev
                  //   }px)`
                  // );
                }

                return pos;
              });

              const extent = createMemo(() => {
                const idx = binding().dataIndex;
                if (idx === -1 || idx >= props.data.length) {
                  return estimatedItemExtent();
                }
                const snapshot = layoutMetrics();
                if (idx >= snapshot.sizes.length) {
                  return estimatedItemExtent();
                }
                const size = snapshot.sizes[idx];
                return typeof size === "number" && size > 0
                  ? size
                  : estimatedItemExtent();
              });

              // Baseline height - always use estimatedItemSize to ensure items don't overlap
              // before measurements complete. This prevents the first-frame layout shift.
              const baselineExtent = createMemo((prev) => {
                const estimated = estimatedItemExtent();
                const measured = extent();
                // Use estimated size until we have a measurement
                const idx = binding().dataIndex;
                if (idx === -1 || idx >= props.data.length) {
                  return estimated;
                }
                const item = props.data[idx];
                if (item === undefined) return estimated;
                const key = props.keyExtractor(item, idx);
                const hasMeasurement = measurementCache.has(key);
                // Only use measured size after we have it
                const result = hasMeasurement ? measured : estimated;

                // Log when baseline changes (measurement arrives)
                if (
                  prev !== undefined &&
                  typeof prev === "number" &&
                  prev !== result &&
                  idx >= 0
                ) {
                  // console.log(
                  //   `[FlatList] 📏 Baseline extent: idx=${idx}, key="${key}", ${prev}px → ${result}px, hasMeasurement=${hasMeasurement}`
                  // );
                }

                return result;
              });

              const measurementReady = createMemo(() => {
                measurementVersion();
                const fixed = fixedItemExtent();
                if (typeof fixed === "number" && fixed > 0) {
                  return true;
                }
                const idx = binding().dataIndex;
                if (idx === -1 || idx >= props.data.length) {
                  return false;
                }
                const item = props.data[idx];
                if (item === undefined) return false;
                const key = props.keyExtractor(item, idx);
                const entry = measurementEntries.get(key);
                return entry ? entry.stable : false;
              });

              const handleLayout = (event: LayoutChangeEvent) => {
                // Stop listening to layout changes once we have a stable measurement
                // This prevents the "measurement loop" where setting a height triggers
                // a slightly different native measurement, causing infinite re-renders.
                if (measurementReady()) return;

                const key = currentKey();
                if (!key) return;
                const layout = event?.nativeEvent?.layout;
                if (!layout) return;
                const size = props.horizontal ? layout.width : layout.height;
                recordMeasurement(key, size);
              };

              const itemStyle = createMemo((): Style => {
                const ready = measurementReady();
                const baseline = baselineExtent();
                if (props.horizontal) {
                  return {
                    position: "absolute",
                    left: position(),
                    top: 0,
                    width: extent(),
                    minWidth: baseline,
                    opacity: ready ? 1 : 0,
                  };
                } else {
                  // Use measured extent which will be estimated size until measured
                  // We lock 'height' when ready to ensure stability, but we rely on
                  // the handleLayout guard to prevent feedback loops.
                  return {
                    position: "absolute",
                    top: position(),
                    left: 0,
                    width: "100%",
                    height: ready ? baseline : undefined,
                    minHeight: ready ? undefined : baseline,
                    opacity: ready ? 1 : 0,
                  };
                }
              });

              return (
                <View
                  key={`pool-slot-${poolIndex}`}
                  style={itemStyle()}
                  onLayout={handleLayout}
                >
                  {currentItem() ? ensureSlotContent() : null}
                </View>
              );
            }}
          </Index>
        </View>
      ) : (
        renderDecorator(props.ListEmptyComponent)
      )}
      {renderDecorator(props.ListFooterComponent)}
    </ScrollView>
  );
}
