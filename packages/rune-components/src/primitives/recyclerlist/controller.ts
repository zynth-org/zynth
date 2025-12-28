import { createSignal } from "solid-js";
import type { ScrollController } from "../ScrollView";

export type ScrollToIndexOptions = {
  index: number;
  viewOffset?: number;
  viewPosition?: number;
  animated?: boolean;
};

export type ScrollToOffsetOptions = {
  offset: number;
  animated?: boolean;
};

export type ScrollToEdgeOptions = {
  animated?: boolean;
};

export type RecyclerListController = {
  scrollToIndex: (options: ScrollToIndexOptions) => void;
  scrollToOffset: (options: ScrollToOffsetOptions) => void;
  scrollToTop: (options?: ScrollToEdgeOptions) => void;
  scrollToEnd: (options?: ScrollToEdgeOptions) => void;
  flashScrollIndicators: () => void;
  getNativeScrollRef: () => ScrollController | null;
};

type LayoutResolver = {
  getOffset: (index: number) => number;
  getSize: (index: number) => number;
  getTotal: () => number;
  getLength: () => number;
  isHorizontal: () => boolean;
  isInverted: () => boolean;
};

type InternalRecyclerListController = RecyclerListController & {
  __setScrollController: (controller: ScrollController | null) => void;
  __setLayoutResolver: (resolver: LayoutResolver | null) => void;
};

export function createRecyclerListController(): RecyclerListController {
  const [scrollController, setScrollController] =
    createSignal<ScrollController | null>(null);
  let resolver: LayoutResolver | null = null;

  const controller: InternalRecyclerListController = {
    scrollToIndex(options) {
      const ctrl = scrollController();
      if (!ctrl) {
        console.warn(
          "[RecyclerListController] scrollToIndex called before controller attached"
        );
        return;
      }
      if (!resolver) {
        console.warn(
          "[RecyclerListController] scrollToIndex called before layout ready"
        );
        return;
      }

      const length = resolver.getLength();
      if (!length) {
        console.warn(
          "[RecyclerListController] scrollToIndex called with empty data"
        );
        return;
      }

      const {
        index,
        viewOffset = 0,
        viewPosition = 0,
        animated = false,
      } = options;

      const clampedIndex = Math.max(0, Math.min(index, length - 1));
      const itemOffset = resolver.getOffset(clampedIndex);

      const metrics = ctrl.metrics();
      const viewportSize = resolver.isHorizontal()
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;

      const viewportAdjustment = viewPosition * viewportSize;
      const targetOffset = itemOffset - viewportAdjustment + viewOffset;

      const total = resolver.getTotal();
      const maxOffset = Math.max(0, total - viewportSize);
      let finalOffset = Math.max(0, Math.min(targetOffset, maxOffset));

      if (resolver.isInverted()) {
        finalOffset = Math.max(0, maxOffset - finalOffset);
      }

      if (resolver.isHorizontal()) {
        ctrl.scrollTo({ x: finalOffset, animated });
      } else {
        ctrl.scrollTo({ y: finalOffset, animated });
      }
    },

    scrollToOffset(options) {
      const ctrl = scrollController();
      if (!ctrl) {
        console.warn(
          "[RecyclerListController] scrollToOffset called before controller attached"
        );
        return;
      }

      const { offset, animated = false } = options;
      let clampedOffset = Math.max(0, offset);

      if (resolver) {
        const total = resolver.getTotal();
        const metrics = ctrl.metrics();
        const viewportSize = resolver.isHorizontal()
          ? metrics.viewportSize.width
          : metrics.viewportSize.height;
        const maxOffset = Math.max(0, total - viewportSize);
        clampedOffset = Math.min(clampedOffset, maxOffset);
        if (resolver.isInverted()) {
          clampedOffset = Math.max(0, maxOffset - clampedOffset);
        }
      }

      if (resolver?.isHorizontal()) {
        ctrl.scrollTo({ x: clampedOffset, animated });
      } else {
        ctrl.scrollTo({ y: clampedOffset, animated });
      }
    },

    scrollToTop(options = {}) {
      const ctrl = scrollController();
      if (!ctrl) {
        console.warn(
          "[RecyclerListController] scrollToTop called before controller attached"
        );
        return;
      }

      const { animated = false } = options;
      if (resolver?.isInverted()) {
        const metrics = ctrl.metrics();
        const viewportSize = resolver.isHorizontal()
          ? metrics.viewportSize.width
          : metrics.viewportSize.height;
        const maxOffset = Math.max(0, resolver.getTotal() - viewportSize);
        if (resolver.isHorizontal()) {
          ctrl.scrollTo({ x: maxOffset, animated });
        } else {
          ctrl.scrollTo({ y: maxOffset, animated });
        }
        return;
      }

      if (resolver?.isHorizontal()) {
        ctrl.scrollTo({ x: 0, animated });
      } else {
        ctrl.scrollTo({ y: 0, animated });
      }
    },

    scrollToEnd(options = {}) {
      const ctrl = scrollController();
      if (!ctrl) {
        console.warn(
          "[RecyclerListController] scrollToEnd called before controller attached"
        );
        return;
      }
      if (!resolver) {
        console.warn(
          "[RecyclerListController] scrollToEnd called before layout ready"
        );
        return;
      }

      const { animated = false } = options;
      const metrics = ctrl.metrics();
      const viewportSize = resolver.isHorizontal()
        ? metrics.viewportSize.width
        : metrics.viewportSize.height;
      const maxOffset = Math.max(0, resolver.getTotal() - viewportSize);

      let targetOffset = maxOffset;
      if (resolver.isInverted()) {
        targetOffset = 0;
      }

      if (resolver.isHorizontal()) {
        ctrl.scrollTo({ x: targetOffset, animated });
      } else {
        ctrl.scrollTo({ y: targetOffset, animated });
      }
    },

    flashScrollIndicators() {
      const ctrl = scrollController();
      if (!ctrl) {
        console.warn(
          "[RecyclerListController] flashScrollIndicators called before controller attached"
        );
        return;
      }
      ctrl.flashScrollIndicators();
    },

    getNativeScrollRef() {
      return scrollController();
    },

    __setScrollController(ctrl) {
      setScrollController(ctrl);
    },

    __setLayoutResolver(nextResolver) {
      resolver = nextResolver;
    },
  };

  return controller;
}
