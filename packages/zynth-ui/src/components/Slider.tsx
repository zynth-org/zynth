import { createEffect, createMemo, createSignal, untrack, Show, type Component } from "solid-js";
import { Slider as PrimitiveSlider, View } from "@zynthjs/components";
import type { Style } from "@zynthjs/core";
import { useUITheme } from "../hooks";
import { Text } from "./Text";

export interface SliderProps {
  label?: string;
  helperText?: string;
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
  /** Hide the value label shown next to the title. */
  showValue?: boolean;
  /** Custom value formatter for the label. */
  formatValue?: (value: number) => string;
  /** Active track color (left side). */
  minimumTrackColor?: string;
  /** Inactive track color (right side). */
  maximumTrackColor?: string;
  /** Thumb color. */
  thumbColor?: string;
  style?: Style;
  testID?: string;
}

export const Slider: Component<SliderProps> = (props) => {
  const theme = useUITheme();

  const [internal, setInternal] = createSignal(
    untrack(() => props.value ?? props.defaultValue ?? props.min ?? 0),
    { ownedWrite: true },
  );

  createEffect(
    () => props.value,
    (val) => {
      if (val !== undefined) {
        setInternal(val);
      }
    },
  );

  const current = createMemo(() =>
    props.value !== undefined ? props.value : internal()
  );

  const precision = createMemo(() =>
    typeof props.precision === "number" ? props.precision : 5
  );

  const formatValue = (value: number) => {
    if (props.formatValue) return props.formatValue(value);
    const fixed = Number.isFinite(value) ? value.toFixed(Math.min(precision(), 6)) : "";
    return fixed;
  };

  const handleChange = (value: number) => {
    if (untrack(() => props.value) === undefined) setInternal(value);
    props.onChange?.(value);
  };

  const trackActive = createMemo(() =>
    props.minimumTrackColor ?? theme().colors.accent
  );
  const trackInactive = createMemo(() =>
    props.maximumTrackColor ?? theme().colors.borderMuted
  );
  const thumbColor = createMemo(() =>
    props.thumbColor ?? theme().colors.accent
  );

  const containerStyle = createMemo(() => {
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    return {
      gap: theme().spacing.xs,
      ...((userStyle as object) ?? {}),
    };
  });

  return (
    <View style={containerStyle()}>
      <Show when={props.label || props.showValue !== false}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Show when={props.label}>
            <Text
              style={{
                color: props.disabled ? theme().colors.textSubtle : theme().colors.text,
                fontWeight: theme().typography.fontWeights.medium,
                fontSize: theme().typography.fontSizes.md,
              }}
            >
              {props.label}
            </Text>
          </Show>
          <Show when={props.showValue !== false}>
            <Text color="subtle" style={{ fontVariant: ["tabular-nums"] }}>
              {formatValue(current())}
            </Text>
          </Show>
        </View>
      </Show>

      <PrimitiveSlider
        value={current()}
        defaultValue={props.defaultValue}
        minimumValue={props.min ?? 0}
        maximumValue={props.max ?? 1}
        step={props.step ?? 0}
        precision={precision()}
        disabled={props.disabled}
        minimumTrackTintColor={trackActive()}
        maximumTrackTintColor={trackInactive()}
        thumbTintColor={thumbColor()}
        onValueChange={handleChange}
        onSlidingComplete={handleChange}
        testID={props.testID}
        style={{ width: "100%" }}
      />

      <Show when={props.helperText}>
        <Text color="muted" style={{ fontSize: theme().typography.fontSizes.sm }}>
          {props.helperText}
        </Text>
      </Show>
    </View>
  );
};
