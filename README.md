# Zynth

> A native, hybrid UI framework powered by [SolidJS](https://www.solidjs.com).

Zynth brings fine-grained reactivity to native mobile development. By combining the performance of SolidJS with a direct native bridge, Zynth allows you to build high-performance iOS and Android applications with a modern, declarative API and no Virtual DOM.

## Features

- **No Virtual DOM:** Updates are surgical. When a signal changes, Zynth updates _only_ the specific native property that needs to change, bypassing the heavy diffing process found in React Native.
- **Synchronous Bridge (JSI):** Communication between JavaScript and Native (C++/Swift/Kotlin) happens synchronously via the JavaScript Interface (JSI), eliminating bridge serialization overhead.
- **Native Signals:** `createSharedSignal` exposes Solid-style signals backed by native shared storage so the UI thread can read values without async hops.
- **True Native Navigation:** Screens and transitions are backed by native controllers (`UINavigationController` / Fragments), ensuring 100% authentic feel and gesture support.
- **Shared Value Animations:** Physics-based animations run on the UI thread, driven by a native loop, keeping interactions buttery smooth even if the JS thread is busy.
- **Modular Architecture:** Everything is a package. Core logic, UI components, and native APIs are split into small, tree-shakeable modules (`@zynth/core`, `@zynth/components`, `@zynth/animate`).
- **AI-Native Development:** Built-in support for **Skyhook**, an AI backend that can generate and update apps on the fly from natural language prompts.

## Usage

### Prerequisites

- Node.js >= 18
- Yarn
- Xcode (for iOS)
- Android Studio (for Android)

### Installation

To create a new Zynth project, use the CLI:

```bash
# Create a new app
npx zynth create my-app

# Enter the directory
cd my-app

# Install dependencies
yarn install
```

### Development

Start the development server and launch the app on a simulator/emulator:

```bash
# iOS
yarn dev:ios

# Android
yarn dev:android
```

The CLI handles everything: bundling your JS, generating the native projects (via prebuild), and launching the native build tools.

### Building for Production

Zynth uses [Rsbuild](https://rsbuild.dev/) to produce highly optimized bundles.

```bash
# Bundle JS
yarn bundle

# Build native binaries
yarn build:ios
yarn build:android
```

## Architecture

Zynth is designed to be lean and modular.

### 1. The Reactive Core (`@zynth/core`)

The heart of the framework. It implements a SolidJS Universal Renderer that translates reactive updates into a stream of instructions (`createNode`, `setProp`, `insertChild`) for the native host.

### 2. The Native Runtime (`ZynthKit`)

A C++ core (shared between iOS and Android) that implements the JSI bridge. It uses **Hermes** as the JavaScript engine and **Yoga** for Flexbox layout.

### 3. The Ecosystem

- **`@zynth/components`**: Core primitives (`View`, `Text`, `Image`, `FlatList`).
- **`@zynth/animate`**: High-performance, interruptible animations (`createSharedValue`, `withSpring`).
- **`@zynth/router`**: A stack-based router designed for multi-app environments.
- **`@zynth/hypervisor`**: Run isolated "Guest" Zynth apps within a "Host" app.

_For a deep dive into the internals, read the [Architecture Documentation](docs/architecture.md)._

## Examples

### Counter Component

```tsx
import { createSignal } from "solid-js";
import { View, Text, Button } from "@zynth/components";

export function Counter() {
  const [count, setCount] = createSignal(0);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 24, marginBottom: 20 }}>Count: {count()}</Text>
      <Button onPress={() => setCount((c) => c + 1)}>Increment</Button>
    </View>
  );
}
```

### Animation

```tsx
import {
  Animated,
  createSharedValue,
  useAnimatedStyle,
  withSpring,
} from "@zynth/animate";

export function BouncingBox() {
  const offset = createSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    <Animated.View
      style={[{ width: 100, height: 100, backgroundColor: "red" }, style]}
    />
  );
}
```

## Contributing

We welcome contributions! Please see `CONTRIBUTING.md` (coming soon) for details on how to set up the monorepo for development.

1.  Clone the repo: `git clone https://github.com/zynth/zynth.git`
2.  Install dependencies: `yarn`
3.  Run the demo app: `cd apps/components && yarn dev:ios`

## License

private
