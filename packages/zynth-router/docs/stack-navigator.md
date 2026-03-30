# Stack Navigator

`createStackNavigator()` builds a typed stack flow where screens are pushed, replaced, popped, and reset through a shared navigation context. Stack screens can define headers, presentation modes, animations, and per-screen initial params.

Stacks are the default choice for linear flows such as details pages, drill-down interfaces, onboarding, and modal presentation layered over a main route sequence.

## Basic usage

```tsx
import { createStackNavigator } from "@zynth/router";

type StackParams = {
  Home: undefined;
  Details: { id: string };
  Settings: undefined;
  Compose: undefined;
};

const Stack = createStackNavigator<StackParams>();

function AppStack() {
  return (
    <Stack.Navigator initialRouteName="Home">
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Details" component={DetailsScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
```

## Advanced examples

### Default screen options

```tsx
<Stack.Navigator
  screenOptions={{
    headerShown: true,
    headerBackgroundColor: "#ffffff",
    headerTintColor: "#111827",
    headerShadowVisible: true,
  }}
>
  <Stack.Screen name="Home" component={HomeScreen} />
  <Stack.Screen name="Details" component={DetailsScreen} />
</Stack.Navigator>
```

### Per-screen presentation and animation

```tsx
<Stack.Screen
  name="Details"
  component={DetailsScreen}
  options={{
    title: "Details",
    animation: "zoom",
    presentation: "zoom",
    gestureEnabled: true,
  }}
/>

<Stack.Screen
  name="Compose"
  component={ComposeScreen}
  options={{
    title: "Compose",
    presentation: "modal",
    animation: "modal",
    headerShown: false,
  }}
/>
```

### Dynamic header content

```tsx
import { createEffect } from "solid-js";
import { Button } from "@zynth/components";
import { useNavigation } from "@zynth/router";

function DetailsScreen() {
  const navigation = useNavigation<StackParams>();

  createEffect(() => {
    navigation.setOptions({
      title: "Current item",
      headerRight: () => (
        <Button variant="ghost" onPress={() => saveCurrentItem()}>
          Save
        </Button>
      ),
    });
  });

  return null;
}
```

### Stack actions

```tsx
import { useNavigation } from "@zynth/router";

function Actions() {
  const navigation = useNavigation<StackParams>();

  navigation.navigate("Details", { id: "42" });
  navigation.push("Details", { id: "84" });
  navigation.replace("Settings");
  navigation.pop();
  navigation.popToTop();
  navigation.reset({
    index: 0,
    routes: [{ name: "Home" }],
  });

  return null;
}
```

## Special cases and unusual features

- `navigate()` reuses an existing route in the stack when the route name already exists. Use `push()` when a new route instance is required.
- `initialRouteName` is validated against registered screens. If it does not match, the stack falls back to the first registered screen.
- Screen options can be provided per navigator, per screen, and updated at runtime through `navigation.setOptions()` or `useScreenOptions()`.
- Header rendering differs by platform. iOS can use native header integration, while web and some non-native contexts render headers in JavaScript.

## API Reference

### `createStackNavigator<ParamList>()`

Returns a typed object with:

- `Navigator`
- `Screen`

### `Stack.Navigator`

Props:

- `id?: string`
- `initialRouteName?: string`
- `screenOptions?: ScreenOptions | (() => ScreenOptions | undefined)`
- `children?: JSX.Element`

### `Stack.Screen`

Props:

- `name: RouteName`
- `component: ScreenComponent<ParamList, RouteName>`
- `options?: ScreenOptions | (() => ScreenOptions | undefined)`
- `initialParams?: ParamList[RouteName]`

### `ScreenOptions`

Header:

- `title?: string`
- `subtitle?: string`
- `largeTitle?: boolean`
- `headerShown?: boolean`
- `headerTintColor?: string`
- `headerTitleColor?: string`
- `headerBackgroundColor?: string`
- `headerStyle?: "default" | "liquidGlass"`
- `headerBlurEffect?: "systemUltraThin" | "systemThin" | "systemChromatic"`
- `headerTransparent?: boolean`
- `headerShadowVisible?: boolean`
- `userInterfaceStyle?: "dark" | "light" | "system"`
- `headerBackVisible?: boolean`
- `headerLeft?: (props: HeaderLeftProps) => JSX.Element`
- `headerRight?: () => JSX.Element`
- `headerRightButton?: HeaderRightButtonOptions`
- `headerTitle?: () => JSX.Element`

Transitions and content:

- `gestureEnabled?: boolean`
- `presentation?: "push" | "modal" | "transparentModal" | "fullScreen" | "zoom"`
- `animation?: "push" | "modal" | "zoom" | "fade" | "none"`
- `animationEnabled?: boolean`
- `contentBackgroundColor?: string`
