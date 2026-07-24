import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Element as SolidElement,
  type ParentComponent,
} from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import {
  getActiveSurface,
  render,
  setActiveSurface,
  setProperty,
} from "@zynthjs/core";
import { platform, viewport } from "@zynthjs/apis";
import { View } from "./View";

export type SnapPoint = number | `${number}%`;

export interface BottomSheetRef {
  open: (index?: number) => void;
  close: () => void;
  snapTo: (index: number) => void;
  expand: () => void;
  collapse: () => void;
  getCurrentIndex: () => number;
}

type BottomSheetCommand =
  | { type: "open"; index?: number }
  | { type: "close" }
  | { type: "snapTo"; index: number }
  | { type: "expand" }
  | { type: "collapse" };

interface LayoutEvent {
  nativeEvent?: {
    layout?: {
      height?: number;
    };
  };
}

type InternalRef = BottomSheetRef & {
  __attachHost: (node: HostNode | null) => void;
  __updateIndex: (index: number) => void;
  __setOpenState?: (open: boolean) => void;
};

export interface BottomSheetProps {
  children?: SolidElement;
  ref?: (node: (HostNode & BottomSheetRef) | null) => void;
  snapPoints?: SnapPoint[];
  initialSnapIndex?: number;
  open?: boolean;
  defaultOpen?: boolean;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  allowBackgroundInteraction?: boolean;
  allowDismissOnInteraction?: boolean;
  dynamicContentHeight?: boolean;
  style?: Style;
  contentContainerStyle?: Style;
  onOpenChange?: (open: boolean) => void;
  onSnapChange?: (payload: { index: number; progress: number }) => void;
  onDismiss?: () => void;
  testID?: string;
}

const DEFAULT_SNAP_POINTS: SnapPoint[] = ["30%", "64%", "90%"];
const BOTTOM_SHEET_SURFACE_ID_BASE = 1 << 24;
let nextBottomSheetSurfaceId = BOTTOM_SHEET_SURFACE_ID_BASE;
const DEFAULT_SHEET_STYLE: Style = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

const DEFAULT_CONTENT_STYLE: Style = {
  flex: 1,
  ...platform.choose({
    ios: {},
    android: {
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      overflow: "hidden",
      elevation: 8,
      backgroundColor: "#FFF",
    },
    web: {},
  }),
};

const DYNAMIC_ANDROID_CONTENT_STYLE: Style = {
  borderTopLeftRadius: 12,
  borderTopRightRadius: 12,
  overflow: "hidden",
  elevation: 8,
  backgroundColor: "#FFF",
  flexGrow: 0,
  flexShrink: 1,
};

const resolveSnapPointToDp = (
  point: SnapPoint,
  windowHeight: number,
): number => {
  if (typeof point === "number") {
    return Math.max(0, point);
  }
  const numeric = Number(point.slice(0, -1));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, (numeric / 100) * windowHeight);
};

const sendCommand = (host: HostNode | null, command: BottomSheetCommand) => {
  if (!host) return;
  setProperty(host, "__command", JSON.stringify(command));
};

const allocateBottomSheetSurfaceId = (): number => {
  const id = nextBottomSheetSurfaceId;
  nextBottomSheetSurfaceId += 1;
  return id;
};

const runWithSurface = <T,>(surfaceId: number, work: () => T): T => {
  const previous = getActiveSurface();
  const shouldSwitch = previous !== surfaceId;
  if (shouldSwitch) {
    setActiveSurface(surfaceId);
  }
  try {
    return work();
  } finally {
    if (shouldSwitch) {
      setActiveSurface(previous);
    }
  }
};

export const createBottomSheetRef = (): BottomSheetRef => {
  let host: HostNode | null = null;
  let currentIndex = 0;

  const handle: BottomSheetRef = {
    open: (index) => {
      sendCommand(
        host,
        index != null ? { type: "open", index } : { type: "open" },
      );
    },
    close: () => {
      sendCommand(host, { type: "close" });
    },
    snapTo: (index) => {
      sendCommand(host, { type: "snapTo", index });
    },
    expand: () => {
      sendCommand(host, { type: "expand" });
    },
    collapse: () => {
      sendCommand(host, { type: "collapse" });
    },
    getCurrentIndex: () => currentIndex,
  };

  return handle;
};

export const BottomSheet: ParentComponent<BottomSheetProps> = (props) => {
  const local = props;

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });
  const [contentHeightHint, setContentHeightHint] = createSignal(0);
  let currentIndex = local.initialSnapIndex ?? 0;
  let lastDynamicLayoutHeight = 0;
  let dynamicLayoutCommandCooldownUntil = 0;
  const [lastSentOpen, setLastSentOpen] = createSignal<boolean | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(false);
  let ignoreCloseUntil = 0;
  let hasConfirmedOpen = false;
  const isControlled = () => local.open !== undefined;
  const resolvedOpen = () =>
    isControlled() ? !!local.open : uncontrolledOpen();

  const [windowSize, setWindowSize] = createSignal(viewport.window);
  const useSurfacePortal = () => platform.current === "ios";
  const portalSurfaceId = useSurfacePortal()
    ? allocateBottomSheetSurfaceId()
    : null;

  createEffect(
    () => null,
    () => {
      const unsubscribe = viewport.observe("window", (metrics) => {
        setWindowSize(metrics);
      });
      onCleanup(unsubscribe);
    }
  );

  createEffect(
    () => ({ controlled: isControlled(), defOpen: local.defaultOpen }),
    ({ controlled, defOpen }) => {
      if (controlled || !defOpen) return;
      const timeoutId = setTimeout(() => {
        requestAnimationFrame(() => {
          setUncontrolledOpen(true);
        });
      }, 84);
      onCleanup(() => clearTimeout(timeoutId));
    }
  );

  const maxSnapHeight = createMemo(() => {
    const points =
      local.snapPoints ??
      (local.dynamicContentHeight ? [] : DEFAULT_SNAP_POINTS);
    const height = windowSize().height;
    if (points.length === 0) {
      return height;
    }
    let result = 0;
    for (const point of points) {
      result = Math.max(result, resolveSnapPointToDp(point, height));
    }
    return result;
  });

  const contentStyle = createMemo<Style>(() => {
    const resolvedMaxHeight = Number(maxSnapHeight());
    const baseStyle =
      local.dynamicContentHeight && platform.current === "android"
        ? DYNAMIC_ANDROID_CONTENT_STYLE
        : DEFAULT_CONTENT_STYLE;
    const style: Style = {
      ...baseStyle,
      ...local.contentContainerStyle,
    };
    if (
      platform.current !== "ios" &&
      resolvedMaxHeight > 0 &&
      local.contentContainerStyle?.height == null &&
      local.contentContainerStyle?.maxHeight == null
    ) {
      style.maxHeight = resolvedMaxHeight;
    }
    return style;
  });

  const sheetStyle = createMemo<Style>(() => ({
    ...DEFAULT_SHEET_STYLE,
    ...local.style,
    ...platform.choose({
      ios: {},
      android: {
        width: 0,
        height: 0,
      },
      default: {},
    }),
  }));

  const contentWrapperStyle = createMemo<Style>(() => {
    if (local.dynamicContentHeight) {
      return {
        position: "absolute",
        top: 0,
        left: 0,
        width: windowSize().width,
      };
    }
    return {
      position: "absolute",
      top: 0,
      left: 0,
      width: windowSize().width,
      height: windowSize().height,
    };
  });
  const useWindowWrapper = () => platform.current === "android";

  const handleContentLayout = (event: LayoutEvent) => {
    if (!local.dynamicContentHeight) {
      return;
    }
    const height = event.nativeEvent?.layout?.height;
    if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
      return;
    }
    const rounded = Math.round(height * 100) / 100;
    if (Math.abs(rounded - contentHeightHint()) <= 0.5) {
      return;
    }

    const previousHeight = lastDynamicLayoutHeight;
    lastDynamicLayoutHeight = rounded;
    setContentHeightHint(rounded);

    if (!resolvedOpen()) {
      return;
    }
    if (previousHeight <= 0) {
      return;
    }

    const delta = rounded - previousHeight;
    if (Math.abs(delta) <= 0.5) {
      return;
    }

    const now = Date.now();
    // console.log(now, dynamicLayoutCommandCooldownUntil, delta);
    if (now < dynamicLayoutCommandCooldownUntil) {
      return;
    }
    dynamicLayoutCommandCooldownUntil = now + 120;

    const host = hostNode();
    if (!host) {
      return;
    }
    sendCommand(host, delta > 0 ? { type: "expand" } : { type: "collapse" });
  };

  createEffect(
    () => ({ openState: resolvedOpen() }),
    ({ openState }) => {
      if (!openState) {
        lastDynamicLayoutHeight = 0;
        dynamicLayoutCommandCooldownUntil = 0;
      }
    }
  );

  const attachHost = (node: HostNode | null) => {
    setHostNode(node);
    if (node) {
      const imperativeNode = node as HostNode & BottomSheetRef;
      imperativeNode.open = (index) => {
        if (!isControlled()) {
          setUncontrolledOpen(true);
        }
        sendCommand(
          node,
          index != null ? { type: "open", index } : { type: "open" },
        );
      };
      imperativeNode.close = () => {
        if (!isControlled()) {
          setUncontrolledOpen(false);
        }
        sendCommand(node, { type: "close" });
      };
      imperativeNode.snapTo = (index) => {
        sendCommand(node, { type: "snapTo", index });
      };
      imperativeNode.expand = () => {
        sendCommand(node, { type: "expand" });
      };
      imperativeNode.collapse = () => {
        sendCommand(node, { type: "collapse" });
      };
      imperativeNode.getCurrentIndex = () => currentIndex;
      local.ref?.(imperativeNode);
      return;
    }
    local.ref?.(null);
  };

  onCleanup(() => {
    local.ref?.(null);
  });

  createEffect(
    () => ({
      host: hostNode(),
      st: sheetStyle(),
      points: local.snapPoints ?? (local.dynamicContentHeight ? [] : DEFAULT_SNAP_POINTS),
      initIndex: local.initialSnapIndex ?? 0,
      ovColor: local.overlayColor,
      ovOpacity: local.overlayOpacity,
      disOverlay: local.dismissOnOverlayPress,
      allowBg: local.allowBackgroundInteraction,
      allowDismiss: local.allowDismissOnInteraction,
      dynHeight: !!local.dynamicContentHeight,
      heightHint: contentHeightHint(),
      testId: local.testID,
      nextOpen: resolvedOpen(),
      lastOpen: lastSentOpen(),
    }),
    (cfg) => {
      const { host } = cfg;
      if (!host) return;
      setProperty(host, "style", cfg.st);
      setProperty(host, "snapPoints", cfg.points);
      if (!cfg.nextOpen) {
        setProperty(host, "initialSnapIndex", cfg.initIndex);
      }
      if (cfg.ovColor != null) setProperty(host, "overlayColor", cfg.ovColor);
      if (cfg.ovOpacity != null) setProperty(host, "overlayOpacity", cfg.ovOpacity);
      if (cfg.disOverlay != null) setProperty(host, "dismissOnOverlayPress", cfg.disOverlay);
      if (cfg.allowBg != null) setProperty(host, "allowBackgroundInteraction", cfg.allowBg);
      if (cfg.allowDismiss != null) setProperty(host, "allowDismissOnInteraction", cfg.allowDismiss);
      setProperty(host, "dynamicContentHeight", cfg.dynHeight);
      setProperty(host, "contentHeightHint", cfg.dynHeight ? cfg.heightHint : null);
      if (cfg.testId) setProperty(host, "testID", cfg.testId);

      if (cfg.nextOpen !== cfg.lastOpen) {
        if (cfg.nextOpen) {
          ignoreCloseUntil = Date.now() + 700;
          hasConfirmedOpen = false;
          sendCommand(host, { type: "open", index: cfg.initIndex });
        } else if (cfg.lastOpen === true) {
          sendCommand(host, { type: "close" });
        }
        setLastSentOpen(cfg.nextOpen);
      }
    }
  );

  createEffect(
    () => hostNode(),
    (host) => {
      if (!host) return;

      const handleSnap = (payload?: { index?: number; progress?: number }) => {
        if (!payload) return;
        const index =
          typeof payload.index === "number" && Number.isFinite(payload.index)
            ? payload.index
            : currentIndex;
        const progress =
          typeof payload.progress === "number" && Number.isFinite(payload.progress)
            ? payload.progress
            : 0;
        currentIndex = index;
        local.onSnapChange?.({ index, progress });
      };

      setProperty(host, "onSnapChange", handleSnap);

      const handleDismiss = () => {
        if (!isControlled()) {
          setUncontrolledOpen(false);
        }
        local.onDismiss?.();
      };

      setProperty(host, "onDismiss", handleDismiss);

      setProperty(host, "onOpenChange", (payload: { open: boolean }) => {
        const next = !!payload?.open;
        if (!isControlled()) {
          if (next) {
            hasConfirmedOpen = true;
          } else if (!hasConfirmedOpen) {
            return;
          }
          if (!next && Date.now() < ignoreCloseUntil) {
            return;
          }
          setUncontrolledOpen(next);
        }
        local.onOpenChange?.(next);
      });
    }
  );

  const sheetNode = () => (
    <zynth-bottom-sheet ref={attachHost} style={sheetStyle()}>
      {useWindowWrapper() ? (
        <View style={contentWrapperStyle()} pointerEvents="box-none">
          <View style={contentStyle()} onLayout={handleContentLayout}>
            {local.children}
            <View
              pointerEvents="box-none"
              style={{
                justifyContent: "center",
                width: "100%",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
              }}
            >
              <View
                pointerEvents="none"
                style={{
                  width: 40,
                  height: 6,
                  backgroundColor: "#ccc",
                  borderRadius: 2,
                  alignSelf: "center",
                  marginTop: 8,
                }}
              />
            </View>
          </View>
        </View>
      ) : (
        <View style={contentStyle()} onLayout={handleContentLayout}>
          {local.children}
        </View>
      )}
    </zynth-bottom-sheet>
  );

  if (useSurfacePortal() && portalSurfaceId != null) {
    createEffect(
      () => portalSurfaceId,
      (surfaceId) => {
        runWithSurface(surfaceId, () => undefined);
        const dispose = render(
          () => runWithSurface(surfaceId, () => sheetNode()),
          { id: surfaceId, type: "root" } as HostNode,
        );
        onCleanup(() => {
          dispose();
        });
      }
    );

    return (
      <View
        pointerEvents="none"
        style={{ width: 0, height: 0, position: "absolute", top: 0, left: 0 }}
      />
    );
  }

  return sheetNode();
};
