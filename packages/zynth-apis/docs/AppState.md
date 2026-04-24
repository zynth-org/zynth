# AppState

The default lifecycle surface in Zynth is `appState`, which monitors the application's lifecycle state and notifies you when the app moves between the foreground and the background.

This is critical for scenarios like pausing heavy animations, closing network sockets, or managing persistent local storage when the user switches apps.

## Basic usage

### Synchronous State

You can check the current status of the application using `appState.current`.

```ts
import { appState } from "@zynthjs/apis";

if (appState.current === "active") {
  // Application is in the foreground
}
```

### Listening for Changes

Subscribe to lifecycle transitions to react to user actions in real-time.

```tsx
import { appState } from "@zynthjs/apis";

const unsubscribe = appState.onChange((nextState) => {
  console.log(`App transitioned to: ${nextState}`);
  
  if (nextState === "background") {
    // Save work, stop timers
  }
});

// Later: unsubscribe();
```

## Advanced

### Lifecycle States

- **`active`**: The app is in the foreground and interacting with the user.
- **`background`**: The app is running in the background. The user might be in another app or on the home screen.
- **`inactive`**: (iOS only) The app is in a transition state (e.g., during a phone call, sliding to the task switcher, or showing a system prompt).

## Special cases

- **Initialization Reliability**: The Zynth native module emits an initial state event during bootstrap. `AppState` includes a safety refresh (`600ms` after startup) to ensure that even if the initial bridge event is missed, the JS state correctly reflects the current reality.
- **Web Visibility**: On the web, `AppState` maps to the `visibilitychange` browser event. `active` corresponds to `visible`; `background` corresponds to `hidden`.

## API Reference

### `appState.current`: `AppStateStatus`
Returns the current snapshot of the app's visibility state.

### `appState.subscribe(listener: (state: AppStateStatus) => void): () => void`
Adds a reactive listener and returns an unsubscribe function.

### `appState.onChange(listener: (state: AppStateStatus) => void): () => void`
Alias for `subscribe()`, intended for app lifecycle handlers.

### `appState.refresh(): AppStateStatus`
Forces an immediate check of the current native or document visibility state.

### Legacy compatibility

`AppState.currentState`, `AppState.addEventListener("change", ...)`, `AppState.subscribe()`, and `AppState.refresh()` remain available for compatibility.
