# Core

The native runtime and renderer for the Zynth framework.

`@zynthjs/core` provides the foundational primitives for the framework's UI tree and handles the synchronous communication layer (JSI). It operates without relying on a async bridge, ensuring direct interactions between the JavaScript layer and the native engine.

## Basic usage

In most cases, Zynth Core is initialized implicitly by the framework, handling the entire UI lifecycle automatically. However, it also exposes specialized primitives for hardware-accelerated animations, native telemetry, and advanced view management.

```tsx
import { PerformanceOverlay } from "@zynthjs/core";

// Enable the native performance overlay
PerformanceOverlay.setEnabled(true);
```

## Advanced

### Shared Signals and Worklets

`SharedSignal` is the cornerstone of Zynth's native animation and gesture system. It enables reading and writing values directly from the UI thread, providing reliable 60/120fps updates without crossing back to the JavaScript thread. 

```tsx
import { createSharedSignal, createWorklet } from "@zynthjs/core";

// Creates a reactive value backed natively by the UI thread
const [scale, setScale] = createSharedSignal(1);

// Worklets run directly on the UI thread for synchronized updates
const handleGesture = createWorklet((gestureDelta) => {
  "worklet";
  setScale(1 + gestureDelta);
});
```

### Displaying the Performance Overlay

The performance overlay is a native tool used to monitor your app's runtime metrics in real time. It displays memory usage, active view counts, and frames per second (FPS) for both the UI and JS threads.

```tsx
import { PerformanceOverlay } from "@zynthjs/core";

function toggleTelemetry() {
  PerformanceOverlay.setEnabled(true);

  // Retrieve current stats
  PerformanceOverlay.getStats().then((stats) => {
    if (stats) {
      console.log(`UI FPS: ${stats.uiFps}, JS FPS: ${stats.jsFps}`);
    }
  });
}
```

### Surfaces Integration

The Surface API bridges standalone Zynth hierarchies into existing native navigation structures, such as native iOS or Android BottomTabs. This allows rendering modular Zynth elements within designated surface bounds instead of occupying the main window.

```tsx
import { setActiveSurface } from "@zynthjs/core";

function initializeMicroFrontend(surfaceId: number) {
  // Bind the runtime renderer to a specific native surface
  setActiveSurface(surfaceId);
}
```

## Special cases

- **HMR Support**: Hot Module Replacement (HMR) is experimental and actively being improved; edge cases or synchronization issues during rapid reloads are expected.
- **Web Support**: Web support within `core` is partial and strictly limited to foundational framework packages, primitive components, and APIs.
- **Polyfills**: The runtime provides built-in support for standard polyfills to ensure broad JavaScript API compatibility without native module overhead.
- **DevTools**: It natively tracks logs, errors, and performance events, making them available through the `addDevtoolsListener` API for external tooling.

## API Reference

### Signals & Worklets
- `createSharedSignal<T>(initialValue: T): [SharedSignalAccessor<T>, Setter<T>]`
- `readSharedSignal<T>(signal: SharedSignalAccessor<T>): T`
- `captureSharedSignals<T>(fn: () => T): { result: T; tokens: SharedSignalToken[] }`
- `createWorklet<T>(fn: T): WorkletFunction<T>`

### Telemetry
- `PerformanceOverlay.setEnabled(enabled: boolean): Promise<boolean>`
- `PerformanceOverlay.getStats(): Promise<PerformanceOverlayStats | null>`

### Native Surfaces
- `setActiveSurface(id: number): void`
- `getActiveSurface(): number`

### DevTools Connection
- `addDevtoolsListener(listener: ZynthDevtoolsListener): () => void`
- `emitDevtoolsEvent(event: ZynthDevtoolsEvent): void`
