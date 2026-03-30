# Nested Navigators

Nested navigators let a route render another navigator as its screen component. This is the standard way to build sectioned applications, tabbed interfaces with local stacks, modal stacks above tabs, and flows that keep local navigation state isolated inside a larger app shell.

`@zynth/router` treats nested navigators as regular screen components, so composition works with stack, tab, and bottom-sheet navigators without introducing a separate container at each level. BottomSheet navigation is experimental and unstable.

## Basic usage

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
const Feed = createStackNavigator<FeedStack>();

function FeedNavigator() {
  return (
    <Feed.Navigator>
      <Feed.Screen name="FeedHome" component={FeedHomeScreen} />
      <Feed.Screen name="Article" component={ArticleScreen} />
    </Feed.Navigator>
  );
}

export function App() {
  return (
    <NavigationContainer>
      <Tabs.Navigator>
        <Tabs.Screen name="Feed" component={FeedNavigator} />
        <Tabs.Screen name="Settings" component={SettingsScreen} />
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
```

## Advanced examples

### Tabs with local stacks

```tsx
type HomeStackParams = {
  HomeMain: undefined;
  Product: { id: string };
};

type ProfileStackParams = {
  ProfileMain: undefined;
  Preferences: undefined;
};

const HomeStack = createStackNavigator<HomeStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

function HomeTab() {
  return (
    <HomeStack.Navigator>
      <HomeStack.Screen name="HomeMain" component={HomeMainScreen} />
      <HomeStack.Screen name="Product" component={ProductScreen} />
    </HomeStack.Navigator>
  );
}

function ProfileTab() {
  return (
    <ProfileStack.Navigator>
      <ProfileStack.Screen name="ProfileMain" component={ProfileMainScreen} />
      <ProfileStack.Screen name="Preferences" component={PreferencesScreen} />
    </ProfileStack.Navigator>
  );
}
```

### Accessing a parent navigator

```tsx
import { useNavigation } from "@zynth/router";
import { Button } from "@zynth/components";

function ProductScreen() {
  const homeNavigation = useNavigation<HomeStackParams>();
  const appNavigation = homeNavigation.getParent();

  return (
    <Button onPress={() => appNavigation?.navigate("Settings")}>
      Open settings tab
    </Button>
  );
}
```

### Modal stack above tabs

```tsx
type RootStackParams = {
  Main: undefined;
  Compose: undefined;
};

const RootStack = createStackNavigator<RootStackParams>();

function App() {
  return (
    <NavigationContainer>
      <RootStack.Navigator>
        <RootStack.Screen
          name="Main"
          component={MainTabs}
          options={{ headerShown: false }}
        />
        <RootStack.Screen
          name="Compose"
          component={ComposeScreen}
          options={{
            presentation: "modal",
            animation: "modal",
            headerShown: false,
          }}
        />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}
```

## Special cases and unusual features

- Nested navigators should share a single top-level `NavigationContainer`. Additional containers are only needed for truly separate navigation trees.
- Unknown routes bubble to a parent navigator. This makes parent-level navigation from nested screens straightforward when the parent owns the destination route.
- Hiding headers at the boundary between nested navigators is often useful to avoid rendering two headers for the same visual hierarchy.
- Filesystem routing uses nested manifest nodes to represent layout boundaries, so navigator nesting can also be expressed through `_layout.*` files.

## API Reference

### Composition rules

- A navigator can be used as the `component` of any `Stack.Screen`, `Tabs.Screen`, or `BottomSheet.Screen`.
- `BottomSheet.Screen` and bottom-sheet navigator composition are experimental and unstable.
- Nested routes keep their own `NavigationState`.
- Parent navigation can be reached through `navigation.getParent()`.

### Common patterns

- Tabs containing stacks
- Root stacks containing tabs
- Modal stacks above a tab shell
- Bottom-sheet flows nested inside stack routes
