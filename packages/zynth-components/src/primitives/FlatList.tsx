import {
  JSX,
  createMemo,
  createSignal,
  Index,
  Show,
  splitProps,
  createEffect,
  batch,
  untrack,
  Accessor,
  Setter,
} from "solid-js";
import { ScrollView, ScrollEvent, createScrollController } from "./ScrollView";
import { View, LayoutChangeEvent } from "./View";
import type { Style, StyleProp } from "@zynth/core";

export type FlatListRenderItemInfo<T> = {
  item: T;
  index: number;
};

export type Overscan = number | { multiple?: number; main?: number };

export type FlatListProps<T> = {
  data: T[];
  renderItem: (info: FlatListRenderItemInfo<T>) => JSX.Element;
  keyExtractor?: (item: T, index: number) => string;
  itemSize?: number;
  estimatedItemSize?: number;
  overscan?: Overscan;
  horizontal?: boolean;
  style?: StyleProp;
  contentContainerStyle?: StyleProp;
  onScroll?: (event: ScrollEvent) => void;
  controller?: any;
  testID?: string;
  debug?: boolean;
};

type PoolSlot = {
  dataIndex: Accessor<number>;
  setDataIndex: Setter<number>;
};

class LayoutManager {
  private tree: Float32Array;
  private sizes: Float32Array;
  private n: number;
  private defaultSize: number;

  constructor(n: number, defaultSize: number) {
    this.n = n;
    this.defaultSize = defaultSize;
    this.tree = new Float32Array(n + 1);
    this.sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.sizes[i] = defaultSize;
      this.updateTree(i + 1, defaultSize);
    }
  }

  private updateTree(idx: number, delta: number) {
    while (idx <= this.n) {
      this.tree[idx] += delta;
      idx += idx & -idx;
    }
  }

  updateSize(index: number, newSize: number): boolean {
    if (index < 0 || index >= this.n) return false;

    // Ignore updates that are too small or zero.
    // This protects the layout tree from collapsing when a view is momentarily 0-sized
    if (newSize < 0.5) return false;

    const delta = newSize - this.sizes[index];
    if (Math.abs(delta) < 0.5) return false;
    this.sizes[index] = newSize;
    this.updateTree(index + 1, delta);
    return true;
  }

  getOffset(index: number): number {
    if (index <= 0) return 0;
    if (index > this.n) index = this.n;

    let idx = index;
    let sum = 0;
    while (idx > 0) {
      sum += this.tree[idx];
      idx -= idx & -idx;
    }
    return sum;
  }

  getSize(index: number): number {
    if (index < 0 || index >= this.n) return this.defaultSize;
    return this.sizes[index] ?? this.defaultSize;
  }

  getTotal(): number {
    return this.getOffset(this.n);
  }

  findIndexAtOffset(target: number): number {
    if (this.n <= 0 || target <= 0) return 0;

    // Binary search for the index
    let left = 0;
    let right = this.n - 1;
    let result = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const offset = this.getOffset(mid);

      if (offset <= target) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    // If the offset at result is exactly target, return result
    // Otherwise, if result's offset is less than target, we need the next item
    const resultOffset = this.getOffset(result);
    if (resultOffset < target && result < this.n - 1) {
      result++;
    }

    return Math.min(result, this.n - 1);
  }
}

export function FlatList<T>(props: FlatListProps<T>) {
  const [local] = splitProps(props, [
    "data",
    "renderItem",
    "keyExtractor",
    "itemSize",
    "estimatedItemSize",
    "overscan",
    "horizontal",
    "style",
    "contentContainerStyle",
    "onScroll",
    "controller",
    "testID",
    "debug",
  ]);

  const log = (msg: string, ...args: any[]) => {
    if (local.debug) {
      console.log(`[FlatList] ${msg}`, ...args);
    }
  };

  const scrollController = createScrollController();
  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [viewportSize, setViewportSize] = createSignal(0);
  const [layoutVersion, setLayoutVersion] = createSignal(0);

  const isHorizontal = createMemo(() => local.horizontal ?? false);
  const defaultItemSize = createMemo(
    () => local.estimatedItemSize ?? local.itemSize ?? 50,
  );

  let layoutManager = new LayoutManager(local.data.length, defaultItemSize());

  createEffect(() => {
    const dataLen = local.data.length;
    const dSize = defaultItemSize();
    layoutManager = new LayoutManager(dataLen, dSize);
    setLayoutVersion((v) => v + 1);

    // Reset bindings on data change
    bindings.clear();
    slotAssignments = [];
    const s = untrack(slots);
    s.forEach((slot) => slot.setDataIndex(-1));

    untrack(() => ensurePoolSize());
  });

  const overscanCount = createMemo(() =>
    typeof local.overscan === "number" ? local.overscan : 5,
  );

  const visibleRange = createMemo(() => {
    layoutVersion();
    const offset = scrollOffset();
    const viewport = viewportSize() || 800;
    const dataLen = local.data.length;
    if (dataLen === 0) return { start: 0, end: -1, count: 0 };

    const startIdx = layoutManager.findIndexAtOffset(offset);
    const endOffset = offset + viewport;
    const endIdx = layoutManager.findIndexAtOffset(endOffset);
    const overscan = overscanCount();

    const start = Math.max(0, startIdx - overscan);
    const end = Math.min(dataLen - 1, endIdx + overscan);
    return { start, end, count: end - start + 1 };
  });

  // --- Recycling System ---
  const [slots, setSlots] = createSignal<PoolSlot[]>([]);
  let bindings = new Map<number, number>(); // dataIndex -> slotIndex
  let slotAssignments: number[] = []; // slotIndex -> dataIndex

  const createPoolSlot = (): PoolSlot => {
    const [dataIndex, setDataIndex] = createSignal(-1);
    return { dataIndex, setDataIndex };
  };

  const ensurePoolSize = () => {
    const range = visibleRange();
    const needed = range.count + 20; // Add more buffer for safety

    const currentPoolSize = untrack(slots).length;

    if (local.debug) {
      log(
        `Visible range: [${range.start}, ${range.end}] (count: ${range.count}) | Pool: ${currentPoolSize} | Needed: ${needed}`,
      );
    }

    if (needed > currentPoolSize) {
      const toAdd = Math.max(needed - currentPoolSize, 10); // Add at least 10 slots
      const newSlots: PoolSlot[] = [];
      const newAssignments: number[] = [];
      for (let i = 0; i < toAdd; i++) {
        newSlots.push(createPoolSlot());
        newAssignments.push(-1);
      }
      setSlots((s) => [...s, ...newSlots]);
      slotAssignments = [...slotAssignments, ...newAssignments];
      if (local.debug)
        log(`Grew pool by ${toAdd}. New size: ${currentPoolSize + toAdd}`);
    }

    updatePoolBindings(range);
  };

  createEffect(() => {
    ensurePoolSize();
  });

  const updatePoolBindings = (range: { start: number; end: number }) => {
    const currentSlots = untrack(slots);
    const poolSize = currentSlots.length;
    if (poolSize === 0 || local.data.length === 0) return;

    const { start, end } = range;
    const needed = new Set<number>();
    for (let i = start; i <= end; i++) needed.add(i);

    batch(() => {
      // 1. Release slots no longer needed
      for (let i = 0; i < poolSize; i++) {
        const dataIdx = slotAssignments[i];
        if (dataIdx !== -1 && !needed.has(dataIdx)) {
          bindings.delete(dataIdx);
          slotAssignments[i] = -1;
          currentSlots[i].setDataIndex(-1);
        }
      }

      // 2. Assign slots to new visible indices
      for (let dataIdx = start; dataIdx <= end; dataIdx++) {
        if (!bindings.has(dataIdx)) {
          // Find a free slot
          let freeSlot = -1;
          for (let i = 0; i < poolSize; i++) {
            if (slotAssignments[i] === -1) {
              freeSlot = i;
              break;
            }
          }

          if (freeSlot !== -1) {
            slotAssignments[freeSlot] = dataIdx;
            bindings.set(dataIdx, freeSlot);
            currentSlots[freeSlot].setDataIndex(dataIdx);
          } else {
            // If no free slots, we need to grow the pool
            if (local.debug)
              log(
                `WARN: No free slot for data index ${dataIdx}! Pool size: ${poolSize}`,
              );
            // Force pool growth on next cycle
            setTimeout(() => ensurePoolSize(), 0);
          }
        }
      }
    });
  };

  const handleScroll = (event: ScrollEvent) => {
    const offset = isHorizontal()
      ? event.contentOffset.x
      : event.contentOffset.y;
    const viewport = isHorizontal()
      ? event.layoutMeasurement.width
      : event.layoutMeasurement.height;

    // Only update if the change is significant
    const currentOffset = untrack(scrollOffset);
    const currentViewport = untrack(viewportSize);

    if (
      Math.abs(offset - currentOffset) < 1 &&
      Math.abs(viewport - (currentViewport || 0)) < 1
    ) {
      return;
    }

    batch(() => {
      setScrollOffset(offset);
      if (viewport > 0) setViewportSize(viewport);
    });

    local.onScroll?.(event);
  };

  const totalSize = createMemo(() => {
    layoutVersion();
    return layoutManager.getTotal();
  });

  const contentSize = createMemo(() => {
    const total = totalSize();
    return isHorizontal()
      ? { width: total, height: 0 }
      : { width: 0, height: total };
  });

  createEffect(() => {
    const controller = local.controller;
    if (controller) {
      if (typeof controller.__setScrollController === "function") {
        controller.__setScrollController(scrollController);
      }
      if (typeof controller.__setMetadata === "function") {
        controller.__setMetadata({
          itemSize: defaultItemSize(),
          horizontal: isHorizontal(),
          dataLength: local.data.length,
        });
      }
    }
  });

  return (
    <ScrollView
      horizontal={isHorizontal()}
      style={local.style}
      contentContainerStyle={local.contentContainerStyle}
      onScroll={handleScroll}
      onLayout={(e) => {
        const size = isHorizontal()
          ? e.nativeEvent.layout.width
          : e.nativeEvent.layout.height;
        if (size > 0) setViewportSize(size);
      }}
      controller={scrollController}
      testID={local.testID}
      contentSize={contentSize()}
    >
      <View
        style={createMemo(
          (): Style => ({
            position: "relative",
            [isHorizontal() ? "width" : "height"]: totalSize(),
            [isHorizontal() ? "height" : "width"]: "100%",
          }),
        )()}
      >
        <Index each={slots()}>
          {(slot) => {
            const dataIndex = slot().dataIndex;

            const handleItemLayout = (e: LayoutChangeEvent) => {
              const idx = untrack(dataIndex);
              if (idx === -1) return;
              const size = isHorizontal()
                ? e.nativeEvent.layout.width
                : e.nativeEvent.layout.height;

              if (local.debug) {
                const prev = layoutManager.getSize(idx);
                if (Math.abs(size - prev) > 0.5) {
                  console.log(
                    `[FlatList] Item ${idx} layout update: ${prev.toFixed(1)} -> ${size.toFixed(1)}`,
                  );
                }
              }

              // CRITICAL: Only update if size is valid.
              if (size > 0.1 && layoutManager.updateSize(idx, size)) {
                batch(() => setLayoutVersion((v) => v + 1));
              }
            };

            const itemStyle = createMemo((): Style => {
              layoutVersion();
              const idx = dataIndex();

              if (idx === -1) return { display: "none" };

              const pos = layoutManager.getOffset(idx);
              const size = layoutManager.getSize(idx);

              return isHorizontal()
                ? {
                    position: "absolute",
                    left: pos,
                    top: 0,
                    bottom: 0,
                    width: size,
                    overflow: "visible",
                  }
                : {
                    position: "absolute",
                    top: pos,
                    left: 0,
                    right: 0,
                    height: size,
                    overflow: "visible",
                  };
            });

            return (
              <View style={itemStyle()}>
                <View
                  onLayout={handleItemLayout}
                  style={
                    isHorizontal()
                      ? { height: "100%", alignSelf: "flex-start" }
                      : { width: "100%" }
                  }
                >
                  {createMemo(() => {
                    const idx = dataIndex();
                    if (idx === -1) return null;
                    return local.renderItem({
                      item: local.data[idx],
                      index: idx,
                    });
                  })()}
                </View>
              </View>
            );
          }}
        </Index>
      </View>
    </ScrollView>
  );
}
