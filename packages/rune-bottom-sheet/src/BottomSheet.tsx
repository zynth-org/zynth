import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  splitProps,
} from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@rune/core";
import { setProperty } from "@rune/core";
import { View } from "@rune/components";
import { Dimensions } from "@rune/apis";

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
};

export interface BottomSheetProps {
  children?: JSX.Element;
  snapPoints?: SnapPoint[];
  initialSnapIndex?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  allowDismissOnInteraction?: boolean;
  allowSwipeToDismiss?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  controller?: BottomSheetController;
  style?: Style;
  contentContainerStyle?: Style;
  onOpenChange?: (open: boolean) => void;
  onSnapChange?: (payload: { index: number; progress: number }) => void;
  onSnapIndexChange?: (index: number) => void;
  onDismiss?: () => void;
  testID?: string;
}

const DEFAULT_SNAP_POINTS: SnapPoint[] = ["40%", "83%"];
const DEFAULT_SHEET_STYLE: Style = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

const DEFAULT_CONTENT_STYLE: Style = {
  padding: 16,
  gap: 12,
  backgroundColor: "#ffffff",
  borderRadius: 16,
  minHeight: 100,
  flex: 1,
};

const resolveSnapPointToDp = (
  point: SnapPoint,
  windowHeight: number
): number => {
  if (typeof point === "number") {
    return Math.max(0, point);
  }
  const numeric = Number(point.slice(0, -1));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, (numeric / 100) * windowHeight);
};

const asInternalController = (
  controller?: BottomSheetController | null
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

export const createBottomSheetController = (): BottomSheetController => {
  let host: HostNode | null = null;
  let currentIndex = 0;

  const controller: InternalController = {
    open: (index) => {
      sendCommand(
        host,
        index != null ? { type: "open", index } : { type: "open" }
      );
    },
    close: () => {
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
    "snapPoints",
    "initialSnapIndex",
    "overlayColor",
    "overlayOpacity",
    "dismissOnOverlayPress",
    "allowDismissOnInteraction",
    "allowSwipeToDismiss",
    "open",
    "defaultOpen",
    "controller",
    "style",
    "contentContainerStyle",
    "onOpenChange",
    "onSnapChange",
    "onSnapIndexChange",
    "onDismiss",
    "testID",
  ]);

  let host: HostNode | null = null;
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    local.defaultOpen ?? false
  );
  const isControlled = () => local.open !== undefined;
  const resolvedOpen = () =>
    isControlled() ? !!local.open : uncontrolledOpen();

  const [windowHeight, setWindowHeight] = createSignal(
    Dimensions.get("window").height
  );

  createEffect(() => {
    const unsubscribe = Dimensions.observe("window", (metrics) => {
      setWindowHeight(metrics.height);
    });
    onCleanup(unsubscribe);
  });

  const maxSnapHeight = createMemo(() => {
    const points = local.snapPoints ?? DEFAULT_SNAP_POINTS;
    const height = windowHeight();
    let result = 0;
    for (const point of points) {
      result = Math.max(
        result,
        resolveSnapPointToDp(point as SnapPoint, height)
      );
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
  }));

  const resolvedAllowDismissOnInteraction = () => {
    if (local.allowDismissOnInteraction != null) {
      return !!local.allowDismissOnInteraction;
    }
    if (local.allowSwipeToDismiss != null) {
      return !!local.allowSwipeToDismiss;
    }
    return true;
  };

  const controller = asInternalController(local.controller);

  const attachHost = (node: HostNode | null) => {
    host = node;
    controller?.__attachHost(node);
    if (node && resolvedOpen()) {
      setProperty(node, "open", true);
    }
  };

  onCleanup(() => {
    controller?.__attachHost(null);
  });

  createEffect(() => {
    if (!host) return;
    setProperty(host, "style", sheetStyle());
    setProperty(host, "snapPoints", local.snapPoints ?? DEFAULT_SNAP_POINTS);
    setProperty(host, "initialSnapIndex", local.initialSnapIndex ?? 0);
    if (local.overlayColor != null) {
      setProperty(host, "overlayColor", local.overlayColor);
    }
    if (local.overlayOpacity != null) {
      setProperty(host, "overlayOpacity", local.overlayOpacity);
    }
    if (local.dismissOnOverlayPress != null) {
      setProperty(host, "dismissOnOverlayPress", local.dismissOnOverlayPress);
    }
    const allowDismiss = resolvedAllowDismissOnInteraction();
    setProperty(host, "allowDismissOnInteraction", allowDismiss);
    setProperty(host, "allowSwipeToDismiss", allowDismiss);
    if (local.testID) {
      setProperty(host, "testID", local.testID);
    }
    setProperty(host, "open", resolvedOpen());
  });

  createEffect(() => {
    if (!host) return;

    const handleSnap = (payload?: { index?: number; progress?: number }) => {
      if (!payload) return;
      const index =
        typeof payload.index === "number" && Number.isFinite(payload.index)
          ? payload.index
          : controller?.getCurrentIndex() ?? 0;
      const progress =
        typeof payload.progress === "number" && Number.isFinite(payload.progress)
          ? payload.progress
          : 0;
      controller?.__updateIndex(index);
      local.onSnapIndexChange?.(index);
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
      if (!isControlled()) {
        setUncontrolledOpen(payload.open);
      }
      local.onOpenChange?.(payload.open);
    });
  });

  return (
    <rune-bottom-sheet ref={attachHost} style={sheetStyle()}>
      <View style={contentStyle()}>{local.children}</View>
    </rune-bottom-sheet>
  );
};
