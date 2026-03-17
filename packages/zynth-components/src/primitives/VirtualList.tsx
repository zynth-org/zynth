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
export type GetItemLayout<T> = (data: T[] | null | undefined, index: number) => ItemLayout;

export interface VirtualListProps<T> {
  data: T[];
  renderItem: (info: VirtualListRenderItemInfo<T>) => JSX.Element;
  keyExtractor?: (item: T, index: number) => string | number;
  numColumns?: number;
  itemHeight?: number;
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
    "itemHeight",
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
    { equals: (a, b) => a.width === b.width && a.height === b.height }
  );
  const [headerHeight, setHeaderHeight] = createSignal(0);
  const [footerHeight, setFooterHeight] = createSignal(0);

  const numColumns = createMemo(() => Math.max(1, local.numColumns ?? 1));
  const overscanRows = createMemo(() => local.overscan ?? 2);
  const defaultItemHeight = createMemo(() => local.itemHeight ?? 50);

  const rowCount = createMemo(() => Math.ceil(local.data.length / numColumns()));

  // Internal data access to avoid excessive reactivity during layout calculations
  let currentData = local.data;
  createEffect(() => {
    currentData = local.data;
  });

  const getRowLayout = (rowIndex: number): { length: number; offset: number } => {
    const cols = numColumns();
    if (local.getItemLayout) {
      const firstItemIndex = rowIndex * cols;
      const layout = local.getItemLayout(currentData, firstItemIndex);
      return { length: layout.length, offset: layout.offset };
    }
    const height = defaultItemHeight();
    return { length: height, offset: rowIndex * height };
  };

  const totalContentHeight = createMemo(() => {
    const count = rowCount();
    let rowsHeight = 0;
    if (count > 0) {
      const lastRow = getRowLayout(count - 1);
      rowsHeight = lastRow.offset + lastRow.length;
    }
    return rowsHeight + headerHeight() + footerHeight();
  });

  const range = createMemo((prev) => {
    const offset = Math.max(0, scrollOffset() - headerHeight());
    const viewport = local.horizontal ? viewportSize().width : viewportSize().height;
    const count = rowCount();

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
        if (layout.offset <= offset && layout.offset + layout.length > offset) {
          startRow = mid;
          break;
        } else if (layout.offset > offset) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }
      if (low > high) startRow = Math.max(0, high);

      endRow = startRow;
      for (let i = startRow; i < count; i++) {
        let layout = getRowLayout(i);
        if (layout.offset > offset + viewport) {
          endRow = i;
          break;
        }
        endRow = i + 1;
      }
    } else {
      const height = defaultItemHeight();
      startRow = Math.floor(offset / height);
      endRow = Math.ceil((offset + viewport) / height);
    }

    const os = overscanRows();
    const nextStart = Math.max(0, startRow - os);
    const nextEnd = Math.min(count, endRow + os);

    // Prevent propagating unchanged range object
    if (prev && prev.start === nextStart && prev.end === nextEnd) {
      return prev;
    }
    return { start: nextStart, end: nextEnd };
  }, { start: 0, end: local.initialNumToRender ?? 10 });

  const visibleItems = createMemo(() => {
    const r = range();
    const cols = numColumns();
    const startItem = r.start * cols;
    const endItem = Math.min(local.data.length, r.end * cols);
    return local.data.slice(startItem, endItem);
  });

  let lastEndReachedOffset = 0;
  const handleScroll = (e: ScrollEvent) => {
    const offset = local.horizontal ? e.contentOffset.x : e.contentOffset.y;
    // Granular update for scroll offset - only affects visibleRange calculations
    setScrollOffset(offset);
    local.onScroll?.(e);

    if (local.onEndReached) {
      const threshold = local.onEndReachedThreshold ?? 0.5;
      const viewport = local.horizontal ? viewportSize().width : viewportSize().height;
      const contentSize = local.horizontal ? e.contentSize.width : e.contentSize.height;
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
    setHeaderHeight(local.horizontal ? e.nativeEvent.layout.width : e.nativeEvent.layout.height);
  };

  const handleFooterLayout = (e: LayoutChangeEvent) => {
    setFooterHeight(local.horizontal ? e.nativeEvent.layout.width : e.nativeEvent.layout.height);
  };

  const containerStyle = createMemo(() => {
    const base: any = {
      [local.horizontal ? "width" : "height"]: totalContentHeight(),
      [local.horizontal ? "height" : "width"]: "100%",
      position: "relative",
    };
    return [base, local.contentContainerStyle];
  });

  return (
    <ScrollView
      {...rest}
      horizontal={local.horizontal}
      onScroll={handleScroll}
      onLayout={handleLayout}
      style={[{ flex: 1 }, local.style]}
      removeClippedSubviews={local.removeClippedSubviews}
      contentSize={
        local.horizontal
          ? { width: totalContentHeight(), height: viewportSize().height }
          : { width: viewportSize().width, height: totalContentHeight() }
      }
      testID={local.testID}
    >
      <View style={containerStyle()}>
        {local.ListHeaderComponent && (
          <View onLayout={handleHeaderLayout}>
            {local.ListHeaderComponent}
          </View>
        )}

        <For each={visibleItems()}>
          {(item, indexSignal) => {
            const absoluteIndex = createMemo(() => range().start * numColumns() + indexSignal());
            const rowIndex = createMemo(() => Math.floor(absoluteIndex() / numColumns()));
            const colIndex = createMemo(() => absoluteIndex() % numColumns());
            const layout = createMemo(() => getRowLayout(rowIndex()));

            const style = createMemo(() => {
              const isHoriz = local.horizontal;
              const offset = layout().offset + headerHeight();
              const length = layout().length;
              const cols = numColumns();
              const viewportCrossSize = isHoriz ? viewportSize().height : viewportSize().width;
              // If viewport is not yet measured, default to 100% just in case, but pixel math is preferred.
              const crossSpan = viewportCrossSize > 0 ? viewportCrossSize / cols : `${100 / cols}%`;
              const crossOffset = viewportCrossSize > 0 ? colIndex() * (viewportCrossSize / cols) : `${colIndex() * (100 / cols)}%`;

              return {
                position: "absolute" as const,
                [isHoriz ? "left" : "top"]: offset,
                [isHoriz ? "top" : "left"]: crossOffset,
                [isHoriz ? "width" : "height"]: length,
                [isHoriz ? "height" : "width"]: crossSpan,
                ...((local.columnWrapperStyle as any) ?? {}),
              };
            });

            return (
              <View style={style()}>
                {local.renderItem({ item, index: absoluteIndex() })}
              </View>
            );
          }}
        </For>

        {local.data.length === 0 && local.ListEmptyComponent}

        {local.ListFooterComponent && (
          <View
            onLayout={handleFooterLayout}
            style={{
              position: "absolute",
              [local.horizontal ? "left" : "top"]: totalContentHeight() - footerHeight(),
              [local.horizontal ? "top" : "left"]: 0,
              [local.horizontal ? "bottom" : "right"]: 0,
            }}
          >
            {local.ListFooterComponent}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
