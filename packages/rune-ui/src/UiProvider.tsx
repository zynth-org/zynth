import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import type { UiState } from "./types";

/**
 * Context that stores the module state as an Accessor
 * This preserves SolidJS reactivity
 */
const UiContext = createContext<Accessor<UiState>>(
  () => DEFAULT_STATE
);

export { UiContext };

export interface UiProviderProps {
  /**
   * Optional initial state (used before native constants/events arrive)
   */
  initialState?: UiState;
  
  /**
   * Children components that can access the module state
   */
  children: JSX.Element;
}

/**
 * Provider component that wires NativeConstants + RuneNativeEmitter
 * into SolidJS state.
 *
 * Wrap your app or relevant subtree with this provider to access
 * Ui state via useUiState.
 */
export const UiProvider: Component<UiProviderProps> = (
  props
) => {
  const [state, setState] = createSignal<UiState>(
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
      RuneNativeEmitter?: {
        addListener(event: string, listener: (payload: unknown) => void): {
          remove(): void;
        };
      };
    };
    return globalObj.RuneNativeEmitter ?? null;
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

  function readNativeConstants(): UiState | null {
    const globalObj = getGlobalObject();
    const constants = globalObj.NativeConstants as Record<string, unknown> | undefined;
    if (!constants) return null;
    const value = constants["Ui"];
    if (!value || typeof value !== "object") return null;
    return value as UiState;
  }

  function readFromBridge(): UiState | null {
    const globalObj = getGlobalObject();
    const bridge = (globalObj as { __modules?: unknown }).__modules as
      | { callSync?: (name: string, method: string, args?: unknown) => unknown }
      | undefined;
    if (!bridge?.callSync) return null;
    try {
      const result = bridge.callSync("Ui", "getCurrentState", {});
      if (!result || typeof result !== "object") return null;
      return result as UiState;
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
      "Ui:change",
      (payload) => {
        if (payload && typeof payload === "object") {
          setState(payload as UiState);
        }
      }
    );

    onCleanup(() => {
      subscription.remove();
    });
  });

  return (
    <UiContext.Provider value={state}>
      {props.children}
    </UiContext.Provider>
  );
};

const DEFAULT_STATE: UiState = {
  value: 0,
  status: "idle",
  timestamp: 0,
};
