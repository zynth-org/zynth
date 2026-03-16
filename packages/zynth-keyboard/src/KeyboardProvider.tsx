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
  const [nativeModule, setNativeModule] = createSignal(getNativeKeyboardModule());
  const [didWarnMissingModule, setDidWarnMissingModule] = createSignal(false);

  // Initialize with current state from native
  const getInitialState = (): KeyboardState => {
    const module = nativeModule();
    if (module) {
      return module.getState();
    }
    return DEFAULT_KEYBOARD_STATE;
  };

  const [state, setState] = createSignal<KeyboardState>(getInitialState());

  // Retry module resolution briefly to avoid startup race warnings.
  createEffect(() => {
    if (nativeModule()) return;

    const warnDelayMs = 5000;
    const pollTimer = setInterval(() => {
      const resolved = getNativeKeyboardModule();
      if (resolved) {
        clearInterval(pollTimer);
        setNativeModule(resolved);
        setState(resolved.getState());
      }
    }, 50);

    const warnTimer = setTimeout(() => {
      if (!nativeModule() && !didWarnMissingModule()) {
        console.warn(
          "[KeyboardProvider] Native keyboard module not found. " +
            "Keyboard state will show as hidden. " +
            "Make sure the native platform has initialized the module."
        );
        setDidWarnMissingModule(true);
      }
    }, warnDelayMs);

    onCleanup(() => {
      clearInterval(pollTimer);
      clearTimeout(warnTimer);
    });
  });

  // Subscribe to native keyboard changes
  createEffect(() => {
    const module = nativeModule();
    if (!module) {
      return;
    }

    setState(module.getState());

    const unsubscribe = module.addChangeListener((newState) => {
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
