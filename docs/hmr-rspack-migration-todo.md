# Native WebSocket + Rspack HMR Migration TODO

This tracks the migration from Zynth's custom native hot-update apply engine to Rsbuild/Rspack-owned HMR. Native remains the recovery/watchdog layer; Rspack owns `module.hot.check(true)` and update application.

## Phase 1: Bootstrap

- [x] Add public `WebSocket` facade in `@zynth/core`.
- [x] Add native WebSocket module on Android using OkHttp.
- [x] Add native WebSocket module on iOS using `URLSessionWebSocketTask`.
- [x] Install WebSocket globally when missing.
- [x] Add native HMR compat prelude before app startup.
- [x] Install `URL` polyfill before HMR compat uses `new URL(...)`.
- [x] Stop replacing Rsbuild's HMR client with `hmr-client-empty`.
- [x] Keep overlay shim disabled for native.

## Phase 2: Transport

- [x] Use native dev-server transport for HMR `hash`/`ok` messages.
- [x] Keep native dev-support connected only as watchdog/status/reload support.
- [x] Stop native iOS dev-support from fetching/evaluating hot-update chunks.
- [x] Stop native Android dev-support from fetching/evaluating hot-update chunks.
- [x] Add debug logging for WebSocket connect/open/message/send/close.
- [x] Confirm native transport works on iOS.
- [x] Confirm native transport works on Android.

## Phase 3: Rspack Apply

- [x] Patch Rspack script loader hook to fetch/evaluate hot-update chunks without a fake DOM.
- [x] Add debug logging for HMR compat install, loader patching, chunk fetch, chunk evaluation, and reload fallback.
- [x] Use native `hash`/`ok` messages as the trigger for Rspack `hot.check(true)` when Rsbuild's browser HMR client is not injected.
- [x] Confirm a leaf text edit updates without resetting local Solid signal state.
- [x] Confirm deleting a JSX child removes the native element.
- [x] Confirm add/remove component export either patches correctly or falls back to full reload.
- [x] Confirm editing a route screen preserves navigation state when safe.
- [x] Confirm editing router implementation/manifest reloads deterministically.
- [x] Pulse the native HMR visual indicator after successful Rspack apply.

## Phase 4: Cleanup

- [ ] Remove or quarantine the old custom apply engine in `packages/zynth-core/src/hmr.ts`.
- [ ] Remove native hot-update manifest/chunk fetch helpers after both platforms prove stable.
- [ ] Keep native full reload fallback documented and tested.
- [ ] Add focused smoke tests for WebSocket open/message/send/close/error/listener cleanup.

## Current Notes

- iOS no longer reports the initial `URL` missing boot error after importing the URL polyfill in the HMR compat prelude.
- The `Cannot set property ... of undefined` hot-update error was consistent with native evaluating a hot-update chunk outside Rspack's `module.hot.check(true)` apply window. Native update application is now disabled so the chunk should only be loaded by Rspack.
- If a bundle rebuild completes but the app does not change, start the dev server with `ZYNTH_HMR_DEBUG=1` and inspect the `[Zynth WebSocket]` and `[Zynth HMR Compat]` logs.
- Rsbuild injects its browser HMR client only when the compiler target includes `web`; native keeps a non-browser target and uses native dev-server messages as the transport trigger instead.
- Current fallback driver uses native dev-server messages for transport, but still delegates actual module application to Rspack via `hot.check(true)`.
- The native-message driver now calls `hot.check(true)` on the first completed rebuild instead of waiting for a second edit; Rspack decides if there is nothing to apply.
- Native Solid Refresh now uses `bundler: "rspack-esm"` and disables JSX-level refresh wrapping (`jsx: false`) to reduce risky structural JSX remounts in the native renderer.
- Full reload fallback now calls `__zynth_disposeRoot()` before native evaluates the fresh dev bundle, preventing duplicated roots/listeners after recovering from a failed HMR apply.
- Fallback reload now disposes the entry HMR listeners and re-patches the Rspack loader when a fresh bundle installs a new `__webpack_require__` in the same Hermes VM.
