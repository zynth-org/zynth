import {  createSignal, onCleanup, untrack, type Component } from "solid-js";
import type { HostNode, Style } from "@zynthjs/core";
import { effect,  setProperty } from "@zynthjs/core";

export interface SliderProps {
  /** Controlled value of the slider. */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Minimum slider value. */
  minimumValue?: number;
  /** Maximum slider value. */
  maximumValue?: number;
  /** Step interval; 0 means continuous. */
  step?: number;
  /** Disable user interaction. */
  disabled?: boolean;
  /** Active track color (left side). */
  minimumTrackTintColor?: string;
  /** Inactive track color (right side). */
  maximumTrackTintColor?: string;
  /** Thumb color. */
  thumbTintColor?: string;
  /** Continuous change callback. */
  onValueChange?: (value: number) => void;
  /** Called when the user releases the thumb. */
  onSlidingComplete?: (value: number) => void;
  /** Additional style. */
  style?: Style;
  /** Testing identifier. */
  testID?: string;
  /** Rounds emitted values to this number of decimal places. Defaults to 5. */
  precision?: number;
}

type SliderEvent = {
  target: number;
  value: number;
};

const extractValue = (value: number | SliderEvent): number => {
  if (typeof value === "object" && value !== null && "value" in value) {
    return Number(value.value);
  }
  return Number(value);
};

const roundToPrecision = (value: number, precision: number) => {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export const Slider: Component<SliderProps> = (props) => {
  const local = props;

  const precision = () =>
    typeof local.precision === "number" ? local.precision : 5;

  let lastValue = untrack(
    () =>
      local.value ??
      local.defaultValue ??
      roundToPrecision(local.minimumValue ?? 0, precision()),
  );

  const wrapHandler =
    (handler?: (value: number) => void) => (value: number | SliderEvent) => {
      const nextRaw = extractValue(value);
      const nextRounded = roundToPrecision(nextRaw, precision());
      if (!Number.isFinite(nextRounded)) {
        // Fall back to the last finite value to avoid propagating NaN/Infinity
        if (Number.isFinite(lastValue)) {
          handler?.(lastValue);
        }
        return;
      }
      lastValue = nextRounded;
      handler?.(nextRounded);
    };

  const [hostNode, setHostNode] = createSignal<HostNode | null>(null, { ownedWrite: true });

  const refProp = (node: HostNode | null) => {
    if (node) {
      setProperty(node, "value", local.value ?? local.defaultValue ?? 0);
      setProperty(node, "minimumValue", local.minimumValue ?? 0);
      setProperty(node, "maximumValue", local.maximumValue ?? 1);
      setProperty(node, "step", local.step ?? 0);
      setProperty(node, "disabled", local.disabled ?? false);
      if (local.minimumTrackTintColor != null) setProperty(node, "minimumTrackTintColor", local.minimumTrackTintColor);
      if (local.maximumTrackTintColor != null) setProperty(node, "maximumTrackTintColor", local.maximumTrackTintColor);
      if (local.thumbTintColor != null) setProperty(node, "thumbTintColor", local.thumbTintColor);
      if (local.onValueChange) setProperty(node, "onValueChange", wrapHandler(local.onValueChange));
      if (local.onSlidingComplete) setProperty(node, "onSlidingComplete", wrapHandler(local.onSlidingComplete));
      if (local.style != null) setProperty(node, "style", local.style);
      if (local.testID != null) setProperty(node, "testID", local.testID);
    }
    setHostNode(node);
  };

  effect(
    () => ({
      node: hostNode(),
      value: local.value ?? local.defaultValue ?? 0,
      minimumValue: local.minimumValue ?? 0,
      maximumValue: local.maximumValue ?? 1,
      step: local.step ?? 0,
      disabled: local.disabled ?? false,
      minimumTrackTintColor: local.minimumTrackTintColor,
      maximumTrackTintColor: local.maximumTrackTintColor,
      thumbTintColor: local.thumbTintColor,
      style: local.style,
      testID: local.testID,
    }),
    ({ node, value, minimumValue, maximumValue, step, disabled, minimumTrackTintColor, maximumTrackTintColor, thumbTintColor, style, testID }) => {
      if (!node) return;
      setProperty(node, "value", value);
      setProperty(node, "minimumValue", minimumValue);
      setProperty(node, "maximumValue", maximumValue);
      setProperty(node, "step", step);
      setProperty(node, "disabled", disabled);
      if (minimumTrackTintColor != null) setProperty(node, "minimumTrackTintColor", minimumTrackTintColor);
      if (maximumTrackTintColor != null) setProperty(node, "maximumTrackTintColor", maximumTrackTintColor);
      if (thumbTintColor != null) setProperty(node, "thumbTintColor", thumbTintColor);
      if (style != null) setProperty(node, "style", style);
      if (testID != null) setProperty(node, "testID", testID);
    }
  , { scope: true });

  onCleanup(() => {
    setHostNode(null);
  });

  return (
    <slider-view ref={refProp} />
  );
};
