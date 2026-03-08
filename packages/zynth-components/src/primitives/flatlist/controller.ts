import { createSignal } from "solid-js";
import type { ScrollViewRef } from "../ScrollView";

/**
 * FlatListRef - Imperative API for programmatic scrolling
 *
 * Provides deterministic scroll control and utilities for testing and UX.
 * All scroll operations use the same offset math as item binding, ensuring
 * jumps land exactly without disturbing virtualization.
 *
 * Key invariants:
 * - Does not trigger reconciliation or pool changes
 * - Works during idle, drag, and momentum phases
 * - No flicker after calls (uses native animated scrolling)
 */

export type ScrollToIndexOptions = {
  /** Target item index (0-based) */
  index: number;
  /**
   * Offset in pixels from the edge defined by viewPosition.
   * Positive = inset, negative = outset.
   */
  viewOffset?: number;
  /**
   * Fraction (0-1) defining where the item should land in the viewport:
   * - 0 = top/left edge
   * - 0.5 = center
   * - 1 = bottom/right edge
   * Default: 0
   */
  viewPosition?: number;
  /** Animate the scroll. Default: false */
  animated?: boolean;
};

export type ScrollToOffsetOptions = {
  /** Target scroll offset in pixels */
  offset: number;
  /** Animate the scroll. Default: false */
  animated?: boolean;
};

export type ScrollToEdgeOptions = {
  /** Animate the scroll. Default: false */
  animated?: boolean;
};

export type FlatListRef = {
  /**
   * Scroll to a specific item index.
   * Uses the same offset math as item binding for pixel-perfect positioning.
   */
  scrollToIndex: (options: ScrollToIndexOptions) => void;

  /**
   * Scroll to an absolute offset in pixels.
   */
  scrollToOffset: (options: ScrollToOffsetOptions) => void;

  /**
   * Scroll to the start (top for vertical, left for horizontal).
   */
  scrollToTop: (options?: ScrollToEdgeOptions) => void;

  /**
   * Scroll to the end (bottom for vertical, right for horizontal).
   */
  scrollToEnd: (options?: ScrollToEdgeOptions) => void;

  /**
   * Briefly flash the scroll indicators.
   */
  flashScrollIndicators: () => void;

  /**
   * Force recomputation of which items are visible.
   * Useful after external layout changes.
   */
  recomputeViewableItems: () => void;

  /**
   * Record a user interaction timestamp.
   * Can be used to coordinate with gesture handlers or accessibility.
   */
  recordInteraction: () => void;

  /**
   * Escape hatch: direct access to the underlying ScrollView ref.
   * Use sparingly - prefer the typed methods above.
   */
  getNativeScrollRef: () => ScrollViewRef | null;
};

type InternalFlatListController = FlatListRef & {
  __setScrollRef: (ref: ScrollViewRef | null) => void;
  __setMetadata: (metadata: {
    itemSize: number;
    horizontal: boolean;
    dataLength: number;
  }) => void;
  __triggerRecompute: () => number; // Returns recompute ID
};

export function createFlatListRef(): FlatListRef {
  const [scrollRef, setScrollRef] =
    createSignal<ScrollViewRef | null>(null);
  const [itemSize, setItemSize] = createSignal(0);
  const [horizontal, setHorizontal] = createSignal(false);
  const [dataLength, setDataLength] = createSignal(0);
  const [recomputeId, setRecomputeId] = createSignal(0);

  const refHandle: InternalFlatListController = {
    scrollToIndex(options) {
      const ctrl = scrollRef();
      if (!ctrl) {
        console.warn(
          "[FlatListRef] scrollToIndex called before ref attached"
        );
        return;
      }

      const size = itemSize();
      const len = dataLength();
      if (!size || !len) {
        console.warn(
          "[FlatListRef] scrollToIndex called with invalid metadata"
        );
        return;
      }

      const {
        index,
        viewOffset = 0,
        viewPosition = 0,
        animated = false,
      } = options;

      // Clamp index to valid range
      const clampedIndex = Math.max(0, Math.min(index, len - 1));

      // Calculate item offset (same math as binding position)
      const itemOffset = clampedIndex * size;

      // Calculate viewport adjustment
      const metrics = ctrl.metrics();
      const viewportSize = horizontal()
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;

      // viewPosition: 0 = start, 0.5 = center, 1 = end
      const viewportAdjustment = viewPosition * viewportSize;

      // Final offset: item position - viewport adjustment + custom offset
      const targetOffset = itemOffset - viewportAdjustment + viewOffset;

      // Clamp to valid scroll range
      const contentSize = len * size;
      const maxOffset = Math.max(0, contentSize - viewportSize);
      const finalOffset = Math.max(0, Math.min(targetOffset, maxOffset));

      // Execute scroll
      if (horizontal()) {
        ctrl.scrollTo({ x: finalOffset, animated });
      } else {
        ctrl.scrollTo({ y: finalOffset, animated });
      }
    },

    scrollToOffset(options) {
      const ctrl = scrollRef();
      if (!ctrl) {
        console.warn(
          "[FlatListRef] scrollToOffset called before ref attached"
        );
        return;
      }

      const { offset, animated = false } = options;
      const clampedOffset = Math.max(0, offset);

      if (horizontal()) {
        ctrl.scrollTo({ x: clampedOffset, animated });
      } else {
        ctrl.scrollTo({ y: clampedOffset, animated });
      }
    },

    scrollToTop(options = {}) {
      const ctrl = scrollRef();
      if (!ctrl) {
        console.warn(
          "[FlatListRef] scrollToTop called before ref attached"
        );
        return;
      }

      const { animated = false } = options;

      if (horizontal()) {
        ctrl.scrollTo({ x: 0, animated });
      } else {
        ctrl.scrollTo({ y: 0, animated });
      }
    },

    scrollToEnd(options = {}) {
      const ctrl = scrollRef();
      if (!ctrl) {
        console.warn(
          "[FlatListRef] scrollToEnd called before ref attached"
        );
        return;
      }

      const { animated = false } = options;
      const size = itemSize();
      const len = dataLength();

      if (!size || !len) {
        console.warn(
          "[FlatListRef] scrollToEnd called with invalid metadata"
        );
        return;
      }

      const metrics = ctrl.metrics();
      const viewportSize = horizontal()
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;

      const contentSize = len * size;
      const maxOffset = Math.max(0, contentSize - viewportSize);

      if (horizontal()) {
        ctrl.scrollTo({ x: maxOffset, animated });
      } else {
        ctrl.scrollTo({ y: maxOffset, animated });
      }
    },

    flashScrollIndicators() {
      const ctrl = scrollRef();
      if (!ctrl) {
        console.warn(
          "[FlatListRef] flashScrollIndicators called before ref attached"
        );
        return;
      }
      ctrl.flashScrollIndicators();
    },

    recomputeViewableItems() {
      // Increment recompute ID to trigger effect in FlatList
      setRecomputeId((prev) => prev + 1);
    },

    recordInteraction() {
      // Timestamp for interaction tracking
      // This is a no-op in the current implementation but provides
      // an extension point for analytics or accessibility features
    },

    getNativeScrollRef() {
      return scrollRef();
    },

    __setScrollRef(ctrl) {
      setScrollRef(ctrl);
    },

    __setMetadata(metadata) {
      setItemSize(metadata.itemSize);
      setHorizontal(metadata.horizontal);
      setDataLength(metadata.dataLength);
    },

    __triggerRecompute() {
      return recomputeId();
    },
  };

  return refHandle;
}
