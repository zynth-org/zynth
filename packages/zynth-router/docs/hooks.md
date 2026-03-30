# Hooks

Router hooks expose navigation helpers, route data, focus state, screen options, and layout measurements from the current navigator context. They are designed for use inside screen components rendered by stack, tab, or bottom-sheet navigators.

Most hooks return accessors or tuples that fit directly into SolidJS reactive code. This keeps route state readable without introducing additional wrapper state in the component.

## Basic usage

```tsx
import { useNavigation, useRoute } from "@zynth/router";
import { Button, Text, View } from "@zynth/components";

type StackParams = {
  Home: undefined;
  Details: { id: string };
};

function HomeScreen() {
  const navigation = useNavigation<StackParams>();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Button onPress={() => navigation.navigate("Details", { id: "123" })}>
        Open details
      </Button>
    </View>
  );
}

function DetailsScreen() {
  const route = useRoute<StackParams, "Details">();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>Current id: {route.params().id}</Text>
    </View>
  );
}
```

## Advanced examples

### Reading and updating params with `useParams`

```tsx
import { useParams } from "@zynth/router";
import { Button, Text, View } from "@zynth/components";

type DetailsParams = {
  Details: { id: string; mode?: "summary" | "full" };
};

function DetailsScreen() {
  const [params, setParams] = useParams<DetailsParams["Details"]>();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>{params().id}</Text>
      <Button onPress={() => setParams({ mode: "full" })}>
        Show full mode
      </Button>
    </View>
  );
}
```

### Updating screen options reactively

```tsx
import { createEffect, createSignal } from "solid-js";
import { useScreenOptions } from "@zynth/router";

function EditableTitleScreen() {
  const [title, setTitle] = createSignal("Draft");
  const [, setOptions] = useScreenOptions();

  createEffect(() => {
    setOptions({ title: title() });
  });

  return null;
}
```

### Focus-aware work

```tsx
import { createFocusEffect, useIsFocused } from "@zynth/router";
import { createEffect } from "solid-js";

function FeedScreen() {
  const isFocused = useIsFocused();

  createFocusEffect(() => {
    refreshFeed();
  });

  createEffect(() => {
    if (!isFocused()) {
      pauseFeedAnimations();
    }
  });

  return null;
}
```

### Layout metrics for headers and tab bars

```tsx
import { useHeaderMetrics, useTabBarMetrics } from "@zynth/router";
import { View } from "@zynth/components";

function ScreenLayout() {
  const header = useHeaderMetrics();
  const tabBar = useTabBarMetrics();

  return (
    <View
      style={{
        flex: 1,
        paddingTop: header().height,
        paddingBottom: tabBar().height,
      }}
    />
  );
}
```

## Special cases and unusual features

- `useNavigation()` resolves the current navigator first and bubbles unknown routes to a parent navigator when one is available.
- `useParams()` returns a tuple, not a single accessor. The first item is the params accessor and the second updates the current route params.
- `useScreenOptions()` also returns a tuple. The setter merges the provided options into the current route options.
- `useNavigationState()` exposes the full reactive state tree for the current navigator and is useful for custom navigation UI.
- `createBeforeRemove()` is part of the public router surface for removal interception flows.

## API Reference

### `useNavigation<ParamList>()`

Returns `NavigationHelpers<ParamList>`.

Methods:

- `navigate(name, params?)`
- `push(name, params?)`
- `pop(count?)`
- `popToTop()`
- `goBack()`
- `replace(name, params?)`
- `reset(state)`
- `setParams(params)`
- `setOptions(options)`
- `canGoBack()`
- `getParent()`
- `isFocused()`

### `useRoute<ParamList, RouteName>()`

Returns:

- `key: string`
- `name: RouteName`
- `params: Accessor<ParamList[RouteName]>`
- `setParams(params: Partial<ParamList[RouteName]>)`

### `useParams<Params>()`

Returns:

- `[Accessor<Params>, (params: Partial<Params>) => void]`

### `useRouteName()`

Returns:

- `string`

### `useIsFocused()`

Returns:

- `Accessor<boolean>`

### `createFocusEffect(callback)`

Parameters:

- `callback: () => void | (() => void)`

### `createBeforeRemove(handler)`

Parameters:

- `handler: BeforeRemoveHandler`

### `useNavigationState<ParamList>()`

Returns:

- `Accessor<NavigationState<ParamList>>`

### `useScreenOptions()`

Returns:

- `[() => ScreenOptions, (options: ScreenOptions) => void]`

### `useHeaderMetrics(extraHeight?)`

Returns:

- `Accessor<{ height: number; inset: number }>`

### `useTabBarMetrics(extraHeight?)`

Returns:

- `Accessor<{ height: number; inset: number }>`
