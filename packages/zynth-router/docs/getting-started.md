# Getting Started

`@zynth/router` structures application navigation around typed route maps, navigator components, and reactive hooks. A router tree starts with `NavigationContainer`, then composes stack, tab, or bottom-sheet navigators depending on the flow you need to model.

The package is designed to work naturally with SolidJS screen components and the rest of the Zynth runtime. It can be used directly through navigator factories or through a generated filesystem manifest.

## Basic usage

```tsx
import { NavigationContainer, createStackNavigator } from "@zynth/router";

type RootStackParams = {
  Home: undefined;
  Profile: { userId: string };
};

const Stack = createStackNavigator<RootStackParams>();

export function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "Home" }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ title: "Profile" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Advanced examples

### Navigating from a screen

```tsx
import { useNavigation } from "@zynth/router";
import { View, Text, Button } from "@zynth/components";

function HomeScreen() {
  const navigation = useNavigation<RootStackParams>();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={{ fontSize: 24, marginBottom: 16 }}>Home</Text>
      <Button onPress={() => navigation.navigate("Profile", { userId: "42" })}>
        Open profile
      </Button>
    </View>
  );
}
```

### Reading route params

```tsx
import { useRoute } from "@zynth/router";
import { Text, View } from "@zynth/components";

function ProfileScreen() {
  const route = useRoute<RootStackParams, "Profile">();
  const params = () => route.params();

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text>User: {params().userId}</Text>
    </View>
  );
}
```

### Filesystem router entry point

```tsx
import { NavigationContainer, createFileSystemRouter } from "@zynth/router";
import routes from "@zynth/router/fs-routes";

const Router = createFileSystemRouter(routes);

export function App() {
  return (
    <NavigationContainer>
      <Router />
    </NavigationContainer>
  );
}
```

## Special cases and unusual features

- `NavigationContainer` accepts `initialState`, `onStateChange`, `onReady`, and `linking` when navigation state needs to be restored or observed externally.
- Stack and bottom-sheet navigators keep a route stack. Tab navigators keep one route per tab plus tab-selection history.
- BottomSheet navigation is experimental and unstable.
- Filesystem routing generates a navigator manifest ahead of time. The runtime `createFileSystemRouter()` call receives that manifest and renders the navigator tree.
- Web support is partial. When native containers are unavailable, the router falls back to JavaScript-rendered headers and tab bars.

## API Reference

### `NavigationContainer`

- `children?: JSX.Element`
- `initialState?: NavigationState`
- `onStateChange?: (state: NavigationState) => void`
- `onReady?: () => void`
- `linking?: LinkingOptions`

### Navigator factories

- `createStackNavigator<ParamList>()`
- `createTabNavigator<ParamList>()`
- `createBottomSheetNavigator<ParamList>()` — experimental
- `createFileSystemRouter(manifest: FileSystemRouterManifest)`
- `createRouter<ParamList>()`

### Related pages

- [Hooks](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/hooks.md)
- [Filesystem Router](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/filesystem-router.md)
- [Stack Navigator](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/stack-navigator.md)
- [Tab Navigator](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/tab-navigator.md)
- [Nested Navigators](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/nested-navigators.md)
- [TypeScript](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/typescript.md)
- [API Reference](/Users/ignaciozsabo/code/zynth/framework/packages/zynth-router/docs/api-reference.md)
