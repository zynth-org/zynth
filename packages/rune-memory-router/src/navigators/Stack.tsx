import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  For,
  type JSX,
  type Accessor,
} from "solid-js";
import {
  ScreenContainer,
  Screen as ScreenPrimitive,
  type ScreenAnimationType,
} from "@rune/screens";
import { NavigationContext, type NavigationContextValue } from "../context";
import { RouteContext, type RouteContextData } from "../context";
import type {
  RouteParamList,
  NavigationState,
  RouteNode,
  ScreenOptions,
  RouterAction,
  NavigationHelpers,
  StackNavigatorProps,
  StackScreenProps,
  ScreenComponent,
  ScreenOptionsInput,
} from "../types";

// ============================================================================
// Utility: Generate unique keys
// ============================================================================

let keyCounter = 0;
function generateKey(): string {
  return `route-${++keyCounter}`;
}

// ============================================================================
// Stack Navigator Context (internal)
// ============================================================================

interface StackNavigatorContextValue {
  registerScreen: (name: string, config: ScreenConfig) => void;
}

interface ScreenConfig {
  component: ScreenComponent;
  options?: ScreenOptionsInput;
  initialParams?: object;
}

const StackNavigatorContext = createContext<StackNavigatorContextValue>();

// ============================================================================
// Stack.Screen Component
// ============================================================================

export function StackScreen<
  ParamList extends RouteParamList = RouteParamList,
  RouteName extends keyof ParamList & string = keyof ParamList & string
>(props: StackScreenProps<ParamList, RouteName>): JSX.Element {
  const ctx = useContext(StackNavigatorContext);
  if (ctx) {
    ctx.registerScreen(props.name, {
      component: props.component as unknown as ScreenComponent,
      options: props.options,
      initialParams: props.initialParams as object | undefined,
    });
  }
  return null as unknown as JSX.Element;
}

// ============================================================================
// Stack.Navigator Component
// ============================================================================

export function StackNavigator(props: StackNavigatorProps): JSX.Element {
  // Screen registry - populated by Stack.Screen children
  const screenRegistry = new Map<string, ScreenConfig>();
  const screenOrder: string[] = [];

  // Track if we've initialized state
  const [initialized, setInitialized] = createSignal(false);

  const registerScreen = (name: string, config: ScreenConfig) => {
    if (!screenRegistry.has(name)) {
      screenOrder.push(name);
    }
    screenRegistry.set(name, config);
  };

  // State - will be populated after children register
  const navigatorId = props.id ?? `stack-${generateKey()}`;

  function createRoute(name: string, params?: object): RouteNode {
    const config = screenRegistry.get(name);
    return {
      key: generateKey(),
      name,
      params: params ?? config?.initialParams,
      type: "stack",
    };
  }

  // Start with empty state, will be populated after registration
  const [state, setState] = createSignal<NavigationState>({
    key: navigatorId,
    type: "stack",
    index: 0,
    routes: [],
  });

  // Initialize state after children have registered
  const initializeState = () => {
    if (initialized()) return;
    const initialRouteName = props.initialRouteName ?? screenOrder[0];

    if (initialRouteName && screenRegistry.has(initialRouteName)) {
      setState({
        key: navigatorId,
        type: "stack",
        index: 0,
        routes: [createRoute(initialRouteName)],
      });
      setInitialized(true);
    }
  };

  // Navigation helpers
  const helpers: NavigationHelpers = {
    navigate(name, params) {
      setState((prev) => {
        // Check if route already exists in stack
        const existingIndex = prev.routes.findIndex((r) => r.name === name);
        if (existingIndex >= 0) {
          // Navigate to existing route, updating params
          const routes = [...prev.routes];
          routes[existingIndex] = { ...routes[existingIndex], params };
          return { ...prev, index: existingIndex, routes };
        }
        // Push new route
        const routes = [
          ...prev.routes.slice(0, prev.index + 1),
          createRoute(name, params),
        ];
        return { ...prev, index: routes.length - 1, routes };
      });
    },
    push(name, params) {
      setState((prev) => {
        const routes = [
          ...prev.routes.slice(0, prev.index + 1),
          createRoute(name, params),
        ];
        return { ...prev, index: routes.length - 1, routes };
      });
    },
    pop(count = 1) {
      setState((prev) => {
        const newIndex = Math.max(0, prev.index - count);
        return {
          ...prev,
          index: newIndex,
          routes: prev.routes.slice(0, newIndex + 1),
        };
      });
    },
    goBack() {
      helpers.pop(1);
    },
    replace(name, params) {
      setState((prev) => {
        const routes = [...prev.routes];
        routes[prev.index] = createRoute(name, params);
        return { ...prev, routes };
      });
    },
    reset(resetState) {
      setState((prev) => ({
        ...prev,
        index: resetState.index ?? resetState.routes.length - 1,
        routes: resetState.routes.map((r) =>
          createRoute(r.name, r.params as object)
        ),
      }));
    },
    setParams(params) {
      setState((prev) => {
        const routes = [...prev.routes];
        const current = routes[prev.index];
        routes[prev.index] = {
          ...current,
          params: { ...current.params, ...params },
        };
        return { ...prev, routes };
      });
    },
    setOptions(options) {
      // Update options for current screen
      setState((prev) => {
        const routes = [...prev.routes];
        const current = routes[prev.index];
        routes[prev.index] = {
          ...current,
          options: { ...current.options, ...options },
        };
        return { ...prev, routes };
      });
    },
    canGoBack() {
      return state().index > 0;
    },
    getParent() {
      return undefined; // TODO: Support nested navigators
    },
    isFocused() {
      return true; // TODO: Track focus properly
    },
  };

  // Dispatch actions
  function dispatch(action: RouterAction): void {
    switch (action.type) {
      case "NAVIGATE":
        helpers.navigate(action.payload.name, action.payload.params as object);
        break;
      case "PUSH":
        helpers.push(action.payload.name, action.payload.params as object);
        break;
      case "POP":
        helpers.pop(action.payload?.count);
        break;
      case "GO_BACK":
        helpers.goBack();
        break;
      case "REPLACE":
        helpers.replace(action.payload.name, action.payload.params as object);
        break;
      case "RESET":
        helpers.reset({
          index: action.payload.index,
          routes: action.payload.routes.map((r) => ({
            name: r.name,
            params: r.params as object,
          })),
        });
        break;
      case "SET_PARAMS":
        helpers.setParams(action.payload);
        break;
    }
  }

  // Resolve screen options
  function resolveOptions(
    routeOptions?: ScreenOptions,
    screenOptions?: ScreenOptionsInput
  ): ScreenOptions {
    const defaultOpts =
      typeof props.screenOptions === "function"
        ? props.screenOptions() ?? {}
        : props.screenOptions ?? {};
    const screenOpts =
      typeof screenOptions === "function"
        ? screenOptions() ?? {}
        : screenOptions ?? {};
    return { ...defaultOpts, ...screenOpts, ...routeOptions };
  }

  // Map animation type to @rune/screens animation
  function mapAnimation(animation?: string): ScreenAnimationType {
    switch (animation) {
      case "push":
        return "push";
      case "zoom":
        return "zoom";
      case "fade":
        return "fade";
      case "none":
        return "none";
      default:
        return "push";
    }
  }

  // Build navigation context value
  const navContextValue = createMemo<NavigationContextValue>(() => ({
    state: state as Accessor<NavigationState>,
    helpers,
    dispatch,
    setOptions: helpers.setOptions,
    parent: undefined,
    navigatorId,
    navigatorType: "stack",
  }));

  // Inner component that renders after children have registered
  const ScreensRenderer = () => {
    // Trigger initialization after children have rendered
    queueMicrotask(() => initializeState());

    return (
      <ScreenContainer>
        <For each={state().routes}>
          {(route, index) => {
            const config = screenRegistry.get(route.name);
            if (!config) return null;

            const currentIndex = createMemo(() => state().index);
            const isFocused = createMemo(() => index() === currentIndex());
            const isInStack = createMemo(() => index() <= currentIndex());
            const options = createMemo(() =>
              resolveOptions(route.options, config.options)
            );

            // Route context for this screen
            const [params, setParams] = createSignal(route.params ?? {});
            const [screenOptions, setScreenOptions] =
              createSignal<ScreenOptions>(options());

            const routeContext: RouteContextData = {
              key: route.key,
              name: route.name,
              params: params as Accessor<object>,
              setParams: (newParams) => {
                setParams((p) => ({ ...p, ...newParams }));
                helpers.setParams(newParams);
              },
              options: screenOptions,
              setOptions: (newOptions) => {
                setScreenOptions((o) => ({ ...o, ...newOptions }));
                helpers.setOptions(newOptions);
              },
              isFocused,
            };

            const ScreenComponent = config.component;

            return (
              <ScreenPrimitive
                screenKey={route.key}
                active={isInStack()}
                animation={mapAnimation(options().animation)}
              >
                <RouteContext.Provider value={routeContext}>
                  <ScreenComponent
                    navigation={helpers}
                    route={{
                      key: route.key,
                      name: route.name,
                      params: params as Accessor<object>,
                      setParams: routeContext.setParams,
                    }}
                  />
                </RouteContext.Provider>
              </ScreenPrimitive>
            );
          }}
        </For>
      </ScreenContainer>
    );
  };

  return (
    <StackNavigatorContext.Provider value={{ registerScreen }}>
      {/* Render children to trigger registration */}
      {props.children}

      <NavigationContext.Provider value={navContextValue()}>
        <ScreensRenderer />
      </NavigationContext.Provider>
    </StackNavigatorContext.Provider>
  );
}

// ============================================================================
// Stack Export Object
// ============================================================================

export const Stack = {
  Navigator: StackNavigator,
  Screen: StackScreen,
};
