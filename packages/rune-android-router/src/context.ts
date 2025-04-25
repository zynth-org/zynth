import { createContext, useContext } from "solid-js";
import type {
  RouteContextValue,
  RouterContextValue,
  RouteParamList,
  NavigationHelpers,
  RouteProp,
  RouterAction,
  ScreenOptions,
} from "./types";

export const RouterContext = createContext<RouterContextValue | null>(null);

export function useRouterContext(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error(
      "[RuneAndroidRouter] Router context not found. Ensure components are wrapped in <NavigationContainer>."
    );
  }
  return ctx;
}

const RouteContext = createContext<RouteContextValue | null>(null);

export function useRoute<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList = keyof ParamList
>(): RouteProp<ParamList, RouteName> {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    throw new Error(
      "[RuneAndroidRouter] useRoute must be called within a screen component"
    );
  }
  return ctx.route as RouteProp<ParamList, RouteName>;
}

export function useNavigation<
  ParamList extends RouteParamList = RouteParamList
>(): NavigationHelpers<ParamList> {
  const ctx = useContext(RouteContext);
  if (!ctx) {
    throw new Error(
      "[RuneAndroidRouter] useNavigation must be called within a screen component"
    );
  }
  return ctx.navigation as NavigationHelpers<ParamList>;
}

export const RouteProvider = RouteContext.Provider;

export function createRouteContextValue<ParamList extends RouteParamList>(
  route: RouteProp<ParamList, keyof ParamList>,
  dispatch: (action: RouterAction) => void
): RouteContextValue<ParamList, keyof ParamList> {
  const navigation: NavigationHelpers<ParamList> = {
    navigate: (name, params) => {
      dispatch({ type: "NAVIGATE", name: name as string, params });
    },
    push: (name, params) => {
      dispatch({ type: "PUSH", name: name as string, params });
    },
    pop: (count = 1) => {
      dispatch({ type: "POP", count });
    },
    goBack: () => {
      dispatch({ type: "GO_BACK" });
    },
    reset: (state) => {
      dispatch({ type: "RESET", state });
    },
    setOptions: (options) => {
      applyScreenOptions(route.key, options as ScreenOptions);
    },
  };

  return {
    navigation,
    route,
  };
}

// Screen registry for minimal implementation
const screenRegistry = new Map<string, any>();

export function registerScreen(descriptor: any): () => void {
  const key = `${descriptor.navigatorId ?? "default"}-${descriptor.name}`;
  screenRegistry.set(key, descriptor);
  return () => {
    screenRegistry.delete(key);
  };
}

export function resolveScreenDescriptor(name: string, navigatorId?: string) {
  const key = `${navigatorId ?? "default"}-${name}`;
  return screenRegistry.get(key);
}

export function listRegisteredScreens() {
  return Array.from(screenRegistry.values());
}

// Store header options per surface/route key
const headerOptionsCache = new Map<string, ScreenOptions>();

export function applyScreenOptions(key: string, options: ScreenOptions) {
  console.log("[RuneAndroidRouter] setOptions", key, JSON.stringify(options));
  headerOptionsCache.set(key, options);

  // Send to native if available
  sendHeaderOptionsToNative(key, options);
}

export function getHeaderOptionsForScreen(
  screenName: string,
  navigatorId?: string
): ScreenOptions | undefined {
  const descriptor = resolveScreenDescriptor(screenName, navigatorId);
  if (!descriptor?.options) {
    return undefined;
  }

  // Resolve options if it's a function
  const options =
    typeof descriptor.options === "function"
      ? descriptor.options()
      : descriptor.options;

  return options;
}

function sendHeaderOptionsToNative(routeKey: string, options: ScreenOptions) {
  try {
    const globalObject = getGlobalObject();
    const modules = globalObject.__modules;

    if (!modules || typeof modules.call !== "function") {
      console.log(
        "[RuneAndroidRouter] Native module not available for header options"
      );
      return;
    }

    // Normalize options for native
    const headerConfig = {
      title: options.title,
      subtitle: options.subtitle,
      headerShown: options.headerShown !== false, // default true
      headerTintColor: options.headerTintColor,
      headerBackgroundColor: options.headerBackgroundColor,
      headerTransparent: options.headerTransparent || false,
      headerShadowVisible: options.headerShadowVisible !== false, // default true
      userInterfaceStyle: options.userInterfaceStyle || "system",
      largeTitle: options.largeTitle || false,
    };

    console.log(
      "[RuneAndroidRouter] Sending header options to native:",
      JSON.stringify(headerConfig)
    );

    // We'll send surface ID once we have it from the fragment
    // For now, store for when surface is created
    modules.call("RuneAndroidRouter", "setHeaderOptions", [
      routeKey,
      JSON.stringify(headerConfig),
    ]);
  } catch (error) {
    console.warn(
      "[RuneAndroidRouter] Failed to send header options to native:",
      error
    );
  }
}

function getGlobalObject(): any {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  return {};
}
