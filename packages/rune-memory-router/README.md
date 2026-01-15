# @rune/memory-router

A robust, type-safe navigation library for Rune applications.

Designed to mimic the API of React Navigation, `rune-memory-router` manages navigation state in JavaScript memory while driving native transitions via `@rune/screens`. This decoupling makes it ideal for the Rune Hypervisor and multi-app environments where a single native `UINavigationController` cannot be shared.

## Installation

This package is included by default in the `app` template.

```bash
yarn add @rune/memory-router
```

## Quick Start

```tsx
import { NavigationContainer, createStackNavigator } from "@rune/memory-router";
import { HomeScreen, DetailsScreen } from "./screens";

// 1. Define your route params
export type RootStackParams = {
  Home: undefined;
  Details: { itemId: string; title?: string };
};

// 2. Create the navigator
const Stack = createStackNavigator<RootStackParams>();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ title: "Welcome" }}
        />
        <Stack.Screen 
          name="Details" 
          component={DetailsScreen}
          options={({ route }) => ({ title: route.params.title ?? "Details" })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## API Reference

### Navigators

#### `createStackNavigator<ParamList>()`
Creates a stack navigator that manages a stack of screens. Transitions are animated (push, pop).

**Props (`Stack.Navigator`):**
*   `initialRouteName`: The name of the route to render first.
*   `screenOptions`: Default options for all screens.

**Props (`Stack.Screen`):**
*   `name`: Route name (key of `ParamList`).
*   `component`: The component to render.
*   `options`: Screen-specific options (title, header, etc.).
*   `initialParams`: Default params for the route.

#### `createTabNavigator<ParamList>()`
Creates a bottom tab navigator.

**Props (`Tab.Navigator`):**
*   `tabBarOptions`: Global tab bar styling (`activeTintColor`, `backgroundColor`).
*   `tabBar`: Custom tab bar component function.

**Options (`Tab.Screen` options):**
*   `tab`: Configuration object:
    *   `label`: Text label for the tab.
    *   `icon`: Icon factory or descriptor.
    *   `badge`: Badge count/text.

#### `createBottomSheetNavigator<ParamList>()`
Creates a stack navigator that lives inside a native bottom sheet.

**Props (`BottomSheet.Navigator`):**
*   `bottomSheetOptions`: Global sheet config (`snapPoints`, `initialSnapIndex`).

### Hooks

#### `useNavigation<T>()`
Returns the `navigation` object to dispatch actions.

```tsx
const navigation = useNavigation();
navigation.navigate("Details", { itemId: "123" });
navigation.goBack();
```

**Methods:**
*   `navigate(name, params)`: Navigate to a route.
*   `push(name, params)`: Push a new instance of a route.
*   `goBack()`: Pop the current screen.
*   `popToTop()`: Go to the first screen.
*   `setOptions(options)`: Update the current screen's options.

#### `useRoute<T>()`
Returns the current route's state (key, name, params).

```tsx
const route = useRoute<RouteProps>();
console.log(route.params().itemId);
```

#### `useFocusEffect(callback)`
Runs a side-effect when the screen comes into focus.

```tsx
useFocusEffect(() => {
  console.log("Screen focused");
  return () => console.log("Screen blurred");
});
```

### Types

#### `ScreenOptions`
Common options for screens.

| Property | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | Header title. |
| `headerShown` | `boolean` | Show/hide the header. |
| `headerRight` | `() => JSX.Element` | Custom right header component. |
| `presentation` | `'card' \| 'modal'` | Screen transition style. |
| `animation` | `'push' \| 'fade' \| 'none'` | Specific animation type. |

#### `RouteParamList`
A TypeScript type defining the mapping of route names to their parameters.

```ts
type AppParams = {
  Login: undefined;
  Profile: { userId: number };
};
```