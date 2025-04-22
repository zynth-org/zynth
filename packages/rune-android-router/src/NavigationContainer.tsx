import { createSignal, createEffect, onCleanup, ParentComponent } from "solid-js";
import type {
  NavigationState,
  RouterAction,
  RouterContextValue,
} from "./types";
import { RouterContext, applyScreenOptions, registerScreen } from "./context";
import { setNativeRouterDispatch } from "./nativeInterop";
import "./nativeRenderer";

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
    console.log(
      "[RuneAndroidRouter] Dispatch:",
      JSON.stringify(action, null, 2)
    );

    const currentState = state();

    // Call native navigation if available
    const globalObject = getGlobalObject();
    const modules = globalObject.__modules;
    const hasNativeModule = modules && typeof modules.call === "function";

    if (hasNativeModule) {
      console.log("[RuneAndroidRouter] 🔥 NATIVE MODULE DETECTED");

      // For RESET (initial state), allow JS to render the first screen
      // For PUSH/POP/NAVIGATE, delegate to native and skip JS rendering
      if (
        action.type === "PUSH" ||
        action.type === "NAVIGATE" ||
        action.type === "POP" ||
        action.type === "GO_BACK"
      ) {
        console.log(
          "[RuneAndroidRouter] 🚀 Delegating to NATIVE, skipping JS rendering"
        );
        try {
          switch (action.type) {
            case "PUSH":
            case "NAVIGATE":
              console.log(
                "[RuneAndroidRouter] 🚀 Calling NATIVE navigate:",
                action.name
              );
              modules.call("RuneAndroidRouter", "navigate", [
                action.name,
                action.params ? JSON.stringify(action.params) : null,
              ]);
              break;

            case "POP":
            case "GO_BACK":
              console.log("[RuneAndroidRouter] 🚀 Calling NATIVE goBack");
              modules.call("RuneAndroidRouter", "goBack", []);
              break;
          }
        } catch (error) {
          console.error("[RuneAndroidRouter] Native call failed:", error);
        }

        // DO NOT UPDATE JS STATE - let native handle everything
        console.log(
          "[RuneAndroidRouter] ✅ Navigation delegated to native, JS state unchanged"
        );
        return;
      }

      // For RESET, update JS state to render initial screen
      console.log(
        "[RuneAndroidRouter] 🔄 RESET action - updating JS state for initial render"
      );
    }

    if (!hasNativeModule) {
      console.warn(
        "[RuneAndroidRouter] ⚠️ Native module not available, using JS-only fallback"
      );
    }

    // Update JS state for RESET or when native is not available
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

  setNativeRouterDispatch(dispatch);
  onCleanup(() => setNativeRouterDispatch(null));

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
