# Getting Started

This guide will help you set up and start using `@zynth/memory-router` in your Zynth application.

## Installation

```bash
yarn add @zynth/memory-router
```

The router automatically includes its dependencies:

- `@zynth/screens` - Screen primitives for transitions
- `@zynth/components` - UI components
- `@zynth/apis` - Safe area handling

## Basic Setup

### 1. Wrap Your App

First, wrap your app with `NavigationContainer`:

```tsx
import { NavigationContainer } from "@zynth/memory-router";

export function App() {
  return (
    <NavigationContainer>{/* Your navigators go here */}</NavigationContainer>
  );
}
```

### 2. Create a Navigator

Use `createStackNavigator` or `createTabNavigator` to create a typed navigator:

```tsx
import { createStackNavigator } from "@zynth/memory-router";

type RootStackParams = {
  Home: undefined;
  Profile: { userId: string };
};

const Stack = createStackNavigator<RootStackParams>();
```

### 3. Define Screens

Add screens to your navigator:

```tsx
function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ title: "User Profile" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### 4. Navigate Between Screens

Use the `useNavigation` hook in your screen components:

```tsx
import { useNavigation } from "@zynth/memory-router";
import { Pressable, Text, View } from "@zynth/components";

function HomeScreen() {
  const navigation = useNavigation<RootStackParams>();

  return (
    <View>
      <Pressable
        onPress={() => navigation.navigate("Profile", { userId: "123" })}
      >
        <Text>Go to Profile</Text>
      </Pressable>
    </View>
  );
}
```

### 5. Access Route Params

Use the `useRoute` hook to access params:

```tsx
import { useRoute } from "@zynth/memory-router";
import { Text, View } from "@zynth/components";

function ProfileScreen() {
  const route = useRoute<RootStackParams, "Profile">();
  const userId = route.params().userId;

  return (
    <View>
      <Text>User ID: {userId}</Text>
    </View>
  );
}
```

## Complete Example

```tsx
import {
  NavigationContainer,
  createStackNavigator,
  useNavigation,
  useRoute,
} from "@zynth/memory-router";
import { View, Text, Pressable } from "@zynth/components";

// Define route types
type RootStackParams = {
  Home: undefined;
  Details: { itemId: string; itemName: string };
};

// Create navigator
const Stack = createStackNavigator<RootStackParams>();

// Home screen
function HomeScreen() {
  const navigation = useNavigation<RootStackParams>();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>Home Screen</Text>
      <Pressable
        onPress={() =>
          navigation.navigate("Details", {
            itemId: "42",
            itemName: "Product Name",
          })
        }
        style={{
          backgroundColor: "#007AFF",
          padding: 12,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "white" }}>Go to Details</Text>
      </Pressable>
    </View>
  );
}

// Details screen
function DetailsScreen() {
  const navigation = useNavigation<RootStackParams>();
  const route = useRoute<RootStackParams, "Details">();
  const { itemId, itemName } = route.params();

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 10 }}>Details Screen</Text>
      <Text style={{ marginBottom: 5 }}>Item ID: {itemId}</Text>
      <Text style={{ marginBottom: 20 }}>Item Name: {itemName}</Text>
      <Pressable
        onPress={() => navigation.goBack()}
        style={{
          backgroundColor: "#007AFF",
          padding: 12,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "white" }}>Go Back</Text>
      </Pressable>
    </View>
  );
}

// App
export function App() {
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
          options={{ title: "Item Details" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Next Steps

- Learn about [Stack Navigator](./stack-navigator.md) features
- Explore [Tab Navigator](./tab-navigator.md) for bottom tabs
- Understand [Nested Navigators](./nested-navigators.md)
- Master [Navigation Hooks](./hooks.md)
- Add [TypeScript](./typescript.md) type safety
