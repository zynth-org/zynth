import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import { sharedNativeEventEmitter } from "@rune/core";
import type { {{MODULE_NAME_PASCAL}}State } from "./types";

/**
 * Context that stores the module state as an Accessor
 * This preserves SolidJS reactivity
 */
const {{MODULE_NAME_PASCAL}}Context = createContext<Accessor<{{MODULE_NAME_PASCAL}}State>>(
  () => ({ value: 0, status: "idle", timestamp: 0 })
);

export { {{MODULE_NAME_PASCAL}}Context };

export interface {{MODULE_NAME_PASCAL}}ProviderProps {
  /**
   * Initial state from native side (useful for SSR/initial render)
   */
  initialState?: {{MODULE_NAME_PASCAL}}State;
  
  /**
   * Children components that can access the module state
   */
  children: JSX.Element;
}

/**
 * Provider component that manages module state and subscribes to native updates
 * 
 * Wrap your app or relevant subtree with this provider to enable
 * access to {{MODULE_NAME_PASCAL}} state via the use{{MODULE_NAME_PASCAL}}State hook
 * 
 * @example
 * ```tsx
 * <{{MODULE_NAME_PASCAL}}Provider initialState={initialState}>
 *   <App />
 * </{{MODULE_NAME_PASCAL}}Provider>
 * ```
 */
export const {{MODULE_NAME_PASCAL}}Provider: Component<{{MODULE_NAME_PASCAL}}ProviderProps> = (
  props
) => {
  const [state, setState] = createSignal<{{MODULE_NAME_PASCAL}}State>(
    props.initialState ?? { value: 0, status: "idle", timestamp: 0 }
  );

  function getGlobalObject(): Record<string, unknown> {
    if (typeof globalThis !== "undefined") {
      return globalThis as Record<string, unknown>;
    }
    try {
      const fallback = Function("return this")();
      if (fallback && typeof fallback === "object") {
        return fallback as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return {};
  }

  function readNativeConstants(): {{MODULE_NAME_PASCAL}}State | null {
    const globalObj = getGlobalObject();
    const constants = globalObj.NativeConstants as Record<string, unknown> | undefined;
    if (!constants) return null;
    const value = constants["{{MODULE_NAME_PASCAL}}"];
    if (!value || typeof value !== "object") return null;
    return value as {{MODULE_NAME_PASCAL}}State;
  }

  function getModulesBridge(): {
    callSync?: (name: string, method: string, args?: unknown) => unknown;
  } | null {
    const globalObj = getGlobalObject();
    const bridge = (globalObj as { __modules?: unknown }).__modules;
    if (!bridge || typeof bridge !== "object") {
      return null;
    }
    return bridge as {
      callSync?: (name: string, method: string, args?: unknown) => unknown;
    };
  }

  function readFromBridge(): {{MODULE_NAME_PASCAL}}State | null {
    const bridge = getModulesBridge();
    if (!bridge?.callSync) return null;
    try {
      const result = bridge.callSync("{{MODULE_NAME_PASCAL}}", "getCurrentState", {});
      if (!result || typeof result !== "object") return null;
      return result as {{MODULE_NAME_PASCAL}}State;
    } catch {
      return null;
    }
  }

  createEffect(() => {
    const initial = props.initialState ?? readNativeConstants() ?? readFromBridge();
    if (initial) {
      setState(initial);
    }

    const maybeRetry = () => {
      const next = readFromBridge();
      if (next) {
        setState(next);
      }
    };
    if (!initial && typeof globalThis !== "undefined") {
      const schedule = (globalThis as any).setTimeout;
      if (typeof schedule === "function") {
        schedule(maybeRetry, 0);
      } else {
        maybeRetry();
      }
    }

    const subscription = sharedNativeEventEmitter.addListener(
      "{{MODULE_NAME_PASCAL}}:change",
      (payload) => {
        if (payload && typeof payload === "object") {
          setState(payload as {{MODULE_NAME_PASCAL}}State);
        }
      }
    );

    onCleanup(() => {
      subscription.remove();
    });
  });

  return (
    <{{MODULE_NAME_PASCAL}}Context.Provider value={state}>
      {props.children}
    </{{MODULE_NAME_PASCAL}}Context.Provider>
  );
};
