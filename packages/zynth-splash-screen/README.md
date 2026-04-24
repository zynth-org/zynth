# Splash Screen

Manage the visibility of the native splash screen during application initialization on iOS and Android.

`@zynthjs/splash-screen` provides a programmatic interface to control when the native launch screen is dismissed. This is essential for preventing the UI from flickering while the initial application state is being loaded, ensuring a seamless transition from the boot sequence to the first interactive frame.

## Basic usage

By default, the splash screen is automatically dismissed as soon as the first frame of the application is rendered. If you do not have complex initialization logic, no manual intervention is required.

To manually control the dismissal, notify the framework that the splash screen should remain visible until you explicitly hide it.

```ts
import { SplashScreen } from "@zynthjs/splash-screen";

// At the top level of your entry point
SplashScreen.preventAutoHideAsync();

export default function App() {
  // Your app logic
  
  onMount(async () => {
    // Perform initialization (e.g., loading assets, fetching config)
    await performInitialSetup();
    
    // Reveal the application
    await SplashScreen.hideAsync();
  });

  return <MyMainInterface />;
}
```

## Advanced usage

### Initialization Guard

A common pattern is to wrap the application in a guard that prevents rendering until the splash screen is ready to be dismissed. This ensures that no partial layouts are visible behind the native splash screen transition.

```ts
import { createSignal, onMount, Show } from "solid-js";
import { SplashScreen } from "@zynthjs/splash-screen";

// Prevent the OS from auto-hiding the splash screen
SplashScreen.preventAutoHideAsync();

export default function App() {
  const [isReady, setIsReady] = createSignal(false);

  onMount(async () => {
    try {
      // Parallel loading of essential resources
      await Promise.all([
        loadFonts(),
        initializeStorage(),
        fetchInitialData()
      ]);
    } finally {
      setIsReady(true);
      // Hide with a native fade animation
      await SplashScreen.hideAsync();
    }
  });

  return (
    <Show when={isReady()}>
      <Navigation />
    </Show>
  );
}
```

## Special cases

- **Execution Timing**: `preventAutoHideAsync` must be called synchronously at the beginning of your script execution, typically in your `index.ts` or `App.tsx` before the first component renders. Calling it after the framework has already started the rendering pipeline may result in the splash screen auto-hiding.
- **Single-use Lifecycle**: Once `hideAsync` has been called and the native splash screen is dismissed, it cannot be re-shown during the same session. The native platform manages the splash screen as part of the initial boot process.
- **Native Configuration**: The visual appearance of the splash screen (images, background colors, and theme attributes) is determined by the native project configuration:
  - **iOS**: Defined in the `LaunchScreen.storyboard` or the `UILaunchScreen` dictionary in `Info.plist`.
  - **Android**: Configured via the `windowSplashScreenBackground` and `windowSplashScreenAnimatedIcon` attributes in the application XML theme.
- **Web Support**: On the Web platform, calls to these methods are safely handled as no-ops unless a custom web-layer splash screen adapter is registered.

## API Reference

### `SplashScreen`

#### `preventAutoHideAsync()`
Instructs the native splash screen to remain visible until `hideAsync` is explicitly called. This overrides the default behavior of auto-hiding on the first rendered frame.

- **Returns**: `Promise<boolean>` — Resolves to `true` if the instruction was successfully sent to the native module.

#### `hideAsync()`
Dismisses the currently visible native splash screen using the platform's default transition (usually a subtle fade-out).

- **Returns**: `Promise<boolean>` — Resolves to `true` when the hide command has been successfully executed.
