# Hypervisor

High-isolation guest runtimes for Zynth applications, enabling micro-frontend architectures and plugin sandboxing.

The Hypervisor component provides the primitive for embedding a full Zynth environment (Yoga layout + Hermes runtime) inside another Zynth application. It abstracts:

- Native runtime lifecycle management (Load, Reload, Destroy)
- Bi-directional message passing between Host and Guest
- Layout isolation for responsive embedded interfaces

## Basic usage

Embed a remote Zynth bundle by URI. The `Hypervisor` component handles the viewport and lifecycle of the underlying Guest runtime.

```tsx
import { Hypervisor } from "@zynthjs/hypervisor";

function PluginContainer() {
  const handleLoad = () => {
    console.log("Plugin loaded successfully");
  };

  const handleMessage = (data) => {
    console.log("Received from guest:", data);
  };

  return (
    <Hypervisor
      source={{ uri: "https://cdn.myserver.com/bundle.js" }}
      onLoad={handleLoad}
      onMessage={handleMessage}
      style={{
        width: "100%",
        flex: 1,
        borderRadius: 12,
        overflow: "hidden"
      }}
    />
  );
}
```

### Guest-side messaging

Inside the loaded guest bundle, use the `useHost` hook to establish a communication channel back to the host environment.

```tsx
import { useHost } from "@zynthjs/hypervisor";
import { createSignal } from "solid-js";

function GuestApp() {
  const host = useHost();
  const [status, setStatus] = createSignal("idle");

  if (host) {
    // Listen for incoming messages from the Host
    host.onMessage((data) => {
      console.log("Guest received:", data);
      setStatus(`Host says: ${data.text}`);
    });
  }

  const sendPing = () => {
    host?.postMessage({ type: "GUEST_PING", timestamp: Date.now() });
  };

  return (
    <View onclick={sendPing}>
      <Text>{status()}</Text>
    </View>
  );
}
```

## Advanced

### Imperative Control

To programmatically control the Guest runtime (e.g., triggering a reload or sending proactive messages), use the `ref` prop to access the `HypervisorRef` API.

```tsx
import { Hypervisor, HypervisorRef } from "@zynthjs/hypervisor";

function ManagedHypervisor() {
  let hypervisor: HypervisorRef | undefined;

  const refreshPlugin = () => {
    hypervisor?.reload();
  };

  const broadcastEvent = () => {
    hypervisor?.postMessage({
      event: "THEME_CHANGE",
      mode: "dark"
    });
  };

  return (
    <View>
      <Button onPress={refreshPlugin} label="Refresh" />
      <Hypervisor
        ref={(r) => (hypervisor = r)}
        source={{ uri: "bundle_uri" }}
      />
    </View>
  );
}
```

### Dynamic Code Loading

Instead of a URI, you can pass raw bundle code directly to the Hypervisor for executing dynamically generated or cached logic.

```tsx
const code = `
  import { View, Text } from "@zynthjs/ui";
  export default () => <View><Text>Dynamic Payload</Text></View>;
`;

<Hypervisor 
  source={{ code }} 
  onError={(e) => console.log("Init failed", e.message)}
/>
```

## Special cases

- **Memory Management**: When the `Hypervisor` component is unmounted, it automatically cleans up the guest runtime and its associated Yoga layout tree to prevent memory leaks.
- **Portals & Overlays**: Guest runtimes are contained within their specified `style` bounds. While they maintain their own UI stack, they cannot project content outside the parent container's coordinate system.
- **Platform Availability**: Hypervisor is optimized for iOS and Android native runtimes. On Web, it relies on iframe isolation where available, though full layout tree parity is context-dependent.

## API Reference

### `Hypervisor` Props

- `source: { uri: string } | { code: string }`
  The source of the Zynth bundle to execute.
- `style?: ViewStyle`
  Container styles for the guest viewport.
- `onLoad?: () => void`
  Triggered when the guest bundle finishes initializing.
- `onError?: (error: { message: string }) => void`
  Triggered on runtime errors or bundle load failures.
- `onMessage?: (payload: unknown) => void`
  Triggered when the guest calls `host.postMessage()`.
- `ref?: (ref: HypervisorRef | null) => void`
  Access to the imperative controller.

### `HypervisorRef` methods

- `reload()`: Restarts the guest runtime from its source.
- `destroy()`: Force-terminates the guest session.
- `postMessage(payload: unknown)`: Sends a serializable payload to the guest (received via `useHost().onMessage`).

### Hooks

#### `useHost()`
Access the host bridge from within a **Guest** application.
- **Returns**: `HostBridgeApi | null` (returns `null` if the app is running in the main context, not inside a hypervisor).
- **Methods**:
  - `postMessage(payload: any)`: Sends data to the host's `onMessage` listener.
  - `onMessage(callback: (payload: any) => void)`: Subscribes to host events. Returns an unsubscribe function.

#### `useHypervisorRefHandle()`
Utility for creating a stable handle that can be passed to the `ref` prop of a Hypervisor component.
- **Returns**: `[HypervisorRefHandle, HypervisorBridgeRef]`
  - `HypervisorRefHandle`: Should be passed to the `ref` prop.
  - `HypervisorBridgeRef`: The API object used to call `reload`, `destroy`, or `postMessage`.
