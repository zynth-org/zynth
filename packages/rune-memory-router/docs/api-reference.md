# API Reference

Complete API reference for `@rune/memory-router`.

## Exports

```tsx
// Navigation Container
export { NavigationContainer } from "./NavigationContainer";

// Router Factories
export { createStackNavigator, createTabNavigator } from "./createRouter";

// Navigators
export { Stack, StackNavigator, StackScreen } from "./navigators";
export { Tabs, TabsNavigator, TabScreen } from "./navigators";

// Hooks
export {
  useNavigation,
  useRoute,
  useParams,
  useRouteName,
  useIsFocused,
  useFocusEffect,
  useBeforeRemove,
  useNavigationState,
  useScreenOptions,
} from "./hooks";

// Types
export type {
  NavigationHelpers,
  RouteProp,
  NavigationState,
  ScreenOptions,
  TabBarOptions,
  RouteParamList,
} from "./types";
```

## Components

### NavigationContainer

Root container that holds navigation state.

```tsx
<NavigationContainer>{/* Navigators go here */}</NavigationContainer>
```

**Props:** None

### Stack.Navigator

Creates a stack-based navigation flow.

```tsx
<Stack.Navigator
  initialRouteName="Home"
  screenOptions={{
    headerShown: true,
    headerBackgroundColor: "#fff",
  }}
>
  {/* Stack.Screen components */}
</Stack.Navigator>
```

**Props:**

| Prop               | Type                                     | Default        | Description                     |
| ------------------ | ---------------------------------------- | -------------- | ------------------------------- |
| `initialRouteName` | `keyof ParamList`                        | First screen   | Initial route to display        |
| `screenOptions`    | `ScreenOptions \| (() => ScreenOptions)` | `{}`           | Default options for all screens |
| `children`         | `JSX.Element`                            | Required       | Stack.Screen components         |
| `id`               | `string`                                 | Auto-generated | Unique navigator ID             |

### Stack.Screen

Defines a screen in the stack.

```tsx
<Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={{
    title: "Details",
    headerShown: true,
    animation: "push",
  }}
/>
```

**Props:**

| Prop            | Type                                     | Description                           |
| --------------- | ---------------------------------------- | ------------------------------------- |
| `name`          | `keyof ParamList`                        | Route name (must match ParamList key) |
| `component`     | `ComponentType`                          | Screen component to render            |
| `options`       | `ScreenOptions \| (() => ScreenOptions)` | Screen-specific options               |
| `initialParams` | `ParamList[RouteName]`                   | Default params for this route         |

### Tabs.Navigator

Creates a tab-based navigation flow.

```tsx
<Tabs.Navigator
  initialRouteName="Home"
  tabBarOptions={{
    tabBarBackgroundColor: "#fff",
    tabBarActiveTintColor: "#007AFF",
  }}
  screenOptions={{
    headerShown: true,
  }}
>
  {/* Tabs.Screen components */}
</Tabs.Navigator>
```

**Props:**

| Prop               | Type                                     | Default         | Description                  |
| ------------------ | ---------------------------------------- | --------------- | ---------------------------- |
| `initialRouteName` | `keyof ParamList`                        | First tab       | Initial tab to display       |
| `screenOptions`    | `ScreenOptions \| (() => ScreenOptions)` | `{}`            | Default options for all tabs |
| `tabBarOptions`    | `TabBarOptions`                          | Default styles  | Tab bar styling options      |
| `tabBar`           | `(props: TabBarProps) => JSX.Element`    | Default tab bar | Custom tab bar component     |
| `children`         | `JSX.Element`                            | Required        | Tabs.Screen components       |
| `id`               | `string`                                 | Auto-generated  | Unique navigator ID          |

### Tabs.Screen

Defines a tab in the navigator.

```tsx
<Tabs.Screen
  name="Home"
  component={HomeScreen}
  options={{
    title: "Home",
    tab: {
      label: "Home",
      icon: HomeIcon,
      badge: "3",
    },
  }}
/>
```

**Props:**

| Prop            | Type                                     | Description                           |
| --------------- | ---------------------------------------- | ------------------------------------- |
| `name`          | `keyof ParamList`                        | Route name (must match ParamList key) |
| `component`     | `ComponentType`                          | Screen component to render            |
| `options`       | `ScreenOptions \| (() => ScreenOptions)` | Tab-specific options                  |
| `initialParams` | `ParamList[RouteName]`                   | Default params for this route         |

## Factory Functions

### createStackNavigator\<ParamList\>()

Creates a typed stack navigator.

```tsx
type StackParams = {
  Home: undefined;
  Details: { id: string };
};

const Stack = createStackNavigator<StackParams>();
```

**Returns:** `{ Navigator, Screen }`

### createTabNavigator\<ParamList\>()

Creates a typed tab navigator.

```tsx
type TabParams = {
  Home: undefined;
  Profile: { userId: string };
};

const Tabs = createTabNavigator<TabParams>();
```

**Returns:** `{ Navigator, Screen }`

## Hooks

### useNavigation\<ParamList\>()

Returns navigation helpers for the current screen.

```tsx
const navigation = useNavigation<ParamList>();
```

**Returns:** [`NavigationHelpers<ParamList>`](#navigationhelpers)

### useRoute\<ParamList, RouteName\>()

Returns the current route object.

```tsx
const route = useRoute<ParamList, RouteName>();
```

**Returns:** [`RouteProp<ParamList, RouteName>`](#routeprop)

### useParams\<ParamList, RouteName\>()

Returns route params as an Accessor.

```tsx
const params = useParams<ParamList, RouteName>();
const { id } = params();
```

**Returns:** `Accessor<ParamList[RouteName]>`

### useRouteName()

Returns the current route name.

```tsx
const name = useRouteName();
```

**Returns:** `string`

### useIsFocused()

Returns whether the current screen is focused.

```tsx
const isFocused = useIsFocused();
```

**Returns:** `Accessor<boolean>`

### useFocusEffect(effect)

Runs effect when screen gains focus.

```tsx
useFocusEffect(() => {
  // Run on focus
  return () => {
    // Cleanup on unfocus
  };
});
```

**Parameters:**

- `effect: () => void | (() => void)` - Effect to run, optionally returns cleanup

### useBeforeRemove(listener)

Prevents navigation or prompts confirmation.

```tsx
useBeforeRemove((event) => {
  if (hasUnsavedChanges) {
    event.preventDefault();
    // Show dialog...
    event.retry();
  }
});
```

**Parameters:**

- `listener: (event: BeforeRemoveEvent) => void`

**BeforeRemoveEvent:**

```tsx
interface BeforeRemoveEvent {
  preventDefault(): void;
  retry(): void;
  data: {
    action: RouterAction;
  };
}
```

### useNavigationState()

Returns the raw navigation state.

```tsx
const state = useNavigationState();
```

**Returns:** `Accessor<NavigationState>`

### useScreenOptions()

Returns current screen options and setter.

```tsx
const [options, setOptions] = useScreenOptions();
```

**Returns:** `[Accessor<ScreenOptions>, (options: ScreenOptions) => void]`

### useHeaderMetrics()

Returns header dimensions.

```tsx
const headerMetrics = useHeaderMetrics();
const height = headerMetrics().height;
```

**Returns:** `Accessor<HeaderMetrics>`

### useTabBarMetrics()

Returns tab bar dimensions.

```tsx
const tabBarMetrics = useTabBarMetrics();
const height = tabBarMetrics().height;
```

**Returns:** `Accessor<TabBarMetrics>`

## Types

### NavigationHelpers

Navigation methods object.

```tsx
interface NavigationHelpers<ParamList> {
  navigate<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  push<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  pop(count?: number): void;

  goBack(): void;

  replace<RouteName extends keyof ParamList>(
    name: RouteName,
    params?: ParamList[RouteName]
  ): void;

  reset(state: {
    index?: number;
    routes: Array<{ name: keyof ParamList; params?: any }>;
  }): void;

  setParams(params: Partial<ParamList[keyof ParamList]>): void;

  setOptions(options: ScreenOptions): void;

  canGoBack(): boolean;

  getParent(): NavigationHelpers<any> | undefined;

  isFocused(): boolean;
}
```

### RouteProp

Route information object.

```tsx
interface RouteProp<ParamList, RouteName extends keyof ParamList> {
  key: string;
  name: RouteName;
  params: Accessor<ParamList[RouteName]>;
  setParams: (params: Partial<ParamList[RouteName]>) => void;
}
```

### NavigationState

Navigation state structure.

```tsx
interface NavigationState {
  key: string;
  type: "stack" | "tabs";
  index: number;
  routes: RouteNode[];
  history?: Array<{ key: string; type: string }>;
}

interface RouteNode {
  key: string;
  name: string;
  params?: object;
  options?: ScreenOptions;
  type: "stack" | "tabs";
}
```

### ScreenOptions

Screen configuration options.

```tsx
interface ScreenOptions {
  // Header
  title?: string;
  headerShown?: boolean;
  headerBackgroundColor?: string;
  headerTintColor?: string;
  headerShadowVisible?: boolean;

  // Animation
  animation?: "push" | "modal" | "zoom" | "fade" | "none";
  presentation?: "push" | "modal";
  gestureEnabled?: boolean;

  // Tab (for tab screens)
  tab?: TabOptions;
}
```

### TabOptions

Tab-specific options.

```tsx
interface TabOptions {
  label?: string;
  icon?: (props: { active: boolean; color: string }) => JSX.Element;
  badge?: string | number;
  badgeColor?: string;
}
```

### TabBarOptions

Tab bar styling options.

```tsx
interface TabBarOptions {
  tabBarBackgroundColor?: string;
  tabBarActiveTintColor?: string;
  tabBarInactiveTintColor?: string;
  tabBarShowLabels?: boolean;
  tabBarVisible?: boolean;
}
```

### TabBarProps

Props passed to custom tab bar component.

```tsx
interface TabBarProps {
  state: NavigationState;
  navigation: NavigationHelpers<any>;
  descriptors: {
    [key: string]: {
      options: ScreenOptions;
      route: RouteNode;
    };
  };
}
```

### RouteParamList

Base type for route parameter definitions.

```tsx
type RouteParamList = Record<string, object | undefined>;

// Example
type MyRoutes = {
  Home: undefined;
  Profile: { userId: string };
  Settings: { theme?: string };
};
```

### HeaderMetrics

Header dimension information.

```tsx
interface HeaderMetrics {
  height: number;
}
```

### TabBarMetrics

Tab bar dimension information.

```tsx
interface TabBarMetrics {
  height: number;
}
```

## Animation Types

```tsx
type AnimationType = "push" | "modal" | "zoom" | "fade" | "none";
```

| Type      | Behavior                   |
| --------- | -------------------------- |
| `"push"`  | Slide from right (default) |
| `"modal"` | Slide up from bottom       |
| `"zoom"`  | Zoom in/out effect         |
| `"fade"`  | Crossfade transition       |
| `"none"`  | No animation               |

## Presentation Types

```tsx
type PresentationType = "push" | "modal";
```

| Type      | Behavior                                 |
| --------- | ---------------------------------------- |
| `"push"`  | Standard stack navigation                |
| `"modal"` | Modal presentation (typically slides up) |

## Examples

### Complete Stack Example

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  useNavigation,
  useRoute,
  type ScreenOptions,
} from "@rune/memory-router";

type StackParams = {
  Home: undefined;
  Details: { id: string };
};

const Stack = createStackNavigator<StackParams>();

const screenOptions: ScreenOptions = {
  headerShown: true,
  headerBackgroundColor: "#007AFF",
  headerTintColor: "#fff",
};

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Details" component={DetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### Complete Tab Example

```tsx
import {
  NavigationContainer,
  createTabNavigator,
  type TabBarOptions,
} from "@rune/memory-router";

type TabParams = {
  Home: undefined;
  Profile: undefined;
};

const Tabs = createTabNavigator<TabParams>();

const tabBarOptions: TabBarOptions = {
  tabBarBackgroundColor: "#000",
  tabBarActiveTintColor: "#007AFF",
  tabBarInactiveTintColor: "#8E8E93",
};

function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator tabBarOptions={tabBarOptions}>
        <Tabs.Screen
          name="Home"
          component={HomeScreen}
          options={{ tab: { label: "Home", icon: HomeIcon } }}
        />
        <Tabs.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ tab: { label: "Profile", icon: ProfileIcon } }}
        />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```
