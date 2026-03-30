# AppState

The `AppState` API monitors the application's lifecycle state, notifying you when the app moves between the foreground and the background.

This is critical for scenarios like pausing heavy animations, closing network sockets, or managing persistent local storage when the user switches apps.

## Basic usage

### Synchronous State

You can check the current status of the application using `AppState.currentState`.

```ts
import { AppState } from "@zynth/apis";

if (AppState.currentState === "active") {
  // Application is in the foreground
}
```

### Listening for Changes

Subscribe to lifecycle transitions to react to user actions in real-time.

```tsx
import { AppState } from "@zynth/apis";

const subscription = AppState.addEventListener("change", (nextState) => {
  console.log(`App transitioned to: ${nextState}`);
  
  if (nextState === "background") {
    // Save work, stop timers
  }
});

// Later: subscription.remove();
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

### `AppState.currentState`: `AppStateStatus`
Returns the current snapshot of the app's visibility state.

### `AppState.addEventListener(type: 'change', listener: (state: AppStateStatus) => void): AppStateSubscription`
Adds a listener for state changes.
- **Returns**: A subscription object with a `.remove()` method.

### `AppState.subscribe(listener: (state: AppStateStatus) => void): () => void`
Utility method that functions like `addEventListener` but returns a direct unsubscribe function.

### `AppState.refresh(): AppStateStatus`
Forces an immediate check of the current native or document visibility state.
