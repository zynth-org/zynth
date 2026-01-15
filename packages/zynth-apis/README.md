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
await Font.loadAsync("MyCustomFont", "MyCustomFont.ttf");

// Check if loaded
if (Font.isLoaded("MyCustomFont")) {
  // Use the font
}
```
