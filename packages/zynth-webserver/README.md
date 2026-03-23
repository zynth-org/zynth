# @zynth/webserver

Embedded native HTTP server for Zynth apps.

`@zynth/webserver` provides:

- Static content serving from local files or inline HTML
- HTTP transport (legacy-compatible) and optional HTTPS transport
- Local file upload endpoints
- Typed upload lifecycle events (`started`, `progress`, `completed`, `failed`)
- Optional upload metadata callback endpoint
- Optional token guard for upload/events/signal routes
- Upload state inspection (active uploads + totals)
- In-memory app-to-web signaling endpoint (`/__zynth/signal`)
- Solid-friendly signal + subscription helpers

## Install

```bash
npm i @zynth/webserver
```

Regenerate native projects after adding the package.

## Quick Start

```ts
import { WebServer } from "@zynth/webserver";

const info = await WebServer.start({
  port: 0,
  indexHtml: "<h1>Hello from Zynth</h1>",
  upload: {
    enabled: true,
    maxBytes: 10 * 1024 * 1024,
  },
  events: {
    enabled: true,
  },
});

console.log(info.url, info.uploadPath, info.eventsPath, info.signalPath);

await WebServer.stop();
```

### HTTPS Start (LAN Production)

```ts
const info = await WebServer.start({
  port: 53317,
  tls: {
    enabled: true,
    certificatePath: "/absolute/path/to/server.pem",
  },
  security: {
    authToken: "zynth-server-token",
    authTokenHeader: "X-Zynth-Server-Token",
  },
});

console.log(info.url, info.scheme, info.secureTransport);
```

## Solid Integration

Use `createWebServerSignal()` in components to manage lifecycle state and read events.

```ts
import { createWebServerSignal } from "@zynth/webserver";

const server = createWebServerSignal();

await server.start({
  port: 0,
  upload: { enabled: true },
  events: { enabled: true },
});

const events = await server.pollEvents(100);
console.log(events.length);
```

## Endpoints

Default endpoints (when enabled):

- Upload: `/__zynth/upload`
- Browser->App event postbox: `/__zynth/events`
- App->Browser signal store: `/__zynth/signal`
- Compatibility alias: `/__zynth/reply`

Optional endpoint:

- Upload metadata callback: disabled by default (`upload.metadataPath`)

## Uploads

### Start With Upload + Metadata + Guard

```ts
await WebServer.start({
  security: {
    authToken: "zynth-demo-token",
    authTokenHeader: "X-Zynth-Server-Token",
    authTokenQueryParam: "token",
  },
  upload: {
    enabled: true,
    path: "/__zynth/upload",
    metadataPath: "/__zynth/upload/metadata",
    maxBytes: 10 * 1024 * 1024,
  },
  events: {
    enabled: true,
  },
});
```

### Upload Event Types

- `upload_started`
- `upload_progress`
- `upload_completed`
- `upload_failed`
- `upload_metadata`

Use `WebServer.drainEvents(...)` or `WebServer.subscribe(...)` to receive them.

### Upload State

```ts
const state = await WebServer.getUploadState();
console.log(state.activeCount, state.totalCompleted, state.totalBytesReceived);
```

## In-Memory Signaling

The signal store solves app->browser communication without filesystem polling.

### API

- `WebServer.setSignal(key, payload)`
- `WebServer.getSignal(key, consume?)`
- `WebServer.getSignalPath()`

Compatibility aliases:

- `setReply` -> `setSignal`
- `getReply` -> `getSignal`
- `/__zynth/reply` -> `/__zynth/signal`

### Semantics

- Writes are keyed (`key -> JSON payload`).
- `GET /__zynth/signal?id=<key>` defaults to consume-on-read.
- Use `consume=0` for non-consuming reads.
- Missing key returns `204 No Content`.

### HTTP Contract

- `GET /__zynth/signal?id=<key>&consume=1|0`
  - `200` with JSON payload when found
  - `204` when not found
  - `400` when `id` is missing
  - `405` for unsupported methods

### App-Side Example

```ts
await WebServer.setSignal("offer-42", {
  requestId: "offer-42",
  decision: "accepted",
  accepted: true,
  at: Date.now(),
});

const peek = await WebServer.getSignal("offer-42", false);
console.log(peek);
```

### Browser-Side Example

```ts
async function waitForDecision(requestId: string): Promise<unknown | null> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `/__zynth/signal?id=${encodeURIComponent(requestId)}&consume=1`
    );
    if (res.status === 200) {
      return await res.json();
    }
    if (res.status !== 204) {
      throw new Error(`Signal read failed: HTTP ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
```

## Full Offer/Decision Handshake (Recommended)

This is the common pattern for accept/reject workflows.

### 1) Browser posts offer to app

```ts
await fetch("/__zynth/events", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    type: "signal_offer",
    requestId: "offer-123",
    fileName: "report.pdf",
    size: 120394,
    at: Date.now(),
  }),
});
```

### 2) App listens for `message` events

```ts
const events = await WebServer.drainEvents(100);
for (const event of events) {
  if (event.type !== "message" || typeof event.payload !== "object") continue;
  const payload = event.payload as Record<string, unknown>;
  if (payload.type === "signal_offer" && typeof payload.requestId === "string") {
    // Show offer in UI, then resolve with setSignal(...)
  }
}
```

### 3) App resolves request ID

```ts
await WebServer.setSignal("offer-123", {
  requestId: "offer-123",
  decision: "rejected",
  accepted: false,
  reason: "user_declined",
  at: Date.now(),
});
```

### 4) Browser receives final decision

```ts
const res = await fetch("/__zynth/signal?id=offer-123&consume=1");
if (res.status === 200) {
  const decision = await res.json();
  console.log(decision);
}
```

## Subscriptions

`WebServer.subscribe` is the preferred continuous stream API.

```ts
const sub = WebServer.subscribe(
  (snapshot) => {
    console.log(snapshot.running, snapshot.uploadState.activeCount);
    snapshot.events.forEach((event) => {
      console.log(event.type, event.payload);
    });
  },
  {
    pollIntervalMs: 400,
    maxEvents: 100,
    includeUploadState: true,
  },
);

sub.remove();
```

## Production Notes

- HTTP remains supported for compatibility/dev flows. HTTPS is optional and opt-in via `tls.enabled`.
- In production, `WebServer.start()` blocks insecure HTTP by default. Set `security.allowInsecureHttp=true` only for explicit non-production or trusted internal workflows.
- `security.authToken` protects upload, metadata, events, and signal endpoints. Prefer passing it via header (`security.authTokenHeader`) instead of query parameters.
- Prefer stable request IDs (UUIDs) for signaling keys.
- Use `consume=1` for one-shot decisions.
- Use `consume=0` only for diagnostics/preview.
- Treat `204` as "not ready yet", not as an error.
- Keep polling intervals reasonable (300-1000ms).
- Signal storage is in-memory and process-local.
- Legacy alias endpoints/methods are supported for compatibility.

## API Reference

### `WebServer`

- `start(options?: WebServerStartOptions): Promise<WebServerInfo>`
- `stop(): Promise<void>`
- `isRunning(): Promise<boolean>`
- `getInfo(): Promise<WebServerInfo | null>`
- `getUploadState(): Promise<WebServerUploadState>`
- `drainEvents(maxEvents?: number): Promise<WebServerEvent[]>`
- `setSignal(key: string, payload: unknown): Promise<void>`
- `getSignal<T = unknown>(key: string, consume?: boolean): Promise<T | null>`
- `setReply(key: string, payload: unknown): Promise<void>` (compatibility alias)
- `getReply<T = unknown>(key: string, consume?: boolean): Promise<T | null>` (compatibility alias)
- `subscribe(listener, options?): WebServerSubscription`
- `isAvailable(): boolean`
- `getSignalPath(): string`
- `getReplyPath(): string`

### `createWebServerSignal()`

Returns `WebServerSignal` with:

- Accessors: `status`, `info`, `error`
- Actions:
  - `start`, `stop`
  - `pollEvents`, `getUploadState`
  - `setSignal`, `getSignal`
  - `setReply`, `getReply`
  - `subscribe`

### Core Types

- `WebServerStatus`
  - `"idle" | "starting" | "running" | "stopped" | "error"`

- `WebServerStartOptions`
  - `host?`, `port?`, `documentRoot?`, `indexHtml?`, `upload?`, `events?`, `security?`, `tls?`

- `WebServerUploadOptions`
  - `enabled?`, `path?`, `directory?`, `maxBytes?`
  - `metadataPath?`, `authToken?`, `authTokenHeader?`, `authTokenQueryParam?`
  - note: upload auth fields are supported for backward compatibility; prefer `security.*`

- `WebServerSecurityOptions`
  - `allowInsecureHttp?`
  - `authToken?`, `authTokenHeader?`, `authTokenQueryParam?`

- `WebServerTlsOptions`
  - `enabled?`
  - `certificatePath?` (PEM certificate/private key bundle for CivetWeb `ssl_certificate`)

- `WebServerEventsOptions`
  - `enabled?`, `path?`

- `WebServerInfo`
  - `host`, `port`, `url`, `scheme`, `secureTransport`, `documentRoot?`, `uploadPath?`, `uploadMetadataPath?`, `eventsPath?`, `signalPath?`, `replyPath?`

## Native TLS Build Flags

TLS transport availability is controlled at native build time.

- Android compiles CivetWeb with TLS (bundled mbedTLS backend) when Gradle property `zynthWebServerTls=true`.
- iOS compiles with TLS only when pod install evaluates `ZYNTH_WEBSERVER_TLS=1`.
- On Android, if TLS is requested but mbedTLS sources are missing, the module falls back to `NO_SSL` and emits a CMake warning (build succeeds, HTTPS remains unavailable).
- `zynth prebuild android` auto-fetches the required mbedTLS/CivetWeb TLS sources when `nativeTls` is enabled, so those sources do not need to be committed in your app repository.

The recommended way is to configure this in `app.json` and let `zynth prebuild` wire both platforms.

```json
{
  "zynth": {
    "packages": {
      "@zynth/webserver": {
        "nativeTls": true
      }
    }
  }
}
```

Prebuild behavior:

- `zynth prebuild android` writes `zynthWebServerTls=true` to `android/gradle.properties`.
- `zynth prebuild ios` runs `pod install` with `ZYNTH_WEBSERVER_TLS=1`.

Aliases accepted for backward compatibility in package config:

- `tlsNative`
- `nativeTlsEnabled`
- `enableNativeTls`
- `enableTls`

If TLS is requested at runtime (`tls.enabled=true`) but native was built without TLS, startup fails with `E_TLS_NOT_AVAILABLE` (or `E_NATIVE_ERROR` on older builds).

## Client Trust For Self-Signed HTTPS

Server-side TLS startup and client-side HTTPS trust are separate concerns.

When your server uses a self-signed certificate, Android `fetch` must be given an explicit trust bundle for that request. Use the PEM certificate block you started the server with:

```ts
const res = await fetch("https://127.0.0.1:53317/__zynth/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Zynth-Server-Token": "zynth-demo-token",
  },
  body: JSON.stringify({ ping: true }),
  tls: {
    trustedCertificatesPem: [serverPemCertificate],
  },
});
```

Notes:

- `trustedCertificatesPem` accepts one PEM string or an array of PEM strings.
- This affects only the current request and does not modify global OS trust settings.
- For production peer-to-peer flows, pin the expected peer certificate/fingerprint and rotate trust explicitly.

- `WebServerEventType`
  - `"upload_started" | "upload_progress" | "upload_completed" | "upload_failed" | "upload_metadata" | "message"`

- `WebServerEvent`
  - `type`, `payload`, `rawPayload`

- `WebServerUploadState`
  - `activeCount`, `totalStarted`, `totalCompleted`, `totalFailed`, `totalBytesReceived`, `activeUploads`

- `WebServerSubscribeOptions`
  - `pollIntervalMs?`, `maxEvents?`, `emitImmediately?`, `includeUploadState?`

- `WebServerSubscriptionSnapshot`
  - `timestamp`, `running`, `info`, `uploadState`, `events`

- `WebServerSubscription`
  - `remove()`
