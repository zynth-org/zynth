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
import { View, ScrollView, createScrollController } from "@rune/components";
import type { Style } from "@rune/core";
import { getHost } from "@rune/core";

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
  itemSize: number;
  poolSize?: number;
  windowSize?: number;
  overscan?: number | { multiple?: number; main?: number; cross?: number };
  style?: Style;
  contentContainerStyle?: Style;
  horizontal?: boolean;
  state?: FlatListState;
  ItemSeparatorComponent?: (info: ItemSeparatorProps<T>) => JSX.Element;
  ListHeaderComponent?: JSX.Element | (() => JSX.Element);
  ListFooterComponent?: JSX.Element | (() => JSX.Element);
  ListEmptyComponent?: JSX.Element | (() => JSX.Element);
  testID?: string;
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

export function FlatList<T>(props: FlatListProps<T>) {
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
    return size && size > 0 ? size : fallbackViewport();
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
    return Math.max(0, props.itemSize * multiple);
  });

  const overscanItemsPerSide = createMemo(() => {
    const distance = overscanMainDistance();
    if (!props.itemSize) return 0;
    return Math.max(0, Math.ceil(distance / props.itemSize));
  });

  const viewportItemCount = createMemo(() => {
    const itemSize = props.itemSize;
    if (!itemSize) return 0;
    const viewport = viewportSize();
    return Math.max(1, Math.ceil(viewport / itemSize));
  });

  // Pool size - use generous default to avoid undersizing
  const poolSize = createMemo(() => {
    if (props.poolSize) return props.poolSize;
    const dataLength = props.data.length;
    if (dataLength === 0 || !props.itemSize) return 0;

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
    //   `[FlatList] 📐 Pool size calc: viewport=${viewport}, itemSize=${props.itemSize}, visibleCount=${visibleCount}, calculated=${calculated}, final=${final}`
    // );
    return final;
  });

  // Bindings array - FIXED size, never changes length!
  const [bindings, setBindings] = createSignal<Binding[]>([]);

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
      //   `[FlatList] Recycling not supported by host (enableRecycling=${
      //     !!host?.enableRecycling
      //   })`
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

  // Visible range
  const visibleRange = createMemo(
    (prev: { start: number; end: number } | undefined) => {
      const offset = scrollOffset();
      const viewport = viewportSize();
      const itemSize = props.itemSize;
      const dataLength = props.data.length;

      // console.log(
      //   `[FlatList] 📏 Scroll offset: ${offset}, viewport: ${viewport}, itemSize: ${itemSize}`
      // );

      if (!itemSize || !dataLength) {
        return { start: 0, end: 0 };
      }

      const overscan = overscanMainDistance();
      const startOffset = Math.max(0, offset - overscan);
      const endOffset = offset + viewport + overscan;

      const startIndex = Math.floor(startOffset / itemSize);
      const endIndex = Math.ceil(endOffset / itemSize);

      const start = Math.max(0, startIndex);
      const end = Math.min(dataLength - 1, endIndex);

      // console.log(
      //   `[FlatList] 🧮 Calculated: startOffset=${startOffset}, endOffset=${endOffset}, startIndex=${startIndex}, endIndex=${endIndex}`
      // );

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
    for (const dataIndex of neededIndices) {
      if (boundIndices.has(dataIndex)) continue; // Already bound

      // Find available slot
      const availableSlot = newBindings.find((b) => b.dataIndex === -1);
      if (!availableSlot) {
        console.warn(
          `[FlatList] ⚠️ Pool exhausted! Need index ${dataIndex} but no slots available`
        );
        const boundList = Array.from(boundIndices).join(", ");
        console.warn(`[FlatList] Currently bound indices: [${boundList}]`);
        continue;
      }

      if (dataIndex >= data.length) {
        console.warn(
          `[FlatList] ⚠️ Attempted to bind index ${dataIndex} beyond data length ${data.length}`
        );
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

  const contentSize = createMemo(() => props.data.length * props.itemSize);
  const requiredContentStyle = createMemo<Style>(() => ({
    position: "relative",
    [props.horizontal ? "width" : "height"]: contentSize(),
    [props.horizontal ? "height" : "width"]: "100%",
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

              const position = createMemo(() => {
                const idx = binding().dataIndex;
                if (idx === -1 || idx >= props.data.length) {
                  return -9999;
                }
                return idx * props.itemSize;
              });

              const slotKey = `pool-slot-${poolIndex}`;

              return (
                <View
                  key={`pool-slot-${poolIndex}`}
                  style={{
                    position: "absolute",
                    [props.horizontal ? "left" : "top"]: position(),
                    [props.horizontal ? "top" : "left"]: 0,
                    width: props.horizontal ? props.itemSize : "100%",
                    height: props.horizontal ? "100%" : props.itemSize,
                  }}
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
