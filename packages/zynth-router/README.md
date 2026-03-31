# Router

`@zynth/router` provides navigation primitives for Zynth applications built with SolidJS. It keeps navigation state in JavaScript, renders screens through `@zynth/screens`, and exposes typed navigators, hooks, and filesystem-driven routing for stack, tab, and sheet-based flows.

Router supports iOS and Android as primary targets. Web support is partial and follows the adapters provided by the Zynth screen and component layers, with web-specific rendering for headers and tab bars where native containers are not available.

## Basic usage

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  useNavigation,
} from "@zynth/router";
import { View, Text, Button } from "@zynth/components";

type RootStackParams = {
  Home: undefined;
  Details: { itemId: string };
};

const Stack = createStackNavigator<RootStackParams>();

function HomeScreen() {
  const navigation = useNavigation<RootStackParams>();

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 16 }}>Home</Text>
      <Button onPress={() => navigation.navigate("Details", { itemId: "42" })}>
        Open details
      </Button>
    </View>
  );
}

function DetailsScreen() {
  return (
    <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 24 }}>Details</Text>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "Overview" }}
        />
        <Stack.Screen
          name="Details"
          component={DetailsScreen}
          options={{ title: "Item", animation: "push" }}
          initialParams={{ itemId: "initial" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Advanced examples

### Stack and tabs together

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  createTabNavigator,
} from "@zynth/router";

type RootTabs = {
  Feed: undefined;
  Settings: undefined;
};

type FeedStack = {
  FeedHome: undefined;
  Article: { slug: string };
};

const Tabs = createTabNavigator<RootTabs>();
const Stack = createStackNavigator<FeedStack>();

function FeedNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="FeedHome" component={FeedHomeScreen} />
      <Stack.Screen
        name="Article"
        component={ArticleScreen}
        options={{ presentation: "push", animation: "push" }}
      />
    </Stack.Navigator>
  );
}

export function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator
        tabBarOptions={{
          tabBarActiveTintColor: "#111827",
          tabBarInactiveTintColor: "#6b7280",
        }}
      >
        <Tabs.Screen
          name="Feed"
          component={FeedNavigator}
          options={{
            title: "Feed",
            tab: {
              label: "Feed",
              icon: { systemName: "newspaper" },
            },
          }}
        />
        <Tabs.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: "Settings",
            tab: {
              label: "Settings",
              icon: { systemName: "gearshape" },
            },
          }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```

### Filesystem router

```tsx
import { NavigationContainer, createFileSystemRouter } from "@zynth/router";
import routes from "@zynth/router/fs-routes";

const AppRouter = createFileSystemRouter(routes);

export default function App() {
  return (
    <NavigationContainer>
      <AppRouter />
    </NavigationContainer>
  );
}
```

### Bottom sheet flows

BottomSheet navigation is experimental and currently unstable. Use it with caution in production code.

```tsx
import { NavigationContainer, createBottomSheetNavigator } from "@zynth/router";

type SheetRoutes = {
  Filters: undefined;
  Sort: undefined;
};

const Sheet = createBottomSheetNavigator<SheetRoutes>();

export function FiltersSheet() {
  return (
    <NavigationContainer>
      <Sheet.Navigator bottomSheetOptions={{ snapPoints: ["40%", "80%"] }}>
        <Sheet.Screen
          name="Filters"
          component={FiltersScreen}
          options={{ title: "Filters" }}
        />
        <Sheet.Screen
          name="Sort"
          component={SortScreen}
          options={{
            title: "Sort",
            bottomSheet: { initialSnapIndex: 1 },
          }}
        />
      </Sheet.Navigator>
    </NavigationContainer>
  );
}
```

## Special cases and unusual features

- Navigators are typed from your route map, so `navigate`, `push`, `replace`, screen names, and route params stay aligned with a single source of truth.
- Tabs keep their own history. Calling `goBack()` inside a tab navigator returns to the previously selected tab when history is available.
- Filesystem routing supports `_layout.stack.*` and `_layout.tabs.*` conventions, `index.*` route resolution, and pathless `(group)` segments through the generated manifest.
- BottomSheet navigation is experimental and unstable. The API surface is available, but compatibility and behavior may change.
- `useHeaderMetrics()` and `useTabBarMetrics()` expose layout measurements for content that needs to sit below headers or above tab bars.
- Web support is partial. Stack and tab flows render on the web, but native headers, tab bars, and sheet presentation may differ from iOS and Android.

## API Reference

### Main exports

- `NavigationContainer`
- `createStackNavigator`
- `createTabNavigator`
- `createBottomSheetNavigator` (experimental)
- `createFileSystemRouter`
- `createRouter`
- `Stack`, `Tabs`, `BottomSheet` (`BottomSheet` is experimental)
- `useNavigation`
- `useRoute`
- `useParams`
- `useRouteName`
- `useIsFocused`
- `createFocusEffect`
- `createBeforeRemove`
- `useNavigationState`
- `useScreenOptions`
- `useHeaderMetrics`
- `useTabBarMetrics`

### Documentation map

- [Getting Started](./docs/getting-started)
- [Hooks](./docs/hooks)
- [Filesystem Router](./docs/filesystem-router)
- [Stack Navigator](/docs/stack-navigator)
- [Tab Navigator](./docs/tab-navigator)
- [Nested Navigators](./docs/nested-navigators)
- [TypeScript](./docs/typescript)
- [API Reference](./docs/api-reference)
