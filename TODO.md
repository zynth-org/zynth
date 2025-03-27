# Rune Development Roadmap

This document outlines the development plan to evolve Rune into a powerful, AI-native framework for building generative native applications. The timeline is aggressive, reflecting the high-velocity, AI-assisted development pace.

---

## Architectural Principles & API Design

**Objective:** To build a framework that is not only powerful but also intuitive, logical, and a pleasure to use, drawing inspiration from the clean, modular design of modern development tools.

- [ ] **Lean Core:** The `@rune/core` package should be the minimal runtime engine (renderer, reconciler, native bridge). All components, including primitives like `View` and `Text`, and APIs should live in separate, dedicated packages.

### 1. Core Components (`packages/rune-components`)

- [✅] **`@rune/components` Package:** Create a new package to house standard UI components.
- [✅] **Relocate Primitives:** Move `View` and `Text` from `@rune/core` to this package.
- [✅/⚠️] **`Image`:** Implement a component for local and remote images.
- [✅] **`TextInput`:** Implement a component for text input.
- [✅] **`ScrollView`:** Implement a scrolling container.
- [✅] **`Button`:** Implement a basic, cross-platform button.
- [✅] **`Pressable`:** Implement a component to detect detailed press interactions.
- [✅/⚠️] **`FlatList`:** Implement a performant, virtualized list component
  Limitations:

* Items without itemSize have a first frame empty list

### 2. Layout & Style (`packages/rune-layout`, `packages/rune-apis`)

- [ ] **`@rune/layout` Package:** Create a package for layout-assisting components.
- [ ] **`KeyboardAvoidingView`:** Implement a view that intelligently avoids the on-screen keyboard.
- [x] `@rune/apis`
  - [x] Platform
  - [x] Dimensions
  - [ ] Device
  - [ ] AppState
  - [ ] Network
  - [ ] Runtime

#### ⚙️ Optional packages (lazy-loaded / opt-in native modules)

- [ ] `@rune/location` — GPS & geolocation
- [ ] `@rune/haptics` — haptic feedback & vibration
- [ ] `@rune/permissions` — unified permissions layer
- [ ] `@rune/storage` — async key/value local storage
- [ ] `@rune/filesystem` — file read/write & directory access
- [ ] `@rune/speech` — voice recognition & text-to-speech
- [ ] `@rune/battery` — battery state & level listener
- [ ] `@rune/clipboard` — clipboard read/write API
- [ ] `@rune/devicemotion` — accelerometer & gyroscope
- [ ] `@rune/hardware` — sensors, biometrics, camera, flashlight (future)
- [ ] `@rune/notifications` — local & push notification control

#### 🧠 Notes

- Each module should:
  - Export a **typed JS shim** and **native bridge**.
  - Register itself lazily with the bridge only when imported.
  - Use **Promise-based** APIs for parity across platforms.
- `@rune/apis` remains **always available** and part of every Rune app build.
- All others are **opt-in** — included only when imported.

- [ ] **`StyleSheet`:** Implement a `StyleSheet.create` API for style abstraction and optimization.
- [✅] **`Dimensions`:** Implement an API to get screen and window dimensions.

### 3. Animation (`packages/rune-animation`)

- [ ] **`@rune/animation` Package:** Create a new package for a basic animation API.
- [ ] **Animation API (v1):** Design and implement a simple, declarative animation API (e.g., `createSpring`, `createTiming`) that can animate style properties.
- [ ] **Native Driver:** Ensure animations can run on the native UI thread where possible for performance.

### 4. Developer Experience (`packages/rune-hmr`, `packages/rune-cli`)

- [✅/⚠️] **`@rune/hmr` Package:** Create a dedicated package for the HMR client logic.
- [ ] **HMR Stability:** Ensure Hot Module Replacement is fast, reliable, and handles component state gracefully.
- [ ] **CLI Refinements:** Continue to streamline and stabilize the `rune dev` and `rune prebuild` workflows.

### 5. Navigation (`packages/rune-navigation`)

- [ ] **`@rune/navigation` Package:** Create a new package for a simple navigation library.
- [ ] **Stack Navigator:** Implement a basic stack navigator for pushing and popping screens.
- [ ] **Navigation API:** Design a simple API (`navigate`, `goBack`) for programmatic navigation.

---

## Phase 2: Sandboxing & Multi-Runtime Architecture (Target: 3-4 Weeks)

**Objective:** Build the core infrastructure to safely run multiple, isolated Rune apps within a single native host, enabling the "app-in-app" vision.

- [ ] **Native Sandbox Module:**
  - [ ] Design and implement a native module (`SandboxManager`?) for creating, managing, and destroying isolated Hermes runtimes.
  - [ ] Ensure each sandbox has its own isolated bridge, UI manager, and module registry.
- [ ] **`SandboxView` Component:**
  - [ ] Create a component (`<SandboxView source={...} />`) that acts as a container for a sandboxed Rune app.
  - [ ] The root UI manager must delegate rendering and layout for this view to the appropriate sandboxed instance.
- [ ] **Inter-App Communication Bridge:**
  - [ ] Design and implement a secure, message-based API for communication between the host app and sandboxed "guest" apps.

---

## Phase 3: Generative AI & Tooling - MVP (Target: 2-3 Weeks)

**Objective:** Deliver a minimum viable product for an AI-native development experience, positioning Rune as the go-to framework for generative UI.

- [ ] **AI Agent Protocol (v1):**
  - [ ] Define a high-level JSON-based protocol for AI agents to send commands (e.g., `{"action": "CREATE_COMPONENT", "parent": "root", "component": "Button", "props": {"title": "Click Me"}}`).
  - [ ] The CLI or a dev server will interpret these commands and modify the source code.
- [ ] **Visual Introspection Tool (v1):**
  - [ ] Create a tool that can be activated in debug mode to inspect the rendered component tree.
  - [ ] Allow tapping on a component to view its name, props, and style.
- [ ] **Public Launch:**
  - [ ] Prepare documentation for the core APIs and components.
  - [ ] Create a compelling "hello world" example for the AI-native workflow.
  - [ ] Announce the open-source project.

## Phase 4: Platform parity

**Objective:** Achieve feature parity across iOS and Android, ensuring a consistent developer experience.

- [ ] **ScrollView:**
  - [ ] iOS require declare style `height` when android requires `minHeight`.

---

## Nice to Have

- [ ] Enable Hermes `Intl` support on Android (fbjni initialization & runtime wiring) so features like `toLocaleTimeString` work without fallbacks.
