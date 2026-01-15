# @rune/hypervisor

Run multiple isolated Rune applications within a single host.

The Hypervisor allows you to embed a secondary Rune runtime inside a view. This is ideal for:
*   **Micro-frontends**: Loading independent features or mini-apps dynamically.
*   **Sandboxing**: Running untrusted or third-party code in an isolated environment.
*   **Live Previews**: Rendering code strings directly (e.g., for IDEs or playgrounds).

## Features

*   **Isolation**: Each Hypervisor view runs in its own `RuneRuntime` instance with a separate JS VM context.
*   **Dynamic Loading**: Load apps from a remote URI or a raw code string.
*   **Communication**: Two-way messaging between the Host and the Guest app via `postMessage`.

## Usage

```tsx
import { Hypervisor } from "@rune/hypervisor";

function App() {
  return (
    <Hypervisor
      style={{ flex: 1 }}
      source={{ uri: "https://example.com/mini-app.bundle.js" }}
      onLoad={() => console.log("Mini-app loaded")}
      onMessage={(msg) => console.log("Message from guest:", msg)}
    />
  );
}
```

## Controller

You can control the guest instance using `useHypervisorController`.

```tsx
const controller = useHypervisorController();

// ...
<Hypervisor controller={controller} ... />

// Reload the guest app
controller.reload();
```
