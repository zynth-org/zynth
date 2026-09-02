import { createContext, useContext, createSignal, createEffect, createMemo, untrack, type Component, type Element } from "solid-js";
import { Pressable, View, Text } from "@zynthjs/components";
import { useUITheme } from "../hooks";
import type { Style } from "@zynthjs/core";

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
  children?: Element;
  style?: Style;
}

export const Radio: Component<RadioGroupProps> = (props) => {
  const [selected, setSelected] = createSignal<RadioValue | undefined>(
    untrack(() => props.value ?? props.defaultValue),
    { ownedWrite: true },
  );

  createEffect(
    () => props.value,
    (val) => {
      if (val !== undefined) {
        setSelected(val);
      }
    },
  );

  const handleChange = (value: RadioValue) => {
    if (props.disabled) return;
    if (untrack(() => props.value) === undefined) {
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

  const containerStyle = createMemo(() => {
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    return userStyle as object | undefined;
  });

  return (
    <RadioContext value={ctx}>
      <View style={containerStyle()}>{props.children}</View>
    </RadioContext>
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
  const theme = useUITheme();
  const ctx = useContext(RadioContext);

  const isDisabled = createMemo(() => props.disabled || ctx?.disabled?.() || false);
  const isChecked = createMemo(() => ctx?.selected?.() === props.value);

  const diameter = createMemo(() => props.size ?? ctx?.size?.() ?? 20);
  const inner = createMemo(() => Math.max(8, Math.floor(diameter() * 0.55)));
  const accent = createMemo(() => props.color ?? ctx?.color?.() ?? theme().colors.accent);

  const labelFirst = createMemo(() => (props.labelPosition ?? "right") === "left");

  const toggle = () => {
    if (isDisabled()) return;
    ctx?.setSelected?.(props.value);
  };

  const containerStyle = createMemo(() => {
    const userStyle = typeof props.style === "function" ? props.style() : props.style;
    return {
      gap: theme().spacing.xs,
      ...((userStyle as object) ?? {}),
    };
  });

  return (
    <View style={containerStyle()}>
      <Pressable
        onPress={toggle}
        disabled={isDisabled()}
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
              color: isDisabled() ? theme().colors.textSubtle : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
            }}
            numberOfLines={1}
          >
            {props.label}
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

        {!labelFirst() && props.label ? (
          <Text
            style={{
              color: isDisabled() ? theme().colors.textSubtle : theme().colors.text,
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
            marginLeft: 0,
          }}
        >
          {props.helperText}
        </Text>
      ) : null}
    </View>
  );
};
