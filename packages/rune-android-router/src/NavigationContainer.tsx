import {
  createSignal,
  createEffect,
  onCleanup,
  ParentComponent,
} from "solid-js";
import type {
  NavigationState,
  RouterAction,
  RouterContextValue,
} from "./types";
import { RouterContext, applyScreenOptions, registerScreen } from "./context";

export interface NavigationContainerProps {
  children: any;
  onReady?: (state: NavigationState | null) => void;
  suppressSafeAreaWarning?: boolean;
}

// Get global for module access
function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
}

// Minimal native bridge - tries to connect to native module if available
function getNativeRouterBridge() {
  const globalObject = getGlobalObject();
  const modules = globalObject.__modules;

  // Check if native module is available
  const hasNativeModule = modules && typeof modules.callSync === "function";

  if (hasNativeModule) {
    console.log("[RuneAndroidRouter] Native module bridge available");

    const moduleName = "RuneAndroidRouter";
    const callSync = modules.callSync.bind(modules);

    return {
      getState: (): NavigationState | null => {
        try {
          const result = callSync(moduleName, "getState", []);
          console.log("[RuneAndroidRouter] getState result:", result);
          return result as NavigationState | null;
        } catch (error) {
          console.warn("[RuneAndroidRouter] getState failed:", error);
          return null;
        }
      },
      dispatch: (action: RouterAction) => {
        console.log("[RuneAndroidRouter] Native dispatch:", action);
        // For minimal version, we handle state locally
        // Can wire up native dispatch later if needed
      },
    };
  }

  // Fallback for web/dev mode
  console.log("[RuneAndroidRouter] Using fallback bridge (no native module)");
  return {
    getState: (): NavigationState | null => {
      return null;
    },
    dispatch: (action: RouterAction) => {
      console.log("[RuneAndroidRouter] Fallback dispatch:", action);
    },
  };
}

export const NavigationContainer: ParentComponent<NavigationContainerProps> = (
  props
) => {
  const bridge = getNativeRouterBridge();
  const initialState = bridge.getState();
  const [state, setState] = createSignal<NavigationState | null>(initialState);
  let ready = false;

  createEffect(() => {
    const next = state();
    if (next && props.onReady && !ready) {
      ready = true;
      props.onReady(next);
    }
  });

  const dispatch = (action: RouterAction) => {
    console.log("[RuneAndroidRouter] Dispatch:", action);

    // TODO: Call native navigation here for true native nav
    // For now, this is JS-only state management
    console.log("[RuneAndroidRouter] ⚠️ Using JS-only navigation (not native)");

    const currentState = state();

    switch (action.type) {
      case "RESET":
        setState(action.state);
        break;

      case "PUSH":
        if (currentState) {
          const newRoute = {
            key: `${action.name}-${Date.now().toString(36)}`,
            name: action.name,
            params: action.params,
          };
          setState({
            ...currentState,
            index: currentState.routes.length,
            routes: [...currentState.routes, newRoute],
          });
        }
        break;

      case "POP":
        if (currentState && currentState.routes.length > 1) {
          const count = action.count ?? 1;
          const newRoutes = currentState.routes.slice(0, -count);
          setState({
            ...currentState,
            index: newRoutes.length - 1,
            routes: newRoutes,
          });
        }
        break;

      case "GO_BACK":
        if (currentState && currentState.routes.length > 1) {
          setState({
            ...currentState,
            index: currentState.index - 1,
            routes: currentState.routes.slice(0, -1),
          });
        }
        break;

      case "NAVIGATE":
        // For now, navigate behaves like push
        if (currentState) {
          const existingIndex = currentState.routes.findIndex(
            (r) => r.name === action.name
          );
          if (existingIndex >= 0) {
            setState({
              ...currentState,
              index: existingIndex,
            });
          } else {
            const newRoute = {
              key: `${action.name}-${Date.now().toString(36)}`,
              name: action.name,
              params: action.params,
            };
            setState({
              ...currentState,
              index: currentState.routes.length,
              routes: [...currentState.routes, newRoute],
            });
          }
        }
        break;
    }
  };

  const context: RouterContextValue = {
    state,
    dispatch,
    setOptions: applyScreenOptions,
    registerScreen: (descriptor) => registerScreen(descriptor),
  };

  return (
    <RouterContext.Provider value={context}>
      {props.children}
    </RouterContext.Provider>
  );
};
