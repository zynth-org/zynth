# @rune/screens

Native screen primitives for building memory-based routers in Rune. Provides animated screen transitions without the complexity of native navigation controllers or surface management.

## Why?

The existing `@rune/router` uses native navigation (Fragments on Android) which creates separate rendering surfaces per screen. This causes conflicts when used inside the Hypervisor (guest apps inside host apps) due to surface ID collisions.

`@rune/screens` provides **pure View-based** screen primitives that:

- Render all content in a single Yoga tree (no surface conflicts)
- Handle their own animations (push, zoom, fade)
- Support back gestures
- Work seamlessly with the Hypervisor

## Installation

```bash
yarn add @rune/screens
```

## Components

### ScreenContainer

Container that manages a stack of Screen components.

```tsx
import { ScreenContainer, Screen } from "@rune/screens";

<ScreenContainer style={{ flex: 1 }}>
  <Screen screenKey="home" active={route === "home"}>
    <HomeScreen />
  </Screen>
  <Screen screenKey="details" active={route === "details"}>
    <DetailsScreen />
  </Screen>
</ScreenContainer>;
```

### Screen

Individual screen with built-in animations.

Props:

- `screenKey` - Unique identifier for this screen
- `active` - Whether this screen is visible
- `animation` - Transition type: `"push"` | `"zoom"` | `"fade"` | `"none"`
- `gestureEnabled` - Enable back gesture (default: true)
- `onWillAppear` / `onDidAppear` - Lifecycle callbacks
- `onWillDisappear` / `onDidDisappear` - Lifecycle callbacks

### ScreenTabsContainer

Container for tab-based navigation.

```tsx
import { ScreenTabsContainer } from "@rune/screens";

<ScreenTabsContainer selectedIndex={selectedTab} style={{ flex: 1 }}>
  <HomeTab />
  <SearchTab />
  <ProfileTab />
</ScreenTabsContainer>;
```

Props:

- `selectedIndex` - Currently visible tab index
- `tabAnimation` - Animation for tab switches

## Building a Memory Router

```tsx
import { createSignal, For } from "solid-js";
import { ScreenContainer, Screen } from "@rune/screens";

function MemoryRouter() {
  const [stack, setStack] = createSignal([{ name: "home", params: {} }]);

  const push = (name, params = {}) => {
    setStack((s) => [...s, { name, params }]);
  };

  const goBack = () => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };

  return (
    <ScreenContainer style={{ flex: 1 }}>
      <For each={stack()}>
        {(route, index) => (
          <Screen
            screenKey={`${route.name}-${index()}`}
            active={index() === stack().length - 1}
            animation="push"
          >
            {renderScreen(route.name, route.params, { push, goBack })}
          </Screen>
        )}
      </For>
    </ScreenContainer>
  );
}
```

## Platform Support

- **Android**: Full support
- **iOS**: Not yet implemented (Android-first for Hypervisor use case)
