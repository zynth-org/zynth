import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, Style } from "@rune/core";

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
  style?: Style;
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
}

const noopRef = () => {};

export const View: ParentComponent<ViewProps> = (props) => {
  const internalProps = props as ViewProps & { layout?: unknown };
  const [local] = splitProps(internalProps, [
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
  const resolvedPointer = local.pointerEvents ?? "auto";
  const pressHandlers: Record<string, (() => void) | undefined> = {
    onPress: local.onPress,
  };
  const shouldEnablePress = resolvedPointer !== "none";
  const appliedPressHandlers = shouldEnablePress ? pressHandlers : {};
  const refProp = local.ref ?? noopRef;
  return (
    <view
      style={local.style as any}
      layout={local.layout as any}
      onPress={appliedPressHandlers.onPress}
      accessibilityLabel={local.accessibilityLabel}
      accessibilityHint={local.accessibilityHint}
      accessibilityRole={local.accessibilityRole}
      pointerEvents={local.pointerEvents}
      enableGlassIOS={local.enableGlassIOS ?? false}
      tintColor={local.tintColor}
      onLayout={local.onLayout}
      testID={local.testID}
      ref={refProp}
    >
      {resolvedChildren()}
    </view>
  );
};
