# @zynth/webserver

A lightweight, native HTTP server for Zynth apps.

This package allows your Zynth application to serve static content or handle file uploads directly from the device. It is useful for building local file sharing tools, custom dev servers, or offline-first interfaces.

## Features

*   **Static Serving**: Serve a directory from the local filesystem (e.g., `Documents` folder).
*   **File Uploads**: Accept `POST` requests to upload files to a specific directory.
*   **Event Polling**: Retrieve events (like uploads) from the JS side.
*   **Signal Adapter**: `createWebServerSignal` for reactive server status.

## Usage

### Start Server

```tsx
import { WebServer, Paths } from "@zynth/webserver";

const info = await WebServer.start({
  port: 8080,
  documentRoot: Paths.documentDirectory,
  upload: {
    enabled: true,
    directory: Paths.documentDirectory + "/uploads",
  }
});

console.log(`Server running at ${info.url}`);
```

### Stop Server

```tsx
await WebServer.stop();
```

### Handle Events

```tsx
import { createWebServerSignal } from "@zynth/webserver";

const server = createWebServerSignal({ port: 8080 });

// Access latest event
const event = server.lastEvent();
if (event?.type === "upload") {
  console.log("File uploaded:", event.payload);
}
```