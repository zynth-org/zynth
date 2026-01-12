import { registerWebComponent } from "@rune/core";

type ScrollCallbacks = {
  onScroll?: (event: any) => void;
  onScrollBeginDrag?: (event: any) => void;
  onScrollEndDrag?: (event: any) => void;
  onMomentumScrollBegin?: (event: any) => void;
  onMomentumScrollEnd?: (event: any) => void;
};

type ScrollState = {
  callbacks: ScrollCallbacks;
  dragging: boolean;
  decelerating: boolean;
  lastScrollLeft: number;
  lastScrollTop: number;
  lastScrollTime: number;
  lastEmitTime: number;
  lastEmitLeft: number;
  lastEmitTop: number;
  lastVelocity: { x: number; y: number } | null;
  scrollEndTimer: ReturnType<typeof setTimeout> | null;
  eventThrottleMs: number;
  eventMinDisplacementPx: number;
  horizontal: boolean;
  scrollEnabled: boolean;
  overscrollBehavior: "auto" | "contain" | "none";
  scrollSnapAlign: string | string[] | null;
  snapObserver: MutationObserver | null;
};

const SCROLLBAR_STYLE_ID = "rune-scrollbar-style";

const ensureScrollbarStyle = () => {
  if (document.getElementById(SCROLLBAR_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SCROLLBAR_STYLE_ID;
  style.textContent = `
    .rune-scroll-view-hide-scrollbar::-webkit-scrollbar { display: none; }
  `;
  document.head.appendChild(style);
};

const getState = (element: HTMLElement): ScrollState => {
  const existing = (element as any).__rune_scroll_state as
    | ScrollState
    | undefined;
  if (existing) return existing;
  const next: ScrollState = {
    callbacks: {},
    dragging: false,
    decelerating: false,
    lastScrollLeft: 0,
    lastScrollTop: 0,
    lastScrollTime: 0,
    lastEmitTime: 0,
    lastEmitLeft: 0,
    lastEmitTop: 0,
    lastVelocity: null,
    scrollEndTimer: null,
    eventThrottleMs: 16,
    eventMinDisplacementPx: 0,
    horizontal: false,
    scrollEnabled: true,
    overscrollBehavior: "auto",
    scrollSnapAlign: null,
    snapObserver: null,
  };
  (element as any).__rune_scroll_state = next;
  return next;
};

const applyOverflow = (element: HTMLElement, state: ScrollState) => {
  if (!state.scrollEnabled) {
    element.style.setProperty("overflow", "hidden", "important");
    element.style.setProperty("overflow-x", "hidden", "important");
    element.style.setProperty("overflow-y", "hidden", "important");
    element.style.touchAction = "none";
    return;
  }

  element.style.touchAction = "pan-x pan-y";
  if (state.horizontal) {
    element.style.setProperty("overflow-x", "auto", "important");
    element.style.setProperty("overflow-y", "hidden", "important");
  } else {
    element.style.setProperty("overflow-y", "auto", "important");
    element.style.setProperty("overflow-x", "hidden", "important");
  }
};

const applyOverscrollBehavior = (element: HTMLElement, state: ScrollState) => {
  const behavior = state.overscrollBehavior;
  if (state.horizontal) {
    element.style.overscrollBehaviorX = behavior;
    element.style.overscrollBehaviorY = "contain";
  } else {
    element.style.overscrollBehaviorY = behavior;
    element.style.overscrollBehaviorX = "contain";
  }
};

const buildScrollEvent = (element: HTMLElement, state: ScrollState) => {
  const now = Date.now();
  const left = element.scrollLeft;
  const top = element.scrollTop;
  const dt = state.lastScrollTime ? now - state.lastScrollTime : 0;
  const dx = left - state.lastScrollLeft;
  const dy = top - state.lastScrollTop;

  let velocity: { x: number; y: number } | null = null;
  if (dt > 0) {
    velocity = { x: (dx / dt) * 1000, y: (dy / dt) * 1000 };
  }
  state.lastScrollLeft = left;
  state.lastScrollTop = top;
  state.lastScrollTime = now;
  state.lastVelocity = velocity;

  return {
    contentOffset: { x: left, y: top },
    contentSize: {
      width: element.scrollWidth,
      height: element.scrollHeight,
    },
    layoutMeasurement: {
      width: element.clientWidth,
      height: element.clientHeight,
    },
    velocity,
    zoomScale: 1,
  };
};

const maybeEmitScroll = (element: HTMLElement, state: ScrollState) => {
  const now = Date.now();
  const throttle = state.eventThrottleMs ?? 16;
  if (throttle > 0 && now - state.lastEmitTime < throttle) return;

  const left = element.scrollLeft;
  const top = element.scrollTop;
  const displacement = Math.max(
    Math.abs(left - state.lastEmitLeft),
    Math.abs(top - state.lastEmitTop)
  );
  if (displacement < (state.eventMinDisplacementPx ?? 0)) return;

  state.lastEmitTime = now;
  state.lastEmitLeft = left;
  state.lastEmitTop = top;
  state.callbacks.onScroll?.(buildScrollEvent(element, state));
};

const scheduleScrollEnd = (element: HTMLElement, state: ScrollState) => {
  if (state.scrollEndTimer) clearTimeout(state.scrollEndTimer);
  state.scrollEndTimer = setTimeout(() => {
    state.scrollEndTimer = null;
    if (state.decelerating) {
      state.decelerating = false;
      state.callbacks.onMomentumScrollEnd?.(buildScrollEvent(element, state));
    }
  }, 120);
};

const applyScrollSnapAlign = (element: HTMLElement, state: ScrollState) => {
  const align = state.scrollSnapAlign;
  if (!align) return;
  const content = element.firstElementChild as HTMLElement | null;
  if (!content) return;
  const children = Array.from(content.children) as HTMLElement[];
  if (Array.isArray(align)) {
    children.forEach((child, index) => {
      const value = align[index] ?? align[align.length - 1];
      child.style.scrollSnapAlign = value;
    });
  } else {
    children.forEach((child) => {
      child.style.scrollSnapAlign = align;
    });
  }
};

const ensureSnapObserver = (element: HTMLElement, state: ScrollState) => {
  if (state.snapObserver || !state.scrollSnapAlign) return;
  state.snapObserver = new MutationObserver(() => {
    applyScrollSnapAlign(element, state);
  });
  state.snapObserver.observe(element, { childList: true, subtree: true });
};

const disconnectSnapObserver = (state: ScrollState) => {
  if (!state.snapObserver) return;
  state.snapObserver.disconnect();
  state.snapObserver = null;
};

registerWebComponent("scroll-view", {
  create: (initialProps) => {
    const element = document.createElement("div");
    element.classList.add("rune-scroll-view");
    element.style.display = "flex";
    element.style.flexDirection = "column";
    element.style.position = "relative";
    element.style.boxSizing = "border-box";
    (element.style as any).webkitOverflowScrolling = "touch";

    const state = getState(element);
    if (initialProps) {
      state.horizontal = !!initialProps.horizontal;
      state.scrollEnabled =
        initialProps.scrollEnabled === undefined
          ? true
          : !!initialProps.scrollEnabled;
      const overscroll =
        initialProps.overScrollBehavior ??
        (initialProps.bounces === false ? "never" : "auto");
      state.overscrollBehavior = overscroll === "never" ? "contain" : "auto";
      state.eventThrottleMs = initialProps.eventThrottleMs ?? 16;
      state.eventMinDisplacementPx = initialProps.eventMinDisplacementPx ?? 0;
    }

    applyOverflow(element, state);
    applyOverscrollBehavior(element, state);

    element.addEventListener("scroll", () => {
      if (!state.dragging && !state.decelerating) {
        state.decelerating = true;
        state.callbacks.onMomentumScrollBegin?.(
          buildScrollEvent(element, state)
        );
      }
      maybeEmitScroll(element, state);
      scheduleScrollEnd(element, state);
    });

    const startDrag = () => {
      state.dragging = true;
      state.decelerating = false;
      state.callbacks.onScrollBeginDrag?.(buildScrollEvent(element, state));
    };

    const endDrag = () => {
      if (!state.dragging) return;
      state.dragging = false;
      state.callbacks.onScrollEndDrag?.(buildScrollEvent(element, state));
      scheduleScrollEnd(element, state);
    };

    element.addEventListener("pointerdown", startDrag);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    element.addEventListener("mouseleave", endDrag);
    element.addEventListener("touchstart", startDrag, { passive: true });
    element.addEventListener("touchend", endDrag, { passive: true });

    return element;
  },
  updateProp: (element, key, value) => {
    const state = getState(element);

    if (key === "style") {
      setTimeout(() => {
        applyOverflow(element, state);
        applyOverscrollBehavior(element, state);
      }, 0);
      return false;
    }

    if (key === "__scrollCommand") {
      const command = value ?? {};
      const type = command.type;
      if (type === "scrollTo") {
        element.scrollTo({
          left: command.x ?? element.scrollLeft,
          top: command.y ?? element.scrollTop,
          behavior: command.animated === false ? "auto" : "smooth",
        });
      } else if (type === "scrollBy") {
        element.scrollBy({
          left: command.dx ?? 0,
          top: command.dy ?? 0,
          behavior: command.animated === false ? "auto" : "smooth",
        });
      } else if (type === "stop") {
        element.scrollTo({
          left: element.scrollLeft,
          top: element.scrollTop,
          behavior: "auto",
        });
      } else if (type === "lockAxis") {
        state.horizontal = command.axis === "horizontal";
        applyOverflow(element, state);
      }
      return true;
    }

    if (key === "horizontal") {
      state.horizontal = !!value;
      applyOverflow(element, state);
      applyOverscrollBehavior(element, state);
      return true;
    }

    if (key === "scrollEnabled") {
      state.scrollEnabled = value === undefined ? true : !!value;
      applyOverflow(element, state);
      return true;
    }

    if (key === "overScrollBehavior" || key === "bounces") {
      const behavior =
        key === "overScrollBehavior"
          ? value
          : value === false
          ? "never"
          : "auto";
      state.overscrollBehavior =
        behavior === "never"
          ? "contain"
          : behavior === "always"
          ? "auto"
          : "auto";
      applyOverscrollBehavior(element, state);
      return true;
    }

    if (key === "eventThrottleMs") {
      state.eventThrottleMs = value ?? 16;
      return true;
    }

    if (key === "eventMinDisplacementPx") {
      state.eventMinDisplacementPx = value ?? 0;
      return true;
    }

    if (
      key === "showsVerticalScrollIndicator" ||
      key === "showsHorizontalScrollIndicator"
    ) {
      const showsVertical =
        key === "showsVerticalScrollIndicator"
          ? value !== false
          : (element as any).__rune_shows_vertical ?? true;
      const showsHorizontal =
        key === "showsHorizontalScrollIndicator"
          ? value !== false
          : (element as any).__rune_shows_horizontal ?? true;

      if (key === "showsVerticalScrollIndicator") {
        (element as any).__rune_shows_vertical = value !== false;
      }
      if (key === "showsHorizontalScrollIndicator") {
        (element as any).__rune_shows_horizontal = value !== false;
      }

      if (!showsVertical || !showsHorizontal) {
        ensureScrollbarStyle();
        element.classList.add("rune-scroll-view-hide-scrollbar");
        (element.style as any).scrollbarWidth = "none";
        (element.style as any).msOverflowStyle = "none";
      } else {
        element.classList.remove("rune-scroll-view-hide-scrollbar");
        (element.style as any).scrollbarWidth = "";
        (element.style as any).msOverflowStyle = "";
      }
      return true;
    }

    if (key === "scrollSnapType") {
      if (!value || value === "none") {
        element.style.scrollSnapType = "";
      } else if (value.axis) {
        const axis =
          value.axis === "both" ? "both" : value.axis === "x" ? "x" : "y";
        element.style.scrollSnapType = `${axis} ${
          value.strictness ?? "mandatory"
        }`;
      }
      return true;
    }

    if (key === "scrollSnapAlign") {
      state.scrollSnapAlign = value ?? null;
      if (state.scrollSnapAlign) {
        applyScrollSnapAlign(element, state);
        ensureSnapObserver(element, state);
      } else {
        disconnectSnapObserver(state);
      }
      return true;
    }

    if (key === "scrollSnapStop") {
      element.style.scrollSnapStop = value ?? "";
      return true;
    }

    if (key === "scrollPadding") {
      if (typeof value === "number") {
        element.style.scrollPadding = `${value}px`;
      } else if (value && typeof value === "object") {
        if (value.top !== undefined)
          element.style.scrollPaddingTop = `${value.top}px`;
        if (value.right !== undefined)
          element.style.scrollPaddingRight = `${value.right}px`;
        if (value.bottom !== undefined)
          element.style.scrollPaddingBottom = `${value.bottom}px`;
        if (value.left !== undefined)
          element.style.scrollPaddingLeft = `${value.left}px`;
      }
      return true;
    }

    if (key === "contentInset") {
      if (value && typeof value === "object") {
        if (value.top !== undefined)
          element.style.paddingTop = `${value.top}px`;
        if (value.right !== undefined)
          element.style.paddingRight = `${value.right}px`;
        if (value.bottom !== undefined)
          element.style.paddingBottom = `${value.bottom}px`;
        if (value.left !== undefined)
          element.style.paddingLeft = `${value.left}px`;
      }
      return true;
    }

    if (
      key === "onScroll" ||
      key === "onScrollBeginDrag" ||
      key === "onScrollEndDrag" ||
      key === "onMomentumScrollBegin" ||
      key === "onMomentumScrollEnd"
    ) {
      switch (key) {
        case "onScroll":
          state.callbacks.onScroll = value;
          break;
        case "onScrollBeginDrag":
          state.callbacks.onScrollBeginDrag = value;
          break;
        case "onScrollEndDrag":
          state.callbacks.onScrollEndDrag = value;
          break;
        case "onMomentumScrollBegin":
          state.callbacks.onMomentumScrollBegin = value;
          break;
        case "onMomentumScrollEnd":
          state.callbacks.onMomentumScrollEnd = value;
          break;
      }
      return true;
    }

    return false;
  },
});
