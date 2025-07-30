import type {
  KeyboardState,
  KeyboardChangeListener,
  KeyboardUnsubscribe,
} from "./types";

/**
 * Native module interface for keyboard
 */
export interface NativeKeyboardModule {
  /**
   * Get current keyboard state synchronously
   */
  getState(): KeyboardState;

  /**
   * Check if keyboard is currently visible
   */
  isVisible(): boolean;

  /**
   * Get current keyboard height
   */
  getHeight(): number;

  /**
   * Add a listener for keyboard state changes
   * Returns an unsubscribe function
   */
  addChangeListener(listener: KeyboardChangeListener): KeyboardUnsubscribe;

  /**
   * Dismiss the keyboard
   */
  dismiss(): void;

  /**
   * Internal: Update state from native
   */
  _updateState(state: KeyboardState): void;

  /**
   * Internal: Native dismiss function
   */
  _nativeDismiss: (() => void) | null;

  /**
   * Internal: Dismiss request flag
   */
  _dismissRequested?: boolean;
}

/**
 * Global reference to the native keyboard module
 * Set by the native platform during initialization
 */
declare global {
  interface Window {
    __RUNE_KEYBOARD__?: NativeKeyboardModule;
  }
}

/**
 * Get the native keyboard module
 * Returns null if not available
 */
export function getNativeKeyboardModule(): NativeKeyboardModule | null {
  if (typeof globalThis === "undefined") {
    return null;
  }
  return (globalThis as any).__RUNE_KEYBOARD__ || null;
}

/**
 * Default keyboard state when native module is not available
 */
export const DEFAULT_KEYBOARD_STATE: KeyboardState = {
  isVisible: false,
  height: 0,
  screenY: 0,
  duration: 0,
  easing: "keyboard",
  isAnimating: false,
};
