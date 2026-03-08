import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
  type ParentComponent,
} from "solid-js";
import type { HostNode, Style } from "@zynth/core";
import {
  getActiveSurface,
  render,
  setActiveSurface,
  setProperty,
} from "@zynth/core";
import { Dimensions, Platform } from "@zynth/apis";
import { View } from "./View";

export type SnapPoint = number | `${number}%`;

export interface BottomSheetController {
  open: (index?: number) => void;
  close: () => void;
  snapTo: (index: number) => void;
  getCurrentIndex: () => number;
}

type BottomSheetCommand =
  | { type: "open"; index?: number }
  | { type: "close" }
  | { type: "snapTo"; index: number };

type InternalController = BottomSheetController & {
  __attachHost: (node: HostNode | null) => void;
  __updateIndex: (index: number) => void;
  __setOpenState?: (open: boolean) => void;
};

export interface BottomSheetProps {
  children?: JSX.Element;
  controller?: BottomSheetController;
  snapPoints?: SnapPoint[];
  initialSnapIndex?: number;
  open?: boolean;
  defaultOpen?: boolean;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  allowBackgroundInteraction?: boolean;
  allowDismissOnInteraction?: boolean;
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
  ...Platform.select({
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

const asInternalController = (
  controller?: BottomSheetController | null,
): InternalController | undefined => {
  if (
    controller &&
    typeof (controller as InternalController).__attachHost === "function"
  ) {
    return controller as InternalController;
  }
  return undefined;
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

export const createBottomSheetController = (): BottomSheetController => {
  let host: HostNode | null = null;
  let currentIndex = 0;

  const controller: InternalController = {
    open: (index) => {
      controller.__setOpenState?.(true);
      sendCommand(
        host,
        index != null ? { type: "open", index } : { type: "open" },
      );
    },
    close: () => {
      controller.__setOpenState?.(false);
      sendCommand(host, { type: "close" });
    },
    snapTo: (index) => {
      sendCommand(host, { type: "snapTo", index });
    },
    getCurrentIndex: () => currentIndex,
    __attachHost: (node) => {
      host = node;
    },
    __updateIndex: (index) => {
      currentIndex = index;
    },
  };

  return controller;
};

export const BottomSheet: ParentComponent<BottomSheetProps> = (props) => {
  const [local] = splitProps(props, [
    "children",
    "controller",
    "snapPoints",
    "initialSnapIndex",
    "open",
    "defaultOpen",
    "overlayColor",
    "overlayOpacity",
    "dismissOnOverlayPress",
    "allowBackgroundInteraction",
    "allowDismissOnInteraction",
    "style",
    "contentContainerStyle",
    "onOpenChange",
    "onSnapChange",
    "onDismiss",
    "testID",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const [lastSentOpen, setLastSentOpen] = createSignal<boolean | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(false);
  let ignoreCloseUntil = 0;
  let hasConfirmedOpen = false;
  const isControlled = () => local.open !== undefined;
  const resolvedOpen = () =>
    isControlled() ? !!local.open : uncontrolledOpen();

  const [windowSize, setWindowSize] = createSignal(Dimensions.get("window"));
  const useSurfacePortal = () => Platform.OS === "ios";
  const portalSurfaceId = useSurfacePortal()
    ? allocateBottomSheetSurfaceId()
    : null;

  createEffect(() => {
    const unsubscribe = Dimensions.observe("window", (metrics) => {
      setWindowSize(metrics);
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    if (isControlled()) return;
    if (!local.defaultOpen) return;
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        setUncontrolledOpen(true);
      });
    }, 84);
    onCleanup(() => clearTimeout(timeoutId));
  });

  const maxSnapHeight = createMemo(() => {
    const points = local.snapPoints ?? DEFAULT_SNAP_POINTS;
    const height = windowSize().height;
    let result = 0;
    for (const point of points) {
      result = Math.max(result, resolveSnapPointToDp(point, height));
    }
    return result;
  });

  const contentStyle = createMemo<Style>(() => {
    const resolvedMaxHeight = Number(maxSnapHeight());
    const style: Style = {
      ...DEFAULT_CONTENT_STYLE,
      ...local.contentContainerStyle,
    };
    if (
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
    ...Platform.select({
      ios: {},
      android: {
        width: 0,
        height: 0,
      },
      default: {},
    }),
  }));

  const contentWrapperStyle = createMemo<Style>(() => ({
    position: "absolute",
    top: 0,
    left: 0,
    width: windowSize().width,
    height: windowSize().height,
  }));
  const useWindowWrapper = () => Platform.OS === "android";

  const controller = asInternalController(local.controller);

  if (controller) {
    controller.__setOpenState = (open) => {
      if (!isControlled()) {
        setUncontrolledOpen(open);
      }
    };
  }

  const attachHost = (node: HostNode | null) => {
    setHostNode(node);
    controller?.__attachHost(node);
  };

  onCleanup(() => {
    controller?.__attachHost(null);
  });

  createEffect(() => {
    const host = hostNode();
    if (!host) return;
    setProperty(host, "style", sheetStyle());
    setProperty(host, "snapPoints", local.snapPoints ?? DEFAULT_SNAP_POINTS);
    // `initialSnapIndex` is a pre-open hint. Re-applying it while the sheet is open
    // can force UIKit to re-resolve detents mid-gesture and cause snap jitter.
    if (!resolvedOpen()) {
      setProperty(host, "initialSnapIndex", local.initialSnapIndex ?? 0);
    }
    if (local.overlayColor != null) {
      setProperty(host, "overlayColor", local.overlayColor);
    }
    if (local.overlayOpacity != null) {
      setProperty(host, "overlayOpacity", local.overlayOpacity);
    }
    if (local.dismissOnOverlayPress != null) {
      setProperty(host, "dismissOnOverlayPress", local.dismissOnOverlayPress);
    }
    if (local.allowBackgroundInteraction != null) {
      setProperty(
        host,
        "allowBackgroundInteraction",
        local.allowBackgroundInteraction,
      );
    }
    if (local.allowDismissOnInteraction != null) {
      setProperty(
        host,
        "allowDismissOnInteraction",
        local.allowDismissOnInteraction,
      );
    }
    if (local.testID) {
      setProperty(host, "testID", local.testID);
    }
    const nextOpen = resolvedOpen();
    const lastOpen = lastSentOpen();
    if (nextOpen !== lastOpen) {
      if (nextOpen) {
        ignoreCloseUntil = Date.now() + 700;
        hasConfirmedOpen = false;
        sendCommand(host, {
          type: "open",
          index: local.initialSnapIndex ?? 0,
        });
      } else if (lastOpen === true) {
        sendCommand(host, { type: "close" });
      }
      setLastSentOpen(nextOpen);
    }
  });

  createEffect(() => {
    const host = hostNode();
    if (!host) return;

    const handleSnap = (payload?: { index?: number; progress?: number }) => {
      if (!payload) return;
      const index =
        typeof payload.index === "number" && Number.isFinite(payload.index)
          ? payload.index
          : (controller?.getCurrentIndex() ?? 0);
      const progress =
        typeof payload.progress === "number" &&
        Number.isFinite(payload.progress)
          ? payload.progress
          : 0;
      controller?.__updateIndex(index);
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
  });

  const sheetNode = () => (
    <zynth-bottom-sheet ref={attachHost} style={sheetStyle()}>
      {useWindowWrapper() ? (
        <View style={contentWrapperStyle()} pointerEvents="box-none">
          <View style={contentStyle()}>
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
        <View style={contentStyle()}>{local.children}</View>
      )}
    </zynth-bottom-sheet>
  );

  if (useSurfacePortal() && portalSurfaceId != null) {
    createEffect(() => {
      const surfaceId = portalSurfaceId;
      // Ensure native surface exists before we render into it.
      runWithSurface(surfaceId, () => undefined);
      const dispose = render(
        () => runWithSurface(surfaceId, () => sheetNode()),
        { id: surfaceId, type: "root" } as HostNode,
      );
      onCleanup(() => {
        dispose();
      });
    });

    return (
      <View
        pointerEvents="none"
        style={{ width: 0, height: 0, position: "absolute", top: 0, left: 0 }}
      />
    );
  }

  return sheetNode();
};
