# @rune/hmr

Custom HMR (Hot Module Replacement) server for Rune native development, built on Rsbuild and Rspack.

## Features

- 🔥 Fast rebuilds with Rspack
- 🔌 WebSocket-based HMR protocol
- 📦 Asset serving with manifest generation
- 📱 Native device status indicators
- 🎯 Tailored specifically for Rune's native workflow

## Architecture

The HMR server consists of several key components:

- **Bundler**: Rsbuild configuration and build orchestration with Rspack
- **Server**: Lightweight Hono HTTP server with WebSocket support
- **Asset Server**: Static asset serving with URL mapping and manifest generation
- **Bundle Watcher**: File watching with chokidar and automatic rebuild triggering
- **WebSocket Handler**: Real-time communication with native devices
- **Logger**: Beautiful formatted console output for excellent dev experience

## Usage

### Basic Setup

```typescript
import { RuneHMRServer } from "@rune/hmr";

const server = new RuneHMRServer({
  appRoot: process.cwd(),
  port: 8081,
  outDir: "dist",
  host: "localhost",
});

await server.start();

// Get server info
console.log(server.getInfo());
// {
//   host: 'localhost',
//   port: 8081,
//   clients: 2,
//   building: false,
//   bundleUrl: 'http://localhost:8081/bundle/main.js',
//   wsUrl: 'ws://localhost:8081/rune-native'
// }
```

### With Graceful Shutdown

```typescript
const server = new RuneHMRServer({
  appRoot: process.cwd(),
  port: 8081,
});

await server.start();

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
```

### Force Rebuild

```typescript
// Trigger manual rebuild
await server.rebuild();
```

## Development

```bash
# Install dependencies
yarn install

# Build
yarn build

# Watch mode
yarn dev
```

## HTTP Endpoints

- `GET /` - Server information and available endpoints
- `GET /bundle/main.js` - Serve the compiled JavaScript bundle
- `GET /bundle/main.js.map` - Serve source map
- `GET /assets/*` - Serve static assets (images, fonts, etc.)
- `GET /asset-manifest.json` - Asset manifest with public URLs
- `GET /health` - Health check endpoint
- `WS /rune-native` - WebSocket endpoint for HMR communication

## WebSocket Protocol

### Client → Server Messages

```typescript
// Handshake with platform info
{
  event: 'rune:hello',
  data: {
    platform: 'ios' | 'android',
    version: '1.0.0',
    deviceId: 'iPhone15,2'
  }
}

// Ping to keep connection alive
{
  event: 'rune:ping',
  data: {}
}

// Request bundle
{
  event: 'rune:bundle-request',
  data: {}
}
```

### Server → Client Messages

```typescript
// Bundle update notification
{
  type: 'update',
  timestamp: 1696176000000,
  data: {
    bundleSize: 250000,
    bundlePath: '/bundle/main.js'
  }
}

// Build error notification
{
  type: 'error',
  timestamp: 1696176000000,
  data: {
    message: 'Build failed',
    stack: '...'
  }
}

// Ping/pong for keep-alive
{
  type: 'ping' | 'pong',
  timestamp: 1696176000000
}
```

## Asset Manifest

During development, assets are served via HTTP and tracked in a manifest:

```json
{
  "logo.png": "http://localhost:8081/assets/logo.png",
  "icon.png": "http://localhost:8081/assets/icon.png"
}
```
