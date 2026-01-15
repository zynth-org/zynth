# @rune/webserver

Embedded local web server for Rune apps, backed by CivetWeb. It serves static
files, supports an optional inline `index.html`, and exposes simple upload and
message endpoints with a polling API on the JS side.

## Usage

```ts
import { WebServer } from "@rune/webserver";

const info = await WebServer.start({
  host: "0.0.0.0",
  port: 0,
  documentRoot: "/path/to/site",
  indexHtml: "<!doctype html><html>...</html>",
  upload: {
    directory: "/path/to/uploads",
  },
});

console.log(info.url);
```

### SolidJS helper

```ts
import { createWebServerSignal } from "@rune/webserver";

const server = createWebServerSignal();
await server.start({ documentRoot: "/path/to/site" });
```

## Endpoints

- `POST`/`PUT` `/__rune/upload` uploads raw file data.
  - Send a filename via `X-File-Name` header or `?name=...` query string.
  - The native layer defaults to a temp/cache directory when no upload
    directory is provided.
- `POST` `/__rune/events` stores an arbitrary message payload for later polling.

Example upload from a browser:

```ts
const uploadUrl = `${info.url}/__rune/upload?name=${encodeURIComponent(file.name)}`;
await fetch(uploadUrl, {
  method: "PUT",
  headers: { "X-File-Name": file.name },
  body: file,
});
```

Poll events from JS:

```ts
const events = await WebServer.drainEvents();
for (const event of events) {
  console.log(event.type, event.payload);
}
```

Events include:

- `upload`: `{ name, path, size }`
- `message`: JSON payload if parsable, otherwise raw string

## Importing HTML in apps

If you want to `import` HTML as a string (e.g., `indexHtml`), add a loader in
your app’s `rsbuild.config.ts` and a module declaration so TypeScript resolves
the import.

`apps/components/rsbuild.config.ts` (example):

```ts
import { defineRuneConfig } from "@rune/rsbuild-plugin";

export default defineRuneConfig({
  tools: {
    rspack(config) {
      config.module ??= {};
      config.module.rules ??= [];
      config.module.rules.unshift({
        test: /\.html$/i,
        type: "asset/source",
      });
    },
  },
});
```

TypeScript declaration (e.g. `apps/components/src/types/html.d.ts`):

```ts
declare module "*.html" {
  const html: string;
  export default html;
}
```

## Notes

- Use `documentRoot` for static assets and `indexHtml` for a single-page entry.
- `host: "0.0.0.0"` exposes the server on the local network; choose a specific
  interface if you want it local-only.
- If you plan to import HTML from disk, use a raw text loader or inline the
  contents in your app code.
- CivetWeb sources are vendored under `native/civetweb` (MIT license).
