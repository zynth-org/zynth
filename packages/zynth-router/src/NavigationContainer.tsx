import { createSignal, createEffect, onMount, type JSX } from "solid-js";
import { SafeAreaProvider, getInitialWindowMetrics } from "@zynthjs/apis";
import type {
  NavigationContainerProps,
  NavigationState,
  RouteParamList,
} from "./types";

// ============================================================================
// Navigation Container
// ============================================================================

/**
 * Root container for navigation. Manages the navigation state and provides
 * context to all child navigators.
 */
export function NavigationContainer<
  ParamList extends RouteParamList = RouteParamList
>(props: NavigationContainerProps<ParamList>): JSX.Element {
  // Internal state - managed by child navigators
  const [rootState, setRootState] =
    createSignal<NavigationState<ParamList> | null>(props.initialState ?? null);
  const [isReady, setIsReady] = createSignal(false);

  // Notify on state changes
  createEffect(() => {
    const state = rootState();
    if (state && props.onStateChange) {
      props.onStateChange(state);
    }
  });

  // Call onReady when container is ready
  onMount(() => {
    setIsReady(true);
    props.onReady?.();
  });

  // The children (navigators) will register themselves and manage their own state
  // This container primarily provides the root context and linking configuration
  return (
    <NavigationContainerContext.Provider
      value={{
        setRootState: setRootState as (state: NavigationState | null) => void,
        getRootState: rootState as () => NavigationState | null,
        linking: props.linking as unknown as LinkingOptions | undefined,
        isReady,
      }}
    >
      <SafeAreaProvider initialMetrics={getInitialWindowMetrics()}>
        {props.children}
      </SafeAreaProvider>
    </NavigationContainerContext.Provider>
  );
}

// ============================================================================
// Container Context (internal)
// ============================================================================

import { createContext, useContext, type Accessor } from "solid-js";
import type { LinkingOptions } from "./types";

export interface NavigationContainerContextValue {
  setRootState: (state: NavigationState | null) => void;
  getRootState: () => NavigationState | null;
  linking?: LinkingOptions;
  isReady: Accessor<boolean>;
}

export const NavigationContainerContext = createContext<
  NavigationContainerContextValue | undefined
>();

/**
 * Get the container context. Used internally by navigators.
 */
export function useContainerContext(): NavigationContainerContextValue {
  const context = useContext(NavigationContainerContext);
  if (!context) {
    throw new Error(
      "Navigator must be used within a NavigationContainer. " +
        "Make sure your navigator is wrapped in <NavigationContainer>."
    );
  }
  return context;
}
