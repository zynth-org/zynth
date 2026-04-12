# Zynth Debugging Roadmap

## Summary

Zynth already has the beginnings of a useful diagnostics system:

- A cross-platform Devtools transport module
- A CLI WebSocket hub
- Native forwarding for console logs and JS/native errors
- In-app native overlays for failures

What is missing is a true Hermes inspector path for debugger-grade features such as:

- Breakpoints
- Pause and resume
- Step over, step into, and step out
- Script discovery and source mapping
- Chrome DevTools compatible session management
- A richer network analysis surface

This roadmap proposes a two-lane architecture:

1. Keep the current Devtools event transport for logs, errors, overlays, and custom diagnostics.
2. Add a separate Hermes inspector transport for debugger sessions, enabled only in development builds.

That split keeps the current Devtools experience stable while allowing us to add a browser debugger without polluting the production runtime.

## Goals

### Primary goals

- Enable Hermes JavaScript debugging on iOS and Android in development builds.
- Preserve the existing Devtools transport for logging and native diagnostics.
- Avoid shipping inspector codepaths in release builds.
- Support browser-based tooling with as much Chrome DevTools compatibility as Hermes allows.
- Add enough structured runtime telemetry to support useful network inspection.

### Secondary goals

- Keep the architecture runtime-agnostic enough to support multiple Hermes runtimes in the future.
- Avoid coupling the inspector session lifecycle to the custom Devtools pub/sub topic system.
- Make it easy for the CLI to discover active debug runtimes and attach to them.

### Non-goals

- Do not add debugging code to `zynth-ui`.
- Do not route debugger control messages through the regular async module bridge unless required as a fallback.
- Do not depend on React Native DevTools internals.
- Do not enable Hermes inspector in production or release builds.

## Current State

### What exists today

- `packages/zynth-cli/src/devtools/hub.js` provides a WebSocket pub/sub hub.
- `DevtoolsModule` exists on Android and iOS in debug mode.
- Hermes runtime hosts emit console and error events into Devtools.
- Inbound Devtools events can be forwarded back into JavaScript.
- Android and iOS already read devtools connection configuration in development flows.

### What works well

- Console forwarding
- Native and JS error reporting
- Native overlay support
- Reusable transport primitives

### What is missing

- Hermes inspector runtime registration
- Inspector session attach/detach lifecycle
- Inspector discovery endpoints
- Chrome DevTools Protocol proxying or tunneling
- Structured network event capture for a proper network panel
- Clear separation between diagnostic events and debugger control traffic

## Target Architecture

## Lane 1: Devtools Diagnostics Transport

Purpose:
Carry lightweight custom Zynth diagnostic events without depending on inspector protocols.

Responsibilities:

- Console events
- JS/native/build errors
- Performance overlay stats
- HMR lifecycle events
- Custom network telemetry
- Future runtime diagnostics such as memory snapshots or worklet registration traces

Rules:

- Remains topic-based
- Human-readable and easy to extend
- Safe to use without a connected debugger
- Never blocks runtime execution on network availability

## Lane 2: Hermes Inspector Transport

Purpose:
Carry Hermes inspector traffic for debugger-capable tooling.

Responsibilities:

- Runtime registration
- Session attach/detach
- Bidirectional inspector message flow
- Discovery and target listing
- Browser debugger compatibility

Rules:

- Separate channel from Devtools diagnostics
- Enabled only in debug/development builds
- One runtime may have zero or one active inspector session unless Hermes supports more
- Failure to attach must not break app execution

## Runtime Model

Each Hermes runtime should expose a debug descriptor with:

- Runtime id
- Runtime name
- Platform
- App identifier
- Bundle URL or source origin when available
- Connection state
- Capabilities

Each runtime may participate in two independent channels:

- Diagnostics channel
- Inspector channel

This allows logs to keep flowing even when no browser debugger is attached.

## Phases

## Phase 0: Investigation and Validation

Objective:
Confirm the exact Hermes inspector APIs and packaging requirements for the Hermes version embedded in Zynth on iOS and Android.

Tasks:

- Audit the Hermes version and embedded artifacts on both platforms.
- Identify the exact inspector and Chrome adapter headers/libraries already available in the iOS Hermes podspec.
- Verify whether Android Hermes artifacts expose equivalent inspector interfaces or require additional packaging.
- Validate whether the current Hermes build flavor includes inspector support in debug only, or whether new build flags are required.
- Confirm the expected Chrome DevTools or browser attachment flow supported by the Hermes version in use.
- Document all required runtime APIs, adapter objects, and thread affinity constraints.

Deliverables:

- A native integration note for iOS
- A native integration note for Android
- A compatibility matrix for supported debugger features

Risks:

- Hermes inspector API surface may differ by version.
- Android and iOS packaging may not be symmetrical.

## Phase 1: Stabilize and Formalize Current Devtools

Objective:
Strengthen the existing Devtools path so it becomes the stable diagnostics lane.

Tasks:

- Define a versioned Devtools event envelope.
- Add explicit runtime metadata to all emitted diagnostic events.
- Add a topic naming convention document.
- Separate diagnostics topics from automation topics in the hub.
- Add connection health metrics and reconnect telemetry.
- Add test coverage for publish, subscribe, reconnect, replay, and malformed payload handling.
- Add CLI flags to print runtime metadata and connection events more clearly.
- Add guardrails so Devtools transport failures never affect runtime logic.

Deliverables:

- Stable event schema
- Transport tests
- Clear topic taxonomy

Acceptance criteria:

- Existing console and error flows keep working on both platforms.
- Devtools continues to function without inspector support enabled.

## Phase 2: Introduce a Dedicated Inspector Channel

Objective:
Create a second transport lane specifically for Hermes inspector traffic.

Tasks:

- Add a new debug transport concept in CLI and native runtime code.
- Decide whether the inspector channel uses:
  - a separate WebSocket endpoint, or
  - a shared socket with strict message namespace separation.
- Prefer a separate endpoint to avoid coupling inspector traffic to topic fanout semantics.
- Define runtime registration messages for inspector-capable runtimes.
- Define attach, detach, and heartbeat semantics.
- Define runtime ownership rules when multiple browser clients attempt to attach.
- Add authentication or token reuse rules consistent with current devtools configuration.

Deliverables:

- Inspector transport protocol document
- Runtime registration schema
- CLI endpoint design

Acceptance criteria:

- Inspector messages no longer share the same flow as `pub/sub` topic events.
- Logging remains operational if inspector is unavailable.

## Phase 3: Native Hermes Inspector Integration on iOS

Objective:
Attach Zynth iOS Hermes runtimes to Hermes inspector APIs in debug builds.

Tasks:

- Update iOS Hermes packaging to explicitly include required inspector subspecs in development configurations.
- Add a dedicated iOS debug-only inspector integration module inside `zynth-core`.
- Register each `ZynthHermesRuntimeHost` with the Hermes inspector when the runtime is created.
- Unregister cleanly when the runtime is disposed.
- Expose runtime metadata required for discovery.
- Ensure all inspector operations happen on the correct runtime thread.
- Keep inspector codepaths behind `#if DEBUG` or equivalent dev-only build configuration.
- Confirm no inspector symbols are linked into release artifacts unless explicitly desired.

Deliverables:

- iOS runtime registration
- iOS session attach/detach support
- Debug-only build gating

Acceptance criteria:

- A browser client can discover an iOS runtime and establish an inspector session.
- App execution remains stable if the inspector disconnects mid-session.

## Phase 4: Native Hermes Inspector Integration on Android

Objective:
Attach Zynth Android Hermes runtimes to Hermes inspector APIs in debug builds.

Tasks:

- Identify where Android Hermes inspector support must be linked or surfaced in the Zynth native layer.
- Add a dedicated Android debug-only inspector integration module in `zynth-core`.
- Register the Hermes runtime from the native runtime creation path.
- Unregister on runtime disposal and process shutdown.
- Expose runtime metadata and session state to the CLI transport.
- Ensure JNI and thread ownership are correct for runtime attach/detach.
- Keep all inspector code limited to debug source sets or dev build flavors.
- Verify release builds strip or omit inspector support.

Deliverables:

- Android runtime registration
- Android session attach/detach support
- Debug-only packaging

Acceptance criteria:

- A browser client can discover an Android runtime and establish an inspector session.
- Runtime teardown does not leak inspector state.

## Phase 5: CLI Discovery and Proxy Layer

Objective:
Teach the Zynth CLI to discover inspector-capable runtimes and expose them to browser tooling.

Tasks:

- Extend the CLI server to maintain a registry of active runtimes.
- Add runtime discovery endpoints compatible with the chosen browser tooling.
- Add session routing from browser connection to native runtime connection.
- Add runtime labels, platform labels, and app identifiers to discovery output.
- Support reconnect behavior when a device runtime restarts.
- Add logging for inspector attach, detach, and protocol errors.
- Decide whether the CLI will emulate Chrome target discovery endpoints or expose a custom attach flow.
- Add smoke tests for runtime registration, discovery, and message proxying.

Deliverables:

- Runtime registry
- Discovery endpoint implementation
- Proxy transport implementation

Acceptance criteria:

- Browser tooling can list runtimes without relying on the generic Devtools topic hub.
- Inspector traffic reaches the correct runtime reliably.

## Phase 6: Browser Debugger Experience

Objective:
Provide a usable browser debugging workflow with maximum Hermes compatibility.

Tasks:

- Validate the target browser workflow against Chrome DevTools and any Hermes-compatible inspector frontend.
- Confirm support for:
  - breakpoints
  - call stacks
  - stepping
  - pause on exceptions
  - source display
- Validate source map behavior for development bundles.
- Validate runtime naming when multiple runtimes exist.
- Document the user workflow for iOS simulator, Android emulator, and physical devices.
- Add CLI commands or output hints that point developers to the correct browser debugger URL.

Deliverables:

- Browser attach workflow
- Debugger support matrix
- User documentation

Acceptance criteria:

- Developers can attach a browser debugger and perform basic JavaScript debugging on both platforms.

## Phase 7: Network Inspection

Objective:
Add practical request/response visibility without waiting on inspector-level network support.

Tasks:

- Instrument native `FetchModule` request lifecycle on iOS and Android.
- Emit structured network events into the diagnostics lane.
- Define a schema for:
  - request start
  - headers received
  - response metadata
  - body size
  - timing
  - upload progress
  - stream completion
  - cancellation
  - failure
- Decide how to redact sensitive headers and bodies.
- Capture WebSocket lifecycle events where useful.
- Build either:
  - a CLI-readable network stream, or
  - a browser-facing custom panel backed by diagnostics events.
- Keep payload sizes bounded to avoid transport overhead.

Deliverables:

- Network event schema
- Native network instrumentation
- Developer-facing network inspection workflow

Acceptance criteria:

- Developers can inspect request timing, status, and failures on both platforms.
- Sensitive data is redacted by default.

## Phase 8: Hardening, Performance, and Release Safety

Objective:
Ensure the entire debugging stack is safe, fast, and absent from production.

Tasks:

- Audit all debug-only codepaths for build gating.
- Confirm release artifacts do not include inspector-only entry points.
- Measure runtime overhead with diagnostics idle, diagnostics connected, and inspector attached.
- Ensure reconnect storms do not saturate the JS or main thread.
- Bound all pending queues and replay buffers.
- Add cleanup for runtime disposal and app background transitions.
- Add crash-safe behavior when transport or inspector sessions terminate unexpectedly.
- Verify that debug instrumentation does not add measurable cost to the render hot path.

Deliverables:

- Performance report
- Release gating checklist
- Stability checklist

Acceptance criteria:

- No production regressions
- No release linkage of debug-only inspector modules
- No frame-time regressions attributable to idle debug plumbing

## Work Breakdown by Area

## CLI

Tasks:

- Refactor current `devtools` hub into modular lanes.
- Add inspector runtime registry.
- Add discovery HTTP endpoints if required by browser tooling.
- Add inspector proxy session handling.
- Preserve existing topic-based diagnostics hub.
- Add integration tests for runtime registration and browser attach.

## iOS

Tasks:

- Wire Hermes inspector APIs into `ZynthHermesRuntimeHost`.
- Add debug-only runtime registration lifecycle.
- Preserve existing `ZynthDevtoolsModule` for diagnostics.
- Ensure inspector traffic does not flow through the generic `emit` event path.
- Validate symbol/source map handling for the browser debugger.

## Android

Tasks:

- Wire Hermes inspector APIs into native runtime creation in `zynthkit.cpp` or adjacent debug-only runtime support.
- Add debug-only runtime registration lifecycle.
- Preserve existing `DevtoolsModule` for diagnostics.
- Ensure JNI ownership and threading are correct for inspector callbacks.
- Validate browser attach flow with emulator and device networking.

## Runtime Diagnostics

Tasks:

- Standardize runtime metadata on all events.
- Add network instrumentation.
- Add performance and lifecycle topics.
- Add structured error classification.

## Documentation

Tasks:

- Document architecture and protocol split.
- Document local development setup.
- Document browser attach steps.
- Document known feature gaps and limitations.

## Proposed Milestones

### Milestone 1

Devtools lane stabilized and documented.

### Milestone 2

Inspector transport designed and CLI discovery implemented.

### Milestone 3

iOS Hermes inspector attach working.

### Milestone 4

Android Hermes inspector attach working.

### Milestone 5

Browser debugging workflow documented and validated on both platforms.

### Milestone 6

Network inspection available through the diagnostics lane.

### Milestone 7

Performance and release hardening complete.

## Open Questions

- Which Hermes inspector frontend should Zynth target first: Chrome DevTools compatibility, a custom frontend, or both?
- Does the Hermes version currently embedded in Android expose the same inspector adapter surface as iOS?
- Should the CLI own all runtime discovery, or should devices expose local metadata endpoints that the CLI aggregates?
- Do we want one browser debugger per runtime or one browser session controlling multiple runtimes?
- How should source maps be generated and served for the best stepping experience in development?
- Should network bodies be capturable behind an explicit opt-in due to privacy and payload size concerns?
- Do we need to support guest/hypervisor runtimes in the first release, or only the primary app runtime?

## Immediate Next Steps

1. Validate Hermes inspector API availability and packaging on both platforms.
2. Formalize the split between diagnostics transport and inspector transport.
3. Implement CLI runtime registry and discovery design.
4. Prototype iOS runtime registration in debug builds.
5. Prototype Android runtime registration in debug builds.
6. Add structured network event schema on top of the existing diagnostics lane.

## Definition of Done

The roadmap is complete when:

- iOS and Android Hermes runtimes can be debugged in development builds.
- Existing Devtools logging and error capture continue to work independently.
- Inspector support is isolated from production builds.
- Developers can discover, attach, debug, and inspect runtime activity with documented workflows.
- Network inspection is available at a useful baseline level.
- Performance and architectural constraints remain intact.
