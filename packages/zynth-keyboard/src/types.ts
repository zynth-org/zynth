/**
 * Keyboard state information
 */
export interface KeyboardState {
  /** Whether the keyboard is currently visible */
  isVisible: boolean;
  /** Height of the keyboard in device-independent pixels */
  height: number;
  /** Y position of the keyboard on screen (from top) */
  screenY: number;
  /** Animation duration in seconds */
  duration: number;
  /** Animation easing curve name */
  easing: "keyboard" | "easeInOut" | "easeIn" | "easeOut" | "linear";
  /** Whether the keyboard is currently animating */
  isAnimating: boolean;
}

/**
 * Keyboard change listener function type
 */
export type KeyboardChangeListener = (state: KeyboardState) => void;

/**
 * Unsubscribe function returned by addChangeListener
 */
export type KeyboardUnsubscribe = () => void;
