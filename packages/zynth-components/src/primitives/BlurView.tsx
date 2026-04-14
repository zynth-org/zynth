import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";

export type BlurViewTint = "default" | "light" | "dark";
export type BlurViewVariant = "blur" | "glass";

export interface BlurViewProps {
  style?: Style;
  children?: JSX.Element;
  intensity?: number;
  tint?: BlurViewTint;
  variant?: BlurViewVariant;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
}

export const BlurView: ParentComponent<BlurViewProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "intensity",
    "tint",
    "variant",
    "interactive",
    "tintColor",
    "pointerEvents",
    "testID",
  ]);
  const resolvedChildren = resolveChildren(() => local.children);

  return (
    <blur-view
      style={local.style as any}
      blurIntensity={local.intensity}
      blurTint={local.tint}
      blurVariant={local.variant}
      interactive={local.interactive ?? false}
      tintColor={local.tintColor}
      pointerEvents={local.pointerEvents}
      testID={local.testID}
    >
      {resolvedChildren()}
    </blur-view>
  );
};
