# @rune/safe-area

Safe area insets and frame utilities for the Rune framework.

## Phase 1 - Core Model & Provider ✅

## Phase 2 - Hooks & SafeAreaView ✅

## Phase 3 - Native Bootstrap ✅

This package provides a single, reliable source of **window safe-area insets** and **safe frame** for any subtree so screens/layouts can avoid notches, status/navigation bars, and cutouts without jank.

## Installation

```bash
yarn add @rune/safe-area
```

## Usage

### Recommended Setup (Zero First-Paint Jank)

Get initial metrics synchronously before the first render to prevent layout jumps:

```tsx
import { getInitialWindowMetrics, SafeAreaProvider } from "@rune/safe-area";
import App from "./App";

// Get metrics synchronously during bootstrap
const initialMetrics = getInitialWindowMetrics();

export default function Root() {
  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <App />
    </SafeAreaProvider>
  );
}
```

This ensures:

- ✅ No first-paint layout jump
- ✅ Correct values from frame 0
- ✅ Smooth transitions on device rotation or system bar changes

### Basic Setup (Without Bootstrap)

If you don't provide initial metrics, the provider starts with zeros and updates asynchronously:

```tsx
import { SafeAreaProvider } from "@rune/safe-area";
import App from "./App";

export default function Root() {
  return (
    <SafeAreaProvider>
      <App />
    </SafeAreaProvider>
  );
}
```

⚠️ This may cause a visible layout shift on first render.

### Using SafeAreaView (Easiest)

The simplest way to respect safe areas - just wrap your content:

```tsx
import { SafeAreaView } from "@rune/safe-area";

function Screen() {
  return (
    <SafeAreaView>
      <Text>Content automatically respects all safe areas</Text>
    </SafeAreaView>
  );
}
```

Control which edges to respect:

```tsx
// Only top and bottom
<SafeAreaView edges={["top", "bottom"]}>
  <Content />
</SafeAreaView>

// Use margin instead of padding
<SafeAreaView mode="margin" edges={["top"]}>
  <Content />
</SafeAreaView>
```

### Using Hooks (For Custom Layouts)

Access insets directly for custom layouts:

```tsx
import { createSafeAreaInsets, createSafeAreaFrame } from "@rune/safe-area";
import { View, Text } from "@rune/components";

function CustomScreen() {
  const insets = createSafeAreaInsets();
  const frame = createSafeAreaFrame();

  return (
    <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <Text>Safe area top: {insets.top}px</Text>
      <Text>Available width: {frame.width}px</Text>
    </View>
  );
}
```

### With Initial Metrics (Recommended)

To prevent first-paint jumps, use `getInitialWindowMetrics()` during bootstrap (see Recommended Setup above).

### Utilities

#### `getInitialWindowMetrics()`

Gets the initial window metrics synchronously from the native module.

```tsx
import { getInitialWindowMetrics } from "@rune/safe-area";

const metrics = getInitialWindowMetrics();
// Returns WindowMetrics | null
```

Returns `null` if:

- The native module is not initialized
- The window/root view is not attached yet
- Running in a non-native environment

**Best Practice:** Call this at app startup before rendering your root component.

### Nesting Providers

Inner providers override outer providers. Use when mounting UI in a distinct native container (e.g., modal):

```tsx
<SafeAreaProvider>
  <MainScreen />
  <Modal>
    <SafeAreaProvider>
      <ModalContent />
    </SafeAreaProvider>
  </Modal>
</SafeAreaProvider>
```

## API

### Components

#### `SafeAreaProvider`

Component that provides safe area context to descendants.

**Props:**

- `initialMetrics?: InitialWindowMetrics` - Optional precomputed metrics to prevent first-paint jumps
- `children: JSX.Element` - Children to render

#### `SafeAreaView`

A View component that automatically applies safe area insets.

**Props:**

- `edges?: SafeAreaEdge[]` - Which edges to apply insets to. Default: `["top", "right", "bottom", "left"]`
- `mode?: "padding" | "margin"` - Whether to apply insets as padding or margin. Default: `"padding"`
- `style?: Style` - Additional styles to apply
- `children?: JSX.Element` - Children to render

### Hooks

#### `createSafeAreaInsets()`

Returns the current safe area insets.

```tsx
const insets = createSafeAreaInsets();
// insets: { top: number, right: number, bottom: number, left: number }
```

#### `createSafeAreaFrame()`

Returns the current safe area frame (the rectangle of usable space).

```tsx
const frame = createSafeAreaFrame();
// frame: { x: number, y: number, width: number, height: number }
```

### Types

```typescript
interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SafeAreaFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowMetrics {
  insets: SafeAreaInsets;
  frame: SafeAreaFrame;
}

type SafeAreaEdge = "top" | "right" | "bottom" | "left";
type SafeAreaMode = "padding" | "margin";
```

### Contexts

Advanced users can access contexts directly:

```tsx
import { useContext } from "solid-js";
import { SafeAreaInsetsContext, SafeAreaFrameContext } from "@rune/safe-area";

const insets = useContext(SafeAreaInsetsContext);
const frame = useContext(SafeAreaFrameContext);
```

## Native Integration

### iOS

Initialize the module in your app delegate before loading the JS bundle:

```swift
import RuneKit
import RuneSafeArea

// In your app initialization
RuneSafeArea.initialize(with: runeRuntime)
```

### Android

Initialize the module in your MainActivity before loading the JS bundle:

```kotlin
import dev.rune.safearea.RuneSafeArea

// In your MainActivity onCreate
RuneSafeArea.initialize(this, runeRuntime)
```

## Performance Guarantees

All phases are complete. The package delivers:

- **Zero First-Paint Jank:** `getInitialWindowMetrics()` provides real values before first render
- **Coalescing:** At most one metrics update per animation frame (≈16ms)
- **Precision:** Rounded to device-independent pixels at JS boundary to avoid sub-pixel churn
- **Threading:** Updates delivered from native UI/main thread; never blocks layout
- **Fallbacks:**
  - If root view/window isn't attached yet, emits `{0,0,0,0}` insets and retries on attach
  - Clamps negative/NaN values to `0`
  - Returns zeros if no provider found (with dev warning)
- **Stability:** Metrics are stable within a frame (no mid-tick oscillation)
- **Memory:** Provider state is small and immutable per tick; reuses objects to reduce GC pressure

## Change Triggers

Metrics update automatically on:

- Orientation/size changes
- System bar visibility changes
- Window/scene attach/detach
- Display cutouts
- Multi-window mode (Android)
- Status bar frame changes (iOS)

## Testing Matrix

Verified across:

- ✅ Notch vs non-notch iOS devices
- ✅ Gesture vs 3-button navigation Android
- ✅ Tablets (iOS & Android)
- ✅ Device rotation
- ✅ System bars show/hide
- ✅ Multi-window mode (Android)

Assertions:

- ✅ No first-paint jump with `initialMetrics`
- ✅ No flicker on orientation transitions
- ✅ Monotonic values within frame
- ✅ Correct values across all device configurations

## Next Steps (Phase 3)

Phase 3 will add native bootstrap optimization to provide `initialMetrics` automatically during app launch.

## License

MIT
