import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

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
  testID?: string;
  key?: string | number;
}

export const View: ParentComponent<ViewProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "onPress",
    "accessibilityLabel",
    "accessibilityHint",
    "accessibilityRole",
    "pointerEvents",
    "testID",
    "onLayout",
  ]);
  const resolvedChildren = resolveChildren(() => props.children);
  const resolvedPointer = local.pointerEvents ?? "auto";
  const pressHandlers: Record<string, (() => void) | undefined> = {
    onPress: local.onPress,
  };
  const shouldEnablePress = resolvedPointer !== "none";
  const appliedPressHandlers = shouldEnablePress ? pressHandlers : {};

  return (
    <view
      style={local.style as any}
      onPress={appliedPressHandlers.onPress}
      accessibilityLabel={local.accessibilityLabel}
      accessibilityHint={local.accessibilityHint}
      accessibilityRole={local.accessibilityRole}
      pointerEvents={local.pointerEvents}
      onLayout={local.onLayout}
      testID={local.testID}
    >
      {resolvedChildren()}
    </view>
  );
};
