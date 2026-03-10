import { mergeProps, children as resolveChildren } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style, StyleProp } from "@zynth/core";
import { createStyle } from "../hooks/createStyle";

export interface TextProps {
  style?: StyleProp;
  numberOfLines?: number;
  text?: string;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  const style = createStyle(() => props.style);
  return (
    <text style={style()} text={props.text}>
      {resolvedChildren()}
    </text>
  );
};
