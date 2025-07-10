import { splitProps, type Component } from "solid-js";
import type { Style } from "@rune/core";

export interface SwitchProps {
  /** Whether the switch is on. Controlled. */
  value?: boolean;
  /** Callback when the switch value changes. */
  onValueChange?: (value: boolean) => void;
  /** Whether the switch is disabled. */
  disabled?: boolean;
  /** The color of the switch track when on. Uses system accent color by default. */
  trackColor?: string;
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
    "style",
    "testID",
  ]);

  // Wrap the callback to extract the value from the native event
  const handleValueChange = (event: SwitchEvent) => {
    local.onValueChange?.(event.value);
  };

  return (
    <switch-view
      value={local.value ?? false}
      onValueChange={local.onValueChange ? handleValueChange : undefined}
      disabled={local.disabled ?? false}
      trackColor={local.trackColor}
      style={local.style}
      testID={local.testID}
    />
  );
};
