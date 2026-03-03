import {
  createSignal,
  createMemo,
  createContext,
  useContext,
  For,
  getOwner,
  runWithOwner,
  createEffect,
  onCleanup,
  type JSX,
  type Accessor,
} from "solid-js";
import { View, Text, Button, Pressable, SystemGlyph } from "@zynth/components";
import { Platform, OS, createSafeAreaInsets } from "@zynth/apis";
import {
  ScreenContainer,
  Screen as ScreenPrimitive,
  type ScreenAnimationType,
  type ScreenHeaderOptions,
} from "@zynth/screens";
import {
  NavigationContext,
  type NavigationContextValue,
  useNavigationContextUnsafe,
} from "../context";
import { RouteContext, type RouteContextData } from "../context";
import { useContainerContext } from "../NavigationContainer";
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
import {
  registerNativeHeaderAccessory,
  unregisterNativeHeaderAccessory,
} from "../native/headerAccessoryRegistry";
import { registerAndroidBackHandler } from "../native/androidBackHandler";

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
  RouteName extends keyof ParamList & string = keyof ParamList & string,
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
  const containerContext = useContainerContext();
  const isHydrated = createMemo(() => containerContext.isReady());

  // Screen registry - populated by Stack.Screen children
  const screenRegistry = new Map<string, ScreenConfig>();
  const screenOrder: string[] = [];

  // Track if we've initialized state
  const [initialized, setInitialized] = createSignal(false);
  const [initialRouteKey, setInitialRouteKey] = createSignal<string | null>(
    null,
  );
  const [hasNavigated, setHasNavigated] = createSignal(false);
  const suppressedNativeBackRouteKeys = new Set<string>();

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
    let initialRouteName = props.initialRouteName;

    if (initialRouteName && !screenRegistry.has(initialRouteName)) {
      console.warn(
        `[Stack Navigator] initialRouteName '${initialRouteName}' not found in navigator '${navigatorId}'. Falling back to first registered screen.`,
      );
      initialRouteName = undefined;
    }

    const fallbackRouteName = screenOrder[0];
    const routeName = initialRouteName ?? fallbackRouteName;

    if (!routeName) {
      console.warn(
        `[Stack Navigator] Navigator '${navigatorId}' has no registered screens.`,
      );
      return;
    }

    const initialRoute = createRoute(routeName);
    setState({
      key: navigatorId,
      type: "stack",
      index: 0,
      routes: [initialRoute],
    });
    setInitialRouteKey(initialRoute.key);
    setInitialized(true);
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
          `[Stack Navigator] Screen '${name}' not found in navigator '${navigatorId}' and no parent navigator available.`,
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
      const currentState = state();
      const newIndex = Math.max(0, currentState.index - count);
      for (let i = newIndex + 1; i <= currentState.index; i++) {
        const route = currentState.routes[i];
        if (route?.key) {
          suppressedNativeBackRouteKeys.add(route.key);
        }
      }
      setState((prev) => {
        return {
          ...prev,
          index: newIndex,
        };
      });
      // Delay removal of routes to allow exit animations to play
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          routes: prev.routes.slice(0, prev.index + 1),
        }));
      }, 500);
    },
    goBack() {
      setHasNavigated(true);
      helpers.pop(1);
    },
    popToTop() {
      setHasNavigated(true);
      const currentState = state();
      for (let i = 1; i <= currentState.index; i++) {
        const route = currentState.routes[i];
        if (route?.key) {
          suppressedNativeBackRouteKeys.add(route.key);
        }
      }
      setState((prev) => {
        if (prev.index === 0) return prev;
        return {
          ...prev,
          index: 0,
        };
      });
      // Delay removal of routes
      setTimeout(() => {
        setState((prev) => ({
          ...prev,
          routes: [prev.routes[0]],
        }));
      }, 500);
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
          createRoute(r.name, r.params as object),
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
    screenOptions?: ScreenOptionsInput,
  ): ScreenOptions {
    const defaultOpts =
      typeof props.screenOptions === "function"
        ? (props.screenOptions() ?? {})
        : (props.screenOptions ?? {});
    const screenOpts =
      typeof screenOptions === "function"
        ? (screenOptions() ?? {})
        : (screenOptions ?? {});
    const merged = { ...defaultOpts, ...screenOpts, ...routeOptions };
    return {
      headerShown: merged.headerShown ?? true,
      headerShadowVisible: merged.headerShadowVisible ?? true,
      headerBackgroundColor:
        merged.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND,
      ...merged,
    };
  }

  // Map animation type to @zynth/screens animation
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
    isHydrated,
  }));

  const canGoBack = createMemo(() => helpers.canGoBack());
  registerAndroidBackHandler(canGoBack, () => {
    helpers.goBack();
  });

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
      () => currentOptions()?.headerShown !== false,
    );
    const shouldRenderHeaderBar = createMemo(
      () => headerShown() && (!useNativeHeader || Platform.OS === OS.WEB),
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

              const isCovered = createMemo(() => {
                const currentIdx = currentIndex();
                const myIdx = index();
                if (myIdx >= currentIdx) return false;

                // If the screen immediately above this one (up to the current focus)
                // is a modal, then this screen is "covered" and should scale down.
                for (let i = myIdx + 1; i <= currentIdx; i++) {
                  const r = state().routes[i];
                  const cfg = screenRegistry.get(r.name);
                  const opts = resolveOptions(r.options, cfg?.options);
                  if (resolveScreenAnimation(opts) === "modal") return true;
                }
                return false;
              });

              const options = createMemo(() =>
                resolveOptions(route.options, config.options),
              );
              const localOwner = getOwner();

              createEffect(() => {
                if (!useNativeHeader) {
                  unregisterNativeHeaderAccessory(route.key, "right");
                  return;
                }
                const headerRightFactory = options()?.headerRight;
                if (!headerRightFactory) {
                  unregisterNativeHeaderAccessory(route.key, "right");
                  return;
                }
                registerNativeHeaderAccessory({
                  routeKey: route.key,
                  position: "right",
                  factory: headerRightFactory,
                  owner: localOwner ?? null,
                });
              });

              onCleanup(() => {
                suppressedNativeBackRouteKeys.delete(route.key);
                unregisterNativeHeaderAccessory(route.key, "right");
              });

              // Route context for this screen
              const [params, setParams] = createSignal(route.params ?? {});
              const [screenOptions, setScreenOptions] =
                createSignal<ScreenOptions>(options());
              const headerVisible = createMemo(
                () => options()?.headerShown !== false,
              );
              const nativeHeaderOptions = createMemo<ScreenHeaderOptions>(
                () => {
                  const opts = options();
                  const resolvedTitle = opts?.title ?? route.name;
                  const transparent = opts?.headerTransparent ?? false;
                  const backgroundColor = transparent
                    ? undefined
                    : (opts?.headerBackgroundColor ??
                      DEFAULT_HEADER_BACKGROUND);
                  const buttonOptions = opts?.headerRightButton;
                  return {
                    title: resolvedTitle,
                    subtitle: opts?.subtitle,
                    prefersLargeTitle: opts?.largeTitle ?? false,
                    headerStyle: opts?.headerStyle,
                    visible: headerVisible(),
                    backVisible: opts?.headerBackVisible ?? true,
                    tintColor: opts?.headerTintColor ?? DEFAULT_HEADER_TINT,
                    titleColor:
                      opts?.headerTitleColor ??
                      opts?.headerTintColor ??
                      DEFAULT_HEADER_TINT,
                    backgroundColor,
                    transparent,
                    shadowVisible: opts?.headerShadowVisible ?? true,
                    blurEffect: opts?.headerBlurEffect,
                    userInterfaceStyle: opts?.userInterfaceStyle,
                    rightButton: buttonOptions
                      ? {
                          title: buttonOptions.title,
                          style: buttonOptions.style,
                          systemItem: buttonOptions.systemItem,
                        }
                      : undefined,
                    rightAccessory:
                      useNativeHeader && headerVisible() && opts?.headerRight
                        ? {
                            type: "surface",
                            routeKey: route.key,
                            position: "right",
                          }
                        : undefined,
                  };
                },
              );
              const screenBackground = createMemo(
                () =>
                  options()?.contentBackgroundColor ??
                  DEFAULT_SCREEN_BACKGROUND,
              );
              const headerRightButton = createMemo(
                () => options()?.headerRightButton,
              );
              const handleNativeBack = () => {
                if (suppressedNativeBackRouteKeys.delete(route.key)) {
                  return;
                }
                helpers.goBack();
              };
              const handleNativeHeaderRightPress = () => {
                const handler = headerRightButton()?.onPress;
                if (!handler) return;
                if (localOwner) {
                  runWithOwner(localOwner, () => handler());
                } else {
                  handler();
                }
              };

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
                  covered={isCovered()}
                  animation={
                    route.key === initialRouteKey()
                      ? "none"
                      : resolveScreenAnimation(options())
                  }
                  gestureEnabled={options()?.gestureEnabled ?? true}
                  headerOptions={nativeHeaderOptions()}
                  onNativeBack={useNativeHeader ? handleNativeBack : undefined}
                  onNativeHeaderRightPress={
                    useNativeHeader && headerRightButton()
                      ? handleNativeHeaderRightPress
                      : undefined
                  }
                  style={{
                    backgroundColor: screenBackground(),
                  }}
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
const DEFAULT_SCREEN_BACKGROUND = "#ffffff";

const BackArrowIcon = (props: { color: string; style?: any }) => (
  <svg
    fill={props.color}
    stroke-width="0"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 448 512"
    style={{
      width: "1em",
      height: "1em",
      ...props.style,
      overflow: "visible",
    }}
  >
    <path d="M9.4 233.4c-12.5 12.5-12.5 32.8 0 45.3l160 160c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L109.2 288H416c17.7 0 32-14.3 32-32s-14.3-32-32-32H109.3l105.3-105.4c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0l-160 160z" />
  </svg>
);

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
      : (props.options.headerBackgroundColor ?? DEFAULT_HEADER_BACKGROUND);
  const backVisible = () => props.options.headerBackVisible ?? true;
  const invokeBack = () => {
    if (owner) {
      runWithOwner(owner, () => props.onBack());
    } else {
      props.onBack();
    }
  };
  const invokeHeaderRightButton = () => {
    const handler = props.options.headerRightButton?.onPress;
    if (!handler) return;
    if (owner) {
      runWithOwner(owner, () => handler());
    } else {
      handler();
    }
  };

  const renderLeft = () => {
    const canBack = () => props.canGoBack && backVisible();
    if (props.options.headerLeft) return props.options.headerLeft();
    if (!canBack()) {
      return (
        <View
          style={{
            backgroundColor: "transparent",
            paddingHorizontal: 8,
            paddingVertical: 6,
            minWidth: 56,
            minHeight: 56,
          }}
        />
      );
    }
    return (
      <Pressable
        onPress={invokeBack}
        pressEffect="ripple"
        hitSlop={8}
        style={{
          backgroundColor: "transparent",
          paddingHorizontal: 8,
          paddingVertical: 6,
          minWidth: 56,
          minHeight: 56,
          alignItems: "center",
          justifyContent: "center",
          opacity: 1,
        }}
        stateLayerStyle={{
          backgroundColor: "rgba(0, 0, 0, 0.08)",
          borderRadius: 999,
        }}
      >
        {Platform.OS === OS.WEB ? (
          <BackArrowIcon
            color={tintColor()}
            style={{ width: 24, height: 24, zIndex: 999 }}
          />
        ) : (
          <SystemGlyph
            name="RiArrowsArrowLeftLine"
            size={32}
            color={tintColor()}
            style={{
              textAlign: "center",
              alignContent: "center",
              justifyContent: "center",
            }}
          />
        )}
      </Pressable>
    );
  };

  const renderTitle = () => {
    if (props.options.headerTitle) return props.options.headerTitle();
    if (props.options.title) {
      return (
        <Text
          style={{
            color: titleColor(),
            fontSize: 20,
            fontWeight: "600",
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
    if (props.options.headerRightButton)
      return (
        <Button
          onPress={
            props.options.headerRightButton?.onPress
              ? invokeHeaderRightButton
              : undefined
          }
          variant="ghost"
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            minWidth: 48,
            alignSelf: "stretch",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: tintColor(),
              fontSize: 15,
              fontWeight: "500",
            }}
          >
            {props.options.headerRightButton?.title ??
              (props.options.headerRightButton?.systemItem === "close"
                ? "Close"
                : "Done")}
          </Text>
        </Button>
      );
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
        paddingHorizontal: 4,
        zIndex: 1000,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flex: 1,
          height: "100%",
        }}
      >
        <View
          style={{
            minWidth: 48,
            height: "100%",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {renderLeft()}
        </View>
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            paddingLeft: 8,
          }}
        >
          {renderTitle()}
        </View>
      </View>
      <View
        style={{
          minWidth: 48,
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          paddingRight: 8,
        }}
      >
        {renderRight()}
      </View>
    </View>
  );
}
