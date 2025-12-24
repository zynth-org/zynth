import {
  JSX,
  Index,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type { Style } from "@rune/core";
import { ScrollView, createScrollController } from "./ScrollView";
import type { ScrollEvent, MaintainVisibleContentPosition } from "./ScrollView";
import { View, type LayoutChangeEvent } from "./View";

export type ItemSeparatorProps<T> = {
  leadingItem: T;
  trailingItem?: T;
  leadingIndex: number;
  trailingIndex?: number;
};

export type RecyclerListProps<T> = {
  data: T[];
  renderItem: (info: { item: T; index: number }) => JSX.Element;
  keyExtractor: (item: T, index: number) => string;
  estimatedItemSize?: number;
  poolSize?: number;
  overscan?: number | { multiple?: number; main?: number };
  horizontal?: boolean;
  style?: Style;
  contentContainerStyle?: Style;
  maintainVisibleContentPosition?: MaintainVisibleContentPosition;
  ItemSeparatorComponent?: (info: ItemSeparatorProps<T>) => JSX.Element;
  ListHeaderComponent?: JSX.Element | (() => JSX.Element);
  ListFooterComponent?: JSX.Element | (() => JSX.Element);
  ListEmptyComponent?: JSX.Element | (() => JSX.Element);
  testID?: string;
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  onScroll?: (event: ScrollEvent) => void;
};

type PoolSlot<T> = {
  slotIndex: number;
  index: Accessor<number>;
  setIndex: Setter<number>;
  item: Accessor<T | null>;
  setItem: Setter<T | null>;
  key: Accessor<string | null>;
  setKey: Setter<string | null>;
};

const DEFAULT_ESTIMATED_ITEM_SIZE = 64;
const DEFAULT_MIN_POOL_ITEMS = 15;
const DEFAULT_OVERSCAN_MULTIPLE = 2;
const MEASUREMENT_EPSILON = 0.5;
const OFFSET_EPSILON = 0.01;

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
  return {
    slotIndex,
    index,
    setIndex,
    item,
    setItem,
    key,
    setKey,
  };
};

export function RecyclerList<T>(props: RecyclerListProps<T>) {
  const scrollController = createScrollController();

  const [viewportSize, setViewportSize] = createSignal(0);
  let lastOffset = 0;
  let lastViewport = 0;

  const estimatedItemSize = createMemo(() => {
    const estimate = props.estimatedItemSize;
    if (typeof estimate === "number" && estimate > 0) {
      return estimate;
    }
    return DEFAULT_ESTIMATED_ITEM_SIZE;
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
      return Math.max(0, config);
    }
    if (config && typeof config.main === "number") {
      return Math.max(0, config.main);
    }
    const multiple =
      config && typeof config.multiple === "number"
        ? config.multiple
        : DEFAULT_OVERSCAN_MULTIPLE;
    return Math.max(0, estimatedItemSize() * multiple);
  });

  const desiredPoolSize = createMemo(() => {
    if (typeof props.poolSize === "number") {
      return Math.max(0, props.poolSize);
    }
    const dataLength = props.data.length;
    if (dataLength === 0) return 0;
    const estimate = estimatedItemSize();
    const viewport = effectiveViewport();
    const visibleCount = Math.max(1, Math.ceil(viewport / estimate));
    const overscanCount = Math.max(
      0,
      Math.ceil(overscanMainDistance() / estimate)
    );
    const calculated = Math.max(
      DEFAULT_MIN_POOL_ITEMS,
      visibleCount + overscanCount * 2
    );
    return Math.min(calculated, dataLength);
  });

  const [poolSlots, setPoolSlots] = createSignal<PoolSlot<T>[]>([]);
  let poolSlotsRef: PoolSlot<T>[] = [];
  const slotBindings: number[] = [];

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
    return true;
  };

  createEffect(() => {
    const didGrow = ensurePoolSize(desiredPoolSize());
    if (didGrow) {
      updateBindingsForOffset(lastOffset, effectiveViewport());
    }
  });

  const measurementCache = new Map<string, number>();
  const sizeTree = new FenwickTree();
  let dataKeys: string[] = [];
  let layoutTotal = 0;
  const [layoutVersion, setLayoutVersion] = createSignal(0);

  const rebuildLayout = (nextKeys: string[]) => {
    const estimate = estimatedItemSize();
    const nextSizes = new Array(nextKeys.length);
    for (let i = 0; i < nextKeys.length; i += 1) {
      const cached = measurementCache.get(nextKeys[i]);
      nextSizes[i] = cached && cached > 0 ? cached : estimate;
    }
    sizeTree.reset(nextSizes);
    layoutTotal = sizeTree.total();
    dataKeys = nextKeys;
    setLayoutVersion((prev) => prev + 1);
    lastRangeStart = -1;
    lastRangeEnd = -1;
  };

  const getOffsetForIndex = (index: number) => sizeTree.prefixSum(index - 1);
  const getSizeForIndex = (index: number) => {
    if (index < 0 || index >= dataKeys.length) {
      return estimatedItemSize();
    }
    const value = sizeTree.value(index);
    return value > 0 ? value : estimatedItemSize();
  };

  let lastRangeStart = -1;
  let lastRangeEnd = -1;

  const bindSlot = (slotIndex: number, dataIndex: number) => {
    const slot = poolSlotsRef[slotIndex];
    if (!slot) return;
    slotBindings[slotIndex] = dataIndex;
    if (dataIndex < 0 || dataIndex >= props.data.length) {
      slot.setIndex(-1);
      slot.setItem(null);
      slot.setKey(null);
      return;
    }
    const item = props.data[dataIndex];
    const key = item ? props.keyExtractor(item, dataIndex) : null;
    slot.setIndex(dataIndex);
    slot.setItem(item ?? null);
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
    const total = sizeTree.total();
    const startOffset = Math.max(0, offset - overscan);
    const endOffset = Math.min(total, offset + viewport + overscan);

    let startIndex = sizeTree.findIndexByOffset(startOffset);
    let endIndex = sizeTree.findIndexByOffset(
      Math.max(0, endOffset - OFFSET_EPSILON)
    );

    if (startIndex < 0) startIndex = 0;
    if (endIndex < 0) endIndex = 0;

    const maxIndex = dataLength - 1;
    startIndex = Math.max(0, Math.min(startIndex, maxIndex));
    endIndex = Math.max(startIndex, Math.min(endIndex, maxIndex));

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
      return;
    }
    lastRangeStart = startIndex;
    lastRangeEnd = endIndex;

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
  };

  const [startFired, setStartFired] = createSignal(false);
  const [endFired, setEndFired] = createSignal(false);
  let startRearmThreshold = 0;
  let endRearmThreshold = 0;

  const handleBoundaryEvents = (offset: number, viewport: number) => {
    if (!props.onStartReached && !props.onEndReached) return;
    const total = sizeTree.total();
    if (total <= 0 || viewport <= 0) return;

    if (props.onStartReached) {
      const threshold = (props.onStartReachedThreshold ?? 0.1) * viewport;
      if (!startFired() && offset <= threshold) {
        setStartFired(true);
        startRearmThreshold = threshold * 1.5;
        setTimeout(() => props.onStartReached?.(), 0);
      } else if (startFired() && offset > startRearmThreshold) {
        setStartFired(false);
      }
    }

    if (props.onEndReached) {
      const distanceToEnd = Math.max(0, total - viewport - offset);
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

  const updateAnchor = (offset: number) => {
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
    const idx = sizeTree.findIndexByOffset(offset);
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

  const scheduleScrollTo = (offset: number, animated: boolean) => {
    const clamped = Math.max(0, offset);
    if (props.horizontal) {
      scrollController.scrollTo({ x: clamped, animated });
    } else {
      scrollController.scrollTo({ y: clamped, animated });
    }
  };

  const scheduleScrollBy = (delta: number) => {
    if (!delta || Math.abs(delta) < 0.5) return;
    if (props.horizontal) {
      scrollController.scrollBy({ dx: delta, animated: false });
    } else {
      scrollController.scrollBy({ dy: delta, animated: false });
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
    const total = sizeTree.total();

    if (config.startRenderingFromBottom && !initialBottomScrollApplied) {
      scheduleScrollTo(Math.max(0, total - viewport), false);
      initialBottomScrollApplied = true;
    }

    if (prependedCount > 0 && anchorKey) {
      const minIndex = config.minIndexForVisible ?? 0;
      if (anchorIndex <= minIndex) {
        const nextIndex = keys.indexOf(anchorKey);
        if (nextIndex !== -1 && nextIndex !== anchorIndex) {
          const nextOffset = getOffsetForIndex(nextIndex) + anchorOffsetWithinItem;
          const delta = nextOffset - lastOffset;
          scheduleScrollBy(delta);
        }
      }
    }

    if (appendedCount > 0) {
      const distanceToBottom = Math.max(0, total - viewport - lastOffset);
      const threshold = config.autoscrollToBottomThreshold;
      if (typeof threshold === "number") {
        const thresholdPx =
          threshold > 1 ? threshold : threshold * viewport;
        if (distanceToBottom <= thresholdPx) {
          scheduleScrollTo(Math.max(0, total - viewport), config.animateAutoScroll ?? false);
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
    const prev = measurementCache.get(key);
    if (prev !== undefined && Math.abs(prev - size) < MEASUREMENT_EPSILON) {
      return;
    }
    measurementCache.set(key, size);
    sizeTree.update(index, size);
    layoutTotal = sizeTree.total();
    setLayoutVersion((prevVersion) => prevVersion + 1);
    updateBindingsForOffset(lastOffset, lastViewport);
  };

  createEffect(() => {
    const keys = props.data.map((item, index) => props.keyExtractor(item, index));
    rebuildLayout(keys);
    refreshBindings();
    updateBindingsForOffset(lastOffset, effectiveViewport());
    handleDataChange(keys);
  });

  const handleScroll = (event: ScrollEvent) => {
    const offset = props.horizontal
      ? event.contentOffset?.x ?? 0
      : event.contentOffset?.y ?? 0;
    const viewport = props.horizontal
      ? event.layoutMeasurement?.width ?? 0
      : event.layoutMeasurement?.height ?? 0;

    lastOffset = offset;
    lastViewport = viewport > 0 ? viewport : lastViewport;
    if (viewport > 0) {
      setViewportSize(viewport);
    }
    updateBindingsForOffset(offset, viewport > 0 ? viewport : effectiveViewport());
    handleBoundaryEvents(offset, viewport > 0 ? viewport : effectiveViewport());
    updateAnchor(offset);
    props.onScroll?.(event);
  };

  createEffect(() => {
    const viewport = effectiveViewport();
    if (viewport <= 0) return;
    lastViewport = viewport;
    updateBindingsForOffset(lastOffset, viewport);
  });

  onCleanup(() => {
    poolSlotsRef = [];
  });

  const contentSize = createMemo(() => {
    layoutVersion();
    return layoutTotal;
  });

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

  const renderDecorator = (
    decorator: JSX.Element | (() => JSX.Element) | undefined
  ) => {
    if (!decorator) return null;
    return typeof decorator === "function" ? decorator() : decorator;
  };

  return (
    <ScrollView
      horizontal={props.horizontal}
      style={mergedScrollViewStyle()}
      contentContainerStyle={sanitizedContentContainerStyle()}
      controller={scrollController}
      testID={props.testID}
      onScroll={handleScroll}
    >
      {renderDecorator(props.ListHeaderComponent)}
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
                      prop
                    );
                    if (!descriptor) return undefined;
                    return { ...descriptor, configurable: true };
                  },
                }
              ) as T;

              const indexValue = {
                valueOf: () => slotData.index(),
                toString: () => String(slotData.index()),
                [Symbol.toPrimitive](hint: string) {
                  const value = slotData.index();
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
                });
                return slotContent;
              };

              onCleanup(() => {
                disposeSlot?.();
                slotContent = null;
                disposeSlot = null;
              });

              const position = createMemo(() => {
                layoutVersion();
                const idx = slotData.index();
                if (idx < 0) return -9999;
                return getOffsetForIndex(idx);
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

              const itemStyle = createMemo((): Style => {
                const size = extent();
                const ready = measurementReady();
                if (props.horizontal) {
                  return {
                    position: "absolute",
                    left: position(),
                    top: 0,
                    width: size,
                    height: "100%",
                    overflow: ready ? "visible" : "hidden",
                  };
                }
                return {
                  position: "absolute",
                  top: position(),
                  left: 0,
                  width: "100%",
                  height: size,
                  overflow: ready ? "visible" : "hidden",
                };
              });

              const handleLayout = (event: LayoutChangeEvent) => {
                const idx = slotData.index();
                if (idx < 0 || idx >= dataKeys.length) return;
                const key = slotData.key();
                if (!key) return;
                const layout = event?.nativeEvent?.layout;
                if (!layout) return;
                const size = props.horizontal ? layout.width : layout.height;
                recordMeasurement(key, idx, size);
              };

              return (
                <View style={itemStyle()}>
                  <View onLayout={handleLayout}>
                    {slotData.item() ? ensureSlotContent() : null}
                  </View>
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
