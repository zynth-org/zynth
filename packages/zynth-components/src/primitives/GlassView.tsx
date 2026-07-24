import { children as resolveChildren } from "solid-js";
import type { Element as SolidElement, ParentComponent } from "solid-js";
import type { Style } from "@zynthjs/core";
import { platform } from "@zynthjs/apis";

export type GlassEffectStyle = "regular" | "clear" | "none";

export interface GlassViewProps {
  style?: Style;
  children?: SolidElement;
  effect?: GlassEffectStyle;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const GlassView: ParentComponent<GlassViewProps> = (props) => {
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
