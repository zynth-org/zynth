import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import type { {{MODULE_NAME_PASCAL}}State } from "./types";

/**
 * Context that stores the module state as an Accessor
 * This preserves SolidJS reactivity
 */
const {{MODULE_NAME_PASCAL}}Context = createContext<Accessor<{{MODULE_NAME_PASCAL}}State>>(
  () => DEFAULT_STATE
);

export { {{MODULE_NAME_PASCAL}}Context };

export interface {{MODULE_NAME_PASCAL}}ProviderProps {
  /**
   * Optional initial state (used before native constants/events arrive)
   */
  initialState?: {{MODULE_NAME_PASCAL}}State;
  
  /**
   * Children components that can access the module state
   */
  children: JSX.Element;
}

/**
 * Provider component that wires NativeConstants + ZynthNativeEmitter
 * into SolidJS state.
 *
 * Wrap your app or relevant subtree with this provider to access
 * {{MODULE_NAME_PASCAL}} state via use{{MODULE_NAME_PASCAL}}State.
 */
export const {{MODULE_NAME_PASCAL}}Provider: Component<{{MODULE_NAME_PASCAL}}ProviderProps> = (
  props
) => {
  const [state, setState] = createSignal<{{MODULE_NAME_PASCAL}}State>(
    props.initialState ?? DEFAULT_STATE
  );

  function getNativeEmitter():
    | {
        addListener(event: string, listener: (payload: unknown) => void): {
          remove(): void;
        };
      }
    | null {
    const globalObj = getGlobalObject() as {
      ZynthNativeEmitter?: {
        addListener(event: string, listener: (payload: unknown) => void): {
          remove(): void;
        };
      };
    };
    return globalObj.ZynthNativeEmitter ?? null;
  }

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

  function readFromBridge(): {{MODULE_NAME_PASCAL}}State | null {
    const globalObj = getGlobalObject();
    const bridge = (globalObj as { __modules?: unknown }).__modules as
      | { callSync?: (name: string, method: string, args?: unknown) => unknown }
      | undefined;
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

    const emitter = getNativeEmitter();
    if (!emitter) {
      return;
    }

    const subscription = emitter.addListener(
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

const DEFAULT_STATE: {{MODULE_NAME_PASCAL}}State = {
  value: 0,
  status: "idle",
  timestamp: 0,
};
