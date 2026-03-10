import { createSignal, splitProps, type Component } from "solid-js";
import type { StyleProp, HostNode } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

export type ProgressIndicatorSize = "small" | "large";

export interface ProgressIndicatorProps {
  /** The color of the spinner. Defaults to system gray. */
  color?: string;
  /** The size of the indicator: "small" or "large". Defaults to "small". */
  size?: ProgressIndicatorSize;
  /** Whether the indicator is animating. Defaults to true. */
  animating?: boolean;
  /** Additional style for the container. */
  style?: StyleProp;
  /** Test ID for testing frameworks. */
  testID?: string;
  ref?: (node: HostNode | null) => void;
}

export const ProgressIndicator: Component<ProgressIndicatorProps> = (props) => {
  const [local] = splitProps(props, [
    "color",
    "size",
    "animating",
    "style",
    "testID",
    "ref",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <progress-indicator
      color={local.color}
      size={local.size ?? "small"}
      animating={local.animating ?? true}
      style={undefined}
      testID={local.testID}
      ref={refProp}
    />
  );
};
