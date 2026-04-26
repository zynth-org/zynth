<p align="center">
  <img src=".github/assets/images/logo-transparent-prod.png" width="250" alt="Zynth" />
</p>

<h1 align="center">Zynth</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@zynthjs/core">
    <img src="https://img.shields.io/npm/v/@zynthjs/core.svg?style=for-the-badge&color=black" alt="NPM Version" />
  </a>
  <a href="https://discord.gg/mT5bxKymwF">
    <img src="https://img.shields.io/discord/1234567890?style=for-the-badge&logo=discord&label=Discord&color=black" alt="Discord" />
  </a>
  <a href="https://www.reddit.com/r/ZynthFramework">
    <img src="https://img.shields.io/reddit/subreddit-subscribers/zynth?style=for-the-badge&logo=reddit&label=Reddit&color=black" alt="Reddit" />
  </a>
</p>

<p align="center">
  <strong><a href="https://zynthai.com/zynth/">Website</a> • <a href="https://zynthai.com/zynth/documentation/getting-started/01-introduction">Documentation</a></strong>
</p>

Zynth is a high-performance, fine-grained reactive runtime for building native cross-platform applications. Built from the ground up to leverage **SolidJS** principles, Zynth provides a full-stack solution—from the JavaScript engine to the rendering pipeline.

While we are currently in **Alpha**, Zynth is designed for developers who value ownership of their runtime and the predictability of granular reactivity. Our engine performs surgical updates directly to native views, ensuring the UI stays in sync with your state without unnecessary overhead.

## Zynth by Example

```tsx
import { createSignal } from "solid-js";
import { View, Text, Button } from "@zynthjs/components";

function Counter() {
  const [count, setCount] = createSignal(0);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text style={{ fontSize: 32 }}>{count()}</Text>
      <Button onPress={() => setCount((c) => c + 1)}>Increment</Button>
    </View>
  );
}
```

<details>
<summary><b>Native Performance: Shared Signals & Motion</b></summary>

Zynth's flagship feature is **Shared Signals**, which mirror reactive state directly into native memory for zero-latency animations and gestures.

```tsx
import { View, GestureDetector } from "@zynthjs/components";
import {
  createSharedValue,
  createAnimatedStyle,
  withSpring,
} from "@zynthjs/core/motion";
import { createPanGesture } from "@zynthjs/core/gesture";

function DraggableBox() {
  const offset = createSharedValue(0);

  const pan = createPanGesture({
    onUpdate: (event) => {
      "worklet"; // Runs on the UI thread
      offset.value = event.translationX;
    },
    onEnd: () => {
      "worklet";
      offset.value = withSpring(0);
    },
  });

  const animatedStyle = createAnimatedStyle(() => ({
    width: 120,
    height: 120,
    backgroundColor: "#FF3E00",
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    transform: [{ translateX: offset.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View style={animatedStyle} />
    </GestureDetector>
  );
}
```
</details>

## Key Features

- **Granular Reactivity**: Powered by SolidJS. Components run once; updates are surgical and direct to native properties.
- **Shared Signals & Worklets**: High-performance primitives that bridge the JS and Native threads with zero latency. Handle 120fps gestures and animations on the UI thread without blocking JavaScript.
- **Native-First Navigation**: A filesystem-based router (`@zynthjs/router`) and native screen management (`@zynthjs/screens`) that provide authentic platform behavior.
- **Motion-Ready Primitives**: Standard components like `View` and `Text` support advanced animations and native gestures via `GestureDetector`.
- **Controlled Stability**: Use `createSyncSignal` for `TextInput` to ensure frame-perfect synchronization between JS and native text buffers.
- **Modular Ecosystem**: Over 30 decoupled native packages designed to work together or independently.
- **Typed Transport**: A JSI-based architecture focused on strong data typing during communication between threads.

## Technical Foundation

Zynth is built on a modern, performance-oriented stack:

- **Engine**: Uses **Hermes V1** for fast TTI and low memory footprint.
- **Layout**: Currently powered by **Yoga** (Flexbox), with our own Rust-based **Grid** rendering engine and text measurement system in late development.
- **Build Tools**: Leverages **RsBuild** and **RsPack** for lightning-fast development cycles and optimized production bundles.
- **Target Platforms**: One codebase for iOS and Android, with active development for Web support.

## Why Zynth?

### Ownership and Control

We focus on providing a runtime that you truly own. Zynth gives you direct access to the native layer through JSI, allowing you to extend the framework with high-efficiency synchronous native bindings.

### Predictable Interactions

By implementing UI-thread worklets, Zynth ensures that your interactions remain smooth and responsive even during heavy JavaScript execution.

### Modular Ecosystem

Zynth is designed for flexibility. While the core provides high-performance motion and signals by default, the broader ecosystem—including the router and primitive components—is built as a series of decoupled packages that you can compose to fit your needs.

---

## License

Zynth is currently in Alpha. See the [LICENSE](LICENSE) file for more details.
