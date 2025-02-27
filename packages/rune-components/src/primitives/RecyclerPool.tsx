import { createSignal, createEffect, JSX, batch, onCleanup } from "solid-js";
import { View, type LayoutChangeEvent } from "./View";
import type { Style } from "@rune/core";

/**
 * RecyclerPool - A true DOM node recycling system for FlatList
 *
 * Instead of creating/destroying nodes as items scroll in/out,
 * maintains a fixed pool of reusable nodes and updates their data.
 *
 * Key benefits:
 * - Zero appendChild/removeChild during scroll
 * - Constant memory usage regardless of list size
 * - Smooth 60fps performance on large lists
 */

export type RecyclerNode<T> = {
  /** Stable pool index (never changes for a node) */
  poolIndex: number;
  /** Current item data bound to this node */
  data: T | null;
  /** Original data index in the source array */
  dataIndex: number;
  /** Vertical/horizontal offset for absolute positioning */
  offset: number;
  /** Whether this node is currently visible */
  visible: boolean;
  /** Item key for tracking */
  key: string;
};

export type RecyclerPoolConfig = {
  /** Number of nodes in the pool */
  poolSize: number;
  /** Item size (height for vertical, width for horizontal) */
  itemSize: number;
  /** Scroll orientation */
  orientation: "vertical" | "horizontal";
};

/**
 * Creates a recycling pool manager for FlatList
 */
export function createRecyclerPool<T>(config: RecyclerPoolConfig) {
  const [nodes, setNodes] = createSignal<RecyclerNode<T>[]>(
    Array.from({ length: config.poolSize }, (_, i) => ({
      poolIndex: i,
      data: null,
      dataIndex: -1,
      offset: 0,
      visible: false,
      key: `pool-${i}`,
    }))
  );

  let lastVisibleRange = { start: -1, end: -1 };

  /**
   * Update the pool to display items in the visible range.
   * Reuses existing nodes by updating their data and position.
   */
  const updateVisibleRange = (
    items: T[],
    visibleStart: number,
    visibleEnd: number,
    keyExtractor: (item: T, index: number) => string,
    offset?: number
  ) => {
    // Clamp to valid range
    const start = Math.max(0, Math.min(visibleStart, items.length - 1));
    const end = Math.max(start, Math.min(visibleEnd, items.length - 1));

    // Skip redundant updates
    if (
      items.length === 0 ||
      (start === lastVisibleRange.start && end === lastVisibleRange.end)
    ) {
      return;
    }

    lastVisibleRange = { start, end };

    const visibleCount = end - start + 1;
    const requiredNodes = Math.min(visibleCount, config.poolSize);

    // Warn if pool is too small
    if (visibleCount > config.poolSize && typeof console !== "undefined") {
      // console.warn(
      //   `[RecyclerPool] ⚠️ Pool too small! Window needs ${visibleCount} items but pool only has ${config.poolSize} nodes. ` +
      //     `Increase recyclePoolSize to at least ${visibleCount} to avoid missing items.`
      // );
    }

    batch(() => {
      setNodes((prevNodes) => {
        const newNodes = prevNodes.map((node, poolIndex) => {
          // Calculate which data index this node should display
          const dataIndex = start + poolIndex;

          // Hide nodes beyond the visible range
          if (poolIndex >= requiredNodes || dataIndex > end) {
            return {
              ...node,
              data: null,
              dataIndex: -1,
              visible: false,
              offset: 0,
            };
          }

          const item = items[dataIndex];
          if (!item) {
            return {
              ...node,
              data: null,
              dataIndex: -1,
              visible: false,
              offset: 0,
            };
          }

          // Reuse this node with new data
          return {
            ...node,
            data: item,
            dataIndex,
            offset: 0, // No offset needed - spacers handle positioning
            visible: true,
            key: keyExtractor(item, dataIndex),
          };
        });

        // Debug logging
        if (typeof console !== "undefined") {
          const visibleNodes = newNodes.filter((n) => n.visible);
          const dataIndices = visibleNodes.map((n) => n.dataIndex).join(", ");
          // console.log(
          //   `[RecyclerPool] Updated range ${start}-${end} (${requiredNodes}/${config.poolSize} nodes active) - indices: [${dataIndices}]`
          // );
        }

        return newNodes;
      });
    });
  };

  /**
   * Get current node states
   */
  const getNodes = () => nodes();

  /**
   * Get active (visible) nodes
   */
  const getActiveNodes = () => nodes().filter((n) => n.visible);

  /**
   * Get pool statistics
   */
  const getStats = () => {
    const activeCount = nodes().filter((n) => n.visible).length;
    return {
      poolSize: config.poolSize,
      activeNodes: activeCount,
      idleNodes: config.poolSize - activeCount,
      lastRange: lastVisibleRange,
    };
  };

  /**
   * Reset the pool (clear all data)
   */
  const reset = () => {
    batch(() => {
      setNodes((prevNodes) =>
        prevNodes.map((node) => ({
          ...node,
          data: null,
          dataIndex: -1,
          offset: 0,
          visible: false,
        }))
      );
    });
    lastVisibleRange = { start: -1, end: -1 };
  };

  return {
    nodes,
    updateVisibleRange,
    getNodes,
    getActiveNodes,
    getStats,
    reset,
  };
}

/**
 * Render props for a recycled item
 */
export type RecycledItemProps<T> = {
  node: RecyclerNode<T>;
  renderItem: (info: { item: T; index: number; key: string }) => JSX.Element;
  orientation: "vertical" | "horizontal";
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * RecycledItem - A reusable item component that updates its data
 * without being destroyed/recreated
 */
export function RecycledItem<T>(props: RecycledItemProps<T>) {
  // Only render if we have data
  const shouldRender = () => props.node.visible && props.node.data !== null;

  // Don't apply positioning here - it will be handled by the parent container
  // The offset is used by FlatList to position items correctly
  return (
    <View
      data-pool-index={props.node.poolIndex}
      data-data-index={props.node.dataIndex}
      onLayout={props.onLayout}
    >
      {shouldRender() && props.node.data
        ? props.renderItem({
            item: props.node.data,
            index: props.node.dataIndex,
            key: props.node.key,
          })
        : null}
    </View>
  );
}
