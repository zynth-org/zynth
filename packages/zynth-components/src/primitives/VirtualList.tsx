import {
  createMemo,
  createSignal,
  For,
  JSX,
  splitProps,
  untrack,
  createEffect,
} from "solid-js";

import { ScrollView, ScrollEvent } from "./ScrollView";
import { View, LayoutChangeEvent } from "./View";
import { StyleProp } from "@zynth/core";

export type VirtualListRenderItemInfo<T> = {
  item: T;
  index: number;
};

export type ItemLayout = { length: number; offset: number; index: number };
export type GetItemLayout<T> = (
  data: T[] | null | undefined,
  index: number,
) => ItemLayout;
type VisibleRange = { start: number; end: number };

export interface VirtualListProps<T> {
  data: T[];
  renderItem: (info: VirtualListRenderItemInfo<T>) => JSX.Element;
  keyExtractor?: (item: T, index: number) => string | number;
  numColumns?: number;
  estimatedItemSize?: number;
  getItemLayout?: GetItemLayout<T>;
  overscan?: number;
  style?: StyleProp;
  contentContainerStyle?: StyleProp;
  columnWrapperStyle?: StyleProp;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  ListHeaderComponent?: JSX.Element;
  ListFooterComponent?: JSX.Element;
  ListEmptyComponent?: JSX.Element;
  horizontal?: boolean;
  onScroll?: (event: ScrollEvent) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  removeClippedSubviews?: boolean;
  initialNumToRender?: number;
  testID?: string;
}

/**
 * A highly performant VirtualList component for SolidJS in Zynth.
 * Designed to be homogeneous during topographic changes (like numColumns)
 * and atomic/granular during aggressive scrolling.
 */
export function VirtualList<T>(props: VirtualListProps<T>) {
  const [local, rest] = splitProps(props, [
    "data",
    "renderItem",
    "keyExtractor",
    "numColumns",
    "estimatedItemSize",
    "getItemLayout",
    "overscan",
    "style",
    "contentContainerStyle",
    "columnWrapperStyle",
    "onEndReached",
    "onEndReachedThreshold",
    "ListHeaderComponent",
    "ListFooterComponent",
    "ListEmptyComponent",
    "horizontal",
    "onScroll",
    "onLayout",
    "removeClippedSubviews",
    "initialNumToRender",
    "testID",
  ]);

  const [scrollOffset, setScrollOffset] = createSignal(0);
  const [viewportSize, setViewportSize] = createSignal(
    { width: 0, height: 0 },
    { equals: (a, b) => a.width === b.width && a.height === b.height },
  );
  const [headerLength, setHeaderLength] = createSignal(0);
  const [footerLength, setFooterLength] = createSignal(0);
  const hasHeader = createMemo(
    () => local.ListHeaderComponent !== undefined && local.ListHeaderComponent !== null,
  );
  const [headerMeasured, setHeaderMeasured] = createSignal(!hasHeader());

  const numColumns = createMemo(() => Math.max(1, local.numColumns ?? 1));
  const overscanRows = createMemo(() => local.overscan ?? 2);
  const defaultItemLength = createMemo(() => local.estimatedItemSize ?? 50);
  const axisViewportLength = createMemo(() =>
    local.horizontal ? viewportSize().width : viewportSize().height,
  );
  const crossViewportLength = createMemo(() =>
    local.horizontal ? viewportSize().height : viewportSize().width,
  );

  const rowCount = createMemo(() =>
    Math.ceil(local.data.length / numColumns()),
  );

  // Internal data access to avoid excessive reactivity during layout calculations
  let currentData = local.data;
  createEffect(() => {
    currentData = local.data;
  });
  createEffect(() => {
    if (!hasHeader()) {
      setHeaderMeasured(true);
      setHeaderLength(0);
      return;
    }
    setHeaderMeasured(false);
  });

  const getRowLayout = (
    rowIndex: number,
  ): { length: number; offset: number } => {
    const cols = numColumns();
    if (local.getItemLayout) {
      const firstItemIndex = rowIndex * cols;
      const layout = local.getItemLayout(currentData, firstItemIndex);
      return { length: layout.length, offset: layout.offset };
    }
    const length = defaultItemLength();
    return { length, offset: rowIndex * length };
  };

  const totalContentLength = createMemo(() => {
    const count = rowCount();
    let rowsLength = 0;
    if (count > 0) {
      const lastRow = getRowLayout(count - 1);
      rowsLength = lastRow.offset + lastRow.length;
    }
    return rowsLength + headerLength() + footerLength();
  });

  const initialRange: VisibleRange = {
    start: 0,
    end: local.initialNumToRender ?? 10,
  };
  const range = createMemo<VisibleRange>((prev) => {
    const offset = Math.max(0, scrollOffset() - headerLength());
    const viewport = axisViewportLength();
    const count = rowCount();
    const maxOffset = Math.max(
      0,
      totalContentLength() - headerLength() - footerLength() - viewport,
    );
    const clampedOffset = Math.min(offset, maxOffset);

    if (viewport === 0) {
      return { start: 0, end: local.initialNumToRender ?? 10 };
    }

    let startRow = 0;
    let endRow = 0;

    if (local.getItemLayout) {
      // Binary search for efficiency in massive lists
      let low = 0;
      let high = count - 1;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let layout = getRowLayout(mid);
        if (
          layout.offset <= clampedOffset &&
          layout.offset + layout.length > clampedOffset
        ) {
          startRow = mid;
          break;
        } else if (layout.offset > clampedOffset) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      if (low > high) startRow = Math.max(0, high);

      endRow = startRow;
      for (let i = startRow; i < count; i++) {
        let layout = getRowLayout(i);
        if (layout.offset > clampedOffset + viewport) {
          endRow = i;
          break;
        }
        endRow = i + 1;
      }
    } else {
      const length = defaultItemLength();
      startRow = Math.floor(clampedOffset / length);
      endRow = Math.ceil((clampedOffset + viewport) / length);
    }

    const os = overscanRows();
    const nextStart = Math.min(count, Math.max(0, startRow - os));
    const nextEnd = Math.min(count, Math.max(nextStart, endRow + os));

    if (prev && prev.start === nextStart && prev.end === nextEnd) {
      return prev;
    }
    return { start: nextStart, end: nextEnd };
  }, initialRange);

  const visibleRange = createMemo(() => {
    const hasViewport = axisViewportLength() > 0;
    const hasCrossViewport = crossViewportLength() > 0;
    const headerReady = !hasHeader() || headerLength() > 0;
    if (!hasViewport || !hasCrossViewport || !headerMeasured() || !headerReady) {
      return { startItem: 0, endItem: 0 };
    }
    const r = range();
    const cols = numColumns();
    const startItem = r.start * cols;
    const endItem = Math.min(local.data.length, r.end * cols);
    return { startItem, endItem };
  });

  const visibleIndices = createMemo(() => {
    const next = visibleRange();
    const count = Math.max(0, next.endItem - next.startItem);
    return Array.from({ length: count }, (_, i) => next.startItem + i);
  });

  const readAxisOffsetFromEvent = (event: ScrollEvent): number => {
    return local.horizontal ? event.contentOffset.x : event.contentOffset.y;
  };

  let lastEndReachedOffset = 0;
  const handleScroll = (e: ScrollEvent) => {
    const offset = readAxisOffsetFromEvent(e);

    // Keep viewport synchronized with native metrics, which are more reliable
    // than layout events during axis-specific scroll host updates.
    const meas = e.layoutMeasurement;
    if (meas.width > 0 && meas.height > 0) {
      const current = viewportSize();
      // Use a small epsilon to avoid unnecessary updates from floating point artifacts
      if (Math.abs(meas.width - current.width) > 0.1 || Math.abs(meas.height - current.height) > 0.1) {
        setViewportSize({
          width: meas.width,
          height: meas.height,
        });
      }
    }

    setScrollOffset(offset);
    local.onScroll?.(e);

    if (local.onEndReached) {
      const threshold = local.onEndReachedThreshold ?? 0.5;
      const viewport = axisViewportLength();
      const contentSize = local.horizontal
        ? e.contentSize.width
        : e.contentSize.height;
      if (offset + viewport >= contentSize - viewport * threshold) {
        if (offset > lastEndReachedOffset) {
          untrack(() => local.onEndReached?.());
          lastEndReachedOffset = offset;
        }
      } else {
        lastEndReachedOffset = 0;
      }
    }
  };

  const handleLayout = (e: LayoutChangeEvent) => {
    setViewportSize({
      width: e.nativeEvent.layout.width,
      height: e.nativeEvent.layout.height,
    });
    local.onLayout?.(e);
  };

  const handleHeaderLayout = (e: LayoutChangeEvent) => {
    const nextLength = local.horizontal
      ? e.nativeEvent.layout.width
      : e.nativeEvent.layout.height;
    setHeaderLength(nextLength);
    // Only unlock item rendering once header has a concrete measured size.
    if (nextLength > 0 || !hasHeader()) {
      setHeaderMeasured(true);
    }
  };

  const handleFooterLayout = (e: LayoutChangeEvent) => {
    setFooterLength(
      local.horizontal
        ? e.nativeEvent.layout.width
        : e.nativeEvent.layout.height,
    );
  };

  const containerStyle = createMemo(() => {
    const isHoriz = local.horizontal;
    const axisLength = totalContentLength();
    const crossSize = crossViewportLength();
    const base: any = {
      position: "relative",
      [isHoriz ? "width" : "height"]: axisLength,
      [isHoriz ? "minWidth" : "minHeight"]: axisLength,
      [isHoriz ? "height" : "width"]: isHoriz ? (crossSize > 0 ? crossSize : "100%") : "100%",
    };
    return base;
  });
  const scrollViewStyle = createMemo<StyleProp>(() => {
    if (!local.style) return { flex: 1 };
    return Array.isArray(local.style)
      ? [{ flex: 1 }, ...local.style]
      : [{ flex: 1 }, local.style];
  });

  const scrollContentContainerStyle = createMemo<StyleProp>(() => {
    const base = local.horizontal
      ? ({ alignSelf: "flex-start" as const })
      : ({ flexGrow: 1, alignSelf: "stretch" as const });
    if (!local.contentContainerStyle) return base;
    return Array.isArray(local.contentContainerStyle)
      ? [base, ...local.contentContainerStyle]
      : [base, local.contentContainerStyle];
  });

  return (
    <ScrollView
      {...rest}
      horizontal={local.horizontal}
      onScroll={handleScroll}
      onLayout={handleLayout}
      style={scrollViewStyle()}
      contentContainerStyle={scrollContentContainerStyle()}
      testID={local.testID}
    >
      <view style={containerStyle() as any}>
        {local.ListHeaderComponent && (
          <View onLayout={handleHeaderLayout}>{local.ListHeaderComponent}</View>
        )}

        <For each={visibleIndices()}>
          {(absoluteIndex) => {
            const rowIndex = createMemo(() =>
              Math.floor(absoluteIndex / numColumns()),
            );
            const colIndex = createMemo(() => absoluteIndex % numColumns());
            const layout = createMemo(() => getRowLayout(rowIndex()));
            const item = createMemo(() => local.data[absoluteIndex]);
            const key = createMemo(() =>
              local.keyExtractor
                ? local.keyExtractor(item(), absoluteIndex)
                : absoluteIndex,
            );

            const style = createMemo(() => {
              const isHoriz = local.horizontal;
              const offset = layout().offset + headerLength();
              const length = layout().length;
              const cols = numColumns();
              const viewportCrossSize = crossViewportLength();
              const fallbackCrossSpan =
                !isHoriz && cols === 1 ? ("100%" as const) : defaultItemLength();
              const crossSpan =
                viewportCrossSize > 0
                  ? viewportCrossSize / cols
                  : fallbackCrossSpan;
              const crossOffset =
                viewportCrossSize > 0
                  ? colIndex() * (viewportCrossSize / cols)
                  : colIndex() * defaultItemLength();
              const finalStyle = {
                position: "absolute" as const,
                [isHoriz ? "left" : "top"]: offset,
                [isHoriz ? "top" : "left"]: crossOffset,
                [isHoriz ? "width" : "height"]: length,
                [isHoriz ? "height" : "width"]: crossSpan,
                ...((local.columnWrapperStyle as any) ?? {}),
              };
              return finalStyle;
            });

            return (
              <view style={style() as any} key={key()}>
                {local.renderItem({ item: item(), index: absoluteIndex })}
              </view>
            );
          }}
        </For>

        {local.data.length === 0 && local.ListEmptyComponent}

        {local.ListFooterComponent && (
          <View
            onLayout={handleFooterLayout}
            style={{
              position: "absolute",
              [local.horizontal ? "left" : "top"]:
                totalContentLength() - footerLength(),
              [local.horizontal ? "top" : "left"]: 0,
              [local.horizontal ? "bottom" : "right"]: 0,
            }}
          >
            {local.ListFooterComponent}
          </View>
        )}
      </view>
    </ScrollView>
  );
}
