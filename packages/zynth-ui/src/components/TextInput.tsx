import {
  TextInput as NativeTextInput,
  type TextInputProps as NativeTextInputProps,
  View,
  Text,
} from "@zynth/components";
import { type ParentComponent, splitProps, createSignal } from "solid-js";
import { useUITheme } from "../hooks";
import type { StyleProp } from "@zynth/core";

export interface TextInputProps extends NativeTextInputProps {
  label?: string;
  error?: string;
  variant?: "outlined" | "filled" | "ghost";
  tone?: "default" | "success" | "warning" | "danger";
  startContent?: any;
  endContent?: any;
}

export const TextInput: ParentComponent<TextInputProps> = (props) => {
  const [local, others] = splitProps(props, [
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
  const [isFocused, setIsFocused] = createSignal(false);

  const resolvedStyle = () => {
    const t = theme();
    const variant = local.variant ?? "outlined";
    const tone = local.error ? "danger" : (local.tone ?? "default");

    let base: StyleProp = {
      fontFamily: t.typography.fontFamily,
      fontSize: t.typography.fontSizes.md,
      color: t.colors.text,
      borderRadius: t.radii.md,
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.sm,
      minHeight: t.sizes.controlMd,
      flex: 1, // Allow text input to take available width inside container
    };

    let borderColor = t.colors.border;
    let backgroundColor = "transparent";
    let borderWidth = 0;

    // Tone logic for borders/backgrounds
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

    // Variant logic
    if (variant === "outlined") {
      borderWidth = 1;
      backgroundColor = t.colors.surface;
    } else if (variant === "filled") {
      backgroundColor = t.colors.surfaceAlt;
      if (isFocused()) {
        borderWidth = 1;
        // filled usually has an underline or slight border on focus
      }
    } else if (variant === "ghost") {
      // minimal
    }

    // Apply container-like styles to the input itself if no start/end content
    // But since we wrap in a View for start/end content, we apply most structural styles to the wrapper
    // The native input needs to reset some things to fit nicely.

    // Actually, NativeTextInput is the input itself.
    // If we want start/end content, we need a wrapper View.
    // So 'resolvedStyle' should probably be for the *wrapper*.

    return {
      // Input specific styles (text mostly)
      flex: 1,
      color: t.colors.text,
      fontSize: t.typography.fontSizes.md,
      fontFamily: t.typography.fontFamily,
      padding: 0, // Reset padding as container handles it
      backgroundColor: "transparent",
      ...((local.style as object) ?? {}),
    };
  };

  const containerStyle = () => {
    const t = theme();
    const variant = local.variant ?? "outlined";
    const tone = local.error ? "danger" : (local.tone ?? "default");

    let base: StyleProp = {
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
        // background might lighten or darken?
      }
    } else if (variant === "ghost") {
      borderWidth = 0;
    }

    return {
      ...base,
      borderColor,
      borderWidth,
      backgroundColor,
    };
  };

  const handleFocus = () => {
    setIsFocused(true);
    local.onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    local.onBlur?.();
  };

  return (
    <View style={{ gap: theme().spacing.xs }}>
      {local.label && (
        <Text
          style={{
            fontSize: theme().typography.fontSizes.sm,
            fontWeight: theme().typography.fontWeights.medium,
            color: local.error
              ? theme().colors.danger
              : theme().colors.textMuted,
            marginLeft: theme().spacing.xs,
          }}
        >
          {local.label}
        </Text>
      )}

      <View style={containerStyle()}>
        {local.startContent}
        <NativeTextInput
          style={{ ...(resolvedStyle() as any) }}
          placeholderTextColor={theme().colors.textMuted} // Default placeholder color
          selectionColor={theme().colors.accent}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...others}
        />
        {local.endContent}
      </View>

      {local.error && (
        <Text
          style={{
            fontSize: theme().typography.fontSizes.xs,
            color: theme().colors.danger,
            marginLeft: theme().spacing.xs,
          }}
        >
          {local.error}
        </Text>
      )}
    </View>
  );
};
