import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";
import { platform } from "@zynth/apis";

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

  if (platform.current === "android") {
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
