# @zynth/router

A lightweight, memory-based navigation router for Zynth apps. Inspired by React Navigation, built for SolidJS, and powered by `@zynth/screens` for smooth transitions.

## Overview

`@zynth/router` provides a familiar navigation API similar to React Navigation, but designed specifically for Zynth's architecture. It uses pure View-based screen primitives (via `@zynth/screens`) instead of native navigation controllers, making it ideal for:

- **Hypervisor environments** where multiple apps share the same native context
- **Apps requiring full control** over navigation state and transitions
- **Cross-platform consistency** with unified behavior across iOS and Android

## Key Features

- ✅ **React Navigation-style API** - Familiar patterns and concepts
- ✅ **Stack Navigation** - Push, pop, replace with animated transitions
- ✅ **Tab Navigation** - Bottom tabs with customizable tab bars
- ✅ **Nested Navigators** - Compose stacks inside tabs and vice versa
- ✅ **Type-safe** - Full TypeScript support with typed routes
- ✅ **Modal Support** - Built-in modal presentation styles
- ✅ **Lifecycle Hooks** - Focus effects, before remove, and more
- ✅ **Zero Native Dependencies** - Pure JS/TS, no native code needed

## Documentation

- [Getting Started](./getting-started.md) - Installation and basic setup
- [Stack Navigator](./stack-navigator.md) - Stack-based navigation
- [Tab Navigator](./tab-navigator.md) - Bottom tab navigation
- [Nested Navigators](./nested-navigators.md) - Composing navigators
- [Navigation Hooks](./hooks.md) - useNavigation, useRoute, and more
- [Type Safety](./typescript.md) - TypeScript integration
- [API Reference](./api-reference.md) - Complete API documentation

## Quick Example

```tsx
import { NavigationContainer, createStackNavigator } from "@zynth/router";
import { View, Text } from "@zynth/components";

type RootStackParams = {
  Home: undefined;
  Details: { id: string };
};

const Stack = createStackNavigator<RootStackParams>();

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Home">
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Details" component={DetailsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Comparison with Native-Controller Routers

| Feature               | @zynth/router               | Native-controller router           |
| --------------------- | --------------------------- | ---------------------------------- |
| Navigation approach   | Memory-based, JS-driven      | Native navigation controllers      |
| Screen transitions    | `@zynth/screens` (View-based) | Native Fragments/UIViewControllers |
| Hypervisor compatible | ✅ Yes                       | ❌ Surface conflicts               |
| Navigation state      | Fully controlled in JS       | Managed by native platform         |
| Bundle size           | Smaller                      | Larger (includes native bridges)   |
| Maturity              | Experimental                 | Stable                             |

## Contributing

See the main [Zynth repository](https://github.com/x64Bits/zynth) for contribution guidelines.

## License

MIT
