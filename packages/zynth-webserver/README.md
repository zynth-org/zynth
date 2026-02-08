# @zynth/webserver

Embedded native HTTP server for Zynth apps.

`@zynth/webserver` provides:

- Static content serving from local files or inline HTML
- Local file upload endpoints
- Typed upload lifecycle events (`started`, `progress`, `completed`, `failed`)
- Optional upload metadata callback endpoint
- Optional token guard for upload/metadata routes
- Upload state inspection (active uploads + totals)
- Solid-friendly signal + subscription helpers

## Basic

### Install

```bash
npm i @zynth/webserver
```

Regenerate native projects after adding the package.

### Basic usage

```ts
import { WebServer } from "@zynth/webserver";

const info = await WebServer.start({
  port: 0,
  indexHtml: "<h1>Hello</h1>",
  upload: {
    enabled: true,
    directory: "/tmp/uploads",
    maxBytes: 10 * 1024 * 1024,
  },
  events: {
    enabled: true,
  },
});

console.log(info.url);

const events = await WebServer.drainEvents(100);
console.log(events.length);

await WebServer.stop();
```

### Recommended Solid usage

Use `createWebServerSignal()` in components. It manages start/stop status and gives low-level accessors/actions.

```ts
import { createWebServerSignal } from "@zynth/webserver";

const server = createWebServerSignal();

await server.start({
  port: 0,
  upload: { enabled: true },
  events: { enabled: true },
});

const events = await server.pollEvents(100);
```

## Advanced

### Why `subscribe`

`WebServer.subscribe` is the preferred event stream DX when you want continuous updates without manually polling everywhere.

- provides periodic snapshots (`running`, `info`, `events`, `uploadState`)
- configurable interval/event batch size
- single `remove()` cleanup contract
- safe fallback behavior if individual snapshot fields fail

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

### Upload metadata callback

You can expose a separate metadata endpoint and receive `upload_metadata` events.

```ts
await WebServer.start({
  upload: {
    enabled: true,
    metadataPath: "/__zynth/upload/metadata",
  },
});

// POST JSON to /__zynth/upload/metadata
// then read via WebServer.drainEvents(...)
```

### Upload guard token

Set `upload.authToken` to require token validation on upload/metadata endpoints.

By default, token is accepted from:

- header: `X-Zynth-Upload-Token`
- query param: `token`

Both keys are customizable:

- `upload.authTokenHeader`
- `upload.authTokenQueryParam`

```ts
await WebServer.start({
  upload: {
    enabled: true,
    authToken: "zynth-demo-token",
    authTokenHeader: "X-Zynth-Upload-Token",
    authTokenQueryParam: "token",
  },
});
```

### Upload lifecycle events

Upload route emits structured events:

- `upload_started`
- `upload_progress`
- `upload_completed`
- `upload_failed`

Each lifecycle event payload includes fields like:

- `uploadId`, `phase`, `name`, `path`
- `bytesReceived`, `totalBytes`
- `method`, `remoteAddress`, `contentType`
- `statusCode`, `reason`, `metadata`

### Upload inspection

Use upload state to inspect active transfers and aggregate totals.

```ts
const state = await WebServer.getUploadState();
console.log(state.activeCount, state.totalCompleted, state.totalBytesReceived);
```

### Common endpoint defaults

When enabled, defaults are:

- upload path: `/__zynth/upload`
- events path: `/__zynth/events`
- metadata path: `null` (disabled unless explicitly set)

## API reference

### `WebServer`

- `start(options?: WebServerStartOptions): Promise<WebServerInfo>`
- `stop(): Promise<void>`
- `isRunning(): Promise<boolean>`
- `getInfo(): Promise<WebServerInfo | null>`
- `getUploadState(): Promise<WebServerUploadState>`
- `drainEvents(maxEvents?: number): Promise<WebServerEvent[]>`
- `subscribe(listener, options?): WebServerSubscription`
- `isAvailable(): boolean`

### `createWebServerSignal()`

Returns `WebServerSignal` with:

- accessors: `status`, `info`, `error`
- actions: `start`, `stop`, `pollEvents`, `getUploadState`, `subscribe`

### Core types

- `WebServerStatus`
  - `"idle" | "starting" | "running" | "stopped" | "error"`

- `WebServerStartOptions`
  - `host?`, `port?`, `documentRoot?`, `indexHtml?`, `upload?`, `events?`

- `WebServerUploadOptions`
  - `enabled?`, `path?`, `directory?`, `maxBytes?`
  - `metadataPath?`, `authToken?`, `authTokenHeader?`, `authTokenQueryParam?`

- `WebServerEventsOptions`
  - `enabled?`, `path?`

- `WebServerInfo`
  - `host`, `port`, `url`, `documentRoot?`, `uploadPath?`, `uploadMetadataPath?`, `eventsPath?`

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
