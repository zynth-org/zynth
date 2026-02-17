import {
  callNative,
  getGlobalObject,
  sharedNativeEventEmitter,
} from "@zynth/core";
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
    __ZYNTH_KEYBOARD__?: NativeKeyboardModule;
  }
  var NativeConstants: Record<string, unknown> | undefined;
}

/**
 * Get the native keyboard module
 * Returns null if not available
 */
const EVENT_NAME = "ZynthKeyboard:change";
const MODULE_KEY = "ZynthKeyboard";

function readNativeConstants(): KeyboardState | null {
  const globalObj = getGlobalObject();
  const constants = globalObj.NativeConstants as Record<string, unknown> | undefined;
  if (!constants) return null;
  const value = constants[MODULE_KEY];
  if (!value || typeof value !== "object") return null;
  return value as KeyboardState;
}

function getModulesBridge(): {
  call?: (name: string, method: string, args?: unknown) => Promise<unknown> | unknown;
} | null {
  const globalObj = getGlobalObject();
  const bridge = (globalObj as { __modules?: unknown }).__modules;
  if (!bridge || typeof bridge !== "object") {
    return null;
  }
  return bridge as { call?: (name: string, method: string, args?: unknown) => unknown };
}

function createEmitterModule(): NativeKeyboardModule | null {
  const initial = readNativeConstants();
  if (!initial) return null;
  let latest = initial;

  return {
    getState() {
      return latest;
    },
    isVisible() {
      return latest.isVisible;
    },
    getHeight() {
      return latest.height;
    },
    addChangeListener(listener: KeyboardChangeListener): KeyboardUnsubscribe {
      const subscription = sharedNativeEventEmitter.addListener(
        EVENT_NAME,
        (payload) => {
          if (payload && typeof payload === "object") {
            latest = payload as KeyboardState;
            listener(latest);
          }
        }
      );
      return () => subscription.remove();
    },
    dismiss() {
      void callNative("ZynthKeyboard", "dismiss", {});
    },
    _updateState(state: KeyboardState) {
      latest = state;
    },
    _nativeDismiss: null,
    _dismissRequested: undefined,
  };
}

export function getNativeKeyboardModule(): NativeKeyboardModule | null {
  const globalObj = getGlobalObject() as {
    __ZYNTH_KEYBOARD__?: NativeKeyboardModule;
  };
  if (globalObj.__ZYNTH_KEYBOARD__) {
    return globalObj.__ZYNTH_KEYBOARD__ || null;
  }
  return createEmitterModule();
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
