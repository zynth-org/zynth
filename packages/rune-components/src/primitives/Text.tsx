import type { ParentComponent } from "solid-js";
import type { Style } from "@rune/core";

export interface TextProps {
  style?: Style;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const { style, children } = props;
  return <text style={style as any}>{children}</text>;
};
