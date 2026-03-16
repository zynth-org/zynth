import { splitProps, type Component } from "solid-js";
import type { Style } from "@zynth/core";

export interface SwitchProps {
  /** Whether the switch is on. Controlled. */
  value?: boolean;
  /** Callback when the switch value changes. */
  onValueChange?: (value: boolean) => void;
  /** Whether the switch is disabled. */
  disabled?: boolean;
  /** The color of the switch track. Can be a single color string or an object with false/true states. */
  trackColor?: string | { false?: string; true?: string };
  /** The color of the switch thumb. Can be a single color string or an object with false/true states. */
  thumbColor?: string | { false?: string; true?: string };
  /** Additional style for the container. */
  style?: Style;
  /** Test ID for testing frameworks. */
  testID?: string;
}

type SwitchEvent = {
  target: number;
  value: boolean;
};

export const Switch: Component<SwitchProps> = (props) => {
  const [local] = splitProps(props, [
    "value",
    "onValueChange",
    "disabled",
    "trackColor",
    "thumbColor",
    "style",
    "testID",
  ]);

  // Wrap the callback to extract the value from the native event
  const handleValueChange = (value: boolean | SwitchEvent) => {
    const next =
      typeof value === "object" && value !== null ? value.value : Boolean(value);
    local.onValueChange?.(next);
  };

  return (
    <switch-view
      value={local.value ?? false}
      onValueChange={
        local.onValueChange ? ((value: boolean) => handleValueChange(value)) : undefined
      }
      disabled={local.disabled ?? false}
      trackColor={local.trackColor}
      thumbColor={local.thumbColor}
      style={local.style}
      testID={local.testID}
    />
  );
};
