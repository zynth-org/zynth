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
  const {
    style,
    onPress,
    children,
    accessibilityLabel,
    accessibilityHint,
    accessibilityRole,
    pointerEvents,
    testID,
  } = props;
  return (
    <view
      style={style as any}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole}
      pointerEvents={pointerEvents}
      testID={testID}
    >
      {children}
    </view>
  );
};
