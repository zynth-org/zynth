# @rune/screens

Native screen primitives for Rune.

This package provides the core building blocks for navigation transitions. Unlike pure JS solutions, `rune-screens` maps to native navigation controllers (UINavigationController on iOS, Fragments on Android) to deliver platform-authentic transitions and lifecycle management.

## Components

### `ScreenContainer`
A container that manages a stack of screens. It handles the transition animations between them.

```tsx
<ScreenContainer>
  <Screen active={true} screenKey="home" animation="none">
    <Home />
  </Screen>
  <Screen active={false} screenKey="details" animation="push">
    <Details />
  </Screen>
</ScreenContainer>
```

### `Screen`
Represents a single view in the navigation stack.

*   `active`: Whether the screen is currently visible.
*   `animation`: The transition to use when becoming active (`push`, `pop`, `fade`, `modal`, `none`).
*   `gestureEnabled`: Whether native gestures (like swipe-to-back) are enabled.
*   `onDidAppear` / `onDidDisappear`: Lifecycle callbacks.

## Usage

This package is typically used internally by `@rune/memory-router` or other high-level routers, but can be used directly for custom navigation implementations.