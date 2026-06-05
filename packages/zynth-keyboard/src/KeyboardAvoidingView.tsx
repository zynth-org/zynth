import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
  type ParentComponent,
} from "solid-js";
import { platform } from "@zynthjs/apis";
import { View } from "@zynthjs/components";
import { createAnimatedStyle, deriveAnimatedValue } from "@zynthjs/core/motion";
import { useKeyboardHeightSharedValue } from "./hooks";
import { Style } from "@zynthjs/core";

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
 *
 * This component uses high-performance native animations. When the keyboard
 * height changes on the native UI thread, a style mapper in C++ updates
 * Yoga layout properties (padding, height, or transform) and triggers a
 * synchronous layout pass + frame extraction. This ensures that children
 * are repositioned at 60fps without jumping back to the JS thread.
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
  if (platform.current === "ios") {
    return (
      <zynth-keyboard-avoiding-view
        style={props.style}
        behavior={props.behavior ?? "padding"}
        keyboardVerticalOffset={props.keyboardVerticalOffset ?? 0}
        enabled={props.enabled ?? true}
        testID={props.testID}
        data-testid={props.testID}
      >
        {props.children}
      </zynth-keyboard-avoiding-view>
    );
  }

  const enabled = () => props.enabled ?? true;
  const behavior = () => props.behavior ?? "padding";
  const offset = () => props.keyboardVerticalOffset ?? 0;
  const isHeightBehavior = () => behavior() === "height";
  const isPositionBehavior = () => behavior() === "position";

  const sharedHeight = useKeyboardHeightSharedValue();
  const [baseHeight, setBaseHeight] = createSignal<number | null>(null);

  // Helper signal to read the actual current value (not the token)
  const kbSignal = sharedHeight?.toSignal();

  /**
   * Fully native animated style.
   * When sharedHeight.value changes on the native UI thread, the mapper
   * in ZynthAnimateJSI.cpp updates Yoga properties and triggers a
   * synchronous layout pass, moving children at 60fps.
   */
  const animatedStyle = createAnimatedStyle((): Style => {
    const base: Style = props.style ?? {};
    if (!enabled()) return base;

    // Use the native-backed value for the mapper
    const kb = sharedHeight?.value ?? 0;
    const off = offset();

    if (isPositionBehavior()) {
      // translateY: -(kb + off) => kb * -1 - off
      const shift = deriveAnimatedValue(kb, { multiplier: -1, offset: -off });
      return { ...base, transform: [{ translateY: shift }] };
    }

    if (isHeightBehavior()) {
      const measured = baseHeight();
      if (measured === null || measured <= 0) return base;
      // height: measured - kb - off => kb * -1 + (measured - off)
      const nextHeight = deriveAnimatedValue(kb, {
        multiplier: -1,
        offset: measured - off,
      });

      // When animating height, we MUST override flex: 1 (if present in base style)
      // otherwise Yoga might ignore the height constraint and continue to fill the parent.
      return {
        ...base,
        flex: 0,
        flexGrow: 0,
        flexShrink: 1,
        height: nextHeight,
      };
    }

    // padding (default)
    // paddingBottom: kb + off => kb * 1 + off
    const padding = deriveAnimatedValue(kb, { offset: off });
    return { ...base, paddingBottom: padding };
  });

  const contentStyle = createMemo((): Style => ({
    flex: 1,
    ...(props.contentContainerStyle ?? {}),
  }));

  onCleanup(() => {
    setBaseHeight(null);
  });

  return (
    <View
      style={animatedStyle}
      testID={props.testID}
      onLayout={(event) => {
        const nextHeight = event.nativeEvent.layout.height;
        if (!isHeightBehavior()) return;

        // Only capture base height when keyboard is closed (kbSignal() < 1).
        // Using the signal directly ensures we get the current number, not a token.
        const isClosed = kbSignal ? kbSignal() < 1 : true;

        if (isClosed && typeof nextHeight === "number" && nextHeight > 0) {
          setBaseHeight(nextHeight);
        }
      }}
    >
      {isHeightBehavior() ? (
        <View style={contentStyle()}>{props.children}</View>
      ) : (
        props.children
      )}
    </View>
  );
};
