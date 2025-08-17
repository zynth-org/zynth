import { createContext, useContext, type Accessor } from "solid-js";
import type {
  NavigationState,
  NavigationHelpers,
  RouteParamList,
  ScreenOptions,
  RouterAction,
} from "../types";

// ============================================================================
// Navigation Context
// ============================================================================

export interface NavigationContextValue<
  ParamList extends RouteParamList = RouteParamList
> {
  /** Current navigation state (reactive) */
  state: Accessor<NavigationState<ParamList>>;
  /** Navigation helpers */
  helpers: NavigationHelpers<ParamList>;
  /** Dispatch an action */
  dispatch: (action: RouterAction<ParamList>) => void;
  /** Set options for the focused screen */
  setOptions: (options: ScreenOptions) => void;
  /** Get parent navigation context */
  parent: NavigationContextValue<ParamList> | undefined;
  /** Navigator ID */
  navigatorId: string;
  /** Navigator type */
  navigatorType: "stack" | "tabs";
}

export const NavigationContext = createContext<
  NavigationContextValue | undefined
>();

/**
 * Get the navigation context. Throws if not within a NavigationContainer.
 */
export function useNavigationContext<
  ParamList extends RouteParamList = RouteParamList
>(): NavigationContextValue<ParamList> {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error(
      "useNavigation must be used within a NavigationContainer. " +
        "Make sure your component is wrapped in <NavigationContainer>."
    );
  }
  return context as unknown as NavigationContextValue<ParamList>;
}

/**
 * Get the navigation context or undefined if not available.
 */
export function useNavigationContextUnsafe<
  ParamList extends RouteParamList = RouteParamList
>(): NavigationContextValue<ParamList> | undefined {
  return useContext(NavigationContext) as unknown as
    | NavigationContextValue<ParamList>
    | undefined;
}
