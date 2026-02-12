# @zynth/apis

A collection of core native APIs for the Zynth framework.

This package provides essential native capabilities like screen dimensions, font loading, and platform detection. It bridges the gap between JavaScript and the native host environment, offering a consistent API across iOS, Android, and Web.

## APIs

### `Platform`
Detect the current operating system and run platform-specific logic.

```tsx
import { Platform, OS } from "@zynth/apis";

// Check the OS
if (Platform.OS === OS.IOS) {
  console.log("Running on iOS");
}

// Select value based on platform
const padding = Platform.select({
  ios: 20,
  android: 10,
  default: 0,
});
```

### `Dimensions`
Retrieve screen and window dimensions. Listen for updates (e.g., orientation changes).

```tsx
import { Dimensions } from "@zynth/apis";

// Get current dimensions
const { window, screen } = Dimensions.all();
console.log(`Window width: ${window.width}`);

// Subscribe to changes
const unsubscribe = Dimensions.subscribe(({ window }) => {
  console.log("New dimensions:", window);
});
```

### `Font`
Load custom fonts dynamically at runtime.

```tsx
import { Font } from "@zynth/apis";

// Load a font
const result = await Font.loadAsync("MyCustomFont", "MyCustomFont.ttf");

if (result.success) {
  console.log(`Font loaded at: ${result.path}`);
}
```

### `createFontLoader`
Idiomatic Solid utility to load multiple fonts and integrate with `<Suspense>`. It returns a `Resource<boolean>`.

```tsx
import { createFontLoader } from "@zynth/apis";
import { Suspense } from "solid-js";

function Root() {
  const fonts = createFontLoader({
    "Diablo": require("./fonts/diablo.ttf"),
    "Inter": require("./fonts/inter.otf")
  });

  return (
    <Suspense fallback={<Loading />}>
      {/* Accessing fonts() triggers Suspense until all are ready */}
      {fonts() && <MainApp />}
    </Suspense>
  );
}
```

### `AppState`
Track whether the app is active, inactive, or in the background.

```tsx
import { AppState } from "@zynth/apis";

console.log(AppState.currentState);

const subscription = AppState.addEventListener("change", (state) => {
  console.log("App state changed:", state);
});

subscription.remove();
```

### `Network`
Observe connectivity changes and inspect current network status.

```tsx
import { Network } from "@zynth/apis";

console.log(Network.currentState);

const unsubscribe = Network.subscribe((state) => {
  console.log("Network state:", state.type, state.isConnected);
});

unsubscribe();
```

### `Device`
Read device details such as model, platform, OS version, and runtime identifiers.

```tsx
import { Device } from "@zynth/apis";

const info = Device.getInfo();
console.log(info.model, info.osName, info.osVersion);
```
