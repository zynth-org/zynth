import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";
import { platform } from "@zynth/apis";

export type GlassEffectStyle = "regular" | "clear" | "none";

export interface GlassViewProps {
  style?: Style;
  children?: JSX.Element;
  effect?: GlassEffectStyle;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassView: ParentComponent<GlassViewProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "effect",
    "interactive",
    "tintColor",
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
    <glass-view
      style={local.style as any}
      glassEffect={local.effect}
      interactive={local.interactive ?? true}
      tintColor={local.tintColor}
      pointerEvents={local.pointerEvents}
      testID={local.testID}
    >
      {resolvedChildren()}
    </glass-view>
  );
};
