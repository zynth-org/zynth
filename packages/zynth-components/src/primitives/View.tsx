import {
  children as resolveChildren,
  createEffect,
  createSignal,
  splitProps,
} from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import { setProperty } from "@zynth/core";
import { createStyle } from "../hooks/createStyle";

export type LayoutRectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutChangeEvent = {
  nativeEvent: {
    layout: LayoutRectangle;
  };
};

export interface ViewProps {
  style?: StyleProp | (() => StyleProp | undefined);
  onPress?: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  enableGlassIOS?: boolean;
  tintColor?: string;
  testID?: string;
  key?: string | number;
  ref?: (node: HostNode | null) => void;
  layout?: unknown;
}

const noopRef = () => {};

export const View: ParentComponent<ViewProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "layout",
    "onPress",
    "accessibilityLabel",
    "accessibilityHint",
    "accessibilityRole",
    "pointerEvents",
    "enableGlassIOS",
    "tintColor",
    "testID",
    "onLayout",
    "ref",
  ]);
  const resolvedChildren = resolveChildren(() => props.children);
  const resolvedStyle = createStyle(() => {
    const style = local.style;
    return typeof style === "function" ? style() : style;
  });
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const hasStyleAccessor = typeof local.style === "function";
  const resolvedPointer = local.pointerEvents ?? "auto";
  const pressHandlers: Record<string, (() => void) | undefined> = {
    onPress: local.onPress,
  };
  const shouldEnablePress = resolvedPointer !== "none";
  const appliedPressHandlers = shouldEnablePress ? pressHandlers : {};
  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    (local.ref ?? noopRef)(node);
  };

  createEffect(() => {
    if (!hasStyleAccessor) return;
    const node = hostNode();
    if (!node) return;
    const nextStyle = resolvedStyle() ?? {};
    setProperty(node, "style", nextStyle);
  });

  return (
    <view
      style={(hasStyleAccessor ? undefined : (resolvedStyle() as any)) as any}
      layout={local.layout}
      onLayout={local.onLayout}
      onPress={appliedPressHandlers.onPress}
      accessibilityLabel={local.accessibilityLabel}
      accessibilityHint={local.accessibilityHint}
      accessibilityRole={local.accessibilityRole}
      pointerEvents={local.pointerEvents}
      enableGlassIOS={local.enableGlassIOS ?? false}
      tintColor={local.tintColor}
      testID={local.testID}
      ref={refProp}
    >
      {resolvedChildren()}
    </view>
  );
};
