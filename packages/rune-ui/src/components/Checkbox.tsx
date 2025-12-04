import { createEffect, createSignal } from "solid-js";
import { Pressable, View, Text } from "@rune/components";
import { useUITheme } from "../hooks";
import type { Style } from "@rune/core";

export interface CheckboxProps {
  label?: string;
  helperText?: string;
  value?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  style?: Style;
  testID?: string;
  labelPosition?: "left" | "right";
  checkedColor?: string;
  uncheckedColor?: string;
  checkmarkColor?: string;
  borderColor?: string;
}

export const Checkbox = (props: CheckboxProps) => {
  const theme = useUITheme();
  const [internal, setInternal] = createSignal(props.value ?? false);

  createEffect(() => {
    if (props.value !== undefined) {
      setInternal(props.value);
    }
  });

  const isChecked = () => (props.value !== undefined ? props.value : internal());

  const toggle = () => {
    if (props.disabled) return;
    const next = !isChecked();
    if (props.value === undefined) setInternal(next);
    props.onChange?.(next);
  };

  const boxStyle = (): Style => {
    const t = theme();
    const checked = isChecked();
    const borderColor = props.borderColor
      ?? (props.disabled ? t.colors.borderMuted : t.colors.border);
    const fillColor = props.checkedColor
      ?? (props.disabled ? t.colors.borderMuted : t.colors.accent);

    return {
      width: 20,
      height: 20,
      borderRadius: t.radii.xs,
      borderWidth: 1,
      borderColor,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: checked ? fillColor : (props.uncheckedColor ?? "transparent"),
    };
  };

  const checkMarkStyle = (): Style => {
    const t = theme();
    return {
      width: 10,
      height: 10,
      backgroundColor: props.checkmarkColor
        ?? (props.disabled ? t.colors.surfaceAlt : t.colors.surface),
      borderRadius: 2,
    };
  };

  const labelPosition = props.labelPosition ?? "right";
  const labelFirst = labelPosition === "left";

  return (
    <View style={{ gap: theme().spacing.xs, ...(props.style as object) }}>
      <Pressable
        onPress={toggle}
        disabled={props.disabled}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme().spacing.sm,
        }}
        testID={props.testID}
      >
        {labelFirst && props.label ? (
          <Text
            style={{
              color: props.disabled ? theme().colors.textSubtle : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
            }}
            numberOfLines={1}
          >
            {props.label}
          </Text>
        ) : null}
        <View style={boxStyle()}>
          {isChecked() ? <View style={checkMarkStyle()} /> : null}
        </View>
        {!labelFirst && props.label ? (
          <Text
            style={{
              color: props.disabled ? theme().colors.textSubtle : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
            }}
            numberOfLines={1}
          >
            {props.label}
          </Text>
        ) : null}
      </Pressable>
      {props.helperText ? (
        <Text
          style={{
            color: theme().colors.textMuted,
            fontSize: theme().typography.fontSizes.sm,
            marginLeft: theme().spacing.xs,
          }}
        >
          {props.helperText}
        </Text>
      ) : null}
    </View>
  );
};
