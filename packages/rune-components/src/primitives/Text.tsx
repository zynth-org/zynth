import { mergeProps, children as resolveChildren } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style, StyleProp } from "@rune/core";
import { useStyle } from "../hooks/useStyle";

export interface TextProps {
  style?: StyleProp;
  numberOfLines?: number;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  const style = useStyle(() => props.style);
  return <text style={style()}>{resolvedChildren()}</text>;
};
