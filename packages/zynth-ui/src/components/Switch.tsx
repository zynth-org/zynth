import { Switch as NativeSwitch, View, Text } from "@zynth/components";
import { splitProps, type Component } from "solid-js";
import { useUITheme } from "../hooks";
import type { Style } from "@zynth/core";

export interface SwitchProps {
  label?: string;
  helperText?: string;
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  trackColor?: string;
  style?: Style;
  testID?: string;
}

export const Switch: Component<SwitchProps> = (props) => {
  const [local, others] = splitProps(props, [
    "label",
    "helperText",
    "style",
    "value",
    "onValueChange",
    "disabled",
    "trackColor",
    "testID",
  ]);
  const theme = useUITheme();

  return (
    <View style={{ gap: theme().spacing.xs, ...(local.style as object) }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: theme().spacing.md,
          paddingVertical: theme().spacing.sm,
          borderRadius: theme().radii.md,
          backgroundColor: theme().colors.surface,
        }}
      >
        {local.label ? (
          <Text
            style={{
              flex: 1,
              color: local.disabled
                ? theme().colors.textSubtle
                : theme().colors.text,
              fontSize: theme().typography.fontSizes.md,
              fontWeight: theme().typography.fontWeights.medium,
              marginRight: theme().spacing.sm,
            }}
            numberOfLines={1}
          >
            {local.label}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <NativeSwitch
          value={local.value}
          onValueChange={local.onValueChange}
          disabled={local.disabled}
          trackColor={local.trackColor ?? theme().colors.accent}
          testID={local.testID}
        />
      </View>
      {local.helperText ? (
        <Text
          style={{
            color: theme().colors.textMuted,
            fontSize: theme().typography.fontSizes.sm,
            marginLeft: theme().spacing.xs,
          }}
        >
          {local.helperText}
        </Text>
      ) : null}
    </View>
  );
};
