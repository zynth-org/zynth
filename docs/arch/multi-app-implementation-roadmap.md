# Multi-App Hosting: Implementation Roadmap & Usage Guide

This document outlines the concrete steps, API usage, and architectural changes required to implement the multi-app hosting feature (tentatively named `@rune/hypervisor`).

## 1. Naming Proposals

We need a standard name for this package/feature. Here are 5 suggestions:

1.  **`@rune/hypervisor`** (User Selected): Implies a robust, system-level management of guest runtimes, fitting the "operating system pattern" description.

---

## 2. Usage Proposal

### A. Host Application (The Container)

The Host app imports the `Hypervisor` component. It is responsible for determining _where_ and _when_ the guest app appears.

```tsx
import { Hypervisor, useHypervisorController } from "@rune/hypervisor";

function SuperApp() {
  const hypervisorController = useHypervisorController();

  const handleGuestMessage = (msg: any) => {
    console.log("Message from guest:", msg);
    if (msg.type === "REQUEST_AUTH") {
      hypervisorController.send({ type: "AUTH_TOKEN", token: "xyz-123" });
    }
  };

  const handleError = (error: Error) => {
    console.error("Guest crashed:", error);
    // Optional: Retry logic or show placeholder
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#f0f0f0" }}>
      <Text>Main Host App</Text>

      {/* The Guest App lives here */}
      <View style={{ height: 500, width: "100%", marginTop: 20 }}>
        <Hypervisor
          // Source of the bundle (can be a remote URL, local file, or asset)
          source={{ uri: "https://cdn.example.com/bundles/mini-game.js" }}
          // Or: source={{ require('./path/to/bundle.js') }}

          // Lifecycle props
          onLoad={() => console.log("Guest loaded")}
          onError={handleError}
          onMessage={handleGuestMessage}
          // Optional: Show this while the bundle loads/initializes
          fallback={<ActivityIndicator />}
          // Controller ref for imperative commands (reload, send, etc.)
          controller={hypervisorController}
        />
      </View>

      <Button
        title="Reload Guest"
        onPress={() => hypervisorController.reload()}
      />
    </View>
  );
}
```

### B. Guest Application (The Hosted App)

The Guest app is a standard Rune app but uses hooks to interact with its environment.

```tsx
import { useHost, useSafeLayout } from "@rune/hypervisor";

function MiniGame() {
  // 1. Detect if running inside a hypervisor
  const host = useHost(); // returns null if running standalone

  // 2. Get layout metrics relative to the Hypervisor container, not the screen
  const { width, height } = useSafeLayout();

  // 3. Communication
  const sendScore = () => {
    if (host) {
      host.send({ type: "GAME_OVER", score: 9999 });
    }
  };

  return (
    <View style={{ width, height, backgroundColor: "blue" }}>
      <Text>Mini Game Running!</Text>
      <Button onPress={sendScore} title="Send Score to Host" />
    </View>
  );
}
```

---

## 3. Implementation Roadmap

This feature requires significant changes to the core engine to support multiple `HermesRuntime` instances and `Yoga` trees simultaneously.

### Phase 1: Core Refactoring (Deprecating Singletons)

**Goal:** Remove global static state in iOS/Android cores that assumes a "one app per process" model.

- **iOS (`rune-ios`)**:
  - Refactor `RuneBridge` (or main context) to be instantiable.
  - Ensure `RuneBridge` instances do not share `JSContext` or `HermesRuntime`.
  - Identify global notifications/observers and scope them to specific bridge instances.
- **Android (`rune-android`)**:
  - Refactor `RuneContext` to be non-static.
  - Ensure JNI bindings for Hermes can handle multiple pointers/instances.

### Phase 2: The `@rune/hypervisor` Package & Native Containers

**Goal:** Create the physical "window" that holds the guest app.

- **Structure**: Create `packages/rune-hypervisor`.
- **Native View (iOS - `RuneHypervisorView`)**:
  - Subclass `UIView`.
  - On init, create a _new_ private `RuneBridge/Context`.
  - Expose a root `Yoga` node that acts as the "Window" for the guest.
  - Propagate layout updates from the Host's Yoga tree to the Guest's root node (constraining the guest).
- **Native View (Android - `RuneHypervisorView`)**:
  - Subclass `FrameLayout` or `ViewGroup`.
  - On init, create a _new_ private `RuneContext`.
  - Manage the lifecycle of the attached Hermes runtime.

### Phase 3: Bundle Loading & Lifecycle

**Goal:** Actually load JS code into the new runtime.

- **API**: Implement `source` prop handling in `Hypervisor`.
- **Logic**:
  - Fetch bundle (http/file).
  - Execute bundle in the _specific_ runtime associated with that `HypervisorView`.
  - **Crucial:** Ensure the guest app mounts to its specific Root View, not the main app window.
- **Splash/Fallback**: Implement the native logic to show a native view (passed from Host) while JS initializes.

### Phase 4: The Communication Bridge

**Goal:** `postMessage` implementation.

- **Native Module**: Create `RuneHypervisorModule`.
- **Host Side**: Expose methods to send JSON to specific Runtime ID.
- **Guest Side**: Expose methods to send JSON to "Parent".
- **Serialization**: Use JSON stringification initially.

### Phase 5: Router & Navigation Isolation

**Goal:** Ensure Guest navigation doesn't break Host navigation.

- **`rune-memory-router`**:
  - Refactor to avoid global `window.history` or shared native controllers if possible.
  - Ensure the Guest router pushes view controllers (iOS) or Fragments (Android) _inside_ the HypervisorView hierarchy, not the root `UINavigationController`.
  - _Challenge:_ Modal presentation inside a guest (should it cover the guest area or the whole screen? Default to guest area).

### Phase 6: Hardening & Error Boundaries

**Goal:** Crash resilience.

- **Error Trapping**:
  - Wrap Guest JS execution in try/catch blocks at the bridge level.
  - If Guest JS crashes (Fatal Exception), intercept it in Native.
  - **Do not** kill the process.
  - Instead, unmount the Guest Root View, kill the Guest Runtime, and fire `onError` to the Host.
- **Memory Management**:
  - Ensure `hypervisorController.reload()` or unmounting the component completely frees the Hermes runtime and Yoga nodes to prevent leaks.

---

## 4. File Structure Changes

```text
packages/
  rune-hypervisor/          <-- NEW PACKAGE
    package.json
    src/
      index.ts          (Exports Hypervisor, useHost, etc.)
      Hypervisor.tsx
      context.ts
    ios/
      RuneHypervisorView.swift
      RuneHypervisorModule.swift
    android/
      src/.../RuneHypervisorView.kt
      src/.../RuneHypervisorModule.kt
```
