# TypeScript Support

`@rune/memory-router` is built with TypeScript and provides full type safety for routes, params, and navigation.

## Defining Route Types

Define your route parameter types as an interface or type:

```tsx
type RootStackParams = {
  Home: undefined; // No params
  Profile: { userId: string }; // Required param
  Settings: { section?: string }; // Optional param
  Details: { id: string; highlight: boolean }; // Multiple params
};
```

### Rules for Route Types

1. **No params**: Use `undefined`
2. **Required params**: Define as regular properties
3. **Optional params**: Use `?` operator
4. **Multiple params**: Define multiple properties

## Type-Safe Navigators

Pass your route types to the navigator factory:

```tsx
import { createStackNavigator } from "@rune/memory-router";

const Stack = createStackNavigator<RootStackParams>();

// Now Stack.Screen and navigation are fully typed
<Stack.Navigator>
  <Stack.Screen name="Home" component={HomeScreen} />
  <Stack.Screen name="Profile" component={ProfileScreen} />
</Stack.Navigator>;
```

## Type-Safe Navigation

### useNavigation Hook

Provide route types to get type-safe navigation methods:

```tsx
import { useNavigation } from "@rune/memory-router";

function MyScreen() {
  const navigation = useNavigation<RootStackParams>();

  // ✅ Valid - Home takes no params
  navigation.navigate("Home");

  // ❌ Error - Profile requires userId
  navigation.navigate("Profile");

  // ✅ Valid - Profile with required param
  navigation.navigate("Profile", { userId: "123" });

  // ✅ Valid - Settings with optional param
  navigation.navigate("Settings");
  navigation.navigate("Settings", { section: "privacy" });

  // ❌ Error - Invalid param name
  navigation.navigate("Settings", { invalid: "value" });

  // ❌ Error - Invalid route name
  navigation.navigate("NonExistent");
}
```

### useRoute Hook

Provide both route types and current route name:

```tsx
import { useRoute } from "@rune/memory-router";

function ProfileScreen() {
  const route = useRoute<RootStackParams, "Profile">();

  // ✅ Typed params
  const { userId } = route.params();

  // userId is inferred as string
  console.log(userId.toUpperCase());
}
```

### useParams Hook

Shorthand with the same type safety:

```tsx
import { useParams } from "@rune/memory-router";

function DetailsScreen() {
  const params = useParams<RootStackParams, "Details">();

  // ✅ Both properties are typed
  const { id, highlight } = params();

  // id: string
  // highlight: boolean
}
```

## Type-Safe Screen Components

### Option 1: Inline Types

```tsx
function ProfileScreen() {
  const route = useRoute<RootStackParams, "Profile">();
  const navigation = useNavigation<RootStackParams>();

  const { userId } = route.params();

  return <View>{/* ... */}</View>;
}
```

### Option 2: Component Props

Define a props type for screens that need navigation and route:

```tsx
import type { NavigationHelpers, RouteProp } from "@rune/memory-router";

type ProfileScreenProps = {
  navigation: NavigationHelpers<RootStackParams>;
  route: RouteProp<RootStackParams, "Profile">;
};

function ProfileScreen(props: ProfileScreenProps) {
  const { userId } = props.route.params();

  return (
    <Pressable onPress={() => props.navigation.goBack()}>
      <Text>User: {userId}</Text>
    </Pressable>
  );
}
```

### Option 3: Generic Screen Component Type

Create a reusable type for screen components:

```tsx
import type { NavigationHelpers, RouteProp } from "@rune/memory-router";

type ScreenComponent<
  ParamList extends Record<string, any>,
  RouteName extends keyof ParamList
> = (props: {
  navigation: NavigationHelpers<ParamList>;
  route: RouteProp<ParamList, RouteName>;
}) => JSX.Element;

const ProfileScreen: ScreenComponent<RootStackParams, "Profile"> = (props) => {
  const { userId } = props.route.params();

  return <View>{/* ... */}</View>;
};
```

## Type-Safe Screen Options

Screen options are also typed:

```tsx
import type { ScreenOptions } from "@rune/memory-router";

const screenOptions: ScreenOptions = {
  title: "My Screen",
  headerShown: true,
  headerBackgroundColor: "#007AFF",
  animation: "push",
  presentation: "modal",
};

<Stack.Screen
  name="Profile"
  component={ProfileScreen}
  options={screenOptions}
/>;
```

Dynamic options with full typing:

```tsx
<Stack.Screen
  name="Profile"
  component={ProfileScreen}
  options={() => ({
    title: "Profile",
    headerShown: true,
    // TypeScript will enforce valid option keys
  })}
/>
```

## Nested Navigators with Types

Define separate types for each navigator level:

```tsx
// Tab-level routes
type AppTabParams = {
  HomeTab: undefined;
  ProfileTab: undefined;
};

// Stack routes for Home tab
type HomeStackParams = {
  HomeMain: undefined;
  Details: { id: string };
};

// Stack routes for Profile tab
type ProfileStackParams = {
  ProfileMain: undefined;
  Settings: undefined;
};

const Tabs = createTabNavigator<AppTabParams>();
const HomeStack = createStackNavigator<HomeStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

function HomeTabScreen() {
  return (
    <HomeStack.Navigator>
      <HomeStack.Screen name="HomeMain" component={HomeMainScreen} />
      <HomeStack.Screen name="Details" component={DetailsScreen} />
    </HomeStack.Navigator>
  );
}

function HomeMainScreen() {
  // Type-safe navigation within Home stack
  const stackNav = useNavigation<HomeStackParams>();

  // Type-safe navigation to different tab
  const tabNav = useNavigation<AppTabParams>();

  return (
    <View>
      <Pressable onPress={() => stackNav.navigate("Details", { id: "1" })}>
        <Text>View Details</Text>
      </Pressable>

      <Pressable onPress={() => tabNav.navigate("ProfileTab")}>
        <Text>Go to Profile Tab</Text>
      </Pressable>
    </View>
  );
}
```

## Advanced Types

### NavigationHelpers

The type for navigation object returned by `useNavigation`:

```tsx
import type { NavigationHelpers } from "@rune/memory-router";

function useMyNavigationHook(): NavigationHelpers<RootStackParams> {
  return useNavigation<RootStackParams>();
}
```

### RouteProp

The type for route object returned by `useRoute`:

```tsx
import type { RouteProp } from "@rune/memory-router";

function useMyRouteHook(): RouteProp<RootStackParams, "Profile"> {
  return useRoute<RootStackParams, "Profile">();
}
```

### NavigationState

The type for navigation state:

```tsx
import type { NavigationState } from "@rune/memory-router";

function useNavigationHistory(): NavigationState {
  return useNavigationState();
}
```

### ScreenOptions

The type for screen options:

```tsx
import type { ScreenOptions } from "@rune/memory-router";

const defaultOptions: ScreenOptions = {
  headerShown: true,
  title: "Default Title",
};
```

### TabBarOptions

The type for tab bar options:

```tsx
import type { TabBarOptions } from "@rune/memory-router";

const tabBarOptions: TabBarOptions = {
  tabBarBackgroundColor: "#000",
  tabBarActiveTintColor: "#007AFF",
  tabBarInactiveTintColor: "#8E8E93",
};
```

## Type Utilities

### Extract Param Type

Get the param type for a specific route:

```tsx
type ProfileParams = RootStackParams["Profile"];
// Result: { userId: string }
```

### Check if Route Has Params

```tsx
type HomeParams = RootStackParams["Home"];
// Result: undefined

type HasParams<T> = T extends undefined ? false : true;

type HomeHasParams = HasParams<HomeParams>; // false
type ProfileHasParams = HasParams<ProfileParams>; // true
```

## Common TypeScript Patterns

### Shared Navigation Type

Define navigation type once and reuse:

```tsx
type RootNavigation = NavigationHelpers<RootStackParams>;

function useRootNavigation(): RootNavigation {
  return useNavigation<RootStackParams>();
}

// Use in any screen
function MyScreen() {
  const navigation = useRootNavigation();
  // Fully typed!
}
```

### Route Guard Hook

Create a typed hook that ensures route params exist:

```tsx
function useProfileParams() {
  const route = useRoute<RootStackParams, "Profile">();
  const params = route.params();

  if (!params.userId) {
    throw new Error("userId is required");
  }

  return params as Required<typeof params>;
}

function ProfileScreen() {
  const { userId } = useProfileParams();
  // userId is guaranteed to exist
}
```

### Navigation HOC

Create a higher-order component with typed navigation:

```tsx
function withNavigation<P extends object>(
  Component: (props: P & { navigation: RootNavigation }) => JSX.Element
) {
  return (props: P) => {
    const navigation = useNavigation<RootStackParams>();
    return <Component {...props} navigation={navigation} />;
  };
}

const MyScreenWithNav = withNavigation(MyScreen);
```

## Troubleshooting

### Generic Type Not Inferred

If TypeScript doesn't infer types correctly:

```tsx
// ❌ May not work
const navigation = useNavigation();

// ✅ Always specify types explicitly
const navigation = useNavigation<RootStackParams>();
```

### Route Name Type Errors

Ensure route names match exactly:

```tsx
type RootStackParams = {
  home: undefined; // lowercase
};

// ❌ Error - case mismatch
navigation.navigate("Home");

// ✅ Correct
navigation.navigate("home");
```

### Missing Params Error

If you get errors about missing params:

```tsx
type RootStackParams = {
  Profile: { userId: string }; // required
};

// ❌ Error - missing userId
navigation.navigate("Profile");

// ✅ Provide required params
navigation.navigate("Profile", { userId: "123" });

// Alternative: Make param optional if appropriate
type RootStackParams = {
  Profile: { userId?: string }; // optional
};
```

### Nested Navigator Types

Each navigator needs its own type:

```tsx
// ❌ Don't reuse types across navigators
const Stack1 = createStackNavigator<SharedParams>();
const Stack2 = createStackNavigator<SharedParams>();

// ✅ Use separate types
const Stack1 = createStackNavigator<Stack1Params>();
const Stack2 = createStackNavigator<Stack2Params>();
```

## Example: Fully Typed App

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  createTabNavigator,
  useNavigation,
  useRoute,
  type NavigationHelpers,
  type RouteProp,
} from "@rune/memory-router";

// Define all route types
type RootStackParams = {
  Main: undefined;
  Auth: undefined;
};

type MainTabParams = {
  HomeTab: undefined;
  ProfileTab: undefined;
};

type HomeStackParams = {
  HomeMain: undefined;
  Details: { id: string; title: string };
};

type ProfileStackParams = {
  ProfileMain: undefined;
  Settings: undefined;
  EditProfile: { initialName: string };
};

// Create navigators
const RootStack = createStackNavigator<RootStackParams>();
const MainTabs = createTabNavigator<MainTabParams>();
const HomeStack = createStackNavigator<HomeStackParams>();
const ProfileStack = createStackNavigator<ProfileStackParams>();

// Type-safe screens
function HomeMainScreen() {
  const navigation = useNavigation<HomeStackParams>();

  return (
    <Pressable
      onPress={() =>
        navigation.navigate("Details", {
          id: "1",
          title: "Product",
        })
      }
    >
      <Text>View Details</Text>
    </Pressable>
  );
}

function DetailsScreen() {
  const route = useRoute<HomeStackParams, "Details">();
  const { id, title } = route.params();

  return (
    <View>
      <Text>ID: {id}</Text>
      <Text>Title: {title}</Text>
    </View>
  );
}

// Export typed navigation helpers
export function useHomeNavigation() {
  return useNavigation<HomeStackParams>();
}

export function useProfileNavigation() {
  return useNavigation<ProfileStackParams>();
}

export function useTabNavigation() {
  return useNavigation<MainTabParams>();
}

export function useRootNavigation() {
  return useNavigation<RootStackParams>();
}
```

## Next Steps

- Check the [API Reference](./api-reference.md)
- Review [Navigation Hooks](./hooks.md)
- Explore [Stack Navigator](./stack-navigator.md)
- Learn about [Nested Navigators](./nested-navigators.md)
