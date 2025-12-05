import { createContext, useContext, createSignal, createEffect, splitProps, type Component, JSX } from "solid-js";
import { Pressable, View, Text } from "@rune/components";
import { useUITheme } from "../hooks";
import type { Style } from "@rune/core";

type RadioValue = string | number;

type RadioContextValue = {
  selected: () => RadioValue | undefined;
  setSelected: (value: RadioValue) => void;
  disabled: () => boolean;
  size: () => number | undefined;
  color: () => string | undefined;
};

const RadioContext = createContext<RadioContextValue>();

export interface RadioGroupProps {
  value?: RadioValue;
  defaultValue?: RadioValue;
  onChange?: (value: RadioValue) => void;
  disabled?: boolean;
  size?: number;
  color?: string;
  children?: JSX.Element;
  style?: Style;
}

export const Radio: Component<RadioGroupProps> = (props) => {
  const [selected, setSelected] = createSignal<RadioValue | undefined>(props.value ?? props.defaultValue);
  createEffect(() => {
    if (props.value !== undefined) {
      setSelected(props.value);
    }
  });

  const handleChange = (value: RadioValue) => {
    if (props.disabled) return;
    if (props.value === undefined) {
      setSelected(value);
    }
    props.onChange?.(value);
  };

  const ctx: RadioContextValue = {
    selected,
    setSelected: handleChange,
    disabled: () => props.disabled ?? false,
    size: () => props.size,
    color: () => props.color,
  };

  return (
    <RadioContext.Provider value={ctx}>
      <View style={props.style as object}>{props.children}</View>
    </RadioContext.Provider>
  );
};

export interface RadioItemProps {
  value: RadioValue;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  size?: number;
  color?: string;
  labelPosition?: "left" | "right";
  style?: Style;
  testID?: string;
}

export const RadioItem: Component<RadioItemProps> = (props) => {
  const [local] = splitProps(props, [
    "value",
    "label",
    "helperText",
    "disabled",
    "size",
    "color",
    "labelPosition",
    "style",
    "testID",
  ]);
  const theme = useUITheme();
  const ctx = useContext(RadioContext);

  const isDisabled = () => local.disabled || ctx?.disabled?.() || false;
  const isChecked = () => ctx?.selected?.() === local.value;

  const diameter = () => local.size ?? ctx?.size?.() ?? 20;
  const inner = () => Math.max(8, Math.floor(diameter() * 0.55));
  const accent = () => local.color ?? ctx?.color?.() ?? theme().colors.accent;

  const labelFirst = (local.labelPosition ?? "right") === "left";

  const toggle = () => {
    if (isDisabled()) return;
    ctx?.setSelected?.(local.value);
  };

  return (
    <View style={{ gap: theme().spacing.xs, ...(local.style as object) }}>
      <Pressable
        onPress={toggle}
        disabled={isDisabled()}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: theme().spacing.sm,
        }}
        testID={local.testID}
      >
        {labelFirst && local.label ? (
          <Text
            style={{
              color: isDisabled() ? theme().colors.textSubtle : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
            }}
            numberOfLines={1}
          >
            {local.label}
          </Text>
        ) : null}

        <View
          style={{
            width: diameter(),
            height: diameter(),
            borderRadius: diameter() / 2,
            borderWidth: 1.5,
            borderColor: isDisabled() ? theme().colors.borderMuted : accent(),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isChecked() ? (
            <View
              style={{
                width: inner(),
                height: inner(),
                borderRadius: inner() / 2,
                backgroundColor: isDisabled() ? theme().colors.borderMuted : accent(),
              }}
            />
          ) : null}
        </View>

        {!labelFirst && local.label ? (
          <Text
            style={{
              color: isDisabled() ? theme().colors.textSubtle : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
            }}
            numberOfLines={1}
          >
            {local.label}
          </Text>
        ) : null}
      </Pressable>
      {local.helperText ? (
        <Text
          style={{
            color: theme().colors.textMuted,
            fontSize: theme().typography.fontSizes.sm,
            marginLeft: 0,
          }}
        >
          {local.helperText}
        </Text>
      ) : null}
    </View>
  );
};
