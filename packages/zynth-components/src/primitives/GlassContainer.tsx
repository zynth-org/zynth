import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";
import { OS, Platform } from "@zynth/apis";

export interface GlassContainerProps {
  style?: Style;
  children?: JSX.Element;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassContainer: ParentComponent<GlassContainerProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "spacing",
    "pointerEvents",
    "testID",
  ]);
  const resolvedChildren = resolveChildren(() => local.children);

  if (Platform.OS === OS.ANDROID) {
    return (
      <view
        style={local.style as any}
        pointerEvents={local.pointerEvents}
        testID={local.testID}
      >
        {resolvedChildren()}
      </view>
    );
  }

  return (
    <glass-container
      style={local.style as any}
      spacing={local.spacing}
      pointerEvents={local.pointerEvents}
      testID={local.testID}
    >
      {resolvedChildren()}
    </glass-container>
  );
};
