import {
  ParentComponent,
  Show,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import type { JSX } from "solid-js";
import type {
  NavigationState,
  RouteNode,
  ScreenDescriptor,
  StackProps,
  StackComponentType,
} from "./types";
import { StackScreen } from "./Screen";
import {
  listRegisteredScreens,
  resolveScreenDescriptor,
  RouteProvider,
  createRouteContextValue,
  useRouterContext,
} from "./context";

const scheduleMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (callback: () => void) => setTimeout(callback, 0);

const StackIdContext = createContext<string>();

export function useStackId(): string {
  const id = useContext(StackIdContext);
  if (!id) {
    throw new Error("Stack components must be rendered inside a <Stack>");
  }
  return id;
}

const StackBase: ParentComponent<StackProps> = (props) => {
  const stackId = props.id ?? `stack-${createUniqueId()}`;
  const router = useRouterContext();
  const [initialized, setInitialized] = createSignal(false);

  onMount(() => {
    scheduleMicrotask(() => {
      if (initialized()) return;
      const initialRouteName =
        props.initialRouteName ?? firstRegisteredRouteName(stackId);
      if (!initialRouteName) {
        console.warn("[RuneAndroidRouter] Stack has no screens to initialize.");
        return;
      }
      const descriptor = resolveScreenDescriptor(initialRouteName, stackId);
      if (!descriptor) {
        console.warn(
          `[RuneAndroidRouter] No descriptor found for initial route ${initialRouteName}`
        );
        return;
      }
      router.dispatch({
        type: "RESET",
        state: createInitialStackState(stackId, initialRouteName, descriptor),
      });
      setInitialized(true);
    });
  });

  return (
    <StackIdContext.Provider value={stackId}>
      <StackRenderer stackId={stackId} />
      {props.children}
    </StackIdContext.Provider>
  );
};

export const Stack = Object.assign(StackBase, {
  Screen: StackScreen,
}) as StackComponentType;

const StackRenderer: ParentComponent<{ stackId: string }> = (props) => {
  const router = useRouterContext();
  const stackState = createMemo(() =>
    findStackState(router.state(), props.stackId)
  );
  const activeRoute = createMemo(() => getActiveRoute(stackState()));

  createEffect(() => {
    console.log(
      "[RuneAndroidRouter] stack state:",
      JSON.stringify(stackState(), null, 2)
    );
  });

  createEffect(() => {
    console.log(
      "[RuneAndroidRouter] active route:",
      JSON.stringify(activeRoute(), null, 2)
    );
  });

  const [renderedRoute, setRenderedRoute] = createSignal<RenderedScene | null>(
    null
  );
  let currentScene: RenderedScene | null = null;

  createEffect(() => {
    const current = activeRoute();
    if (!current) {
      cleanupScene(currentScene);
      currentScene = null;
      setRenderedRoute(null);
      return;
    }

    const descriptor = resolveScreenDescriptor(current.name, props.stackId);
    if (!descriptor) {
      cleanupScene(currentScene);
      currentScene = null;
      setRenderedRoute(null);
      return;
    }

    if (currentScene && currentScene.key === current.key) {
      setRenderedRoute(currentScene);
      return;
    }

    cleanupScene(currentScene);
    const routeContext = createRouteContextValue(
      {
        key: current.key,
        name: current.name,
        params: current.params ?? {},
      },
      router.dispatch
    );

    currentScene = {
      key: current.key,
      descriptor,
      context: routeContext,
    };
    setRenderedRoute(currentScene);
  });

  onCleanup(() => {
    cleanupScene(currentScene);
    currentScene = null;
  });

  return (
    <Show when={renderedRoute()} keyed>
      {(scene) => {
        const Component = scene.descriptor.component;
        return (
          <RouteProvider value={scene.context}>
            <Component />
          </RouteProvider>
        );
      }}
    </Show>
  );
};

interface RenderedScene {
  key: string;
  descriptor: ScreenDescriptor;
  context: any;
}

function cleanupScene(scene: RenderedScene | null) {
  // Cleanup logic if needed
}

function firstRegisteredRouteName(stackId: string): string | undefined {
  const registries = listRegisteredScreens();
  return registries.find((screen) => screen.navigatorId === stackId)?.name;
}

function createInitialStackState(
  stackId: string,
  routeName: string,
  descriptor: ReturnType<typeof resolveScreenDescriptor>
): NavigationState {
  return {
    key: stackId,
    type: "stack",
    index: 0,
    routes: [
      {
        key: `${routeName}-${Date.now().toString(36)}`,
        name: routeName,
        params: descriptor?.initialParams,
      },
    ],
  };
}

function getActiveRoute(state: NavigationState | null): RouteNode | null {
  if (!state || !state.routes.length) {
    return null;
  }
  return state.routes[state.index ?? 0];
}

function findStackState(
  state: NavigationState | null,
  stackId: string
): NavigationState | null {
  if (!state) return null;
  if (state.key === stackId) {
    return state;
  }
  // Fallback: return the first stack state
  if (state?.type === "stack") {
    return state;
  }
  return null;
}
