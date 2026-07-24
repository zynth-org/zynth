import {  createSignal, onCleanup, type Component } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

export type ProgressIndicatorSize = "small" | "large";

export interface ProgressIndicatorProps {
  /** The color of the spinner. Defaults to system gray. */
  color?: string;
  /** The size of the indicator: "small" or "large". Defaults to "small". */
  size?: ProgressIndicatorSize;
  /** Whether the indicator is animating. Defaults to true. */
  animating?: boolean;
  /** Additional style for the container. */
  style?: Style;
  /** Test ID for testing frameworks. */
  testID?: string;
}

export const ProgressIndicator: Component<ProgressIndicatorProps> = (props) => {
  const local = props;
  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      if (local.color != null) setProperty(node, "color", local.color);
      setProperty(node, "size", local.size ?? "small");
      setProperty(node, "animating", local.animating ?? true);
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.testID != null) setProperty(node, "testID", local.testID);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      color: local.color,
      size: local.size ?? "small",
      animating: local.animating ?? true,
      style: local.style,
      testID: local.testID,
    }),
    ({ node, color, size, animating, style, testID }) => {
      if (!node) return;
      if (color != null) setProperty(node, "color", color);
      setProperty(node, "size", size);
      setProperty(node, "animating", animating);
      if (style != null) setProperty(node, "style", style);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <progress-indicator ref={refProp} />
  );
};
