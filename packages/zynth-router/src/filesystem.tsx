import type { JSX } from "solid-js";
import { createStackNavigator, createTabNavigator } from "./createRouter";
import type {
  FileSystemNavigatorRoute,
  FileSystemRouteNode,
  FileSystemRouterManifest,
  RouteParamList,
  ScreenComponent,
} from "./types";

const Stack = createStackNavigator<RouteParamList>();
const Tabs = createTabNavigator<RouteParamList>();

export function createFileSystemRouter(
  manifest: FileSystemRouterManifest,
): () => JSX.Element {
  validateManifest(manifest);
  const nestedScreenCache = new WeakMap<
    FileSystemNavigatorRoute,
    ScreenComponent<RouteParamList>
  >();

  const renderNode = (node: FileSystemRouteNode): JSX.Element | null => {
    if (node.kind === "screen") {
      const ScreenComponentRef = node.component;
      return (
        <Stack.Screen
          name={node.name}
          component={ScreenComponentRef as ScreenComponent<RouteParamList>}
          options={node.options}
          initialParams={
            node.initialParams as RouteParamList[keyof RouteParamList]
          }
        />
      );
    }

    const NestedComponent = getNestedNavigatorComponent(
      node,
      nestedScreenCache,
      renderNavigator,
    );

    return (
      <Stack.Screen
        name={node.name}
        component={NestedComponent}
        options={node.options}
      />
    );
  };

  const renderNavigator = (node: FileSystemNavigatorRoute): JSX.Element => {
    if (node.navigator === "tabs") {
      return (
        <Tabs.Navigator
          initialRouteName={node.initialRouteName}
          tabBarOptions={node.tabBarOptions}
          screenOptions={node.options}
        >
          {node.children.map((child) =>
            renderTabNode(child, nestedScreenCache, renderNavigator),
          )}
        </Tabs.Navigator>
      );
    }

    return (
      <Stack.Navigator
        initialRouteName={node.initialRouteName}
        screenOptions={node.options}
      >
        {node.children.map((child) => renderNode(child))}
      </Stack.Navigator>
    );
  };

  const RootNavigator = () => renderNavigator(manifest);
  return RootNavigator;
}

function renderTabNode(
  node: FileSystemRouteNode,
  cache: WeakMap<FileSystemNavigatorRoute, ScreenComponent<RouteParamList>>,
  renderNavigator: (node: FileSystemNavigatorRoute) => JSX.Element,
): JSX.Element | null {
  if (node.kind === "screen") {
    const ScreenComponentRef = node.component;
    return (
      <Tabs.Screen
        name={node.name}
        component={ScreenComponentRef as ScreenComponent<RouteParamList>}
        options={node.options}
        initialParams={
          node.initialParams as RouteParamList[keyof RouteParamList]
        }
      />
    );
  }

  const NestedComponent = getNestedNavigatorComponent(
    node,
    cache,
    renderNavigator,
  );
  return (
    <Tabs.Screen
      name={node.name}
      component={NestedComponent}
      options={node.options}
    />
  );
}

function getNestedNavigatorComponent(
  node: FileSystemNavigatorRoute,
  cache: WeakMap<FileSystemNavigatorRoute, ScreenComponent<RouteParamList>>,
  renderNavigator: (node: FileSystemNavigatorRoute) => JSX.Element,
): ScreenComponent<RouteParamList> {
  const cached = cache.get(node);
  if (cached) {
    return cached;
  }
  const component: ScreenComponent<RouteParamList> = () => renderNavigator(node);
  cache.set(node, component);
  return component;
}

function validateManifest(manifest: FileSystemRouterManifest): void {
  if (manifest.kind !== "navigator") {
    throw new Error(
      "[router] Invalid filesystem router manifest: root must be a navigator.",
    );
  }
  assertUniqueChildNames(manifest);
}

function assertUniqueChildNames(navigator: FileSystemNavigatorRoute): void {
  const names = new Set<string>();
  for (const child of navigator.children) {
    if (names.has(child.name)) {
      throw new Error(
        `[router] Duplicate route name '${child.name}' in navigator '${navigator.name}'.`,
      );
    }
    names.add(child.name);
    if (child.kind === "navigator") {
      assertUniqueChildNames(child);
    }
  }
}
