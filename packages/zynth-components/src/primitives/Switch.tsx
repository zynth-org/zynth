import {  createSignal, onCleanup, type Component } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

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
  const local = props;

  // Wrap the callback to extract the value from the native event
  const handleValueChange = (value: boolean | SwitchEvent) => {
    const next =
      typeof value === "object" && value !== null ? value.value : Boolean(value);
    local.onValueChange?.(next);
  };

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      setProperty(node, "value", local.value ?? false);
      if (local.onValueChange) setProperty(node, "onValueChange", (value: boolean) => handleValueChange(value));
      setProperty(node, "disabled", local.disabled ?? false);
      if (local.trackColor != null) setProperty(node, "trackColor", local.trackColor);
      if (local.thumbColor != null) setProperty(node, "thumbColor", local.thumbColor);
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.testID != null) setProperty(node, "testID", local.testID);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      value: local.value ?? false,
      disabled: local.disabled ?? false,
      trackColor: local.trackColor,
      thumbColor: local.thumbColor,
      style: local.style,
      testID: local.testID,
    }),
    ({ node, value, disabled, trackColor, thumbColor, style, testID }) => {
      if (!node) return;
      setProperty(node, "value", value);
      setProperty(node, "disabled", disabled);
      if (trackColor != null) setProperty(node, "trackColor", trackColor);
      if (thumbColor != null) setProperty(node, "thumbColor", thumbColor);
      if (style != null) setProperty(node, "style", style);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <switch-view ref={refProp} />
  );
};
