import {
  children as resolveChildren,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { HostNode, Style, StyleProp } from "@zynth/core";
import { setProperty } from "@zynth/core";
import { createStyle } from "../hooks/createStyle";

export interface TextProps {
  style?: StyleProp | (() => StyleProp | undefined);
  numberOfLines?: number;
  text?: string;
  ref?: (node: HostNode | null) => void;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  const style = createStyle(() => {
    const nextStyle = props.style;
    return typeof nextStyle === "function" ? nextStyle() : nextStyle;
  });
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  const hasStyleAccessor = typeof props.style === "function";

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    props.ref?.(node);
  };

  createEffect(() => {
    const node = hostNode();
    if (!node) return;
    if (!hasStyleAccessor) return;
    setProperty(node, "style", style() ?? {});
  });

  onCleanup(() => {
    props.ref?.(null);
  });

  return (
    <text
      style={(hasStyleAccessor ? undefined : (style() as any)) as any}
      text={props.text}
      ref={refProp as any}
    >
      {resolvedChildren()}
    </text>
  );
};
