import { children as resolveChildren, splitProps } from "solid-js";
import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

export interface ViewProps {
  style?: Style;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "header" | "link" | "none";
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
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
      testID={local.testID}
    >
      {resolvedChildren()}
    </view>
  );
};
