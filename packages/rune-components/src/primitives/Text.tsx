import { mergeProps, children as resolveChildren } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

export interface TextProps {
  style?: Style;
  numberOfLines?: number;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  return <text style={props.style as any}>{resolvedChildren()}</text>;
};
