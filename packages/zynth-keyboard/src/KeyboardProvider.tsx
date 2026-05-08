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
  console.log("[KBD:Provider] KeyboardProvider mounting");

  const initialModule = getNativeKeyboardModule();
  console.log("[KBD:Provider] getNativeKeyboardModule() at mount:", initialModule ? "FOUND" : "NULL");

  const [nativeModule, setNativeModule] = createSignal(initialModule);
  const [didWarnMissingModule, setDidWarnMissingModule] = createSignal(false);

  // Initialize with current state from native
  const getInitialState = (): KeyboardState => {
    const module = nativeModule();
    if (module) {
      const s = module.getState();
      console.log("[KBD:Provider] getInitialState from module:", JSON.stringify(s));
      return s;
    }
    console.log("[KBD:Provider] getInitialState: no module, using DEFAULT");
    return DEFAULT_KEYBOARD_STATE;
  };

  const [state, setState] = createSignal<KeyboardState>(getInitialState());
  const sharedHeight = createSharedValue<number>(getInitialState().height);

  console.log("[KBD:Provider] sharedHeight created — nativeId:", sharedHeight.nativeId ?? "undefined (no native bridge)");
  console.log("[KBD:Provider] sharedHeight initial value:", sharedHeight.value);

  // Retry module resolution briefly to avoid startup race warnings.
  createEffect(() => {
    if (nativeModule()) {
      console.log("[KBD:Provider] poll effect: module already available, skipping poll");
      return;
    }

    console.log("[KBD:Provider] poll effect: module not found yet, starting poll every 50ms");
    const warnDelayMs = 5000;
    let pollCount = 0;

    const pollTimer = setInterval(() => {
      pollCount++;
      const resolved = getNativeKeyboardModule();
      console.log(`[KBD:Provider] poll #${pollCount}: getNativeKeyboardModule() =`, resolved ? "FOUND" : "null");
      if (resolved) {
        clearInterval(pollTimer);
        setNativeModule(resolved);
        const resolvedState = resolved.getState();
        console.log("[KBD:Provider] poll: resolved module, state =", JSON.stringify(resolvedState));
        setState(resolvedState);
        // Direct assignment — bypasses native animate bridge so the SolidJS
        // signal is updated and reactive memos (kbHeight) re-run.
        sharedHeight.value = resolvedState.height;
        console.log("[KBD:Provider] poll: set sharedHeight.value =", resolvedState.height);
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
      console.log("[KBD:Provider] poll effect cleanup — clearing poll/warn timers");
      clearInterval(pollTimer);
      clearTimeout(warnTimer);
    });
  });

  // Subscribe to native keyboard changes
  createEffect(() => {
    const module = nativeModule();
    console.log("[KBD:Provider] subscribe effect — module:", module ? "FOUND" : "NULL");

    if (!module) {
      console.log("[KBD:Provider] subscribe effect: no module, aborting");
      return;
    }

    if (sharedHeight.nativeId !== undefined) {
      console.log("[KBD:Provider] subscribe effect: calling setHeightSignalId with nativeId =", sharedHeight.nativeId);
      module.setHeightSignalId(sharedHeight.nativeId);
    } else {
      console.log("[KBD:Provider] subscribe effect: nativeId is undefined — setHeightSignalId NOT called");
    }

    const currentState = module.getState();
    console.log("[KBD:Provider] subscribe effect: current module state =", JSON.stringify(currentState));
    setState(currentState);
    sharedHeight.value = currentState.height;
    console.log("[KBD:Provider] subscribe effect: set sharedHeight.value =", currentState.height);

    // Track whether we have seen at least one mid-animation frame for the
    // current keyboard open gesture.  Android fires a spurious settled event
    // (isAnimating:false, duration:0) with the final height BEFORE the
    // animation starts.  Applying it immediately causes a visible jump to the
    // final position, reset to 0, then the real animation.  We suppress that
    // by only committing a settled value once an animation frame has been seen.
    let hasSeenAnimationFrame = false;

    const unsubscribe = module.addChangeListener((newState) => {
      console.log("[KBD:Provider] >>> addChangeListener fired! newState =", JSON.stringify(newState));

      // Only push full state updates (which re-render all KeyboardContext
      // consumers) on settled transitions — not on every animation frame.
      if (!newState.isAnimating) {
        setState(newState);
        console.log("[KBD:Provider] setState called (settled)");
      }

      const targetHeight = newState.isVisible ? newState.height : 0;

      if (newState.isAnimating) {
        // Real animation frame — always apply and mark that animation started.
        hasSeenAnimationFrame = true;
        sharedHeight.value = targetHeight;
        console.log("[KBD:Provider] frame update sharedHeight.value =", targetHeight);
      } else if (hasSeenAnimationFrame || !newState.isVisible) {
        // Settled after a real animation, or keyboard genuinely closed — apply.
        hasSeenAnimationFrame = false;
        sharedHeight.value = targetHeight;
        console.log("[KBD:Provider] settled update sharedHeight.value =", targetHeight);
      } else {
        // Spurious pre-animation settled event (Android preview). Suppress it.
        console.log("[KBD:Provider] SUPPRESSED spurious pre-animation event, height =", targetHeight);
      }
    });

    console.log("[KBD:Provider] addChangeListener registered, unsubscribe fn:", typeof unsubscribe);
    onCleanup(() => {
      console.log("[KBD:Provider] subscribe effect cleanup — unsubscribing listener");
      unsubscribe();
    });
  });

  console.log("[KBD:Provider] rendering context providers");

  return (
    <KeyboardSharedContext.Provider value={sharedHeight}>
      <KeyboardContext.Provider value={state}>
        {props.children}
      </KeyboardContext.Provider>
    </KeyboardSharedContext.Provider>
  );
};
