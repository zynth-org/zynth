# Network

The default connectivity surface in Zynth is `connectivity`, which provides simple, cross-platform monitoring of device connectivity and internet reachability.

It abstracts the differences between iOS (Network framework), Android (ConnectivityManager), and Web (Navigator.onLine) to provide a unified reactive state.

To monitor network state on Android, you must declare the following permissions in your `app.json`.

```json
{
  "zynth": {
    "android": {
      "permissions": [
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.INTERNET"
      ]
    }
  }
}
```

## Basic usage

### Synchronous State

Access the current connectivity snapshot using `connectivity.current`.

```ts
import { connectivity } from "@zynthjs/apis";

const { isConnected, type } = connectivity.current;

if (!isConnected) {
  console.log("Offline mode active.");
}
```

### Connection Subscriptions

React to changes in network quality or type (e.g., switching from WiFi to Cellular).

```ts
import { connectivity } from "@zynthjs/apis";

const unsubscribe = connectivity.subscribe((state) => {
  if (state.type === "cellular" && state.isExpensive) {
    console.log("Heads up: Using metered data.");
  }
});
```

## Advanced

### Network Types

Zynth classifies connections into the following stable categories:
- `wifi`: High-speed wireless.
- `cellular`: Mobile data (LTE, 5G, etc.).
- `ethernet`: Local wired connection.
- `vpn`: Active VPN tunnel.
- `none`: No network hardware active.
- `unknown`: OS could not determine the connection medium.

## Special cases

- **Internet Reachability**: `isConnected` represents the hardware state (the device is connected to a router/tower), while `isInternetReachable` represents whether a packet can actually reach the public internet (best-effort calculation by the OS).
- **Expensive Connections**: On Android and iOS, Zynth correctly identifies "metered" connections (Cellular or specific WiFi hotspots) to help apps minimize data consumption.

## API Reference

### `connectivity.current`: `NetworkState`
Returns the current frozen snapshot of the connectivity status.

### `connectivity.subscribe(listener: (state: NetworkState) => void): () => void`
Adds a reactive listener for connectivity changes. Returns an unsubscribe function.

### `connectivity.onChange(listener: (state: NetworkState) => void): () => void`
Alias for `subscribe()`.

### `connectivity.refresh(): NetworkState`
Triggers an immediate re-poll of the native connectivity manager.

### `NetworkState` (Type)
- `isConnected: boolean`
- `isInternetReachable: boolean`
- `type: NetworkType`
- `isExpensive: boolean`

### Legacy compatibility

`Network.currentState`, `Network.subscribe()`, `Network.addEventListener("change", ...)`, and `Network.refresh()` remain available for compatibility.
