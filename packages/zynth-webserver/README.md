# WebServer

The `WebServer` module provides a lightweight HTTP server powered natively by Civetweb on iOS and Android. It binds via JSI to deliver a secure localhost server, ideal for handling cross-device file uploads, local metadata callbacks, and general app-to-web signaling without relying on a remote backend.

Designed to have a minimal footprint, it runs efficiently in the background while conserving battery and memory consumption. It provides both imperative APIs through the `WebServer` object and reactive primitives like `createWebServerSignal` specifically tailored for SolidJS views.

## Basic usage

The most common use case is starting a simple HTTP server to serve static content or accept local uploads. We recommend using `createWebServerSignal` to seamlessly integrate the server's lifecycle and state into your UI.

```tsx
import { Button, Text, View } from "@zynth/components";
import { createWebServerSignal } from "@zynth/webserver";
import { createEffect, onCleanup } from "solid-js";

export function LocalServer() {
  const server = createWebServerSignal();

  const handleStart = async () => {
    try {
      await server.start({
        port: 8080,
        upload: {
          enabled: true,
          path: "/__zynth/upload",
        },
      });
    } catch (error) {
      console.log("Server failed to start", error);
    }
  };

  const handleStop = async () => {
    await server.stop();
  };

  createEffect(() => {
    if (server.status() === "running") {
      const sub = server.subscribe((snapshot) => {
        console.log(`Active uploads: ${snapshot.uploadState.activeCount}`);
      });
      onCleanup(() => sub.remove());
    }
  });

  return (
    <View>
      <Text>Server Status: {server.status()}</Text>
      <Button title="Start Server" onPress={handleStart} disabled={server.status() === "running"} />
      <Button title="Stop Server" onPress={handleStop} disabled={server.status() !== "running"} />
    </View>
  );
}
```

## Advanced signals and tokens

For secure interactions or single-page app signaling, `WebServer` supports authenticated requests and dynamic signal states. You can require an authorization token for uploads and seamlessly send data back to your application runtime using the signal API.

```tsx
import { createWebServerSignal } from "@zynth/webserver";

const AUTH_TOKEN = "secure-auth-token";

export function SecuredSignalingServer() {
  const server = createWebServerSignal();

  const handleStart = async () => {
    await server.start({
      port: 0, // Automatically assign an open port
      security: {
        authToken: AUTH_TOKEN,
      },
      events: {
        enabled: true,
      }
    });
  };

  const handleIncomingSignal = async () => {
    // Reading data sent to the /__zynth/signal endpoint
    const data = await server.getSignal<{ user: string }>("my-signal-key", true);
    if (data) {
      console.log("Signal received:", data.user);
    }
  };

  return null;
}
```

## Special Cases

### Web Support and Multi-Target Availability

`WebServer` relies on native hardware bindings (specifically Civetweb in C++). Because of browser security constraints, HTTP server capabilities are fundamentally unsupported directly on Web targets. You should evaluate `WebServer.isAvailable()` before mounting server-dependent logic to gracefully degrade on the web.

```tsx
import { WebServer } from "@zynth/webserver";

if (!WebServer.isAvailable()) {
  console.log("Local web server is not available in this environment.");
}
```

### Automatic Port Assignment

If you provide `0` as the port in your configurations, the OS will automatically assign an available port. This avoids potential collisions with other services or instances of the framework. You can inspect the allocated URL and port by checking `server.info()`.

## API Reference

### `createWebServerSignal`

Creates a reactive API object integrated with SolidJS, exposing signals for connection status, server info, and errors. Additionally, it exposes methods to orchestrate the server state and listen for activities.

**Type**

```ts
function createWebServerSignal(): WebServerSignal;
```

**Returns**

A `WebServerSignal` interface consisting of:
*   `status`: Accessor to the current lifecycle phase (`"idle" | "starting" | "running" | "stopped" | "error"`).
*   `info`: Accessor to resolved server information and URLs.
*   `error`: Accessor to runtime errors.
*   `start(options?: WebServerStartOptions)`: Starts the server.
*   `stop()`: Stops the active server.
*   `subscribe(listener, options)`: Polls server events continuously.
*   `getSignal(key, consume)`: Reads an inbound HTTP payload securely.
*   `setSignal(key, payload)`: Sets an outbound payload.

### `WebServer`

The fundamental object providing imperative control over the Web Server engine.

### `WebServer.start`

Starts the HTTP server securely using the designated configurations. 

**Type**

```ts
function start(options?: WebServerStartOptions): Promise<WebServerInfo>;
```

**Parameters**

*   `options` (`WebServerStartOptions`, optional): Configuration for the HTTP instance.
    *   `host` (`string`, optional): Host interface to bind (defaults to `0.0.0.0`).
    *   `port` (`number`, optional): Port directly requested, `0` assigns automatically.
    *   `tls` (`WebServerTlsOptions`, optional): Native managed or manual TLS provisioning instructions.
    *   `upload` (`WebServerUploadOptions`, optional): Setup paths, directory, sizes, and auth tokens for file ingestion.
    *   `events` (`WebServerEventsOptions`, optional): Enable and specify a path for generic event payloads.
    *   `security` (`WebServerSecurityOptions`, optional): Handle tokens and insecure HTTP behavior settings.

### `WebServer.stop`

Brings down the server synchronously and detaches listening sockets.

**Type**

```ts
function stop(): Promise<void>;
```

### `WebServer.subscribe`

Registers a continuous polling mechanism that will execute a designated listener capturing events or progress in uploads. 

**Type**

```ts
function subscribe(listener: (snapshot: WebServerSubscriptionSnapshot) => void, options?: WebServerSubscribeOptions): WebServerSubscription;
```

**Returns**

An object with a `.remove()` method to cleanly execute detachment and clear the polling interval.

### `WebServer.setSignal`

Saves an arbitrary JavaScript object to memory mapped by a key, accessible remotely via HTTP or directly by the native environment later.

**Type**

```ts
function setSignal(key: string, payload: unknown): Promise<void>;
```

### `WebServer.getSignal`

Resolves a payload securely from the signal endpoint. A common practice is setting `consume = true` so the payload is concurrently removed from native memory upon retrieval.

**Type**

```ts
function getSignal<T = unknown>(key: string, consume?: boolean): Promise<T | null>;
```

### `WebServer.isAvailable`

Returns true if the target system environment safely executes the Civetweb wrapper. Evaluates strictly to `false` on Web environments.

**Type**

```ts
function isAvailable(): boolean;
```
