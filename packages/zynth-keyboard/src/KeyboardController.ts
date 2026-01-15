import { getNativeKeyboardModule } from "./NativeKeyboardModule";
import type {
  KeyboardState,
  KeyboardChangeListener,
  KeyboardUnsubscribe,
} from "./types";

/**
 * Static keyboard controller for imperative keyboard management.
 * Use this when you don't need reactive state in the component tree.
 *
 * @example
 * ```tsx
 * import { KeyboardController } from '@zynth/keyboard';
 *
 * // Dismiss keyboard
 * KeyboardController.dismiss();
 *
 * // Check if visible
 * if (KeyboardController.isVisible()) {
 *   console.log('Keyboard is open');
 * }
 *
 * // Listen for changes
 * const unsubscribe = KeyboardController.addListener((state) => {
 *   console.log('Keyboard state changed:', state);
 * });
 * // Later: unsubscribe();
 * ```
 */
export const KeyboardController = {
  /**
   * Dismiss the keyboard
   */
  dismiss(): void {
    const module = getNativeKeyboardModule();
    if (module) {
      module.dismiss();
    }
  },

  /**
   * Check if the keyboard is currently visible
   */
  isVisible(): boolean {
    const module = getNativeKeyboardModule();
    return module?.isVisible() ?? false;
  },

  /**
   * Get the current keyboard height in dp
   */
  getHeight(): number {
    const module = getNativeKeyboardModule();
    return module?.getHeight() ?? 0;
  },

  /**
   * Get the full keyboard state
   */
  getState(): KeyboardState {
    const module = getNativeKeyboardModule();
    return (
      module?.getState() ?? {
        isVisible: false,
        height: 0,
        screenY: 0,
        duration: 0,
        easing: "keyboard",
        isAnimating: false,
      }
    );
  },

  /**
   * Add a listener for keyboard state changes
   * Returns an unsubscribe function
   */
  addListener(listener: KeyboardChangeListener): KeyboardUnsubscribe {
    const module = getNativeKeyboardModule();
    if (module) {
      return module.addChangeListener(listener);
    }
    // Return no-op unsubscribe if module not available
    return () => {};
  },
};
