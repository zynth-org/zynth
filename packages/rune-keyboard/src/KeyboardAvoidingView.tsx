import { createMemo, type JSX, type ParentComponent } from "solid-js";
import { Platform, OS } from "@rune/apis";
import { View } from "@rune/components";
import type { Style } from "@rune/core";
import { useKeyboard } from "./hooks";

export type KeyboardAvoidingBehavior = "padding" | "position" | "height";

export interface KeyboardAvoidingViewProps {
  /**
   * Specifies how the view adjusts when the keyboard appears.
   * - `padding`: Adds bottom padding equal to keyboard height (default)
   * - `position`: Translates the view upward
   * - `height`: Reduces the view's height
   */
  behavior?: KeyboardAvoidingBehavior;

  /**
   * Additional offset to add to the keyboard height (in dp)
   * @default 0
   */
  keyboardVerticalOffset?: number;

  /**
   * Whether keyboard avoidance is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Style to apply to the view
   */
  style?: Style;

  /**
   * Content container style (only used when behavior is "height")
   */
  contentContainerStyle?: Style;

  /**
   * Children to render
   */
  children?: JSX.Element;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * A view that automatically adjusts its layout when the keyboard appears.
 * Use this to prevent the keyboard from covering your content.
 *
 * This component uses a pure JS approach with Solid reactivity to ensure
 * proper integration with Yoga layout.
 *
 * Behaviors:
 * - `padding`: Adds bottom padding equal to keyboard height (default)
 * - `position`: Translates the view upward (content may go off-screen)
 * - `height`: Reduces available space, causing flex children to compress
 *
 * @example
 * ```tsx
 * <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
 *   <TextInput placeholder="Type here..." />
 * </KeyboardAvoidingView>
 * ```
 */
export const KeyboardAvoidingView: ParentComponent<
  KeyboardAvoidingViewProps
> = (props) => {
  if (Platform.OS === OS.ANDROID) {
    return (
      <rune-keyboard-avoiding-view
        style={props.style}
        behavior={props.behavior ?? "padding"}
        keyboardVerticalOffset={props.keyboardVerticalOffset ?? 0}
        enabled={props.enabled ?? true}
        testID={props.testID}
        data-testid={props.testID}
      >
        {props.children}
      </rune-keyboard-avoiding-view>
    );
  }

  const keyboard = useKeyboard();

  const behavior = () => props.behavior ?? "padding";
  const enabled = () => props.enabled ?? true;
  const offset = () => props.keyboardVerticalOffset ?? 0;

  // Calculate the keyboard adjustment value
  const keyboardAdjustment = createMemo(() => {
    if (!enabled()) return 0;
    const state = keyboard();
    if (!state.isVisible) return 0;
    return state.height + offset();
  });

  // For "height" behavior, we render differently
  const isHeightBehavior = () => behavior() === "height";

  // Compute the outer container style based on behavior
  const containerStyle = createMemo((): Style => {
    const adjustment = keyboardAdjustment();
    const baseStyle = props.style ?? {};

    switch (behavior()) {
      case "padding":
        // Add bottom padding to push content up
        return {
          ...baseStyle,
          paddingBottom:
            ((baseStyle.paddingBottom as number) ?? 0) + adjustment,
        };

      case "position":
        // Translate the view upward
        return {
          ...baseStyle,
          transform:
            adjustment > 0 ? `translateY(${-adjustment}px)` : undefined,
        };

      case "height":
        // For height behavior, we use the base style on outer container
        // and apply the height reduction on an inner wrapper
        return baseStyle;

      default:
        return baseStyle;
    }
  });

  // Inner content wrapper style for "height" behavior
  // This view takes flex:1 minus the keyboard height via marginBottom
  const heightContentStyle = createMemo((): Style => {
    const adjustment = keyboardAdjustment();
    return {
      flex: 1,
      marginBottom: adjustment,
      ...(props.contentContainerStyle ?? {}),
    };
  });

  return (
    <View style={containerStyle()} testID={props.testID}>
      {isHeightBehavior() ? (
        <View style={heightContentStyle()}>{props.children}</View>
      ) : (
        props.children
      )}
    </View>
  );
};
