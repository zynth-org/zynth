import {
  createSignal,
  createEffect,
  onCleanup,
  createContext,
  useContext,
  type Component,
  type JSX,
  type Accessor,
} from "solid-js";
import {
  getNativeKeyboardModule,
  DEFAULT_KEYBOARD_STATE,
} from "./NativeKeyboardModule";
import type { KeyboardState } from "./types";

/**
 * Context for keyboard state
 * Returns an accessor that provides current keyboard state
 */
export const KeyboardContext = createContext<Accessor<KeyboardState>>(
  () => DEFAULT_KEYBOARD_STATE
);

export interface KeyboardProviderProps {
  /**
   * Children to render with keyboard context
   */
  children: JSX.Element;
}

/**
 * Provides keyboard state to descendant components
 * Must wrap components that use useKeyboard()
 */
export const KeyboardProvider: Component<KeyboardProviderProps> = (props) => {
  const nativeModule = getNativeKeyboardModule();

  // Warn if no native module is available
  if (!nativeModule) {
    console.warn(
      "[KeyboardProvider] Native keyboard module not found. " +
        "Keyboard state will show as hidden. " +
        "Make sure the native platform has initialized the module."
    );
  }

  // Initialize with current state from native
  const getInitialState = (): KeyboardState => {
    if (nativeModule) {
      return nativeModule.getState();
    }
    return DEFAULT_KEYBOARD_STATE;
  };

  const [state, setState] = createSignal<KeyboardState>(getInitialState());

  // Subscribe to native keyboard changes
  createEffect(() => {
    if (!nativeModule) {
      return;
    }

    const unsubscribe = nativeModule.addChangeListener((newState) => {
      setState(newState);
    });

    onCleanup(unsubscribe);
  });

  return (
    <KeyboardContext.Provider value={state}>
      {props.children}
    </KeyboardContext.Provider>
  );
};
