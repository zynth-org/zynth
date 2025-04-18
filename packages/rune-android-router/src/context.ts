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

export function applyScreenOptions(key: string, options: ScreenOptions) {
  // For minimal implementation, we just log
  console.log("[RuneAndroidRouter] setOptions", key, options);
}
