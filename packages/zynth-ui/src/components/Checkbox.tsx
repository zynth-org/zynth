import { createEffect, createMemo, createSignal, untrack, type Component } from "solid-js";
import { Pressable, View, Text } from "@zynthjs/components";
import { useUITheme } from "../hooks";
import type { Style } from "@zynthjs/core";

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

export const Checkbox: Component<CheckboxProps> = (props) => {
  const theme = useUITheme();
  const [internal, setInternal] = createSignal(
    untrack(() => props.value ?? false),
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

  const isChecked = createMemo(() =>
    props.value !== undefined ? props.value : internal()
  );

  const toggle = () => {
    if (props.disabled) return;
    const next = !isChecked();
    if (untrack(() => props.value) === undefined) setInternal(next);
    props.onChange?.(next);
  };

  const boxStyle = createMemo((): Style => {
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
  });

  const checkMarkStyle = createMemo((): Style => {
    const t = theme();
    return {
      width: 10,
      height: 10,
      backgroundColor: props.checkmarkColor
        ?? (props.disabled ? t.colors.surfaceAlt : t.colors.surface),
      borderRadius: 2,
    };
  });

  const containerStyle = createMemo(() => {
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    return {
      gap: theme().spacing.xs,
      ...((userStyle as object) ?? {}),
    };
  });

  const labelFirst = createMemo(() => (props.labelPosition ?? "right") === "left");

  return (
    <View style={containerStyle()}>
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
        {labelFirst() && props.label ? (
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
        {!labelFirst() && props.label ? (
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
