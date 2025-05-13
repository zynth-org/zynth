import { createEffect, createMemo, splitProps } from "solid-js";
import { setProperty } from "@rune/core";
import { View } from "@rune/components";
const DEFAULT_SNAP_POINTS = ["40%", "83%"];
const DEFAULT_SHEET_STYLE = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
};
const DEFAULT_CONTENT_STYLE = {
    minHeight: 120,
    padding: 16,
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
};
export const BottomSheet = (props) => {
    const [local] = splitProps(props, [
        "children",
        "snapPoints",
        "initialIndex",
        "overlayColor",
        "overlayOpacity",
        "dismissOnOverlayPress",
        "visible",
        "style",
        "contentContainerStyle",
        "onSnapChange",
        "onDismiss",
        "testID",
    ]);
    let host = null;
    const contentStyle = createMemo(() => ({
        ...DEFAULT_CONTENT_STYLE,
        ...local.contentContainerStyle,
    }));
    const sheetStyle = createMemo(() => ({
        ...DEFAULT_SHEET_STYLE,
        ...local.style,
    }));
    createEffect(() => {
        if (!host)
            return;
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
        setProperty(host, "visible", local.visible ?? true);
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
    const attachHost = (node) => {
        host = node;
    };
    return (<rune-bottom-sheet ref={attachHost} style={sheetStyle()}>
      <View style={contentStyle()}>{local.children}</View>
    </rune-bottom-sheet>);
};
