# @rune/ios (RuneKit)

The native iOS runtime for the Rune framework.

This package provides the host environment for executing SolidJS applications on iOS. It is built on top of Hermes and utilizes JSI for efficient native interoperability.

## Architecture

### 1. Runtime Host
*   **Hermes Support**: Uses `HermesRuntimeHost` to run the Hermes engine on iOS, ensuring consistent behavior with Android.
*   **JSI Binding**: Exposes native methods directly to the JS global scope (`__ui`, `__modules`) for high-performance synchronous calls.

### 2. View Management (`SNUIManager`)
The `SNUIManager` (Solid Native UI Manager) is responsible for:
*   **View Hierarchy**: Creating, updating, and removing `UIView` instances.
*   **Layout**: Integrating with Yoga to calculate layouts based on Flexbox rules.
*   **Event Dispatching**: Forwarding native events (touch, scroll) back to the JavaScript callback.

### 3. Modules
Native capabilities are exposed through `RuneModule`. The `RuneRuntime` handles module registration and method invocation.

## Key Components

*   **`RuneRuntime`**: The main controller for the Rune instance.
*   **`HermesRuntimeHost`**: C++ wrapper for the Hermes runtime.
*   **`SNUIManager`**: Manages the UI tree and Yoga layout nodes.