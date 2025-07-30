import { createMemo, type JSX, type ParentComponent } from "solid-js";
import { View } from "@rune/components";
import type { Style } from "@rune/core";
import { useKeyboard } from "./hooks";

export interface KeyboardStickyViewProps {
  /**
   * Additional offset from the keyboard (in dp)
   * Positive values move the view higher above the keyboard
   * @default 0
   */
  offset?: number;

  /**
   * Style to apply to the view
   */
  style?: Style;

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
 * A view that stays pinned above the keyboard when it appears.
 * Perfect for toolbars, send buttons, or any UI that should
 * float above the keyboard.
 *
 * This component uses a pure JS approach with Solid reactivity
 * to translate the view upward when the keyboard appears.
 *
 * @example
 * ```tsx
 * <View style={{ flex: 1 }}>
 *   <ScrollView>{content}</ScrollView>
 *   <KeyboardStickyView>
 *     <View style={{ flexDirection: 'row', padding: 8 }}>
 *       <TextInput style={{ flex: 1 }} />
 *       <Button title="Send" />
 *     </View>
 *   </KeyboardStickyView>
 * </View>
 * ```
 */
export const KeyboardStickyView: ParentComponent<KeyboardStickyViewProps> = (
  props
) => {
  const keyboard = useKeyboard();
  const userOffset = () => props.offset ?? 0;
  
  // Compute the translation based on keyboard height
  const stickyStyle = createMemo((): Style => {
    const state = keyboard();
    const baseStyle = props.style ?? {};
    
    if (!state.isVisible) {
      return baseStyle;
    }
    
    // Translate upward by keyboard height + offset
    const translation = state.height + userOffset();
    return {
      ...baseStyle,
      transform: `translateY(${-translation}px)`,
    };
  });
  
  return (
    <View style={stickyStyle()} testID={props.testID}>
      {props.children}
    </View>
  );
};
