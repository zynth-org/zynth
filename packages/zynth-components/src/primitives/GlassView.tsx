import { children as resolveChildren, createSignal, splitProps } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { StyleProp, HostNode } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export type GlassEffectStyle = "regular" | "clear" | "none";

export interface GlassViewProps {
  style?: StyleProp;
  children?: JSX.Element;
  effect?: GlassEffectStyle;
  interactive?: boolean;
  tintColor?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  testID?: string;
  ref?: (node: HostNode | null) => void;
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
    <glass-view
      style={undefined}
      glassEffect={local.effect}
      interactive={local.interactive ?? true}
      tintColor={local.tintColor}
      pointerEvents={local.pointerEvents}
      testID={local.testID}
      ref={refProp}
    >
      {resolvedChildren()}
    </glass-view>
  );
};
