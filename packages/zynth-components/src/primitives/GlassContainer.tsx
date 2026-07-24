import { children as resolveChildren } from "solid-js";
import type { Element as SolidElement, ParentComponent } from "solid-js";
import type { Style } from "@zynthjs/core";
import { platform } from "@zynthjs/apis";

export interface GlassContainerProps {
  style?: Style;
  children?: SolidElement;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassContainer: ParentComponent<GlassContainerProps> = (props) => {
  const local = props;
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
