import { children as resolveChildren, createSignal, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export interface GlassContainerProps {
  style?: StyleProp;
  children?: JSX.Element;
  spacing?: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
  ref?: (node: HostNode | null) => void;
}

export const GlassContainer: ParentComponent<GlassContainerProps> = (props) => {
  const [local] = splitProps(props, [
    "style",
    "children",
    "spacing",
    "pointerEvents",
    "testID",
    "ref",
  ]);
  const resolvedChildren = resolveChildren(() => local.children);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <glass-container
      style={undefined}
      spacing={local.spacing}
      pointerEvents={local.pointerEvents}
      testID={local.testID}
      ref={refProp}
    >
      {resolvedChildren()}
    </glass-container>
  );
};
