import { children as resolveChildren, createSignal } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, StyleProp } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export interface TextProps {
  style?: StyleProp | (() => StyleProp | undefined);
  numberOfLines?: number;
  text?: string;
  ref?: (node: HostNode | null) => void;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const resolveStyle = () => {
    const style = props.style;
    return typeof style === "function" ? style() : style;
  };
  createStyleBinding(hostNode, resolveStyle);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    props.ref?.(node);
  };

  return (
    <text style={undefined} text={props.text} ref={refProp}>
      {resolvedChildren()}
    </text>
  );
};
