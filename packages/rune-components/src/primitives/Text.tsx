import { children as resolveChildren } from "solid-js";
import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@rune/core";
import { getVirtualListRecorder } from "./virtual-list-recorder";

export interface TextProps {
  style?: Style;
  numberOfLines?: number;
}

export const Text: ParentComponent<TextProps> = (props) => {
  const resolvedChildren = resolveChildren(() => props.children);
  const templateRecorder = getVirtualListRecorder();
  if (templateRecorder) {
    const value = resolvedChildren();
    const childArray = Array.isArray(value) ? value : [value];
    return templateRecorder.createText({
      style: props.style,
      numberOfLines: props.numberOfLines,
      children: childArray,
    }) as unknown as JSX.Element;
  }
  return <text style={props.style as any}>{resolvedChildren()}</text>;
};
