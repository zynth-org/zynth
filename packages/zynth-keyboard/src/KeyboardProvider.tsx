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
import { createSharedValue, type SharedValue } from "@zynthjs/core/motion";

/**
 * Context for keyboard state
 * Returns an accessor that provides current keyboard state
 */
export const KeyboardContext = createContext<Accessor<KeyboardState>>(
  () => DEFAULT_KEYBOARD_STATE
);

export const KeyboardSharedContext = createContext<SharedValue<number>>();

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
  const initialModule = getNativeKeyboardModule();

  const [nativeModule, setNativeModule] = createSignal(initialModule);
  const [didWarnMissingModule, setDidWarnMissingModule] = createSignal(false);

  // Initialize with current state from native
  const getInitialState = (): KeyboardState => {
    const module = nativeModule();
    if (module) {
      const s = module.getState();

      return s;
    }

    return DEFAULT_KEYBOARD_STATE;
  };

  const [state, setState] = createSignal<KeyboardState>(getInitialState());
  const sharedHeight = createSharedValue<number>(getInitialState().height);

  // Retry module resolution briefly to avoid startup race warnings.
  createEffect(() => {
    if (nativeModule()) {
      return;
    }

    const warnDelayMs = 5000;
    let pollCount = 0;

    const pollTimer = setInterval(() => {
      pollCount++;
      const resolved = getNativeKeyboardModule();

      if (resolved) {
        clearInterval(pollTimer);
        setNativeModule(resolved);
        const resolvedState = resolved.getState();

        setState(resolvedState);
        // Direct assignment — bypasses native animate bridge so the SolidJS
        // signal is updated and reactive memos (kbHeight) re-run.
        sharedHeight.value = resolvedState.height;
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

    if (sharedHeight.nativeId !== undefined) {
      module.setHeightSignalId(sharedHeight.nativeId);
    } else {
    }

    const currentState = module.getState();

    setState(currentState);
    sharedHeight.value = currentState.height;

    // Track whether we have seen at least one mid-animation frame for the
    // current keyboard open gesture.  Android fires a spurious settled event
    // (isAnimating:false, duration:0) with the final height BEFORE the
    // animation starts.  Applying it immediately causes a visible jump to the
    // final position, reset to 0, then the real animation.  We suppress that
    // by only committing a settled value once an animation frame has been seen.
    let hasSeenAnimationFrame = false;

    const unsubscribe = module.addChangeListener((newState) => {
      // Only push full state updates (which re-render all KeyboardContext
      // consumers) on settled transitions — not on every animation frame.
      if (!newState.isAnimating) {
        setState(newState);
      }

      const targetHeight = newState.isVisible ? newState.height : 0;

      if (newState.isAnimating) {
        // Real animation frame — always apply and mark that animation started.
        hasSeenAnimationFrame = true;
        sharedHeight.value = targetHeight;
      } else if (hasSeenAnimationFrame || !newState.isVisible) {
        // Settled after a real animation, or keyboard genuinely closed — apply.
        hasSeenAnimationFrame = false;
        sharedHeight.value = targetHeight;
      } else {
        // Spurious pre-animation settled event (Android preview). Suppress it.
      }
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  return (
    <KeyboardSharedContext.Provider value={sharedHeight}>
      <KeyboardContext.Provider value={state}>
        {props.children}
      </KeyboardContext.Provider>
    </KeyboardSharedContext.Provider>
  );
};
