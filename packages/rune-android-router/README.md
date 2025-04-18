# @rune/android-router

**Temporary ephemeral package for Android router development.**

This is a minimal Android-only router implementation to iterate on native Android navigation without the complexity of the full `@rune/router` package. Once stable, this will be merged back into `@rune/router`.

## Why this exists

Creating a complex router in Android can result in:

- Empty screens with no UI rendering
- App freezing with "Isn't Responding" messages
- Difficult debugging with many native files

This minimal implementation allows us to:

- Start with a simple working base
- Iterate quickly on Android-specific issues
- Scale up functionality incrementally
- Merge back into main router when stable

## Goal

Render UI screens inside a native Android navigator with minimal complexity.

## Usage

```tsx
import { NavigationContainer, createRouter } from "@rune/android-router";

type AppRoutes = {
  Home: undefined;
};

const Router = createRouter<AppRoutes>();

function App() {
  return (
    <NavigationContainer>
      <Router.Stack initialRouteName="Home">
        <Router.Stack.Screen name="Home" component={HomeScreen} />
      </Router.Stack>
    </NavigationContainer>
  );
}
```
