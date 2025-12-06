import { splitProps, type Component } from "solid-js";
import type { Style } from "@rune/core";

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
  const [local] = splitProps(props, [
    "value",
    "defaultValue",
    "minimumValue",
    "maximumValue",
    "step",
    "disabled",
    "minimumTrackTintColor",
    "maximumTrackTintColor",
    "thumbTintColor",
    "onValueChange",
    "onSlidingComplete",
    "style",
    "testID",
    "precision",
  ]);

  const precision = () =>
    typeof local.precision === "number" ? local.precision : 5;

  let lastValue =
    local.value ??
    local.defaultValue ??
    roundToPrecision(local.minimumValue ?? 0, precision());

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

  return (
    <slider-view
      value={local.value ?? local.defaultValue ?? 0}
      minimumValue={local.minimumValue ?? 0}
      maximumValue={local.maximumValue ?? 1}
      step={local.step ?? 0}
      disabled={local.disabled ?? false}
      minimumTrackTintColor={local.minimumTrackTintColor}
      maximumTrackTintColor={local.maximumTrackTintColor}
      thumbTintColor={local.thumbTintColor}
      onValueChange={
        local.onValueChange ? wrapHandler(local.onValueChange) : undefined
      }
      onSlidingComplete={
        local.onSlidingComplete
          ? wrapHandler(local.onSlidingComplete)
          : undefined
      }
      style={local.style}
      testID={local.testID}
    />
  );
};
