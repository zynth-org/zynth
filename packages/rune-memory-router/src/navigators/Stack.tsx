import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  For,
  getOwner,
  runWithOwner,
  type JSX,
  type Accessor,
} from "solid-js";
import { View, Text, Button, SystemIcon } from "@rune/components";
import { createSafeAreaInsets } from "@rune/safe-area";
import { Platform, OS } from "@rune/apis";
import {
  ScreenContainer,
  Screen as ScreenPrimitive,
  type ScreenAnimationType,
  type ScreenHeaderOptions,
} from "@rune/screens";
import {
  NavigationContext,
  type NavigationContextValue,
  useNavigationContextUnsafe,
} from "../context";
import { RouteContext, type RouteContextData } from "../context";
import { DEFAULT_HEADER_HEIGHT } from "../integration/insets";
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
  // Capture parent navigation context for nested navigators
  const parentContext = useNavigationContextUnsafe();

  // Screen registry - populated by Stack.Screen children
  const screenRegistry = new Map<string, ScreenConfig>();
  const screenOrder: string[] = [];

  // Track if we've initialized state
  const [initialized, setInitialized] = createSignal(false);
  const [initialRouteKey, setInitialRouteKey] = createSignal<string | null>(
    null
  );
  const [hasNavigated, setHasNavigated] = createSignal(false);

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
      const initialRoute = createRoute(initialRouteName);
      setState({
        key: navigatorId,
        type: "stack",
        index: 0,
        routes: [initialRoute],
      });
      setInitialRouteKey(initialRoute.key);
      setInitialized(true);
    }
  };

  // Navigation helpers
  const helpers: NavigationHelpers = {
    navigate(name, params) {
      // Check if this screen exists in current navigator
      if (!screenRegistry.has(name)) {
        // Screen not found in current navigator, bubble up to parent
        if (parentContext) {
          parentContext.helpers.navigate(name, params);
          return;
        }
        // No parent and screen not found - log warning
        console.warn(
          `[Stack Navigator] Screen '${name}' not found in navigator '${navigatorId}' and no parent navigator available.`
        );
        return;
      }

      setHasNavigated(true);
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
      setHasNavigated(true);
      setState((prev) => {
        const routes = [
          ...prev.routes.slice(0, prev.index + 1),
          createRoute(name, params),
        ];
        return { ...prev, index: routes.length - 1, routes };
      });
    },
    pop(count = 1) {
      setHasNavigated(true);
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
      setHasNavigated(true);
      helpers.pop(1);
    },
    popToTop() {
      setHasNavigated(true);
      setState((prev) => {
        if (prev.index === 0) return prev;
        const routes = [prev.routes[0]];
        return {
          ...prev,
          index: 0,
          routes,
        };
      });
    },
    replace(name, params) {
      setHasNavigated(true);
      setState((prev) => {
        const routes = [...prev.routes];
        routes[prev.index] = createRoute(name, params);
        return { ...prev, routes };
      });
    },
    reset(resetState) {
      setHasNavigated(true);
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
    getParent<T extends NavigationHelpers = NavigationHelpers>():
      | T
      | undefined {
      return parentContext?.helpers as T | undefined;
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
    const merged = { ...defaultOpts, ...screenOpts, ...routeOptions };
    return {
      headerShown: merged.headerShown ?? true,
      headerShadowVisible: merged.headerShadowVisible ?? true,
      headerBackgroundColor:
        merged.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND,
      ...merged,
    };
  }

  // Map animation type to @rune/screens animation
  function mapAnimation(animation?: string): ScreenAnimationType {
    switch (animation) {
      case "push":
        return "push";
      case "modal":
        return "modal";
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

  function resolveScreenAnimation(options: ScreenOptions): ScreenAnimationType {
    if (options.animationEnabled === false) {
      return "none";
    }

    if (options.animation) {
      return mapAnimation(options.animation);
    }

    if (options.presentation === "modal") {
      return "modal";
    }

    if (options.presentation === "zoom") {
      return "zoom";
    }

    return "push";
  }

  // Build navigation context value
  const navContextValue = createMemo<NavigationContextValue>(() => ({
    state: state as Accessor<NavigationState>,
    helpers,
    dispatch,
    setOptions: helpers.setOptions,
    parent: parentContext,
    navigatorId,
    navigatorType: "stack",
  }));

  // Inner component that renders after children have registered
  const ScreensRenderer = () => {
    // Trigger initialization after children have rendered
    queueMicrotask(() => initializeState());

    const currentRoute = createMemo(() => state().routes[state().index]);
    const currentOptions = createMemo<ScreenOptions | undefined>(() => {
      const route = currentRoute();
      if (!route) return undefined;
      const config = screenRegistry.get(route.name);
      return resolveOptions(route.options, config?.options);
    });
    const useNativeHeader = Platform.OS === OS.IOS;
    const headerShown = createMemo(
      () => currentOptions()?.headerShown !== false
    );
    const shouldRenderHeaderBar = createMemo(
      () => headerShown() && !useNativeHeader
    );

    return (
      <View style={{ flex: 1 }}>
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
              const headerVisible = createMemo(
                () => options()?.headerShown !== false
              );
              const nativeHeaderOptions = createMemo<ScreenHeaderOptions>(() => {
                const opts = options();
                const resolvedTitle = opts?.title ?? route.name;
                const transparent = opts?.headerTransparent ?? false;
                const backgroundColor = transparent
                  ? undefined
                  : opts?.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND;
                return {
                  title: resolvedTitle,
                  subtitle: opts?.subtitle,
                  prefersLargeTitle: opts?.largeTitle ?? false,
                  visible: headerVisible(),
                  backVisible: opts?.headerBackVisible ?? true,
                  tintColor: opts?.headerTintColor ?? DEFAULT_HEADER_TINT,
                  titleColor:
                    opts?.headerTitleColor ??
                    opts?.headerTintColor ??
                    DEFAULT_HEADER_TINT,
                  backgroundColor,
                  transparent,
                };
              });

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
                  animation={
                    route.key === initialRouteKey()
                      ? "none"
                      : resolveScreenAnimation(options())
                  }
                  headerOptions={nativeHeaderOptions()}
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
        {shouldRenderHeaderBar() && currentRoute() && currentOptions() ? (
          <HeaderBar
            key={currentRoute()!.key}
            options={currentOptions()!}
            title={currentOptions()!.title ?? currentRoute()!.name}
            canGoBack={helpers.canGoBack()}
            onBack={helpers.goBack}
          />
        ) : null}
      </View>
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

// -----------------------------------------------------------------------------
// Header Bar (JS-driven, safe-area aware)
// -----------------------------------------------------------------------------

interface HeaderBarProps {
  key?: string;
  options: ScreenOptions;
  title?: string;
  canGoBack: boolean;
  onBack: () => void;
}

const DEFAULT_HEADER_BACKGROUND = "#ffffff";
const DEFAULT_HEADER_TINT = "#111827";
const DEFAULT_TITLE_SIZE = 22;

function HeaderBar(props: HeaderBarProps) {
  const insets = createSafeAreaInsets();
  const insetTop = insets.top;
  const baseHeight = insetTop + DEFAULT_HEADER_HEIGHT;
  const owner = getOwner();

  const tintColor = () => props.options.headerTintColor ?? DEFAULT_HEADER_TINT;
  const titleColor = () =>
    props.options.headerTitleColor ??
    props.options.headerTintColor ??
    DEFAULT_HEADER_TINT;
  const backgroundColor = () =>
    props.options.headerTransparent
      ? "transparent"
      : props.options.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND;
  const backVisible = () => props.options.headerBackVisible ?? true;
  const invokeBack = () => {
    if (owner) {
      runWithOwner(owner, () => props.onBack());
    } else {
      props.onBack();
    }
  };

  const renderLeft = () => {
    const canBack = () => props.canGoBack || backVisible();
    if (props.options.headerLeft) return props.options.headerLeft();
    return (
      <Button
        onPress={canBack() ? invokeBack : undefined}
        variant="ghost"
        iconOnly
        rounded="pill"
        style={{
          backgroundColor: "transparent",
          paddingHorizontal: 8,
          paddingVertical: 6,
          minWidth: 56,
          opacity: !props.canGoBack || !backVisible() ? 0 : 1,
        }}
      >
        <SystemIcon
          name={Platform.select({
            ios: "chevron.left",
            android: "ic_arrow_back",
          })}
          tintColor={tintColor()}
          style={{
            width: 24,
            height: 24,
          }}
        />
      </Button>
    );
  };

  const renderTitle = () => {
    if (props.options.headerTitle) return props.options.headerTitle();
    if (props.options.title) {
      return (
        <Text
          style={{
            color: titleColor(),
            fontSize: DEFAULT_TITLE_SIZE,
            fontWeight: "500",
          }}
          numberOfLines={1}
        >
          {props.options.title}
        </Text>
      );
    }
    return null;
  };

  const renderRight = () => {
    if (props.options.headerRight) return props.options.headerRight();
    return null;
  };

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: baseHeight,
        paddingTop: insetTop,
        backgroundColor: backgroundColor(),
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-start",
          flex: 1,
        }}
      >
        <View
          style={{
            minWidth: 64,
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          {renderLeft()}
        </View>
        <View
          style={{
            alignItems: "center",
            paddingHorizontal: 8,
            height: "100%",
          }}
        >
          {renderTitle()}
        </View>
      </View>
      <View
        style={{
          minWidth: 64,
          alignItems: "flex-end",
          justifyContent: "center",
          background: "#796868",
        }}
      >
        {renderRight()}
      </View>
    </View>
  );
}
