# @rune/hmr TODO

## Phase 1: Package Structure + Rsbuild Config ✅

- [x] Create package.json with dependencies
- [x] Setup tsconfig.json
- [x] Create type definitions
- [x] Implement Rsbuild configuration factory
- [x] Create AssetManifest class
- [x] Create Logger utility
- [x] Create main index.ts exports
- [x] Add README.md
- [x] Create example config file

## Phase 2: HMR Server Implementation ✅

- [x] Implement Hono server in `server/index.ts`
- [x] Create WebSocket handler in `server/websocket.ts`
- [x] Implement asset server in `server/asset-server.ts`
- [x] Create bundle watcher in `server/bundle-watcher.ts`
- [x] Integrate Rsbuild compiler
- [x] Add file watching with chokidar
- [x] Implement HMR protocol messages
- [x] Add error handling and recovery
- [x] Add graceful shutdown support
- [x] Create example usage file

## Phase 3: Native Client Integration ✅

- [x] Create iOS status bar component (RuneDevStatusBar.swift)
- [x] Integrate status bar into iOS RuneRuntime
- [x] Create Android status bar component (RuneDevStatusBar.kt)
- [x] Integrate status bar into Android RuneRuntime
- [x] Add bundle loading indicators (bottom bar with spinner)
- [x] Add bundle loaded indicators (bottom bar - auto-hides)
- [x] Add update notifications (top bar - auto-hides)
- [x] Add updating indicators (top bar with spinner)
- [x] Add error indicators (bottom bar - red)

## Phase 4: CLI Integration ✅

- [x] Update `@rune/cli` package.json to use @rune/hmr
- [x] Replace `startViteDevServer` with `startRuneHMRServer`
- [x] Update `rune dev ios` command to use HMR server
- [x] Update `rune dev android` command to use HMR server
- [x] Pass RUNE_DEV_SERVER_URL to native builds
- [x] Integrate server logs into CLI output
- [x] Graceful shutdown handling
- [x] Support for custom port (RUNE_HMR_PORT)
- [x] Support for custom host (RUNE_HMR_HOST)

## Phase 5: Template Updates

- [ ] Replace rollup.config.mjs with rsbuild.config.ts in templates
- [ ] Update package.json scripts
- [ ] Remove Vite/Rollup dependencies
- [ ] Update documentation

## Phase 6: Testing

- [ ] Test on iOS devices
- [ ] Test on Android devices
- [ ] Test asset loading
- [ ] Test HMR flow
- [ ] Test error scenarios
- [ ] Performance benchmarking vs Vite

## Installation & Testing

```bash
cd packages/rune-hmr
yarn install
yarn build
```

## Testing the Server

```bash
# Run the example
node example.ts
```

## Phase 2 Implementation Details

### Server Architecture

- **Hono**: Lightweight HTTP framework (replaced Express for better performance)
- **WebSocket**: Real-time communication with native devices
- **Rsbuild**: Fast bundling with Rspack
- **Chokidar**: File watching for automatic rebuilds

### Key Features Implemented

- ✅ WebSocket connection management with handshake protocol
- ✅ Asset serving with content-type detection
- ✅ Asset manifest generation and scanning
- ✅ Automatic rebuild on file changes
- ✅ Bundle error propagation to clients
- ✅ Beautiful console logging for all events
- ✅ Health check endpoint
- ✅ Graceful shutdown handling

### Files Created

- `src/server/index.ts` - Main server orchestration (150+ lines)
- `src/server/websocket.ts` - WebSocket handler (200+ lines)
- `src/server/asset-server.ts` - Asset serving (190+ lines)
- `src/server/bundle-watcher.ts` - File watching & bundling (180+ lines)
- `example.ts` - Usage example

## Notes

- Using Hono instead of Express for lightweight and fast HTTP server
- TypeScript errors will resolve after `yarn install`
- All core HMR functionality is now implemented
- Ready for Phase 3: Native client integration
