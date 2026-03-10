import { createSignal, splitProps, type Component } from "solid-js";
import type { StyleProp, HostNode } from "@zynth/core";
import { createStyleBinding } from "../hooks/styleBinding";

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
  style?: StyleProp;
  /** Test ID for testing frameworks. */
  testID?: string;
  ref?: (node: HostNode | null) => void;
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
    "ref",
  ]);

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null);
  createStyleBinding(hostNode, () => local.style);

  // Wrap the callback to extract the value from the native event
  const handleValueChange = (value: boolean | SwitchEvent) => {
    const next =
      typeof value === "object" && value !== null ? value.value : Boolean(value);
    local.onValueChange?.(next);
  };

  const refProp = (node: HostNode | null) => {
    setHostNode(node);
    local.ref?.(node);
  };

  return (
    <switch-view
      value={local.value ?? false}
      onValueChange={
        local.onValueChange ? ((value: boolean) => handleValueChange(value)) : undefined
      }
      disabled={local.disabled ?? false}
      trackColor={local.trackColor}
      style={undefined}
      testID={local.testID}
      ref={refProp}
    />
  );
};
