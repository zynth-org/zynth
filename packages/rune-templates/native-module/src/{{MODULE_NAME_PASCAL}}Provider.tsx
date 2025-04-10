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

  createEffect(() => {
    // Subscribe to native state changes
    const nativeModule = globalThis.__{{MODULE_NAME_UPPER}}__;
    
    if (!nativeModule) {
      console.warn("[{{MODULE_NAME_PASCAL}}] Native module not available");
      return;
    }

    // Get initial state if not provided
    if (!props.initialState) {
      const initialState = nativeModule.getInitialState();
      if (initialState) {
        setState(initialState);
      }
    }

    // Subscribe to updates
    const unsubscribe = nativeModule.addChangeListener((newState) => {
      setState(newState);
    });

    onCleanup(() => {
      unsubscribe();
    });
  });

  return (
    <{{MODULE_NAME_PASCAL}}Context.Provider value={state}>
      {props.children}
    </{{MODULE_NAME_PASCAL}}Context.Provider>
  );
};
