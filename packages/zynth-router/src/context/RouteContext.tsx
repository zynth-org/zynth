import { createContext, useContext, type Accessor } from "solid-js";
import type {
  RouteParamList,
  RouteContextValue,
  ScreenOptions,
} from "../types";

// ============================================================================
// Route Context
// ============================================================================

export interface RouteContextData<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
> {
  /** Unique key for this route instance */
  key: string;
  /** Route name */
  name: RouteName;
  /** Route params (reactive) */
  params: Accessor<ParamList[RouteName]>;
  /** Update params */
  setParams: (params: Partial<ParamList[RouteName]>) => void;
  /** Screen options (reactive) */
  options: Accessor<ScreenOptions>;
  /** Update screen options */
  setOptions: (options: ScreenOptions) => void;
  /** Whether this route is focused */
  isFocused: Accessor<boolean>;
}

export const RouteContext = createContext<RouteContextData | undefined>();

/**
 * Get the route context. Throws if not within a Screen.
 */
export function useRouteContext<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
>(): RouteContextData<ParamList, RouteName> {
  const context = useContext(RouteContext);
  if (!context) {
    throw new Error(
      "useRoute must be used within a navigator screen. " +
        "Make sure your component is rendered as a screen component."
    );
  }
  return context as unknown as RouteContextData<ParamList, RouteName>;
}

/**
 * Convert RouteContextData to the public RouteContextValue interface
 */
export function toRouteContextValue<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
>(
  context: RouteContextData<ParamList, RouteName>
): RouteContextValue<ParamList, RouteName> {
  return {
    key: context.key,
    name: context.name,
    params: context.params,
    setParams: context.setParams,
  };
}
