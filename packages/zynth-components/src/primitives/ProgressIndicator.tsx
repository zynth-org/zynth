import { type Component } from "solid-js";
import type { Style } from "@zynthjs/core";

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

  return (
    <progress-indicator
      color={local.color}
      size={local.size ?? "small"}
      animating={local.animating ?? true}
      style={local.style}
      testID={local.testID}
    />
  );
};
