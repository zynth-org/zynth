# Rune Devtools Event Pipeline (WebSocket Pub/Sub)

## Goal

Provide a lightweight, development-only event pipeline so:

- Native runtimes (iOS/Android) can emit structured events without relying on stdout/logcat/xcrun log streaming.
- JS packages can emit events without importing a CLI package or any heavy dependency.
- The Rune CLI can act as a local “hub” that receives events, supports pub/sub (topics), and prints or forwards them to future tooling (desktop app, dashboard, recorder).

Non-goals:

- Replace HMR or tie this system to Rsbuild.
- Guarantee delivery in all conditions (this is dev tooling; dropping is acceptable under load).

## Design Constraints

- **Development-only**: must not ship enabled in production builds.
- **Zero render impact**: emission on hot paths must be non-blocking; bounded buffers and drop/sampling are required.
- **Cross-platform**: same conceptual API and message envelope across iOS, Android, and JS.
- **Minimal surface area**: packages call a tiny shared API that is a no-op when devtools is unavailable.

## High-Level Architecture

### Components

- **Rune CLI Devtools Hub** (Node.js, WebSocket server)
  - Accepts WebSocket connections from devices/simulators.
  - Implements MQTT-like pub/sub semantics: topics, subscriptions, and fan-out.
  - Exposes CLI commands for viewing/filtering streams.

- **Runtime Devtools Client** (iOS/Android, development builds only)
  - Connects to the hub.
  - Maintains a bounded in-memory queue (ring buffer) for outbound events.
  - Flushes asynchronously on a background thread/queue.

- **JS Devtools Bridge** (development builds only)
  - A minimal global that packages can call without importing native code:
    - `globalThis.__RUNE_DEVTOOLS__?.emit(event)`
    - `globalThis.__RUNE_DEVTOOLS__?.isConnected()`

### Topics and Events

- Topics are strings, e.g.:
  - `log/<tag>` (e.g. `log/SecureStore`)
  - `router/timeline`
  - `perf/mark`
  - `native/diagnostic`
- Payloads are structured JSON with a small envelope:
  - `v` (protocol version)
  - `topic`
  - `ts` (timestamp)
  - `level` (optional)
  - `tag` (optional)
  - `data` (event payload)
  - `runtime` metadata (platform, app id, session id, etc.)

## Phase 1 — Minimal Viable Pub/Sub (Dev-Only)

### CLI: WebSocket Hub + CLI Viewer

- Add a “devtools hub” to `@rune/cli`:
  - WebSocket server listening on a configurable port.
  - In-memory topic registry:
    - `Map<topic, Set<client>>`
    - `Map<client, Set<topic>>`
  - Simple JSON protocol:
    - `sub`: client subscribes to topics.
    - `unsub`: client unsubscribes.
    - `pub`: client publishes an event to a topic.
- Add a CLI command (or mode) that prints events:
  - `rune devtools logs --topic log/* --level info,warn,error --tag SecureStore`
  - Filtering should happen server-side where possible (reduce client spam).

### Runtime: Devtools Client (iOS/Android)

- Implement a development-only WebSocket client in each runtime that can:
  - Connect/disconnect with exponential backoff.
  - Publish `pub` frames to the hub.
  - Maintain a bounded queue for outbound events:
    - enqueue is O(1)
    - if full: drop newest or oldest (explicit policy)
    - optional sampling per topic/level
- Expose a minimal “emit” entry point to native and JS.

### JS: Global Bridge + No-op Fallback

- In dev builds, the runtime injects:
  - `globalThis.__RUNE_DEVTOOLS__ = { emit, isConnected }`
- In production builds:
  - `__RUNE_DEVTOOLS__` is undefined
  - the shared JS helper is a no-op

## Phase 2 — Reliability and Usability (Still Lightweight)

### Protocol Enhancements (MQTT-like ergonomics)

- Add optional features without making emission blocking:
  - `sessionId` and `clientId` for multi-device scenarios.
  - `seq` (monotonic sequence number per runtime) for ordering.
  - Optional “soft ack” for the CLI viewer only (not required for emit).
  - Topic wildcards supported by the hub (e.g. `log/*`, `router/**`).
- Add an in-memory ring buffer on the hub:
  - Per-topic or global buffer.
  - Enables “connect and replay last N events” for new viewers.

### Runtime Enhancements (Performance-Safe)

- Move serialization off hot paths when possible:
  - On hot paths: capture primitives and references; serialize in the flush worker.
  - Provide “fast path” for already-string payloads.
- Add per-topic throttling:
  - e.g. only emit 1 event per X ms for extremely chatty topics.

### Package Instrumentation Hooks

- Define a shared helper API (in an existing lightweight package, or a new tiny one) that packages can call:
  - `emitDevtoolsEvent(topic, data, { level, tag })`
  - Implementation:
    - calls `globalThis.__RUNE_DEVTOOLS__?.emit(...)`
    - otherwise no-op
- Add opt-in instrumentation in key packages:
  - Router timeline, storage, keyboard, network/fetch, performance marks.

## Phase 3 — Tooling Ecosystem (External Apps, Recording, Plugins)

### External Consumers

- Make the hub capable of multiple subscribers:
  - CLI “tail”
  - GUI app (Flipper-like)
  - file recorder (NDJSON) for later replay
- Add an optional HTTP endpoint for metadata:
  - list connected runtimes
  - list active topics

### Extensibility

- Plugin architecture in the hub:
  - register topic processors (e.g. router timeline renderer)
  - attach additional sinks (file, websocket-forward, UI)

### Safety Defaults

- Ensure production builds do not connect or emit:
  - compile-time flags on iOS/Android
  - runtime guards in JS bridge injection
  - default-off configuration

