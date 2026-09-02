import {
  TextInput as NativeTextInput,
  type TextInputProps as NativeTextInputProps,
  View,
  Text,
} from "@zynthjs/components";
import { createMemo, createSignal, omit, type Element, type ParentComponent } from "solid-js";
import { useUITheme } from "../hooks";
import type { StyleProp } from "@zynthjs/core";

export interface TextInputProps extends NativeTextInputProps {
  label?: string;
  error?: string;
  variant?: "outlined" | "filled" | "ghost";
  tone?: "default" | "success" | "warning" | "danger";
  startContent?: Element;
  endContent?: Element;
}

export const TextInput: ParentComponent<TextInputProps> = (props) => {
  const rest = omit(props, [
    "style",
    "label",
    "error",
    "variant",
    "tone",
    "startContent",
    "endContent",
    "onFocus",
    "onBlur",
  ]);
  const theme = useUITheme();
  const [isFocused, setIsFocused] = createSignal(false, { ownedWrite: true });

  const resolvedStyle = createMemo<StyleProp>(() => {
    const t = theme();
    const userStyle = typeof props.style === "function" ? props.style() : props.style;

    return {
      flex: 1,
      color: t.colors.text,
      fontSize: t.typography.fontSizes.md,
      fontFamily: t.typography.fontFamily,
      padding: 0,
      backgroundColor: "transparent",
      ...((userStyle as object) ?? {}),
    };
  });

  const containerStyle = createMemo<StyleProp>(() => {
    const t = theme();
    const variant = props.variant ?? "outlined";
    const tone = props.error ? "danger" : (props.tone ?? "default");

    const base: Record<string, unknown> = {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: t.radii.md,
      paddingHorizontal: t.spacing.md,
      minHeight: t.sizes.controlMd,
      gap: t.spacing.sm,
      width: "100%",
      alignContent: "space-between",
    };

    let borderColor = t.colors.border;
    let backgroundColor = "transparent";
    let borderWidth = 1;

    switch (tone) {
      case "danger":
        borderColor = t.colors.danger;
        break;
      case "success":
        borderColor = t.colors.success;
        break;
      case "warning":
        borderColor = t.colors.warning;
        break;
      case "default":
      default:
        borderColor = isFocused() ? t.colors.accent : t.colors.border;
        break;
    }

    if (variant === "outlined") {
      borderWidth = 1;
      backgroundColor = t.colors.surface;
    } else if (variant === "filled") {
      backgroundColor = t.colors.surfaceAlt;
      if (isFocused()) {
        borderWidth = 1;
      }
    } else if (variant === "ghost") {
      borderWidth = 0;
    }

    return {
      ...base,
      borderColor,
      borderWidth,
      backgroundColor,
    } as StyleProp;
  });

  const handleFocus = () => {
    setIsFocused(true);
    props.onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    props.onBlur?.();
  };

  return (
    <View style={{ gap: theme().spacing.xs }}>
      {props.label && (
        <Text
          style={{
            fontSize: theme().typography.fontSizes.sm,
            fontWeight: theme().typography.fontWeights.medium,
            color: props.error
              ? theme().colors.danger
              : theme().colors.textMuted,
            marginLeft: theme().spacing.xs,
          }}
        >
          {props.label}
        </Text>
      )}

      <View style={containerStyle()}>
        {props.startContent}
        <NativeTextInput
          style={resolvedStyle()}
          placeholderTextColor={theme().colors.textMuted}
          selectionColor={theme().colors.accent}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...rest}
        />
        {props.endContent}
      </View>

      {props.error && (
        <Text
          style={{
            fontSize: theme().typography.fontSizes.xs,
            color: theme().colors.danger,
            marginLeft: theme().spacing.xs,
          }}
        >
          {props.error}
        </Text>
      )}
    </View>
  );
};
