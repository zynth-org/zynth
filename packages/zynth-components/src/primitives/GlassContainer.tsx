import { children as resolveChildren, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";

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
