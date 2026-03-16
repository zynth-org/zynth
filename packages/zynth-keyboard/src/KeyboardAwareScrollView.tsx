import type { JSX, ParentComponent } from "solid-js";
import type { Style } from "@zynth/core";
import { View } from "@zynth/components";

export interface KeyboardAwareScrollViewProps {
  /**
   * Whether scrolling is enabled
   * @default true
   */
  scrollEnabled?: boolean;

  /**
   * Whether to show vertical scroll indicator
   * @default true
   */
  showsVerticalScrollIndicator?: boolean;

  /**
   * Whether to show horizontal scroll indicator
   * @default false
   */
  showsHorizontalScrollIndicator?: boolean;

  /**
   * Whether the scroll view bounces when reaching the edge
   * @default true
   */
  bounces?: boolean;

  /**
   * Content insets for the scroll view
   */
  contentInset?: {
    top?: number;
    left?: number;
    bottom?: number;
    right?: number;
  };

  /**
   * Extra height to add when scrolling to focused input (in dp)
   * This provides padding above the keyboard for better visibility
   * @default 75
   */
  extraScrollHeight?: number;

  /**
   * Additional offset to add to the keyboard height (in dp)
   * Use this if you have a fixed header or footer
   * @default 0
   */
  keyboardVerticalOffset?: number;

  /**
   * Whether keyboard-aware behavior is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether to automatically scroll to focused text input
   * @default true
   */
  scrollToInputOnFocus?: boolean;

  /**
   * Style to apply to the scroll view container
   */
  style?: Style;

  /**
   * Style to apply to the inner content container
   */
  contentContainerStyle?: Style;

  /**
   * Children to render inside the scroll view
   */
  children?: JSX.Element;

  /**
   * Test ID for testing
   */
  testID?: string;
}

/**
 * A scroll view that automatically adjusts for keyboard appearance
 * and scrolls to keep focused inputs visible.
 *
 * This is similar to react-native-keyboard-aware-scroll-view but built
 * natively for better performance during keyboard animations.
 *
 * @example
 * ```tsx
 * <KeyboardAwareScrollView style={{ flex: 1 }}>
 *   <View style={{ padding: 16, gap: 16 }}>
 *     <TextInput placeholder="Name" />
 *     <TextInput placeholder="Email" />
 *     <TextInput placeholder="Message" multiline />
 *   </View>
 * </KeyboardAwareScrollView>
 * ```
 *
 * @example
 * With custom configuration:
 * ```tsx
 * <KeyboardAwareScrollView
 *   extraScrollHeight={100}
 *   keyboardVerticalOffset={64} // Account for header
 *   scrollToInputOnFocus={true}
 * >
 *   {children}
 * </KeyboardAwareScrollView>
 * ```
 */
export const KeyboardAwareScrollView: ParentComponent<
  KeyboardAwareScrollViewProps
> = (props) => {
  return (
    <zynth-keyboard-aware-scroll-view
      style={props.style}
      scrollEnabled={props.scrollEnabled ?? true}
      showsVerticalScrollIndicator={props.showsVerticalScrollIndicator ?? true}
      showsHorizontalScrollIndicator={
        props.showsHorizontalScrollIndicator ?? false
      }
      bounces={props.bounces ?? true}
      contentInset={props.contentInset}
      extraScrollHeight={props.extraScrollHeight ?? 75}
      keyboardVerticalOffset={props.keyboardVerticalOffset ?? 0}
      enabled={props.enabled ?? true}
      scrollToInputOnFocus={props.scrollToInputOnFocus ?? true}
      testID={props.testID}
      data-testid={props.testID}
    >
      {props.contentContainerStyle != null ? (
        <View style={props.contentContainerStyle}>{props.children}</View>
      ) : (
        props.children
      )}
    </zynth-keyboard-aware-scroll-view>
  );
};
