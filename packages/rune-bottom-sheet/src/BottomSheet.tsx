import { createEffect, createMemo, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@rune/core";
import { setProperty } from "@rune/core";
import { View } from "@rune/components";

export type SnapPoint = number | `${number}%`;

export interface BottomSheetProps {
  children?: JSX.Element;
  snapPoints?: SnapPoint[];
  initialIndex?: number;
  overlayColor?: string;
  overlayOpacity?: number;
  dismissOnOverlayPress?: boolean;
  style?: Style;
  contentContainerStyle?: Style;
  onSnapChange?: (payload: { index: number; progress: number }) => void;
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
  backgroundColor: "transparent",
};
const DEFAULT_CONTENT_STYLE: Style = {
  minHeight: 120,
  padding: 16,
  gap: 12,
  backgroundColor: "#ffffff",
  borderRadius: 16,
};

export const BottomSheet: ParentComponent<BottomSheetProps> = (props) => {
  const [local] = splitProps(props, [
    "children",
    "snapPoints",
    "initialIndex",
    "overlayColor",
    "overlayOpacity",
    "dismissOnOverlayPress",
    "style",
    "contentContainerStyle",
    "onSnapChange",
    "onDismiss",
    "testID",
  ]);

  let host: HostNode | null = null;

  const contentStyle = createMemo<Style>(() => ({
    ...DEFAULT_CONTENT_STYLE,
    ...local.contentContainerStyle,
  }));

  const sheetStyle = createMemo<Style>(() => ({
    ...DEFAULT_SHEET_STYLE,
    ...local.style,
  }));

  createEffect(() => {
    if (!host) return;
    setProperty(host, "style", sheetStyle());
    setProperty(host, "snapPoints", local.snapPoints ?? DEFAULT_SNAP_POINTS);
    setProperty(host, "initialIndex", local.initialIndex ?? 0);
    if (local.overlayColor != null) {
      setProperty(host, "overlayColor", local.overlayColor);
    }
    if (local.overlayOpacity != null) {
      setProperty(host, "overlayOpacity", local.overlayOpacity);
    }
    if (local.dismissOnOverlayPress != null) {
      setProperty(host, "dismissOnOverlayPress", local.dismissOnOverlayPress);
    }
    if (local.onSnapChange) {
      setProperty(host, "onSnapChange", local.onSnapChange);
    }
    if (local.onDismiss) {
      setProperty(host, "onDismiss", local.onDismiss);
    }
    if (local.testID) {
      setProperty(host, "testID", local.testID);
    }
  });

  const attachHost = (node: HostNode | null) => {
    host = node;
  };

  return (
    <rune-bottom-sheet ref={attachHost} style={sheetStyle()}>
      <View style={contentStyle()}>{local.children}</View>
    </rune-bottom-sheet>
  );
};
